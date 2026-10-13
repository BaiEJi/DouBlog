/**
 * 代理视图：策略组 + 节点切换 + 连通性（延迟）测试——zashboard 核心能力迁移。
 *
 * - 组卡：组名/类型徽章/当前节点 + 「整组测速」；节点 chip 网格
 * - Selector 组点 chip 即切换（其余组类型自动调度，只读展示）
 * - chip 右侧 ⚡ 单节点测速；测速结果即时回填（整组并发返回 {节点: ms}）
 * - 延迟色档见 kit.delayCls（<200 绿 / <500 琥珀 / 其余红 / 0 超时）
 */
import { useCallback, useEffect, useState } from 'react'
import {
  clashCtlProxies, clashCtlSelect, clashCtlDelay, clashCtlGroupDelay,
} from './api'
import { card, btn, btnPri, DelayBadge } from './kit'

const TYPE_BADGE = {
  Selector: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  URLTest: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  Fallback: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  LoadBalance: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  Relay: 'bg-stone-500/10 text-stone-600 dark:text-stone-300',
}
const TYPE_TEXT = { Selector: '手动选择', URLTest: '自动测速', Fallback: '故障转移', LoadBalance: '负载均衡', Relay: '链式代理' }

export default function ProxiesView({ toast, unavailable }) {
  const [groups, setGroups] = useState(null)
  const [testingGroup, setTestingGroup] = useState('')     // 整组测速中的组名
  const [testingNode, setTestingNode] = useState('')       // 单节点测速中的「组/节点」
  const [switching, setSwitching] = useState('')

  const refresh = useCallback(async () => {
    try {
      setGroups((await clashCtlProxies()).groups || [])
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    }
  }, [toast])

  useEffect(() => {
    if (!unavailable) {
      const t = setInterval(refresh, 15000)               // 轻轮询：同步他处切换
      refresh()
      return () => clearInterval(t)
    }
  }, [unavailable, refresh])

  /** 测速结果回填：{节点名: ms} 合并进对应组（null→测失败记 0） */
  const applyDelays = (groupName, map) => {
    setGroups(prev => prev.map(g => g.name !== groupName ? g : {
      ...g,
      nodes: g.nodes.map(n => ({ ...n, delay: map && n.name in map ? map[n.name] : (map ? 0 : n.delay) })),
    }))
  }

  const testGroup = async g => {
    setTestingGroup(g.name)
    try {
      const map = await clashCtlGroupDelay(g.name)
      applyDelays(g.name, map)
      toast({ msg: `😼 ${g.name} 测速完成（${Object.keys(map).length} 个节点）` })
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
      applyDelays(g.name, null)
    } finally {
      setTestingGroup('')
    }
  }

  const testNode = async (g, n) => {
    setTestingNode(`${g.name}/${n.name}`)
    try {
      const { delay } = await clashCtlDelay(n.name)
      applyDelays(g.name, { [n.name]: delay })
    } catch (e) {
      applyDelays(g.name, { [n.name]: 0 })
      toast({ msg: `${n.name}：${e.message}`, kind: 'error' })
    } finally {
      setTestingNode('')
    }
  }

  const selectNode = async (g, n) => {
    if (g.type !== 'Selector' || g.now === n.name) return
    setSwitching(`${g.name}/${n.name}`)
    try {
      await clashCtlSelect(g.name, n.name)
      setGroups(prev => prev.map(x => x.name !== g.name ? x : { ...x, now: n.name }))
      toast({ msg: `已切换：${g.name} → ${n.name}` })
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    } finally {
      setSwitching('')
    }
  }

  if (unavailable) return null
  return (
    <div className="space-y-4">
      {groups == null ? (
        <div className={card + ' px-6 py-12 text-center text-sm text-stone-400'}>加载策略组…</div>
      ) : groups.length === 0 ? (
        <div className={card + ' px-6 py-12 text-center text-sm text-stone-400'}>无策略组（订阅未生效？）</div>
      ) : groups.map(g => (
        <div key={g.name} className={card}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3.5 border-b border-black/[0.06] dark:border-white/[0.06]">
            <span className={'px-2 py-0.5 rounded-md text-[11px] font-medium shrink-0 ' + (TYPE_BADGE[g.type] || TYPE_BADGE.Relay)}>
              {TYPE_TEXT[g.type] || g.type}
            </span>
            <h3 className="text-sm font-semibold truncate">{g.name}</h3>
            <span className="text-xs text-stone-400 dark:text-stone-500 truncate">
              当前 <span className="text-stone-600 dark:text-stone-300">{g.now || '—'}</span>
            </span>
            <span className="flex-1" />
            <button className={g.type === 'Selector' ? btnPri : btn} disabled={testingGroup === g.name}
              onClick={() => testGroup(g)}>
              {testingGroup === g.name ? '测速中…' : '整组测速'}
            </button>
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            {g.nodes.map(n => {
              const isNow = g.now === n.name
              const busy = switching === `${g.name}/${n.name}` || testingNode === `${g.name}/${n.name}`
              return (
                <div key={n.name} title={n.type || ''}
                  className={'group/chip flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-xl border text-[13px] transition-colors max-w-full ' +
                    (isNow
                      ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 font-medium'
                      : g.type === 'Selector'
                        ? 'border-black/[0.08] dark:border-white/[0.1] hover:border-black/25 dark:hover:border-white/30 cursor-pointer'
                        : 'border-black/[0.06] dark:border-white/[0.08] opacity-80 cursor-default')}
                  onClick={() => selectNode(g, n)}>
                  <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (n.alive == null ? 'bg-stone-300 dark:bg-stone-600' : n.alive ? 'bg-emerald-500' : 'bg-red-400')} />
                  <span className="truncate max-w-56">{n.name}</span>
                  <DelayBadge delay={n.delay} testing={testingNode === `${g.name}/${n.name}` || busy && switching === `${g.name}/${n.name}`} />
                  <button
                    className="shrink-0 w-6 h-6 rounded-lg text-stone-400 hover:text-sky-600 dark:hover:text-sky-300 hover:bg-black/[0.05] dark:hover:bg-white/10 transition-colors text-xs"
                    title={`测试 ${n.name}`}
                    disabled={!!testingNode}
                    onClick={e => { e.stopPropagation(); testNode(g, n) }}>⚡</button>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
