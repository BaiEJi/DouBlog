import { MODULES, MODULE_ALIASES } from './modules'
export function moduleForPath(pathname) {
  const key = pathname.split('/')[1]
  return MODULE_ALIASES[key] || (MODULES[key] ? key : undefined)
}
