/** Markdown 预览：复用博客渲染管线（md.js：KaTeX/Mermaid/代码高亮/容器等 40+ 要素） */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ToolHead, CopyBtn, Segmented, areaCls, card } from '../kit'
import md, { renderMermaidDiagrams } from '../../shared/md'

const SAMPLE = `# 开发者工具箱 Markdown 预览

复用博客全功能渲染管线：**粗体**、*斜体*、~~删除线~~、\`行内代码\`、==高亮==。

## 代码块（高亮 + 复制按钮）

\`\`\`python
def hello(name: str) -> str:
    return f"Hello, {name}!"
\`\`\`

## 表格

| 工具 | 分类 | 本地/后端 |
|---|:---:|---|
| JSON Diff | JSON | 本地 |
| 哈希计算 | 加密 | 后端 |

## 数学公式

质能方程 $E = mc^2$，欧拉公式 $$e^{i\\pi} + 1 = 0$$

## 提示容器

::: tip
双链 \`[[文章名]]\` 仅在博客模块内解析，此处按普通文本展示。
:::

> 引用：简单胜于复杂（Simple is better than complex.）

- [x] 任务列表已完成
- [ ] 任务列表未完成
`

export default function MarkdownTool() {
  const [text, setText] = useState(SAMPLE)
  const [view, setView] = useState('split')
  const previewRef = useRef(null)

  const html = useMemo(() => {
    try {
      return md.render(text)
    } catch (e) {
      return `<p style="color:red">渲染失败：${e.message}</p>`
    }
  }, [text])

  useEffect(() => {
    if (previewRef.current) {
      previewRef.current.innerHTML = html
      if (view !== 'edit') {
        const timer = setTimeout(() => { renderMermaidDiagrams(false) }, 100)
        return () => clearTimeout(timer)
      }
    }
  }, [html, view])

  return (
    <div>
      <ToolHead title="Markdown 预览" desc="与博客文章同一渲染管线（markdown-it 12 插件 + KaTeX + Mermaid + 高亮）"
        right={<Segmented value={view} onChange={setView} options={[
          { key: 'split', label: '分屏' },
          { key: 'edit', label: '编辑' },
          { key: 'preview', label: '预览' },
        ]} />} />
      <div className={view === 'split' ? 'grid grid-cols-1 lg:grid-cols-2 gap-4' : ''}>
        {view !== 'preview' && (
          <textarea className={areaCls} rows={24} value={text} spellCheck={false}
            onChange={e => setText(e.target.value)} aria-label="Markdown 源码" />
        )}
        {view !== 'edit' && (
          <div className={card + ' overflow-y-auto max-h-[70vh] p-6'}>
            <div ref={previewRef} className="md-content text-sm" />
          </div>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <CopyBtn text={text} label="复制源码" />
      </div>
    </div>
  )
}
