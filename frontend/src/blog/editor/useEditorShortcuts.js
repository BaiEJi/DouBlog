import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * 编辑器页全局快捷键：
 * - Ctrl/Cmd+S 保存（任意输入位置生效）
 * - Ctrl/Cmd+B 加粗 **、Ctrl/Cmd+I 斜体 *、Ctrl/Cmd+K 插入链接 []()
 * - Tab 在正文输入框内插入两格缩进
 * B/I/K 仅在正文编辑区或页面空白处生效，避免干扰标题等普通输入框
 */
export function useEditorShortcuts({ onSave, insert }) {
  const ref = useRef({})
  useLayoutEffect(() => { ref.current = { onSave, insert } }, [onSave, insert])

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey
      const active = document.activeElement
      const inEditor = active && (active.id === 'md-editor' || active.closest?.('[data-code-editor]') || active.tagName === 'BODY')

      if (!mod) {
        if (e.key === 'Tab' && active && (active.id === 'md-editor' || active.closest?.('[data-code-editor]'))) {
          e.preventDefault()
          ref.current.insert('  ', '')
        }
        return
      }

      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        ref.current.onSave()
      } else if ((k === 'b' || k === 'i' || k === 'k') && inEditor) {
        e.preventDefault()
        if (k === 'b') ref.current.insert('**', '**')
        else if (k === 'i') ref.current.insert('*', '*')
        else ref.current.insert('[', '](url)')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
