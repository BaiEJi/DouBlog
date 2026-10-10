/* 看板 UI 瞬态状态（zustand）：密度三档（localStorage 持久化）、HUD 折叠、
 * 图例隐藏类型、聚焦人物。数据类状态仍在 Workspace 主组件内。 */
import { create } from 'zustand'

const DENSITY_KEY = 'gm_density'

function loadDensity() {
  const v = localStorage.getItem(DENSITY_KEY)
  return v === 'compact' || v === 'detailed' ? v : 'standard'
}

export const useBoardUI = create((set) => ({
  density: loadDensity(),
  hudOpen: true,
  hiddenTypes: new Set(),
  focusId: null,
  setDensity: (d) => {
    localStorage.setItem(DENSITY_KEY, d)
    set({ density: d })
  },
  toggleHud: () => set((s) => ({ hudOpen: !s.hudOpen })),
  setHiddenTypes: (hiddenTypes) => set({ hiddenTypes }),
  setFocusId: (focusId) => set({ focusId }),
}))
