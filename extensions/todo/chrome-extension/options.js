/**
 * options 页逻辑：读取/保存服务器地址与 token，附带连接测试。
 * 同样经由存储包装层与 API 客户端，可直接作为普通网页打开测试。
 */
/* global MYTODO, MYTODO_STORAGE, MYTODO_API */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  var form = $('opt-form');
  var serverUrlInput = $('server-url');
  var tokenInput = $('token');
  var secretInput = $('secret-key');
  var robotInput = $('robot-enabled');
  var saveBtn = $('save-btn');
  var testBtn = $('test-btn');
  var statusEl = $('status');

  var statusTimer = null;
  function setStatus(msg, cls) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
    if (statusTimer) clearTimeout(statusTimer);
    if (cls === 'ok') statusTimer = setTimeout(function () { statusEl.textContent = ''; }, 3000);
  }

  async function load() {
    var cfg = await MYTODO_API.getConfig();
    serverUrlInput.value = cfg.server_url || '';
    tokenInput.value = cfg.token || '';
    secretInput.value = cfg.secret_key || '';
    robotInput.checked = cfg.robot_enabled !== false;
  }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
    var token = tokenInput.value.trim();
    if (!serverUrl) {
      setStatus('服务器地址不能为空', 'err');
      return;
    }
    if (!/^https?:\/\//.test(serverUrl)) {
      setStatus('服务器地址需以 http:// 或 https:// 开头', 'err');
      return;
    }
    saveBtn.disabled = true;
    try {
      await MYTODO_API.saveConfig({
        server_url: serverUrl,
        token: token,
        secret_key: secretInput.value.trim() || MYTODO.DEFAULT_CONFIG.secret_key,
        robot_enabled: robotInput.checked
      });
      setStatus('已保存（存储方式：' + (MYTODO_STORAGE.usingChromeStorage ? 'chrome.storage' : 'localStorage') + '）', 'ok');
    } catch (e) {
      setStatus('保存失败：' + e.message, 'err');
    } finally {
      saveBtn.disabled = false;
    }
  });

  // 令牌/密钥默认遮蔽(******),点眼睛切换明文
  document.querySelectorAll('.secret-row .eye').forEach(function (btn) {
    btn.addEventListener('click', function (ev) {
      ev.preventDefault(); // 阻止 label 默认聚焦,避免闪烁
      var input = document.getElementById(btn.dataset.for);
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('on', show);
      btn.title = show ? '点击隐藏' : '点击查看';
      btn.textContent = show ? '🙈' : '👁';
    });
  });

  // 用输入框中的当前值（不必先保存）测一次 GET /today
  testBtn.addEventListener('click', async function () {    var serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
    var token = tokenInput.value.trim();
    if (!/^https?:\/\//.test(serverUrl)) {
      setStatus('服务器地址需以 http:// 或 https:// 开头', 'err');
      return;
    }
    testBtn.disabled = true;
    setStatus('连接中…');
    try {
      var resp = await fetch(serverUrl + '/api/v1/today', {
        headers: token ? { Authorization: 'Bearer ' + token } : {}
      });
      if (!resp.ok) {
        setStatus('连接失败：HTTP ' + resp.status, 'err');
        return;
      }
      var data = await resp.json();
      var total = (data.quadrants || []).reduce(function (s, q) { return s + (q.pending_count || 0); }, 0);
      setStatus('连接成功：今天共 ' + total + ' 个待办，连续活跃 ' +
        (data.streak ? data.streak.current : '?') + ' 天', 'ok');
    } catch (e) {
      setStatus('连接失败：' + e.message, 'err');
    } finally {
      testBtn.disabled = false;
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
