/**
 * 存储包装层（可测试性关键约束）：
 * - 在扩展环境（popup / options / background）中：使用 chrome.storage.local
 * - 作为普通网页直接打开 popup.html / options.html 时：降级 localStorage
 * 所有对持久化配置的读写都必须经由本模块，业务代码不得直接触碰 chrome.* 存储 API。
 */
(function (g) {
  'use strict';

  var hasChromeStorage =
    typeof chrome !== 'undefined' &&
    !!(chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function');

  /**
   * 读取一个键。
   * @param {string} key
   * @param {*} fallback 键不存在或解析失败时返回的默认值
   * @returns {Promise<*>}
   */
  async function get(key, fallback) {
    if (fallback === undefined) fallback = null;
    if (hasChromeStorage) {
      try {
        var obj = await chrome.storage.local.get(key);
        return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : fallback;
      } catch (e) {
        return fallback;
      }
    }
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  /**
   * 写入一个键（JSON 序列化）。
   * @param {string} key
   * @param {*} value
   * @returns {Promise<void>}
   */
  async function set(key, value) {
    if (hasChromeStorage) {
      var item = {};
      item[key] = value;
      await chrome.storage.local.set(item);
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  }

  /**
   * 监听某个键被(其他页面/上下文)修改:新值到达时回调。
   * 扩展环境用 chrome.storage.onChanged(所有标签页的内容脚本都会收到);
   * 网页降级环境用 window 'storage' 事件(同源其他标签页收到,发起页不触发,天然无回环)。
   * @param {string} key
   * @param {function(*):void} cb 收到的新值(键被删除时为 null)
   */
  function onChanged(key, cb) {
    if (hasChromeStorage) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, key)) {
          cb(changes[key].newValue);
        }
      });
      return;
    }
    window.addEventListener('storage', function (e) {
      if (e.key !== key) return;
      if (e.newValue === null) return cb(null);
      try { cb(JSON.parse(e.newValue)); } catch (err) { /* ignore */ }
    });
  }

  g.MYTODO_STORAGE = {
    get: get,
    set: set,
    onChanged: onChanged,
    usingChromeStorage: hasChromeStorage
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
