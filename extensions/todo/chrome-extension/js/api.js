/**
 * MyTodo 后端 API 客户端（经典脚本，popup / options / background 共用）。
 * Base: {server_url}/api/v1，认证：Authorization: Bearer {token}。
 * 响应加密：所有请求带 X-MyTodo-Enc: 1，服务端返回 AES-256-GCM 密文信封时自动解密
 * （docs/2026-09-14-容量上限与token响应加密.md）；无 encrypted 字段则按明文处理。
 */
(function (g) {
  'use strict';

  /** 读取合并后的配置（默认值 + options 页保存的覆盖值） */
  async function getConfig() {
    var saved = await g.MYTODO_STORAGE.get(g.MYTODO.CONFIG_KEY, {});
    return Object.assign({}, g.MYTODO.DEFAULT_CONFIG, saved || {});
  }

  /** 保存配置（options 页使用） */
  async function saveConfig(patch) {
    var current = await g.MYTODO_STORAGE.get(g.MYTODO.CONFIG_KEY, {});
    var next = Object.assign({}, g.MYTODO.DEFAULT_CONFIG, current || {}, patch || {});
    await g.MYTODO_STORAGE.set(g.MYTODO.CONFIG_KEY, next);
    return next;
  }

  function normalizeBase(serverUrl) {
    return String(serverUrl || '').trim().replace(/\/+$/, '');
  }

  /* ---------------- 响应解密(AES-256-GCM) ---------------- */

  function _b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  var _keyCache = null; // { secret, key } —— 密钥字符串 → 已导入的 CryptoKey

  /** secret 字符串 → SHA-256 → AES-GCM CryptoKey（按密钥串缓存） */
  async function _importKey(secret) {
    if (_keyCache && _keyCache.secret === secret) return _keyCache.key;
    if (!g.crypto || !g.crypto.subtle) {
      throw new Error('当前环境不支持 WebCrypto,无法解密加密响应');
    }
    var digest = await g.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    var key = await g.crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
    _keyCache = { secret: secret, key: key };
    return key;
  }

  /**
   * 解密响应信封 → 明文对象。
   * 信封: { encrypted:true, iv: b64(12B nonce), payload: b64(密文||16B tag) }
   * tag 校验失败抛"密钥不一致"提示(文档约定的客户端行为)。
   */
  async function decryptEnvelope(env, secret) {
    var key = await _importKey(secret);
    var plain = await g.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: _b64ToBytes(env.iv) },
      key,
      _b64ToBytes(env.payload)
    );
    var text = new TextDecoder().decode(plain);
    return text ? JSON.parse(text) : null;
  }

  /**
   * 底层请求：拼 URL、带 Bearer 头与加密标记头、统一错误信息。
   * @param {string} path 形如 '/today'、'/tasks'
   * @param {{method?:string, body?:object}} [opts]
   */
  async function request(path, opts) {
    opts = opts || {};
    var cfg = await getConfig();
    var base = normalizeBase(cfg.server_url) + '/api/v1';
    var headers = { 'X-MyTodo-Enc': '1' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (cfg.token) headers['Authorization'] = 'Bearer ' + cfg.token;

    var resp;
    try {
      resp = await fetch(base + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      });
    } catch (e) {
      var netErr = new Error('无法连接服务器（' + normalizeBase(cfg.server_url) + '）');
      netErr.network = true;
      throw netErr;
    }

    // 统一先取信封/明文 JSON,再按状态码分支(422 等错误体同样可能被加密)
    var data = null;
    var raw = await resp.text();
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (e) {
        data = null;
      }
      if (data && data.encrypted === true) {
        try {
          data = await decryptEnvelope(data, cfg.secret_key || g.MYTODO.DEFAULT_CONFIG.secret_key);
        } catch (e) {
          var decErr = new Error('响应解密失败,请检查密钥设置是否与服务端一致');
          decErr.status = resp.status;
          decErr.decrypt = true;
          throw decErr;
        }
      }
    }

    if (!resp.ok) {
      var msg = 'HTTP ' + resp.status;
      if (data && data.detail) msg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
      var err = new Error(msg);
      err.status = resp.status;
      throw err;
    }
    if (resp.status === 204) return null;
    return data;
  }

  /* ---------------- 业务接口 ---------------- */

  /** GET /today → 今日四象限聚合（含 pending_migrations / streak / yesterday） */
  function getToday() {
    return request('/today');
  }

  /** POST /tasks → 201 Task。p: {title, is_important, is_urgent, task_date:"today"} */
  function createTask(p) {
    return request('/tasks', { method: 'POST', body: p });
  }

  /** POST /tasks/{id}/complete → Task(status=done)。note 可选:完成备注(空白按无备注) */
  function completeTask(id, note) {
    var n = typeof note === 'string' ? note.trim() : '';
    return request('/tasks/' + encodeURIComponent(id) + '/complete', {
      method: 'POST',
      body: n ? { note: n } : undefined // 无备注时不带 body,与老客户端行为一致
    });
  }

  /** POST /tasks/{id}/reopen → Task(status=pending) */
  function reopenTask(id) {
    return request('/tasks/' + encodeURIComponent(id) + '/reopen', { method: 'POST' });
  }

  /** GET /migrations/pending → 待迁移任务数组（含 intervention_required） */
  function getPendingMigrations() {
    return request('/migrations/pending');
  }

  /** POST /migrations/bulk body {task_ids:[...], to_date:"today"} → {migrated:n} */
  function bulkMigrate(taskIds, toDate) {
    return request('/migrations/bulk', {
      method: 'POST',
      body: { task_ids: taskIds, to_date: toDate || 'today' }
    });
  }

  /** GET /categories → [{id,name,color,icon,...}] */
  function getCategories() {
    return request('/categories');
  }

  /** POST /tasks/{id}/reorder {before_task_id} → 象限内排序(null=移到尾部) */
  function reorderTask(id, beforeTaskId) {
    return request('/tasks/' + encodeURIComponent(id) + '/reorder', {
      method: 'POST',
      body: { before_task_id: beforeTaskId || null }
    });
  }

  /** POST /tasks/{id}/move {is_important,is_urgent,before_task_id} → 跨象限移动(可带位置) */
  function moveTask(id, isImportant, isUrgent, beforeTaskId) {
    return request('/tasks/' + encodeURIComponent(id) + '/move', {
      method: 'POST',
      body: {
        is_important: !!isImportant,
        is_urgent: !!isUrgent,
        before_task_id: beforeTaskId || null
      }
    });
  }

  /** PATCH /tasks/{id} → 编辑任务(须带 revision 乐观锁) */
  function updateTask(id, body) {
    return request('/tasks/' + encodeURIComponent(id), { method: 'PATCH', body: body });
  }

  /* ---------------- 规律生活(计划) ---------------- */

  /** GET /plans/today?date= → { date, items:[{plan, task|null}] } 当天有安排的计划打卡清单 */
  function getPlansToday(date) {
    return request('/plans/today' + (date ? '?date=' + encodeURIComponent(date) : ''));
  }

  /** GET /plans → PlanOut[] */
  function listPlans() {
    return request('/plans');
  }

  /** POST /plans → 创建计划(类型必选,无象限)。body: {title,description,category_id,start_date,end_date,rule} */
  function createPlan(body) {
    return request('/plans', { method: 'POST', body: body });
  }

  /** PATCH /plans/{id} → 编辑计划(字段可选;enabled 启停) */
  function updatePlan(id, body) {
    return request('/plans/' + encodeURIComponent(id), { method: 'PATCH', body: body });
  }

  /** DELETE /plans/{id} → 删除计划(连同未来实例) */
  function deletePlan(id) {
    return request('/plans/' + encodeURIComponent(id), { method: 'DELETE' });
  }

  g.MYTODO_API = {
    getConfig: getConfig,
    saveConfig: saveConfig,
    normalizeBase: normalizeBase,
    request: request,
    getToday: getToday,
    createTask: createTask,
    completeTask: completeTask,
    reopenTask: reopenTask,
    getPendingMigrations: getPendingMigrations,
    bulkMigrate: bulkMigrate,
    getCategories: getCategories,
    reorderTask: reorderTask,
    moveTask: moveTask,
    updateTask: updateTask,
    getPlansToday: getPlansToday,
    listPlans: listPlans,
    createPlan: createPlan,
    updatePlan: updatePlan,
    deletePlan: deletePlan
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
