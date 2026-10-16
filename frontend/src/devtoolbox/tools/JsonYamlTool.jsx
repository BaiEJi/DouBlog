/** JSON ⇄ YAML：经后端 PyYAML（保留键序与 Unicode；YAML 中的日期转字符串） */
import { useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, Segmented, StatusLine, LBL, areaCls } from '../kit'
import { dtYamlConvert } from '../api'

const SAMPLE_JSON = `{"app": "DouBlog", "port": 60100, "features": ["blog", "diary"], "db": {"backend": "postgres", "pool": 5}}`

export default function JsonYamlTool() {
  const [direction, setDirection] = useState('json2yaml')
  const [input, setInput] = useState(SAMPLE_JSON)
  const [output, setOutput] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const convert = async dir => {
    setDirection(dir)
    if (!input.trim()) { setOutput(''); setError(null); return }
    setBusy(true)
    try {
      const data = await dtYamlConvert(dir, input)
      setOutput(data.result)
      setError(null)
    } catch (e) {
      setOutput('')
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const onInput = v => { setInput(v); setOutput(''); setError(null) }

  return (
    <div>
      <ToolHead title="JSON ⇄ YAML" desc="双向转换（后端 PyYAML，保留键序与中文；日期序列化为字符串）"
        right={<Segmented value={direction} onChange={convert} options={[
          { key: 'json2yaml', label: 'JSON → YAML' },
          { key: 'yaml2json', label: 'YAML → JSON' },
        ]} />}>
      </ToolHead>
      <TwoPane
        leftTitle={direction === 'json2yaml' ? 'JSON' : 'YAML'}
        rightTitle={busy ? '转换中…' : '输出'}
        left={<textarea className={areaCls} rows={16} value={input} spellCheck={false}
          onChange={e => onInput(e.target.value)} />}
        right={<textarea className={'font-mono text-[13px] leading-relaxed p-3 rounded-lg border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-stone-700 dark:text-stone-200 whitespace-pre wrap'} rows={16} readOnly value={output} />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      <div className="mt-2 flex items-center gap-2">
        <StatusLine ok={!error && !!output} err={error} okText="转换完成" />
        <button className="text-[12.5px] text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 underline underline-offset-2"
          onClick={() => { onInput(output); setOutput(''); setDirection(direction === 'json2yaml' ? 'yaml2json' : 'json2yaml') }}>
          ⇄ 输出转入输入（反向再转）
        </button>
      </div>
      <p className={'mt-1 ' + LBL}>输入变化后点击上方方向按钮执行转换（不自动触发，避免频繁请求）。</p>
    </div>
  )
}
