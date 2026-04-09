import api from './api'

/**
 * 上传图片
 * 
 * @param {File} file - 图片文件
 * @param {string} postSlug - 文章别名（可选）
 * @returns {Promise<{ filepath: string; url: string; filename: string; filesize: number }>} 上传结果
 */
export async function uploadImage(file: File, postSlug?: string): Promise<{ 
  filepath: string
  url: string
  filename: string
  filesize: number 
}> {
  const formData = new FormData()
  formData.append('file', file)
  
  if (postSlug) {
    formData.append('post_slug', postSlug)
  }

  const response = await api.post('/images/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })

  return response.data
}

/**
 * 获取图片URL
 * 
 * @param {string} filepath - 文件路径
 * @returns {string} 图片URL
 */
export function getImageUrl(filepath: string): string {
  return `/api/images/${filepath}`
}
