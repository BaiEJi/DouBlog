// 公共侧栏布局 hook：宽度（180–420）与折叠（56px 窄轨）状态、拖动手势与键盘调整。
// 约束（见 docs/modules/frontend.md）：
// - 拖动过程中只通过 rAF 直接改写 aside 宽度，不触发 React 重渲染、不写存储；
//   pointerup / 键盘确认 / 折叠切换时才提交状态，由 effect 统一持久化
//   （doublog_sidebar_layout_v1）。
// - 仅鼠标主键开始拖动；pointer capture 保证移出边界仍可拖；pointerup/pointercancel/
//   lostpointercapture/窗口失焦/组件卸载都会结束手势；拖动中 Escape 回到开始前宽度。
// - 新的 width/collapsed 绝不作为业务子树的 key；正文组件在拖动期间不重渲染。
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  getSafeSidebarStorage,
  loadSidebarPreferences,
  saveSidebarPreferences,
} from './sidebarPreferences'

function mergeLayout(prev, next) {
  return {
    width: clampSidebarWidth(next.width ?? prev.width),
    collapsed: typeof next.collapsed === 'boolean' ? next.collapsed : prev.collapsed,
  }
}

/** storageOverride 仅供测试注入；生产路径经 getSafeSidebarStorage 在惰性
 * useState 初始化中获取一次——localStorage 属性 getter 抛 SecurityError 时
 * 返回稳定的 null 引用（不每渲染新建，effect 依赖不变），读写全部容错降级为
 * 纯内存状态。 */
export function useSidebarLayout(storageOverride) {
  const [storage] = useState(() => storageOverride ?? getSafeSidebarStorage())
  const [layout, setLayout] = useState(() => loadSidebarPreferences(storage))
  const [dragging, setDragging] = useState(false)
  const asideRef = useRef(null)
  const dragRef = useRef(null) // { startX, startWidth, pendingWidth, pointerId, raf, savedUserSelect, savedCursor }

  // 布局提交后统一落盘（拖动中不触发：rAF 只改 DOM 不 setState）
  useEffect(() => { saveSidebarPreferences(storage, layout) }, [storage, layout])

  const commit = useCallback((patch) => { setLayout(prev => mergeLayout(prev, patch)) }, [])
  const setWidth = useCallback((width) => { commit({ width }) }, [commit])
  const adjustWidth = useCallback((delta) => {
    setLayout(prev => mergeLayout(prev, { width: prev.width + delta }))
  }, [])
  const setCollapsed = useCallback((collapsed) => { commit({ collapsed }) }, [commit])
  const toggleCollapsed = useCallback(() => { setLayout(prev => mergeLayout(prev, { collapsed: !prev.collapsed })) }, [])
  const resetWidth = useCallback(() => { commit({ width: SIDEBAR_DEFAULT_WIDTH }) }, [commit])

  const applyPendingWidth = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    drag.raf = 0
    const aside = asideRef.current
    if (aside && Number.isFinite(drag.pendingWidth)) aside.style.width = `${drag.pendingWidth}px`
  }, [])

  const endDrag = useCallback((revert) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (drag.raf) cancelAnimationFrame(drag.raf)
    document.body.style.userSelect = drag.savedUserSelect || ''
    document.body.style.cursor = drag.savedCursor || ''
    setDragging(false)
    const finalWidth = revert ? drag.startWidth : clampSidebarWidth(drag.pendingWidth)
    setLayout(prev => mergeLayout(prev, { width: finalWidth }))
  }, [])

  const onHandlePointerDown = useCallback((event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    const aside = asideRef.current
    if (!aside || dragRef.current) return
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 已释放时忽略 */ }
    const rect = aside.getBoundingClientRect()
    dragRef.current = {
      startX: event.clientX,
      startWidth: rect.width,
      pendingWidth: rect.width,
      pointerId: event.pointerId,
      raf: 0,
      savedUserSelect: document.body.style.userSelect,
      savedCursor: document.body.style.cursor,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    setDragging(true)
  }, [])

  const onHandlePointerMove = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const next = clampSidebarWidth(drag.startWidth + (event.clientX - drag.startX))
    if (next === drag.pendingWidth) return
    drag.pendingWidth = next
    if (!drag.raf) drag.raf = requestAnimationFrame(applyPendingWidth)
  }, [applyPendingWidth])

  const onHandlePointerUp = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 已释放 */ }
    endDrag(false)
  }, [endDrag])

  const onHandlePointerCancel = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    endDrag(false)
  }, [endDrag])

  const onHandleLostPointerCapture = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    endDrag(false)
  }, [endDrag])

  const onHandleKeyDown = useCallback((event) => {
    if (dragRef.current) {
      if (event.key === 'Escape') { event.preventDefault(); endDrag(true) }
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      adjustWidth(event.key === 'ArrowRight' ? 10 : -10)
    } else if (event.key === 'Home') {
      event.preventDefault()
      commit({ width: SIDEBAR_MIN_WIDTH })
    } else if (event.key === 'End') {
      event.preventDefault()
      commit({ width: SIDEBAR_MAX_WIDTH })
    }
  }, [adjustWidth, commit, endDrag])

  // 拖动期间监听窗口失焦与 Escape，任何一条路径都必须结束手势。
  useEffect(() => {
    if (!dragging) return
    const onBlur = () => endDrag(false)
    const onKey = (event) => { if (event.key === 'Escape') endDrag(true) }
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKey)
    }
  }, [dragging, endDrag])

  // 组件卸载时若仍在拖动，恢复全局样式即可（不写存储）。
  useEffect(() => () => {
    const drag = dragRef.current
    if (drag) {
      if (drag.raf) cancelAnimationFrame(drag.raf)
      document.body.style.userSelect = drag.savedUserSelect || ''
      document.body.style.cursor = drag.savedCursor || ''
      dragRef.current = null
    }
  }, [])

  const width = layout.collapsed ? 56 : layout.width
  return {
    layout,
    width,
    dragging,
    asideRef,
    handleProps: {
      onPointerDown: onHandlePointerDown,
      onPointerMove: onHandlePointerMove,
      onPointerUp: onHandlePointerUp,
      onPointerCancel: onHandlePointerCancel,
      onLostPointerCapture: onHandleLostPointerCapture,
      onKeyDown: onHandleKeyDown,
    },
    setWidth,
    adjustWidth,
    setCollapsed,
    toggleCollapsed,
    resetWidth,
  }
}
