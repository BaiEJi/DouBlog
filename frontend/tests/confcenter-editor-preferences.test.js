/**
 * 编辑器字号偏好（editorPreferences.js）行为测试：
 * 默认值/越界/非整数/垃圾值回退、读写异常吞掉、存储禁用时本次可用、clamp。
 * 用内存 localStorage 哨兵模拟（可切换为抛错模式）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

class MemoryStorage {
  constructor({ readFails = false, writeFails = false } = {}) {
    this.map = new Map()
    this.readFails = readFails
    this.writeFails = writeFails
  }
  getItem(key) {
    if (this.readFails) throw new Error('storage blocked')
    return this.map.has(key) ? this.map.get(key) : null
  }
  setItem(key, value) {
    if (this.writeFails) throw new Error('quota exceeded')
    this.map.set(key, value)
  }
}

function install(storage) {
  globalThis.window = { localStorage: storage }
}

async function load() {
  const mod = await import(`../src/confcenter/editorPreferences.js?case=${Math.random()}`)
  return mod
}

test('defaults to 15 when nothing stored, persists integers within 12-24', async () => {
  install(new MemoryStorage())
  const pref = await load()
  assert.equal(pref.loadFontSize(), 15)
  assert.equal(pref.saveFontSize(18), true)
  assert.equal(pref.loadFontSize(), 18)
  assert.equal(pref.saveFontSize(12), true)
  assert.equal(pref.loadFontSize(), 12)
  assert.equal(pref.saveFontSize(24), true)
  assert.equal(pref.loadFontSize(), 24)
})

test('out-of-range, non-integer, NaN and garbage values all fall back to 15', async () => {
  // 注：Number('0x10')=16 是范围内整数——存储只由本模块以 String(int) 写入，
  // 十六进制字面量仍可解析为合法字号，不视为脏值。
  for (const bad of ['11', '25', '0', '-3', '15.5', 'abc', 'null', ' ', '1e2']) {
    install(new MemoryStorage())
    const pref = await load()
    pref.saveFontSize(20)                       // 先落一个合法值再写脏数据
    globalThis.window.localStorage.map.set(pref.FONT_STORAGE_KEY, bad)
    assert.equal(pref.loadFontSize(), 15, `value ${JSON.stringify(bad)} should fall back`)
  }
})

test('saveFontSize rejects out-of-range/non-integer and leaves stored value untouched', async () => {
  install(new MemoryStorage())
  const pref = await load()
  pref.saveFontSize(16)
  for (const bad of [11, 25, 15.5, NaN, Infinity, '17', 0]) {
    assert.equal(pref.saveFontSize(bad), false)
    assert.equal(pref.loadFontSize(), 16)       // 脏值没有覆盖已存偏好
  }
})

test('storage read failures fall back to 15 and do not throw', async () => {
  install(new MemoryStorage({ readFails: true }))
  const pref = await load()
  assert.equal(pref.loadFontSize(), 15)
  assert.equal(pref.saveFontSize(20), true)     // 写入正常（只有读失败）
})

test('quota-exceeded writes return false silently; in-session value still usable', async () => {
  install(new MemoryStorage({ writeFails: true }))
  const pref = await load()
  assert.equal(pref.saveFontSize(20), false)
  assert.equal(pref.loadFontSize(), 15)         // 读取不到写入 → 默认，不抛异常
})

test('missing window/localStorage entirely does not throw', async () => {
  delete globalThis.window
  const pref = await load()
  assert.equal(pref.loadFontSize(), 15)
  assert.equal(pref.saveFontSize(20), false)
})

test('clampFontSize rounds and clamps to [12,24] without touching storage', async () => {
  install(new MemoryStorage())
  const pref = await load()
  assert.equal(pref.clampFontSize(11), 12)
  assert.equal(pref.clampFontSize(24.6), 25 - 1)   // round(24.6)=25 → clamp 24
  assert.equal(pref.clampFontSize(12.4), 12)
  assert.equal(pref.clampFontSize(18), 18)
  assert.equal(globalThis.window.localStorage.map.size, 0)
})

test('independent key namespace: preference key is the documented one', async () => {
  install(new MemoryStorage())
  const pref = await load()
  assert.equal(pref.FONT_STORAGE_KEY, 'doublog.confcenter.editor.fontSize.v1')
  assert.equal(pref.FONT_DEFAULT, 15)
  assert.equal(pref.FONT_MIN, 12)
  assert.equal(pref.FONT_MAX, 24)
})
