/**
 * MyTodo 扩展全局配置与常量。
 * 经典脚本（无模块语法），popup / options 通过 <script src> 加载，
 * background service worker 通过 importScripts() 加载，三处共用同一份配置。
 */
(function (g) {
  'use strict';

  /** chrome.storage.local / localStorage 中保存配置的键名 */
  var CONFIG_KEY = 'mytodo_config';

  /** 默认配置：服务器地址 + lizy 的永久 token（永不过期）+ 网页机器人开关 + 响应解密密钥 */
  var DEFAULT_CONFIG = {
    server_url: 'http://127.0.0.1:8070',
    token: 'MDFhMDk0MTQtOWE0Yi03MGMzLWJiZDMtNGVkY2I5ODA5M2IzOjI1MzQwMjMwMDc5OTo3ZDljYTE3MzIyZWYxN2U2ZWVkNzY5Yjg3NTVhMmNhYWFlODkxMDhhNDg1MjUwMjkyNDQyZmU1NTM0MzQzNmRm',
    robot_enabled: true,
    secret_key: 'LizySecret' // 与服务端 config.json 的 response_secret 保持一致
  };

  /** 四象限语义与配色 */
  var QUADRANTS = {
    1: { name: '立即做', subtitle: '重要且紧急', color: '#ef4444', is_important: true, is_urgent: true },
    2: { name: '计划做', subtitle: '重要不紧急', color: '#6366f1', is_important: true, is_urgent: false },
    3: { name: '委派·批量', subtitle: '紧急不重要', color: '#f59e0b', is_important: false, is_urgent: true },
    4: { name: '考虑删除', subtitle: '不紧急不重要', color: '#94a3b8', is_important: false, is_urgent: false }
  };

  /** popup 中的视觉排列顺序：Q2 左上、Q1 右上（最重要）、Q4 左下、Q3 右下 */
  var QUADRANT_ORDER = [2, 1, 4, 3];

  g.MYTODO = {
    CONFIG_KEY: CONFIG_KEY,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    QUADRANTS: QUADRANTS,
    QUADRANT_ORDER: QUADRANT_ORDER
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
