// Clash 代理管理能力包 API 层：统一走 shared/client.js 的 apiFetch（会话 Cookie 认证）。
// 端点契约见 docs/modules/clash.md——与 clashctl 命令一一对应，底层完全复用其 bash 函数。

import { apiFetch } from '../shared/client'

async function json(path, options = {}) {
  const r = await apiFetch(path, options)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.message || `请求失败(${r.status})`)
  return body.data
}

/** 安装检测（门户置灰依据）：{available, base_dir, kernel} */
export const clashAvailability = () => json('/api/clash/availability')

/** 内核状态：{running, output} */
export const clashStatus = () => json('/api/clash/status')

/** 开启 / 关闭代理内核（clashctl on / off） */
export const clashOn = () => json('/api/clash/on', { method: 'POST' })
export const clashOff = () => json('/api/clash/off', { method: 'POST' })

/** 系统代理：查询 {enabled, output}；设置 clashproxy on|off */
export const clashProxy = () => json('/api/clash/proxy')
export const clashProxySet = enable =>
  json('/api/clash/proxy', { method: 'POST', body: JSON.stringify({ enable }) })

/** Tun 模式：查询 {enabled, output}；设置 clashtun on|off */
export const clashTun = () => json('/api/clash/tun')
export const clashTunSet = enable =>
  json('/api/clash/tun', { method: 'POST', body: JSON.stringify({ enable }) })

/** Web 控制台地址（clashctl ui）：{output} */
export const clashUi = () => json('/api/clash/ui')

/** Web 密钥：查询 {secret, output}；修改（写 mixin + 重启内核生效） */
export const clashSecret = () => json('/api/clash/secret')
export const clashSecretSet = secret =>
  json('/api/clash/secret', { method: 'PUT', body: JSON.stringify({ secret }) })

/** 升级内核：channel ''（默认）| 'release' | 'alpha' */
export const clashUpgrade = (channel = '') =>
  json('/api/clash/upgrade', { method: 'POST', body: JSON.stringify({ channel }) })

/** 内核日志尾部：{path, tail, level, content}（level=当前生效日志级别） */
export const clashLog = (tail = 200) => json(`/api/clash/log?tail=${tail}`)

/** 切换内核日志级别（写 mixin 的 log-level + 合并重启；silent 会让日志文件停止增长） */
export const clashLogLevel = (level) =>
  json('/api/clash/log/level', { method: 'POST', body: JSON.stringify({ level }) })

/** 读配置文件：file = mixin | base | runtime → {file, path, editable, content} */
export const clashConfig = (file = 'mixin') => json(`/api/clash/config?file=${file}`)

/** 保存 Mixin（合并配置并重启内核，同 clashmixin -e） */
export const clashConfigSave = content =>
  json('/api/clash/config', { method: 'PUT', body: JSON.stringify({ content }) })

/** 订阅列表：{use, profiles:[{id,url,path}]} */
export const clashSubs = () => json('/api/clash/sub')

/** 订阅动作：add(url) / del(id) / use(id) / update({id?, convert?, auto?}) */
export const clashSubAction = payload =>
  json('/api/clash/sub', { method: 'POST', body: JSON.stringify(payload) })

/** 订阅日志尾部：{path, tail, content} */
export const clashSubLog = (tail = 200) => json(`/api/clash/sub/log?tail=${tail}`)
