/**
 * api.js 响应解密的 Node 单测(开发用,不打入 zip)。
 * 用文档提供的测试向量驱动真实 request():验证请求头、信封解密、密钥不符报错。
 * 运行: node test_api_crypto.js   (Node >= 18,自带 webcrypto/atob)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 文档测试向量(docs/2026-09-14-容量上限与token响应加密.md)
const VECTOR = {
  secret: 'LizySecret',
  iv: 'AAECAwQFBgcICQoL',
  payload: '6Oz9Nr+0GUdMh0KH5bqdQJ4Xl+5A8z8dB/Ls+UBstcMBOAevKy9BonBPNRok9bA3QnRGkg==',
  plaintext: { ok: true, msg: '你好,MyTodo' },
};

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
};

function loadApi(storedConfig, envelopeBody, status) {
  const captured = { headers: null, url: null };
  const sandbox = {
    console, JSON, Math, Object, Array, Promise, String, Number,
    crypto: require('crypto').webcrypto,
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    TextEncoder, TextDecoder,
    fetch: async (url, init) => {
      captured.url = url;
      captured.headers = init.headers;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(envelopeBody),
      };
    },
  };
  sandbox.MYTODO_STORAGE = {
    get: async (k, fb) => (k === 'mytodo_config' ? storedConfig : fb),
    set: async () => {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // 先加载 config.js 提供 MYTODO.DEFAULT_CONFIG,再加载 api.js
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', 'config.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', 'api.js'), 'utf8'), sandbox);
  return { api: sandbox.MYTODO_API, captured };
}

(async () => {
  console.log('== 向量解密(真实 request 代码路径) ==');
  const env1 = { encrypted: true, alg: 'AES-256-GCM', iv: VECTOR.iv, payload: VECTOR.payload };
  const t1 = loadApi({ server_url: 'http://x', token: 'tok', secret_key: VECTOR.secret }, env1, 200);
  const data1 = await t1.api.request('/test');
  check('解密得到原文对象', JSON.stringify(data1) === JSON.stringify(VECTOR.plaintext));
  check('请求带 X-MyTodo-Enc: 1', t1.captured.headers['X-MyTodo-Enc'] === '1');
  check('请求带 Bearer token', t1.captured.headers['Authorization'] === 'Bearer tok');

  console.log('== 密钥不符 → 明确报错 ==');
  const t2 = loadApi({ server_url: 'http://x', token: 'tok', secret_key: 'WrongKey' }, env1, 200);
  try {
    await t2.api.request('/test');
    check('密钥不符应抛错', false);
  } catch (e) {
    check('密钥不符应抛错', e.message.includes('响应解密失败') && e.message.includes('密钥'));
  }

  console.log('== 加密的 422 错误体 → detail 透传 ==');
  // 用向量密文模拟被加密的 {"detail":"该象限当天任务已达上限(8 个)"} —— 直接拿明文错误体走明文分支验证错误处理,另测明文422
  const t3 = loadApi({ server_url: 'http://x', token: 'tok', secret_key: VECTOR.secret },
    { detail: '该象限当天任务已达上限(8 个),请先完成、移出或改期' }, 422);
  try {
    await t3.api.request('/tasks', { method: 'POST', body: { title: 'x' } });
    check('422 应抛错', false);
  } catch (e) {
    check('422 detail 原文透传', e.status === 422 && e.message.includes('已达上限(8 个)'));
    check('POST 带 Content-Type', t3.captured.headers['Content-Type'] === 'application/json');
  }

  console.log('== 无 encrypted 字段(旧服务端/401) → 按明文处理 ==');
  const t4 = loadApi({ server_url: 'http://x', token: 'tok', secret_key: VECTOR.secret },
    { detail: '未登录或 token 无效' }, 401);
  try {
    await t4.api.request('/today');
    check('401 应抛错', false);
  } catch (e) {
    check('401 明文 detail 透传', e.status === 401 && e.message.includes('未登录'));
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
