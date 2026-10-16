/** 占位文本：英文 Lorem Ipsum / 中文千字文风格；按段落/句数生成 */
import { useMemo, useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, Segmented, LBL, inputCls } from '../kit'
import { lorem } from '../lib/text'

export default function LoremTool() {
  const [lang, setLang] = useState('zh')
  const [paragraphs, setParagraphs] = useState(3)
  const [sentences, setSentences] = useState(4)
  const [seed, setSeed] = useState(0)

  const output = useMemo(
    () => lorem({ lang, paragraphs, sentencesPerPara: sentences }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, paragraphs, sentences, seed])

  return (
    <div>
      <ToolHead title="占位文本" desc="排版/原型占位：英文 Lorem Ipsum 与中文千字文风格随机句子"
        right={<>
          <Segmented value={lang} onChange={setLang} options={[
            { key: 'zh', label: '中文' },
            { key: 'en', label: 'English' },
          ]} />
          <label className="flex items-center gap-1.5 text-[13px] text-stone-600 dark:text-stone-300">
            段落 <input type="number" min={1} max={20} className={inputCls + ' w-16'} value={paragraphs}
              onChange={e => setParagraphs(Math.max(1, Math.min(20, +e.target.value || 1)))} />
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-stone-600 dark:text-stone-300">
            每段句数 <input type="number" min={1} max={10} className={inputCls + ' w-16'} value={sentences}
              onChange={e => setSentences(Math.max(1, Math.min(10, +e.target.value || 1)))} />
          </label>
          <button className="px-3 py-2 text-sm font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-stone-700 dark:text-stone-200 hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors"
            onClick={() => setSeed(s => s + 1)}>重新生成</button>
        </>} />
      <TwoPane
        leftTitle="参数"
        rightTitle={`输出 · ${paragraphs} 段`}
        left={
          <div className="space-y-3 text-[13px] text-stone-600 dark:text-stone-300">
            <p>生成 {paragraphs} 段 × 每段 {sentences} 句的占位文本。</p>
            <p className={LBL}>中文语料取自《千字文》词组，英文为经典 Lorem Ipsum 词表；每次「重新生成」随机重排。</p>
            <button className="text-[12.5px] text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 underline underline-offset-2"
              onClick={() => setSeed(s => s + 1)}>再随机一次</button>
          </div>
        }
        right={<textarea className={'font-mono text-[13px] leading-relaxed p-3 rounded-lg border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-stone-700 dark:text-stone-200 whitespace-pre-wrap'} rows={14} readOnly value={output} />}
        rightActions={<CopyBtn text={output} />} />
    </div>
  )
}
