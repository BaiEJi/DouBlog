import { csvParse } from '../../shared/text.js'
import { emptyItem } from './core.js'
import { accountSiteName, loginName, normalizeSiteName, websiteUrl } from './accountBook.js'

const columns = {
  name: ['name', 'title', '名称', '网站名称'], url: ['url', 'website', 'origin', '网址', '网站'],
  login: ['username', 'login', 'user name', '用户名', '登录账号'], password: ['password', '密码'],
  note: ['note', 'notes', 'comment', '备注'],
  site: ['site_name', 'platform', '所属网站', '网站平台'],
}

function accountKeys(data) {
  const login = loginName(data).trim()
  const sites = (data.urls || []).map(u => websiteUrl(u.value)).filter(Boolean)
  const origins = sites.map(url => new URL(url).origin)
  if (origins.length) return [...new Set(origins)].map(origin => JSON.stringify([origin, login]))
  const site = normalizeSiteName(data.site_name).toLowerCase()
  const name = (data.service || '').trim().toLowerCase()
  return site || name ? [JSON.stringify([site, site && login ? '' : name, login])] : []
}

export function previewCsv(source, savedItems) {
  const [header, ...lines] = csvParse(source.replace(/^\uFEFF/, ''), ',', { strict: true })
  const names = (header || []).map(cell => cell.trim().toLowerCase())
  const index = Object.fromEntries(Object.entries(columns).map(([key, aliases]) => [key, names.findIndex(name => aliases.includes(name))]))
  if (index.password < 0 || index.login < 0 || (index.name < 0 && index.url < 0 && index.site < 0)) {
    throw new Error('CSV 需包含用户名、密码，以及名称、所属网站或网址列。')
  }
  const seen = new Map()
  const remember = data => {
    const credential = { site: normalizeSiteName(data.site_name).toLowerCase(), password: data.password?.value || '' }
    for (const key of accountKeys(data)) {
      if (!seen.has(key)) seen.set(key, [])
      seen.get(key).push(credential)
    }
  }
  savedItems.forEach(item => remember(item.data))
  const rows = []
  for (const [i, cells] of lines.entries()) {
    const name = (cells[index.name] || '').trim()
    const rawUrl = (cells[index.url] || '').trim()
    const url = websiteUrl(rawUrl), login = (cells[index.login] || '').trim()
    const password = cells[index.password] || ''
    const site = normalizeSiteName(cells[index.site])
    const urls = url ? [{ label: '', value: url }] : []
    const service = name || site || (url && new URL(url).hostname)
    const row = { line: i + 2, service, login, site: accountSiteName({site_name: site, urls}), status: 'invalid' }
    if (cells.length === header.length && service && password && (!rawUrl || url)) {
      const data = { ...emptyItem(), service, site_name: site, username: login, password: { value: password }, urls, notes: cells[index.note] || '' }
      // Distinct named sites may share a sign-in endpoint. Browser CSVs without site labels still match by origin.
      const siteKey = site.toLowerCase()
      const matches = accountKeys(data).flatMap(key => seen.get(key) || []).filter(c => !siteKey || !c.site || c.site === siteKey)
      row.status = matches.some(c => c.password === password) ? 'duplicate' : matches.length ? 'conflict' : 'new'
      if (row.status === 'new') { row.data = data; remember(data) }
    }
    rows.push(row)
  }
  return rows
}
