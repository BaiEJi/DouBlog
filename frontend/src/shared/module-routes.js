export function moduleForPath(pathname) {
  if (/^\/(blog|post|create|assets|diary|bookmarks)(\/|$)/.test(pathname)) return 'blog'
  return ['subs', 'todo', 'practice', 'steamidler', 'gamemap', 'vault', 'apihub', 'logs', 'config', 'confcenter', 'clash', 'devtoolbox'].find(key => pathname === `/${key}` || pathname.startsWith(`/${key}/`))
}
