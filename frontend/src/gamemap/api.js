// 剧情图谱（gamemap）API 层：统一走 shared/client.js 的 apiFetch（会话 Cookie 认证）。
// 端点前缀 /api/gamemap/*（backend/app/gamemap/）；
// 后端响应为 Doublog 信封 { success, code, message, data }——本层统一 unwrap 出 .data，
// 失败（HTTP 非 2xx 或 success=false）抛 Error(message)，并把 HTTP 状态挂到 err.status
// （看板乐观锁 409 的自动重放依赖它）。401 由 apiFetch 兜底跳登录。
import { apiFetch, API_BASE } from '@/shared/client'

const PREFIX = '/api/gamemap'

async function unwrap(resp) {
  const body = await resp.json().catch(() => ({}))
  if (!resp.ok || body.success === false) {
    const err = new Error(body.message || body.detail || `请求失败(${resp.status})`)
    err.status = resp.status
    throw err
  }
  return body.data
}

/**
 * 通用请求。path 为 gamemap 内部相对路径（如 `/games/1/boards/merged?chapter_ids=2,3`）。
 * body 传 JSON.stringify 后的字符串（apiFetch 自动补 Content-Type）。
 */
export async function api(path, init = {}) {
  return unwrap(await apiFetch(`${PREFIX}${path}`, init))
}

/**
 * 后端返回的静态资源 URL 为相对路径（/api/gamemap/files/...）时补上后端源
 * （DouBlog 无 /api 代理，前端 60101 ≠ 后端 60100；与 blog 模块 Markdown 图片同一策略）。
 */
export function assetUrl(url) {
  return typeof url === 'string' && url.startsWith('/') ? API_BASE + url : url
}

/**
 * 上传图片文件（头像/封面/图鉴照片），multipart FormData。
 * 返回 { url, attachment_id }；url 已经 assetUrl 归一化，可直接用于 <img src>。
 */
export async function apiUpload(file) {
  const fd = new FormData()
  fd.append('file', file)
  const data = await unwrap(await apiFetch(`${PREFIX}/uploads`, { method: 'POST', body: fd }))
  if (data) data.url = assetUrl(data.url)
  return data
}

/* ── 数据形状（JSDoc，源自源仓库 api.ts 的 interface，供查阅）──────────────
 * Game          { id, name, description, play_status, current_chapter_id, cover_url }
 * Chapter       { id, game_id, title, order_index, summary, notes }
 * Character     { id, game_id, name, avatar_url, description, faction, alive }
 * RelationType  { id, key, name, color, line_style, directional, default_description, enabled, overridden }
 * BoardNodeT    { id?, character_id, x, y, width?, height? }
 * RelationT     { id?, from_character_id, to_character_id, relation_type_id, description }
 * ChapterStateT { id, chapter_id, character_id, alias, role, status, notes, alive_override, faction_override }
 * BoardT        { id, chapter_id, version, nodes[], relations[], characters[], states?[] }
 * MergedBoardT  { chapters[], anchor_chapter_id, nodes[{character_id,x,y,chapter_id}],
 *                 relations[{id,chapter_id,chapter_title,from_character_id,to_character_id,relation_type_id,description}],
 *                 characters[], states[{character_id,chapter_id,alias,role,status,alive,faction}] }
 * EventT        { id, chapter_id, title, order_index, content, character_ids[] }
 * CharacterPhotoT { id, character_id, chapter_id, chapter_title, chapter_order, url, caption, created_at }
 * StatsT        { totals{chapters,characters,relations,relations_all?,events},
 *                 chapters[{id,title,order_index,characters,relations}],
 *                 top_characters[{id,name,degree}], factions[{name,count,alive}],
 *                 type_usage[{type_id,key,name,color,count}] }
 * SearchHit     { game_id, chapter_id, kind, title, snippet, ref_id }
 * ────────────────────────────────────────────────────────────────────── */
