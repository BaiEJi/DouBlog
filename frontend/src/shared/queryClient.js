import { QueryClient } from '@tanstack/react-query'
import { subscribeDataEpoch } from './dataEpoch.js'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15000, refetchOnWindowFocus: false, retry: (count, error) => count < 1 && error?.name !== 'AbortError' && !(error?.status >= 400 && error?.status < 500) },
    mutations: { retry: false },
  },
})
subscribeDataEpoch(() => { queryClient.cancelQueries(); queryClient.clear() })
