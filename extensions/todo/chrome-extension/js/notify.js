/**
 * 消息通知通道（统一发送入口，供 content/popup/options 及后续功能调用）：
 * - 扩展环境：chrome.runtime.sendMessage 转发给 background service worker，
 *   由它调用 chrome.notifications 弹系统通知（内容脚本无权直接调）。
 * - 普通网页降级环境（测试页）：直接走 W3C Notification API。
 *
 * 用法：MYTODO_NOTIFY.show({ title: '标题', message: '内容', requireInteraction: false })
 * 返回 Promise<'shown' | 'denied' | 'unsupported' | 'error'>，便于调用方处理结果。
 */
(function (g) {
  'use strict';

  var inExtension =
    typeof chrome !== 'undefined' &&
    !!(chrome.runtime && chrome.runtime.id);

  /** 扩展路径：经后台 service worker 弹 chrome.notifications */
  function showViaBackground(opt) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(
          { type: 'mytodo-notify', title: opt.title, message: opt.message, requireInteraction: !!opt.requireInteraction },
          function (res) {
            if (chrome.runtime.lastError) return resolve('error');
            resolve(res && res.ok ? 'shown' : 'error');
          }
        );
      } catch (e) {
        resolve('error');
      }
    });
  }

  /** 网页降级路径：W3C Notification API（需用户授权） */
  async function showViaWeb(opt) {
    if (typeof Notification === 'undefined') return 'unsupported';
    var perm = Notification.permission;
    if (perm === 'default') {
      try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; }
    }
    if (perm !== 'granted') return 'denied';
    try {
      var n = new Notification(opt.title || 'MyTodo', {
        body: opt.message || '',
        icon: 'icons/icon128.png',
        tag: 'mytodo-' + Date.now(),
      });
      n.onclick = function () { try { window.focus(); n.close(); } catch (e) { /* ignore */ } };
      return 'shown';
    } catch (e) {
      return 'error';
    }
  }

  g.MYTODO_NOTIFY = {
    /** 是否扩展环境（走 chrome.notifications 系统通知） */
    usingChromeNotifications: inExtension,
    show: function (opt) {
      opt = opt || {};
      return inExtension ? showViaBackground(opt) : showViaWeb(opt);
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
