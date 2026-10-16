/** 文本统计：字符/CJK/词/行/字节/段落 + 词频 TOP（与 diary 后端 CJK 口径一致） */
import { useMemo, useState } from 'react'
import { ToolHead, LBL, areaCls, card } from '../kit'
import { textStats, wordFrequency } from '../lib/text'

const SAMPLE = `DouBlog 是一个前后端分离的单用户博客系统。
FastAPI 后端 + React 前端，日志与异常统一走 lizysdk。

The quick brown fox jumps over the lazy dog.
The quick brown fox jumps over the lazy dog again.`

export default function TextStatsTool() {
  const [text, setText] = useState(SAMPLE)

  const stats = useMemo(() => textStats(text), [text])
  const freq = useMemo(() => text.trim() ? wordFrequency(text, 12) : [], [text])

  const items = [
    ['字符数', stats.chars, '含空格换行'],
    ['字符数（不含空白）', stats.charsNoWs, ''],
    ['CJK 字数', stats.cjk, '中日韩逐字计数'],
    ['英文单词数', stats.words, '字母数字连串'],
    ['行数', stats.lines, `非空 ${stats.nonEmptyLines} 行`],
    ['段落数', stats.paragraphs, '空行分隔'],
    ['UTF-8 字节', stats.bytes, ''],
    ['最长行', stats.maxLineLen, '字符数'],
  ]

  const maxCount = freq.length ? freq[0][1] : 1

  return (
    <div>
      <ToolHead title="文本统计" desc="字符 / CJK 字数 / 单词 / 行 / 字节 / 词频（纯本地计算）" />
      <textarea className={areaCls} rows={10} value={text} spellCheck={false}
        onChange={e => setText(e.target.value)} placeholder="输入或粘贴文本…" aria-label="待统计文本" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        {items.map(([label, value, hint]) => (
          <div key={label} className={card + ' p-4'}>
            <p className="text-lg font-semibold tabular-nums">{value.toLocaleString?.() ?? value}</p>
            <p className="text-xs text-stone-600 dark:text-stone-300 mt-0.5">{label}</p>
            {hint && <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-0.5">{hint}</p>}
          </div>
        ))}
      </div>
      {freq.length > 0 && (
        <div className={card + ' p-4 mt-4'}>
          <p className="text-sm font-semibold mb-3">词频 TOP {freq.length}<span className={LBL + ' ml-2 font-normal'}>CJK 逐字 + 西文按词</span></p>
          <div className="space-y-1.5">
            {freq.map(([w, n]) => (
              <div key={w} className="flex items-center gap-2">
                <code className="w-24 shrink-0 font-mono text-[12.5px] text-stone-700 dark:text-stone-200 truncate">{w}</code>
                <div className="flex-1 h-4 rounded bg-black/[0.04] dark:bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded bg-lime-500/60 dark:bg-lime-400/50" style={{ width: `${Math.max(2, n / maxCount * 100)}%` }} />
                </div>
                <span className="w-10 text-right text-xs tabular-nums text-stone-500 dark:text-stone-400">{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
