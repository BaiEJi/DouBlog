// 公共侧栏偏好纯逻辑回归：默认值 / 边界截断 / 坏输入回退 / 存储异常不阻止 UI。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_STORAGE_KEY, clampSidebarWidth, defaultSidebarPreferences,
  normalizeSidebarPreferences, loadSidebarPreferences, saveSidebarPreferences,
  serializeSidebarPreferences, getSafeSidebarStorage,
} from '../src/shared/sidebarPreferences.js'

test('defaults and constants match the documented contract', () => {
  assert.equal(SIDEBAR_DEFAULT_WIDTH, 220)
  assert.equal(SIDEBAR_MIN_WIDTH, 180)
  assert.equal(SIDEBAR_MAX_WIDTH, 420)
  assert.equal(SIDEBAR_COLLAPSED_WIDTH, 56)
  assert.equal(SIDEBAR_STORAGE_KEY, 'doublog_sidebar_layout_v1')
  assert.deepEqual(defaultSidebarPreferences(), { width: 220, collapsed: false })
})

test('clampSidebarWidth keeps finite numbers in range and rounds', () => {
  assert.equal(clampSidebarWidth(220), 220)
  assert.equal(clampSidebarWidth(179.4), 180)
  assert.equal(clampSidebarWidth(1000), 420)
  assert.equal(clampSidebarWidth(-5), 180)
  assert.equal(clampSidebarWidth(300.6), 301)
})

test('clampSidebarWidth falls back to default for non-finite values', () => {
  for (const bad of [NaN, Infinity, -Infinity, 'abc', null, undefined, {}, [], true]) {
    assert.equal(clampSidebarWidth(bad), SIDEBAR_DEFAULT_WIDTH, `input ${String(bad)}`)
  }
})

test('normalizeSidebarPreferences: legal values pass through untouched', () => {
  assert.deepEqual(normalizeSidebarPreferences({ version: 1, width: 320, collapsed: true }), { width: 320, collapsed: true })
  assert.deepEqual(normalizeSidebarPreferences({ version: 1, width: 180, collapsed: false }), { width: 180, collapsed: false })
})

test('normalizeSidebarPreferences: out-of-range width clamps, missing width uses default', () => {
  assert.equal(normalizeSidebarPreferences({ version: 1, width: 9999, collapsed: false }).width, 420)
  assert.equal(normalizeSidebarPreferences({ version: 1, width: 10, collapsed: true }).width, 180)
  const missing = normalizeSidebarPreferences({ version: 1, collapsed: true })
  assert.equal(missing.width, SIDEBAR_DEFAULT_WIDTH)
  assert.equal(missing.collapsed, true)
})

test('normalizeSidebarPreferences: non-boolean collapsed is parsed strictly as false', () => {
  for (const bad of ['true', 1, 0, null, undefined, {}, []]) {
    assert.equal(normalizeSidebarPreferences({ version: 1, width: 220, collapsed: bad }).collapsed, false, `collapsed=${String(bad)}`)
  }
})

// F02：整链（normalize/load）不允许任何隐式 Number() 转换绕过严格类型检查
test('normalizeSidebarPreferences: non-number width never converts implicitly — all fall back to 220', () => {
  for (const bad of [null, true, false, '300', [], [300], {}, NaN, Infinity, -Infinity]) {
    const parsed = normalizeSidebarPreferences({ version: 1, width: bad, collapsed: false })
    assert.deepEqual(parsed, { width: 220, collapsed: false }, `width=${String(bad)}`)
  }
})

test('normalizeSidebarPreferences: finite numbers clamp and round; boundaries are legal', () => {
  assert.equal(normalizeSidebarPreferences({ version: 1, width: 300 }).width, 300)
  assert.equal(normalizeSidebarPreferences({ version: 1, width: 300.4 }).width, 300)
  assert.equal(normalizeSidebarPreferences({ version: 1, width: 300.6 }).width, 301)
  assert.equal(normalizeSidebarPreferences({ version: 1, width: 180 }).width, 180)
  assert.equal(normalizeSidebarPreferences({ version: 1, width: 420 }).width, 420)
  assert.equal(normalizeSidebarPreferences({ version: 1, width: 1000 }).width, 420)
  assert.equal(normalizeSidebarPreferences({ version: 1, width: 10 }).width, 180)
})

test('loadSidebarPreferences: stored non-number width falls back through the whole chain', () => {
  // width 非法回退 220；collapsed 仍按布尔独立解析（true 保留）
  const cases = [
    ['{"version":1,"width":null,"collapsed":false}', false],
    ['{"version":1,"width":"300","collapsed":false}', false],
    ['{"version":1,"width":[320],"collapsed":true}', true],
    ['{"version":1,"width":{"v":320},"collapsed":false}', false],
  ]
  for (const [raw, collapsed] of cases) {
    const store = memoryStorage(new Map([[SIDEBAR_STORAGE_KEY, raw]]))
    assert.deepEqual(loadSidebarPreferences(store), { width: 220, collapsed }, raw)
  }
})

test('normalizeSidebarPreferences: wrong version / bad shape fall back to defaults', () => {
  assert.deepEqual(normalizeSidebarPreferences({ version: 2, width: 300, collapsed: true }), defaultSidebarPreferences())
  assert.deepEqual(normalizeSidebarPreferences(null), defaultSidebarPreferences())
  assert.deepEqual(normalizeSidebarPreferences('x'), defaultSidebarPreferences())
  assert.deepEqual(normalizeSidebarPreferences([1, 2]), defaultSidebarPreferences())
  assert.deepEqual(normalizeSidebarPreferences(42), defaultSidebarPreferences())
})

function memoryStorage(initial = new Map(), { throwOn = null } = {}) {
  return {
    getItem(key) {
      if (throwOn === 'get') throw new Error('quota')
      return initial.has(key) ? initial.get(key) : null
    },
    setItem(key, value) {
      if (throwOn === 'set') throw new Error('quota')
      initial.set(key, String(value))
    },
  }
}

test('loadSidebarPreferences: first visit, legal value, bad JSON, unknown version', () => {
  const empty = memoryStorage()
  assert.deepEqual(loadSidebarPreferences(empty), defaultSidebarPreferences())
  const legal = memoryStorage(new Map([[SIDEBAR_STORAGE_KEY, '{"version":1,"width":300,"collapsed":true}']]))
  assert.deepEqual(loadSidebarPreferences(legal), { width: 300, collapsed: true })
  const badJson = memoryStorage(new Map([[SIDEBAR_STORAGE_KEY, '{oops']]))
  assert.deepEqual(loadSidebarPreferences(badJson), defaultSidebarPreferences())
  const unknown = memoryStorage(new Map([[SIDEBAR_STORAGE_KEY, '{"version":9,"width":400,"collapsed":true}']]))
  assert.deepEqual(loadSidebarPreferences(unknown), defaultSidebarPreferences())
})

test('saveSidebarPreferences: writes the exact documented shape and never throws', () => {
  const store = memoryStorage()
  saveSidebarPreferences(store, { width: 336, collapsed: false })
  assert.deepEqual(JSON.parse(store.getItem(SIDEBAR_STORAGE_KEY)), { version: 1, width: 336, collapsed: false })
  // 写入抛错（隐私模式/配额）时静默失败，不阻止 UI
  const broken = memoryStorage(new Map(), { throwOn: 'set' })
  assert.doesNotThrow(() => saveSidebarPreferences(broken, { width: 220, collapsed: true }))
})

test('loadSidebarPreferences: storage get throwing falls back to defaults', () => {
  const broken = memoryStorage(new Map(), { throwOn: 'get' })
  assert.deepEqual(loadSidebarPreferences(broken), defaultSidebarPreferences())
})

test('round-trip: collapsed state keeps last expanded width (56 never persisted as width)', () => {
  const store = memoryStorage()
  saveSidebarPreferences(store, { width: 300, collapsed: true })
  const loaded = loadSidebarPreferences(store)
  assert.equal(loaded.width, 300, '折叠不把展开宽度改成 56')
  assert.equal(loaded.collapsed, true)
  assert.notEqual(loaded.width, SIDEBAR_COLLAPSED_WIDTH)
  assert.equal(serializeSidebarPreferences(loaded), '{"version":1,"width":300,"collapsed":true}')
})

// F01：存储对象获取本身的容错（属性 getter 抛 SecurityError）
function withGlobalStorage(value, throws) {
  const desc = throws
    ? { get() { throw new Error('SecurityError') }, configurable: true }
    : { value, configurable: true, writable: true }
  Object.defineProperty(globalThis, 'localStorage', desc)
  return () => { try { delete globalThis.localStorage } catch { /* 不可删时保留，下一轮 defineProperty 同 configurable 可覆盖 */ } }
}

test('getSafeSidebarStorage: getter throwing SecurityError yields stable null (no throw)', () => {
  const restore = withGlobalStorage(null, true)
  assert.doesNotThrow(() => {
    const storage = getSafeSidebarStorage()
    assert.equal(storage, null)
    // null 存储下读写链路继续工作（内存态）
    assert.deepEqual(loadSidebarPreferences(storage), defaultSidebarPreferences())
    assert.doesNotThrow(() => saveSidebarPreferences(storage, { width: 300, collapsed: true }))
  })
  restore()
})

test('getSafeSidebarStorage: working storage passes through', () => {
  const restore = withGlobalStorage(memoryStorage(), false)
  assert.ok(getSafeSidebarStorage() !== null)
  restore()
})

test('getSafeSidebarStorage: getItem throwing also degrades to null', () => {
  const brokenGetItem = { getItem() { throw new Error('quota') }, setItem() { throw new Error('quota') } }
  const restore = withGlobalStorage(brokenGetItem, false)
  assert.equal(getSafeSidebarStorage(), null)
  restore()
})
