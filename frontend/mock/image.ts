import type { MockMethod } from 'vite-plugin-mock'
import type { ApiResponse } from '@/types/api'

export default [
  {
    url: '/api/images/upload',
    method: 'post',
    response: (): ApiResponse<{ url: string }> => ({
      success: true,
      code: 200,
      message: 'Image uploaded successfully',
      data: {
        url: '/api/images/mock/test.png',
      },
    }),
  },
  {
    url: '/api/images/:filepath',
    method: 'get',
    response: () => ({
      status: 200,
      headers: {
        'Content-Type': 'image/png',
      },
      body: 'mock-image-data',
    }),
  },
] as MockMethod[]
