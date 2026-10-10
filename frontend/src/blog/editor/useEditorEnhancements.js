import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadImage } from '@/blog/api'

/**
 * 编辑器增强（CreatePost/EditPost 共用）：
 * - 图片粘贴 / 拖拽 / 工具栏按钮上传（POST /api/images/upload，成功后光标处插入 Markdown）
 * - 预览同步滚动（编辑区滚动 → 预览按比例跟随；用户滚预览时暂停同步 400ms）
 * - 块模板插入（表格 / mermaid / 代码块）
 *
 * 用法：
 *   const ed = useEditorEnhancements({ content, setContent })
 *   <textarea ref={ed.editorRef} onPaste={ed.handlePaste} onDrop={ed.handleDrop} onDragOver={e => e.preventDefault()} ... />
 *   <div ref={ed.previewRef} className="... overflow-y-auto">…预览…</div>
 */
export function useEditorEnhancements({ content, setContent, active = true }) {
  const [uploading, setUploading] = useState(0)
  const editorRef = useRef(null)
  const previewRef = useRef(null)
  const fileInputRef = useRef(null)

  /** 在光标处插入文本（块级内容自动补换行） */
  const insertText = useCallback((text) => {
    const ta = editorRef.current
    if (!ta) return
    const start = ta.selectionStart ?? content.length
    const end = ta.selectionEnd ?? start
    const next = content.slice(0, start) + text + content.slice(end)
    setContent(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + text.length
      ta.selectionStart = ta.selectionEnd = pos
    })
  }, [content, setContent])

  /** 上传图片文件并在光标处插入 ![alt](url) */
  const uploadAndInsert = useCallback(async (file) => {
    if (!file || !(file.type || '').startsWith('image/')) return false
    setUploading(n => n + 1)
    try {
      const d = await uploadImage(file)
      if (d?.success && d.data?.url) {
        const alt = (file.name || '图片').replace(/\.[^.]+$/, '').slice(0, 50)
        insertText(`![${alt}](${d.data.url})`)
        return true
      }
      console.error('图片上传失败:', d?.message)
      return false
    } catch (e) {
      console.error('图片上传失败:', e)
      return false
    } finally {
      setUploading(n => n - 1)
    }
  }, [insertText])

  /** 粘贴：剪贴板含图片时拦截并上传 */
  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if ((item.type || '').startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          uploadAndInsert(file)
        }
        return
      }
    }
  }, [uploadAndInsert])

  /** 拖拽：图片文件落进编辑区 */
  const handleDrop = useCallback((e) => {
    const files = [...(e.dataTransfer?.files || [])].filter(f => (f.type || '').startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    files.forEach(uploadAndInsert)
  }, [uploadAndInsert])

  /** 工具栏"图片"按钮：唤起文件选择 */
  const pickImage = useCallback(() => fileInputRef.current?.click(), [])

  // 同步滚动。依赖 [hasContent, active]：EditPost 是 先 setContent 后 setLoading，
  // hasContent 翻转时编辑器 JSX 尚未渲染（refs 为 null），loading 放行后编辑器
  // 才出现——两个信号任一变化都要重新尝试挂载监听
  const hasContent = content !== ''
  useEffect(() => {
    if (!active) return
    const ta = editorRef.current
    const pv = previewRef.current
    if (!ta || !pv) return
    let paused = false
    let pauseTimer = 0
    let writing = false

    const onPreviewScroll = () => {
      if (writing) return            // 我们自己写入引发的滚动
      paused = true                  // 用户在滚预览 → 暂停同步
      clearTimeout(pauseTimer)
      pauseTimer = setTimeout(() => { paused = false }, 400)
    }
    const onEditorScroll = () => {
      if (paused) return
      const eRange = ta.scrollHeight - ta.clientHeight
      const pRange = pv.scrollHeight - pv.clientHeight
      if (eRange <= 0 || pRange <= 0) return
      writing = true
      pv.scrollTop = (ta.scrollTop / eRange) * pRange
      setTimeout(() => { writing = false }, 60)
    }

    ta.addEventListener('scroll', onEditorScroll)
    pv.addEventListener('scroll', onPreviewScroll)
    return () => {
      ta.removeEventListener('scroll', onEditorScroll)
      pv.removeEventListener('scroll', onPreviewScroll)
      clearTimeout(pauseTimer)
    }
  }, [hasContent, active])

  return { editorRef, previewRef, fileInputRef, uploading, insertText, uploadAndInsert, handlePaste, handleDrop, pickImage }
}

/** 常用块模板（工具栏"表格/图表/代码块"插入） */
export const BLOCK_TEMPLATES = {
  table: '\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n',
  mermaid: '\n```mermaid\nflowchart LR\n  A[开始] --> B{判断}\n  B -->|是| C[结束]\n  B -->|否| A\n```\n',
  code: '\n```js\n// 代码\n```\n',
}
