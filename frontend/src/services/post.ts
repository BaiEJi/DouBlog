import api from './api'
import type { Post, PostTreeNode, CreatePostRequest, UpdatePostRequest } from '@/types/post'
import type { PaginatedResponse } from '@/types/api'

/**
 * 获取文章列表（分页）
 * 
 * @param {Record<string, any>} params - 查询参数
 * @returns {Promise<PaginatedResponse<Post>>} 分页文章列表
 */
export function getPosts(params?: Record<string, any>): Promise<PaginatedResponse<Post>> {
  return api.get<PaginatedResponse<Post>>('/posts', { params }).then(res => res.data)
}

/**
 * 通过ID获取文章详情
 * 
 * @param {number} id - 文章ID
 * @returns {Promise<Post>} 文章详情
 */
export function getPostById(id: number): Promise<Post> {
  return api.get<Post>(`/posts/id/${id}`).then(res => res.data)
}

/**
 * 通过slug获取文章详情
 * 
 * @param {string} slug - 文章别名
 * @returns {Promise<Post>} 文章详情
 */
export function getPostBySlug(slug: string): Promise<Post> {
  return api.get<Post>(`/posts/slug/${slug}`).then(res => res.data)
}

/**
 * 通过完整路径获取文章详情（兼容旧版）
 * 
 * @param {string} slug - 文章路径
 * @returns {Promise<Post>} 文章详情
 */
export function getPostByPath(slug: string): Promise<Post> {
  return api.get<Post>(`/posts/path/${slug}`).then(res => res.data)
}

/**
 * 获取文章树形结构
 * 
 * @returns {Promise<PostTreeNode[]>} 文章树
 */
export function getPostTree(): Promise<PostTreeNode[]> {
  return api.get<PostTreeNode[]>('/posts/tree').then(res => res.data)
}

/**
 * 创建文章
 * 
 * @param {CreatePostRequest} data - 创建文章请求数据
 * @returns {Promise<Post>} 创建的文章
 */
export function createPost(data: CreatePostRequest): Promise<Post> {
  return api.post<Post>('/posts', data).then(res => res.data)
}

/**
 * 通过ID更新文章
 * 
 * @param {number} id - 文章ID
 * @param {UpdatePostRequest} data - 更新文章请求数据
 * @returns {Promise<Post>} 更新后的文章
 */
export function updatePostById(id: number, data: UpdatePostRequest): Promise<Post> {
  return api.put<Post>(`/posts/id/${id}`, data).then(res => res.data)
}

/**
 * 通过slug更新文章
 * 
 * @param {string} slug - 文章别名
 * @param {UpdatePostRequest} data - 更新文章请求数据
 * @returns {Promise<Post>} 更新后的文章
 */
export function updatePostBySlug(slug: string, data: UpdatePostRequest): Promise<Post> {
  return api.put<Post>(`/posts/slug/${slug}`, data).then(res => res.data)
}

/**
 * 通过ID删除文章
 * 
 * @param {number} id - 文章ID
 * @returns {Promise<void>}
 */
export function deletePostById(id: number): Promise<void> {
  return api.delete(`/posts/id/${id}`).then(() => undefined)
}

/**
 * 通过slug删除文章
 * 
 * @param {string} slug - 文章别名
 * @returns {Promise<void>}
 */
export function deletePostBySlug(slug: string): Promise<void> {
  return api.delete(`/posts/slug/${slug}`).then(() => undefined)
}

/**
 * 通过完整路径获取文章（兼容旧版）
 * @deprecated 请使用 getPostById 或 getPostBySlug
 * 
 * @param {string} slug - 文章路径
 * @returns {Promise<Post>} 文章详情
 */
export function getPost(slug: string): Promise<Post> {
  return getPostByPath(slug)
}

/**
 * 通过ID更新文章（兼容旧版）
 * @deprecated 请使用 updatePostById
 * 
 * @param {number} id - 文章ID
 * @param {UpdatePostRequest} data - 更新文章请求数据
 * @returns {Promise<Post>} 更新后的文章
 */
export function updatePost(id: number, data: UpdatePostRequest): Promise<Post> {
  return updatePostById(id, data)
}

/**
 * 通过ID删除文章（兼容旧版）
 * @deprecated 请使用 deletePostById
 * 
 * @param {number} id - 文章ID
 * @returns {Promise<void>}
 */
export function deletePost(id: number): Promise<void> {
  return deletePostById(id)
}

/**
 * 通过slug更新文章（兼容旧版）
 * @deprecated 请使用 updatePostBySlug
 * 
 * @param {string} slug - 文章别名
 * @param {UpdatePostRequest} data - 更新文章请求数据
 * @returns {Promise<Post>} 更新后的文章
 */
export function updatePostBySlugLegacy(slug: string, data: UpdatePostRequest): Promise<Post> {
  return updatePostBySlug(slug, data)
}

/**
 * 通过slug删除文章（兼容旧版）
 * @deprecated 请使用 deletePostBySlug
 * 
 * @param {string} slug - 文章别名
 * @returns {Promise<void>}
 */
export function deletePostBySlugLegacy(slug: string): Promise<void> {
  return deletePostBySlug(slug)
}
