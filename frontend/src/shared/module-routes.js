export function moduleForPath(pathname) {
  if (/^\/(blog|post|create|assets)(\/|$)/.test(pathname)) return 'blog'
  return ['diary', 'subs', 'todo', 'practice', 'steamidler', 'gamemap', 'vault', 'apihub', 'logs', 'config', 'confcenter', 'clash', 'devtoolbox', 'bookmarks'].find(key => pathname === `/${key}` || pathname.startsWith(`/${key}/`))
}
