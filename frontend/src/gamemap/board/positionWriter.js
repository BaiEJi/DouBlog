import { createSaveCoordinator } from '../../shared/saveCoordinator.js'

export function createPositionWriter({ getRevisions, save, onState, onSaved, draft, initialDraft }) {
  const pending = new Map()
  for (const board of initialDraft?.snapshot?.boards || []) for (const point of board.positions || []) pending.set(`${board.chapter_id}:${point.character_id}`, { chapter_id: board.chapter_id, ...point })
  const coordinator = createSaveCoordinator({ revision: {}, idempotent: true, debounceMs: 120, draft, initialDraft,
    onState,
    save: async (snapshot, options) => {
      const boards = snapshot.boards.map(board => ({ ...board, revision: options.revision[board.chapter_id] ?? snapshot.revisions[board.chapter_id] }))
      for (const board of boards) if (!Number.isInteger(board.revision)) throw Object.assign(new Error('章节版本尚未加载，请等待后重试'), { status: 400 })
      const result = await save({ boards, mutation_id: options.mutationId }, { signal: options.signal })
      const revisions = { ...options.revision }
      for (const board of result.boards) revisions[board.chapter_id] = board.revision ?? board.version
      return { ...result, revision: revisions }
    },
    onSaved: (result, snapshot) => {
      for (const board of snapshot.boards) for (const point of board.positions) {
        const key = `${board.chapter_id}:${point.character_id}`, latest = pending.get(key)
        if (latest?.x === point.x && latest?.y === point.y) pending.delete(key)
      }
      onSaved?.(result)
    },
  })
  function setMany(points) {
    if (!coordinator.getState().dirty) coordinator.reset({ revision: getRevisions() })
    for (const point of points) pending.set(`${point.chapter_id}:${point.character_id}`, { ...point })
    const groups = new Map()
    for (const point of pending.values()) {
      if (!groups.has(point.chapter_id)) groups.set(point.chapter_id, [])
      groups.get(point.chapter_id).push({ character_id: point.character_id, x: point.x, y: point.y })
    }
    coordinator.change({ revisions: getRevisions(), boards: [...groups].map(([chapter_id, positions]) => ({ chapter_id, positions })) })
    return coordinator.flush()
  }
  return { setMany, set: point => setMany([point]), flush: coordinator.flush, retry: coordinator.retry, dispose: coordinator.dispose, getState: coordinator.getState,
    getPending: () => [...pending.values()].map(point => ({ ...point })), discard() { coordinator.reset({ revision: getRevisions() }); pending.clear() } }
}
