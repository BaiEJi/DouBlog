/**
 * Background service worker（经典脚本，非 module）。
 * 职责：每 30 分钟查询一次 /migrations/pending，把数量写到扩展图标 badge 上（橙色）。
 * 出错静默（后端未启动等情况不影响用户）。
 * 注意：service worker 中没有 DOM/localStorage，但 chrome.storage 可用，
 * 因此这里复用 js/ 下同一份存储包装层与 API 客户端。
 */
/* global MYTODO_API */
importScripts('js/config.js', 'js/storage.js', 'js/api.js');

var ALARM_NAME = 'mytodo-migrations-check';
var BADGE_COLOR = '#F59E0B'; // 橙色

/** 查询待迁移数量并更新 badge；任何异常静默吞掉 */
async function checkPendingMigrations() {
  try {
    var list = await MYTODO_API.getPendingMigrations();
    var n = Array.isArray(list) ? list.length : 0;
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
  } catch (e) {
    // 静默失败：保持现有 badge 不变
  }
}

// ---- 任务定时通知（chrome 渠道） ----
// 后端 /today 的任务带 notify_enabled / notify_time("HH:MM") / notify_channels；
// 其中渠道含 "chrome" 的任务由本扩展在对应时间弹系统通知（服务端只实现邮件渠道）。
var NOTIFY_ALARM_PREFIX = 'todo-notify-';
var NOTIFY_SYNC_ALARM = 'mytodo-notify-sync';
var NOTIFIED_KEY_PREFIX = 'mytodo_notified_'; // + YYYY-MM-DD → 已通知 taskId 数组
var NOTIFY_QUEUE_KEY = 'mytodo_notify_queue'; // alarmName → { taskId, title, date }
var NOTIFY_CATCHUP_MS = 10 * 60 * 1000;      // 错过 10 分钟内补发，更久静默跳过

function _todayStr() {
  var d = new Date();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

async function _getNotified(dateStr) {
  var list = await MYTODO_STORAGE.get(NOTIFIED_KEY_PREFIX + dateStr, []);
  return Array.isArray(list) ? list : [];
}

async function _markNotified(dateStr, taskId) {
  var list = await _getNotified(dateStr);
  if (list.indexOf(taskId) === -1) {
    list.push(taskId);
    await MYTODO_STORAGE.set(NOTIFIED_KEY_PREFIX + dateStr, list);
  }
}

function _showTodoNotification(title) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'MyTodo 待办提醒',
      message: title,
      priority: 2,
    });
  } catch (e) { /* 忽略 */ }
}

/** 闹钟到点：先复查任务当前状态，仍未完成才通知（已完成/已删除则静默跳过） */
async function fireTodoNotification(alarmName) {
  var queue = (await MYTODO_STORAGE.get(NOTIFY_QUEUE_KEY, {})) || {};
  var info = queue[alarmName];
  if (info) {
    var shouldNotify = true;
    try {
      var today = await MYTODO_API.getToday();
      var t = null;
      (((today && today.quadrants) || [])).forEach(function (q) {
        ((q && q.tasks) || []).forEach(function (x) { if (x.id === info.taskId) t = x; });
      });
      if (!t || t.completed_at) shouldNotify = false; // 到点时已删除或已完成 → 不打扰
    } catch (e) { /* 复查失败(后端未启动等)按计划通知,宁可提醒不可漏提醒 */ }
    if (shouldNotify) _showTodoNotification(info.title);
    await _markNotified(info.date, info.taskId);
    delete queue[alarmName];
    await MYTODO_STORAGE.set(NOTIFY_QUEUE_KEY, queue);
  }
  try { chrome.alarms.clear(alarmName); } catch (e) { /* 忽略 */ }
}

/**
 * 同步今天的定时通知：为「notify 且渠道含 chrome 且未完成」的任务建精确一次性闹钟；
 * 已通知过的跳过；错过 ≤10 分钟的补发，更久的标记跳过；清理不再需要的旧闹钟。
 */
async function syncTodoNotifications() {
  try {
    var today = await MYTODO_API.getToday();
    var dateStr = _todayStr();
    var notified = await _getNotified(dateStr);
    var newQueue = {};
    var markIds = []; // 本轮需记为"已通知"的任务,循环外合并一次写入(避免并发覆盖)
    var now = Date.now();
    var tasks = [];
    (((today && today.quadrants) || [])).forEach(function (q) {
      ((q && q.tasks) || []).forEach(function (t) { tasks.push(t); });
    });
    tasks.forEach(function (t) {
      if (!t || !t.notify_enabled || !t.notify_time || t.completed_at) return;
      if ((t.notify_channels || []).indexOf('chrome') === -1) return;
      if (notified.indexOf(t.id) !== -1) return;
      var m = /^(\d{1,2}):(\d{2})$/.exec(String(t.notify_time));
      if (!m) return;
      var when = new Date();
      when.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
      var ts = when.getTime();
      if (ts > now) {
        var name = NOTIFY_ALARM_PREFIX + t.id;
        chrome.alarms.create(name, { when: ts }); // 同名重建=时间刷新
        newQueue[name] = { taskId: t.id, title: t.title, date: dateStr };
      } else if (now - ts <= NOTIFY_CATCHUP_MS) {
        _showTodoNotification(t.title); // 刚错过：补发
        markIds.push(t.id);
      } else {
        markIds.push(t.id); // 错过太久：静默跳过并记录，避免反复重试
      }
    });
    if (markIds.length) {
      var notifiedKey = NOTIFIED_KEY_PREFIX + dateStr;
      var merged = notified.slice();
      markIds.forEach(function (id) {
        if (merged.indexOf(id) === -1) merged.push(id);
      });
      await MYTODO_STORAGE.set(notifiedKey, merged);
    }
    // 清理本轮不再需要的任务闹钟（任务已完成/改渠道/已通知）
    var all = await chrome.alarms.getAll();
    for (var i = 0; i < all.length; i++) {
      var name = all[i].name;
      if (name.indexOf(NOTIFY_ALARM_PREFIX) === 0 && !newQueue[name]) {
        chrome.alarms.clear(name);
      }
    }
    await MYTODO_STORAGE.set(NOTIFY_QUEUE_KEY, newQueue);
  } catch (e) {
    // 静默失败：后端未启动等情况不影响其他功能
  }
}

chrome.runtime.onInstalled.addListener(function () {
  try {
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 30 });
    chrome.alarms.create(NOTIFY_SYNC_ALARM, { delayInMinutes: 0.5, periodInMinutes: 5 });
  } catch (e) { /* 忽略 */ }
  checkPendingMigrations();
  syncTodoNotifications();
});

chrome.runtime.onStartup.addListener(function () {
  checkPendingMigrations();
  syncTodoNotifications();
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  var name = (alarm && alarm.name) || '';
  if (name === ALARM_NAME) {
    checkPendingMigrations();
  } else if (name === NOTIFY_SYNC_ALARM) {
    syncTodoNotifications();
  } else if (name.indexOf(NOTIFY_ALARM_PREFIX) === 0) {
    fireTodoNotification(name);
  }
});

// ---- 消息通知通道 ----
// 内容脚本/popup 无权直接调 chrome.notifications，统一经此处转发。
// 发送方：MYTODO_NOTIFY.show({ title, message, requireInteraction })（js/notify.js）
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return false;
  if (msg.type === 'mytodo-notify') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: msg.title || 'MyTodo 四象限',
      message: msg.message || '',
      priority: 2,
      requireInteraction: !!msg.requireInteraction,
    }, function (id) {
      sendResponse({ ok: !chrome.runtime.lastError, id: id || null });
    });
    return true; // 异步 sendResponse
  }
  if (msg.type === 'mytodo-sync-notify') {
    // 面板数据刷新后立即重排今天的任务通知闹钟（不等 5 分钟轮询）
    syncTodoNotifications();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// 点击通知 → 打开完整版 web 应用（读用户配置的 server_url）
chrome.notifications.onClicked.addListener(function () {
  MYTODO_API.getConfig().then(function (cfg) {
    chrome.tabs.create({ url: MYTODO_API.normalizeBase(cfg.server_url) + '/' });
  }).catch(function () { /* 配置读取失败则忽略 */ });
});

// service worker 冷启动时也查一次（alarm/onInstalled/onStartup 之外的唤醒场景）
checkPendingMigrations();
