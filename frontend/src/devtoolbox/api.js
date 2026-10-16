// 开发者工具箱 API 层：仅 4 类计算经后端（哈希/字符集互转/JSON⇄YAML/二维码），
// 其余工具全部在浏览器本地完成。统一走 shared/client.js 的 apiFetch（会话 Cookie 认证）。

import { apiFetch } from '../shared/client'

async function json(path, options = {}) {
  let r
  try {
    r = await apiFetch(path, options)
  } catch (e) {
    // 网络层失败（后端不可达/CORS）：给中文提示而非原始 Failed to fetch
    throw new Error(e instanceof TypeError ? '无法连接后端服务——请检查服务是否运行' : e.message, { cause: e })
  }
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.message || `请求失败(${r.status})`)
  return body.data
}

/** 哈希 / HMAC：{algorithm, hmac, hex} */
export const dtHash = (text, algorithm, hmacKey = '') =>
  json('/api/devtoolbox/hash', { method: 'POST', body: JSON.stringify({ text, algorithm, hmac_key: hmacKey }) })

/** 字符集互转（乱码修复）：{result, hex, bytes, from, to} */
export const dtCharsetConvert = (text, from, to) =>
  json('/api/devtoolbox/charset/convert', { method: 'POST', body: JSON.stringify({ text, from_charset: from, to_charset: to }) })

/** JSON ⇄ YAML：{result, direction} */
export const dtYamlConvert = (direction, content) =>
  json('/api/devtoolbox/yaml/convert', { method: 'POST', body: JSON.stringify({ direction, content }) })

/** 二维码：{svg, png_data_url, version, ecc} */
export const dtQrcode = (content, { scale = 6, border = 2, ecc = 'm' } = {}) =>
  json('/api/devtoolbox/qrcode', { method: 'POST', body: JSON.stringify({ content, scale, border, ecc }) })
