/* GameWorkspace 主组件（#7 拆分后的壳）：路由/数据查询/画布交互/撤销与保存管线。
 * UI 模块在 board/ 下：Toolbar(#1) HUD(#2) DetailDrawer(#3) tables(#6) panels。
 * 本文件新增：#5 骨架屏与三步引导、#8 scope 进 URL、#9 统一撤销栈（含关系/移出人物，
 * toast 带撤销按钮）、#10 409 自动重放与保存失败持续横幅。
 * 适配 DouBlog：去 TS 类型；nav 路径改挂 /gamemap 前缀；根容器高度 100vh → 100%
 * （GamemapShell 顶栏占据视口顶部，剩余高度由本组件铺满）。画布逻辑（xyflow 非受控
 * defaultNodes、自绘 EdgeLayer、50ms 防重叠时序、Ctrl-Z 撤销栈）逐行保持原样。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  App as AntApp, Alert, Avatar, Button, Card, Empty, Input, Menu, Modal, Select,
  Space, Typography,
} from 'antd'
import { CopyOutlined, HomeOutlined, PlusOutlined } from '@ant-design/icons'
import {
  Background, BackgroundVariant, ConnectionMode, Controls, MiniMap, ReactFlow, ReactFlowProvider,
} from '@xyflow/react'
import { toPng } from 'html-to-image'
import { api, assetUrl } from '../api'
import { avatarColor, avatarGradient, factionColor } from '../theme'
import { BoardHUD } from './HUD'
import { Toolbar } from './Toolbar'
import { DetailDrawer } from './DetailDrawer'
import { CharactersTable, RelationsTable } from './tables'
import { BatchImportModal, DiffModal, EmptyGuide, EventsPanel, StatsPanel, AddTargetAlert } from './panels'
import { PhotoCodex } from './PhotoCodex'
import { CARD_WIDTH, EdgeLayer, clampDragPosition, nodeTypes } from './shared'
import { useBoardUI } from './ui-store'

const GM = '/gamemap'

/* 统一撤销操作（#9）：位置移动 / 建关系 / 删关系 / 移出人物，全部可 Ctrl+Z 回退
 * UndoOp: { kind: "move", id, chId, from:{x,y} }
 *       | { kind: "addRel", relId, chId }
 *       | { kind: "delRel", chId, rel:{from_character_id,to_character_id,relation_type_id,description} }
 *       | { kind: "removeNode", chId, characterId, pos:{x,y}, rels:[...] } */

export default function Workspace() {
  const { gameId, chapterId } = useParams()
  const gid = Number(gameId)
  const qc = useQueryClient()
  const { message, modal } = AntApp.useApp()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()

  /* ---------- 数据查询 ---------- */
  const game = useQuery({ queryKey: ['game', gid], queryFn: () => api(`/games/${gid}`) })
  const chapters = useQuery({ queryKey: ['chapters', gid], queryFn: () => api(`/games/${gid}/chapters`) })
  const characters = useQuery({ queryKey: ['characters', gid], queryFn: () => api(`/games/${gid}/characters`) })
  const relationTypes = useQuery({ queryKey: ['relationTypes', gid], queryFn: () => api(`/games/${gid}/relation-types`) })

  /* ---------- 时间范围（#8：scope 编码进 URL，刷新/分享不丢） ---------- */
  const urlScope = sp.get('scope')
  const [scopeMode, setScopeModeRaw] = useState(
    urlScope === 'upto' || urlScope === 'from' || urlScope === 'custom' ? urlScope : 'chapter')
  const [scopeBoundaryId, setScopeBoundaryId] = useState(
    sp.get('ch') ? Number(sp.get('ch')) : null)
  const [scopeIds, setScopeIdsRaw] = useState(
    sp.get('ids') ? sp.get('ids').split(',').map(Number).filter(Boolean) : [])

  const syncScopeUrl = useCallback((mode, ch, ids) => {
    const next = new URLSearchParams(sp)
    if (mode === 'chapter') next.delete('scope')
    else next.set('scope', mode)
    if (mode === 'upto' || mode === 'from') { if (ch) next.set('ch', String(ch)); else next.delete('ch') }
    else next.delete('ch')
    if (mode === 'custom' && ids.length) next.set('ids', ids.join(','))
    else next.delete('ids')
    setSp(next, { replace: true })
  }, [sp, setSp])
  const setScopeMode = (m) => {
    setScopeModeRaw(m)
    if (m === 'chapter') qc.invalidateQueries({ queryKey: ['board', gid] })
    if ((m === 'upto' || m === 'from') && scopeBoundaryId == null && activeChapterId) setScopeBoundaryId(activeChapterId)
    syncScopeUrl(m, m === 'upto' || m === 'from' ? (scopeBoundaryId ?? activeChapterId ?? null) : null, scopeIds)
  }

  const savedChapterId = game.data?.current_chapter_id
  const chapterList = useMemo(() => [...(chapters.data || [])].sort((a, b) => a.order_index - b.order_index), [chapters.data])
  const defaultChapterId = savedChapterId && chapterList.some((c) => c.id === savedChapterId)
    ? savedChapterId : chapterList[0]?.id
  const activeChapterId = chapterId ? Number(chapterId) : defaultChapterId
  const activeChapter = chapterList.find((c) => c.id === activeChapterId)

  // 记住"玩到哪了"：章节切换即回写（fire-and-forget）
  useEffect(() => {
    if (!game.data || !activeChapterId || game.data.current_chapter_id === activeChapterId) return
    api(`/games/${gid}`, { method: 'PATCH', body: JSON.stringify({ current_chapter_id: activeChapterId }) }).catch(() => {})
  }, [activeChapterId, gid, game.data?.id])
  // 切换章节（左侧菜单导航）时回到单章模式
  useEffect(() => { setScopeModeRaw('chapter') }, [chapterId])

  const isMerged = scopeMode !== 'chapter'
  const mergedIds = useMemo(() => {
    if (scopeMode === 'custom') return scopeIds.filter((id) => chapterList.some((c) => c.id === id))
    if (scopeMode === 'upto' || scopeMode === 'from') {
      const b = chapterList.find((c) => c.id === (scopeBoundaryId ?? activeChapterId))
      if (!b) return []
      return chapterList
        .filter((c) => (scopeMode === 'upto' ? c.order_index <= b.order_index : c.order_index >= b.order_index))
        .map((c) => c.id)
    }
    return []
  }, [scopeMode, scopeIds, scopeBoundaryId, activeChapterId, chapterList])

  const board = useQuery({
    queryKey: ['board', gid, activeChapterId],
    queryFn: () => api(`/games/${gid}/boards/chapters/${activeChapterId}`),
    enabled: !!activeChapterId,
  })
  const mergedKey = mergedIds.join(',')
  const mergedBoard = useQuery({
    queryKey: ['boardMerged', gid, mergedKey],
    queryFn: () => api(`/games/${gid}/boards/merged?chapter_ids=${mergedKey}`),
    enabled: isMerged && mergedKey !== '',
  })

  const refreshBoards = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['board', gid] })
    qc.invalidateQueries({ queryKey: ['boardMerged', gid] })
    qc.invalidateQueries({ queryKey: ['characters', gid] })
    qc.invalidateQueries({ queryKey: ['stats', gid] })
  }, [qc, gid])

  /* ---------- UI 状态 ---------- */
  const { density, hiddenTypes, focusId, setFocusId } = useBoardUI()
  const [view, setView] = useState('board')
  const [edges, setEdges] = useState([])
  const [rf, setRf] = useState(null)
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState('')        // #10 持续横幅
  const [drawer, setDrawer] = useState(null)
  const [codexCharId, setCodexCharId] = useState(null)
  const [addCharOpen, setAddCharOpen] = useState(false)
  const [newCharName, setNewCharName] = useState('')
  const [newChapterOpen, setNewChapterOpen] = useState(false)
  const [newChapterTitle, setNewChapterTitle] = useState('')
  const [copyPrevious, setCopyPrevious] = useState(true)
  const [diffOpen, setDiffOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const boardBoxRef = useRef(null)
  const rfInstanceRef = useRef(null)
  const [exporting, setExporting] = useState(false)
  const loadedVersion = useRef(null)
  const fitKeyRef = useRef('')
  const undoStack = useRef([])
  const dragStart = useRef(null)
  const nudgeBefore = useRef(new Map())
  const nudgeTimers = useRef(new Map())
  const selectedIdRef = useRef(null)   // 非受控模式下 RF 不回写 node.selected，自行跟踪

  const allCharMap = useMemo(() => new Map((characters.data || []).map((c) => [c.id, c])), [characters.data])
  const typeMap = useMemo(() => new Map((relationTypes.data || []).map((t) => [t.id, t])), [relationTypes.data])

  /* ---------- 统一数据源 ---------- */
  const displayBoard = useMemo(() => {
    if (!isMerged) {
      const b = board.data
      if (!b) return null
      return {
        merged: false, anchorChapterId: b.chapter_id,
        nodes: b.nodes.map((n) => ({ character_id: n.character_id, x: n.x, y: n.y })),
        relations: b.relations.map((r) => ({ ...r })),
        characters: b.characters,
        states: (b.states || []).map((s) => ({
          character_id: s.character_id, alias: s.alias, role: s.role, status: s.status,
          notes: s.notes, alive: s.alive_override, faction: s.faction_override ?? undefined,
        })),
      }
    }
    const m = mergedBoard.data
    if (!m) return null
    return {
      merged: true, anchorChapterId: m.anchor_chapter_id,
      nodes: m.nodes.map((n) => ({ character_id: n.character_id, x: n.x, y: n.y, chapter_id: n.chapter_id })),
      relations: m.relations.map((r) => ({
        id: r.id, from_character_id: r.from_character_id, to_character_id: r.to_character_id,
        relation_type_id: r.relation_type_id, description: r.description,
        chapter_id: r.chapter_id, chapter_title: r.chapter_title,
      })),
      characters: m.characters,
      states: m.states.map((s) => ({
        character_id: s.character_id, alias: s.alias, role: s.role, status: s.status,
        alive: s.alive !== false, faction: s.faction || undefined,
      })),
    }
  }, [isMerged, board.data, mergedBoard.data])

  useEffect(() => {
    if (!displayBoard || !rf) return
    const stateMap = new Map(displayBoard.states.map((s) => [s.character_id, s]))
    const relCount = new Map()
    for (const r of displayBoard.relations) {
      relCount.set(r.from_character_id, (relCount.get(r.from_character_id) || 0) + 1)
      relCount.set(r.to_character_id, (relCount.get(r.to_character_id) || 0) + 1)
    }
    rf.setNodes(displayBoard.nodes.map((n) => {
      const st = stateMap.get(n.character_id)
      const ch = allCharMap.get(n.character_id)
      const alive = st && st.alive != null ? st.alive : ch?.alive !== false
      const faction = (st && st.faction ? st.faction : ch?.faction) || ''
      const dim = focusId != null && focusId !== n.character_id &&
        !displayBoard.relations.some((r) => (r.from_character_id === focusId && r.to_character_id === n.character_id) ||
          (r.to_character_id === focusId && r.from_character_id === n.character_id))
      return {
        id: `c-${n.character_id}`, type: 'character', position: { x: n.x, y: n.y }, draggable: true,
        data: {
          characterId: n.character_id,
          posChapterId: n.chapter_id,
          label: ch?.name || `#${n.character_id}`,
          gradient: avatarGradient(n.character_id),
          miniColor: avatarColor(n.character_id),
          avatar: ch?.avatar_url ? assetUrl(ch.avatar_url) : '',
          description: (ch?.description || '').slice(0, density === 'detailed' ? 400 : 60),
          relCount: relCount.get(n.character_id) || 0,
          faction, factionColor: factionColor(faction),
          alive, dim, density,
          alias: st?.alias || '', role: st?.role || '', status: st?.status || '',
        },
      }
    }))
    setEdges(displayBoard.relations.map((r, i) => ({
      id: `r-${r.id || i}`, source: `c-${r.from_character_id}`, target: `c-${r.to_character_id}`,
      data: { relation: r },
    })))
    // 看板内容就绪后框显（非受控模式下 prop fitView 在空板上运行，必须显式补）
    const fitKey = `${gid}:${activeChapterId ?? 0}:${isMerged ? mergedKey : 'single'}`
    if (fitKeyRef.current !== fitKey && displayBoard.nodes.length) {
      fitKeyRef.current = fitKey
      setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 1.2, duration: 200 }), 120)
    }
  }, [displayBoard, allCharMap, rf, focusId, density, gid, activeChapterId, isMerged, mergedKey])

  useEffect(() => { if (board.data) loadedVersion.current = board.data.version }, [board.data])

  /* ---------- 写路径 ---------- */
  const patchNodePosition = async (characterId, x, y, chapterId, replay = true) => {
    const req = () => api(`/games/${gid}/boards/chapters/${chapterId}/nodes/${characterId}`, {
      method: 'PATCH', body: JSON.stringify({ x, y }),
    })
    return req().catch(async (e) => {
      const status = e?.status
      if (replay && (status === 409 || String(e.message).includes('409'))) {
        await qc.invalidateQueries({ queryKey: ['board', gid] })
        await new Promise((r) => setTimeout(r, 400))
        return patchNodePosition(characterId, x, y, chapterId, false)
      }
      throw e
    })
  }

  const failSave = (e) => {   // #10：失败改持续横幅（不再一闪而过）
    setSaveState('error')
    setSaveError(e.message)
  }
  const okSave = () => { setSaveState('saved'); setSaveError('') }

  const onNodeDragStart = useCallback((_, node) => {
    if (!node?.id) return
    const chId = isMerged ? node.data?.posChapterId : activeChapterId
    dragStart.current = { id: node.id, pos: { x: node.position.x, y: node.position.y }, chId }
  }, [isMerged, activeChapterId])

  const onNodeDragStop = useCallback((_, node) => {
    if (!node?.id) return
    const cid = Number(node.id.slice(2))
    const chId = isMerged ? node.data?.posChapterId : activeChapterId
    if (!chId) return
    setTimeout(() => {
      const inst = rfInstanceRef.current
      if (!inst) return
      const cur = inst.getNodes().find((n) => n.id === node.id)
      if (!cur) return
      const size = (n) => ({ w: n.measured?.width || CARD_WIDTH[density], h: n.measured?.height || 80 })
      const drag = { x: cur.position.x, y: cur.position.y, w: size(cur).w, h: size(cur).h }
      const others = inst.getNodes()
        .filter((n) => n.id !== node.id)
        .map((n) => ({ x: n.position.x, y: n.position.y, ...size(n) }))
      clampDragPosition(drag, others)
      if (Math.abs(drag.x - cur.position.x) > 0.01 || Math.abs(drag.y - cur.position.y) > 0.01) {
        const nx = drag.x, ny = drag.y
        inst.setNodes((nds) => nds.map((n) =>
          n.id === node.id ? { ...n, position: { x: nx, y: ny } } : n))
      }
      const start = dragStart.current
      if (start && start.id === node.id &&
          (Math.abs(start.pos.x - drag.x) > 0.01 || Math.abs(start.pos.y - drag.y) > 0.01)) {
        undoStack.current.push({ kind: 'move', id: node.id, chId, from: start.pos })
        if (undoStack.current.length > 80) undoStack.current.shift()
      }
      dragStart.current = null
      setSaveState('saving')
      patchNodePosition(cid, drag.x, drag.y, chId)
        .then((res) => { if (typeof res?.version === 'number') loadedVersion.current = res.version; okSave() })
        .catch(failSave)
    }, 50)
  }, [isMerged, gid, activeChapterId, density])

  /** 统一撤销（#9）：位置/关系增删/移出人物全栈回退 */
  const runUndo = useCallback(async (op) => {
    const inst = rfInstanceRef.current
    const entry = op ?? undoStack.current.pop()
    if (!entry) { message.info('没有可撤销的操作'); return }
    try {
      if (entry.kind === 'move') {
        inst?.setNodes((nds) => nds.map((n) => n.id === entry.id ? { ...n, position: entry.from } : n))
        setSaveState('saving')
        await patchNodePosition(Number(entry.id.slice(2)), entry.from.x, entry.from.y, entry.chId)
        okSave()
      } else if (entry.kind === 'addRel') {
        await api(`/games/${gid}/boards/chapters/${entry.chId}/relations/${entry.relId}`, { method: 'DELETE' })
        message.success('已撤销：删除刚建立的关系')
      } else if (entry.kind === 'delRel') {
        await api(`/games/${gid}/boards/chapters/${entry.chId}/relations`, {
          method: 'POST', body: JSON.stringify({ ...entry.rel }),
        })
        message.success('已撤销：关系已恢复')
      } else if (entry.kind === 'removeNode') {
        await api(`/games/${gid}/boards/chapters/${entry.chId}/nodes/${entry.characterId}`, { method: 'POST' })
        await patchNodePosition(entry.characterId, entry.pos.x, entry.pos.y, entry.chId)
        for (const r of entry.rels) {
          await api(`/games/${gid}/boards/chapters/${entry.chId}/relations`, {
            method: 'POST', body: JSON.stringify({ ...r }),
          }).catch(() => {})
        }
        message.success('已撤销：人物已加回')
      }
      refreshBoards()
    } catch (e) {
      message.error(`撤销失败：${e.message}`)
    }
  }, [gid, message, refreshBoards])

  /** 删除关系（#9：toast 带撤销） */
  const deleteRelation = useCallback((r) => {
    const chId = isMerged ? r.chapter_id : activeChapterId
    api(`/games/${gid}/boards/chapters/${chId}/relations/${r.id}`, { method: 'DELETE' })
      .then(() => {
        undoStack.current.push({
          kind: 'delRel', chId,
          rel: { from_character_id: r.from_character_id, to_character_id: r.to_character_id,
                 relation_type_id: r.relation_type_id, description: r.description || '' },
        })
        const op = undoStack.current[undoStack.current.length - 1]
        message.open({
          content: <span>关系已删除 <Button size="small" style={{ marginLeft: 10 }} onClick={() => runUndo(op)}>撤销</Button></span>,
          duration: 5,
        })
        setDrawer(null)
        refreshBoards()
      })
      .catch((e) => message.error(e.message))
  }, [gid, isMerged, activeChapterId, message, refreshBoards, runUndo])

  /** 移出人物（#9：记住位置与关系，toast 带撤销） */
  const removeNode = useCallback((characterId) => {
    if (isMerged || !activeChapterId) return
    const b = board.data
    const pos = b?.nodes.find((n) => n.character_id === characterId)
    const rels = (b?.relations || [])
      .filter((r) => r.from_character_id === characterId || r.to_character_id === characterId)
      .map((r) => ({ from_character_id: r.from_character_id, to_character_id: r.to_character_id,
                     relation_type_id: r.relation_type_id, description: r.description || '' }))
    api(`/games/${gid}/boards/chapters/${activeChapterId}/nodes/${characterId}`, { method: 'DELETE' })
      .then(() => {
        undoStack.current.push({
          kind: 'removeNode', chId: activeChapterId, characterId,
          pos: { x: pos?.x ?? 100, y: pos?.y ?? 100 }, rels,
        })
        const op = undoStack.current[undoStack.current.length - 1]
        message.open({
          content: <span>人物已移出本章 <Button size="small" style={{ marginLeft: 10 }} onClick={() => runUndo(op)}>撤销</Button></span>,
          duration: 5,
        })
        setDrawer(null)
        refreshBoards()
      })
      .catch((e) => message.error(e.message))
  }, [gid, isMerged, activeChapterId, board.data, message, refreshBoards, runUndo])

  const saveBoard = useMutation({
    mutationFn: async () => {
      setSaveState('saving')
      return api(`/games/${gid}/boards/chapters/${activeChapterId}`, {
        method: 'PUT',
        body: JSON.stringify({
          version: loadedVersion.current ?? 1,
          nodes: (rfInstanceRef.current?.getNodes() || []).map((n) => ({
            character_id: Number(n.id.slice(2)), x: n.position.x, y: n.position.y })),
          relations: edges.map((e) => e.data.relation),
        }),
      })
    },
    onSuccess: (b) => { loadedVersion.current = b.version; okSave() },
    onError: (e) => failSave(e),
  })

  const scatterLayout = () => {
    const inst = rfInstanceRef.current
    const cur = inst?.getNodes() || []
    if (!cur.length) return
    modal.confirm({
      title: '打散布局',
      content: isMerged
        ? '所有角色将以均匀网格重新排布，新位置将分别写回各自来源的章节。确定继续？'
        : '所有角色将以均匀网格重新排布，覆盖当前手动位置。确定继续？',
      okText: '打散', okButtonProps: { danger: true }, cancelText: '取消',
      onOk: () => {
        const n = cur.length
        const cols = Math.ceil(Math.sqrt(n))
        const gapX = 340, gapY = 200
        const cx = cur.reduce((s, nd) => s + nd.position.x, 0) / n
        const cy = cur.reduce((s, nd) => s + nd.position.y, 0) / n
        const posMap = new Map()
        cur.forEach((nd, i) => posMap.set(nd.id, {
          x: cx + ((i % cols) - (cols - 1) / 2) * gapX,
          y: cy + (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * gapY,
        }))
        // 记录全部原位置为一条撤销（第0个 move 之前的位置）
        for (const nd of cur) {
          const chId = isMerged ? nd.data?.posChapterId : activeChapterId
          if (!chId) continue
          undoStack.current.push({ kind: 'move', id: nd.id, chId, from: { ...nd.position } })
        }
        inst.setNodes(cur.map((nd) => ({ ...nd, position: posMap.get(nd.id) || nd.position })))
        if (isMerged) {
          setSaveState('saving')
          Promise.all(cur.map((nd) => {
            const p = posMap.get(nd.id)
            const chId = nd.data?.posChapterId
            return chId && p ? patchNodePosition(Number(nd.id.slice(2)), p.x, p.y, chId) : Promise.resolve()
          }))
            .then(() => { okSave(); message.success('打散布局已写回各来源章节') })
            .catch(failSave)
        } else {
          setTimeout(() => saveBoard.mutate(), 150)
        }
      },
    })
  }

  const exportPng = async () => {
    const node = boardBoxRef.current
    if (!node || exporting) return
    setExporting(true)
    try {
      rfInstanceRef.current?.fitView({ padding: 0.18, duration: 400 })
      await new Promise((r) => setTimeout(r, 700))
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: '#0b0d14',
        skipFonts: true,
        filter: (n) => !(n.classList?.contains('react-flow__panel') || n.classList?.contains('gm8-handle') || n.classList?.contains('gm8-fps') || n.classList?.contains('gm8-hud')),
      })
      const a = document.createElement('a')
      a.download = `${game.data?.name || 'GameMap'} - ${isMerged ? `${mergedIds.length}章聚合视图` : activeChapter?.title || '关系看板'}.png`
      a.href = dataUrl
      a.click()
      message.success('看板已导出为 PNG')
    } catch (e) {
      message.error(`导出失败：${e.message}`)
    } finally {
      setExporting(false)
    }
  }

  const downloadBackup = async () => {
    try {
      const data = await api(`/games/${gid}/export`)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `GameMap-${(game.data?.name || 'game').replace(/[\\/:*?"<>|]/g, '_')}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      message.success('备份已下载')
    } catch (e) {
      message.error(`备份失败：${e.message}`)
    }
  }

  const onConnect = useCallback((params) => {
    let picked = null
    modal.confirm({
      title: '🔗 建立关系', icon: null, okText: '确定', cancelText: '取消',
      okButtonProps: { disabled: true, style: { display: 'none' } },
      content: (
        <Select style={{ width: '100%', marginTop: 12 }} placeholder="选择关系类型" autoFocus
          onChange={(v) => { picked = v }}
          onOpenChange={(open) => { if (!open && picked !== null) {
            const targetChapter = isMerged ? (mergedBoard.data?.anchor_chapter_id ?? null) : activeChapterId
            if (!targetChapter) { message.error('无法确定写入章节'); return }
            const instNodes = rfInstanceRef.current?.getNodes() || []
            const srcPos = instNodes.find((nd) => nd.id === params.source)?.position
            const tgtPos = instNodes.find((nd) => nd.id === params.target)?.position
            api(`/games/${gid}/boards/chapters/${targetChapter}/relations`, {
              method: 'POST',
              body: JSON.stringify({
                from_character_id: Number(params.source.slice(2)),
                to_character_id: Number(params.target.slice(2)),
                relation_type_id: picked,
                description: '',
                from_x: srcPos?.x, from_y: srcPos?.y, to_x: tgtPos?.x, to_y: tgtPos?.y,
              }),
            })
              .then((created) => {
                undoStack.current.push({ kind: 'addRel', relId: created.id, chId: targetChapter })
                refreshBoards()
                message.success(isMerged ? '关系已写入范围最后一章' : '关系已创建')
              })
              .catch((e) => message.error(e.message))
            Modal.destroyAll()
          } }}
          options={(relationTypes.data || []).filter((t) => t.enabled).map((t) => ({ value: t.id, label: t.name }))} />
      ),
    })
  }, [relationTypes.data, isMerged, mergedBoard.data, activeChapterId, gid, refreshBoards, message, modal])

  const createChapter = useMutation({
    mutationFn: (title) => api(`/games/${gid}/chapters`, {
      method: 'POST', body: JSON.stringify({ title, copy_from_previous: copyPrevious }),
    }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['chapters', gid] })
      setNewChapterOpen(false); setNewChapterTitle('')
      message.success('章节已创建')
      nav(`${GM}/games/${gid}/chapters/${c.id}`)
    },
  })

  const createCharacter = useMutation({
    mutationFn: () => api(`/games/${gid}/characters`, { method: 'POST', body: JSON.stringify({ name: newCharName }) }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['characters', gid] })
      api(`/games/${gid}/boards/chapters/${boardTargetId}/nodes/${c.id}`, { method: 'POST' })
        .then(refreshBoards)
      setAddCharOpen(false); setNewCharName('')
      const tc = chapterList.find((c2) => c2.id === boardTargetId)
      message.success(tc ? `人物已加入 第${tc.order_index}章「${tc.title}」` : '人物已加入')
    },
  })

  const addExisting = (cid) => {
    const tc = chapterList.find((c) => c.id === boardTargetId)
    api(`/games/${gid}/boards/chapters/${boardTargetId}/nodes/${cid}`, { method: 'POST' })
      .then(() => { refreshBoards(); message.success(tc ? `已加入 第${tc.order_index}章「${tc.title}」` : '已加入') })
  }

  const boardTargetId = isMerged ? (mergedBoard.data?.anchor_chapter_id ?? null) : activeChapterId

  /* ---------- 键盘（Ctrl+Z 统一撤销 / 方向键微调 / Delete 移出） ---------- */
  useEffect(() => {
    if (view !== 'board') return
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        runUndo()
        return
      }
      if (e.key.startsWith('Arrow')) {
        const inst = rfInstanceRef.current
        const sel = selectedIdRef.current
          ? (inst?.getNodes() || []).filter((n) => n.id === selectedIdRef.current)
          : []
        if (!inst || !sel.length) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        const moved = new Map(
          sel.map((n) => [n.id, { x: n.position.x + dx, y: n.position.y + dy, chId: n.data?.posChapterId }]))
        inst.setNodes((nds) => nds.map((n) =>
          moved.has(n.id) ? { ...n, position: { x: moved.get(n.id).x, y: moved.get(n.id).y } } : n))
        for (const [id, pnt] of moved) {
          const chId = pnt.chId ?? activeChapterId
          if (!chId) continue
          if (!nudgeBefore.current.has(id)) nudgeBefore.current.set(id, { pos: { x: pnt.x - dx, y: pnt.y - dy }, chId })
          clearTimeout(nudgeTimers.current.get(id))
          nudgeTimers.current.set(id, setTimeout(() => {
            const before = nudgeBefore.current.get(id)
            nudgeBefore.current.delete(id)
            nudgeTimers.current.delete(id)
            if (before) undoStack.current.push({ kind: 'move', id, chId, from: before.pos })
            setSaveState('saving')
            patchNodePosition(Number(id.slice(2)), pnt.x, pnt.y, chId)
              .then((res) => { if (typeof res?.version === 'number') loadedVersion.current = res.version; okSave() })
              .catch(failSave)
          }, 600))
        }
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isMerged || !selectedIdRef.current || !activeChapterId) return
        e.preventDefault()
        removeNode(Number(selectedIdRef.current.slice(2)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, isMerged, activeChapterId, gid, runUndo, removeNode])

  /* ---------- 渲染 ---------- */
  if (game.isLoading || !chapters.data) {
    // #5 骨架屏：侧栏 + 顶栏 + 画布的形状占位，替代白屏
    return (
      <div style={{ display: 'flex', height: '100%', background: '#0b0d14' }}>
        <div style={{ width: 236, borderRight: '1px solid #1e2433', padding: 16, background: '#0f121b' }}>
          <div style={{ height: 32, borderRadius: 8, background: '#161b28', marginBottom: 14, animation: 'gmPulse 1.2s infinite' }} />
          {[1, 2, 3].map((i) => <div key={i} style={{ height: 26, borderRadius: 6, background: '#12161f', marginBottom: 8, animation: 'gmPulse 1.2s infinite' }} />)}
        </div>
        <div style={{ flex: 1, padding: 16 }}>
          <div style={{ height: 32, borderRadius: 8, background: '#161b28', marginBottom: 14, width: '60%', animation: 'gmPulse 1.2s infinite' }} />
          <div style={{ height: 'calc(100% - 60px)', borderRadius: 12, background: '#0f121b', animation: 'gmPulse 1.2s infinite' }} />
        </div>
      </div>
    )
  }

  const saveBadge = {
    idle: null, saving: <Typography.Text style={{ fontSize: 11.5, color: '#8b93a8' }}>保存中…</Typography.Text>,
    saved: <Typography.Text style={{ fontSize: 11.5, color: '#52c41a' }}>✓ 已保存</Typography.Text>,
    error: <Typography.Text style={{ fontSize: 11.5, color: '#ff4d4f' }}>保存失败</Typography.Text>,
  }[saveState]

  const boardChars = displayBoard?.characters || []
  const relations = displayBoard?.relations || []
  const visibleEdges = edges.filter((e) => !hiddenTypes.has(e.data.relation.relation_type_id))
  const focusSet = focusId == null ? null : new Set([
    `c-${focusId}`,
    ...relations
      .filter((r) => r.from_character_id === focusId || r.to_character_id === focusId)
      .flatMap((r) => [`c-${r.from_character_id}`, `c-${r.to_character_id}`]),
  ])

  return (
    <div className="gm-hud" style={{ display: 'flex', height: '100%', background: '#0b0d14' }}>
      {/* 左侧章节栏 */}
      <div style={{ width: 236, borderRight: '1px solid #1e2433', padding: '12px 10px', overflow: 'auto', background: '#0f121b' }}>
        <Button block style={{ marginBottom: 10 }} icon={<HomeOutlined />} onClick={() => nav(GM)}>返回主页</Button>
        <Typography.Title level={5} style={{ padding: '0 8px 10px', color: '#e8eaf2' }}>
          📖 {game.data?.name}
        </Typography.Title>
        <Menu mode="inline" selectedKeys={[String(activeChapterId)]} style={{ border: 'none' }}
          items={chapterList.map((c) => ({
            key: c.id,
            label: <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 20, height: 20, borderRadius: 6, background: avatarGradient(c.id), fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{c.order_index}</span>
              {c.title}</span>,
            onClick: () => nav(`${GM}/games/${gid}/chapters/${c.id}`),
          }))} />
        <Button block style={{ marginTop: 10 }} icon={<PlusOutlined />} onClick={() => setNewChapterOpen(true)}>新建章节</Button>
        {activeChapter && (
          <Card size="small" style={{ marginTop: 14, background: '#141824', border: '1px solid #232a3c' }} title={<span style={{ fontSize: 12 }}>本章摘要</span>}>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }} ellipsis={{ rows: 6, expandable: true, symbol: '展开' }}>
              {activeChapter.summary || '暂无摘要'}
            </Typography.Paragraph>
          </Card>
        )}
      </div>

      {/* 中间工作区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Toolbar
          gid={gid} view={view} setView={setView}
          scopeMode={scopeMode} setScopeMode={setScopeMode}
          scopeBoundaryId={scopeBoundaryId} setScopeBoundaryId={(id) => { setScopeBoundaryId(id); syncScopeUrl(scopeMode, id, scopeIds) }}
          scopeIds={scopeIds} setScopeIds={(ids) => { setScopeIdsRaw(ids); syncScopeUrl(scopeMode, scopeBoundaryId, ids) }}
          chapterList={chapterList} activeChapterId={activeChapterId}
          mergedCount={mergedIds.length}
          anchorText={mergedBoard.data?.anchor_chapter_id
            ? ` · 写入第${chapterList.find((c) => c.id === mergedBoard.data?.anchor_chapter_id)?.order_index ?? '?'}章` : ''}
          onAddChar={() => setAddCharOpen(true)} onScatter={scatterLayout}
          onExport={exportPng} exporting={exporting}
          onDiff={() => setDiffOpen(true)} onBatch={() => setBatchOpen(true)} onBackup={downloadBackup}
          saveBadge={saveBadge}
        />
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {view === 'board' && isMerged && mergedIds.length === 0 ? (
            <Empty style={{ marginTop: 100 }} description="在上方选择要聚合查看的章节" />
          ) : !activeChapterId ? (
            <EmptyGuide onCreateChapter={() => setNewChapterOpen(true)} onAddChar={() => setAddCharOpen(true)} onFirstRelation={() => message.info('从卡片边上的 8 个附着点拖到另一张卡片即可连线')} />
          ) : (characters.data || []).length === 0 ? (
            <EmptyGuide onCreateChapter={() => setNewChapterOpen(true)} onAddChar={() => setAddCharOpen(true)} onFirstRelation={() => message.info('先加入人物')} />
          ) : view === 'board' ? (
            <ReactFlowProvider>
              <div ref={boardBoxRef} className="gm8-board" style={{ position: 'absolute', inset: 0, background: '#0b0d14' }}>
                <ReactFlow defaultNodes={[]} nodeTypes={nodeTypes}
                  connectionMode={ConnectionMode.Loose}
                  onConnect={onConnect} onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop}
                  onNodeClick={(_, n) => { selectedIdRef.current = n.id; setDrawer({ kind: 'node', characterId: Number(n.id.slice(2)) }); setFocusId(Number(n.id.slice(2))) }}
                  onPaneClick={() => { selectedIdRef.current = null; setFocusId(null) }}
                  onInit={(inst) => { rfInstanceRef.current = inst; setRf(inst) }}
                  fitView proOptions={{ hideAttribution: true }}>
                  <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#232a3c" />
                  <Controls showInteractive={false} />
                  <MiniMap pannable zoomable
                    nodeColor={(n) => n.data?.miniColor || '#7c5cff'}
                    maskColor="rgba(11,13,20,.7)"
                    style={{ border: '1px solid #2a3040', borderRadius: 8, width: 200, height: 140 }} />
                </ReactFlow>
                {/* #10 保存失败持续横幅（带重试） */}
                {saveState === 'error' && (
                  <Alert type="error" showIcon className="gm8-hud" style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 30, maxWidth: 460 }}
                    message={`保存失败：${saveError}`}
                    action={<Button size="small" danger onClick={() => { if (isMerged) { /* 重试最近一次逐节点写入不现实，提示刷新 */ location.reload() } else saveBoard.mutate() }}>重试</Button>}
                    closable onClose={() => setSaveState('idle')} />
                )}
                {/* #2 统一 HUD：图例过滤 + 密度 + 聚焦 + FPS + 保存状态 */}
                <BoardHUD relations={relations} typeMap={typeMap} />
                {/* 边覆盖层：在 RF 之上接收点击；线端点外扩 8px 不压卡片；图例可按类型隐藏 */}
                <EdgeLayer edges={visibleEdges} typeMap={typeMap} focusSet={focusSet}
                  onEdgeClick={(rel) => setDrawer({ kind: 'edge', index: relations.findIndex((r) => r.id === rel.id) })} />
              </div>
            </ReactFlowProvider>
          ) : view === 'characters' ? (
            <CharactersTable board={displayBoard} gid={gid}
              onOpen={(cid) => setDrawer({ kind: 'node', characterId: cid })} onChanged={refreshBoards}
              onCodex={(cid) => setCodexCharId(cid)} />
          ) : view === 'relations' ? (
            <RelationsTable board={displayBoard} allCharMap={allCharMap} typeMap={typeMap}
              activeChapterTitle={activeChapter?.title}
              onOpen={(index) => setDrawer({ kind: 'edge', index })}
              onDelete={deleteRelation} />
          ) : view === 'events' ? (
            <EventsPanel gid={gid} chapterId={activeChapterId} chapters={chapterList}
              allCharMap={allCharMap} onJumpChapter={(cid) => nav(`${GM}/games/${gid}/chapters/${cid}`)} />
          ) : view === 'stats' ? (
            <StatsPanel gid={gid} onJumpChapter={(cid) => nav(`${GM}/games/${gid}/chapters/${cid}`)} />
          ) : null}
        </div>
      </div>

      {/* 添加人物 */}
      <Modal title={<span>👤 添加人物</span>} open={addCharOpen} footer={null} onCancel={() => setAddCharOpen(false)}>
        <AddTargetAlert target={chapterList.find((c) => c.id === boardTargetId)} isMerged={isMerged} />
        <Space.Compact style={{ width: '100%', marginBottom: 14 }}>
          <Input placeholder="新人物名称" value={newCharName} onChange={(e) => setNewCharName(e.target.value)}
            onPressEnter={() => newCharName.trim() && boardTargetId && createCharacter.mutate()} />
          <Button type="primary" disabled={!newCharName.trim() || !boardTargetId} loading={createCharacter.isPending} onClick={() => createCharacter.mutate()}>创建并加入</Button>
        </Space.Compact>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>从人物库添加：</Typography.Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, maxHeight: 260, overflow: 'auto' }}>
          {(characters.data || []).filter((c) => !boardChars.some((b) => b.id === c.id)).map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
              <Space><Avatar size="small" style={{ background: avatarGradient(c.id) }}>{c.name[0]}</Avatar>{c.name}</Space>
              <Button size="small" type="primary" ghost disabled={!boardTargetId} onClick={() => addExisting(c.id)}>加入</Button>
            </div>
          ))}
          {(characters.data || []).filter((c) => !boardChars.some((b) => b.id === c.id)).length === 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>人物库的人物都已在看板上</Typography.Text>
          )}
        </div>
      </Modal>

      {/* 新建章节 */}
      <Modal title={<span><CopyOutlined /> 新建章节</span>} open={newChapterOpen} onCancel={() => setNewChapterOpen(false)}
        okText="创建" okButtonProps={{ disabled: !newChapterTitle.trim() }} confirmLoading={createChapter.isPending}
        onOk={() => createChapter.mutate(newChapterTitle)}>
        <Space orientation="vertical" style={{ width: '100%', marginTop: 8 }}>
          <Input placeholder="章节标题" value={newChapterTitle} onChange={(e) => setNewChapterTitle(e.target.value)} />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={copyPrevious} onChange={(e) => setCopyPrevious(e.target.checked)} />
            <span style={{ color: '#9aa3b8' }}>复制上一章的人物、关系和布局</span>
          </label>
        </Space>
      </Modal>

      {/* 关系演变对比 */}
      <DiffModal open={diffOpen} onClose={() => setDiffOpen(false)} gid={gid}
        chapters={chapterList} defaultA={chapterList[Math.max(0, (activeChapter?.order_index || 2) - 2)]?.id}
        defaultB={activeChapterId} allCharMap={allCharMap} />

      {/* 批量导入人物 */}
      <BatchImportModal open={batchOpen} onClose={() => setBatchOpen(false)} gid={gid}
        targetChapterId={boardTargetId ?? null} onDone={() => { refreshBoards(); qc.invalidateQueries({ queryKey: ['chapters', gid] }) }} />

      {/* 右侧详情抽屉 */}
      <DetailDrawer drawer={drawer} onClose={() => setDrawer(null)} gid={gid} chapterId={activeChapterId}
        board={displayBoard} allCharMap={allCharMap} typeMap={typeMap} isMerged={isMerged}
        onSaved={refreshBoards} onRemoveNode={removeNode} onDeleteRelation={deleteRelation}
        onOpenCodex={(cid) => setCodexCharId(cid)} />
      <PhotoCodex characterId={codexCharId} character={codexCharId ? allCharMap.get(codexCharId) : undefined}
        chapters={chapterList} onClose={() => setCodexCharId(null)} onChanged={() => qc.invalidateQueries({ queryKey: ['photos', codexCharId] })} />
    </div>
  )
}
