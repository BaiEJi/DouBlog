/**
 * 限流覆盖行的纯函数构造/解析（R4）。
 *
 * `__proto__`/`constructor` 等合法 namespace（满足 [A-Za-z0-9_.:-]+ 白名单）不能经
 * 普通赋值进入普通对象——`obj['__proto__'] = x` 触发原型 setter 静默丢失覆盖。
 * 这里用 Object.defineProperty（不走 setter）构造自有可枚举键，保证
 * JSON.stringify 与后端回读一致；JSON.parse 解析 `__proto__` 键同样是自有键。
 */

/** 覆盖行编辑态 → PUT /ratelimit/config 的 overrides 对象（整体替换语义） */
export function buildOverrides(rows) {
  const overrides = {}
  for (const row of rows || []) {
    const ns = String(row.ns ?? '').trim()
    if (!ns) continue
    Object.defineProperty(overrides, ns, {
      value: { limit: +row.limit, window_seconds: +row.window },
      enumerable: true, writable: true, configurable: true,
    })
  }
  return overrides
}

/** 后端 overrides 回显 → 覆盖行编辑态（自有键遍历，含 __proto__ 等特殊名） */
export function parseOverrides(overrides) {
  return Object.entries(overrides || {}).map(([ns, r]) =>
    ({ ns, limit: r.limit, window: r.window_seconds }))
}
