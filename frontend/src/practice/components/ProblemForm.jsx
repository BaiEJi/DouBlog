/**
 * 新增 / 编辑题目表单：
 * 顶部「从网站导入」条（粘贴链接 → 自动识别域名 → 抓取填充，失败原地中文提示）+
 * 基本信息区（来源/题号/标题/难度/链接/标签）+ 描述与易错点 Markdown 编辑（预览切换）+
 * 解法编辑器（动态增删；名称/思路/复杂度快选+自由输入/按语言 Tab 的代码编辑器）。
 * 编辑保存走差异同步：PATCH 题目（revision 乐观锁）→ 新增/更新/删除解法 → 新增/更新/删除代码。
 */
import { useEffect, useRef, useState } from 'react'

import {
  getProblem, createProblem, updateProblem,
  createSolution, updateSolution, deleteSolution,
  createCode, updateCode, deleteCode,
  fetchFromSite, detectSourceFromUrl, buildFetchPayload,
  SOURCES, DIFFICULTIES, LANGUAGES, langMeta,
} from '../api'
import { Segmented, Spinner, Field, inputCls, btn, Icon } from '../../todo/kit'
import TagSelect from './TagSelect'
import { MdBlock } from './ProblemDetail'

let keySeq = 0
const nextKey = () => `k${++keySeq}`

const COMPLEXITY_PRESETS = ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)', 'O(n²)', 'O(n³)', 'O(√n)', 'O(2ⁿ)']
const selectCls = 'h-9 px-2.5 rounded-lg text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'

/** Markdown 编辑区（textarea + 编辑/预览切换），描述/易错点/解法思路共用 */
function MdArea({ label, value, onChange, dark, minHeight = 200, placeholder = '支持 Markdown：代码块、公式、mermaid…' }) {
  const [mode, setMode] = useState('edit')
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
        <Segmented value={mode} onChange={setMode}
          options={[{ value: 'edit', label: '编辑' }, { value: 'preview', label: '预览' }]} />
      </div>
      {mode === 'edit' ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className={inputCls + ' font-mono text-[13px] leading-relaxed resize-y py-2.5'}
          style={{ minHeight }} />
      ) : (
        <div className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.04] px-4 py-3 min-h-[80px]">
          <MdBlock text={value} dark={dark} />
        </div>
      )}
    </div>
  )
}

/** 复杂度行：快选 chips + 自由输入 */
function ComplexityField({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-stone-500 dark:text-stone-400 shrink-0">{label}</span>
      <input value={value || ''} onChange={e => onChange(e.target.value)} placeholder="O(n)"
        className="w-32 h-8 px-2.5 rounded-lg text-sm font-mono bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors" />
      {COMPLEXITY_PRESETS.map(p => (
        <button type="button" key={p} onClick={() => onChange(p)}
          className={'h-7 px-2 rounded-md font-mono text-[11px] transition-colors ' +
            (value === p
              ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-medium'
              : 'bg-black/[0.05] dark:bg-white/[0.08] text-stone-500 dark:text-stone-400 hover:bg-black/10 dark:hover:bg-white/[0.14]')}>
          {p}
        </button>
      ))}
    </div>
  )
}

/** 单个解法编辑器 */
function SolutionEditor({ solution, index, onChange, onRemove, dark }) {
  const s = solution
  const patch = p => onChange({ ...s, ...p })
  const patchCode = (key, p) => patch({ codes: s.codes.map(c => (c.key === key ? { ...c, ...p } : c)) })
  const [activeCode, setActiveCode] = useState(s.codes[0]?.key || '')
  const active = s.codes.find(c => c.key === activeCode) || s.codes[0]
  useEffect(() => { if (!active && s.codes.length) setActiveCode(s.codes[0].key) }, [s.codes]) // eslint-disable-line react-hooks/exhaustive-deps

  const addLanguage = lang => {
    if (!lang || s.codes.some(c => c.language === lang)) return
    const c = { key: nextKey(), id: null, language: lang, code: '', note: '' }
    patch({ codes: [...s.codes, c] })
    setActiveCode(c.key)
  }
  const removeLanguage = key => {
    patch({ codes: s.codes.filter(c => c.key !== key) })
  }

  return (
    <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5">
      {/* 头部：解法名 + 主解法星标 + 删除 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-stone-400 tabular-nums shrink-0">#{index + 1}</span>
        <input value={s.name} onChange={e => patch({ name: e.target.value })} placeholder={`解法名称（如：动态规划）`}
          className="flex-1 min-w-[160px] h-9 px-3 rounded-lg text-sm font-medium bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors" />
        <button type="button" onClick={() => patch({ is_preferred: !s.is_preferred })} title="设为主解法（复习时优先展示）"
          className={'w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-colors ' +
            (s.is_preferred ? 'text-amber-500 bg-amber-500/10' : 'text-stone-300 dark:text-stone-600 hover:text-amber-400')}>
          ★
        </button>
        <button type="button" onClick={onRemove} title="删除此解法"
          className="w-9 h-9 rounded-xl flex items-center justify-center text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors">
          {Icon.trash}
        </button>
      </div>

      {/* 思路 */}
      <div className="mb-4">
        <MdArea label="思路（Markdown）" value={s.approach_md} onChange={v => patch({ approach_md: v })} dark={dark} minHeight={140} />
      </div>

      {/* 复杂度 */}
      <div className="space-y-2 mb-4">
        <ComplexityField label="时间复杂度" value={s.time_complexity} onChange={v => patch({ time_complexity: v })} />
        <ComplexityField label="空间复杂度" value={s.space_complexity} onChange={v => patch({ space_complexity: v })} />
      </div>

      {/* 代码区：按语言 Tab */}
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-xs text-stone-500 dark:text-stone-400">代码</span>
          {s.codes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {s.codes.map(c => (
                <button type="button" key={c.key} onClick={() => setActiveCode(c.key)}
                  className={'px-2.5 h-7 rounded-lg text-xs transition-colors ' +
                    (c.key === active?.key
                      ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium'
                      : 'bg-black/[0.05] dark:bg-white/[0.08] text-stone-500 dark:text-stone-400 hover:bg-black/10 dark:hover:bg-white/[0.14]')}>
                  {langMeta(c.language).label}
                </button>
              ))}
            </div>
          )}
          <select value="" onChange={e => addLanguage(e.target.value)} className="h-7 px-2 rounded-lg text-xs bg-black/[0.05] dark:bg-white/[0.08] border border-transparent dark:border-white/[0.06] outline-none focus:border-black/30 dark:focus:border-white/30 text-stone-500 dark:text-stone-400">
            <option value="">＋ 添加语言</option>
            {LANGUAGES.filter(l => !s.codes.some(c => c.language === l.value))
              .map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          {active && s.codes.length > 0 && (
            <button type="button" onClick={() => removeLanguage(active.key)}
              className="px-2 h-7 rounded-lg text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors">
              移除当前语言
            </button>
          )}
        </div>

        {active ? (
          <div className="space-y-2">
            <textarea value={active.code} onChange={e => patchCode(active.key, { code: e.target.value })}
              placeholder={`在此粘贴 ${langMeta(active.language).label} 代码…`}
              className="w-full px-3 py-2.5 rounded-lg font-mono text-[13px] leading-relaxed resize-y bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors"
              style={{ minHeight: 180 }} />
            <input value={active.note} onChange={e => patchCode(active.key, { note: e.target.value })}
              placeholder="备注（可空）：如「注意边界处理」"
              className="w-full h-8 px-3 rounded-lg text-xs bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors" />
          </div>
        ) : (
          <div className="py-4 text-center text-xs text-stone-400 rounded-lg border border-dashed border-black/[0.12] dark:border-white/[0.12]">
            还没有代码，点「＋ 添加语言」为这个解法添加实现
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 表单主组件 ──────────────────────────────────────────────

const emptySolution = () => ({
  key: nextKey(), id: null,
  name: '', approach_md: '', time_complexity: '', space_complexity: '',
  is_preferred: false, codes: [],
})

export default function ProblemForm({ problemId, dark, toast, tags, onCreateTag, reloadTags, onBack, onSaved }) {
  const isEdit = !!problemId
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)

  // 从网站导入
  const [fetchUrl, setFetchUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchErr, setFetchErr] = useState('')

  // 基本信息
  const [source, setSource] = useState('leetcode')
  const [sourceNo, setSourceNo] = useState('')
  const [title, setTitle] = useState('')
  const [difficulty, setDifficulty] = useState(2)
  const [url, setUrl] = useState('')
  const [tagIds, setTagIds] = useState([])
  const [descriptionMd, setDescriptionMd] = useState('')
  const [pitfallMd, setPitfallMd] = useState('')
  const [solutions, setSolutions] = useState([emptySolution()])
  const [revision, setRevision] = useState(null)

  // 编辑模式：原始快照（解法/代码差异同步用）
  const snapshotRef = useRef([])

  /** 把题目详情填充进表单（初次加载与 409 冲突恢复共用） */
  const applyDetail = raw => {
    const p = raw?.problem || raw || {}
    setSource(p.source || 'other')
    setSourceNo(p.source_no || '')
    setTitle(p.title || '')
    setDifficulty(Number(p.difficulty) || 2)
    setUrl(p.url || '')
    setTagIds((raw?.tags || p.tags || []).map(t => t.id))
    setDescriptionMd(p.description_md || '')
    setPitfallMd(p.pitfall_md || '')
    setRevision(p.revision ?? null)
    const sols = (raw?.solutions || p.solutions || []).map(s => ({
      key: nextKey(), id: s.id, name: s.name || '', approach_md: s.approach_md || '',
      time_complexity: s.time_complexity || '', space_complexity: s.space_complexity || '',
      is_preferred: !!s.is_preferred, revision: s.revision ?? null,
      // code 行自身无乐观锁：revision 取父级 solution 的（api 层已注入，R7-5）
      codes: (s.codes || []).map(c => ({ key: nextKey(), id: c.id, language: c.language, code: c.code || '', note: c.note || '', revision: c.revision ?? s.revision ?? null })),
    }))
    setSolutions(sols.length ? sols : [emptySolution()])
    snapshotRef.current = sols.map(s => ({
      id: s.id, name: s.name, approach_md: s.approach_md,
      time_complexity: s.time_complexity, space_complexity: s.space_complexity,
      is_preferred: s.is_preferred, sort_order: null, revision: s.revision,
      codes: s.codes.map(c => ({ id: c.id, language: c.language, code: c.code, note: c.note, revision: c.revision })),
    }))
  }

  useEffect(() => {
    if (!problemId) return
    let alive = true
    getProblem(problemId)
      .then(raw => { if (alive) applyDetail(raw) })
      .catch(err => toast(err instanceof Error ? err.message : '加载题目失败', 'error'))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [problemId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 一键抓题 ──
  const detected = detectSourceFromUrl(fetchUrl)
  const doFetch = async () => {
    const payload = buildFetchPayload(detected === 'auto' ? 'auto' : detected, fetchUrl)
    if (!payload) { setFetchErr('请先粘贴题目链接'); return }
    setFetching(true); setFetchErr('')
    try {
      const draft = await fetchFromSite(payload)
      if (draft?.source) setSource(draft.source)
      if (draft?.source_no != null) setSourceNo(String(draft.source_no))
      if (draft?.title) setTitle(draft.title)
      if (draft?.difficulty != null) setDifficulty(Number(draft.difficulty) || 2)
      if (draft?.url) setUrl(draft.url)
      if (draft?.description_md) setDescriptionMd(draft.description_md)
      // 建议标签（后端草稿字段为 tag_names，R7-6）：先去重；命中已有标签直接选中，
      // 未命中现场创建（创建即乐观合并进标签列表，不逐次等待重拉）。循环内用本地
      // known 副本累积结果，避免闭包里的旧 tags 导致重复创建。
      const names = [...new Set((draft?.tag_names || [])
        .map(n => String(n || '').trim()).filter(Boolean))]
      let known = tags
      let createdAny = false
      for (const name of names) {
        const exist = known.find(t => (t.name || '').toLowerCase() === name.toLowerCase())
        if (exist) {
          setTagIds(ids => (ids.includes(exist.id) ? ids : [...ids, exist.id]))
        } else if (onCreateTag) {
          try {
            const created = await onCreateTag(name)
            if (created?.id) {
              known = known.some(t => t.id === created.id) ? known : [...known, created]
              createdAny = true
              setTagIds(ids => (ids.includes(created.id) ? ids : [...ids, created.id]))
            }
          } catch { /* 单个标签创建失败不阻断抓题 */ }
        }
      }
      if (createdAny) reloadTags?.() // 循环结束统一重拉一次，取回权威标签数据
      toast('抓取成功，请检查并补充解法')
    } catch (err) {
      setFetchErr(err instanceof Error ? err.message : '抓取失败，请检查链接或稍后重试')
    } finally {
      setFetching(false)
    }
  }

  // ── 解法集合操作（主解法星标为单选：置亮其余解法自动熄灭） ──
  const patchSolution = (key, next) => setSolutions(list => list.map(x => {
    if (x.key === key) return next
    if (next.is_preferred) return { ...x, is_preferred: false }
    return x
  }))
  const addSolution = () => setSolutions(list => [...list, emptySolution()])
  const removeSolution = key => setSolutions(list => {
    const next = list.filter(x => x.key !== key)
    return next.length ? next : [emptySolution()]
  })

  // ── 提交 ──
  const buildPayload = () => {
    const norm = (s, i) => ({
      name: s.name.trim() || `解法 ${i + 1}`,
      approach_md: s.approach_md,
      time_complexity: s.time_complexity.trim(),
      space_complexity: s.space_complexity.trim(),
      is_preferred: !!s.is_preferred,
      sort_order: i,
      codes: s.codes
        .filter(c => (c.code || '').trim())
        .map(c => ({ language: c.language, code: c.code, note: c.note.trim() || null })),
    })
    const payload = {
      source, source_no: sourceNo.trim() || null, title: title.trim(),
      difficulty: Number(difficulty), url: url.trim() || null,
      description_md: descriptionMd, pitfall_md: pitfallMd, tag_ids: tagIds,
    }
    return { payload, norm }
  }

  /** 空解法守卫：按原始字段判断，名称/思路/代码全空的解法不落库 */
  const isRealSolution = s =>
    s.name.trim() || s.approach_md.trim() || s.codes.some(c => (c.code || '').trim())

  const handleSave = async () => {
    if (saving) return
    if (!title.trim()) { toast('请填写题目标题', 'error'); return }
    setSaving(true)
    try {
      const { payload, norm } = buildPayload()
      const realSolutions = solutions.filter(isRealSolution)
      if (!isEdit) {
        // 新建：一次性带初始解法（跳过空解法）
        await createProblem({ ...payload, solutions: realSolutions.map((s, i) => norm(s, i)) })
        toast('题目已创建')
        onSaved?.(null)
        return
      }
      // 编辑：题目基本信息（revision 乐观锁）
      await updateProblem(problemId, { ...payload, ...(revision != null ? { revision } : {}) })
      // 解法差异同步（跳过空解法）。code 写路径（增/删/改）借用的都是父级
      // solution.revision 且每次成功 +1：用 solRev 跟踪最新值，同一解法连续
      // 多次写不再拿旧 revision 撞 409（R7-5）
      const orig = snapshotRef.current
      const keptIds = new Set(solutions.filter(s => s.id).map(s => s.id))
      for (const o of orig) {
        if (!keptIds.has(o.id)) await deleteSolution(o.id)
      }
      for (let i = 0; i < realSolutions.length; i++) {
        const s = realSolutions[i]
        const body = norm(s, i)
        if (!s.id) {
          await createSolution(problemId, body)
          continue
        }
        const o = orig.find(x => x.id === s.id)
        let solRev = o?.revision ?? null
        const bumpRev = () => { solRev = (solRev ?? 0) + 1 }
        const baseChanged = !o || body.name !== o.name || body.approach_md !== (o.approach_md || '') ||
          body.time_complexity !== (o.time_complexity || '') || body.space_complexity !== (o.space_complexity || '') ||
          body.is_preferred !== !!o.is_preferred
        if (baseChanged) {
          await updateSolution(s.id, { ...body, ...(solRev != null ? { revision: solRev } : {}) })
          bumpRev()
        }
        if (o) {
          const keptCodeIds = new Set(s.codes.filter(c => c.id).map(c => c.id))
          for (const oc of o.codes) {
            if (!keptCodeIds.has(oc.id)) { await deleteCode(oc.id); bumpRev() }
          }
          for (const c of s.codes) {
            const cb = { language: c.language, code: c.code, note: c.note.trim() || null }
            if (!c.id) {
              if ((cb.code || '').trim()) { await createCode(s.id, cb); bumpRev() }
              continue
            }
            const oc = o.codes.find(x => x.id === c.id)
            if (!oc || oc.language !== cb.language || (oc.code || '') !== (cb.code || '') || (oc.note || '') !== (cb.note || '')) {
              await updateCode(c.id, { ...cb, revision: solRev ?? c.revision ?? 1 })
              bumpRev()
            }
          }
        }
      }
      toast('题目已保存')
      onSaved?.(problemId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败'
      toast(err?.conflict ? `${msg}（页面已刷新为最新内容）` : msg, 'error')
      if (isEdit) {
        // 保存中断（乐观锁冲突/网络失败/部分子行已写成功）：整体重拉详情回填表单，
        // 消除本地快照与服务端的失配，避免下次保存按旧快照误删/误改（R8-2）
        try {
          applyDetail(await getProblem(problemId))
        } catch { /* 重拉失败：保持现态，用户可手动重试 */ }
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner text="加载题目中…" />

  return (
    <div className="space-y-4 max-w-4xl">
      {/* ── 顶栏 ── */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack}
          className="inline-flex items-center gap-1 px-3 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">
          {Icon.back}返回
        </button>
        <h2 className="text-lg font-semibold tracking-tight">{isEdit ? '编辑题目' : '新增题目'}</h2>
        <span className="flex-1" />
        <button type="button" onClick={handleSave} disabled={saving} className={btn.primary + ' h-9'}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {/* ── 从网站导入 ── */}
      <div className="rounded-2xl border border-indigo-500/25 dark:border-indigo-400/25 bg-indigo-500/[0.05] dark:bg-indigo-400/[0.06] p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium shrink-0">从网站导入</span>
          <div className="flex-1 min-w-[240px] relative">
            <input value={fetchUrl} onChange={e => { setFetchUrl(e.target.value); setFetchErr('') }}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), doFetch())}
              placeholder="粘贴题目链接：https://leetcode.cn/problems/two-sum/ 或洛谷 P1001"
              className="w-full h-9 px-3 pr-20 rounded-lg text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors" />
            {fetchUrl.trim() && (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 rounded-md px-1.5 py-0.5 pointer-events-none">
                {detected === 'auto' ? '自动识别' : SOURCES.find(s => s.value === detected)?.label}
              </span>
            )}
          </div>
          <button type="button" onClick={doFetch} disabled={fetching || !fetchUrl.trim()}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50 shrink-0">
            {fetching ? '抓取中…' : '抓取'}
          </button>
        </div>
        {fetchErr && <div className="mt-2 text-[13px] text-red-600 dark:text-red-400">{fetchErr}</div>}
        <p className="mt-2 text-[11.5px] text-stone-400 dark:text-stone-500">
          支持 LeetCode（slug / 链接）与洛谷（题号 / 链接）；抓取结果只填充表单，保存前可任意修改。
        </p>
      </div>

      {/* ── 基本信息 ── */}
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="来源">
            <select value={source} onChange={e => setSource(e.target.value)} className={selectCls + ' w-full'}>
              {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="题号（可空）">
            <input value={sourceNo} onChange={e => setSourceNo(e.target.value)} placeholder="如 1 / P1001 / JZ01"
              className={inputCls} />
          </Field>
          <Field label="标题">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="两数之和"
              className={inputCls} />
          </Field>
          <Field label="难度">
            <div className="flex items-center h-9 gap-1.5">
              {DIFFICULTIES.map(d => (
                <button type="button" key={d.value} onClick={() => setDifficulty(d.value)}
                  className={'h-9 px-3.5 rounded-lg text-sm transition-colors ' +
                    (Number(difficulty) === d.value
                      ? d.bg + ' ' + d.text + ' font-medium ring-1 ring-inset ring-current/20'
                      : 'bg-black/[0.05] dark:bg-white/[0.08] text-stone-500 dark:text-stone-400 hover:bg-black/10 dark:hover:bg-white/[0.14]')}>
                  {d.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="原题链接（可空）">
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"
              className={inputCls} />
          </Field>
          <Field label="标签">
            <TagSelect value={tagIds} onChange={setTagIds} tags={tags} onCreate={onCreateTag} placeholder="选择或新建标签…" />
          </Field>
        </div>
      </div>

      {/* ── 描述 / 易错点 ── */}
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5 space-y-5">
        <MdArea label="题目描述（Markdown）" value={descriptionMd} onChange={setDescriptionMd} dark={dark} minHeight={240} />
        <MdArea label="易错点（Markdown，可空）" value={pitfallMd} onChange={setPitfallMd} dark={dark} minHeight={120}
          placeholder="记录踩过的坑：边界条件、复杂度陷阱、易混淆概念…" />
      </div>

      {/* ── 解法编辑器 ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">解法（{solutions.length}）</h3>
          <button type="button" onClick={addSolution} className={btn.plain}>{Icon.plus}添加解法</button>
        </div>
        {solutions.map((s, i) => (
          <SolutionEditor key={s.key} solution={s} index={i} dark={dark}
            onChange={next => patchSolution(s.key, next)}
            onRemove={() => removeSolution(s.key)} />
        ))}
      </div>

      {/* 底部保存条 */}
      <div className="flex items-center justify-end gap-2 pb-2">
        <button type="button" onClick={onBack} className={btn.plain}>取消</button>
        <button type="button" onClick={handleSave} disabled={saving} className={btn.primary}>
          {saving ? '保存中…' : isEdit ? '保存修改' : '创建题目'}
        </button>
      </div>
    </div>
  )
}
