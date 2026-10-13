import { createContext, useContext, useEffect } from 'react'
export const NavigationContext = createContext(null)

export function useModuleNavigation(config) {
  const setNavigation = useContext(NavigationContext)
  // Context exposes only the stable setter: updating the sidebar never rerenders the page.
  useEffect(() => { if (setNavigation) setNavigation(config) })
  useEffect(() => () => { if (setNavigation) setNavigation(null) }, [setNavigation])
}
