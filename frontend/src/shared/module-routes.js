export function moduleForPath(pathname) {
  if (/^\/(blog|post|create|admin)(\/|$)/.test(pathname)) return 'blog'
  return ['diary', 'subs', 'todo', 'practice', 'steamidler', 'gamemap', 'vault', 'apihub', 'logs', 'config', 'confcenter', 'clash', 'assets', 'devtoolbox'].find(key => pathname === `/${key}` || pathname.startsWith(`/${key}/`))
}
