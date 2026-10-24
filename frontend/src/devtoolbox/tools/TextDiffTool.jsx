import { useState } from 'react'
import { ToolHead, Check, Segmented } from '../kit'
import CodeEditor from '../../shared/CodeEditor'
import DiffViewer from '../../shared/DiffViewer'
const SAMPLE_A = `server:
  port: 60100
  workers: 1
  timeout: 30
  debug: true
logging:
  level: INFO
  file: data/logs/doublog.log`
const SAMPLE_B = `server:
  port: 60100
  workers: 2
  timeout: 60
  debug: false
logging:
  level: WARNING
  file: data/logs/doublog.log
  rotate: daily`


export default function TextDiffTool() {
  const [a, setA] = useState(SAMPLE_A), [b, setB] = useState(SAMPLE_B)
  const [view, setView] = useState('side'), [ignoreCase, setIgnoreCase] = useState(false), [ignoreWs, setIgnoreWs] = useState(false), [inline, setInline] = useState(true)
  return <div>
    <ToolHead title="文本对比" desc="本地 Worker 计算，可变行高虚拟列表；超过预算会明确停止" right={<>
      <Segmented value={view} onChange={setView} options={[{key:'side',label:'并排'},{key:'unified',label:'统一'}]} />
      <Check checked={ignoreCase} onChange={setIgnoreCase} label="忽略大小写" /><Check checked={ignoreWs} onChange={setIgnoreWs} label="忽略空白" /><Check checked={inline} onChange={setInline} label="行内高亮" />
    </>} />
    <div className="grid grid-cols-2 gap-4"><CodeEditor value={a} onChange={setA} height={300} ariaLabel="原文本" /><CodeEditor value={b} onChange={setB} height={300} ariaLabel="新文本" /></div>
    <DiffViewer {...{a,b,view,ignoreCase,ignoreWs,inline}} />
  </div>
}
