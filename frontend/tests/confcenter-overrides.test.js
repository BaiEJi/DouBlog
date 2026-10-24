/**
 * R4：限流覆盖行的 __proto__/constructor 等合法 namespace 不得被对象原型
 * setter 静默丢弃——buildOverrides 必须产生自有可枚举键并完整往返。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const { buildOverrides, parseOverrides } = await import('../src/confcenter/overrides.js')

test('__proto__ row becomes an own enumerable key and survives JSON round-trip', () => {
  const rows = [{ ns: '__proto__', limit: 5, window: 60 }]
  const overrides = buildOverrides(rows)
  assert.equal(Object.hasOwn(overrides, '__proto__'), true)
  // 自有数据属性遮蔽原型 getter：点读取得到的是覆盖行本身
  assert.deepEqual(overrides.__proto__, { limit: 5, window_seconds: 60 })
  // 原型链未被改写
  assert.equal(Object.getPrototypeOf(overrides), Object.prototype)
  const json = JSON.stringify({ overrides })
  assert.equal(json, '{"overrides":{"__proto__":{"limit":5,"window_seconds":60}}}')
  // 模拟后端 JSON 解析回读：JSON.parse 的 __proto__ 是自有键
  const parsed = JSON.parse(json).overrides
  assert.equal(Object.hasOwn(parsed, '__proto__'), true)
  assert.deepEqual(parseOverrides(parsed), [{ ns: '__proto__', limit: 5, window: 60 }])
})

test('constructor and mixed rows all round-trip; numeric strings are coerced', () => {
  const rows = [
    { ns: 'constructor', limit: 0, window: 30 },        // limit=0 豁免
    { ns: 'app', limit: '100', window: '60' },          // 字符串数字
    { ns: '  ns-pad  ', limit: 7, window: 90 },         // trim
    { ns: '', limit: 1, window: 1 },                    // 空串跳过
    { ns: '   ', limit: 1, window: 1 },                 // 纯空白跳过
  ]
  const overrides = buildOverrides(rows)
  assert.equal(Object.hasOwn(overrides, 'constructor'), true)
  assert.deepEqual(Object.keys(overrides), ['constructor', 'app', 'ns-pad'])
  const parsed = JSON.parse(JSON.stringify({ overrides })).overrides
  const back = parseOverrides(parsed).sort((a, b) => a.ns.localeCompare(b.ns))
  assert.deepEqual(back, [
    { ns: 'app', limit: 100, window: 60 },
    { ns: 'constructor', limit: 0, window: 30 },
    { ns: 'ns-pad', limit: 7, window: 90 },
  ])
  // 豁免语义：limit=0 原样保留
  assert.equal(back.find(r => r.ns === 'constructor').limit, 0)
})

test('prototype chain stays intact and Object.prototype is not polluted', () => {
  const overrides = buildOverrides([{ ns: '__proto__', limit: 5, window: 60 },
    { ns: 'toString', limit: 3, window: 10 }])
  assert.equal({}.toString, Object.prototype.toString, '全局原型未被污染')
  assert.equal(Object.hasOwn(overrides, 'toString'), true)
  // 经 JSON 往返后也没有污染
  const parsed = JSON.parse(JSON.stringify({ overrides })).overrides
  assert.equal({}.toString, Object.prototype.toString)
  assert.equal(Object.hasOwn(parsed, 'toString'), true)
})

test('parseOverrides tolerates null/undefined overrides', () => {
  assert.deepEqual(parseOverrides(null), [])
  assert.deepEqual(parseOverrides(undefined), [])
  assert.deepEqual(parseOverrides({}), [])
})
