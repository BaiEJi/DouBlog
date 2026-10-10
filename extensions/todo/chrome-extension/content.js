/**
 * 页面机器人:在任意网页右下角悬浮 AI 助手风格的渐变球,点击弹出四象限待办面板。
 * 视觉参照 Monica/Sider 等助手扩展的悬浮球范式:
 * - 品牌渐变球体 + 呼吸光环(只动 transform/opacity,性能友好) + 自绘 SVG 机器人(会眨眼)
 * - 悬停出现气泡提示;拖拽换位,位置记忆(mytodo_robot_pos)
 * - 面板:毛玻璃质感描边、大圆角、弹性入场动画、气泡尾巴
 * - options 页可关闭(robot_enabled=false 时不注入)
 */
/* global MYTODO, MYTODO_STORAGE */
(function () {
  'use strict';

  if (window.top !== window.self) return; // 只在顶层页面注入

  var hasExt =
    typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function';
  var POPUP_URL = hasExt
    ? chrome.runtime.getURL('popup.html')
    : new URL('popup.html', document.baseURI).href;

  var ROBOT_POS_KEY = 'mytodo_robot_pos';
  var PANEL_SIZE_KEY = 'mytodo_robot_panel_size';
  var DRAG_THRESHOLD = 6; // 位移小于此值视为点击
  var PANEL_RATIO = 1;          // 固定正方形比例(四象限天然 1:1)
  var PANEL_DEFAULT_SIDE = 800; // 默认边长(视口内尽量大)
  var PANEL_SIDE_MIN = 600;     // 最小边长,绝不能更小;放大无上限(仅受视口约束)
  var state = { right: 28, bottom: 28, open: false, dragging: false, resizing: false, pw: null, ph: null };
  var ui = {}; // btn / panel / iframe / tip / rsz

  var ROBOT_SVG =
    '<svg class="icon" viewBox="0 0 24 24" width="27" height="27" aria-hidden="true">' +
    '<line x1="12" y1="7.4" x2="12" y2="5.2" stroke="rgba(255,255,255,.92)" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="12" cy="4.3" r="1.35" fill="#fff"/>' +
    '<rect x="2.6" y="11.2" width="2.1" height="4.2" rx="1.05" fill="rgba(255,255,255,.92)"/>' +
    '<rect x="19.3" y="11.2" width="2.1" height="4.2" rx="1.05" fill="rgba(255,255,255,.92)"/>' +
    '<rect x="5" y="7.4" width="14" height="11.6" rx="4" fill="#fff"/>' +
    '<circle class="eye" cx="9.4" cy="12.8" r="1.55" fill="#1e40af"/>' +
    '<circle class="eye" cx="14.6" cy="12.8" r="1.55" fill="#1e40af"/>' +
    '<path d="M9.6 16.2h4.8" stroke="#1e40af" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

  var STYLE = [
    ':host{all:initial}',
    '*{box-sizing:border-box;margin:0;padding:0}',

    /* ---------- 悬浮球 ---------- */
    '.robot{position:fixed;width:56px;height:56px;border-radius:50%;',
    '  display:flex;align-items:center;justify-content:center;user-select:none;',
    '  background:linear-gradient(135deg,#3B82F6 0%,#4F6BFA 55%,#2563EB 100%);',
    '  box-shadow:0 6px 18px -4px rgba(59,99,246,.5),0 2px 6px rgba(15,23,42,.18),',
    '             inset 0 2px 3px rgba(255,255,255,.45),inset 0 -3px 6px rgba(76,29,149,.28);',
    '  cursor:default;z-index:2147483647;',
    '  transition:transform .22s cubic-bezier(.34,1.56,.64,1),box-shadow .22s ease;',
    '  -webkit-tap-highlight-color:transparent}',
    '.robot:hover{transform:scale(1.1);',
    '  box-shadow:0 10px 26px -4px rgba(59,99,246,.55),0 3px 8px rgba(15,23,42,.2),',
    '             inset 0 2px 3px rgba(255,255,255,.5),inset 0 -3px 6px rgba(76,29,149,.3)}',
    '.robot:active{transform:scale(.94)}',
    '.robot.dragging{cursor:default;transform:scale(1.06);opacity:.95}',
    '.robot.open{transform:scale(.92)}',
    '.robot.open:hover{transform:scale(.98)}',
    '.robot .icon{display:block;transition:transform .25s cubic-bezier(.34,1.56,.64,1);filter:drop-shadow(0 1px 2px rgba(15,23,42,.25))}',
    '.robot.open .icon{transform:rotate(-10deg) scale(.92)}',

    /* 悬停气泡提示 */
    '.tip{position:fixed;z-index:2147483647;pointer-events:none;white-space:nowrap;',
    '  background:rgba(15,23,42,.92);color:#fff;font:600 12px/1 system-ui,sans-serif;',
    '  padding:7px 12px;border-radius:999px;box-shadow:0 4px 14px rgba(15,23,42,.3);',
    '  opacity:0;transform:translateX(6px) scale(.92);transform-origin:right center;',
    '  transition:opacity .18s ease,transform .18s cubic-bezier(.34,1.56,.64,1)}',
    '.tip.show{opacity:1;transform:translateX(0) scale(1)}',
    '.tip::after{content:"";position:absolute;right:-4px;top:50%;width:9px;height:9px;',
    '  background:inherit;border-radius:2px;transform:translateY(-50%) rotate(45deg)}',

    /* ---------- 待办面板(尺寸完全由 JS 钳制:上限800×1280,最小400×560保证可读,视口收缩) ---------- */
    '.panel{position:fixed;width:402px;height:648px;',
    '  border-radius:20px;overflow:hidden;z-index:2147483645;display:none;',
    '  background:#ecf3fb;',
    '  box-shadow:0 2px 6px rgba(15,23,42,.06),0 12px 32px -8px rgba(15,23,42,.16),',
    '             0 32px 72px -24px rgba(15,23,42,.22),0 0 0 1px rgba(15,23,42,.05);',
    '  transform-origin:100% 100%}',
    '.panel.open{display:block;animation:pop .28s cubic-bezier(.34,1.56,.64,1)}',
    '@keyframes pop{from{opacity:0;transform:translateY(14px) scale(.94)}}',
    '.panel iframe{width:100%;height:100%;border:0;display:block;background:#ecf3fb}',
    '.close{position:absolute;top:17px;right:14px;width:28px;height:28px;border-radius:9px;border:none;',
    '  background:rgba(100,116,139,.22);backdrop-filter:blur(8px);color:#fff;font-size:13px;font-weight:600;',
    '  font-family:system-ui,sans-serif;line-height:28px;text-align:center;cursor:pointer;',
    '  box-shadow:inset 0 0 0 1px rgba(255,255,255,.16),0 1px 4px rgba(15,23,42,.2);',
    '  transition:background .15s ease,transform .15s ease;z-index:2147483647;}',
    '  /* 尺寸/圆角/基线与 popup 顶栏按钮(⚙ ↗ ＋)一致,topbar 的 46px 右侧留白正好容纳 */',
    '.close:hover{background:rgba(239,68,68,.92);transform:scale(1.1)}',
    '.close:active{transform:scale(.94)}',
    '.close:focus-visible{outline:2px solid #fff;outline-offset:2px}',

    /* ---------- 面板左上角:隐形缩放热区(不显示手柄,拖角仍可调大小) ---------- */
    '.rsz{position:fixed;width:22px;height:22px;z-index:2147483646;display:none;',
    '  cursor:nwse-resize;transform:translate(-50%,-50%);touch-action:none;opacity:0}',
    '.rsz.show{display:block}',

    '@media (prefers-reduced-motion:reduce){',
    '  .panel.open,.robot,.robot .icon,.tip{animation:none;transition:none}',
    '}'
  ].join('');

  function applyPos() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var r = state.right, b = state.bottom;
    ui.btn.style.right = r + 'px';
    ui.btn.style.bottom = b + 'px';
    ui.tip.style.right = (r + 66) + 'px';
    ui.tip.style.bottom = (b + 17) + 'px';
    // 面板尺寸:固定正方形。默认尽量大;用户拖过的边长优先;600 为下限,
    // 但任何情况都绝不超出浏览器视口(视口不足时收缩到刚好放下)
    var maxFit = Math.min(vw - 24, vh - 24);
    var side = state.pw
      ? Math.max(PANEL_SIDE_MIN, state.pw)
      : Math.max(PANEL_SIDE_MIN, Math.min(PANEL_DEFAULT_SIDE, maxFit));
    side = Math.min(side, maxFit);
    state._side = side; // 拖动热路径(applyDragPos)复用,避免重复计算
    var w = side, h = side;
    ui.panel.style.width = w + 'px';
    ui.panel.style.height = h + 'px';
    // 内容等比缩放:面板越大字越大(基准 560)。同源直写 iframe;跨域异常时由 popup.js 的 resize 监听兜底
    // zoom 严格等于 side/560(不设上限):内部布局恒定 560 基准,任何面板尺寸都精确展示 8 行
    var z = Math.max(1, side / 560);
    try {
      var idoc = ui.iframe.contentDocument;
      if (idoc && idoc.documentElement && ui.iframe.src) {
        idoc.documentElement.style.zoom = z.toFixed(4);
      }
    } catch (e) { /* ignore */ }
    // 锚在机器人左上方,并整体夹在视口内
    var panelRight = Math.max(10, Math.min(r + 68, vw - w - 10));
    var panelBottom = Math.max(10, Math.min(b, vh - h - 10));
    ui.panel.style.right = panelRight + 'px';
    ui.panel.style.bottom = panelBottom + 'px';
    // 缩放手柄骑在面板左上角
    ui.rsz.style.left = Math.round(vw - panelRight - w) + 'px';
    ui.rsz.style.top = Math.round(vh - panelBottom - h) + 'px';
  }

  /**
   * 拖动机器人的热路径(pointermove 每帧调用)。
   * side 不随机器人位置变化 → 跳过尺寸/跨文档 zoom 写/✕ 尺寸写(applyPos 的重头),
   * 面板未打开时连面板/手柄定位也一并跳过,只写机器人与气泡 4 个样式。
   */
  function applyDragPos(vw, vh) {
    vw = vw || window.innerWidth;
    vh = vh || window.innerHeight;
    var r = state.right, b = state.bottom;
    // cssText 一次写两属性,替代逐属性赋值(拖动风暴里差一倍 style 写次数)
    ui.btn.style.cssText = 'right:' + r + 'px;bottom:' + b + 'px';
    // 拖动中气泡必然隐藏(pointerdown 已 remove('show')),无需跟随更新;endDrag 的 applyPos 会补齐
    if (!state.open) return;
    var w = state._side || PANEL_SIDE_MIN;
    var h = w;
    var panelRight = Math.max(10, Math.min(r + 68, vw - w - 10));
    var panelBottom = Math.max(10, Math.min(b, vh - h - 10));
    ui.panel.style.cssText = 'width:' + w + 'px;height:' + h + 'px;right:' + panelRight + 'px;bottom:' + panelBottom + 'px';
    ui.rsz.style.cssText = 'left:' + Math.round(vw - panelRight - w) + 'px;top:' + Math.round(vh - panelBottom - h) + 'px';
  }

  function setOpen(open) {
    state.open = open;
    ui.panel.classList.toggle('open', open);
    ui.btn.classList.toggle('open', open);
    ui.rsz.classList.toggle('show', open);
    ui.tip.classList.remove('show');
    if (open && !ui.iframe.src) {
      ui.iframe.src = POPUP_URL; // 首次打开才加载
    } else if (open) {
      // 再次打开:通知面板内页立即刷新(外部改动同步,不等轮询)
      try { ui.iframe.contentWindow.postMessage({ type: 'mytodo-refresh' }, '*'); } catch (e) { /* ignore */ }
    }
  }

  function mount() {
    var host = document.createElement('div');
    host.setAttribute('data-mytodo-robot', '');
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
    var root = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);

    var btn = document.createElement('div');
    btn.className = 'robot';
    btn.title = 'MyTodo 四象限 · 点击展开';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'MyTodo 四象限 待办机器人');
    btn.innerHTML = ROBOT_SVG;

    var tip = document.createElement('div');
    tip.className = 'tip';
    tip.textContent = 'MyTodo 待办';

    var panel = document.createElement('div');
    panel.className = 'panel';
    var iframe = document.createElement('iframe');
    iframe.title = 'MyTodo 四象限';
    iframe.setAttribute('allow', 'clipboard-write');
    panel.appendChild(iframe);
    // iframe 内容异步渲染:加载完成与首秒各补一次 applyPos,保证 ✕ 对齐 ＋ 的最终位置
    iframe.addEventListener('load', function () { applyPos(); });
    setTimeout(applyPos, 600);
    setTimeout(applyPos, 1400);

    // 左上角比例锁定缩放手柄
    var rsz = document.createElement('div');
    rsz.className = 'rsz';
    rsz.title = '拖动调整大小(宽高比锁定);双击恢复默认';

    root.appendChild(panel);
    root.appendChild(rsz);
    root.appendChild(tip);
    root.appendChild(btn);

    (document.body || document.documentElement).appendChild(host);
    ui.btn = btn;
    ui.tip = tip;
    ui.panel = panel;
    ui.iframe = iframe;
    ui.rsz = rsz;
    applyPos();

    // 立即预载面板 iframe(隐藏加载):首开从"加载+取数"变成"直接显示"
    // (数据实时性由打开时的 postMessage refresh 保证;后台标签由 setOpen 懒加载兜底)
    if (!ui.iframe.src) ui.iframe.src = POPUP_URL;

    // ---- 面板缩放:拖左上角手柄,固定正方形(水平/垂直取较大增量) ----
    var rz = { on: false, sx: 0, sy: 0, sw: 0 };
    rsz.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      rz.on = true;
      state.resizing = true;
      rz.sx = e.clientX;
      rz.sy = e.clientY;
      rz.sw = panel.getBoundingClientRect().width;
      rsz.classList.add('on');
      try { rsz.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无指针 id */ }
    });
    rsz.addEventListener('pointermove', function (e) {
      if (!rz.on) return;
      var vw = window.innerWidth, vh = window.innerHeight;
      var grow = Math.max(rz.sx - e.clientX, rz.sy - e.clientY); // 左/上拖 → 放大
      var maxSide = Math.max(PANEL_SIDE_MIN, Math.min(vw - 24, vh - 24)); // 放大仅受视口约束
      var side = Math.max(PANEL_SIDE_MIN, Math.min(rz.sw + grow, maxSide));
      state.pw = state.ph = Math.round(side);
      applyPos();
    });
    function endRz() {
      if (!rz.on) return;
      rz.on = false;
      state.resizing = false;
      rsz.classList.remove('on');
      if (MYTODO_STORAGE && state.pw) {
        MYTODO_STORAGE.set(PANEL_SIZE_KEY, { w: state.pw, h: state.ph });
      }
    }
    rsz.addEventListener('pointerup', endRz);
    rsz.addEventListener('pointercancel', endRz);
    // 双击手柄恢复自适应默认尺寸
    rsz.addEventListener('dblclick', function () {
      state.pw = null;
      state.ph = null;
      if (MYTODO_STORAGE) MYTODO_STORAGE.set(PANEL_SIZE_KEY, null);
      applyPos();
    });

    // ---- 跨页面同步:机器人位置 / 面板大小在一页改动,其他页面实时跟随 ----
    // (写入即当前 state,回环通知无害;本页正在拖动时不被远端更新打断)
    MYTODO_STORAGE.onChanged(ROBOT_POS_KEY, function (v) {
      if (!v || typeof v.right !== 'number' || typeof v.bottom !== 'number') return;
      if (state.dragging) return;
      state.right = v.right;
      state.bottom = v.bottom;
      applyPos();
    });
    MYTODO_STORAGE.onChanged(PANEL_SIZE_KEY, function (v) {
      if (state.resizing) return;
      if (v && typeof v.w === 'number') {
        state.pw = state.ph = Math.max(PANEL_SIDE_MIN, v.w);
      } else {
        state.pw = null;
        state.ph = null;
      }
      applyPos();
    });

    // ---- 悬停气泡(拖拽/展开时不显示) ----
    var tipTimer = null;
    btn.addEventListener('pointerenter', function () {
      if (state.open) return;
      tipTimer = setTimeout(function () {
        if (!state.open && !state.dragging) ui.tip.classList.add('show');
      }, 350);
    });
    btn.addEventListener('pointerleave', function () {
      if (tipTimer) clearTimeout(tipTimer);
      ui.tip.classList.remove('show');
    });

    // ---- 拖拽 + 点击切换 ----
    var startX = 0, startY = 0, moved = 0, startRight = 0, startBottom = 0;
    var dragVW = 0, dragVH = 0; // pointerdown 时快照视口:move 中不再读 innerWidth/Height(避免潜在布局查询)
    var dragFramePending = false; // rAF 合并:高频 move 每帧至多应用一次样式(与浏览器输入合帧模型对齐)
    btn.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      moved = 0;
      startRight = state.right;
      startBottom = state.bottom;
      dragVW = window.innerWidth;
      dragVH = window.innerHeight;
      state.dragging = true;
      btn.classList.add('dragging');
      ui.tip.classList.remove('show');
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无指针 id */ }
      e.preventDefault();
    });
    btn.addEventListener('pointermove', function (e) {
      if (!state.dragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (moved < DRAG_THRESHOLD) return;
      state.right = Math.min(Math.max(4, startRight - dx), Math.max(4, dragVW - 60));
      // 向上拖(dy<0)应远离底部 → bottom 增大,故取减号;水平同理(right = startRight - dx)
      state.bottom = Math.min(Math.max(4, startBottom - dy), Math.max(4, dragVH - 60));
      if (!dragFramePending) {
        dragFramePending = true;
        requestAnimationFrame(function () {
          dragFramePending = false;
          applyDragPos(dragVW, dragVH); // 每帧一次:side 不变,跳过尺寸/跨文档 zoom/✕ 写
        });
      }
    });
    function endDrag() {
      if (!state.dragging) return;
      state.dragging = false;
      dragFramePending = false;
      btn.classList.remove('dragging');
      if (moved < DRAG_THRESHOLD) {
        setOpen(!state.open); // 没怎么动 → 当作点击
      } else if (MYTODO_STORAGE) {
        MYTODO_STORAGE.set(ROBOT_POS_KEY, { right: state.right, bottom: state.bottom });
        applyPos(); // 全量补齐(拖动热路径跳过的气泡定位等;rAF 未及执行的最终位置)
      }
    }
    btn.addEventListener('pointerup', endDrag);
    btn.addEventListener('pointercancel', endDrag);

    // Esc 关闭面板;iframe 顶栏 ✕ 经 postMessage 请求关闭
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) setOpen(false);
    });
    window.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'mytodo-close-panel') setOpen(false);
    });

    // 窗口缩放时机器人/光环/气泡/面板全部重新定位与自适应
    window.addEventListener('resize', applyPos);
  }

  (async function init() {
    var cfg = {};
    try {
      if (typeof MYTODO !== 'undefined' && typeof MYTODO_STORAGE !== 'undefined') {
        // 三个键并行读取(串行 await 会叠加存储往返延迟)
        var reads = await Promise.all([
          MYTODO_STORAGE.get(MYTODO.CONFIG_KEY, {}) || {},
          MYTODO_STORAGE.get(ROBOT_POS_KEY, null),
          MYTODO_STORAGE.get(PANEL_SIZE_KEY, null)
        ]);
        cfg = Object.assign({}, MYTODO.DEFAULT_CONFIG, reads[0]);
        var pos = reads[1];
        if (pos && typeof pos.right === 'number' && typeof pos.bottom === 'number') {
          state.right = pos.right;
          state.bottom = pos.bottom;
        }
        var size = reads[2];
        if (size && typeof size.w === 'number') {
          state.pw = state.ph = Math.max(PANEL_SIDE_MIN, size.w); // 历史尺寸只保下限
        }
      }
    } catch (e) { /* 配置读取失败按默认行为注入 */ }
    if (cfg.robot_enabled === false) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }
  })();
})();
