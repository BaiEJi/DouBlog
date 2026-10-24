/** JSON 转代码：TypeScript interface / Go struct / Python TypedDict（类型推断：合并数组元素类型） */
import { useState } from 'react'
import useComputation from '../../shared/useComputation'
import CodeEditor from '../../shared/CodeEditor'
import { ToolHead, TwoPane, CopyBtn, Segmented, StatusLine } from '../kit'

const SAMPLE = `{
  "id": 1,
  "name": "DouBlog",
  "active": true,
  "score": 92.5,
  "tags": ["fastapi", "react"],
  "db": { "host": "127.0.0.1", "port": 5432, "replicas": [1, 2] },
  "note": null
}`

export default function JsonToCodeTool() {
  const [text, setText] = useState(SAMPLE)
  const [lang, setLang] = useState('ts')

  const computation = useComputation('jsonCode', { text, lang })
  const output = computation.result?.output || '', error = computation.error

  return (
    <div>
      <ToolHead title="JSON 转代码" desc="推断类型并生成 TypeScript / Go / Python 类型定义（数组元素类型自动合并）"
        right={<Segmented value={lang} onChange={setLang} options={[
          { key: 'ts', label: 'TypeScript' },
          { key: 'go', label: 'Go' },
          { key: 'py', label: 'Python' },
        ]} />} />
      <TwoPane
        leftTitle="JSON"
        rightTitle="类型定义"
        left={<CodeEditor value={text} onChange={setText} language="json" height={400} ariaLabel="JSON 示例" />}
        right={<CodeEditor readOnly value={output} language={lang === 'ts' ? 'javascript' : 'text'} height={400} ariaLabel="生成类型定义" />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      <div className="mt-2"><StatusLine ok={!error && !!output} err={error} okText="生成完成" /></div>
    </div>
  )
}
