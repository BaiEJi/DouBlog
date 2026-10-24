/** Base64 编解码：文本（UTF-8 安全）与文件 → data URL；URL-safe 变体可选 */
import { useRef, useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, Segmented, Check, StatusLine, LBL, btn } from '../kit'
import { formatBytes } from '../lib/misc'
import useComputation from '../../shared/useComputation'
import CodeEditor from '../../shared/CodeEditor'

export default function Base64Tool({ toast }) {
  const [mode, setMode] = useState('encode')
  const [urlSafe, setUrlSafe] = useState(false)
  const [text, setText] = useState('你好，DouBlog！Hello, world! 🌏')
  const [fileInfo, setFileInfo] = useState(null)
  const fileRef = useRef(null)

  const computation = useComputation('base64', { text, mode, urlSafe })
  const output = computation.result?.output || '', error = computation.error

  const onFile = f => {
    if (!f) return
    if (f.size > 4 * 1024 * 1024) { toast({ msg: '文件超过 4MB，超出本工具处理范围', kind: 'error' }); return }
    const reader = new FileReader()
    reader.onload = () => {
      setFileInfo({ name: f.name, size: f.size, type: f.type || 'application/octet-stream', dataUrl: reader.result })
      setText(`（已载入文件 ${f.name}——见下方文件结果区）`)
    }
    reader.onerror = () => toast({ msg: '文件读取失败', kind: 'error' })
    reader.readAsDataURL(f)
  }

  return (
    <div>
      <ToolHead title="Base64" desc="编解码（UTF-8 安全）；文件转 data URL（≤4MB，本地读取不上传）"
        right={<>
          <Segmented value={mode} onChange={setMode} options={[
            { key: 'encode', label: '编码' },
            { key: 'decode', label: '解码' },
          ]} />
          <Check checked={urlSafe} onChange={setUrlSafe} label="URL-safe" />
          <button className={btn} onClick={() => fileRef.current?.click()}>选择文件…</button>
          <input ref={fileRef} type="file" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
        </>} />
      <TwoPane
        leftTitle={mode === 'encode' ? '原文' : 'Base64'}
        rightTitle={mode === 'encode' ? 'Base64' : '原文'}
        left={<CodeEditor value={text} onChange={setText} height={320} ariaLabel="Base64 输入" />}
        right={<CodeEditor readOnly value={output} height={320} ariaLabel="Base64 结果" />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      <div className="mt-2"><StatusLine ok={!error && output !== ''} err={error} okText="完成" /></div>
      {fileInfo && (
        <div className="mt-4 p-4 rounded-xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{fileInfo.name}</p>
              <p className={'mt-0.5 ' + LBL}>{fileInfo.type} · {formatBytes(fileInfo.size)} · data URL 长度 {fileInfo.dataUrl.length.toLocaleString()}</p>
            </div>
            <CopyBtn text={fileInfo.dataUrl} label="复制 data URL" />
            <a href={fileInfo.dataUrl} download={fileInfo.name}
              className={btn}>下载原文件</a>
            <button className={btn} onClick={() => { setFileInfo(null); setText('') }}>清除</button>
          </div>
          {fileInfo.type.startsWith('image/') && (
            <img src={fileInfo.dataUrl} alt="文件预览" className="mt-3 max-h-48 rounded-lg border border-black/[0.06] dark:border-white/[0.08]" />
          )}
        </div>
      )}
    </div>
  )
}
