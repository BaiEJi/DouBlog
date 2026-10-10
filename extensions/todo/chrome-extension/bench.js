/**
 * MyTodo 扩展性能压测(开发用,不打入 zip)。
 * 在 8072 测试服务器上打开 benchmark.html 自动运行,指标:
 *   boot_ms          页面导航 → 机器人出现在 DOM(nav 起算)
 *   open_cold_ms     页面加载后立即点击机器人 → 面板出现任务行(无预载窗口)
 *   open_idle_ms     等待 2.5s(预载窗口)后点击 → 任务行
 *   toggle_ms        面板 开↔关 往返 10 次总耗时(纯 setOpen/applyPos 成本)
 *   drag_closed_ms   面板关闭状态下 300 次 pointermove 拖动风暴总耗时(applyPos 热路径)
 *   drag_open_ms     面板打开状态下同上(含跨文档 zoom 写)
 *   life_open_ms     点 🌱 → 打卡清单渲染完成
 * 每项内部多次采样取中位数;结果 JSON 写入 #bench-result 并挂 window.__BENCH。
 */
(function () {
  'use strict';

  var HOST_SEL = '[data-mytodo-robot]';
  var robot = null, root = null;

  function now() { return performance.now(); }
  // 不受隐藏页 timer 节流影响的宏任务 tick(Chromium 对后台 setTimeout 钳到 ≥1s,
  // 会把毫秒级等待污染成整秒;MessageChannel 任务不在节流名单)
  function tick() {
    return new Promise(function (r) {
      var ch = new MessageChannel();
      ch.port1.onmessage = function () { ch.port1.close(); r(); };
      ch.port2.postMessage(0);
    });
  }
  async function sleep(ms) {
    var t0 = now();
    while (now() - t0 < ms) await tick();
  }
  function median(arr) {
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function round2(x) { return Math.round(x * 100) / 100; }

  async function waitFor(pred, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    var t0 = now();
    for (;;) {
      var v;
      try { v = pred(); } catch (e) { v = false; }
      if (v) return v;
      if (now() - t0 > timeoutMs) throw new Error('waitFor 超时');
      await tick();
    }
  }

  function hostRoot() {
    var h = document.querySelector(HOST_SEL);
    return h && h.shadowRoot;
  }
  function pdoc() {
    var ifr = hostRoot().querySelector('iframe');
    return ifr && ifr.contentDocument;
  }
  function panelOpen() {
    var r = hostRoot();
    return r && r.querySelector('.panel').classList.contains('open');
  }
  function tasksRendered() {
    var d = pdoc();
    if (!d) return false;
    var st = d.getElementById('status');
    return d.querySelectorAll('.task').length > 0 && st && st.classList.contains('hidden');
  }

  function clickRobot() {
    var rob = hostRoot().querySelector('.robot');
    var r = rob.getBoundingClientRect();
    var base = { bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: r.left + 10, clientY: r.top + 10 };
    rob.dispatchEvent(new PointerEvent('pointerdown', base));
    rob.dispatchEvent(new PointerEvent('pointerup', base));
  }
  function escClose() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  /** 拖动风暴:N 次 pointermove,返回总耗时 ms */
  function dragStorm(n, withPanelOpen) {
    var rob = hostRoot().querySelector('.robot');
    var r = rob.getBoundingClientRect();
    var cx = Math.round(r.left + 10), cy = Math.round(r.top + 10);
    var fire = function (type, x, y, id) {
      rob.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: id, button: 0, clientX: x, clientY: y,
      }));
    };
    fire('pointerdown', cx, cy, 21);
    var t0 = now();
    for (var i = 0; i < n; i++) {
      // 交替往复,确保 right/bottom 每次变化,触发 applyPos 完整路径
      fire('pointermove', cx - (i % 40), cy - ((i * 7) % 40), 21);
    }
    var total = now() - t0;
    fire('pointerup', cx, cy, 21);
    return total;
  }

  async function openLifeBench() {
    var d = pdoc();
    // 重置初始态:否则第二次起沿用上次渲染结果,poll 立即通过产生假值
    d.getElementById('life-list').textContent = '';
    d.getElementById('life-stat').textContent = '安排 0 · 完成 0';
    var btn = d.getElementById('life-btn');
    var t0 = now();
    btn.click();
    // 严格就绪:view-life 可见 + 统计文本已从初始占位更新 + 列表有内容(数据真实拉回)
    await waitFor(function () {
      var dd = pdoc();
      var life = dd.getElementById('view-life');
      if (!life || life.classList.contains('hidden')) return false;
      if (dd.getElementById('life-list').children.length === 0) return false;
      var stat = dd.getElementById('life-stat').textContent;
      return stat !== '安排 0 · 完成 0' && stat.indexOf('安排') === 0;
    });
    var ms = now() - t0;
    // 回主视图
    pdoc().getElementById('life-back').click();
    await sleep(250);
    return ms;
  }

  async function run() {
    var out = { meta: { href: location.href, ua: navigator.userAgent.slice(0, 60), rounds: {} } };

    // ---- 1) boot: nav → 机器人 DOM 出现 ----
    var bootT0 = now(); // 距 timeOrigin 即导航启动
    await waitFor(function () { return !!document.querySelector(HOST_SEL); }, 10000);
    out.boot_ms = round2(now()); // performance.now() 起点即导航开始

    // ---- 2) open_cold: 模拟真实用户首开(页面加载 ~1.2s 后首次点击,预载窗口已过) ----
    await sleep(1200);
    var tc = now();
    clickRobot();
    await waitFor(tasksRendered, 15000);
    out.open_cold_ms = round2(now() - tc);

    // ---- 3) toggle ×10: 开关往返 ----
    var toggles = [];
    for (var i = 0; i < 10; i++) {
      escClose();
      await waitFor(function () { return !panelOpen(); });
      var a = now();
      clickRobot();
      await waitFor(function () { return panelOpen(); });
      toggles.push(now() - a);
      await sleep(30);
    }
    out.toggle_ms = round2(median(toggles));

    // ---- 4) drag_closed: 面板关闭拖动风暴 ----
    escClose();
    await waitFor(function () { return !panelOpen(); });
    await sleep(120);
    out.drag_closed_ms = round2(dragStorm(300, false));

    // ---- 5) drag_open: 面板打开拖动风暴 ----
    clickRobot();
    await waitFor(function () { return panelOpen(); });
    await sleep(120);
    out.drag_open_ms = round2(dragStorm(300, true));

    // ---- 6) open_idle: 关闭后等 2.5s(预载窗口)再开 ----
    escClose();
    await waitFor(function () { return !panelOpen(); });
    await sleep(2500);
    var t1 = now();
    clickRobot();
    await waitFor(tasksRendered, 15000);
    out.open_idle_ms = round2(now() - t1);

    // ---- 7) life_open ×3 ----
    var lifes = [];
    for (var k = 0; k < 3; k++) lifes.push(await openLifeBench());
    out.life_open_ms = round2(median(lifes));

    escClose();
    await waitFor(function () { return !panelOpen(); });
    out.done = true;
    return out;
  }

  run().then(function (r) {
    window.__BENCH = r;
    document.getElementById('bench-result').textContent = JSON.stringify(r, null, 1);
  }).catch(function (e) {
    window.__BENCH = { error: String(e) };
    document.getElementById('bench-result').textContent = '压测失败: ' + e;
  });
})();
