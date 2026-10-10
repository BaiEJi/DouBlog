/**
 * background.js 任务定时通知逻辑的 Node 单测（开发用,不打入 zip）。
 * 桩掉 chrome.* / MYTODO_API / MYTODO_STORAGE,加载真实 background.js,
 * 验证:未来排闹钟 / 刚错过补发 / 错过太久跳过 / 非 chrome 渠道忽略 / 已完成清理旧闹钟 / 到点弹通知。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const now = Date.now();

// ---- chrome 桩 ----
const alarms = new Map();
const firedNotifications = [];
const storageMap = new Map();
const listeners = { alarm: null, message: null };

const chromeStub = {
  runtime: {
    id: 'test-extension-id',
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(fn) { listeners.message = fn; } },
    sendMessage() {},
    lastError: null,
  },
  action: {
    setBadgeBackgroundColor() { return Promise.resolve(); },
    setBadgeText() { return Promise.resolve(); },
  },
  alarms: {
    create(name, info) { alarms.set(name, info); },
    clear(name) { alarms.delete(name); },
    async getAll() { return [...alarms.entries()].map(([name, info]) => ({ name, ...info })); },
    onAlarm: { addListener(fn) { listeners.alarm = fn; } },
  },
  notifications: {
    create(opt, cb) { firedNotifications.push(opt); if (cb) cb('id-' + firedNotifications.length); },
    onClicked: { addListener() {} },
  },
  storage: {
    local: {
      async get(key) {
        const out = {};
        if (storageMap.has(key)) out[key] = storageMap.get(key);
        return out;
      },
      async set(obj) { Object.assign(storageMap, obj); },
    },
  },
};

// ---- 任务数据 ----
function tsIn(minFromNow) {
  const d = new Date(now + minFromNow * 60000);
  const base = new Date(now);
  if (d.getDate() !== base.getDate() || d.getMonth() !== base.getMonth()) return null; // 跨午夜:HH:MM 无法表达"昨天"
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
let skipped = 0;
function check(name, cond) {
  if (cond === null) { skipped++; console.log('  SKIP ' + name + ' (跨午夜窗口)'); return; }
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}
const tasks = [
  { id: 't-future', title: '未来任务(浏览器通知)', notify_enabled: true, notify_time: tsIn(30), notify_channels: ['chrome'], completed_at: null },
  // 跨午夜窗口(00:00-01:00 间跑测试)时,"过去 N 分钟"落在昨天无法用当天 HH:MM 表达:
  // catchup 兜底 00:00(仍在过去);toolate 无法构造 → 移除(相关断言已按 null 跳过)
  { id: 't-catchup', title: '刚错过5分钟', notify_enabled: true, notify_time: tsIn(-5) || '00:00', notify_channels: ['chrome'], completed_at: null },
  { id: 't-email', title: '仅邮件渠道', notify_enabled: true, notify_time: tsIn(30), notify_channels: ['email'], completed_at: null },
  ...(tsIn(-60) ? [{ id: 't-toolate', title: '错过1小时', notify_enabled: true, notify_time: tsIn(-60), notify_channels: ['chrome'], completed_at: null }] : []),
  { id: 't-done', title: '已完成任务', notify_enabled: true, notify_time: tsIn(20), notify_channels: ['chrome'], completed_at: '2026-09-13T01:00:00' },
];

// ---- 加载 background.js ----
const sandbox = {
  chrome: chromeStub,
  console,
  Date,
  JSON,
  Math,
  parseInt,
  String,
  Array,
  Object,
  Promise,
  importScripts() {},
  MYTODO_API: {
    getToday: async () => ({ quadrants: [{ tasks }] }),
    getPendingMigrations: async () => [],
    getConfig: async () => ({ server_url: 'http://127.0.0.1:8070' }),
    normalizeBase: (u) => u,
  },
};
sandbox.MYTODO_STORAGE = {
  get: async (k, fb) => (storageMap.has(k) ? storageMap.get(k) : fb),
  set: async (k, v) => { storageMap.set(k, v); },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const code = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
vm.runInContext(code, sandbox);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;

(async () => {
  await sandbox.syncTodoNotifications();
  await sleep(50);

  console.log('== 第一轮:排闹钟/补发/跳过 ==');
  const futureInfo = alarms.get('todo-notify-t-future');
  check('未来任务已排闹钟', tsIn(30) === null ? null : !!futureInfo);
  check('闹钟时间≈30分钟后(±90s)', tsIn(30) === null ? null : Math.abs(futureInfo.when - (now + 30 * 60000)) < 90000);
  const queue = storageMap.get('mytodo_notify_queue') || {};
  check('队列记录任务标题', queue['todo-notify-t-future'] && queue['todo-notify-t-future'].title === '未来任务(浏览器通知)');
  check('刚错过5分钟 → 立即补发1条', tsIn(-5) === null ? null : firedNotifications.length === 1 && firedNotifications[0].message === '刚错过5分钟');
  const notified = storageMap.get('mytodo_notified_' + queue['todo-notify-t-future'].date) || [];
  check('catchup+toolate 均已记账', (tsIn(-5) === null || tsIn(-60) === null) ? null : notified.includes('t-catchup') && notified.includes('t-toolate'));
  check('错过1小时 → 不重复弹', tsIn(-60) === null ? null : firedNotifications.length === 1);
  check('仅邮件渠道 → 不排闹钟', !alarms.has('todo-notify-t-email'));
  check('已完成任务 → 不排闹钟', !alarms.has('todo-notify-t-done'));

  console.log('== 第二轮:任务完成后清理闹钟 ==');
  tasks[0].completed_at = '2026-09-13T02:00:00';
  await sandbox.syncTodoNotifications();
  await sleep(50);
  check('完成后闹钟被清理', !alarms.has('todo-notify-t-future'));
  check('完成后不弹通知', tsIn(30) === null ? null : firedNotifications.length === 1);
  tasks[0].completed_at = null;

  console.log('== 第三轮:闹钟到点弹通知 ==');
  await sandbox.syncTodoNotifications();
  await sleep(50);
  check('重新排上闹钟', alarms.has('todo-notify-t-future'));
  await listeners.alarm({ name: 'todo-notify-t-future' });
  await sleep(50);
  check('到点弹通知(共2条)', tsIn(30) === null ? null : firedNotifications.length === 2 && firedNotifications[1].message === '未来任务(浏览器通知)');
  const q2 = storageMap.get('mytodo_notify_queue') || {};
  check('队列已清理', !q2['todo-notify-t-future']);
  const dateKey = [...storageMap.keys()].find(k => k.startsWith('mytodo_notified_'));
  check('已通知列表包含该任务', (storageMap.get(dateKey) || []).includes('t-future'));

  await sandbox.syncTodoNotifications();
  await sleep(50);
  check('已通知过 → 不再排闹钟', !alarms.has('todo-notify-t-future'));

  console.log('== 第四轮:到点时已完成/已删除 → 不通知 ==');
  // 只把 t-future 移出记账(保留 catchup/toolate,避免它们的补发重新触发干扰计数)
  const resetFutureOnly = () => storageMap.set(dateKey, (storageMap.get(dateKey) || []).filter(id => id !== 't-future'));
  resetFutureOnly();
  await sandbox.syncTodoNotifications();
  await sleep(50);
  check('重置记账后闹钟重新排上', alarms.has('todo-notify-t-future'));
  tasks[0].completed_at = '2026-09-13T03:00:00'; // 到点前完成
  await listeners.alarm({ name: 'todo-notify-t-future' });
  await sleep(50);
  check('到点时已完成 → 不弹(仍2条)', tsIn(30) === null ? null : firedNotifications.length === 2);

  tasks[0].completed_at = null;
  const idx = tasks.indexOf(tasks[0]);
  const removed = tasks.splice(idx, 1)[0];
  resetFutureOnly();
  await sandbox.syncTodoNotifications();
  await sleep(50);
  check('任务已删除 → 本轮不排闹钟', !alarms.has('todo-notify-t-future'));
  // 排上之后才删的场景:恢复→排→删→触发
  tasks.push(removed);
  resetFutureOnly();
  await sandbox.syncTodoNotifications();
  await sleep(50);
  check('恢复后闹钟已排', alarms.has('todo-notify-t-future'));
  tasks.splice(tasks.indexOf(removed), 1);
  await listeners.alarm({ name: 'todo-notify-t-future' });
  await sleep(50);
  check('到点时已删除 → 不弹(仍2条)', tsIn(30) === null ? null : firedNotifications.length === 2);
  tasks.push(removed);

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
