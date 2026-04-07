import api from './api'
import type { Post, PostTreeNode, CreatePostRequest, UpdatePostRequest } from '@/types/post'
import type { PaginatedResponse } from '@/types/api'

export function getPosts(params?: Record<string, any>): Promise<PaginatedResponse<Post>> {
  return api.get<PaginatedResponse<Post>>('/posts', { params }).then(res => res.data)
}

export function getPost(slug: string): Promise<Post> {
  return api.get<Post>(`/posts/${slug}`).then(res => res.data)
}

export function getPostTree(): Promise<PostTreeNode[]> {
  return api.get<PostTreeNode[]>('/posts/tree').then(res => res.data)
}

export function createPost(data: CreatePostRequest): Promise<Post> {
  return api.post<Post>('/posts', data).then(res => res.data)
}

export function updatePost(slug: string, data: UpdatePostRequest): Promise<Post> {
  return api.put<Post>(`/posts/${slug}`, data).then(res => res.data)
}

export function deletePost(slug: string): Promise<void> {
  return api.delete(`/posts/${slug}`).then(() => undefined)
}
