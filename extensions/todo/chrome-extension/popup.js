/**
 * MyTodo 四象限 popup 逻辑。
 * 可测试性约束：本文件不在顶层直接调用任何 chrome.* API ——
 * 存储经由 MYTODO_STORAGE（chrome.storage / localStorage 自动降级），
 * 网络经由 MYTODO_API。因此 popup.html 可直接作为普通网页打开调试。
 */
/* global MYTODO, MYTODO_STORAGE, MYTODO_API */
(function () {
  'use strict';

  // 被机器人面板 iframe 嵌入时:尺寸跟随宿主容器,且内容随面板边长等比缩放
  // (内容按 560 基准缩放,面板越大字越大;zoom 无上限钳制,保证任何尺寸恒定 8 行;独立 popup 不受影响)
  if (window.self !== window.top) {
    document.documentElement.classList.add('embedded');
    var fitZoom = function () {
      var z = Math.max(1, window.innerWidth / 560);
      document.documentElement.style.zoom = z;
    };
    fitZoom();
    window.addEventListener('resize', fitZoom);
  }

  // ---------- 状态 ----------
  var state = {
    view: 'main',            // 'main' | 'migrations' | 'life'
    today: null,             // GET /today 结果
    migrations: [],          // GET /migrations/pending 结果
    selectedQuadrant: 2,     // 新增弹窗默认 Q2
    selectedCat: null,       // 新增弹窗已选类别 id(null=未分类)
    categories: [],          // GET /categories(每次打开弹窗实时刷新)
    qMeta: null,             // GET /settings 的象限文案 {labels, subs}(实时刷新,失败用默认)
    editing: null,           // 右键编辑中的任务对象(null=新增模式)
    drag: null,              // 拖拽中的任务 {id}
    dropHint: null,          // 当前插入指示 {row, cls, q}
    lastHint: null,          // 最后有效落点 {q, beforeId}(dragend 兜底用)
    adding: false,
    // 规律生活
    doneSrc: 'today',        // 完成弹窗来源 'today' | 'life'(决定完成后的刷新目标)
    lifeDate: null,          // 打卡查看日(null=今天)
    lifeTab: 'today',        // 'today' 打卡 | 'plans' 管理
    lifeData: null,          // GET /plans/today 结果
    plans: [],               // GET /plans 结果
    editingPlan: null,       // 编辑中的计划(null=新增)
    planRule: 'daily',       // 频率模式 daily|interval|weekly|weekly_times|monthly_times
    planCat: null            // 计划弹窗已选类别 id(必选)
  };

  // ---------- DOM 快捷引用 ----------
  function $(id) { return document.getElementById(id); }
  var els = {
    viewMain: $('view-main'),
    viewMigrations: $('view-migrations'),
    viewLife: $('view-life'),
    lifeBtn: $('life-btn'),
    lifeBack: $('life-back'),
    lifePrev: $('life-prev'),
    lifeNext: $('life-next'),
    lifeDate: $('life-date'),
    lifeTodayBtn: $('life-today-btn'),
    lifeStat: $('life-stat'),
    lifeTabToday: $('life-tab-today'),
    lifeTabPlans: $('life-tab-plans'),
    lifeList: $('life-list'),
    planList: $('plan-list'),
    planAddBtn: $('plan-add-btn'),
    planModal: $('plan-modal'),
    planSheetTitle: $('plan-sheet-title'),
    planClose: $('plan-close'),
    planTitle: $('plan-title'),
    planDesc: $('plan-desc'),
    planCats: $('plan-cats'),
    planRuleTypes: $('plan-rule-type'),
    planRuleParam: $('plan-rule-param'),
    planInterval: $('plan-interval'),
    planWeekdays: $('plan-weekdays'),
    planTimes: $('plan-times'),
    planStart: $('plan-start'),
    planEnd: $('plan-end'),
    planSubmit: $('plan-submit'),
    planManage: $('plan-manage'),
    planToggle: $('plan-toggle'),
    planDelete: $('plan-delete'),
    dateText: $('date-text'),
    dateSub: $('date-sub'),
    streakBadge: $('streak-badge'),
    streakNum: $('streak-num'),
    migBadge: $('mig-badge'),
    migCount: $('mig-count'),
    grid: $('quadrant-grid'),
    addTrigger: $('add-trigger'),
    openFullTop: $('open-full-top'),
    openSettings: $('open-settings'),
    addModal: $('add-modal'),
    addClose: $('add-close'),
    addTitle: $('add-title'),
    addDesc: $('add-desc'),
    addQuad: $('add-quad'),
    addCats: $('add-cats'),
    addSubmit: $('add-submit'),
    addSheetTitle: $('add-sheet-title'),
    setModal: $('set-modal'),
    setClose: $('set-close'),
    setServer: $('set-server'),
    setToken: $('set-token'),
    setKey: $('set-key'),
    doneModal: $('done-modal'),
    doneTitle: $('done-title'),
    doneNote: $('done-note'),
    doneSubmit: $('done-submit'),
    doneClose: $('done-close'),
    setSave: $('set-save'),
    status: $('status'),
    statusSpinner: $('status-spinner'),
    statusMsg: $('status-msg'),
    retryBtn: $('retry-btn'),
    toast: $('toast'),
    migList: $('mig-list'),
    migViewCount: $('mig-view-count'),
    migBack: $('mig-back'),
    migAllBtn: $('mig-all-btn')
  };

  // ---------- 小工具 ----------
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /** 'YYYY-MM-DD' → '9月10日'；解析失败返回原串 */
  function fmtDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return String(iso);
    return parseInt(m[2], 10) + '月' + parseInt(m[3], 10) + '日';
  }

  function hexToRgba(hex, alpha) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return 'rgba(59,130,246,' + alpha + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  var toastTimer = null;
  function toast(msg, isError) {
    els.toast.textContent = msg;
    els.toast.classList.toggle('err', !!isError);
    els.toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.add('hidden'); }, 1800);
  }

  function showStatus(loading, msg, showRetry) {
    els.status.classList.remove('hidden');
    els.statusSpinner.classList.toggle('hidden', !loading);
    els.statusMsg.textContent = msg || '';
    els.retryBtn.classList.toggle('hidden', !showRetry);
  }
  function hideStatus() { els.status.classList.add('hidden'); }

  // ---------- 主视图渲染 ----------

  function renderHeader(today) {
    var d = new Date();
    els.dateText.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];
    // 副行统计:待办总数 · 已完成数(今日视图自己的口径)
    var qs = (today && today.quadrants) || [];
    var total = 0, done = 0;
    qs.forEach(function (q) {
      (q.tasks || []).forEach(function (t) {
        total++;
        if (t.status === 'done') done++;
      });
    });
    els.dateSub.textContent = total > 0 ? (total + ' 个待办 · ' + done + ' 已完成') : '今天没有安排';

    var streak = today && today.streak;
    if (streak && typeof streak.current === 'number') {
      els.streakNum.textContent = streak.current;
      els.streakBadge.title = '连续活跃 ' + streak.current + ' 天（最佳 ' + (streak.best || 0) + ' 天）';
      els.streakBadge.classList.remove('hidden');
    } else {
      els.streakBadge.classList.add('hidden');
    }

    var pm = (today && today.pending_migrations) || [];
    if (pm.length > 0) {
      els.migCount.textContent = pm.length;
      els.migBadge.title = pm.length + ' 个待迁移任务，点击处理';
      els.migBadge.classList.remove('hidden');
    } else {
      els.migBadge.classList.add('hidden');
    }
  }

  /** 象限内排序：pending 在前、done 在后（稳定排序，保持后端相对顺序） */
  function orderTasks(tasks) {
    var pending = tasks.filter(function (t) { return t.status !== 'done'; });
    var done = tasks.filter(function (t) { return t.status === 'done'; });
    return pending.concat(done);
  }

  /** 灰色线性对勾图标(完成备注前缀,与全站线性图标体系一致) */
  var NOTE_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="M20 6 9 17l-5-5"/></svg>';

  function renderTaskRow(task, qColor, q) {
    var row = el('div', 'task' + (task.status === 'done' ? ' done' : ''));
    row.dataset.taskId = task.id;
    row.dataset.q = String(q);
    row.title = '右键编辑 · 拖动排序';

    // 待办行可拖拽:指针事件自实现。
    // 不用 HTML5 DnD 的原因:面板内容有 CSS zoom(随尺寸缩放),Chromium 在
    // zoom 容器内不触发 drop 事件(真实鼠标拖放必失败),指针事件则完全正常。
    if (task.status !== 'done') {
      row.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) return;
        if (ev.target.closest && ev.target.closest('.check')) return; // 勾选按钮照常点击
        startRowDrag(ev, row, task);
      });
    }

    var check = el('button', 'check');
    check.title = task.status === 'done' ? '点击重新打开' : '点击完成';
    row.appendChild(check);

    // 与 web 版一致的单行布局:标题(省略) + 备注(省略) + 类别/拖延标记(靠右,完整显示)
    // 完成态优先显示完成备注(📝),与 web 卡片的「📝 备注」一致;重开后不显示(数据保留)
    var main = el('div', 'tmain');
    main.appendChild(el('div', 'ttitle', task.title || '(无标题)'));
    if (task.status === 'done' && task.completion_note) {
      var cnote = el('div', 'tnote dnote');
      cnote.innerHTML = NOTE_SVG + '<span class="dnote-txt"></span>';
      cnote.querySelector('.dnote-txt').textContent = task.completion_note;
      cnote.title = '完成备注：' + task.completion_note;
      main.appendChild(cnote);
    } else if (task.description) {
      main.appendChild(el('div', 'tnote', task.description));
    }

    var meta = el('div', 'tmeta');
    if (task.migrated_count > 0 && task.days_procrastinated != null) {
      var mark = el('span', 'mig-mark', '拖' + task.days_procrastinated + '天');
      mark.title = '已迁移 ' + task.migrated_count + ' 次，原始日期 ' + (task.original_date || '?');
      meta.appendChild(mark); // 拖延标签放最前
    }
    if (task.category_name) {
      var cat = el('span', 'cat');
      var dot = el('i', 'dot');
      dot.style.background = task.category_color || qColor;
      cat.appendChild(dot);
      cat.appendChild(document.createTextNode(task.category_name));
      meta.appendChild(cat);
    }
    main.appendChild(meta);
    row.appendChild(main);
    return row;
  }

  function renderQuadrantCard(qBlock) {
    var meta = MYTODO.QUADRANTS[qBlock.quadrant] || { name: 'Q' + qBlock.quadrant, subtitle: '', color: '#94a3b8' };
    var color = meta.color;

    var card = el('div', 'qcard');
    card.dataset.quadrant = String(qBlock.quadrant);
    card.style.setProperty('--qcolor', color);
    card.style.setProperty('--qsoft', hexToRgba(color, 0.18));
    card.style.setProperty('--qtint', hexToRgba(color, 0.08));

    var head = el('div', 'qhead');
    var qdot = el('span', 'qdot');
    qdot.style.background = color;
    head.appendChild(qdot);
    head.appendChild(el('span', 'qname', qBlock.label || meta.name));
    head.appendChild(el('span', 'qsub', qBlock.subtitle || meta.subtitle));
    var count = el('span', 'qcount', String(qBlock.pending_count != null ? qBlock.pending_count : (qBlock.tasks || []).length));
    if (qBlock.over_limit) {
      count.classList.add('over');
      count.title = '待办数已超过软限制';
    }
    head.appendChild(count);
    card.appendChild(head);

    var list = el('div', 'qlist');
    var tasks = orderTasks(qBlock.tasks || []);
    if (tasks.length === 0) {
      list.appendChild(el('div', 'qempty', '暂无任务'));
    } else {
      for (var i = 0; i < tasks.length; i++) list.appendChild(renderTaskRow(tasks[i], color, qBlock.quadrant));
    }
    card.appendChild(list);
    return card;
  }

  function renderGrid(today) {
    els.grid.textContent = '';
    var blocks = {};
    var list = (today && today.quadrants) || [];
    for (var i = 0; i < list.length; i++) blocks[list[i].quadrant] = list[i];
    // 视觉排列顺序必须 [2,1,4,3]：Q2 左上、Q1 右上、Q4 左下、Q3 右下
    var order = MYTODO.QUADRANT_ORDER;
    for (var j = 0; j < order.length; j++) {
      var q = order[j];
      if (blocks[q]) {
        els.grid.appendChild(renderQuadrantCard(blocks[q]));
      } else {
        var placeholder = {
          quadrant: q,
          label: MYTODO.QUADRANTS[q].name,
          subtitle: MYTODO.QUADRANTS[q].subtitle,
          pending_count: 0,
          over_limit: false,
          tasks: []
        };
        els.grid.appendChild(renderQuadrantCard(placeholder));
      }
    }
  }

  function renderMain() {
    if (!state.today) return;
    renderHeader(state.today);
    renderGrid(state.today);
  }

  // ---------- 新增任务弹窗(顶栏 ＋ 打开:选四象限 + 类型) ----------

  /** 象限文案:优先用 /settings 的自定义文案,接口失败回退内置默认 */
  function quadName(q) {
    var k = 'q' + q;
    if (state.qMeta && state.qMeta.labels && state.qMeta.labels[k]) return state.qMeta.labels[k];
    return MYTODO.QUADRANTS[q].name;
  }
  function quadSub(q) {
    var k = 'q' + q;
    if (state.qMeta && state.qMeta.subs && state.qMeta.subs[k]) return state.qMeta.subs[k];
    return MYTODO.QUADRANTS[q].subtitle;
  }

  /** 象限选择器:按视觉顺序 [2,1,4,3] 排 2×2 */
  function renderAddQuad() {
    els.addQuad.textContent = '';
    MYTODO.QUADRANT_ORDER.forEach(function (q) {
      var opt = el('button', 'aq-opt');
      opt.dataset.q = String(q);
      var dot = el('i', 'dot');
      dot.style.background = MYTODO.QUADRANTS[q].color;
      opt.appendChild(dot);
      opt.appendChild(el('span', null, quadName(q)));
      opt.title = quadSub(q); // 副标题悬停提示,chip 内只留名称(避免双列截断)
      opt.addEventListener('click', function () {
        state.selectedQuadrant = q;
        syncAddQuad();
      });
      els.addQuad.appendChild(opt);
    });
    syncAddQuad();
  }

  function syncAddQuad() {
    var opts = els.addQuad.querySelectorAll('.aq-opt');
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      var sel = o.dataset.q === String(state.selectedQuadrant);
      var color = MYTODO.QUADRANTS[o.dataset.q].color;
      o.classList.toggle('sel', sel);
      o.style.borderColor = sel ? color : '';
      o.style.background = sel ? hexToRgba(color, 0.13) : '';
    }
  }

  /** 类型(类别)选择器:色点 + 图标 + 名称,点击再点一次取消 */
  function renderAddCats() {
    els.addCats.textContent = '';
    if (!state.categories.length) {
      els.addCats.appendChild(el('span', 'ac-empty', '类别加载中…'));
      return;
    }
    state.categories.forEach(function (c) {
      var chip = el('button', 'ac-chip');
      chip.dataset.cat = c.id;
      var dot = el('i', 'dot');
      dot.style.background = c.color || '#94a3b8';
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(c.name)); // 色点+文字,与计划弹窗及细线图标语言一致
      chip.addEventListener('click', function () {
        state.selectedCat = state.selectedCat === c.id ? null : c.id;
        syncAddCats();
      });
      els.addCats.appendChild(chip);
    });
    syncAddCats();
  }

  function syncAddCats() {
    var chips = els.addCats.querySelectorAll('.ac-chip');
    for (var i = 0; i < chips.length; i++) {
      var ch = chips[i];
      ch.classList.toggle('sel', ch.dataset.cat === state.selectedCat); // 选中态统一走 v2 皮肤(.ac-chip.sel 浅蓝底蓝字)
    }
  }

  /** 每次打开弹窗都实时拉取最新文案与类别(接口失败保持上次/默认) */
  async function refreshAddOptions() {
    try {
      var s = await MYTODO_API.request('/settings');
      state.qMeta = {
        labels: (s && s.quadrant_labels) || null,
        subs: (s && s.quadrant_subtitles) || null
      };
    } catch (e) { /* 文案保持现状 */ }
    renderAddQuad();
    try {
      state.categories = (await MYTODO_API.getCategories()) || [];
    } catch (e) { /* 类别保持上次 */ }
    if (state.selectedCat) {
      var still = state.categories.some(function (c) { return c.id === state.selectedCat; });
      if (!still) state.selectedCat = null; // 已选类别被删则重置
    }
    renderAddCats();
  }

  function openAddModal() {
    state.editing = null;
    state.selectedQuadrant = 2;
    state.selectedCat = null;
    els.addSheetTitle.textContent = '新增待办';
    els.addSubmit.textContent = '添加到今天';
    els.addTitle.value = '';
    els.addDesc.value = '';
    renderAddQuad();
    renderAddCats();
    els.addModal.classList.remove('hidden');
    setTimeout(function () { els.addTitle.focus(); }, 40);
    void refreshAddOptions();
  }

  /** 右键编辑:复用新增弹窗,预填标题/象限/类型 */
  function openEditModal(task) {
    state.editing = task;
    state.selectedQuadrant = task.quadrant;
    state.selectedCat = task.category_id || null;
    els.addSheetTitle.textContent = '编辑待办';
    els.addSubmit.textContent = '保存修改';
    els.addTitle.value = task.title || '';
    els.addDesc.value = task.description || '';
    renderAddQuad();
    renderAddCats();
    els.addModal.classList.remove('hidden');
    setTimeout(function () {
      els.addTitle.focus();
      try { els.addTitle.select(); } catch (e) { /* ignore */ }
    }, 40);
    void refreshAddOptions();
  }

  function closeAddModal() {
    els.addModal.classList.add('hidden');
  }

  async function submitAdd() {
    var title = els.addTitle.value.trim();
    if (!title) {
      toast('请先输入任务标题', true);
      els.addTitle.focus();
      return;
    }
    if (state.adding) return;
    var q = state.selectedQuadrant;
    var meta = MYTODO.QUADRANTS[q];
    var desc = els.addDesc.value.trim();
    state.adding = true;
    els.addSubmit.disabled = true;
    try {
      if (state.editing) {
        // 编辑:PATCH 带 revision 乐观锁
        await MYTODO_API.updateTask(state.editing.id, {
          title: title,
          description: desc || null,
          is_important: !!meta.is_important,
          is_urgent: !!meta.is_urgent,
          category_id: state.selectedCat,
          revision: state.editing.revision
        });
        toast('已更新');
      } else {
        var body = {
          title: title,
          description: desc || null,
          is_important: !!meta.is_important,
          is_urgent: !!meta.is_urgent,
          task_date: 'today'
        };
        if (state.selectedCat) body.category_id = state.selectedCat;
        await MYTODO_API.createTask(body);
        toast('已添加到 ' + quadName(q));
      }
      state.editing = null;
      closeAddModal();
      await refreshToday(false);
    } catch (e) {
      toast((state.editing ? '保存失败：' : '添加失败：') + e.message, true);
    } finally {
      state.adding = false;
      els.addSubmit.disabled = false;
    }
  }

  // ---------- 拖拽排序 / 跨象限移动(指针事件实现) ----------

  var ptrDrag = null; // {id, row, startX, startY, active}

  function startRowDrag(ev, row, task) {
    if (ptrDrag) return;
    ptrDrag = { id: task.id, row: row, startX: ev.clientX, startY: ev.clientY, active: false };
    var onMove = function (e) {
      if (!ptrDrag) return;
      if (!ptrDrag.active) {
        if (Math.abs(e.clientX - ptrDrag.startX) + Math.abs(e.clientY - ptrDrag.startY) < 5) return;
        ptrDrag.active = true;
        state.drag = { id: ptrDrag.id };
        state.lastHint = null;
        ptrDrag.row.classList.add('dragging');
        try { ptrDrag.row.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
      updateDropHintAt(e.clientX, e.clientY);
    };
    var finish = function (apply) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (!ptrDrag) return;
      var d = ptrDrag;
      ptrDrag = null;
      if (!d.active) return; // 未形成拖拽 → 普通点击
      d.row.classList.remove('dragging');
      clearDropHint();
      if (apply && state.lastHint) {
        var last = state.lastHint;
        void applyDragMove(d.id, last.q, last.beforeId);
      } else {
        state.drag = null; // 取消(Esc/pointercancel):不提交
      }
    };
    var onUp = function () { finish(true); };
    var onCancel = function () { finish(false); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function cancelRowDrag() {
    if (ptrDrag && ptrDrag.active) {
      // Esc 取消:复用清理逻辑,不提交
      var row = ptrDrag.row;
      row.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    }
  }

  function clearDropHint() {
    state.dropHint = null;
    var marked = els.grid.querySelectorAll('.drop-above, .drop-below');
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove('drop-above', 'drop-below');
  }

  /** 按指针视觉坐标更新插入指示线,并记住最后有效落点(松手即按此提交) */
  function updateDropHintAt(x, y) {
    clearDropHint();
    var elc = document.elementFromPoint(x, y);
    var list = elc && elc.closest ? elc.closest('.qlist') : null;
    if (!list) return; // 不在任务区:清线,保留 lastHint(松手按最后有效位置)
    var q = parseInt(list.closest('.qcard').dataset.quadrant, 10);
    var row = elc.closest('.task');
    if (row && row.classList.contains('dragging')) {
      row = row.nextElementSibling;
      while (row && (!row.classList.contains('task') || row.classList.contains('dragging'))) {
        row = row.nextElementSibling;
      }
    }
    if (!row) {
      state.dropHint = { row: null, cls: null, q: q };
      state.lastHint = { q: q, beforeId: null }; // 列表空白处 → 尾部
      return;
    }
    var r = row.getBoundingClientRect();
    var above = y < r.top + r.height / 2;
    row.classList.add(above ? 'drop-above' : 'drop-below');
    state.dropHint = { row: row, cls: above ? 'drop-above' : 'drop-below', q: q };
    state.lastHint = { q: q, beforeId: hintBeforeId() };
  }

  /** 由指示线推导 before_task_id(插入到哪行之前;null=尾部) */
  function hintBeforeId() {
    var h = state.dropHint;
    if (!h || !h.row) return null;
    var row = h.row;
    if (h.cls === 'drop-below') {
      row = row.nextElementSibling;
      while (row && (!row.classList.contains('task') || row.classList.contains('dragging'))) {
        row = row.nextElementSibling;
      }
    }
    return row ? row.dataset.taskId : null;
  }

  async function applyDragMove(id, targetQ, beforeId) {
    state.drag = null;
    state.lastHint = null;
    var task = findTask(id);
    if (!task) return;
    var sameQ = task.quadrant === targetQ;
    var meta = MYTODO.QUADRANTS[targetQ];
    var flagsSame = !!meta.is_important === !!task.is_important && !!meta.is_urgent === !!task.is_urgent;
    try {
      if (sameQ || flagsSame) {
        // 同象限排序;flags 相同说明是数据未刷新时的误判,同样按排序处理,不弹"已移到"
        if (nextTaskIdAfter(id, targetQ) === beforeId) return; // 位置没变,不请求
        await MYTODO_API.reorderTask(id, beforeId);
      } else {
        await MYTODO_API.moveTask(id, meta.is_important, meta.is_urgent, beforeId);
        toast('已移到 ' + quadName(targetQ));
      }
    } catch (e) {
      toast(sameQ ? '排序失败：' + e.message : '移动失败：' + e.message, true);
    }
    await refreshToday(false);
  }

  /** 当前顺序里 id 的下一个任务 id(无则 null) */
  function nextTaskIdAfter(id, q) {
    var blocks = (state.today && state.today.quadrants) || [];
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].quadrant !== q) continue;
      var ts = blocks[i].tasks || [];
      for (var j = 0; j < ts.length; j++) {
        if (ts[j].id === id) return ts[j + 1] ? ts[j + 1].id : null;
      }
    }
    return null;
  }

  // ---------- 设置弹窗(浮层,保存到本地) ----------

  async function openSettings() {
    var cfg = await MYTODO_API.getConfig();
    els.setServer.value = cfg.server_url || '';
    els.setToken.value = cfg.token || '';
    els.setKey.value = cfg.secret_key || '';
    els.setModal.classList.remove('hidden');
    setTimeout(function () { els.setServer.focus(); }, 40);
  }

  function closeSettings() {
    els.setModal.classList.add('hidden');
  }

  async function saveSettings() {
    var serverUrl = els.setServer.value.trim().replace(/\/+$/, '');
    var token = els.setToken.value.trim();
    var secretKey = els.setKey.value.trim() || MYTODO.DEFAULT_CONFIG.secret_key;
    if (!serverUrl) {
      toast('服务器地址不能为空', true);
      return;
    }
    if (!/^https?:\/\//.test(serverUrl)) {
      toast('服务器地址需以 http:// 或 https:// 开头', true);
      return;
    }
    if (state.adding) return;
    state.adding = true;
    els.setSave.disabled = true;
    try {
      await MYTODO_API.saveConfig({
        server_url: serverUrl,
        token: token,
        secret_key: secretKey
      });
      closeSettings();
      toast('设置已保存（本地）');
      await refreshToday(true); // 服务器可能变了,整页重载
    } catch (e) {
      toast('保存失败：' + e.message, true);
    } finally {
      state.adding = false;
      els.setSave.disabled = false;
    }
  }

  // ---------- 完成 / 重开 ----------

  async function toggleTask(taskId) {
    var task = findTask(taskId);
    if (!task) return;
    if (task.status === 'done') {
      // 重开不弹窗,行为与原来一致
      try {
        await MYTODO_API.reopenTask(taskId);
        await refreshToday(false);
      } catch (e) {
        toast('操作失败：' + e.message, true);
      }
      return;
    }
    openDoneModal(task.id, task.title, 'today'); // 待办 → 完成:先弹完成备注对话框
  }

  // ---------- 规律生活(计划打卡/管理) ----------

  var WD_NAMES = ['一', '二', '三', '四', '五', '六', '日'];
  var lifeSeq = 0;
  var MATERIALIZE_TTL = 10000; // 计划实例物化的最小间隔(后端 /today 每次都会物化,无需重复触发)
  var lastMaterializeAt = 0;

  function localIso(d) {
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function fmtLifeDate(iso) {
    if (!iso) return '今日';
    var d = new Date(iso + 'T00:00:00');
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WD_NAMES[(d.getDay() + 6) % 7];
  }

  function openLife() {
    switchView('life');
    void refreshLife();
    if (state.lifeTab === 'plans') void refreshPlans();
  }

  async function refreshLife() {
    var seq = ++lifeSeq;
    if (Date.now() - lastMaterializeAt > MATERIALIZE_TTL) {
      lastMaterializeAt = Date.now();
      try { await MYTODO_API.getToday(); } catch (e) { /* 触发后端物化计划实例,失败忽略 */ }
    }
    var data;
    try {
      data = await MYTODO_API.getPlansToday(state.lifeDate);
    } catch (e) {
      els.lifeList.textContent = '';
      els.lifeList.appendChild(el('div', 'life-empty', '加载失败：' + e.message));
      return;
    }
    if (seq !== lifeSeq) return;
    state.lifeData = data;
    renderLifeToday();
  }

  function renderLifeToday() {
    var items = (state.lifeData && state.lifeData.items) || [];
    els.lifeList.textContent = '';
    var done = 0;
    items.forEach(function (it) {
      var isDone = !!(it.task && it.task.status === 'done');
      if (isDone) done++;
      var row = el('div', 'life-item' + (isDone ? ' done' : ''));
      row.title = '点击行编辑计划';
      var check = el('button', 'check');
      check.title = isDone ? '点击重开(取消打卡)' : '打卡';
      check.addEventListener('click', function (ev) {
        ev.stopPropagation();
        lifeToggle(it);
      });
      row.appendChild(check);
      var main = el('div', 'lmain');
      main.appendChild(el('div', 'ltitle', it.plan.title));
      if (isDone && it.task.completion_note) {
        var n = el('div', 'lnote');
        n.innerHTML = NOTE_SVG + '<span class="dnote-txt"></span>';
        n.querySelector('.dnote-txt').textContent = it.task.completion_note;
        n.title = '打卡备注：' + it.task.completion_note;
        main.appendChild(n);
      }
      row.appendChild(main);
      row.appendChild(el('span', 'lrule', it.plan.rule_text || ''));
      row.addEventListener('click', function () { openPlanModal(it.plan); });
      els.lifeList.appendChild(row);
    });
    if (!items.length) els.lifeList.appendChild(el('div', 'life-empty', '这天没有安排计划'));
    els.lifeDate.textContent = fmtLifeDate(state.lifeDate);
    els.lifeStat.textContent = '安排 ' + items.length + ' · 完成 ' + done;
  }

  function lifeToggle(it) {
    if (!it.task) {
      toast('实例尚未生成，请稍后刷新重试', true);
      return;
    }
    if (it.task.status === 'done') {
      MYTODO_API.reopenTask(it.task.id)
        .then(function () { return refreshLife(); })
        .catch(function (e) { toast('操作失败：' + e.message, true); });
      return;
    }
    openDoneModal(it.task.id, it.plan.title, 'life'); // 打卡也走备注弹窗(可空/取消)
  }

  function shiftLifeDate(n) {
    var base = state.lifeDate ? new Date(state.lifeDate + 'T00:00:00') : new Date();
    base.setDate(base.getDate() + n);
    state.lifeDate = localIso(base);
    void refreshLife();
  }

  function switchLifeTab(tab) {
    state.lifeTab = tab;
    els.lifeTabToday.classList.toggle('on', tab === 'today');
    els.lifeTabPlans.classList.toggle('on', tab === 'plans');
    els.lifeList.classList.toggle('hidden', tab !== 'today');
    els.planList.classList.toggle('hidden', tab !== 'plans');
    if (tab === 'plans' && !state.plans.length) void refreshPlans();
  }

  async function refreshPlans() {
    try {
      state.plans = await MYTODO_API.listPlans();
    } catch (e) {
      state.plans = [];
    }
    renderPlanList();
  }

  function renderPlanList() {
    els.planList.textContent = '';
    if (!state.plans.length) {
      els.planList.appendChild(el('div', 'life-empty', '还没有计划，点下方按钮新增'));
      return;
    }
    state.plans.forEach(function (p) {
      var cat = catById(p.category_id);
      var row = el('div', 'plan-item' + (p.enabled ? '' : ' disabled'));
      row.title = '点击编辑';
      var main = el('div', 'pmain');
      main.appendChild(el('div', 'ptitle', p.title));
      var meta = el('div', 'pmeta');
      var dot = el('i', 'pdot');
      dot.style.background = cat ? cat.color : 'var(--text-3)';
      meta.appendChild(dot);
      meta.appendChild(document.createTextNode((cat ? cat.name : '未分类') + ' · ' + (p.rule_text || '')));
      main.appendChild(meta);
      row.appendChild(main);
      row.appendChild(el('span', 'pbadge' + (p.enabled ? ' on' : ''), p.enabled ? '启用' : '停用'));
      row.addEventListener('click', function () { openPlanModal(p); });
      els.planList.appendChild(row);
    });
  }

  function catById(id) {
    for (var i = 0; i < state.categories.length; i++) {
      if (state.categories[i].id === id) return state.categories[i];
    }
    return null;
  }

  // ---------- 计划新增/编辑弹窗 ----------

  function setPlanRuleUI(mode, rule) {
    state.planRule = mode;
    var btns = els.planRuleTypes.querySelectorAll('.pr-type');
    btns.forEach(function (b) {
      b.classList.toggle('on', b.dataset.mode === mode || (!b.dataset.mode && b.dataset.t === mode));
    });
    els.planRuleParam.querySelectorAll('.prp').forEach(function (p) { p.classList.add('hidden'); });
    if (mode === 'interval') els.planRuleParam.querySelector('.prp-interval').classList.remove('hidden');
    else if (mode === 'weekly') els.planRuleParam.querySelector('.prp-weekly').classList.remove('hidden');
    else if (mode === 'weekly_times' || mode === 'monthly_times') els.planRuleParam.querySelector('.prp-times').classList.remove('hidden');
    if (rule && rule.type === 'interval' && rule.interval_days > 1) els.planInterval.value = rule.interval_days;
    if (rule && rule.times) els.planTimes.value = rule.times;
    if (mode === 'weekly') renderWeekdayChips(rule && rule.weekdays ? rule.weekdays : []);
  }

  function renderWeekdayChips(selected) {
    els.planWeekdays.textContent = '';
    WD_NAMES.forEach(function (name, i) {
      var chip = el('button', 'wd-chip' + (selected.indexOf(i) !== -1 ? ' on' : ''), name);
      chip.dataset.wd = String(i);
      chip.type = 'button';
      chip.addEventListener('click', function () { chip.classList.toggle('on'); });
      els.planWeekdays.appendChild(chip);
    });
  }

  async function openPlanModal(plan) {
    state.editingPlan = plan || null;
    els.planSheetTitle.textContent = plan ? '编辑计划' : '新增计划';
    els.planTitle.value = plan ? plan.title : '';
    els.planDesc.value = plan && plan.description ? plan.description : '';
    if (!state.categories.length) {
      try { state.categories = await MYTODO_API.getCategories(); } catch (e) { /* 忽略 */ }
    }
    state.planCat = plan ? plan.category_id : null;
    renderPlanCats();
    // 频率反选
    var mode = 'daily';
    if (plan) {
      var r = plan.rule || {};
      if (plan.rule_type === 'interval') mode = r.interval_days > 1 ? 'interval' : 'daily';
      else mode = plan.rule_type; // weekly / weekly_times / monthly_times
    }
    setPlanRuleUI(mode, plan ? plan.rule : null);
    els.planStart.value = plan ? plan.start_date : localIso(new Date());
    els.planEnd.value = plan && plan.end_date ? plan.end_date : '';
    els.planManage.classList.toggle('hidden', !plan);
    if (plan) {
      els.planToggle.textContent = plan.enabled ? '停用' : '启用';
      els.planDelete.textContent = '删除';
      els.planDelete.classList.remove('confirm');
    }
    els.planModal.classList.remove('hidden');
    setTimeout(function () { els.planTitle.focus(); }, 40);
  }

  function closePlanModal() {
    els.planModal.classList.add('hidden');
    state.editingPlan = null;
  }

  function renderPlanCats() {
    els.planCats.textContent = '';
    state.categories.forEach(function (c) {
      var chip = el('button', 'ac-chip' + (state.planCat === c.id ? ' sel' : ''));
      chip.type = 'button';
      chip.dataset.cat = c.id;
      var dot = el('i', 'dot');
      dot.style.background = c.color || 'var(--primary)';
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(c.name));
      chip.addEventListener('click', function () {
        state.planCat = state.planCat === c.id ? null : c.id;
        renderPlanCats();
      });
      els.planCats.appendChild(chip);
    });
  }

  function buildPlanRule() {
    var mode = state.planRule;
    if (mode === 'daily') return { type: 'interval', weekdays: null, interval_days: 1, times: null };
    if (mode === 'interval') {
      var n = Math.max(1, Math.min(366, parseInt(els.planInterval.value, 10) || 1));
      return { type: 'interval', weekdays: null, interval_days: n, times: null };
    }
    if (mode === 'weekly') {
      var wds = [];
      els.planWeekdays.querySelectorAll('.wd-chip.on').forEach(function (c) { wds.push(parseInt(c.dataset.wd, 10)); });
      wds.sort();
      return { type: 'weekly', weekdays: wds, interval_days: null, times: null };
    }
    var maxT = mode === 'weekly_times' ? 7 : 31;
    var t = Math.max(1, Math.min(maxT, parseInt(els.planTimes.value, 10) || 1));
    return { type: mode, weekdays: null, interval_days: null, times: t };
  }

  async function submitPlan() {
    var title = els.planTitle.value.trim();
    if (!title) {
      toast('计划名称不能为空', true);
      return;
    }
    if (!state.planCat) {
      toast('计划必须选择类型(类别)', true); // 与后端 422 文案一致
      return;
    }
    var rule = buildPlanRule();
    if (rule.type === 'weekly' && !rule.weekdays.length) {
      toast('每周几：请至少选择一个星期', true);
      return;
    }
    if (state.adding) return;
    state.adding = true;
    els.planSubmit.disabled = true;
    try {
      var body = {
        title: title,
        description: els.planDesc.value.trim() || null,
        category_id: state.planCat,
        start_date: els.planStart.value || localIso(new Date()),
        end_date: els.planEnd.value || null,
        rule: rule
      };
      if (state.editingPlan) {
        body.enabled = state.editingPlan.enabled;
        await MYTODO_API.updatePlan(state.editingPlan.id, body);
      } else {
        await MYTODO_API.createPlan(body);
      }
      closePlanModal();
      toast(state.editingPlan ? '计划已更新' : '计划已创建');
      await refreshPlans();
      await refreshLife();
    } catch (e) {
      toast('保存失败：' + e.message, true);
    } finally {
      state.adding = false;
      els.planSubmit.disabled = false;
    }
  }

  // ---------- 完成备注弹窗(todo 完成与规律生活打卡共用) ----------

  function openDoneModal(taskId, title, source) {
    state.doneTarget = taskId;
    state.doneSrc = source || 'today';
    els.doneTitle.textContent = '完成「' + (title || '(无标题)') + '」';
    els.doneNote.value = '';
    els.doneModal.classList.remove('hidden');
    setTimeout(function () { els.doneNote.focus(); }, 40);
  }

  function closeDoneModal() {
    els.doneModal.classList.add('hidden');
    state.doneTarget = null;
  }

  async function submitDone() {
    if (!state.doneTarget) return;
    if (state.adding) return;
    state.adding = true;
    els.doneSubmit.disabled = true;
    try {
      await MYTODO_API.completeTask(state.doneTarget, els.doneNote.value);
      closeDoneModal();
      toast(state.doneSrc === 'life' ? '打卡完成' : '已完成');
      if (state.doneSrc === 'life') await refreshLife();
      else await refreshToday(false);
    } catch (e) {
      toast('完成失败：' + e.message, true);
    } finally {
      state.adding = false;
      els.doneSubmit.disabled = false;
    }
  }

  function findTask(taskId) {
    if (!state.today) return null;
    var qs = state.today.quadrants || [];
    for (var i = 0; i < qs.length; i++) {
      var ts = qs[i].tasks || [];
      for (var j = 0; j < ts.length; j++) {
        if (ts[j].id === taskId) return ts[j];
      }
    }
    return null;
  }

  // ---------- 待迁移视图 ----------

  function renderMigrations() {
    els.migList.textContent = '';
    var items = state.migrations;

    var n = items.length;
    var needManual = items.filter(function (t) { return !!t.intervention_required; }).length;
    els.migViewCount.textContent = n > 0 ? '（' + n + '）' : '';

    if (n === 0) {
      els.migList.appendChild(el('div', 'mig-empty', '没有待迁移的任务 🎉'));
    }

    items.forEach(function (t) {
      var item = el('div', 'mig-item');
      var info = el('div', 'mig-info');
      info.appendChild(el('div', 'mig-item-title', t.title || '(无标题)'));

      var days = t.days_procrastinated;
      var meta = el('div', 'mig-item-meta');
      meta.appendChild(el('span', null, '⟲ 来自 ' + fmtDate(t.original_date) + ' · 拖延 ' + (days == null ? '?' : days) + ' 天'));
      if (t.intervention_required) {
        var warnTag = el('span', 'warn-tag', '⚠ 已拖延较久');
        warnTag.title = '已迁移 ' + (t.migrated_count || 0) + ' 次，达到人工干预阈值，一键迁移将跳过它';
        meta.appendChild(warnTag);
      }
      info.appendChild(meta);
      item.appendChild(info);

      var btn = el('button', 'mig-btn', '迁到今天');
      btn.addEventListener('click', function () { migrateOne(t.id, btn); });
      item.appendChild(btn);

      els.migList.appendChild(item);
    });

    var bulkCount = n - needManual;
    if (bulkCount > 0) {
      els.migAllBtn.disabled = false;
      els.migAllBtn.textContent = '';
      els.migAllBtn.appendChild(document.createTextNode('一键全部迁移 '));
      var small = el('small', null, '（' + bulkCount + ' 个可自动' + (needManual > 0 ? '，' + needManual + ' 个需人工' : '') + '）');
      els.migAllBtn.appendChild(small);
    } else {
      els.migAllBtn.disabled = true;
      els.migAllBtn.textContent = needManual > 0 ? '均需人工处理，请到完整版决定' : '一键全部迁移';
    }
  }

  async function migrateOne(taskId, btn) {
    if (btn) btn.disabled = true;
    try {
      var r = await MYTODO_API.bulkMigrate([taskId], 'today');
      toast('已迁移 ' + (r && r.migrated != null ? r.migrated : 1) + ' 个任务');
      await reloadMigrations();
    } catch (e) {
      if (btn) btn.disabled = false;
      toast('迁移失败：' + e.message, true);
    }
  }

  async function migrateAll() {
    var ids = state.migrations
      .filter(function (t) { return !t.intervention_required; })
      .map(function (t) { return t.id; });
    if (ids.length === 0) return;
    els.migAllBtn.disabled = true;
    try {
      var r = await MYTODO_API.bulkMigrate(ids, 'today');
      toast('已迁移 ' + (r && r.migrated != null ? r.migrated : ids.length) + ' 个任务');
      await reloadMigrations();
    } catch (e) {
      toast('迁移失败：' + e.message, true);
      els.migAllBtn.disabled = false;
    }
  }

  async function reloadMigrations() {
    try {
      state.migrations = (await MYTODO_API.getPendingMigrations()) || [];
    } catch (e) {
      state.migrations = [];
      toast('加载待迁移失败：' + e.message, true);
    }
    renderMigrations();
    if (state.migrations.length === 0 && state.view === 'migrations') {
      switchView('main');
      await refreshToday(false);
    }
  }

  // ---------- 视图切换 ----------

  function switchView(view) {
    state.view = view;
    els.viewMain.classList.toggle('hidden', view !== 'main');
    els.viewMigrations.classList.toggle('hidden', view !== 'migrations');
    els.viewLife.classList.toggle('hidden', view !== 'life');
  }

  // ---------- 数据加载 ----------
  // 版本号防竞态:快速连续操作触发多个刷新请求时,旧响应后到会被丢弃,
  // 否则会把界面回退成过期数据(看起来像"拖了没动")
  var refreshSeq = 0;

  async function refreshToday(showLoading) {
    var seq = ++refreshSeq;
    if (showLoading) showStatus(true, '加载中…', false);
    try {
      var data = await MYTODO_API.getToday();
      if (seq !== refreshSeq) return; // 已有更新的请求,丢弃本次过期响应
      state.today = data;
      renderMain();
      hideStatus();
      // 扩展环境:让后台立即重排今天的任务定时通知(chrome 渠道),不等 5 分钟轮询
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage({ type: 'mytodo-sync-notify' });
        }
      } catch (e) { /* 忽略 */ }
    } catch (e) {
      if (seq !== refreshSeq) return;
      showStatus(false, '加载失败：' + e.message, true);
    }
  }

  // ---------- 自动同步 ----------
  // 面板常开时外部改动(web端/API)不会推送过来,这里做三层兜底:
  // ① 宿主打开面板时 postMessage 通知立即刷新;② 可见期间 20s 静默轮询;③ 窗口聚焦时刷新
  function panelHidden() {
    try {
      var fe = window.frameElement;
      // 机器人面板收起时 iframe 处于 display:none 子树 → offsetParent 为 null
      return !!fe && !fe.offsetParent;
    } catch (e) {
      return false; // 跨域拿不到 frameElement,按可见处理
    }
  }

  function maybeAutoRefresh() {
    if (state.adding) return;
    if (document.hidden || panelHidden()) return;
    void refreshToday(false);
  }

  function setupAutoSync() {
    window.addEventListener('message', function (ev) {
      if (ev.data && ev.data.type === 'mytodo-refresh') maybeAutoRefresh();
    });
    window.addEventListener('focus', maybeAutoRefresh);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) maybeAutoRefresh();
    });
    setInterval(maybeAutoRefresh, 20000);
  }

  // ---------- 事件绑定 ----------

  function bindEvents() {
    // 任务勾选（事件委托）
    els.grid.addEventListener('click', function (ev) {
      var check = ev.target.closest ? ev.target.closest('.check') : null;
      if (!check) return;
      var row = check.closest('.task');
      if (row && row.dataset.taskId) toggleTask(row.dataset.taskId);
    });

    // 右键任务行 → 编辑
    els.grid.addEventListener('contextmenu', function (ev) {
      var row = ev.target.closest ? ev.target.closest('.task') : null;
      if (!row || !row.dataset.taskId) return;
      var task = findTask(row.dataset.taskId);
      if (!task) return;
      ev.preventDefault();
      openEditModal(task);
    });

    // 新增任务弹窗
    els.addTrigger.addEventListener('click', openAddModal);
    els.addClose.addEventListener('click', closeAddModal);
    els.addSubmit.addEventListener('click', submitAdd);
    els.addTitle.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        submitAdd();
      }
    });
    els.addModal.addEventListener('click', function (ev) {
      if (ev.target === els.addModal) closeAddModal(); // 点遮罩关闭
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        if (ptrDrag && ptrDrag.active) {
          cancelRowDrag(); // 拖拽中 Esc → 取消拖拽
          return;
        }
        if (!els.addModal.classList.contains('hidden')) closeAddModal();
        if (!els.setModal.classList.contains('hidden')) closeSettings();
      }
    });

    // 待迁移入口 / 返回
    els.migBadge.addEventListener('click', async function () {
      switchView('migrations');
      els.migList.textContent = '';
      els.migList.appendChild(el('div', 'mig-empty', '加载中…'));
      els.migAllBtn.disabled = true;
      els.migAllBtn.textContent = '一键全部迁移';
      try {
        state.migrations = (await MYTODO_API.getPendingMigrations()) || [];
      } catch (e) {
        state.migrations = [];
        els.migList.textContent = '';
        els.migList.appendChild(el('div', 'mig-empty', '加载失败：' + e.message));
        return;
      }
      renderMigrations();
    });
    els.migBack.addEventListener('click', function () { switchView('main'); });
    els.migAllBtn.addEventListener('click', migrateAll);

    // 重试
    els.retryBtn.addEventListener('click', function () { refreshToday(true); });

    // 打开完整版（顶栏外链按钮）
    function openFullApp() {
      return MYTODO_API.getConfig().then(function (cfg) {
        window.open(MYTODO_API.normalizeBase(cfg.server_url) + '/', '_blank');
      });
    }
    els.openFullTop.addEventListener('click', function () {
      void openFullApp();
    });
    // 设置:弹窗内配置(服务器地址/Token/机器人开关,保存在本地)
    // 嵌入模式顶栏 ✕:通知宿主(content.js)关闭面板
    var embClose = document.getElementById('embedded-close');
    if (embClose) embClose.addEventListener('click', function () {
      if (window.self !== window.top) window.parent.postMessage({ type: 'mytodo-close-panel' }, '*');
    });

    els.openSettings.addEventListener('click', function () {
      void openSettings();
    });
    els.setClose.addEventListener('click', closeSettings);
    els.setSave.addEventListener('click', saveSettings);
    els.setModal.addEventListener('click', function (ev) {
      if (ev.target === els.setModal) closeSettings(); // 点遮罩关闭
    });
    // 规律生活:视图入口与导航
    els.lifeBtn.addEventListener('click', openLife);
    els.lifeBack.addEventListener('click', function () { switchView('main'); });
    els.lifePrev.addEventListener('click', function () { shiftLifeDate(-1); });
    els.lifeNext.addEventListener('click', function () { shiftLifeDate(1); });
    els.lifeTodayBtn.addEventListener('click', function () {
      state.lifeDate = null;
      void refreshLife();
    });
    els.lifeTabToday.addEventListener('click', function () { switchLifeTab('today'); });
    els.lifeTabPlans.addEventListener('click', function () { switchLifeTab('plans'); });

    // 计划弹窗:新增/编辑/启停/删除
    els.planAddBtn.addEventListener('click', function () { void openPlanModal(null); });
    els.planClose.addEventListener('click', closePlanModal);
    els.planSubmit.addEventListener('click', function () { void submitPlan(); });
    els.planModal.addEventListener('click', function (ev) {
      if (ev.target === els.planModal) closePlanModal();
    });
    els.planRuleTypes.addEventListener('click', function (ev) {
      var b = ev.target.closest('.pr-type');
      if (!b) return;
      setPlanRuleUI(b.dataset.mode || b.dataset.t, null);
    });
    els.planToggle.addEventListener('click', function () {
      var p = state.editingPlan;
      if (!p) return;
      MYTODO_API.updatePlan(p.id, { enabled: !p.enabled })
        .then(function () {
          toast(!p.enabled ? '已启用' : '已停用');
          return Promise.all([refreshPlans(), refreshLife()]);
        })
        .then(function () { closePlanModal(); })
        .catch(function (e) { toast('操作失败：' + e.message, true); });
    });
    els.planDelete.addEventListener('click', function () {
      var p = state.editingPlan;
      if (!p) return;
      if (!els.planDelete.classList.contains('confirm')) {
        els.planDelete.classList.add('confirm');
        els.planDelete.textContent = '再点一次确认删除';
        return;
      }
      MYTODO_API.deletePlan(p.id)
        .then(function () {
          toast('计划已删除');
          closePlanModal();
          return Promise.all([refreshPlans(), refreshLife()]);
        })
        .catch(function (e) { toast('删除失败：' + e.message, true); });
    });

    // 完成备注弹窗:完成/取消(✕/遮罩/Enter 均不改动任务状态)
    els.doneSubmit.addEventListener('click', function () { void submitDone(); });
    els.doneClose.addEventListener('click', closeDoneModal);
    els.doneModal.addEventListener('click', function (ev) {
      if (ev.target === els.doneModal) closeDoneModal();
    });
    els.doneNote.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        void submitDone();
      }
    });

    // 令牌/密钥默认遮蔽(******),点眼睛切换明文
    document.querySelectorAll('.secret-row .eye').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.getElementById(btn.dataset.for);
        if (!input) return;
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.classList.toggle('on', show);
        btn.title = show ? '点击隐藏' : '点击查看';
        btn.textContent = show ? '🙈' : '👁';
      });
    });
  }

  // ---------- 启动 ----------
  async function init() {
    bindEvents();
    setupAutoSync();
    await refreshToday(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
