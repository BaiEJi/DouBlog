import type { MockMethod } from 'vite-plugin-mock'
import authMocks from './auth'
import postMocks from './post'
import imageMocks from './image'

export default [
  ...authMocks,
  ...postMocks,
  ...imageMocks,
] as MockMethod[]
