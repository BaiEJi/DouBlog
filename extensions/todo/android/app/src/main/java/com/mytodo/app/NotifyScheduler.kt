package com.mytodo.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/** 一条待调度通知的最小信息 */
data class NotifyPlan(val id: String, val title: String, val time: String)

/**
 * 任务级 APK 渠道通知调度:
 * - 看板每次同步后 reconcile:调度新增/变更的,取消已完成/删除/渠道变更的
 * - 到点由 NotifyAlarmReceiver 校验服务端仍为 pending 后发系统通知
 * - 已调度清单存 SharedPreferences,重启后由 BootReceiver 拉取 /today 重排
 */
object NotifyScheduler {
    const val CHANNEL_ID = "todo_reminders"
    internal const val PREF = "mytodo_notify"
    internal const val KEY = "scheduled" // {id: {d: "2026-09-13", t: "09:30", title: "..."}}
    private val TIME_RE = Regex("([01]\\d|2[0-3]):[0-5]\\d")

    private fun store(ctx: Context) = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    /** 从看板任务算出当前应当存在的 apk 通知集合并调度 */
    fun reconcile(ctx: Context, tasks: List<NotifyPlan>) {
        val today = LocalDate.now().toString()
        val now = LocalDateTime.now()
        val desired = HashMap<String, NotifyPlan>()
        for (t in tasks) {
            if (t.time.isBlank() || !TIME_RE.matches(t.time)) continue
            val hhmm = t.time.split(":")
            val at = LocalDateTime.of(LocalDate.now(), LocalTime.of(hhmm[0].toInt(), hhmm[1].toInt()))
            if (!at.isAfter(now)) continue // 已过点,不补发
            desired[t.id] = t
        }

        val sp = store(ctx)
        val cur = HashMap<String, JSONObject>()
        try {
            val o = JSONObject(sp.getString(KEY, "{}"))
            for (id in o.keys()) cur[id] = o.optJSONObject(id) ?: continue
        } catch (e: Exception) { }

        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        // 取消:不在期望集合里的(已完成/删除/渠道变更)
        for ((id, meta) in cur) {
            if (!desired.containsKey(id)) am.cancel(pi(ctx, id))
        }
        // 无条件重注册期望集合:force-stop/覆盖安装/重启都会清空AlarmManager,
        // 登记簿不可信,宁可重复注册(幂等)也不能漏
        for ((id, d) in desired) {
            schedule(ctx, am, d)
            cur[id] = JSONObject().put("d", today).put("t", d.time).put("title", d.title)
        }
        // 写回登记簿(无条件,内容可能只有时间变化)
        val out = JSONObject()
        for ((id, d) in desired) {
            out.put(id, cur[id] ?: JSONObject())
        }
        sp.edit().putString(KEY, out.toString()).apply()
    }

    private fun schedule(ctx: Context, am: AlarmManager, p: NotifyPlan) {
        val hhmm = p.time.split(":")
        val trigger = LocalDateTime.of(LocalDate.now(), LocalTime.of(hhmm[0].toInt(), hhmm[1].toInt()))
            .atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
        val op = pi(ctx, p.id)
        val exact = if (Build.VERSION.SDK_INT >= 31) am.canScheduleExactAlarms() else true
        if (exact) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, op)
        } else {
            // 未授予精确闹钟:10分钟窗口兜底(比默认1小时批处理窗小得多)
            am.setWindow(AlarmManager.RTC_WAKEUP, trigger, 10 * 60 * 1000L, op)
        }
    }

    private fun pi(ctx: Context, id: String): PendingIntent {
        val it = Intent(ctx, NotifyAlarmReceiver::class.java).setAction("notify.$id")
        return PendingIntent.getBroadcast(ctx, id.hashCode(), it,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** 闹钟到点:确认任务仍待办后发通知(离线则照发,宁可多提醒) */
    fun fire(ctx: Context, id: String, title: String, time: String) {
        kotlin.concurrent.thread {
            var stillPending = true
            try {
                val resp = ApiClient.get("/tasks/$id")
                if (resp.ok) {
                    val st = JSONObject(resp.body).optString("status")
                    stillPending = st == "pending"
                }
            } catch (e: Exception) { }
            if (!stillPending) return@thread
            runNotify(ctx, title, "计划 $time · 还没完成哦", id)
        }
    }

    private fun runNotify(ctx: Context, title: String, text: String, id: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(
                CHANNEL_ID, "待办提醒", NotificationManager.IMPORTANCE_DEFAULT))
        }
        val tap = PendingIntent.getActivity(ctx, id.hashCode(),
            Intent(ctx, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val b = if (Build.VERSION.SDK_INT >= 26)
            Notification.Builder(ctx, CHANNEL_ID) else Notification.Builder(ctx)
        val n = b.setContentTitle("⏰ $title")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        nm.notify(id.hashCode(), n)
    }
}

class NotifyAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.action?.removePrefix("notify.") ?: return
        val sp = ctx.getSharedPreferences(NotifyScheduler.PREF, Context.MODE_PRIVATE)
        val meta = try { JSONObject(sp.getString(NotifyScheduler.KEY, "{}")).optJSONObject(id) } catch (e: Exception) { null }
            ?: return
        val pending = goAsync()
        kotlin.concurrent.thread {
            try {
                NotifyScheduler.fire(ctx, id, meta.optString("title"), meta.optString("t"))
            } finally {
                pending.finish()
            }
        }
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val pending = goAsync()
        kotlin.concurrent.thread {
            try {
                ApiClient.init(ctx)
                val resp = ApiClient.get("/today")
                if (!resp.ok) return@thread
                val root = JSONObject(resp.body)
                val plans = ArrayList<NotifyPlan>()
                val qs = root.optJSONArray("quadrants") ?: return@thread
                for (i in 0 until qs.length()) {
                    val q = qs.optJSONObject(i) ?: continue
                    val arr = q.optJSONArray("tasks") ?: continue
                    for (j in 0 until arr.length()) {
                        val o = arr.optJSONObject(j) ?: continue
                        if (o.optString("status") != "pending") continue
                        if (!o.optBoolean("notify_enabled", false)) continue
                        val chans = o.optJSONArray("notify_channels") ?: continue
                        var has = false
                        for (k in 0 until chans.length()) if (chans.optString(k) == "apk") has = true
                        if (!has) continue
                        plans.add(NotifyPlan(o.optString("id"), o.optString("title"),
                            o.optString("notify_time")))
                    }
                }
                NotifyScheduler.reconcile(ctx, plans)
            } catch (e: Exception) {
            } finally {
                pending.finish()
            }
        }
    }
}
