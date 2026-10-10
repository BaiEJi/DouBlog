package com.mytodo.app

import android.animation.LayoutTransition
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.text.TextUtils
import android.view.DragEvent
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import kotlin.concurrent.thread

class MainActivity : Activity() {

    companion object {
        private val QUAD_COLORS = hashMapOf(
            1 to 0xFFE0584F.toInt(),  // 珊瑚红 重要且紧急
            2 to 0xFF7B80E4.toInt(),  // 长春花蓝 重要不紧急
            3 to 0xFFE09A3E.toInt(),  // 暖橙 紧急不重要
            4 to 0xFF9AA1A9.toInt()   // 暖灰 不紧急不重要
        )
        private val QUAD_SHORT = hashMapOf(1 to "Q1", 2 to "Q2", 3 to "Q3", 4 to "Q4")
        private val VISUAL_ORDER = intArrayOf(2, 1, 4, 3) // Q2左上 Q1右上 Q4左下 Q3右下

        // ---- 设计令牌:暖米色调(对照目标设计稿) ----
        private const val BG = 0xFFF3EFE7.toInt()          // 暖米页面底
        private const val SURFACE = 0xFFFDFBF6.toInt()     // 暖白卡面
        private const val INK = 0xFF211D16.toInt()         // 暖黑主文字
        private const val INK2 = 0xFF6E665A.toInt()        // 暖灰次文字
        private const val INK3 = 0xFFA69D8D.toInt()        // 暖浅灰弱文字
        private const val HAIR = 0xFFE9E3D7.toInt()        // 暖发丝线
        private const val PRIMARY = 0xFF7B80E4.toInt()      // 长春花蓝主色
        private const val PRIMARY_SOFT = 0xFFECECFB.toInt() // 主色容器
        private const val PRIMARY2 = 0xFF9C8FE2.toInt()     // 渐变副色(藤萝紫)
        private const val TAN = 0xFFE9D6BF.toInt()          // ＋按钮暖棕
        private var dragHintShown = false
    }

    private class Task(
        val id: String,
        val title: String,
        val description: String?,
        val categoryName: String?,
        val categoryColor: Int?,
        val quadrant: Int,
        val done: Boolean,
        val migratedCount: Int,
        val originalDate: String?,
        val daysProcrastinated: Int,
        val revision: Int,
        val notifyEnabled: Boolean = false,
        val notifyTime: String? = null,          // "HH:MM"
        val notifyChannels: List<String> = emptyList(),
        val taskDate: String? = null,            // "YYYY-MM-DD",日历页分组用
        val categoryId: String? = null,
        val completionNote: String? = null       // 完成备注(完成时填写)
    )

    private class Migration(
        val id: String,
        val title: String,
        val originalDate: String?,
        val days: Int,
        val intervention: Boolean
    )

    private class Cat(
        val id: String,
        val name: String,
        val color: Int?,
        val icon: String?
    )

    private lateinit var dateText: TextView
    private lateinit var titleText: TextView
    private lateinit var badge: TextView
    private lateinit var streakText: TextView
    private lateinit var boardRoot: LinearLayout
    private lateinit var grid: LinearLayout
    private lateinit var backlogScroll: ScrollView
    private lateinit var calendarScroll: ScrollView
    private lateinit var trendScroll: ScrollView
    private lateinit var backlogList: LinearLayout
    private lateinit var statsScroll: ScrollView
    private lateinit var settingsScroll: ScrollView
    private lateinit var progress: ProgressBar
    private lateinit var errorView: TextView
    private lateinit var urlEdit: EditText
    private lateinit var tokenEdit: EditText
    private lateinit var secretEdit: EditText
    private val bottomButtons = ArrayList<TextView>()
    private var migrations: List<Migration> = emptyList()
    private var hasData = false
    private var currentPage = -1
    private var quadLabels: MutableMap<Int, String> = hashMapOf(
        1 to "立即做", 2 to "计划做", 3 to "委派·批量", 4 to "考虑删除")
    private var quadSubs: MutableMap<Int, String> = hashMapOf(
        1 to "重要且紧急", 2 to "重要不紧急", 3 to "紧急不重要", 4 to "不重要不紧急")
    private var categories: List<Cat> = emptyList()

    // 原地更新注册表(性能:避免整板重建)
    private val listQuadrant = HashMap<LinearLayout, Int>()  // 任务列表 → 象限
    private val quadPills = HashMap<Int, TextView>()         // 象限 → 待办计数胶囊

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density + 0.5f).toInt()
    private fun qColor(q: Int): Int = QUAD_COLORS[q] ?: 0xFF94A3B8.toInt()

    // ---------- 生命周期 ----------

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = BG
        window.navigationBarColor = BG
        // 请求屏幕支持的最高刷新率,动画帧率自适应上限
        try {
            @Suppress("DEPRECATION")
            val disp = windowManager.defaultDisplay
            val best = disp?.supportedModes?.maxByOrNull { it.refreshRate }
            if (best != null && best.refreshRate > 0f) {
                val a = window.attributes
                a.preferredRefreshRate = best.refreshRate
                window.attributes = a
            }
        } catch (e: Exception) { }
        buildUi()
    }

    override fun onResume() {
        super.onResume()
        ApiClient.init(this)
        // Android 13+ 通知运行时权限(拒绝过就静默,不再骚扰)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission("android.permission.POST_NOTIFICATIONS") !=
            android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), 100)
        }
        // 精确闹钟:未授权时首次引导到系统设置(API31+默认拒绝)
        if (Build.VERSION.SDK_INT >= 31) {
            val am = getSystemService(ALARM_SERVICE) as android.app.AlarmManager
            val sp = getSharedPreferences("mytodo", Context.MODE_PRIVATE)
            if (!am.canScheduleExactAlarms() && !sp.getBoolean("exact_asked", false)) {
                sp.edit().putBoolean("exact_asked", true).apply()
                try {
                    startActivity(Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                        .setData(android.net.Uri.parse("package:$packageName")))
                } catch (e: Exception) { }
            }
        }
        refresh()
        if (currentPage == 1) loadBacklog()
        if (currentPage == 2) loadCalendar()
        if (currentPage == 3) loadStats()
        if (currentPage == 4) loadTrend()
        startPolling()
    }

    override fun onPause() {
        super.onPause()
        stopPolling()
    }

    // ---------- 跨端实时同步:轮询+签名比对,无变化零开销,外部改动静默应用 ----------

    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var syncing = false
    @Volatile private var boardSig = ""
    @Volatile private var isDragging = false
    private val pendingOps = java.util.concurrent.atomic.AtomicInteger(0)
    // 日历页:0周/1月/2年;calAnchor=当前视图锚点;calSelected=选中日
    private var calMode = 1
    private var calAnchor: LocalDate = LocalDate.now()
    private var calSelected: LocalDate = LocalDate.now()
    private lateinit var calTitle: TextView
    private lateinit var calBody: LinearLayout
    private lateinit var calSegBtns: Array<TextView>
    private lateinit var calTaskHeader: TextView
    private lateinit var calTaskList: LinearLayout
    private val calDayCounts = HashMap<String, IntArray>() // date -> [total, pending]
    private var lastTrendY = 0
    @Volatile private var serverToday: LocalDate = LocalDate.now() // 服务器口径今天(来自/today.date)
    private lateinit var dockBar: LinearLayout
    private lateinit var pageFrame: FrameLayout
    private lateinit var mainFrame: LinearLayout
    // 规律生活独立体系
    private var inLife = false
    private var lifeTab = 0            // 0今日1日历2回顾3统计4设置
    private lateinit var lifeRoot: LinearLayout
    private lateinit var lifeBody: LinearLayout
    private lateinit var lifeSegBtns: Array<TextView>
    private var lifeDate: LocalDate = LocalDate.now()
    private var lifeCalAnchor: LocalDate = LocalDate.now()
    private var lifeCalSelected: LocalDate = LocalDate.now()
    private val lifeCalCounts = HashMap<String, IntArray>()  // date -> [done,total]
    private val lifeCalTasks = ArrayList<Task>()
    private var reviewDays = 30
    @Volatile private var trendSig = ""
    private val calDayTasks = ArrayList<Task>()

    // 待办/总结页:数据签名(没变不重建) + 实时滚动位置(重建后回到用户当前所看位置)
    @Volatile private var backlogSig = ""
    @Volatile private var statsSig = ""
    private var lastBacklogY = 0
    private var lastStatsY = 0

    private val pollTick = object : Runnable {
        override fun run() {
            syncFromServer()
            mainHandler.postDelayed(this, 2500)
        }
    }

    private fun startPolling() {
        mainHandler.removeCallbacks(pollTick)
        mainHandler.postDelayed(pollTick, 2500)
    }

    private fun stopPolling() {
        mainHandler.removeCallbacks(pollTick)
    }

    /** 当前看板内容签名:id+象限+状态+标题+分类+顺序,任一变化都会变 */
    private fun boardSignature(root: JSONObject): String {
        val sb = StringBuilder()
        val qs = root.optJSONArray("quadrants") ?: return ""
        for (i in 0 until qs.length()) {
            val q = qs.optJSONObject(i) ?: continue
            sb.append(q.optInt("quadrant")).append(':')
            val arr = q.optJSONArray("tasks") ?: continue
            for (j in 0 until arr.length()) {
                val t = arr.optJSONObject(j) ?: continue
                sb.append(t.optString("id")).append(',')
                    .append(t.optString("status")).append(',')
                    .append(t.optString("title")).append(',')
                    .append(t.optString("category_name")).append(',')
                    .append(t.optString("description")).append(',')
                    .append(t.optInt("migrated_count")).append(',')
                    .append(t.optBoolean("notify_enabled", false)).append(',')
                    .append(t.optString("notify_time")).append(',')
                    .append(t.optString("notify_channels")).append(';')
            }
            sb.append('|')
        }
        return sb.toString()
    }

    private fun syncFromServer() {
        if (syncing) return
        syncing = true
        thread {
            try {
                val resp = ApiClient.get("/today")
                if (!resp.ok) return@thread
                val root = JSONObject(resp.body)
                val sig = boardSignature(root)
                if (sig == boardSig) return@thread
                val migs = parseMigrations(root.optJSONArray("pending_migrations"))
                runOnUiThread {
                    // 本机乐观操作或拖拽进行中:跳过本轮,下轮再比对应用
                    if (pendingOps.get() > 0 || isDragging) return@runOnUiThread
                    boardSig = sig
                    hasData = true
                    migrations = migs
                    renderBoard(root)
                }
            } catch (e: Exception) {
                // 轮询失败静默,不打扰
            } finally {
                syncing = false
            }
        }
    }

    // ---------- UI 构建 ----------

    private fun buildUi() {
        val root = FrameLayout(this)
        root.setBackgroundColor(BG)
        root.clipChildren = false

        val main = LinearLayout(this)
        mainFrame = main
        main.orientation = LinearLayout.VERTICAL
        main.clipChildren = false
        root.addView(main, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        // 顶栏:单行紧凑(标题+日期同一行)
        val top = LinearLayout(this)
        top.orientation = LinearLayout.HORIZONTAL
        top.gravity = Gravity.CENTER_VERTICAL
        top.setPadding(dp(20), dp(7), dp(16), dp(2))
        main.addView(top, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        titleText = TextView(this)
        titleText.text = "今日"
        titleText.textSize = 20f
        titleText.typeface = Typeface.DEFAULT_BOLD
        titleText.setTextColor(INK)
        titleText.letterSpacing = 0.01f
        top.addView(titleText, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        dateText = TextView(this)
        dateText.textSize = 12f
        dateText.setTextColor(INK3)
        val dlp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        dlp.marginStart = dp(8)
        dlp.gravity = Gravity.BOTTOM
        dlp.bottomMargin = dp(3)
        top.addView(dateText, dlp)

        val spacer = View(this)
        top.addView(spacer, LinearLayout.LayoutParams(0, 1, 1f))

        streakText = TextView(this)
        streakText.textSize = 10f
        streakText.typeface = Typeface.DEFAULT_BOLD
        streakText.setTextColor(PRIMARY)
        streakText.background = tonalPill(PRIMARY)
        streakText.setPadding(dp(8), dp(3), dp(8), dp(3))
        streakText.visibility = View.GONE
        top.addView(streakText, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginEnd = dp(7) })

        badge = TextView(this)
        badge.setTextColor(Color.WHITE)
        badge.textSize = 9f
        badge.typeface = Typeface.DEFAULT_BOLD
        badge.gravity = Gravity.CENTER
        badge.background = circleSolid(PRIMARY)
        badge.elevation = dp(2).toFloat()
        badge.visibility = View.GONE
        badge.setOnClickListener { showMigrations() }

        val lifeBtn = TextView(this)
        lifeBtn.text = "生活"
        lifeBtn.textSize = 11f
        lifeBtn.typeface = Typeface.DEFAULT_BOLD
        lifeBtn.setTextColor(PRIMARY)
        lifeBtn.background = roundedSolid(PRIMARY_SOFT, 99f)
        lifeBtn.setPadding(dp(10), dp(5), dp(10), dp(5))
        top.addView(lifeBtn, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(7) })
        lifeBtn.setOnClickListener { enterLife() }
        top.addView(badge, LinearLayout.LayoutParams(dp(19), dp(19)))

        // 页面容器
        pageFrame = FrameLayout(this)
        main.addView(pageFrame, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        // ---- 今日页:Do First式连体田字格(全屏无边框) ----
        boardRoot = LinearLayout(this)
        boardRoot.orientation = LinearLayout.VERTICAL
        boardRoot.setPadding(0, dp(4), 0, dp(6))
        pageFrame.addView(boardRoot, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        grid = LinearLayout(this)
        grid.orientation = LinearLayout.VERTICAL
        boardRoot.addView(grid, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        // 其余页面懒构建(ensurePage):首帧只建今日看板,冷启动不付全UI构建成本

        // ---- 悬浮胶囊Dock(贴底/紧凑) ----
        val bar = LinearLayout(this)
        dockBar = bar
        bar.orientation = LinearLayout.HORIZONTAL
        bar.gravity = Gravity.CENTER_VERTICAL
        bar.clipChildren = false
        bar.clipToPadding = false
        val barBg = GradientDrawable()
        barBg.setColor(SURFACE)
        barBg.cornerRadius = 26f * resources.displayMetrics.density
        bar.background = barBg
        bar.elevation = dp(10).toFloat()
        main.addView(bar, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(56)).also {
            it.marginStart = dp(10); it.marginEnd = dp(10); it.bottomMargin = dp(0)
        })

        fun barItem(icon: String, label: String) {
            // 外层槽位等宽且居中;内层胶囊只包内容,选中底色不会超出底栏
            val slot = LinearLayout(this)
            slot.orientation = LinearLayout.VERTICAL
            slot.gravity = Gravity.CENTER
            val item = LinearLayout(this)
            item.orientation = LinearLayout.VERTICAL
            item.gravity = Gravity.CENTER
            item.setPadding(dp(8), dp(4), dp(8), dp(4))
            if (icon.isNotEmpty()) {
                val ic = TextView(this)
                ic.text = icon
                ic.textSize = 14f
                ic.gravity = Gravity.CENTER
                ic.includeFontPadding = false
                item.addView(ic, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT))
            }
            val tv = TextView(this)
            tv.text = label
            tv.textSize = 10f
            tv.gravity = Gravity.CENTER
            tv.includeFontPadding = false
            tv.setPadding(0, dp(1), 0, 0)
            item.addView(tv, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT))
            item.setOnClickListener { }
            slot.addView(item, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT))
            bar.addView(slot, LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
            bottomButtons.add(tv)
        }

        barItem("", "今日")
        barItem("", "待办")
        barItem("", "日历")
        // 暖棕圆钮加号:用等宽槽位+居中,避免weight把固定宽度拉伸成椭圆
        val addBtn = TextView(this)
        addBtn.text = "＋"
        addBtn.setTextColor(INK)
        addBtn.textSize = 22f
        addBtn.gravity = Gravity.CENTER
        addBtn.includeFontPadding = false
        addBtn.setPadding(0, dp(1), 0, 0)
        addBtn.background = circleSolid(PRIMARY)
        addBtn.setTextColor(Color.WHITE)
        addBtn.setOnClickListener { showTaskDialog(null) }
        val addSlot = FrameLayout(this)
        addSlot.addView(addBtn, FrameLayout.LayoutParams(dp(44), dp(44), Gravity.CENTER))
        bar.addView(addSlot, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        barItem("", "总结")
        barItem("", "统计")
        barItem("", "设置")

        bottomButtons.forEachIndexed { idx, tv ->
            (tv.parent as? View)?.setOnClickListener { selectPage(idx) }
        }

        // 覆盖层
        progress = ProgressBar(this)
        progress.visibility = View.GONE
        root.addView(progress, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))

        errorView = TextView(this)
        errorView.text = "加载失败,点击重试"
        errorView.textSize = 13f
        errorView.setTextColor(0xFFEF4444.toInt())
        errorView.gravity = Gravity.CENTER
        errorView.background = roundedSolid(SURFACE, 16f)
        errorView.setPadding(dp(20), dp(14), dp(20), dp(14))
        errorView.elevation = dp(6).toFloat()
        errorView.visibility = View.GONE
        errorView.setOnClickListener { refresh() }
        root.addView(errorView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))

        setContentView(root)
        selectPage(0)
    }

    private fun buildSettingsPage() {
        val col = LinearLayout(this)
        col.orientation = LinearLayout.VERTICAL
        col.setPadding(dp(16), dp(4), dp(16), dp(96))
        settingsScroll.addView(col, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        col.addView(sectionHeader("服务器"))
        val card = cardItem()
        col.addView(card)

        fun fieldLabel(text: String) {
            val l = TextView(this)
            l.text = text
            l.textSize = 11f
            l.typeface = Typeface.DEFAULT_BOLD
            l.setTextColor(INK2)
            card.addView(l, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(10) })
        }

        fieldLabel("地址")
        urlEdit = EditText(this)
        urlEdit.textSize = 13f
        urlEdit.hint = "http://192.168.1.100:8070"
        urlEdit.setInputType(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        urlEdit.background = roundedStroke()
        urlEdit.setPadding(dp(12), dp(11), dp(12), dp(11))
        urlEdit.setText(getSharedPreferences("mytodo", Context.MODE_PRIVATE)
            .getString("server_url", ApiClient.DEFAULT_BASE))
        card.addView(urlEdit, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        card.addView(hintRow("手机填电脑局域网 IP"))
        card.addView(hintRow("模拟器用 http://10.0.2.2:8070"))

        fieldLabel("Token")
        tokenEdit = EditText(this)
        tokenEdit.textSize = 11f
        tokenEdit.setInputType(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        tokenEdit.setSingleLine(true)
        tokenEdit.background = roundedStroke()
        tokenEdit.setPadding(dp(12), dp(11), dp(12), dp(11))
        tokenEdit.setText(getSharedPreferences("mytodo", Context.MODE_PRIVATE)
            .getString("token", ApiClient.DEFAULT_TOKEN))
        card.addView(tokenEdit, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        card.addView(hintRow("与账号绑定,永不过期;开放 API 可用 ?token= 调用"))

        fieldLabel("Token 接口加密密钥")
        secretEdit = EditText(this)
        secretEdit.textSize = 13f
        secretEdit.setInputType(InputType.TYPE_CLASS_TEXT)
        secretEdit.setSingleLine(true)
        secretEdit.background = roundedStroke()
        secretEdit.setPadding(dp(12), dp(11), dp(12), dp(11))
        secretEdit.setText(getSharedPreferences("mytodo", Context.MODE_PRIVATE)
            .getString("secret_key", ApiClient.DEFAULT_SECRET))
        card.addView(secretEdit, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        card.addView(hintRow("与服务端设置页\"Token接口加密\"保持一致,不一致将解密失败"))

        val saveBtn = TextView(this)
        saveBtn.text = "保存"
        saveBtn.textSize = 14f
        saveBtn.typeface = Typeface.DEFAULT_BOLD
        saveBtn.setTextColor(Color.WHITE)
        saveBtn.gravity = Gravity.CENTER
        saveBtn.background = roundedSolid(PRIMARY, 14f)
        saveBtn.setPadding(0, dp(12), 0, dp(12))
        card.addView(saveBtn, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(14) })
        saveBtn.setOnClickListener {
            getSharedPreferences("mytodo", Context.MODE_PRIVATE).edit()
                .putString("server_url", urlEdit.text.toString().trim())
                .putString("token", tokenEdit.text.toString().trim())
                .putString("secret_key", secretEdit.text.toString().trim())
                .apply()
            ApiClient.init(this)
            Toast.makeText(this, "已保存", Toast.LENGTH_SHORT).show()
            refresh()
        }
    }

    /** 页面懒构建:首次访问才创建,冷启动只付今日页成本 */
    private fun pageBuilt(i: Int): Boolean = when (i) {
        1 -> ::backlogScroll.isInitialized
        2 -> ::calendarScroll.isInitialized
        3 -> ::statsScroll.isInitialized
        4 -> ::trendScroll.isInitialized
        5 -> ::settingsScroll.isInitialized
        else -> true
    }

    private fun pageAt(i: Int): View = when (i) {
        1 -> backlogScroll; 2 -> calendarScroll; 3 -> statsScroll
        4 -> trendScroll; 5 -> settingsScroll; else -> boardRoot
    }

    private fun ensurePage(i: Int) {
        if (pageBuilt(i)) return
        when (i) {
            1 -> {
                backlogScroll = ScrollView(this)
                backlogScroll.overScrollMode = View.OVER_SCROLL_NEVER
                backlogScroll.visibility = View.GONE
                backlogScroll.setOnScrollChangeListener { _, _, sy, _, _ -> lastBacklogY = sy }
                pageFrame.addView(backlogScroll, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                backlogList = LinearLayout(this)
                backlogList.orientation = LinearLayout.VERTICAL
                backlogList.setPadding(dp(16), dp(4), dp(16), dp(96))
                backlogScroll.addView(backlogList, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
            }
            2 -> {
                calendarScroll = ScrollView(this)
                calendarScroll.overScrollMode = View.OVER_SCROLL_NEVER
                calendarScroll.visibility = View.GONE
                pageFrame.addView(calendarScroll, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                buildCalendarPage()
            }
            3 -> {
                statsScroll = ScrollView(this)
                statsScroll.overScrollMode = View.OVER_SCROLL_NEVER
                statsScroll.visibility = View.GONE
                statsScroll.setOnScrollChangeListener { _, _, sy, _, _ -> lastStatsY = sy }
                pageFrame.addView(statsScroll, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            }
            4 -> {
                trendScroll = ScrollView(this)
                trendScroll.overScrollMode = View.OVER_SCROLL_NEVER
                trendScroll.visibility = View.GONE
                trendScroll.setOnScrollChangeListener { _, _, sy, _, _ -> lastTrendY = sy }
                pageFrame.addView(trendScroll, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            }
            5 -> {
                settingsScroll = ScrollView(this)
                settingsScroll.overScrollMode = View.OVER_SCROLL_NEVER
                settingsScroll.visibility = View.GONE
                pageFrame.addView(settingsScroll, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                buildSettingsPage()
            }
        }
    }

    private fun selectPage(i: Int) {
        // 重复点当前页:不重载,防止误触把滚动位置拽回顶部
        if (i == currentPage) return
        currentPage = i
        val freshlyBuilt = !pageBuilt(i)
        ensurePage(i)
        for (idx in 0..5) {
            if (!pageBuilt(idx)) continue
            val v = pageAt(idx)
            v.visibility = if (idx == i) View.VISIBLE else View.GONE
        }
        // 页面直接切换,不做alpha过渡(避免整页闪烁感)
        titleText.text = when (i) {
            1 -> "待办"
            2 -> "日历"
            3 -> "总结"
            4 -> "统计"
            5 -> "设置"
            else -> "今日"
        }
        bottomButtons.forEachIndexed { idx, tv ->
            val item = tv.parent as? LinearLayout ?: return@forEachIndexed
            if (idx == i) {
                tv.setTextColor(PRIMARY)
                tv.typeface = Typeface.DEFAULT_BOLD
                item.background = roundedSolid(PRIMARY_SOFT, 99f)
                item.animate().cancel()
                item.animate().scaleX(1.08f).scaleY(1.08f).setDuration(110).withLayer()
                    .withEndAction {
                        item.animate().scaleX(1f).scaleY(1f).setDuration(180).withLayer()
                            .setInterpolator(OvershootInterpolator(2.5f)).start()
                    }.start()
            } else {
                tv.setTextColor(INK3)
                tv.typeface = Typeface.DEFAULT
                item.background = null
                item.animate().cancel()
                item.scaleX = 1f
                item.scaleY = 1f
            }
        }
        if (i == 1) loadBacklog()
        if (i == 2) loadCalendar()
        if (i == 3) loadStats()
        if (i == 4) loadTrend()
    }

    // ---------- 今日数据 ----------

    private fun refresh() {
        if (!hasData) progress.visibility = View.VISIBLE
        errorView.visibility = View.GONE
        thread {
            try {
                val resp = ApiClient.get("/today")
                if (!resp.ok) throw RuntimeException("HTTP ${resp.code}")
                val root = JSONObject(resp.body)
                val migs = parseMigrations(root.optJSONArray("pending_migrations"))
                boardSig = boardSignature(root)
                runOnUiThread {
                    progress.visibility = View.GONE
                    hasData = true
                    migrations = migs
                    renderBoard(root)
                }
                loadMeta() // 非关键路径:象限文案/类别缓存,渲染后异步就位
            } catch (e: Exception) {
                runOnUiThread {
                    progress.visibility = View.GONE
                    Toast.makeText(this, "无法连接服务器,请检查地址与网络", Toast.LENGTH_LONG).show()
                    if (!hasData) errorView.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun loadMeta() {
        try {
            val s = JSONObject(ApiClient.get("/settings").body)
            val labels = s.optJSONObject("quadrant_labels")
            val subs = s.optJSONObject("quadrant_subtitles")
            for (q in 1..4) {
                labels?.optString("q$q")?.takeIf { it.isNotEmpty() }?.let { quadLabels[q] = it }
                subs?.optString("q$q")?.takeIf { it.isNotEmpty() }?.let { quadSubs[q] = it }
            }
        } catch (e: Exception) { }
        try {
            val arr = JSONArray(ApiClient.get("/categories").body)
            val out = ArrayList<Cat>()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                var c: Int? = null
                val cs = o.optString("color")
                if (!cs.isNullOrEmpty() && cs != "null") {
                    try { c = Color.parseColor(cs) } catch (e: Exception) { c = null }
                }
                val icon = o.optString("icon")
                out.add(Cat(o.optString("id"), o.optString("name"), c,
                    if (icon.isNullOrEmpty() || icon == "null") null else icon))
            }
            categories = out
        } catch (e: Exception) { }
    }

    private fun renderBoard(root: JSONObject) {
        val sb = StringBuilder()
        try {
            val d = LocalDate.parse(root.optString("date"))
            serverToday = d
            val wd = arrayOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")[d.dayOfWeek.value - 1]
            sb.append("${d.monthValue}月${d.dayOfMonth}日 $wd")
        } catch (e: Exception) {
            sb.append(root.optString("date"))
        }
        val streak = root.optJSONObject("streak")?.optInt("current", 0) ?: 0
        dateText.text = sb.toString()
        if (streak > 0) {
            streakText.text = "连续 $streak 天"
            streakText.visibility = View.VISIBLE
        } else {
            streakText.visibility = View.GONE
        }

        if (migrations.isNotEmpty()) {
            badge.text = migrations.size.toString()
            badge.visibility = View.VISIBLE
        } else {
            badge.visibility = View.GONE
        }

        val byQ = HashMap<Int, JSONObject>()
        val arr = root.optJSONArray("quadrants") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val q = arr.optJSONObject(i) ?: continue
            byQ[q.optInt("quadrant")] = q
        }
        grid.removeAllViews()
        listQuadrant.clear()
        quadPills.clear()
        var r = 0
        while (r < VISUAL_ORDER.size) {
            val row = LinearLayout(this)
            row.orientation = LinearLayout.HORIZONTAL
            val rlp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            if (r > 0) rlp.topMargin = dp(2)
            grid.addView(row, rlp)
            for (c in 0 until 2) {
                val q = VISUAL_ORDER[r + c]
                val cell = buildQuadrantCard(byQ[q], q)
                val clp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
                if (c == 0) clp.marginEnd = dp(2) else clp.marginStart = dp(2)
                row.addView(cell, clp)
            }
            r += 2
        }
        reconcileNotifyFromBoard()
    }

    /** Do First式象限格子:淡色底+裸行任务,与白画布组成田字格 */
    private fun buildQuadrantCard(qobj: JSONObject?, q: Int): View {
        val color = qColor(q)
        val label = qobj?.optString("label").takeUnless { it.isNullOrEmpty() } ?: quadLabels[q] ?: ""
        val pending = qobj?.optInt("pending_count", 0) ?: 0
        val tasks = parseTasks(qobj?.optJSONArray("tasks"))

        val cell = LinearLayout(this)
        cell.orientation = LinearLayout.VERTICAL
        cell.background = cellBg(color, 42)

        val content = LinearLayout(this)
        content.orientation = LinearLayout.VERTICAL
        content.setPadding(dp(13), dp(11), dp(13), dp(10))
        cell.addView(content, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        // 头部:象限名(象限色) + 数量,下挂坐标语义副标题
        val header = LinearLayout(this)
        header.orientation = LinearLayout.HORIZONTAL
        header.gravity = Gravity.CENTER_VERTICAL
        content.addView(header, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val bar = View(this)
        bar.background = roundedSolid(color, 3f)
        header.addView(bar, LinearLayout.LayoutParams(dp(4), dp(14)).also { it.marginEnd = dp(6) })
        val name = TextView(this)
        name.text = label
        name.textSize = 13f
        name.typeface = Typeface.DEFAULT_BOLD
        name.setTextColor(color)
        header.addView(name, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        // 副标题与标题同行
        val sub = TextView(this)
        sub.text = quadSubs[q] ?: ""
        sub.textSize = 9f
        sub.setTextColor(INK3)
        header.addView(sub, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.marginStart = dp(6); it.gravity = Gravity.CENTER_VERTICAL
        })

        val hsp = View(this)
        header.addView(hsp, LinearLayout.LayoutParams(0, 1, 1f))

        val pill = TextView(this)
        pill.text = pending.toString()
        pill.textSize = 10f
        pill.typeface = Typeface.DEFAULT_BOLD
        pill.setTextColor(color)
        pill.gravity = Gravity.CENTER
        pill.background = tonalPill(color)
        pill.setPadding(dp(8), dp(1), dp(8), dp(1))
        header.addView(pill, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        quadPills[q] = pill

        // 任务区:象限内滚动
        val taskScroll = ScrollView(this)
        taskScroll.overScrollMode = View.OVER_SCROLL_NEVER
        content.addView(taskScroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).also { it.topMargin = dp(8) })
        val list = LinearLayout(this)
        list.orientation = LinearLayout.VERTICAL
        taskScroll.addView(list, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        listQuadrant[list] = q

        // 拖拽:监听挂在整个象限卡片上(列表是WRAP_CONTENT短条,只挂列表会有大片死区)
        // 高亮用预建drawable+状态去重,DRAG_LOCATION高频事件零分配
        val bgNormal = cellBg(color, 42)
        val bgHi = cellBg(color, 95)
        var hi = false
        cell.setOnDragListener { v, event ->
            when (event.action) {
                DragEvent.ACTION_DRAG_STARTED -> { isDragging = true; true }
                DragEvent.ACTION_DRAG_ENTERED, DragEvent.ACTION_DRAG_LOCATION -> {
                    if (!hi) { hi = true; cell.background = bgHi }
                    true
                }
                DragEvent.ACTION_DRAG_EXITED, DragEvent.ACTION_DRAG_ENDED -> {
                    if (event.action == DragEvent.ACTION_DRAG_ENDED) isDragging = false
                    if (hi) { hi = false; cell.background = bgNormal }
                    true
                }
                DragEvent.ACTION_DROP -> {
                    isDragging = false
                    if (hi) { hi = false; cell.background = bgNormal }
                    val t = event.localState as? Task
                    if (t != null) {
                        // event.y是cell坐标系,换算到list坐标系(仅DROP时分配一次)
                        val cellLoc = IntArray(2)
                        val listLoc = IntArray(2)
                        v.getLocationOnScreen(cellLoc)
                        list.getLocationOnScreen(listLoc)
                        val yInList = event.y + (cellLoc[1] - listLoc[1])
                        var beforeId: String? = null
                        for (i in 0 until list.childCount) {
                            val child = list.getChildAt(i)
                            val t2 = child.tag as? Task ?: continue
                            if (t2.id == t.id) continue
                            if (yInList < child.top + child.height / 2f) {
                                beforeId = t2.id
                                break
                            }
                        }
                        moveTask(t, q, beforeId)
                    }
                    true
                }
                else -> true
            }
        }

        if (tasks.isEmpty()) {
            val empty = TextView(this)
            empty.text = "🍃 暂无任务"
            empty.textSize = 11f
            empty.setTextColor(INK3)
            empty.gravity = Gravity.CENTER
            empty.setPadding(0, dp(16), 0, dp(12))
            list.addView(empty, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        } else {
            for (t in tasks) list.addView(taskRow(t, color))
        }
        // 首帧填充完成后才挂过渡:整板重建零动画,后续增删行才有收拢/滑入
        list.post {
            list.layoutTransition = LayoutTransition().also {
                it.setDuration(160)
            }
        }
        return cell
    }

    /** 单行任务:○ 标题 备注 ⟲拖N天 ●类别 */
    private fun taskRow(t: Task, color: Int): View {
        val row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        row.gravity = Gravity.CENTER_VERTICAL
        row.setPadding(0, dp(4), 0, dp(4))
        row.background = ripple()
        if (t.done) row.alpha = 0.5f

        val check = TextView(this)
        check.gravity = Gravity.CENTER
        check.textSize = 10f
        check.typeface = Typeface.DEFAULT_BOLD
        check.setTextColor(Color.WHITE)
        if (t.done) {
            check.text = "✓"
            check.background = circleSolid(color)
        } else {
            check.text = ""
            check.background = circleRing(color)
        }
        row.addView(check, LinearLayout.LayoutParams(dp(19), dp(19)).also { it.marginEnd = dp(7) })

        // 中段弹性块:标题(限宽) + 备注(weight),保证尾部标签永不溢出
        val mid = LinearLayout(this)
        mid.orientation = LinearLayout.HORIZONTAL
        mid.gravity = Gravity.CENTER_VERTICAL
        row.addView(mid, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        val title = TextView(this)
        title.text = t.title
        title.textSize = 12f
        title.setTextColor(INK)
        title.maxLines = 1
        title.ellipsize = TextUtils.TruncateAt.END
        title.maxWidth = dp(92)
        if (t.done) title.paintFlags = title.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
        mid.addView(title, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val note = TextView(this)
        note.text = if (t.done && !t.completionNote.isNullOrEmpty()) "📝 ${t.completionNote}"
            else t.description ?: ""
        note.textSize = 9f
        note.setTextColor(INK3)
        note.maxLines = 1
        note.ellipsize = TextUtils.TruncateAt.END
        note.setSingleLine(true)
        if (t.done) note.paintFlags = note.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
        mid.addView(note, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also {
            it.marginStart = dp(6)
        })

        if (t.migratedCount > 0) {
            val mig = TextView(this)
            mig.text = if (t.daysProcrastinated > 0) "拖${t.daysProcrastinated}天" else "迁过"
            mig.textSize = 9f
            mig.typeface = Typeface.DEFAULT_BOLD
            mig.setTextColor(0xFFB45309.toInt())
            mig.background = tonalPill(0xFFF59E0B.toInt())
            mig.setPadding(dp(6), dp(1), dp(6), dp(1))
            mig.maxLines = 1
            row.addView(mig, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(4) })
        }
        if (!t.categoryName.isNullOrEmpty()) {
            val dot2 = View(this)
            dot2.background = circleSolid(t.categoryColor ?: Color.GRAY)
            row.addView(dot2, LinearLayout.LayoutParams(dp(5), dp(5)).also { it.marginStart = dp(6) })
            val cat = TextView(this)
            cat.text = t.categoryName
            cat.textSize = 9f
            cat.setTextColor(INK3)
            cat.maxLines = 1
            cat.ellipsize = TextUtils.TruncateAt.END
            cat.maxWidth = dp(36)
            row.addView(cat, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(3) })
        }

        // 乐观更新:先做勾选回弹动画再发请求,无等待感
        // 点击时读 row.tag 拿最新Task(原地更新会替换tag,闭包里的t可能是旧的)
        fun doToggle(cur: Task) {
            if (!cur.done) {
                // 完成前弹备注弹窗(可选填),取消则保持待办
                showCompleteNoteDialog(cur) { noteText ->
                    check.text = "✓"
                check.background = circleSolid(color)
                row.alpha = 0.55f
                title.paintFlags = title.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
                note.paintFlags = note.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
                    check.animate().scaleX(1.4f).scaleY(1.4f).setDuration(110).withLayer().withEndAction {
                        check.animate().scaleX(1f).scaleY(1f).setDuration(170).withLayer()
                            .setInterpolator(OvershootInterpolator(2.5f)).start()
                    }.start()
                    toggleTask(cur, noteText)
                }
            } else {
                check.text = ""
                check.background = circleRing(color)
                row.alpha = 1f
                title.paintFlags = title.paintFlags and Paint.STRIKE_THRU_TEXT_FLAG.inv()
                note.paintFlags = note.paintFlags and Paint.STRIKE_THRU_TEXT_FLAG.inv()
                toggleTask(cur, null)
            }
        }
        row.setOnClickListener { v -> (v.tag as? Task)?.let { doToggle(it) } }
        check.setOnClickListener { (row.tag as? Task)?.let { doToggle(it) } }
        row.setOnLongClickListener { v ->
            v.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            (v.tag as? Task)?.let { showTaskDialog(it) }
            true
        }
        row.tag = t
        return row
    }

    // ---------- 待办页 ----------

    private fun loadBacklog() {
        ensurePage(1)
        val first = backlogList.childCount == 0
        if (first) {
            backlogList.removeAllViews()
            backlogList.addView(sectionHeader("待迁移"))
            backlogList.addView(loadingRow())
        }
        thread {
            try {
                val inboxBody = ApiClient.get("/tasks?inbox=true").body
                val inbox = parseTasks(inboxBody.takeIf { it.isNotEmpty() }?.let { JSONArray(it) })
                val body = ApiClient.get("/migrations/pending").body
                val migs = parseMigrations(body.takeIf { it.isNotEmpty() }?.let { JSONArray(it) })
                // 数据没变:完全不动UI,绝不打断用户正在进行的滚动
                if (!first && "$inboxBody|$body" == backlogSig) return@thread
                backlogSig = "$inboxBody|$body"
                runOnUiThread {
                    renderBacklog(inbox, migs)
                    // 恢复到滚动监听实时记录的位置(而非进页时的旧位置)
                    backlogScroll.post { backlogScroll.scrollTo(0, lastBacklogY) }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    if (first) {
                        backlogList.removeAllViews()
                        backlogList.addView(errorRow("加载失败,点击重试") { loadBacklog() })
                    }
                    // 已有内容时刷新失败静默保留旧数据
                }
            }
        }
    }

    private fun renderBacklog(inbox: List<Task>, migs: List<Migration>) {
        backlogList.removeAllViews()

        backlogList.addView(sectionHeader("待迁移 · ${migs.size}"))
        if (migs.isEmpty()) {
            backlogList.addView(hintRow("没有逾期待迁移的任务,很棒 👌"))
        } else {
            for (m in migs) {
                val item = cardItem()
                val head = LinearLayout(this)
                head.orientation = LinearLayout.HORIZONTAL
                head.gravity = Gravity.CENTER_VERTICAL
                item.addView(head, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

                val tv = TextView(this)
                tv.text = m.title
                tv.textSize = 13f
                tv.typeface = Typeface.DEFAULT_BOLD
                tv.setTextColor(INK)
                tv.maxLines = 1
                tv.ellipsize = TextUtils.TruncateAt.END
                head.addView(tv, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

                if (!m.intervention) {
                    val btn = TextView(this)
                    btn.text = "迁到今天"
                    btn.textSize = 11f
                    btn.typeface = Typeface.DEFAULT_BOLD
                    btn.setTextColor(PRIMARY)
                    btn.background = roundedSolid(PRIMARY_SOFT, 99f)
                    btn.setPadding(dp(12), dp(5), dp(12), dp(5))
                    head.addView(btn, LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(8) })
                    btn.setOnClickListener { migrateTask(listOf(m.id)) {} }
                }

                val daysTxt = if (m.days > 0) " · 拖延${m.days}天" else ""
                val sub = TextView(this)
                sub.text = if (m.intervention) "⟲ 来自 ${m.originalDate ?: "-"}$daysTxt · 需干预"
                else "⟲ 来自 ${m.originalDate ?: "-"}$daysTxt"
                sub.textSize = 10f
                sub.setTextColor(if (m.intervention) 0xFFEF4444.toInt() else INK3)
                sub.setPadding(0, dp(2), 0, 0)
                item.addView(sub, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
                backlogList.addView(item)
            }
        }

        backlogList.addView(sectionHeader("待办池 · ${inbox.size}"))
        backlogList.addView(hintRow("未排期的收件箱,排期后进入对应日期看板"))
        for (t in inbox) {
            val item = cardItem()
            val head = LinearLayout(this)
            head.orientation = LinearLayout.HORIZONTAL
            head.gravity = Gravity.CENTER_VERTICAL
            item.addView(head, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

            val dot = View(this)
            dot.background = circleSolid(qColor(t.quadrant))
            head.addView(dot, LinearLayout.LayoutParams(dp(8), dp(8)).also { it.marginEnd = dp(7) })

            val tv = TextView(this)
            tv.text = t.title
            tv.textSize = 13f
            tv.setTextColor(INK)
            tv.maxLines = 1
            tv.ellipsize = TextUtils.TruncateAt.END
            head.addView(tv, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

            val qtag = TextView(this)
            qtag.text = QUAD_SHORT[t.quadrant] ?: ""
            qtag.textSize = 9f
            qtag.typeface = Typeface.DEFAULT_BOLD
            qtag.setTextColor(qColor(t.quadrant))
            qtag.background = tonalPill(qColor(t.quadrant))
            qtag.setPadding(dp(6), dp(1), dp(6), dp(1))
            head.addView(qtag, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))

            val btn = TextView(this)
            btn.text = "排期"
            btn.textSize = 11f
            btn.typeface = Typeface.DEFAULT_BOLD
            btn.setTextColor(PRIMARY)
            btn.background = roundedSolid(PRIMARY_SOFT, 99f)
            btn.setPadding(dp(12), dp(5), dp(12), dp(5))
            head.addView(btn, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(6) })
            btn.setOnClickListener { showScheduleDialog(t) }

            if (!t.categoryName.isNullOrEmpty()) {
                val cat = TextView(this)
                cat.text = "● ${t.categoryName}"
                cat.textSize = 10f
                cat.setTextColor(INK3)
                cat.setPadding(0, dp(2), 0, 0)
                item.addView(cat, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            }
            backlogList.addView(item)
        }
        if (inbox.isEmpty()) backlogList.addView(hintRow("待办池是空的"))
    }

    private fun showScheduleDialog(t: Task) {
        val col = LinearLayout(this)
        col.orientation = LinearLayout.VERTICAL
        col.setPadding(dp(22), 0, dp(22), dp(18))
        col.addView(grabber())

        val sheetTitle = TextView(this)
        sheetTitle.text = "排期任务"
        sheetTitle.textSize = 17f
        sheetTitle.typeface = Typeface.DEFAULT_BOLD
        sheetTitle.setTextColor(INK)
        col.addView(sheetTitle)
        val sub = TextView(this)
        sub.text = t.title
        sub.textSize = 12f
        sub.setTextColor(INK3)
        sub.setPadding(0, dp(3), 0, 0)
        col.addView(sub)

        val dialog = AlertDialog.Builder(this)
            .setView(col)
            .create()
        dialog.show()
        sheetify(dialog, col)

        val quickRow = LinearLayout(this)
        quickRow.orientation = LinearLayout.HORIZONTAL
        col.addView(quickRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(14) })
        fun quickBtn(label: String, dateStr: String) {
            val b = TextView(this)
            b.text = label
            b.textSize = 13f
            b.typeface = Typeface.DEFAULT_BOLD
            b.setTextColor(PRIMARY)
            b.gravity = Gravity.CENTER
            b.background = roundedSolid(PRIMARY_SOFT, 99f)
            b.setPadding(dp(12), dp(11), dp(12), dp(11))
            quickRow.addView(b, LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also { it.marginEnd = dp(8) })
            b.setOnClickListener { scheduleTask(t, dateStr); dialog.dismiss() }
        }

        quickBtn("今天 ${LocalDate.now()}", LocalDate.now().toString())
        quickBtn("明天", LocalDate.now().plusDays(1).toString())

        val customRow = LinearLayout(this)
        customRow.orientation = LinearLayout.HORIZONTAL
        customRow.gravity = Gravity.CENTER_VERTICAL
        col.addView(customRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(12) })
        val input = EditText(this)
        input.hint = "YYYY-MM-DD"
        input.textSize = 13f
        input.inputType = InputType.TYPE_CLASS_TEXT
        input.background = roundedStroke()
        input.setPadding(dp(12), dp(11), dp(12), dp(11))
        customRow.addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val ok = TextView(this)
        ok.text = "确定"
        ok.textSize = 13f
        ok.typeface = Typeface.DEFAULT_BOLD
        ok.setTextColor(Color.WHITE)
        ok.gravity = Gravity.CENTER
        ok.background = gradientRounded(PRIMARY, PRIMARY2, 12f)
        ok.setPadding(dp(16), dp(11), dp(16), dp(11))
        customRow.addView(ok, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(8) })
        ok.setOnClickListener {
            val s = input.text.toString().trim()
            try {
                LocalDate.parse(s)
            } catch (e: Exception) {
                Toast.makeText(this, "日期格式: YYYY-MM-DD", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            scheduleTask(t, s)
            dialog.dismiss()
        }
    }

    private fun scheduleTask(t: Task, dateStr: String) {
        val body = JSONObject()
        body.put("task_date", dateStr)
        body.put("revision", t.revision)
        thread {
            try {
                val resp = ApiClient.patch("/tasks/${t.id}", body)
                if (!resp.ok) throw RuntimeException("HTTP ${resp.code}")
                runOnUiThread {
                    Toast.makeText(this, "已排期到 $dateStr", Toast.LENGTH_SHORT).show()
                    loadBacklog()
                    refresh()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this, "排期失败,请重试", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    // ---------- 总结页 ----------

    private fun loadStats() {
        ensurePage(3)
        val first = statsScroll.childCount == 0
        val wrap: LinearLayout
        if (first) {
            statsScroll.removeAllViews()
            wrap = LinearLayout(this)
            wrap.orientation = LinearLayout.VERTICAL
            wrap.setPadding(dp(16), dp(4), dp(16), dp(96))
            statsScroll.addView(wrap, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
            wrap.addView(sectionHeader("总结"))
            wrap.addView(loadingRow())
        } else {
            wrap = statsScroll.getChildAt(0) as? LinearLayout ?: return
        }
        thread {
            try {
                val dailyBody = ApiClient.get("/stats/daily").body
                val streakBody = ApiClient.get("/stats/streak").body
                val from = LocalDate.now().minusDays(6).toString()
                val to = LocalDate.now().toString()
                val rangeBody = ApiClient.get("/stats/range?from=$from&to=$to").body
                val shelvedBody = ApiClient.get("/migrations/shelved").body
                val shelvedN = JSONArray(shelvedBody).length()
                val sig = "$dailyBody|$streakBody|$rangeBody|$shelvedN"
                // 数据没变:完全不动UI,绝不打断用户正在进行的滚动
                if (!first && sig == statsSig) return@thread
                statsSig = sig
                val daily = JSONObject(dailyBody)
                val streak = JSONObject(streakBody)
                val range = JSONObject(rangeBody)
                runOnUiThread {
                    renderStats(wrap, daily, streak, range, shelvedN)
                    statsScroll.post { statsScroll.scrollTo(0, lastStatsY) }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    if (first) {
                        wrap.removeAllViews()
                        wrap.addView(errorRow("加载失败,点击重试") { loadStats() })
                    }
                    // 已有内容时刷新失败静默保留旧数据
                }
            }
        }
    }

    // ---------- 统计页(历史趋势) ----------

    /** 近30天完成量条形图(纯canvas,零依赖) */
    private class BarChart(ctx: android.content.Context, val vals: IntArray) : View(ctx) {
        private val dens = resources.displayMetrics.density
        private fun dp(v: Int) = (v * dens).toInt()
        override fun onDraw(c: android.graphics.Canvas) {
            val max = (vals.maxOrNull() ?: 0).coerceAtLeast(1)
            val n = vals.size.coerceAtLeast(1)
            val gap = dp(2).toFloat()
            val hPad = dp(12).toFloat()   // 两侧内边距:柱体不贴卡片圆角
            val topPad = dp(10).toFloat() // 顶部空间:极值柱不裁切
            val chartW = width - hPad * 2
            val bw = (chartW - gap * (n - 1)) / n.toFloat()
            val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
            for (i in vals.indices) {
                val h = if (vals[i] <= 0) dp(2).toFloat()
                    else (height - topPad - dp(6)) * vals[i] / max
                paint.color = if (vals[i] > 0) PRIMARY else 0x22000000
                val left = hPad + i * (bw + gap)
                c.drawRect(left, height - h, left + bw, height.toFloat(), paint)
            }
        }
        override fun onMeasure(w: Int, h: Int) {
            setMeasuredDimension(View.MeasureSpec.getSize(w), dp(110))
        }
    }

    /** 近30天完成热力图(7列周一~日×5行周,顶部列头,今天2dp描边,右下图例) */
    private class HeatmapChart(ctx: android.content.Context, val vals: IntArray,
                               val endDate: java.time.LocalDate = java.time.LocalDate.now()) : View(ctx) {
        private val dens = resources.displayMetrics.density
        private fun dp(v: Int) = (v * dens).toInt()
        override fun onDraw(c: android.graphics.Canvas) {
            val n = vals.size
            val today = endDate // 服务器口径窗口末日,避免设备时区偏一天
            val start = today.minusDays((n - 1).toLong())
            val origin = start.minusDays((start.dayOfWeek.value - 1).toLong())
            val cell = dp(18).toFloat()
            val gapX = dp(4).toFloat()
            val gapY = dp(5).toFloat()
            val left0 = dp(2).toFloat()
            val top0 = dp(16).toFloat()
            val sorted = vals.filter { it > 0 }.sorted()
            fun quantile(q: Double): Int {
                if (sorted.isEmpty()) return 1
                return sorted[((sorted.size - 1) * q).toInt()].coerceAtLeast(1)
            }
            val p50 = quantile(0.5); val p80 = quantile(0.8); val p95 = quantile(0.95)
            val paints = arrayOf(
                0xFFECE7DC.toInt(), 0xFFDFDBF8.toInt(), 0xFFBFBBF1.toInt(),
                0xFF9B94EC.toInt(), 0xFF7B74E8.toInt())
            val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
            val strokeP = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).also {
                it.style = android.graphics.Paint.Style.STROKE
                it.strokeWidth = dp(2).toFloat()
                it.color = 0xFF2F2B4F.toInt()
            }
            val r = dp(4).toFloat()
            val headP = android.graphics.Paint(paint).also {
                it.textSize = dp(9).toFloat(); it.color = 0xFF8A857C.toInt()
                it.textAlign = android.graphics.Paint.Align.CENTER
            }
            val heads = arrayOf("一", "二", "三", "四", "五", "六", "日")
            for (k in 0 until 7) {
                c.drawText(heads[k], left0 + k * (cell + gapX) + cell / 2, dp(11).toFloat(), headP)
            }
            for (i in 0 until n) {
                val d = start.plusDays(i.toLong())
                val off = java.time.temporal.ChronoUnit.DAYS.between(origin, d).toInt()
                val row = off / 7
                val col = off % 7
                val left = left0 + col * (cell + gapX)
                val top = top0 + row * (cell + gapY)
                val rect = android.graphics.RectF(left, top, left + cell, top + cell)
                val v = vals[i]
                val lv = when {
                    v <= 0 -> 0
                    v <= p50 -> 1
                    v <= p80 -> 2
                    v <= p95 -> 3
                    else -> 4
                }
                paint.color = paints[lv]
                c.drawRoundRect(rect, r, r, paint)
                if (i == n - 1) c.drawRoundRect(rect, r, r, strokeP)
            }
            val legY = top0 + 5 * (cell + gapY) + dp(6)
            val legP = android.graphics.Paint(paint).also {
                it.textSize = dp(9).toFloat(); it.color = 0xFF8A857C.toInt()
                it.textAlign = android.graphics.Paint.Align.LEFT
            }
            var lx = width - dp(10) - (5 * cell * 0.75f + 4 * gapX + dp(40))
            c.drawText("少", lx, legY + cell * 0.75f, legP)
            lx += dp(14)
            for (k in 0 until 5) {
                paint.color = paints[k]
                c.drawRoundRect(android.graphics.RectF(lx, legY, lx + cell * 0.75f, legY + cell * 0.75f), r, r, paint)
                lx += cell * 0.75f + gapX
            }
            c.drawText("多", lx + dp(2), legY + cell * 0.75f, legP)
        }
        override fun onMeasure(w: Int, h: Int) {
            setMeasuredDimension(View.MeasureSpec.getSize(w), dp(152))
        }
    }

    private fun loadTrend() {
        ensurePage(4)
        if (trendScroll.childCount == 0) {
            val wrap = LinearLayout(this)
            wrap.orientation = LinearLayout.VERTICAL
            wrap.setPadding(dp(16), dp(4), dp(16), dp(96))
            trendScroll.addView(wrap, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
            wrap.addView(sectionHeader("统计"))
            wrap.addView(loadingRow())
        }
        thread {
            try {
                val to = serverToday
                val from = to.minusDays(29)
                val r1 = ApiClient.get("/stats/range?from=$from&to=$to")
                if (!r1.ok) throw RuntimeException("HTTP ${r1.code}")
                val y = to.year
                val r2 = ApiClient.get("/stats/heatmap?year=$y")
                if (!r2.ok) throw RuntimeException("HTTP ${r2.code}")
                val sig = r1.body + "|" + r2.body
                if (sig == trendSig && trendScroll.childCount > 0) return@thread
                trendSig = sig
                val root = JSONObject(r1.body)
                val days = root.optJSONArray("days") ?: JSONArray()
                // 以服务器end为窗口锚,设备时区可能落后一天
                val endSrv = try { LocalDate.parse(root.optString("end")) } catch (e: Exception) { to }
                val done = IntArray(30)
                var sumDone = 0; var sumCreated = 0
                for (i in 0 until days.length()) {
                    val d = days.optJSONObject(i) ?: continue
                    sumDone += d.optInt("completed", 0)
                    sumCreated += d.optInt("created", 0)
                    val idx = try { java.time.temporal.ChronoUnit.DAYS.between(
                        LocalDate.parse(d.optString("date")), endSrv).toInt() } catch (e: Exception) { -1 }
                    if (idx in 0..29) done[29 - idx] = d.optInt("completed", 0)
                }
                // 月度热力(从heatmap聚合)
                val monthly = IntArray(13)
                val hm = JSONObject(r2.body).optJSONArray("days") ?: JSONArray()
                for (i in 0 until hm.length()) {
                    val d = hm.optJSONObject(i) ?: continue
                    val m = try { LocalDate.parse(d.optString("date")).monthValue } catch (e: Exception) { 0 }
                    if (m in 1..12) monthly[m] += d.optInt("count", 0)
                }
                runOnUiThread { renderTrend(done, sumDone, sumCreated, monthly, endSrv) }
            } catch (e: Exception) {
                runOnUiThread {
                    val wrap = trendScroll.getChildAt(0) as? LinearLayout ?: return@runOnUiThread
                    wrap.removeAllViews()
                    wrap.addView(errorRow("加载失败,点击重试") { loadTrend() })
                }
            }
        }
    }

    private fun renderTrend(done: IntArray, sumDone: Int, sumCreated: Int, monthly: IntArray,
                            endD: LocalDate = LocalDate.now()) {
        val wrap = trendScroll.getChildAt(0) as? LinearLayout ?: return
        wrap.removeAllViews()
        wrap.addView(sectionHeader("统计"))

        // 概览hero
        val hero = LinearLayout(this)
        hero.orientation = LinearLayout.VERTICAL
hero.background = roundedSolid(PRIMARY_SOFT, 20f)
        hero.setPadding(dp(18), dp(14), dp(18), dp(14))
        val big = TextView(this)
        big.text = "$sumDone"
        big.textSize = 34f
        big.typeface = Typeface.DEFAULT_BOLD
        big.setTextColor(PRIMARY)
        hero.addView(big)
        val sub = TextView(this)
        val rate = (if (sumCreated > 0) sumDone * 100 / sumCreated else 0).coerceIn(0, 100)
        sub.text = "近30天完成 · 新建 $sumCreated · 完成率 $rate%"
        sub.textSize = 11f
        sub.setTextColor(INK2)
        hero.addView(sub)
        wrap.addView(hero, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val t1 = TextView(this)
        t1.text = "近30天完成热力"
        t1.textSize = 13f
        t1.typeface = Typeface.DEFAULT_BOLD
        t1.setTextColor(INK)
        wrap.addView(t1, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.topMargin = dp(14); it.bottomMargin = dp(6)
        })
        val chartRow = LinearLayout(this)
        chartRow.orientation = LinearLayout.HORIZONTAL
        chartRow.gravity = Gravity.CENTER_VERTICAL
        val chart = HeatmapChart(this, done, endD)
        chart.background = roundedStroke()
        chartRow.addView(chart, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val sumL = LinearLayout(this)
        sumL.orientation = LinearLayout.VERTICAL
        val nz = done.filter { it > 0 }
        val avg = "%.1f".format(done.sum() / 30f)
        val best = done.maxOrNull() ?: 0
        val week = done.takeLast(7).sum()
        for (pair in listOf("日均" to avg, "最佳" to "$best", "本周" to "$week")) {
            val l = TextView(this)
            l.text = pair.second
            l.textSize = 15f; l.typeface = Typeface.DEFAULT_BOLD; l.setTextColor(PRIMARY)
            l.gravity = Gravity.CENTER
            sumL.addView(l, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            val cap = TextView(this)
            cap.text = pair.first
            cap.textSize = 9f; cap.setTextColor(INK3)
            cap.gravity = Gravity.CENTER
            sumL.addView(cap, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(4) })
        }
        chartRow.addView(sumL, LinearLayout.LayoutParams(dp(96), LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(12) })
        wrap.addView(chartRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val t2 = TextView(this)
        t2.text = "${LocalDate.now().year}年 · 各月完成热力"
        t2.textSize = 13f
        t2.typeface = Typeface.DEFAULT_BOLD
        t2.setTextColor(INK)
        wrap.addView(t2, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.topMargin = dp(14); it.bottomMargin = dp(6)
        })
        // 12月热力格:色深=完成量
        val grid = LinearLayout(this)
        grid.orientation = LinearLayout.VERTICAL
        var row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        val maxM = (monthly.maxOrNull() ?: 0).coerceAtLeast(1)
        val curMonth = LocalDate.now().monthValue
        for (m in 1..12) {
            val cell = TextView(this)
            cell.text = "$m"
            cell.textSize = 12f
            cell.gravity = Gravity.CENTER
            cell.includeFontPadding = false
            val alpha = if (monthly[m] == 0) 0 else (monthly[m] * 255 / maxM).coerceIn(50, 235)
            cell.setTextColor(if (alpha > 140) Color.WHITE else INK)
            cell.background = GradientDrawable().also {
                it.setColor(Color.argb(if (alpha == 0) 30 else alpha,
                    Color.red(PRIMARY), Color.green(PRIMARY), Color.blue(PRIMARY)))
                it.cornerRadius = 10f * resources.displayMetrics.density
                if (m == curMonth) it.setStroke(dp(2), PRIMARY)
            }
            cell.setPadding(0, dp(16), 0, dp(16))
            row.addView(cell, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also {
                if (m % 3 > 1) it.marginStart = dp(5)
            })
            if (m % 3 == 0) {
                grid.addView(row, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
                    it.bottomMargin = dp(5)
                })
                row = LinearLayout(this)
                row.orientation = LinearLayout.HORIZONTAL
            }
        }
        wrap.addView(grid, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        val tip = hintRow("颜色越深当月完成越多,描边为当前月")
        wrap.addView(tip)
    }

    // ---------- 日历页(周/月/年) ----------

    private val CAL_WEEK_LABELS = arrayOf("一", "二", "三", "四", "五", "六", "日")

    private fun buildCalendarPage() {
        val root = LinearLayout(this)
        root.orientation = LinearLayout.VERTICAL
        root.setPadding(dp(16), dp(4), dp(16), dp(96))
        calendarScroll.addView(root, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))

        // 导航行 < 标题 > 今天
        val nav = LinearLayout(this)
        nav.orientation = LinearLayout.HORIZONTAL
        nav.gravity = Gravity.CENTER_VERTICAL
        root.addView(nav, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        fun navBtn(txt: String, onClick: () -> Unit): TextView {
            val b = TextView(this)
            b.text = txt
            b.textSize = 18f
            b.setTextColor(PRIMARY)
            b.gravity = Gravity.CENTER
            b.setPadding(dp(14), dp(4), dp(14), dp(4))
            b.setOnClickListener { onClick() }
            return b
        }
        nav.addView(navBtn("‹") { calStep(-1) }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        calTitle = TextView(this)
        calTitle.textSize = 17f
        calTitle.typeface = Typeface.DEFAULT_BOLD
        calTitle.setTextColor(INK)
        calTitle.gravity = Gravity.CENTER
        nav.addView(calTitle, LinearLayout.LayoutParams(0,
            LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        nav.addView(navBtn("›") { calStep(1) }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        val todayBtn = TextView(this)
        todayBtn.text = "今天"
        todayBtn.textSize = 11f
        todayBtn.typeface = Typeface.DEFAULT_BOLD
        todayBtn.setTextColor(PRIMARY)
        todayBtn.background = roundedSolid(PRIMARY_SOFT, 99f)
        todayBtn.setPadding(dp(12), dp(5), dp(12), dp(5))
        todayBtn.setOnClickListener {
            calAnchor = LocalDate.now(); calSelected = LocalDate.now(); loadCalendar()
        }
        nav.addView(todayBtn, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.marginStart = dp(6)
        })

        // 周/月/年 分段
        val seg = LinearLayout(this)
        seg.orientation = LinearLayout.HORIZONTAL
        seg.gravity = Gravity.CENTER
        root.addView(seg, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.topMargin = dp(10)
        })
        calSegBtns = Array(3) { i ->
            val tv = TextView(this)
            tv.text = arrayOf("周", "月", "年")[i]
            tv.textSize = 12f
            tv.typeface = Typeface.DEFAULT_BOLD
            tv.gravity = Gravity.CENTER
            tv.setPadding(dp(20), dp(6), dp(20), dp(6))
            tv.setOnClickListener {
                if (calMode != i) { calMode = i; loadCalendar() }
            }
            seg.addView(tv, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
                if (i > 0) it.marginStart = dp(8)
            })
            tv
        }

        // 维度内容(周条/月网格/年网格)
        calBody = LinearLayout(this)
        calBody.orientation = LinearLayout.VERTICAL
        root.addView(calBody, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.topMargin = dp(10)
        })

        // 选中日任务区
        calTaskHeader = TextView(this)
        calTaskHeader.textSize = 13f
        calTaskHeader.typeface = Typeface.DEFAULT_BOLD
        calTaskHeader.setTextColor(INK)
        root.addView(calTaskHeader, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.topMargin = dp(14); it.bottomMargin = dp(6)
        })
        calTaskList = LinearLayout(this)
        calTaskList.orientation = LinearLayout.VERTICAL
        root.addView(calTaskList, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }

    private fun calStep(dir: Int) {
        calAnchor = when (calMode) {
            0 -> calAnchor.plusWeeks(dir.toLong())
            1 -> calAnchor.plusMonths(dir.toLong())
            else -> calAnchor.plusYears(dir.toLong())
        }
        val range = calRange()
        if (calSelected < range.first || calSelected > range.second) calSelected = range.first
        loadCalendar()
    }

    private fun calRange(): Pair<LocalDate, LocalDate> = when (calMode) {
        0 -> {
            val mon = calAnchor.minusDays((calAnchor.dayOfWeek.value - 1).toLong())
            mon to mon.plusDays(6)
        }
        1 -> calAnchor.withDayOfMonth(1) to
            calAnchor.withDayOfMonth(calAnchor.lengthOfMonth())
        else -> calAnchor.withDayOfYear(1) to calAnchor.withDayOfYear(calAnchor.lengthOfYear())
    }

    /** 选日纯本地刷新:用已缓存数据重渲染,不重拉不闪loading */
    private fun refreshCalendarLocal() {
        calBody.removeAllViews()
        if (calMode == 0) renderCalWeek() else renderCalMonth()
        renderCalTasks(calDayTasks.filter { it.taskDate == calSelected.toString() })
    }

    /** 生活日历选日本地刷新 */
    private fun refreshLifeCalendarLocal() {
        renderLifeCalendar()
    }

    private fun loadCalendar() {
        ensurePage(2)
        calTitle.text = when (calMode) {
            0 -> "${calAnchor.monthValue}月${calRange().first.dayOfMonth}日 - ${calRange().second.monthValue}月${calRange().second.dayOfMonth}日"
            1 -> "${calAnchor.year}年${calAnchor.monthValue}月"
            else -> "${calAnchor.year}年"
        }
        for (i in calSegBtns.indices) {
            val on = i == calMode
            calSegBtns[i].setTextColor(if (on) PRIMARY else INK3)
            calSegBtns[i].background = if (on) roundedSolid(PRIMARY_SOFT, 99f) else roundedSolid(SURFACE, 99f)
        }
        thread { // 数据到达前保留旧画面,不闪loading
            
            try {
                if (calMode == 2) {
                    val y = calAnchor.year
                    val resp = ApiClient.get("/stats/range?from=$y-01-01&to=$y-12-31")
                    if (!resp.ok) throw RuntimeException("HTTP ${resp.code}")
                    val monthly = Array(13) { IntArray(2) }
                    val days = JSONObject(resp.body).optJSONArray("days") ?: JSONArray()
                    for (i in 0 until days.length()) {
                        val d = days.optJSONObject(i) ?: continue
                        val m = try { LocalDate.parse(d.optString("date")).monthValue } catch (e: Exception) { 0 }
                        if (m in 1..12) {
                            monthly[m][0] += d.optInt("created", 0)
                            monthly[m][1] += d.optInt("completed", 0)
                        }
                    }
                    runOnUiThread { renderCalYear(monthly) }
                } else {
                    val (f, t) = calRange()
                    val resp = ApiClient.get("/tasks?from=$f&to=$t")
                    if (!resp.ok) throw RuntimeException("HTTP ${resp.code}")
                    val tasks = parseTasks(JSONArray(resp.body))
                    calDayCounts.clear()
                    for (task in tasks) {
                        val d = task.taskDate ?: continue
                        val c = calDayCounts.getOrPut(d) { IntArray(2) }
                        c[0]++
                        if (!task.done) c[1]++
                    }
                    runOnUiThread {
                        if (calMode == 0) renderCalWeek() else renderCalMonth()
                        renderCalTasks(tasks.filter { it.taskDate == calSelected.toString() })
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    calTaskHeader.text = "加载失败,点击重试"
                    calTaskHeader.setOnClickListener { loadCalendar() }
                }
            }
        }
    }

    /** 周:7列日条 */
    private fun renderCalWeek() {
        calBody.removeAllViews()
        val row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        val (f, t) = calRange()
        var d = f
        val today = LocalDate.now()
        while (d <= t) {
            val dd = d
            val col = LinearLayout(this)
            col.orientation = LinearLayout.VERTICAL
            col.gravity = Gravity.CENTER_HORIZONTAL
            col.setPadding(0, dp(8), 0, dp(8))
            val sel = dd == calSelected
            col.background = if (sel) roundedSolid(PRIMARY_SOFT, 12f) else null
            val wk = TextView(this)
            wk.text = CAL_WEEK_LABELS[dd.dayOfWeek.value - 1]
            wk.textSize = 10f
            wk.setTextColor(if (dd == today) PRIMARY else INK3)
            wk.gravity = Gravity.CENTER
            col.addView(wk)
            val num = TextView(this)
            num.text = dd.dayOfMonth.toString()
            num.textSize = 15f
            num.typeface = if (dd == today) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            num.setTextColor(if (dd == today) PRIMARY else INK)
            num.gravity = Gravity.CENTER
            col.addView(num)
            val cnt = calDayCounts[dd.toString()]
            val pb = TextView(this)
            pb.text = if (cnt != null && cnt[1] > 0) cnt[1].toString() else ""
            pb.textSize = 9f
            pb.setTextColor(0xFFEA580C.toInt())
            pb.gravity = Gravity.CENTER
            col.addView(pb)
            col.setOnClickListener {
                calSelected = dd
                refreshCalendarLocal()
            }
            row.addView(col, LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            d = d.plusDays(1)
        }
        calBody.addView(row, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }

    /** 月:7列网格 */
    private fun renderCalMonth() {
        calBody.removeAllViews()
        val grid = LinearLayout(this)
        grid.orientation = LinearLayout.VERTICAL
        val head = LinearLayout(this)
        head.orientation = LinearLayout.HORIZONTAL
        for (w in CAL_WEEK_LABELS) {
            val tv = TextView(this)
            tv.text = w
            tv.textSize = 10f
            tv.setTextColor(INK3)
            tv.gravity = Gravity.CENTER
            head.addView(tv, LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        }
        grid.addView(head, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        val first = calAnchor.withDayOfMonth(1)
        val lead = first.dayOfWeek.value - 1
        val days = calAnchor.lengthOfMonth()
        val today = LocalDate.now()
        var row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        for (i in 0 until lead) {
            val sp = View(this)
            row.addView(sp, LinearLayout.LayoutParams(0, dp(44), 1f))
        }
        for (day in 1..days) {
            val dd = first.plusDays((day - 1).toLong())
            val cell = LinearLayout(this)
            cell.orientation = LinearLayout.VERTICAL
            cell.gravity = Gravity.CENTER
            val sel = dd == calSelected
            val bg = GradientDrawable()
            bg.setColor(if (sel) PRIMARY_SOFT else Color.TRANSPARENT)
            bg.cornerRadius = 10f * resources.displayMetrics.density
            if (dd == today && !sel) bg.setStroke(dp(1), PRIMARY)
            cell.background = bg
            val num = TextView(this)
            num.text = day.toString()
            num.textSize = 13f
            num.typeface = if (dd == today) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            num.setTextColor(if (dd == today) PRIMARY else INK)
            num.gravity = Gravity.CENTER
            num.includeFontPadding = false
            cell.addView(num, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            val cnt = calDayCounts[dd.toString()]
            val dot = View(this)
            dot.background = circleSolid(if (cnt != null && cnt[1] > 0) 0xFFEA580C.toInt() else Color.TRANSPARENT)
            cell.addView(dot, LinearLayout.LayoutParams(dp(4), dp(4)).also { it.topMargin = dp(3) })
            cell.setOnClickListener {
                calSelected = dd
                refreshCalendarLocal()
            }
            row.addView(cell, LinearLayout.LayoutParams(0, dp(44), 1f).also { it.topMargin = dp(2) })
            if ((lead + day) % 7 == 0) {
                grid.addView(row, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
                row = LinearLayout(this)
                row.orientation = LinearLayout.HORIZONTAL
            }
        }
        // 末行补空占位:日子按周列对齐,不均分整行
        val tail = (7 - (lead + days) % 7) % 7
        for (k in 0 until tail) {
            row.addView(View(this), LinearLayout.LayoutParams(0, dp(44), 1f).also { it.topMargin = dp(2) })
        }
        grid.addView(row, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        calBody.addView(grid, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }

    /** 年:12个月卡片 */
    private fun renderCalYear(monthly: Array<IntArray>) {
        calBody.removeAllViews()
        val grid = LinearLayout(this)
        grid.orientation = LinearLayout.VERTICAL
        val today = LocalDate.now()
        var row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        var col = 0
        for (m in 1..12) {
            val cell = LinearLayout(this)
            cell.orientation = LinearLayout.VERTICAL
            cell.gravity = Gravity.CENTER
            cell.setPadding(0, dp(8), 0, dp(8))
            cell.minimumHeight = dp(56)
            val thisMonth = calAnchor.year == today.year && m == today.monthValue
            cell.background = if (thisMonth) roundedStrokeColored(PRIMARY) else roundedStroke()
            val name = TextView(this)
            name.text = "${m}月"
            name.textSize = 13f
            name.typeface = Typeface.DEFAULT_BOLD
            name.setTextColor(if (thisMonth) PRIMARY else INK)
            name.gravity = Gravity.CENTER
            name.includeFontPadding = false
            cell.addView(name, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            val stat = monthly[m]
            val sub = TextView(this)
            sub.text = "成${stat[1]} · 建${stat[0]}"
            sub.textSize = 9f
            sub.setTextColor(INK3)
            sub.gravity = Gravity.CENTER
            sub.includeFontPadding = false
            cell.addView(sub, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
                it.topMargin = dp(3)
            })
            val mm = m
            cell.setOnClickListener {
                calMode = 1
                calAnchor = calAnchor.withMonth(mm).withDayOfMonth(1)
                calSelected = if (today.year == calAnchor.year && today.monthValue == mm) today
                else calAnchor.withDayOfMonth(1)
                loadCalendar()
            }
            val lp = LinearLayout.LayoutParams(0, dp(58), 1f)
            if (col % 3 > 0) lp.marginStart = dp(8)
            row.addView(cell, lp)
            col++
            if (col % 3 == 0) {
                grid.addView(row, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
                    it.bottomMargin = dp(8)
                })
                row = LinearLayout(this)
                row.orientation = LinearLayout.HORIZONTAL
            }
        }
        calBody.addView(grid, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        calTaskHeader.text = "${calAnchor.year}年 · 点击月份查看"
        calTaskList.removeAllViews()
    }

    /** 选中日任务列表(简版行,点击切换完成) */
    private fun renderCalTasks(tasks: List<Task>) {
        calDayTasks.clear()
        calDayTasks.addAll(tasks)
        val wd = CAL_WEEK_LABELS[calSelected.dayOfWeek.value - 1]
        val pend = tasks.count { !it.done }
        calTaskHeader.text = "${calSelected.monthValue}月${calSelected.dayOfMonth}日 周$wd · 待办 $pend"
        calTaskList.removeAllViews()
        if (tasks.isEmpty()) {
            calTaskList.addView(hintRow("这一天没有任务 🍃"))
            return
        }
        for (t in tasks) {
            val c = qColor(t.quadrant)
            val row = LinearLayout(this)
            row.orientation = LinearLayout.HORIZONTAL
            row.gravity = Gravity.CENTER_VERTICAL
            row.setPadding(dp(10), dp(7), dp(10), dp(7))
            row.background = ripple(cardBg())
            val check = TextView(this)
            check.text = if (t.done) "✓" else ""
            check.textSize = 10f
            check.setTextColor(0xFFFFFFFF.toInt())
            check.gravity = Gravity.CENTER
            check.includeFontPadding = false
            check.background = if (t.done) circleSolid(c) else circleRing(c)
            row.addView(check, LinearLayout.LayoutParams(dp(19), dp(19)))
            val title = TextView(this)
            title.text = t.title
            title.textSize = 12f
            title.maxLines = 1
            title.ellipsize = TextUtils.TruncateAt.END
            if (t.done) {
                title.paintFlags = title.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
                title.alpha = 0.55f
            }
            row.addView(title, LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also { it.marginStart = dp(8) })
            if (!t.description.isNullOrEmpty()) {
                val nicon = TextView(this)
                nicon.text = "📝"
                nicon.textSize = 10f
                row.addView(nicon, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginEnd = dp(6) })
            }
            val qtag = TextView(this)
            qtag.text = QUAD_SHORT[t.quadrant] ?: ""
            qtag.textSize = 9f
            qtag.typeface = Typeface.DEFAULT_BOLD
            qtag.setTextColor(c)
            qtag.background = tonalPill(c)
            qtag.setPadding(dp(6), dp(1), dp(6), dp(1))
            row.addView(qtag, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            row.tag = t
            row.setOnClickListener { v ->
                (v.tag as? Task)?.let { cur -> toggleCalTask(cur, v) }
            }
            calTaskList.addView(row, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
                it.bottomMargin = dp(5)
            })
        }
    }

    /** 日历页内勾选:原地改行样式,再静默刷新计数 */
    private fun toggleCalTask(t: Task, row: View) {
        val done = !t.done
        val title = (row as? LinearLayout)?.getChildAt(1) as? TextView
        val check = (row as? LinearLayout)?.getChildAt(0) as? TextView
        val c = qColor(t.quadrant)
        if (done) {
            check?.text = "✓"
            check?.background = circleSolid(c)
            title?.paintFlags = (title?.paintFlags ?: 0) or Paint.STRIKE_THRU_TEXT_FLAG
            title?.alpha = 0.55f
            row.alpha = 0.85f
        } else {
            check?.text = ""
            check?.background = circleRing(c)
            title?.paintFlags = (title?.paintFlags ?: 0) and Paint.STRIKE_THRU_TEXT_FLAG.inv()
            title?.alpha = 1f
        }
        row.tag = Task(t.id, t.title, t.description, t.categoryName, t.categoryColor,
            t.quadrant, done, t.migratedCount, t.originalDate, t.daysProcrastinated,
            t.revision, t.notifyEnabled, t.notifyTime, t.notifyChannels, t.taskDate)
        thread {
            try {
                val path = if (done) "/tasks/${t.id}/complete" else "/tasks/${t.id}/reopen"
                ApiClient.post(path, JSONObject())
                loadCalendarCountsOnly()
            } catch (e: Exception) {
                runOnUiThread { loadCalendar() }
            }
        }
    }

    /** 勾选后仅刷新计数与头部,不重绘列表 */
    private fun loadCalendarCountsOnly() {
        if (calMode == 2) return
        thread {
            try {
                val (f, t) = calRange()
                val resp = ApiClient.get("/tasks?from=$f&to=$t")
                if (!resp.ok) return@thread
                val tasks = parseTasks(JSONArray(resp.body))
                calDayCounts.clear()
                for (task in tasks) {
                    val d = task.taskDate ?: continue
                    val cc = calDayCounts.getOrPut(d) { IntArray(2) }
                    cc[0]++
                    if (!task.done) cc[1]++
                }
                runOnUiThread {
                    if (calMode == 0) renderCalWeek() else renderCalMonth()
                    val pend = tasks.count { it.taskDate == calSelected.toString() && !it.done }
                    val wd = CAL_WEEK_LABELS[calSelected.dayOfWeek.value - 1]
                    calTaskHeader.text = "${calSelected.monthValue}月${calSelected.dayOfMonth}日 周$wd · 待办 $pend"
                }
            } catch (e: Exception) { }
        }
    }

    // ---------- 规律生活独立体系 ----------

    /** 生活域骨架:首次进入时构建(冷启动不付成本) */
    private fun buildLifeSkeleton() {
        lifeRoot = LinearLayout(this)
        lifeRoot.orientation = LinearLayout.VERTICAL
        lifeRoot.visibility = View.GONE
        // 插在dock之前,保持主体区位于顶栏与底栏之间
        mainFrame.addView(lifeRoot, mainFrame.indexOfChild(dockBar), LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

    // 返回 + 五段tab
    val lifeNav = LinearLayout(this)
    lifeNav.orientation = LinearLayout.HORIZONTAL
    lifeNav.gravity = Gravity.CENTER_VERTICAL
    lifeNav.setPadding(dp(12), dp(6), dp(12), 0)
    lifeRoot.addView(lifeNav, LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    val backBtn = TextView(this)
    backBtn.text = "‹ 工作台"
    backBtn.textSize = 13f
    backBtn.typeface = Typeface.DEFAULT_BOLD
    backBtn.setTextColor(PRIMARY)
    backBtn.setPadding(dp(6), dp(4), dp(6), dp(4))
    backBtn.setOnClickListener { exitLife() }
    lifeNav.addView(backBtn, LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    val navSpacer = View(this)
    lifeNav.addView(navSpacer, LinearLayout.LayoutParams(0, 1, 1f))
    lifeSegBtns = Array(5) { i ->
        val tv = TextView(this)
        tv.text = arrayOf("今日", "日历", "回顾", "统计", "设置")[i]
        tv.textSize = 12f
        tv.typeface = Typeface.DEFAULT_BOLD
        tv.gravity = Gravity.CENTER
        tv.setPadding(dp(14), dp(6), dp(14), dp(6))
        tv.setOnClickListener {
            if (lifeTab != i) { lifeTab = i; lifeLoad() }
        }
        lifeNav.addView(tv, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            if (i > 0) it.marginStart = dp(4)
        })
        tv
    }

    val lifeScroll = ScrollView(this)
    lifeScroll.overScrollMode = View.OVER_SCROLL_NEVER
    lifeRoot.addView(lifeScroll, LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
    lifeBody = LinearLayout(this)
    lifeBody.orientation = LinearLayout.VERTICAL
    lifeBody.setPadding(dp(16), dp(6), dp(16), dp(48))
    lifeScroll.addView(lifeBody, FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))


    }

    private fun enterLife() {
        if (inLife) return
        if (!::lifeRoot.isInitialized) buildLifeSkeleton()
        inLife = true
        titleText.text = "规律生活"
        dateText.text = ""
        pageFrame.visibility = View.GONE
        dockBar.visibility = View.GONE
        streakText.visibility = View.GONE
        badge.visibility = View.GONE
        lifeRoot.visibility = View.VISIBLE
        lifeLoad()
    }

    private fun exitLife() {
        if (!inLife) return
        inLife = false
        lifeRoot.visibility = View.GONE
        // 直接恢复页面可见性(selectPage有同页guard,页面此前被enterLife隐藏)
        pageFrame.visibility = View.VISIBLE
        for (idx in 0..5) {
            if (pageBuilt(idx)) pageAt(idx).visibility = if (idx == currentPage) View.VISIBLE else View.GONE
        }
        titleText.text = when (currentPage) {
            1 -> "待办"; 2 -> "日历"; 3 -> "总结"; 4 -> "统计"; 5 -> "设置"; else -> "今日"
        }
        dockBar.visibility = View.VISIBLE
        refresh() // renderBoard恢复日期/连胜/徽标
    }

    private fun lifeLoad() {
        for (i in lifeSegBtns.indices) {
            val on = i == lifeTab
            lifeSegBtns[i].setTextColor(if (on) PRIMARY else INK3)
            lifeSegBtns[i].background = if (on) roundedSolid(PRIMARY_SOFT, 99f) else null
        }
        lifeBody.removeAllViews()
        when (lifeTab) {
            0 -> lifeLoadToday()
            1 -> lifeLoadCalendar()
            2 -> lifeLoadReview()
            3 -> lifeLoadLifeStats()
            else -> lifeLoadPlans()
        }
    }

    private fun catColorOf(id: String?): Int {
        val c = categories.firstOrNull { it.id == id }
        return c?.color ?: 0xFF94A3B8.toInt()
    }

    private fun catNameOf(id: String?): String {
        val c = categories.firstOrNull { it.id == id }
        return c?.name ?: "未分类"
    }

    private fun parseLifeTask(o: JSONObject): Task {
        fun clean(x: String?) = if (x.isNullOrEmpty() || x == "null") null else x
        return Task(
            id = o.optString("id"), title = o.optString("title"),
            description = null, categoryName = null, categoryColor = null,
            quadrant = 0, done = o.optString("status") == "done",
            migratedCount = 0, originalDate = null, daysProcrastinated = 0,
            revision = o.optInt("revision", 0),
            taskDate = clean(o.optString("task_date")),
            completionNote = clean(o.optString("completion_note")))
    }

    // ----- 生活·今日(打卡) -----

    private fun lifeLoadToday() {
        // 日期导航
        val nav = LinearLayout(this)
        nav.orientation = LinearLayout.HORIZONTAL
        nav.gravity = Gravity.CENTER_VERTICAL
        lifeBody.addView(nav, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        fun navBtn(txt: String, onClick: () -> Unit): TextView {
            val b = TextView(this); b.text = txt; b.textSize = 17f
            b.setTextColor(PRIMARY); b.gravity = Gravity.CENTER
            b.setPadding(dp(14), dp(4), dp(14), dp(4)); b.setOnClickListener { onClick() }
            return b
        }
        nav.addView(navBtn("‹") { lifeDate = lifeDate.minusDays(1); lifeLoad() }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        val dt = TextView(this)
        dt.text = "${lifeDate.monthValue}月${lifeDate.dayOfMonth}日 " +
            arrayOf("一", "二", "三", "四", "五", "六", "日")[lifeDate.dayOfWeek.value - 1].let { "周$it" }
        dt.textSize = 16f; dt.typeface = Typeface.DEFAULT_BOLD; dt.setTextColor(INK)
        dt.gravity = Gravity.CENTER
        nav.addView(dt, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        nav.addView(navBtn("›") { lifeDate = lifeDate.plusDays(1); lifeLoad() }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        val todayBtn = TextView(this)
        todayBtn.text = "今天"; todayBtn.textSize = 11f; todayBtn.typeface = Typeface.DEFAULT_BOLD
        todayBtn.setTextColor(PRIMARY); todayBtn.background = roundedSolid(PRIMARY_SOFT, 99f)
        todayBtn.setPadding(dp(12), dp(5), dp(12), dp(5))
        todayBtn.setOnClickListener { lifeDate = LocalDate.now(); lifeLoad() }
        nav.addView(todayBtn, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(6) })

        lifeBody.addView(loadingRow())
        thread {
            try {
                val resp = ApiClient.get("/plans/today?date=$lifeDate")
                if (!resp.ok) throw RuntimeException(resp.detail() ?: "HTTP ${resp.code}")
                val root = JSONObject(resp.body)
                val items = root.optJSONArray("items") ?: JSONArray()
                runOnUiThread { renderLifeToday(items) }
            } catch (e: Exception) {
                runOnUiThread {
                    lifeBody.removeAllViews()
                    lifeBody.addView(errorRow("加载失败,点击重试") { lifeLoad() })
                }
            }
        }
    }

    private fun renderLifeToday(items: JSONArray) {
        if (lifeTab != 0) return
        lifeBody.removeAllViews()
        var total = 0; var doneN = 0
        for (i in 0 until items.length()) {
            val it2 = items.optJSONObject(i) ?: continue
            total++
            if (it2.optJSONObject("task")?.optString("status") == "done") doneN++
        }
        val head = TextView(this)
        head.text = "安排 $total · 已完成 $doneN"
        head.textSize = 12f; head.typeface = Typeface.DEFAULT_BOLD; head.setTextColor(INK2)
        lifeBody.addView(head, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.topMargin = dp(8); it.bottomMargin = dp(6)
        })
        if (total == 0) {
            lifeBody.addView(hintRow("这一天没有计划安排 🍃"))
            return
        }
        for (i in 0 until items.length()) {
            val it2 = items.optJSONObject(i) ?: continue
            val plan = it2.optJSONObject("plan") ?: continue
            val task = it2.optJSONObject("task")
            val c = catColorOf(plan.optString("category_id"))
            val done = task?.optString("status") == "done"
            val row = LinearLayout(this)
            row.orientation = LinearLayout.HORIZONTAL
            row.gravity = Gravity.CENTER_VERTICAL
            row.setPadding(dp(10), dp(8), dp(10), dp(8))
            row.background = ripple(cardBg())
            val check = TextView(this)
            check.text = if (done) "✓" else ""
            check.textSize = 10f; check.setTextColor(0xFFFFFFFF.toInt())
            check.gravity = Gravity.CENTER; check.includeFontPadding = false
            check.background = if (done) circleSolid(c) else circleRing(c)
            row.addView(check, LinearLayout.LayoutParams(dp(19), dp(19)))
            val mid = LinearLayout(this)
            mid.orientation = LinearLayout.VERTICAL
            val title = TextView(this)
            title.text = plan.optString("title")
            title.textSize = 13f; title.setTextColor(INK); title.maxLines = 1
            title.ellipsize = TextUtils.TruncateAt.END
            if (done) title.paintFlags = title.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
            mid.addView(title, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            val cn = task?.optString("completion_note")
            if (done && !cn.isNullOrEmpty() && cn != "null") {
                val note = TextView(this)
                note.text = "📝 $cn"
                note.textSize = 9f; note.setTextColor(INK3); note.maxLines = 1
                note.ellipsize = TextUtils.TruncateAt.END
                mid.addView(note, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            } else {
                val rule = TextView(this)
                rule.text = "${plan.optString("rule_text")} · ${catNameOf(plan.optString("category_id"))}"
                rule.textSize = 9f; rule.setTextColor(INK3)
                mid.addView(rule, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            }
            row.addView(mid, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also {
                it.marginStart = dp(8)
            })
            if (task != null) {
                val tid = task.optString("id")
                val tDone = done
                row.setOnClickListener {
                    if (tDone) {
                        thread {
                            try {
                                ApiClient.post("/tasks/$tid/reopen", JSONObject())
                                runOnUiThread { lifeLoad() }
                            } catch (e: Exception) { runOnUiThread { lifeLoad() } }
                        }
                    } else {
                        showCompleteNoteDialog(parseLifeTask(task)) { note ->
                            thread {
                                try {
                                    val body = JSONObject()
                                    if (!note.isNullOrEmpty()) body.put("note", note)
                                    ApiClient.post("/tasks/$tid/complete", body)
                                } catch (e: Exception) { }
                                runOnUiThread { lifeLoad() }
                            }
                        }
                    }
                }
            }
            lifeBody.addView(row, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
                it.bottomMargin = dp(5)
            })
        }
    }

    // ----- 生活·日历(月网格 done/total) -----

    private fun lifeLoadCalendar() {
        val nav = LinearLayout(this)
        nav.orientation = LinearLayout.HORIZONTAL
        nav.gravity = Gravity.CENTER_VERTICAL
        lifeBody.addView(nav, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        fun navBtn(txt: String, onClick: () -> Unit): TextView {
            val b = TextView(this); b.text = txt; b.textSize = 17f
            b.setTextColor(PRIMARY); b.gravity = Gravity.CENTER
            b.setPadding(dp(14), dp(4), dp(14), dp(4)); b.setOnClickListener { onClick() }
            return b
        }
        nav.addView(navBtn("‹") { lifeCalAnchor = lifeCalAnchor.minusMonths(1); lifeLoad() }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        val mt = TextView(this)
        mt.text = "${lifeCalAnchor.year}年${lifeCalAnchor.monthValue}月"
        mt.textSize = 16f; mt.typeface = Typeface.DEFAULT_BOLD; mt.setTextColor(INK); mt.gravity = Gravity.CENTER
        nav.addView(mt, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        nav.addView(navBtn("›") { lifeCalAnchor = lifeCalAnchor.plusMonths(1); lifeLoad() }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        thread { // 数据到达前保留旧画面
            try {
                val f = lifeCalAnchor.withDayOfMonth(1)
                val t = lifeCalAnchor.withDayOfMonth(lifeCalAnchor.lengthOfMonth())
                val resp = ApiClient.get("/tasks?plan_only=true&status=all&from=$f&to=$t")
                if (!resp.ok) throw RuntimeException(resp.detail() ?: "HTTP ${resp.code}")
                val arr = JSONArray(resp.body)
                lifeCalCounts.clear()
                lifeCalTasks.clear()
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val tk = parseLifeTask(o)
                    lifeCalTasks.add(tk)
                    val d = tk.taskDate ?: continue
                    val cc = lifeCalCounts.getOrPut(d) { IntArray(2) }
                    cc[1]++
                    if (tk.done) cc[0]++
                }
                runOnUiThread { renderLifeCalendar() }
            } catch (e: Exception) {
                runOnUiThread {
                    lifeBody.removeAllViews()
                    lifeBody.addView(errorRow("加载失败,点击重试") { lifeLoad() })
                }
            }
        }
    }

    private fun renderLifeCalendar() {
        if (lifeTab != 1) return
        lifeBody.removeAllViews()
        val grid = LinearLayout(this)
        grid.orientation = LinearLayout.VERTICAL
        val head = LinearLayout(this)
        head.orientation = LinearLayout.HORIZONTAL
        for (w in CAL_WEEK_LABELS) {
            val tv = TextView(this); tv.text = w; tv.textSize = 10f
            tv.setTextColor(INK3); tv.gravity = Gravity.CENTER
            head.addView(tv, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        }
        grid.addView(head, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        val first = lifeCalAnchor.withDayOfMonth(1)
        val lead = first.dayOfWeek.value - 1
        val days = lifeCalAnchor.lengthOfMonth()
        val today = LocalDate.now()
        var row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        for (i in 0 until lead) {
            row.addView(View(this), LinearLayout.LayoutParams(0, dp(52), 1f))
        }
        for (day in 1..days) {
            val dd = first.plusDays((day - 1).toLong())
            val cell = LinearLayout(this)
            cell.orientation = LinearLayout.VERTICAL
            cell.gravity = Gravity.CENTER
            val sel = dd == lifeCalSelected
            val bg = GradientDrawable()
            bg.setColor(if (sel) PRIMARY_SOFT else Color.TRANSPARENT)
            bg.cornerRadius = 10f * resources.displayMetrics.density
            if (dd == today && !sel) bg.setStroke(dp(1), PRIMARY)
            cell.background = bg
            val num = TextView(this)
            num.text = day.toString()
            num.textSize = 13f
            num.typeface = if (dd == today) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            num.setTextColor(if (dd == today) PRIMARY else INK)
            num.gravity = Gravity.CENTER; num.includeFontPadding = false
            cell.addView(num, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            val cc = lifeCalCounts[dd.toString()]
            val badgeTv = TextView(this)
            if (cc != null && cc[1] > 0 && cc[0] > 0) {
                badgeTv.text = "${cc[0]}/${cc[1]}"
                badgeTv.textSize = 8f
                badgeTv.setTextColor(if (cc[0] >= cc[1]) 0xFF16A34A.toInt() else 0xFFB45309.toInt())
            }
            badgeTv.gravity = Gravity.CENTER; badgeTv.includeFontPadding = false
            cell.addView(badgeTv, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(2) })
            cell.setOnClickListener { lifeCalSelected = dd; refreshLifeCalendarLocal() }
            row.addView(cell, LinearLayout.LayoutParams(0, dp(52), 1f).also { it.topMargin = dp(2) })
            if ((lead + day) % 7 == 0) {
                grid.addView(row, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
                row = LinearLayout(this); row.orientation = LinearLayout.HORIZONTAL
            }
        }
        val tailL = (7 - (lead + days) % 7) % 7
        for (k in 0 until tailL) {
            row.addView(View(this), LinearLayout.LayoutParams(0, dp(52), 1f).also { it.topMargin = dp(2) })
        }
        grid.addView(row, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        lifeBody.addView(grid, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        // 选中日实例列表
        val selTasks = lifeCalTasks.filter { it.taskDate == lifeCalSelected.toString() }
        val hd = TextView(this)
        hd.text = "${lifeCalSelected.monthValue}月${lifeCalSelected.dayOfMonth}日 · ${selTasks.count { it.done }}/${selTasks.size} 完成"
        hd.textSize = 12f; hd.typeface = Typeface.DEFAULT_BOLD; hd.setTextColor(INK2)
        lifeBody.addView(hd, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.topMargin = dp(12); it.bottomMargin = dp(6)
        })
        if (selTasks.isEmpty()) lifeBody.addView(hintRow("这一天没有计划实例"))
        for (tk in selTasks) {
            val row = LinearLayout(this)
            row.orientation = LinearLayout.HORIZONTAL
            row.gravity = Gravity.CENTER_VERTICAL
            row.setPadding(dp(12), dp(10), dp(12), dp(10))
            row.background = ripple(cardBg())
            val check = TextView(this)
            check.text = if (tk.done) "✓" else ""
            check.textSize = 10f
            check.setTextColor(0xFFFFFFFF.toInt())
            check.gravity = Gravity.CENTER
            check.includeFontPadding = false
            check.background = if (tk.done) circleSolid(PRIMARY) else circleRing(PRIMARY)
            row.addView(check, LinearLayout.LayoutParams(dp(19), dp(19)))
            val mid = LinearLayout(this)
            mid.orientation = LinearLayout.VERTICAL
            val t1 = TextView(this)
            t1.text = tk.title
            t1.textSize = 14f
            t1.setTextColor(if (tk.done) INK3 else INK)
            if (tk.done) t1.paintFlags = t1.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
            mid.addView(t1, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            if (!tk.completionNote.isNullOrEmpty()) {
                val t2 = TextView(this)
                t2.text = "备注 · ${tk.completionNote}"
                t2.textSize = 11f
                t2.setTextColor(INK3)
                t2.maxLines = 1
                t2.ellipsize = TextUtils.TruncateAt.END
                mid.addView(t2, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            }
            row.addView(mid, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also {
                it.marginStart = dp(10)
            })
            lifeBody.addView(row, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
                it.bottomMargin = dp(6)
            })
        }
    }

    // ----- 生活·回顾(7/30天) -----

    private fun lifeLoadReview() {
        val seg = LinearLayout(this)
        seg.orientation = LinearLayout.HORIZONTAL
        seg.gravity = Gravity.CENTER
        lifeBody.addView(seg, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        for (d in intArrayOf(7, 30)) {
            val tv = TextView(this)
            tv.text = "近${d}天"
            tv.textSize = 12f; tv.typeface = Typeface.DEFAULT_BOLD
            tv.gravity = Gravity.CENTER
            tv.setPadding(dp(18), dp(5), dp(18), dp(5))
            tv.setTextColor(if (reviewDays == d) PRIMARY else INK3)
            tv.background = if (reviewDays == d) roundedSolid(PRIMARY_SOFT, 99f) else null
            tv.setOnClickListener { reviewDays = d; lifeLoad() }
            seg.addView(tv, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
                it.marginStart = if (d == 30) dp(8) else 0
            })
        }
        lifeBody.addView(loadingRow())
        thread {
            try {
                val resp = ApiClient.get("/plans/report?days=$reviewDays")
                if (!resp.ok) throw RuntimeException(resp.detail() ?: "HTTP ${resp.code}")
                runOnUiThread { renderLifeReview(JSONObject(resp.body)) }
            } catch (e: Exception) {
                runOnUiThread {
                    lifeBody.removeAllViews()
                    lifeBody.addView(errorRow("加载失败,点击重试") { lifeLoad() })
                }
            }
        }
    }

    private fun renderLifeReview(root: JSONObject) {
        if (lifeTab != 2) return
        lifeBody.removeAllViews()
        val plans = root.optJSONArray("plans") ?: JSONArray()
        if (plans.length() == 0) {
            lifeBody.addView(hintRow("还没有计划,去「设置」建一个 🌱"))
            return
        }
        for (i in 0 until plans.length()) {
            val o = plans.optJSONObject(i) ?: continue
            val plan = o.optJSONObject("plan") ?: continue
            val c = catColorOf(plan.optString("category_id"))
            val card = cardItem()
            // 标题行
            val head = LinearLayout(this)
            head.orientation = LinearLayout.HORIZONTAL
            head.gravity = Gravity.CENTER_VERTICAL
            card.addView(head, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            val dot = View(this)
            dot.background = circleSolid(c)
            head.addView(dot, LinearLayout.LayoutParams(dp(8), dp(8)).also { it.marginEnd = dp(7) })
            val name = TextView(this)
            name.text = plan.optString("title")
            name.textSize = 14f; name.typeface = Typeface.DEFAULT_BOLD; name.setTextColor(INK)
            head.addView(name, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            val streak = TextView(this)
            val sN = o.optInt("current_streak")
            streak.text = "连续 $sN 天"
            streak.textSize = 11f; streak.typeface = Typeface.DEFAULT_BOLD
            streak.setTextColor(if (sN > 0) 0xFFB45309.toInt() else INK3)
            streak.background = if (sN > 0) tonalPill(0xFFF59E0B.toInt()) else roundedSolid(0xFFEFEBE3.toInt(), 99f)
            streak.setPadding(dp(8), dp(3), dp(8), dp(3))
            head.addView(streak, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            // 完成率进度条(LinearLayout weight按比例,无需异步测量)
            val rateRow = LinearLayout(this)
            rateRow.orientation = LinearLayout.HORIZONTAL
            rateRow.gravity = Gravity.CENTER_VERTICAL
            card.addView(rateRow, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(8) })
            val rate = Math.round(o.optDouble("rate", 0.0) * 100).toInt().coerceIn(0, 100)
            val bar = LinearLayout(this)
            bar.orientation = LinearLayout.HORIZONTAL
            bar.background = roundedSolid(0xFFEDE8DF.toInt(), 99f)
            rateRow.addView(bar, LinearLayout.LayoutParams(0, dp(8), 1f).also { it.topMargin = dp(4) })
            if (rate > 0) {
                val fill = View(this)
                fill.background = roundedSolid(c, 99f)
                bar.addView(fill, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, rate.toFloat()))
            }
            val rest = View(this)
            bar.addView(rest, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, (100 - rate).toFloat()))
            val rateTv = TextView(this)
            rateTv.text = "$rate%"
            rateTv.textSize = 12f; rateTv.typeface = Typeface.DEFAULT_BOLD; rateTv.setTextColor(c)
            rateRow.addView(rateTv, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(8) })
            // 指标行
            val meta = TextView(this)
            val last = o.optString("last_done")
            meta.text = "完成 ${o.optInt("completed")}/${o.optInt("scheduled")} · 错过 ${o.optInt("missed")} · " +
                "最佳连续 ${o.optInt("best_streak")} · 上次 ${if (last.isNullOrEmpty() || last == "null") "—" else last.take(10)}"
            meta.textSize = 10f; meta.setTextColor(INK3)
            card.addView(meta, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(6) })
            lifeBody.addView(card)
        }
    }

    // ----- 生活·统计 -----

    private fun lifeLoadLifeStats() {
        lifeBody.addView(loadingRow())
        thread {
            try {
                val resp = ApiClient.get("/plans/report?days=30")
                if (!resp.ok) throw RuntimeException(resp.detail() ?: "HTTP ${resp.code}")
                runOnUiThread { renderLifeStats(JSONObject(resp.body)) }
            } catch (e: Exception) {
                runOnUiThread {
                    lifeBody.removeAllViews()
                    lifeBody.addView(errorRow("加载失败,点击重试") { lifeLoad() })
                }
            }
        }
    }

    private fun renderLifeStats(root: JSONObject) {
        if (lifeTab != 3) return
        lifeBody.removeAllViews()
        val plans = root.optJSONArray("plans") ?: JSONArray()
        var sumDone = 0; var sumSched = 0; var bestStreak = 0
        for (i in 0 until plans.length()) {
            val o = plans.optJSONObject(i) ?: continue
            sumDone += o.optInt("completed"); sumSched += o.optInt("scheduled")
            if (o.optInt("best_streak") > bestStreak) bestStreak = o.optInt("best_streak")
        }
        val rate = (if (sumSched > 0) sumDone * 100 / sumSched else 0).coerceIn(0, 100)
        // hero
        val hero = LinearLayout(this)
        hero.orientation = LinearLayout.VERTICAL
hero.background = roundedSolid(PRIMARY_SOFT, 20f)
        hero.setPadding(dp(18), dp(14), dp(18), dp(14))
        val big = TextView(this)
        big.text = "$sumDone"
        big.textSize = 34f; big.typeface = Typeface.DEFAULT_BOLD; big.setTextColor(PRIMARY)
        hero.addView(big)
        val sub = TextView(this)
        sub.text = "近30天打卡 · 安排 $sumSched · 完成率 $rate% · 最长连续 ${bestStreak}天"
        sub.textSize = 11f; sub.setTextColor(INK2)
        hero.addView(sub)
        lifeBody.addView(hero, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        // 趋势(安排vs完成 双色文字化条形:完成为主条)
        val t1 = TextView(this)
        t1.text = "近30天打卡热力"
        t1.textSize = 13f; t1.typeface = Typeface.DEFAULT_BOLD; t1.setTextColor(INK)
        lifeBody.addView(t1, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.topMargin = dp(14); it.bottomMargin = dp(6)
        })
        val trend = root.optJSONArray("trend") ?: JSONArray()
        val endL = try { LocalDate.parse(root.optString("end")) } catch (e: Exception) { serverToday }
        val doneArr = IntArray(30)
        for (i in 0 until trend.length()) {
            val d = trend.optJSONObject(i) ?: continue
            val idx = try { java.time.temporal.ChronoUnit.DAYS.between(
                LocalDate.parse(d.optString("date")), endL).toInt() } catch (e: Exception) { -1 }
            if (idx in 0..29) doneArr[29 - idx] = d.optInt("completed", 0)
        }
        val chartRow = LinearLayout(this)
        chartRow.orientation = LinearLayout.HORIZONTAL
        chartRow.gravity = Gravity.CENTER_VERTICAL
        val chart = HeatmapChart(this, doneArr, endL)
        chart.background = roundedStroke()
        chartRow.addView(chart, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val sumL = LinearLayout(this)
        sumL.orientation = LinearLayout.VERTICAL
        val nz = doneArr.filter { it > 0 }
        val avg = "%.1f".format(doneArr.sum() / 30f)
        val best = doneArr.maxOrNull() ?: 0
        val week = doneArr.takeLast(7).sum()
        for (pair in listOf("日均" to avg, "最佳" to "$best", "本周" to "$week")) {
            val l = TextView(this)
            l.text = pair.second
            l.textSize = 15f; l.typeface = Typeface.DEFAULT_BOLD; l.setTextColor(PRIMARY)
            l.gravity = Gravity.CENTER
            sumL.addView(l, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            val cap = TextView(this)
            cap.text = pair.first
            cap.textSize = 9f; cap.setTextColor(INK3)
            cap.gravity = Gravity.CENTER
            sumL.addView(cap, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(4) })
        }
        chartRow.addView(sumL, LinearLayout.LayoutParams(dp(96), LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(12) })
        lifeBody.addView(chartRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        // 排行
        val t2 = TextView(this)
        t2.text = "各计划完成排行(近30天)"
        t2.textSize = 13f; t2.typeface = Typeface.DEFAULT_BOLD; t2.setTextColor(INK)
        lifeBody.addView(t2, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.topMargin = dp(14); it.bottomMargin = dp(6)
        })
        if (plans.length() == 0) {
            val empty = TextView(this)
            empty.text = "还没有计划,先去「设置」建一个"
            empty.textSize = 12f
            empty.setTextColor(INK3)
            empty.gravity = Gravity.CENTER
            empty.setPadding(0, dp(20), 0, dp(20))
            lifeBody.addView(empty, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            return
        }
        val sorted = ArrayList<JSONObject>()
        for (i in 0 until plans.length()) sorted.add(plans.optJSONObject(i) ?: continue)
        sorted.sortByDescending { it.optInt("completed") }
        val maxC = (sorted.firstOrNull()?.optInt("completed") ?: 0).coerceAtLeast(1)
        for (o in sorted) {
            val plan = o.optJSONObject("plan") ?: continue
            val c = catColorOf(plan.optString("category_id"))
            val r = LinearLayout(this)
            r.orientation = LinearLayout.HORIZONTAL
            r.gravity = Gravity.CENTER_VERTICAL
            r.setPadding(dp(8), dp(5), dp(8), dp(5))
            val name = TextView(this)
            name.text = plan.optString("title")
            name.textSize = 12f; name.setTextColor(INK); name.maxLines = 1
            name.ellipsize = TextUtils.TruncateAt.END
            r.addView(name, LinearLayout.LayoutParams(dp(110), LinearLayout.LayoutParams.WRAP_CONTENT))
            val track = FrameLayout(this)
            track.background = roundedSolid(0xFFEDE8DF.toInt(), 99f)
            val tlp = LinearLayout.LayoutParams(0, dp(10), 1f)
            tlp.marginStart = dp(8); tlp.marginEnd = dp(8)
            r.addView(track, tlp)
            val n = o.optInt("completed")
            val fillV = View(this)
            fillV.background = roundedSolid(c, 99f)
            track.addView(fillV, FrameLayout.LayoutParams(dp(0), dp(10)))
            track.post {
                val w = track.width * n / maxC
                (fillV.layoutParams as FrameLayout.LayoutParams).width = if (w < dp(6)) dp(6) else w
                fillV.requestLayout()
            }
            val cnt = TextView(this)
            cnt.text = "$n 次"
            cnt.textSize = 11f; cnt.typeface = Typeface.DEFAULT_BOLD; cnt.setTextColor(c)
            r.addView(cnt, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            lifeBody.addView(r, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
    }

    // ----- 生活·设置(计划管理) -----

    private fun lifeLoadPlans() {
        val addBtn = TextView(this)
        addBtn.text = "＋ 新建计划"
        addBtn.textSize = 14f; addBtn.typeface = Typeface.DEFAULT_BOLD
        addBtn.setTextColor(Color.WHITE); addBtn.gravity = Gravity.CENTER
        addBtn.background = roundedSolid(PRIMARY, 14f)
        addBtn.setPadding(0, dp(12), 0, dp(12))
        addBtn.setOnClickListener { showPlanDialog(null) }
        lifeBody.addView(addBtn, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = dp(10) })
        lifeBody.addView(loadingRow())
        thread {
            try {
                val resp = ApiClient.get("/plans")
                if (!resp.ok) throw RuntimeException(resp.detail() ?: "HTTP ${resp.code}")
                runOnUiThread { renderPlansList(JSONArray(resp.body)) }
            } catch (e: Exception) {
                runOnUiThread {
                    lifeBody.removeViews(1, lifeBody.childCount - 1)
                    lifeBody.addView(errorRow("加载失败,点击重试") { lifeLoad() })
                }
            }
        }
    }

    private fun renderPlansList(arr: JSONArray) {
        if (lifeTab != 4) return
        lifeBody.removeViews(1, lifeBody.childCount - 1)
        if (arr.length() == 0) {
            lifeBody.addView(hintRow("还没有计划,点上面新建 🌱"))
            return
        }
        for (i in 0 until arr.length()) {
            val plan = arr.optJSONObject(i) ?: continue
            val c = catColorOf(plan.optString("category_id"))
            val enabled = plan.optBoolean("enabled", true)
            val card = cardItem()
            if (!enabled) card.alpha = 0.55f
            val head = LinearLayout(this)
            head.orientation = LinearLayout.HORIZONTAL
            head.gravity = Gravity.CENTER_VERTICAL
            card.addView(head, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            val dot = View(this)
            dot.background = circleSolid(c)
            head.addView(dot, LinearLayout.LayoutParams(dp(8), dp(8)).also { it.marginEnd = dp(7) })
            val name = TextView(this)
            name.text = plan.optString("title") + if (enabled) "" else "(已停用)"
            name.textSize = 14f; name.typeface = Typeface.DEFAULT_BOLD; name.setTextColor(INK)
            name.maxLines = 1; name.ellipsize = TextUtils.TruncateAt.END
            head.addView(name, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            val pid = plan.optString("id")
            val rev = plan.optInt("revision", 0)
            val toggleBtn = TextView(this)
            toggleBtn.text = if (enabled) "停用" else "启用"
            toggleBtn.textSize = 11f; toggleBtn.typeface = Typeface.DEFAULT_BOLD
            toggleBtn.setTextColor(if (enabled) 0xFFB45309.toInt() else 0xFF15803D.toInt())
            toggleBtn.background = tonalPill(if (enabled) 0xFFF59E0B.toInt() else 0xFF22C55E.toInt())
            toggleBtn.setPadding(dp(10), dp(4), dp(10), dp(4))
            toggleBtn.setOnClickListener {
                thread {
                    try {
                        val b = JSONObject()
                        b.put("enabled", !enabled)
                        b.put("revision", rev)
                        ApiClient.patch("/plans/$pid", b)
                        runOnUiThread { lifeLoad() }
                    } catch (e: Exception) { runOnUiThread { lifeLoad() } }
                }
            }
            head.addView(toggleBtn, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(8) })
            val delBtn = TextView(this)
            delBtn.text = "删除"
            delBtn.textSize = 11f; delBtn.typeface = Typeface.DEFAULT_BOLD
            delBtn.setTextColor(0xFFDC2626.toInt())
            delBtn.setPadding(dp(10), dp(4), dp(10), dp(4))
            delBtn.setOnClickListener {
                thread {
                    try {
                        ApiClient.delete("/plans/$pid")
                        runOnUiThread { lifeLoad() }
                    } catch (e: Exception) { runOnUiThread { lifeLoad() } }
                }
            }
            head.addView(delBtn, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(6) })
            val meta = TextView(this)
            meta.text = "${plan.optString("rule_text")} · ${catNameOf(plan.optString("category_id"))} · " +
                "下次 ${plan.optString("next_occurrence").take(10)} · 累计 ${plan.optInt("generated_count")} 次"
            meta.textSize = 10f; meta.setTextColor(INK3)
            meta.setPadding(0, dp(2), 0, 0)
            card.addView(meta, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            card.setOnClickListener { showPlanDialog(plan) }
            lifeBody.addView(card)
        }
    }

    /** 计划新建/编辑弹窗:标题 + 类型(必选) + 频率;无象限 */
    private fun showPlanDialog(existing: JSONObject?) {
        val col = LinearLayout(this)
        col.orientation = LinearLayout.VERTICAL
        col.setPadding(dp(22), 0, dp(22), dp(18))
        // 弹窗内容可能超高:套滚动容器,CTA 恒可达
        val sheet = ScrollView(this)
        sheet.addView(col, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        col.addView(grabber())
        val st = TextView(this)
        st.text = if (existing == null) "新建计划" else "编辑计划"
        st.textSize = 17f; st.typeface = Typeface.DEFAULT_BOLD; st.setTextColor(INK)
        col.addView(st, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val input = EditText(this)
        if (existing != null) input.setText(existing.optString("title"))
        input.hint = "计划名称,如:每天喝水2L"
        input.textSize = 15f
        input.background = roundedStroke()
        input.setPadding(dp(14), dp(12), dp(14), dp(12))
        col.addView(input, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(12) })

        // 类型(必选)
        val cl = TextView(this)
        cl.text = "类型(必选)"
        cl.textSize = 11f; cl.typeface = Typeface.DEFAULT_BOLD; cl.setTextColor(INK2)
        col.addView(cl, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(12) })
        var selCat: String? = existing?.optString("category_id")?.takeIf { it.isNotEmpty() && it != "null" }
        val chipViews = HashMap<String, LinearLayout>()
        fun paintChips() {
            for ((id, chip) in chipViews) {
                val on = id == selCat
                chip.background = if (on) roundedStrokeColored(catColorOf(id)) else roundedStroke()
                (chip.tag as? TextView)?.setTextColor(if (on) catColorOf(id) else INK)
            }
        }
        val chipRow = LinearLayout(this)
        chipRow.orientation = LinearLayout.HORIZONTAL
        for (cat in categories) {
            val chip = LinearLayout(this)
            chip.orientation = LinearLayout.HORIZONTAL
            chip.gravity = Gravity.CENTER_VERTICAL
            chip.setPadding(dp(10), dp(6), dp(10), dp(6))
            chip.background = roundedStroke()
            val dot = View(this)
            dot.background = circleSolid(cat.color ?: 0xFF94A3B8.toInt())
            chip.addView(dot, LinearLayout.LayoutParams(dp(7), dp(7)).also { it.marginEnd = dp(5) })
            val cn = TextView(this)
            cn.text = cat.name
            cn.textSize = 11f; cn.setTextColor(INK)
            chip.addView(cn, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            chip.tag = cn
            chip.setOnClickListener {
                selCat = if (selCat == cat.id) null else cat.id
                paintChips()
            }
            chipViews[cat.id] = chip
            chipRow.addView(chip, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginEnd = dp(6) })
        }
        paintChips()
        col.addView(chipRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        if (categories.isEmpty()) col.addView(hintRow("类型来自工作台类别,先去工作台建类别"))

        // 频率:每天 / 每周几 / 每隔N天
        val fl = TextView(this)
        fl.text = "频率"
        fl.textSize = 11f; fl.typeface = Typeface.DEFAULT_BOLD; fl.setTextColor(INK2)
        col.addView(fl, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(12) })
        val exRule = existing?.optJSONObject("rule")
        val exType = exRule?.optString("type") ?: "interval"
        var freqMode = when (exType) {
            "weekly" -> 1
            else -> if (exType == "interval" && (exRule?.optInt("interval_days") ?: 1) > 1) 2 else 0
        }
        // 每周几(多选) — 先声明,paintFreq要引用
        val weekdaysRow = LinearLayout(this)
        weekdaysRow.orientation = LinearLayout.HORIZONTAL
        val selDays = HashSet<Int>()
        val exWd = exRule?.optJSONArray("weekdays")
        if (exWd != null) for (k in 0 until exWd.length()) selDays.add(exWd.optInt(k))
        val dayBtns = Array(7) { d ->
            val tv = TextView(this)
            tv.text = CAL_WEEK_LABELS[d]
            tv.textSize = 11f; tv.typeface = Typeface.DEFAULT_BOLD
            tv.gravity = Gravity.CENTER
            tv.setPadding(dp(9), dp(5), dp(9), dp(5))
            tv.setOnClickListener {
                if (selDays.contains(d)) selDays.remove(d) else selDays.add(d)
                tv.setTextColor(if (selDays.contains(d)) PRIMARY else INK3)
                tv.background = if (selDays.contains(d)) roundedSolid(PRIMARY_SOFT, 99f) else null
            }
            if (selDays.contains(d)) {
                tv.setTextColor(PRIMARY); tv.background = roundedSolid(PRIMARY_SOFT, 99f)
            }
            weekdaysRow.addView(tv, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
                if (d > 0) it.marginStart = dp(4)
            })
            tv
        }
        col.addView(weekdaysRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(8) })
        // 每隔N天
        val intervalInput = EditText(this)
        val exIv = exRule?.optInt("interval_days") ?: 2
        intervalInput.setText(if (freqMode == 2) exIv.toString() else "2")
        intervalInput.hint = "间隔天数,如 2 = 每隔两天"
        intervalInput.textSize = 13f
        intervalInput.inputType = InputType.TYPE_CLASS_NUMBER
        intervalInput.background = roundedStroke()
        intervalInput.setPadding(dp(14), dp(10), dp(14), dp(10))
        intervalInput.visibility = View.GONE
        col.addView(intervalInput, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(8) })
        // 频率三选(每天/每周几/每隔N天) — 在所引用视图就绪后构建
        val freqRow = LinearLayout(this)
        freqRow.orientation = LinearLayout.HORIZONTAL
        val freqBtns = Array(3) { i ->
            val tv = TextView(this)
            tv.text = arrayOf("每天", "每周几", "每隔N天")[i]
            tv.textSize = 12f; tv.typeface = Typeface.DEFAULT_BOLD
            tv.gravity = Gravity.CENTER
            tv.background = roundedStroke()
            tv.setPadding(dp(14), dp(6), dp(14), dp(6))
            freqRow.addView(tv, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
                if (i > 0) it.marginStart = dp(8)
            })
            tv
        }
        col.addView(freqRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        fun paintFreq() {
            for ((i, tv) in freqBtns.withIndex()) {
                val on = i == freqMode
                tv.setTextColor(if (on) PRIMARY else INK3)
                tv.background = if (on) roundedSolid(PRIMARY_SOFT, 99f) else null
            }
            weekdaysRow.visibility = if (freqMode == 1) View.VISIBLE else View.GONE
            intervalInput.visibility = if (freqMode == 2) View.VISIBLE else View.GONE
        }
        for ((i, tv) in freqBtns.withIndex()) {
            tv.setOnClickListener {
                freqMode = i
                paintFreq()
            }
        }
        paintFreq()

        val dialog = AlertDialog.Builder(this).setView(sheet).create()
        dialog.show()
        sheetify(dialog, col)

        val cta = TextView(this)
        cta.text = if (existing == null) "创建计划" else "保存"
        cta.textSize = 15f; cta.typeface = Typeface.DEFAULT_BOLD
        cta.setTextColor(Color.WHITE); cta.gravity = Gravity.CENTER
        cta.background = roundedSolid(PRIMARY, 14f)
        cta.setPadding(0, dp(13), 0, dp(13))
        col.addView(cta, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(16) })
        cta.setOnClickListener {
            val title = input.text.toString().trim()
            if (title.isEmpty()) {
                Toast.makeText(this, "请输入计划名称", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (selCat == null) {
                Toast.makeText(this, "计划必须选择类型(类别)", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (freqMode == 1 && selDays.isEmpty()) {
                Toast.makeText(this, "请选择每周几", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val rule = JSONObject()
            when (freqMode) {
                0 -> { rule.put("type", "interval"); rule.put("interval_days", 1) }
                1 -> { rule.put("type", "weekly"); rule.put("weekdays", JSONArray(selDays.toList().sorted())) }
                else -> {
                    val n = intervalInput.text.toString().trim().toIntOrNull() ?: 0
                    if (n < 1 || n > 366) {
                        Toast.makeText(this, "间隔天数需 1-366", Toast.LENGTH_SHORT).show()
                        return@setOnClickListener
                    }
                    rule.put("type", "interval"); rule.put("interval_days", n)
                }
            }
            thread {
                try {
                    if (existing == null) {
                        val body = JSONObject()
                        body.put("title", title)
                        body.put("category_id", selCat)
                        body.put("start_date", LocalDate.now().toString())
                        body.put("rule", rule)
                        val resp = ApiClient.post("/plans", body)
                        if (!resp.ok) throw RuntimeException(resp.detail() ?: "HTTP ${resp.code}")
                    } else {
                        val body = JSONObject()
                        body.put("title", title)
                        body.put("category_id", selCat)
                        body.put("rule", rule)
                        body.put("revision", existing.optInt("revision", 0))
                        val resp = ApiClient.patch("/plans/${existing.optString("id")}", body)
                        if (!resp.ok) throw RuntimeException(resp.detail() ?: "HTTP ${resp.code}")
                    }
                    runOnUiThread {
                        Toast.makeText(this, if (existing == null) "已创建" else "已保存", Toast.LENGTH_SHORT).show()
                        dialog.dismiss()
                        lifeLoad()
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        val msg = (e as? RuntimeException)?.message
                        Toast.makeText(this, msg?.takeIf { !it.startsWith("HTTP") } ?: "保存失败,请重试", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    private fun renderStats(wrap: LinearLayout, daily: JSONObject, streak: JSONObject, range: JSONObject, shelvedN: Int) {
        wrap.removeAllViews()

        val completed = daily.optInt("completed", 0)
        val created = daily.optInt("created", 0)
        val migratedIn = daily.optInt("migrated_in", 0)
        val rate = daily.optDouble("completion_rate", Double.NaN)
        val rateTxt = if (rate.isNaN()) "—" else "${Math.round(rate * 100)}%"

        // 英雄卡:渐变底 + 大数字 + 完成率进度条
        val hero = LinearLayout(this)
        hero.orientation = LinearLayout.VERTICAL
hero.background = roundedSolid(PRIMARY_SOFT, 20f)
        hero.elevation = dp(4).toFloat()
        hero.setPadding(dp(18), dp(16), dp(18), dp(16))
        wrap.addView(hero, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = dp(4) })
        val heroLabel = TextView(this)
        heroLabel.text = "今日完成"
        heroLabel.textSize = 11f
        heroLabel.typeface = Typeface.DEFAULT_BOLD
        heroLabel.letterSpacing = 0.06f
        heroLabel.setTextColor(INK2)
        hero.addView(heroLabel)
        val heroRow = LinearLayout(this)
        heroRow.orientation = LinearLayout.HORIZONTAL
        heroRow.gravity = Gravity.BOTTOM
        hero.addView(heroRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(4) })
        val heroNum = TextView(this)
        heroNum.text = completed.toString()
        heroNum.textSize = 36f
        heroNum.typeface = Typeface.DEFAULT_BOLD
        heroNum.setTextColor(PRIMARY)
        heroRow.addView(heroNum)
        val heroUnit = TextView(this)
        heroUnit.text = " 项"
        heroUnit.textSize = 13f
        heroUnit.setTextColor(INK3)
        heroRow.addView(heroUnit, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = dp(7) })
        val rateRight = TextView(this)
        rateRight.text = "完成率 $rateTxt"
        rateRight.textSize = 12f
        rateRight.typeface = Typeface.DEFAULT_BOLD
        rateRight.setTextColor(PRIMARY)
        rateRight.gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        heroRow.addView(rateRight, LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).also { it.marginStart = dp(12) })

        val track = LinearLayout(this)
        track.orientation = LinearLayout.HORIZONTAL
        track.background = roundedSolid(0xFFE3DDF5.toInt(), 99f)
        hero.addView(track, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(6)).also { it.topMargin = dp(12) })
        val rateSafe = if (rate.isNaN()) 0f else rate.toFloat().coerceIn(0f, 1f)
        if (rateSafe > 0f) {
            val fill = View(this)
            fill.background = roundedSolid(PRIMARY, 99f)
            track.addView(fill, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, rateSafe))
        }
        val restFill = View(this)
        track.addView(restFill, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f - rateSafe))

        // 指标卡
        val rows = listOf(
            listOf(Triple("新建", "$created", PRIMARY),
                Triple("迁入", "$migratedIn", 0xFFF59E0B.toInt()),
                Triple("连续", "${streak.optInt("current", 0)}天", 0xFFF97316.toInt())),
            listOf(Triple("最长", "${streak.optInt("best", 0)}天", 0xFF8B5CF6.toInt()),
                Triple("活跃", "${streak.optInt("total_active", 0)}天", 0xFF0EA5E9.toInt()),
                Triple("搁置", "$shelvedN", 0xFF94A3B8.toInt()))
        )
        for (rowDefs in rows) {
            val row = LinearLayout(this)
            row.orientation = LinearLayout.HORIZONTAL
            wrap.addView(row, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(8) })
            for ((k, v, c) in rowDefs) {
                val card = LinearLayout(this)
                card.orientation = LinearLayout.VERTICAL
                card.gravity = Gravity.CENTER
                card.background = roundedSolid(tonalColor(c), 16f)
                card.setPadding(dp(8), dp(12), dp(8), dp(12))
                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                lp.marginEnd = dp(8)
                row.addView(card, lp)
                val kt = TextView(this)
                kt.text = k
                kt.textSize = 10f
                kt.setTextColor(INK2)
                card.addView(kt)
                val vt = TextView(this)
                vt.text = v
                vt.textSize = 17f
                vt.typeface = Typeface.DEFAULT_BOLD
                vt.setTextColor(c)
                vt.setPadding(0, dp(3), 0, 0)
                card.addView(vt)
            }
        }

        // 象限完成分布
        wrap.addView(sectionHeader("象限完成分布"))
        val qc = daily.optJSONObject("quadrant_completed")
        val qs = intArrayOf(1, 2, 3, 4)
        val qcVals = qs.map { qc?.optInt("q$it", 0) ?: 0 }
        val qMax = (qcVals.maxOrNull() ?: 0).coerceAtLeast(1)
        for (i in qs.indices) {
            wrap.addView(barRow("${QUAD_SHORT[qs[i]]} ${quadLabels[qs[i]] ?: ""}", qColor(qs[i]), qcVals[i], qMax))
        }

        // 类别完成占比
        wrap.addView(sectionHeader("类别完成占比"))
        val byCat = daily.optJSONArray("by_category")
        val catMax = (0 until (byCat?.length() ?: 0)).maxOfOrNull {
            byCat!!.optJSONObject(it)?.optInt("completed", 0) ?: 0
        }?.coerceAtLeast(1) ?: 1
        var hasCat = false
        for (i in 0 until (byCat?.length() ?: 0)) {
            val c = byCat?.optJSONObject(i) ?: continue
            hasCat = true
            var cInt: Int? = null
            try { cInt = Color.parseColor(c.optString("color")) } catch (e: Exception) {}
            wrap.addView(barRow(c.optString("name"), cInt ?: 0xFF94A3B8.toInt(), c.optInt("completed", 0), catMax))
        }
        if (!hasCat) wrap.addView(hintRow("今天还没有完成的任务"))

        // 近 7 天
        wrap.addView(sectionHeader("近 7 天完成"))
        val days = range.optJSONArray("days") ?: JSONArray()
        val weekMax = (0 until days.length()).maxOfOrNull {
            days.optJSONObject(it)?.optInt("completed", 0) ?: 0
        }?.coerceAtLeast(1) ?: 1
        for (i in 0 until days.length()) {
            val d = days.optJSONObject(i) ?: continue
            val label = try {
                LocalDate.parse(d.optString("date")).let { "${it.monthValue}/${it.dayOfMonth}" }
            } catch (e: Exception) { d.optString("date") }
            wrap.addView(barRow(label, PRIMARY, d.optInt("completed", 0), weekMax))
        }
    }

    private fun barRow(label: String, color: Int, value: Int, max: Int): View {
        val row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        row.gravity = Gravity.CENTER_VERTICAL
        val rlp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        rlp.topMargin = dp(6)
        row.layoutParams = rlp

        val lt = TextView(this)
        lt.text = label
        lt.textSize = 11f
        lt.setTextColor(INK2)
        lt.maxLines = 1
        lt.ellipsize = TextUtils.TruncateAt.END
        row.addView(lt, LinearLayout.LayoutParams(dp(88), LinearLayout.LayoutParams.WRAP_CONTENT))

        val track = LinearLayout(this)
        track.orientation = LinearLayout.HORIZONTAL
        track.background = roundedSolid(0xFFE9EDF4.toInt(), 99f)
        row.addView(track, LinearLayout.LayoutParams(0, dp(10), 1f))

        if (value > 0) {
            val fill = View(this)
            fill.background = gradientRounded(color, color, 99f)
            track.addView(fill, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, value.toFloat()))
        }
        val rest = View(this)
        track.addView(rest, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT,
            (max - value).coerceAtLeast(0).toFloat()))

        val nt = TextView(this)
        nt.text = value.toString()
        nt.textSize = 11f
        nt.typeface = Typeface.DEFAULT_BOLD
        nt.setTextColor(color)
        row.addView(nt, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(8) })
        return row
    }

    // ---------- 操作(无全屏转圈,靠列表动画反馈) ----------

    private fun toggleTask(t: Task, note: String? = null) {
        val path = if (t.done) "/tasks/${t.id}/reopen" else "/tasks/${t.id}/complete"
        val body = JSONObject()
        if (!note.isNullOrEmpty()) body.put("note", note)
        pendingOps.incrementAndGet()
        thread {
            try {
                val resp = ApiClient.post(path, body)
                if (!resp.ok) throw RuntimeException(resp.detail() ?: "HTTP ${resp.code}")
                val updated = try { parseTask(JSONObject(resp.body)) } catch (e: Exception) { null }
                runOnUiThread {
                    if (updated != null) patchRowState(updated) else refresh()
                    pendingOps.decrementAndGet()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    val msg = (e as? RuntimeException)?.message
                    Toast.makeText(this, msg?.takeIf { !it.startsWith("HTTP") } ?: "操作失败,请重试", Toast.LENGTH_LONG).show()
                    rerenderRow(t) // 回滚乐观UI
                    pendingOps.decrementAndGet()
                }
            }
        }
    }

    private fun moveTask(t: Task, targetQ: Int, beforeId: String?) {
        val body = JSONObject()
        body.put("is_important", targetQ == 1 || targetQ == 2)
        body.put("is_urgent", targetQ == 1 || targetQ == 3)
        if (beforeId != null) body.put("before_task_id", beforeId)
        pendingOps.incrementAndGet()
        thread {
            try {
                val resp = ApiClient.post("/tasks/${t.id}/move", body)
                if (!resp.ok) throw RuntimeException(resp.detail() ?: "HTTP ${resp.code}")
                val updated = try { parseTask(JSONObject(resp.body)) } catch (e: Exception) { null }
                runOnUiThread {
                    if (updated != null) moveRowVisual(updated, targetQ, beforeId) else refresh()
                    pendingOps.decrementAndGet()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    val msg = (e as? RuntimeException)?.message
                    Toast.makeText(this, msg?.takeIf { !it.startsWith("HTTP") } ?: "移动失败,请重试", Toast.LENGTH_LONG).show()
                    pendingOps.decrementAndGet()
                }
            }
        }
    }

    // ---------- 原地更新(性能专项:操作后不整板重建) ----------

    /** 完成态切换:行留在原地,只替换tag并同步计数,乐观动画不被打断 */
    private fun patchRowState(updated: Task) {
        for ((list, q) in listQuadrant) {
            for (i in 0 until list.childCount) {
                val child = list.getChildAt(i)
                val t2 = child.tag as? Task ?: continue
                if (t2.id == updated.id) {
                    if (updated.quadrant != q) {
                        moveRowVisual(updated, updated.quadrant, null)
                        return
                    }
                    child.tag = updated
                    syncPill(q)
                    reconcileNotifyFromBoard()
                    return
                }
            }
        }
        refresh()
    }

    /** 拖动落点:源列表收拢动画 + 目标列表按beforeId滑入,不重建其他行 */
    private fun moveRowVisual(updated: Task, targetQ: Int, beforeId: String?) {
        var srcList: LinearLayout? = null
        var srcRow: View? = null
        var srcQ = 0
        for ((list, q) in listQuadrant) {
            for (i in 0 until list.childCount) {
                val child = list.getChildAt(i)
                val t2 = child.tag as? Task ?: continue
                if (t2.id == updated.id) { srcList = list; srcRow = child; srcQ = q; break }
            }
            if (srcRow != null) break
        }
        val dst = listQuadrant.entries.firstOrNull { it.value == targetQ }?.key
        if (srcRow == null || dst == null) { refresh(); return }
        srcList!!.removeView(srcRow)
        var idx = dst.childCount
        if (beforeId != null) {
            for (i in 0 until dst.childCount) {
                val t2 = dst.getChildAt(i).tag as? Task ?: continue
                if (t2.id == beforeId) { idx = i; break }
            }
        }
        dst.addView(taskRow(updated, qColor(targetQ)), idx)
        syncPill(srcQ)
        syncPill(targetQ)
        reconcileNotifyFromBoard()
    }

    /** 静默重渲染一行(无过渡动画),用于失败回滚 */
    private fun rerenderRow(t: Task) {
        for ((list, q) in listQuadrant) {
            for (i in 0 until list.childCount) {
                val child = list.getChildAt(i)
                val t2 = child.tag as? Task ?: continue
                if (t2.id == t.id) {
                    val lt = list.layoutTransition
                    list.layoutTransition = null
                    list.removeViewAt(i)
                    list.addView(taskRow(t, qColor(q)), i)
                    list.layoutTransition = lt
                    reconcileNotifyFromBoard()
                    return
                }
            }
        }
    }

    /** 看板当前任务 → apk通知调度对账 */
    private fun reconcileNotifyFromBoard() {
        val plans = ArrayList<NotifyPlan>()
        for ((list, _) in listQuadrant) {
            for (i in 0 until list.childCount) {
                val t = list.getChildAt(i).tag as? Task ?: continue
                if (t.done || !t.notifyEnabled) continue
                if (!t.notifyChannels.contains("apk")) continue
                plans.add(NotifyPlan(t.id, t.title, t.notifyTime ?: ""))
            }
        }
        NotifyScheduler.reconcile(this, plans)
    }

    /** 由列表子行重算象限待办计数 */
    private fun syncPill(q: Int) {
        val pill = quadPills[q] ?: return
        val list = listQuadrant.entries.firstOrNull { it.value == q }?.key ?: return
        var n = 0
        for (i in 0 until list.childCount) {
            val t = list.getChildAt(i).tag as? Task ?: continue
            if (!t.done) n++
        }
        pill.text = n.toString()
    }

    private fun migrateTask(ids: List<String>, onDone: () -> Unit) {
        val body = JSONObject()
        body.put("task_ids", JSONArray(ids))
        body.put("to_date", "today")
        thread {
            try {
                val resp = ApiClient.post("/migrations/bulk", body)
                if (!resp.ok) throw RuntimeException("HTTP ${resp.code}")
                runOnUiThread {
                    Toast.makeText(this, "已迁到今天", Toast.LENGTH_SHORT).show()
                    refresh()
                    onDone()
                }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this, "迁移失败,请重试", Toast.LENGTH_SHORT).show() }
            }
        }
    }

    // ---------- 对话框 ----------

    private fun showMigrations() {
        if (migrations.isEmpty()) return
        val col = LinearLayout(this)
        col.orientation = LinearLayout.VERTICAL
        col.setPadding(dp(22), 0, dp(22), dp(18))
        col.addView(grabber())
        val sheetTitle = TextView(this)
        sheetTitle.text = "待迁移任务"
        sheetTitle.textSize = 17f
        sheetTitle.typeface = Typeface.DEFAULT_BOLD
        sheetTitle.setTextColor(INK)
        col.addView(sheetTitle)
        val scroll = ScrollView(this)
        val list = LinearLayout(this)
        list.orientation = LinearLayout.VERTICAL
        list.setPadding(0, dp(6), 0, dp(4))
        scroll.addView(list, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        col.addView(scroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        fun rebuild() {
            list.removeAllViews()
            if (migrations.isEmpty()) {
                list.addView(hintRow("没有待迁移任务了"))
                return
            }
            for (m in migrations) {
                val item = LinearLayout(this)
                item.orientation = LinearLayout.VERTICAL
                item.setPadding(0, dp(9), 0, dp(9))

                val titleRow = LinearLayout(this)
                titleRow.orientation = LinearLayout.HORIZONTAL
                titleRow.gravity = Gravity.CENTER_VERTICAL
                item.addView(titleRow, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

                val tv = TextView(this)
                tv.text = m.title
                tv.textSize = 13f
                tv.setTextColor(INK)
                tv.maxLines = 1
                tv.ellipsize = TextUtils.TruncateAt.END
                titleRow.addView(tv, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

                if (!m.intervention) {
                    val btn = TextView(this)
                    btn.text = "迁到今天"
                    btn.textSize = 11f
                    btn.typeface = Typeface.DEFAULT_BOLD
                    btn.setTextColor(PRIMARY)
                    btn.background = roundedSolid(PRIMARY_SOFT, 99f)
                    btn.setPadding(dp(12), dp(5), dp(12), dp(5))
                    titleRow.addView(btn, LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginStart = dp(8) })
                    btn.setOnClickListener {
                        migrateTask(listOf(m.id)) {
                            migrations = migrations.filter { it.id != m.id }
                            rebuild()
                        }
                    }
                }

                val daysTxt = if (m.days > 0) " · 拖延${m.days}天" else ""
                val sub = TextView(this)
                sub.text = if (m.intervention) "⟲ 来自 ${m.originalDate ?: "-"}$daysTxt · 需干预"
                else "⟲ 来自 ${m.originalDate ?: "-"}$daysTxt"
                sub.textSize = 10f
                sub.setTextColor(if (m.intervention) 0xFFEF4444.toInt() else INK3)
                sub.setPadding(0, dp(4), 0, 0)
                item.addView(sub, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

                item.addView(hairline(), LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, 1).also { it.topMargin = dp(9) })
                list.addView(item, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            }
        }
        rebuild()

        val dialog = AlertDialog.Builder(this)
            .setView(col)
            .create()
        dialog.show()
        sheetify(dialog, col)

        val bulk = TextView(this)
        bulk.text = "全部迁到今天"
        bulk.textSize = 15f
        bulk.typeface = Typeface.DEFAULT_BOLD
        bulk.setTextColor(Color.WHITE)
        bulk.gravity = Gravity.CENTER
        bulk.background = gradientRounded(PRIMARY, PRIMARY2, 14f)
        bulk.setPadding(0, dp(13), 0, dp(13))
        col.addView(bulk, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(14) })
        val hasBulk = migrations.any { !it.intervention }
        bulk.alpha = if (hasBulk) 1f else 0.4f
        bulk.setOnClickListener {
            if (!hasBulk) return@setOnClickListener
            val bulkIds = migrations.filter { !it.intervention }.map { it.id }
            if (bulkIds.isEmpty()) return@setOnClickListener
            dialog.dismiss()
            migrateTask(bulkIds) {}
        }
    }

    /** 完成备注弹窗:勾选待办时弹出,可选填;确认才完成,取消保持待办 */
    private fun showCompleteNoteDialog(t: Task, onConfirm: (String?) -> Unit) {
        val col = LinearLayout(this)
        col.orientation = LinearLayout.VERTICAL
        col.setPadding(dp(22), 0, dp(22), dp(18))
        col.addView(grabber())

        val title = TextView(this)
        title.text = "完成「${t.title}」"
        title.textSize = 16f
        title.typeface = Typeface.DEFAULT_BOLD
        title.setTextColor(INK)
        title.maxLines = 1
        title.ellipsize = TextUtils.TruncateAt.END
        col.addView(title, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val sub = TextView(this)
        sub.text = "留个完成备注(可选)"
        sub.textSize = 11f
        sub.setTextColor(INK3)
        col.addView(sub, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.topMargin = dp(4)
        })

        val input = EditText(this)
        input.hint = "如:产出周报一份,耗时40分钟"
        input.textSize = 14f
        input.setInputType(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE)
        input.minLines = 2
        input.maxLines = 3
        input.gravity = Gravity.TOP
        input.background = roundedStroke()
        input.setPadding(dp(14), dp(11), dp(14), dp(11))
        col.addView(input, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.topMargin = dp(10)
        })

        val dialog = AlertDialog.Builder(this)
            .setView(col)
            .create()
        dialog.show()
        sheetify(dialog, col)

        val cta = TextView(this)
        cta.text = "完成"
        cta.textSize = 15f
        cta.typeface = Typeface.DEFAULT_BOLD
        cta.setTextColor(Color.WHITE)
        cta.gravity = Gravity.CENTER
        cta.background = roundedSolid(PRIMARY, 14f)
        cta.setPadding(0, dp(13), 0, dp(13))
        col.addView(cta, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(14) })
        cta.setOnClickListener {
            dialog.dismiss()
            onConfirm(input.text.toString().trim().takeIf { it.isNotEmpty() })
        }
    }

    private fun showTaskDialog(existing: Task?) {
        val col = LinearLayout(this)
        col.orientation = LinearLayout.VERTICAL
        col.setPadding(dp(22), 0, dp(22), dp(18))
        col.addView(grabber())

        val sheetTitle = TextView(this)
        sheetTitle.text = if (existing == null) "新建任务" else "编辑任务"
        sheetTitle.textSize = 17f
        sheetTitle.typeface = Typeface.DEFAULT_BOLD
        sheetTitle.setTextColor(INK)
        col.addView(sheetTitle, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val input = EditText(this)
        if (existing != null) input.setText(existing.title)
        input.hint = "要做一件什么事?"
        input.textSize = 15f
        input.setInputType(InputType.TYPE_CLASS_TEXT)
        input.background = roundedStroke()
        input.setPadding(dp(14), dp(12), dp(14), dp(12))
        col.addView(input, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(12) })

        // 备注(可选,多行)
        val noteInput = EditText(this)
        if (existing != null) noteInput.setText(existing.description ?: "")
        noteInput.hint = "备注(可选)"
        noteInput.textSize = 13f
        noteInput.setInputType(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE)
        noteInput.minLines = 2
        noteInput.maxLines = 3
        noteInput.gravity = Gravity.TOP
        noteInput.background = roundedStroke()
        noteInput.setPadding(dp(14), dp(10), dp(14), dp(10))
        col.addView(noteInput, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(8) })

        val label = TextView(this)
        label.text = "象限"
        label.textSize = 11f
        label.typeface = Typeface.DEFAULT_BOLD
        label.setTextColor(INK2)
        col.addView(label, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(14) })

        var selected = if (existing != null && existing.quadrant in 1..4) existing.quadrant else 2
        val blocks = HashMap<Int, LinearLayout>()
        fun paintBlocks() {
            for ((q, block) in blocks) {
                val c = qColor(q)
                block.background = if (q == selected) roundedStrokeColored(c) else roundedStroke()
                (block.tag as? TextView)?.setTextColor(if (q == selected) c else INK)
            }
        }
        for (r in 0 until 2) {
            val row = LinearLayout(this)
            row.orientation = LinearLayout.HORIZONTAL
            col.addView(row, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(8) })
            for (c in 0 until 2) {
                val q = VISUAL_ORDER[r * 2 + c]
                val block = LinearLayout(this)
                block.orientation = LinearLayout.VERTICAL
                block.setPadding(dp(12), dp(10), dp(12), dp(10))
                block.setOnClickListener { selected = q; paintBlocks() }
                blocks[q] = block

                val dotRow = LinearLayout(this)
                dotRow.orientation = LinearLayout.HORIZONTAL
                dotRow.gravity = Gravity.CENTER_VERTICAL
                block.addView(dotRow, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
                val tile = View(this)
                tile.background = roundedSolid(qColor(q), 5f)
                dotRow.addView(tile, LinearLayout.LayoutParams(dp(14), dp(14)).also { it.marginEnd = dp(7) })
                val name = TextView(this)
                name.text = quadLabels[q] ?: ""
                name.textSize = 12f
                name.typeface = Typeface.DEFAULT_BOLD
                name.setTextColor(INK)
                dotRow.addView(name)
                block.tag = name

                val sub2 = TextView(this)
                sub2.text = quadSubs[q] ?: ""
                sub2.textSize = 9f
                sub2.setTextColor(INK3)
                sub2.setPadding(0, dp(3), 0, 0)
                block.addView(sub2, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

                row.addView(block, LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also {
                    if (c == 0) it.marginEnd = dp(8) else it.marginStart = 0
                })
            }
        }
        paintBlocks()

        // 类别芯片
        var selectedCat: String? = existing?.categoryId
        if (categories.isNotEmpty()) {
            val catLabel = TextView(this)
            catLabel.text = "类别"
            catLabel.textSize = 11f
            catLabel.typeface = Typeface.DEFAULT_BOLD
            catLabel.setTextColor(INK2)
            col.addView(catLabel, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(14) })

            val chipViews = HashMap<String, LinearLayout>()
            fun paintChips() {
                for (cat in categories) {
                    val chip = chipViews[cat.id] ?: continue
                    val c = cat.color ?: 0xFF94A3B8.toInt()
                    if (cat.id == selectedCat) {
                        chip.background = roundedStrokeColoredPill(c)
                        (chip.tag as? TextView)?.setTextColor(c)
                    } else {
                        chip.background = roundedSolid(0xFFF3F5F9.toInt(), 99f)
                        (chip.tag as? TextView)?.setTextColor(INK2)
                    }
                }
            }
            for (chunk in categories.chunked(3)) {
                val chipRow = LinearLayout(this)
                chipRow.orientation = LinearLayout.HORIZONTAL
                col.addView(chipRow, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(8) })
                for (cat in chunk) {
                    val chip = LinearLayout(this)
                    chip.orientation = LinearLayout.HORIZONTAL
                    chip.gravity = Gravity.CENTER_VERTICAL
                    chip.setPadding(dp(11), dp(7), dp(11), dp(7))
                    chip.setOnClickListener {
                        selectedCat = if (selectedCat == cat.id) null else cat.id
                        paintChips()
                    }
                    chipViews[cat.id] = chip

                    val cd = View(this)
                    cd.background = circleSolid(cat.color ?: 0xFF94A3B8.toInt())
                    chip.addView(cd, LinearLayout.LayoutParams(dp(7), dp(7)).also { it.marginEnd = dp(5) })
                    val cn = TextView(this)
                    cn.text = cat.name
                    cn.textSize = 11f
                    cn.setTextColor(INK)
                    chip.addView(cn, LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
                    chip.tag = cn

                    chipRow.addView(chip, LinearLayout.LayoutParams(0,
                        LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also { it.marginEnd = dp(8) })
                }
            }
            paintChips()
        }

        val dialog = AlertDialog.Builder(this)
            .setView(col)
            .create()
        dialog.show()
        sheetify(dialog, col)

        val cta = TextView(this)
        cta.text = if (existing == null) "添加任务" else "保存"
        cta.textSize = 15f
        cta.typeface = Typeface.DEFAULT_BOLD
        cta.setTextColor(Color.WHITE)
        cta.gravity = Gravity.CENTER
        cta.background = roundedSolid(PRIMARY, 14f)
        cta.setPadding(0, dp(13), 0, dp(13))
        col.addView(cta, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(18) })

        // 编辑模式:删除任务(两步确认防误触)
        if (existing != null) {
            val delBtn = TextView(this)
            delBtn.text = "删除任务"
            delBtn.textSize = 13f
            delBtn.typeface = Typeface.DEFAULT_BOLD
            delBtn.setTextColor(0xFFEF4444.toInt())
            delBtn.gravity = Gravity.CENTER
            delBtn.background = tonalPill(0xFFEF4444.toInt())
            delBtn.setPadding(0, dp(11), 0, dp(11))
            col.addView(delBtn, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = dp(8) })
            var armed = false
            delBtn.setOnClickListener { v ->
                if (!armed) {
                    armed = true
                    (v as? TextView)?.text = "再点一次确认删除"
                    v.postDelayed({ armed = false; (v as? TextView)?.text = "删除任务" }, 3000)
                    return@setOnClickListener
                }
                thread {
                    try {
                        val resp = ApiClient.delete("/tasks/${existing.id}")
                        if (!resp.ok) throw RuntimeException(resp.detail() ?: "HTTP ${resp.code}")
                        runOnUiThread {
                            Toast.makeText(this, "已删除", Toast.LENGTH_SHORT).show()
                            dialog.dismiss()
                            refresh()
                        }
                    } catch (e: Exception) {
                        runOnUiThread {
                            val msg = (e as? RuntimeException)?.message
                            Toast.makeText(this, msg?.takeIf { !it.startsWith("HTTP") } ?: "删除失败,请重试", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
        }
        cta.setOnClickListener {
            val title = input.text.toString().trim()
            if (title.isEmpty()) {
                Toast.makeText(this, "请输入任务标题", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val note = noteInput.text.toString().trim()
            thread {
                try {
                    if (existing == null) {
                        val body = JSONObject()
                        body.put("title", title)
                        if (note.isNotEmpty()) body.put("description", note)
                        body.put("is_important", selected == 1 || selected == 2)
                        body.put("is_urgent", selected == 1 || selected == 3)
                        body.put("task_date", "today")
                        selectedCat?.let { body.put("category_id", it) }
                        val resp = ApiClient.post("/tasks", body)
                        if (!resp.ok) throw RuntimeException(resp.detail() ?: "HTTP ${resp.code}")
                        runOnUiThread {
                            Toast.makeText(this, "已添加", Toast.LENGTH_SHORT).show()
                            dialog.dismiss()
                            refresh()
                        }
                    } else {
                        val body = JSONObject()
                        body.put("title", title)
                        if (note.isNotEmpty()) body.put("description", note)
                        else if (!existing.description.isNullOrEmpty()) body.put("description", "")
                        body.put("is_important", selected == 1 || selected == 2)
                        body.put("is_urgent", selected == 1 || selected == 3)
                        if (selectedCat != existing.categoryId) body.put("category_id", selectedCat ?: "")
                        body.put("revision", existing.revision)
                        val resp = ApiClient.patch("/tasks/${existing.id}", body)
                        if (!resp.ok) throw RuntimeException(resp.detail() ?: "HTTP ${resp.code}")
                        runOnUiThread {
                            Toast.makeText(this, "已更新", Toast.LENGTH_SHORT).show()
                            dialog.dismiss()
                            refresh()
                        }
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        val msg = (e as? RuntimeException)?.message
                        Toast.makeText(this, msg?.takeIf { !it.startsWith("HTTP") } ?: "保存失败,请重试", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    // ---------- 小组件 ----------

    private fun sectionHeader(text: String): TextView {
        val tv = TextView(this)
        tv.text = text
        tv.textSize = 16f
        tv.typeface = Typeface.DEFAULT_BOLD
        tv.setTextColor(INK)
        tv.letterSpacing = 0.01f
        tv.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
            it.topMargin = dp(16); it.bottomMargin = dp(8)
        }
        return tv
    }

    private fun loadingRow(): TextView {
        val tv = TextView(this)
        tv.text = "加载中…"
        tv.textSize = 11f
        tv.setTextColor(INK3)
        tv.setPadding(dp(2), dp(8), 0, dp(8))
        return tv
    }

    private fun hintRow(text: String): TextView {
        val tv = TextView(this)
        tv.text = text
        tv.textSize = 10f
        tv.setTextColor(INK3)
        tv.setPadding(dp(2), dp(4), 0, dp(6))
        return tv
    }

    private fun errorRow(text: String, onClick: () -> Unit): TextView {
        val tv = TextView(this)
        tv.text = text
        tv.textSize = 12f
        tv.setTextColor(0xFFEF4444.toInt())
        tv.background = ripple(roundedSolid(SURFACE, 12f))
        tv.setPadding(dp(14), dp(10), dp(14), dp(10))
        tv.setOnClickListener { onClick() }
        return tv
    }

    private fun hairline(): View {
        val v = View(this)
        v.setBackgroundColor(HAIR)
        return v
    }

    private fun cardItem(): LinearLayout {
        val item = LinearLayout(this)
        item.orientation = LinearLayout.VERTICAL
        item.background = ripple(cardBg())
        item.setPadding(dp(12), dp(7), dp(12), dp(7))
        item.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = dp(5) }
        return item
    }

    /** 对话框统一圆角白底 + 品牌色确定按钮 */
    private fun styleDialog(dialog: AlertDialog) {
        dialog.window?.setBackgroundDrawable(roundedSolid(SURFACE, 20f))
        val pos = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
        pos?.setTextColor(PRIMARY)
        pos?.typeface = Typeface.DEFAULT_BOLD
        dialog.getButton(AlertDialog.BUTTON_NEGATIVE)?.setTextColor(INK3)
    }

    // ---------- 解析 ----------

    private fun parseTask(o: JSONObject): Task {
        var catColor: Int? = null
        val cs = o.optString("category_color")
        if (!cs.isNullOrEmpty() && cs != "null") {
            try { catColor = Color.parseColor(cs) } catch (e: Exception) { catColor = null }
        }
        // org.json 对 JSON null 的 optString 返回字符串 "null",需过滤
        fun clean(s: String?): String? = if (s.isNullOrEmpty() || s == "null") null else s
        val chans = ArrayList<String>()
        val carr = o.optJSONArray("notify_channels")
        if (carr != null) for (i in 0 until carr.length()) chans.add(carr.optString(i))
        return Task(
            id = o.optString("id"),
            title = o.optString("title"),
            description = clean(o.optString("description")),
            categoryName = clean(o.optString("category_name")),
            categoryColor = catColor,
            quadrant = o.optInt("quadrant", 0),
            done = o.optString("status") == "done",
            migratedCount = o.optInt("migrated_count", 0),
            originalDate = if (o.isNull("original_date")) null else o.optString("original_date"),
            daysProcrastinated = o.optInt("days_procrastinated", 0),
            revision = o.optInt("revision", 1),
            notifyEnabled = o.optBoolean("notify_enabled", false),
            notifyTime = clean(o.optString("notify_time")),
            notifyChannels = chans,
            taskDate = clean(o.optString("task_date")),
            categoryId = clean(o.optString("category_id")),
            completionNote = clean(o.optString("completion_note"))
        )
    }

    private fun parseTasks(arr: JSONArray?): List<Task> {
        val out = ArrayList<Task>()
        if (arr == null) return out
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            out.add(parseTask(o))
        }
        return out
    }

    private fun parseMigrations(arr: JSONArray?): List<Migration> {
        val out = ArrayList<Migration>()
        if (arr == null) return out
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optBoolean("deleted", false)) continue
            out.add(Migration(
                id = o.optString("id"),
                title = o.optString("title"),
                originalDate = if (o.isNull("original_date")) null else o.optString("original_date"),
                days = o.optInt("days_procrastinated", 0),
                intervention = o.optBoolean("intervention_required", false)
            ))
        }
        return out
    }

    // ---------- Drawable 工具 ----------

    private fun roundedSolid(color: Int, radiusDp: Float): GradientDrawable {
        val d = GradientDrawable()
        d.setColor(color)
        d.cornerRadius = radiusDp * resources.displayMetrics.density
        return d
    }

    private fun gradientRounded(c1: Int, c2: Int, radiusDp: Float): GradientDrawable {
        val d = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(c1, c2))
        d.cornerRadius = radiusDp * resources.displayMetrics.density
        return d
    }

    private fun gradientCircle(c1: Int, c2: Int): GradientDrawable {
        val d = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(c1, c2))
        d.shape = GradientDrawable.OVAL
        return d
    }

    /** 象限色浅色调胶囊(标签底) */
    private fun tonalPill(color: Int): GradientDrawable {
        val d = GradientDrawable()
        d.setColor(Color.argb(45, Color.red(color), Color.green(color), Color.blue(color)))
        d.cornerRadius = 99f * resources.displayMetrics.density
        return d
    }

    private fun circleSolid(color: Int): GradientDrawable {
        val d = GradientDrawable()
        d.setShape(GradientDrawable.OVAL)
        d.setColor(color)
        return d
    }

    private fun circleRing(color: Int): GradientDrawable {
        val d = GradientDrawable()
        d.setShape(GradientDrawable.OVAL)
        d.setColor(Color.TRANSPARENT)
        d.setStroke(dp(2), color)
        return d
    }

    /** 拖拽目标高亮:象限色调底 + 同色描边 */
    private fun dragHighlight(color: Int): GradientDrawable {
        val d = GradientDrawable()
        d.setColor(Color.argb(42, Color.red(color), Color.green(color), Color.blue(color)))
        d.cornerRadius = 20f * resources.displayMetrics.density
        d.setStroke(dp(2), color)
        return d
    }

    private fun roundedStrokeColored(color: Int): GradientDrawable {
        val d = GradientDrawable()
        d.setColor(Color.argb(24, Color.red(color), Color.green(color), Color.blue(color)))
        d.cornerRadius = 14f * resources.displayMetrics.density
        d.setStroke(dp(2), color)
        return d
    }

    /** 选中态类别胶囊:色调底 + 同色描边 */
    private fun roundedStrokeColoredPill(color: Int): GradientDrawable {
        val d = GradientDrawable()
        d.setColor(Color.argb(28, Color.red(color), Color.green(color), Color.blue(color)))
        d.cornerRadius = 99f * resources.displayMetrics.density
        d.setStroke(dp(1), color)
        return d
    }

    private fun roundedStroke(): GradientDrawable {
        val d = GradientDrawable()
        d.setColor(0xFFFAFBFD.toInt())
        d.setCornerRadius(14f * resources.displayMetrics.density)
        d.setStroke(dp(1), HAIR)
        return d
    }

    private fun ripple(content: android.graphics.drawable.Drawable? = null): RippleDrawable {
        return RippleDrawable(ColorStateList.valueOf(0x226366F1),
            content, ColorDrawable(0xFFFFFFFF.toInt()))
    }

    /** 象限卡面:白底大圆角 + 发丝描边 */
    private fun cardBg(): GradientDrawable {
        val d = GradientDrawable()
        d.setColor(SURFACE)
        d.cornerRadius = 14f * resources.displayMetrics.density
        d.setStroke(dp(1), 0xFFF2F4F9.toInt())
        return d
    }

    private fun tonalColor(color: Int): Int =
        Color.argb(30, Color.red(color), Color.green(color), Color.blue(color))

    /** 象限格子底色:统一浅暖白,象限色只做点睛(标题/胶囊/勾选圈) */
    private fun cellBg(@Suppress("UNUSED_PARAMETER") color: Int, alpha: Int): GradientDrawable {
        val d = GradientDrawable()
        val base = if (alpha > 60) 0xFFF3F0E9.toInt() else 0xFFF7F5F0.toInt()
        d.setColor(base)
        d.cornerRadius = 12f * resources.displayMetrics.density
        return d
    }

    /** 对话框变底部弹层:贴底 + 上圆角 + 上滑入场 */
    private fun sheetify(dialog: AlertDialog, content: View) {
        val w = dialog.window ?: return
        val bg = GradientDrawable()
        bg.setColor(SURFACE)
        val r = 26f * resources.displayMetrics.density
        bg.cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
        w.setBackgroundDrawable(bg)
        w.setGravity(Gravity.BOTTOM)
        w.setLayout(android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            android.view.ViewGroup.LayoutParams.WRAP_CONTENT)
        content.post {
            content.translationY = content.height.toFloat()
            content.animate().translationY(0f).setDuration(130)
                .setInterpolator(DecelerateInterpolator(1.5f)).start()
        }
    }

    /** 底部弹层顶部的小灰条手柄 */
    private fun grabber(): View {
        val v = View(this)
        v.background = roundedSolid(0xFFE3E7EF.toInt(), 99f)
        v.layoutParams = LinearLayout.LayoutParams(dp(36), dp(4)).also {
            it.gravity = Gravity.CENTER_HORIZONTAL
            it.topMargin = dp(10)
            it.bottomMargin = dp(6)
        }
        return v
    }
}