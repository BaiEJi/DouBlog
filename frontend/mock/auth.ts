import type { MockMethod } from 'vite-plugin-mock'

export default [
  {
    url: '/auth/login',
    method: 'post',
    response: {
      success: true,
      code: 200,
      message: 'Login successful',
      data: {
        username: 'test',
      },
    },
  },
  {
    url: '/auth/check',
    method: 'get',
    response: {
      success: true,
      code: 200,
      message: 'Authenticated',
      data: {
        authenticated: true,
      },
    },
  },
] as MockMethod[]
