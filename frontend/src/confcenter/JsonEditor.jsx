import CodeEditor from '../shared/CodeEditor'

/** CodeMirror 虚拟化长文档；保留原调用端 value/onChange/onBlur 契约。 */
export default function JsonEditor({ value, onChange, onBlur, onSave, rows = 10, invalid, id, ariaLabel = 'JSON 值编辑器' }) {
  return <div className={invalid ? 'rounded-lg ring-1 ring-red-500' : ''}>
    <CodeEditor id={id} value={value} onChange={onChange} onBlur={onBlur} onSave={onSave} language="json" height={Math.max(160, rows * 24 + 24)} ariaLabel={ariaLabel} />
  </div>
}

export function JsonHighlightedView({ text }) {
  return <CodeEditor value={text || ''} readOnly language="json" height={400} ariaLabel="完整值" />
}
