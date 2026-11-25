/** Shared by the list, search, detail and CSV preview for both current and legacy encrypted records. */
export function loginName(data) {
  return data.login ?? (data.username || data.email || data.phone
    || data.identities?.find(identity => identity.role !== 'recovery' && identity.value)?.value
    || data.account_id || '')
}

export function accountIdentities(data) {
  return [...new Set([loginName(data), data.email, data.phone, ...(data.identities || []).map(i => i.value)].filter(Boolean))]
}

export function websiteUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || /^[/?#\\]/.test(raw)) return ''
  try {
    const explicit = /^[a-z][a-z\d+.-]*:/i.test(raw) && !/^[\w.-]+:\d+(?:[/?#]|$)/.test(raw)
    const url = new URL(explicit ? raw : 'https://' + raw)
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : ''
  } catch { return '' }
}

export function primaryWebsite(data) {
  for (const entry of data.urls || []) {
    const url = websiteUrl(entry?.value)
    if (url) return url
  }
  return ''
}

const knownSites = [
  { name: '谷歌', alias: 'Google', domains: ['google.com', 'gmail.com'] },
  { name: '微软', alias: 'Microsoft', domains: ['microsoft.com', 'microsoftonline.com', 'live.com', 'outlook.com', 'office.com'] },
]

export function normalizeSiteName(value) {
  const name = typeof value === 'string' ? value.trim().normalize('NFC') : ''
  return knownSites.find(site => site.alias.toLowerCase() === name.toLowerCase())?.name || name
}

export function siteFromLoginUrl(data) {
  const address = primaryWebsite(data)
  if (!address) return ''
  const url = new URL(address)
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const known = knownSites.find(site => site.domains.some(domain => host === domain || host.endsWith('.' + domain)))
  return known?.name || host + (url.port ? ':' + url.port : '')
}

export function accountSiteName(data) {
  return normalizeSiteName(data.site_name) || siteFromLoginUrl(data)
}

export function matchesSite(data, filter) {
  return !filter || accountSiteName(data).toLowerCase() === filter.toLowerCase()
}

export function siteLabel(name) {
  const known = knownSites.find(site => site.name === name)
  return known ? name + '（' + known.alias + '）' : name
}

export function buildSiteOptions(items) {
  const used = new Map()
  for (const { data } of items) {
    const name = accountSiteName(data)
    if (name && !used.has(name.toLowerCase())) used.set(name.toLowerCase(), name)
  }
  const names = [...used.values()].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const suggestions = new Set([...knownSites.map(site => site.name), ...names])
  return {
    editor: [...suggestions].map(name => ({ value: name, label: siteLabel(name) })),
    filter: [{ value: '', label: '全部网站' }, ...names.map(name => ({ value: name, label: siteLabel(name) }))],
  }
}

export function accountOrder(a, b) {
  return (Number(!!b.favorite) - Number(!!a.favorite))
    || (b.last_used_at || '').localeCompare(a.last_used_at || '')
    || (b.updated_at || '').localeCompare(a.updated_at || '')
    || b.id - a.id
}
