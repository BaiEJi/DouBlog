import type { MockMethod } from 'vite-plugin-mock'
import type { Post, PostTreeNode } from '../src/types/post'
import type { ApiResponse, PaginatedResponse } from '../src/types/api'

const mockPosts: Post[] = [
  {
    id: 1,
    title: '入门指南',
    slug: 'getting-started',
    content: '# 入门指南\n\n欢迎使用 DouBlog！这是一个简单的入门指南。',
    summary: 'DouBlog 入门指南，帮助您快速上手',
    parent_id: null,
    level: 0,
    order: 1,
    author: 'admin',
    status: 'published',
    is_top: true,
    view_count: 100,
    tags: ['入门', '指南'],
    meta_data: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    parent: null,
    children: [],
  },
  {
    id: 2,
    title: '快速开始',
    slug: 'quick-start',
    content: '# 快速开始\n\n快速开始使用 DouBlog。',
    summary: '快速开始指南',
    parent_id: 1,
    level: 1,
    order: 1,
    author: 'admin',
    status: 'published',
    is_top: false,
    view_count: 50,
    tags: ['快速', '开始'],
    meta_data: {},
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    parent: null,
    children: [],
  },
  {
    id: 3,
    title: '安装配置',
    slug: 'installation',
    content: '# 安装配置\n\n详细的安装和配置说明。',
    summary: '安装和配置说明',
    parent_id: 1,
    level: 1,
    order: 2,
    author: 'admin',
    status: 'published',
    is_top: false,
    view_count: 30,
    tags: ['安装', '配置'],
    meta_data: {},
    created_at: '2026-01-03T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
    parent: null,
    children: [],
  },
  {
    id: 4,
    title: '进阶教程',
    slug: 'advanced-tutorial',
    content: '# 进阶教程\n\n深入学习 DouBlog 的高级功能。',
    summary: '进阶教程，学习高级功能',
    parent_id: null,
    level: 0,
    order: 2,
    author: 'admin',
    status: 'published',
    is_top: false,
    view_count: 80,
    tags: ['进阶', '教程'],
    meta_data: {},
    created_at: '2026-01-04T00:00:00Z',
    updated_at: '2026-01-04T00:00:00Z',
    parent: null,
    children: [],
  },
  {
    id: 5,
    title: '最佳实践',
    slug: 'best-practices',
    content: '# 最佳实践\n\n使用 DouBlog 的最佳实践建议。',
    summary: '最佳实践建议',
    parent_id: 4,
    level: 1,
    order: 1,
    author: 'admin',
    status: 'published',
    is_top: false,
    view_count: 60,
    tags: ['最佳实践', '建议'],
    meta_data: {},
    created_at: '2026-01-05T00:00:00Z',
    updated_at: '2026-01-05T00:00:00Z',
    parent: null,
    children: [],
  },
]

function buildPostTree(posts: Post[]): PostTreeNode[] {
  const postMap = new Map<number, PostTreeNode>()
  const roots: PostTreeNode[] = []

  posts.forEach(post => {
    postMap.set(post.id, {
      ...post,
      children: [],
    })
  })

  posts.forEach(post => {
    const node = postMap.get(post.id)!
    if (post.parent_id === null) {
      roots.push(node)
    } else {
      const parent = postMap.get(post.parent_id)
      if (parent) {
        parent.children.push(node)
      }
    }
  })

  return roots
}

export default [
  {
    url: '/api/posts/tree',
    method: 'get',
    response: (): ApiResponse<PostTreeNode[]> => ({
      success: true,
      code: 200,
      message: 'Success',
      data: buildPostTree(mockPosts),
    }),
  },
  {
    url: '/api/posts',
    method: 'get',
    response: (): ApiResponse<PaginatedResponse<Post>> => ({
      success: true,
      code: 200,
      message: 'Success',
      data: {
        items: mockPosts,
        total: mockPosts.length,
        page: 1,
        page_size: 10,
        total_pages: 1,
      },
    }),
  },
  {
    url: '/api/posts/:slug',
    method: 'get',
    response: ({ query }: { query: { slug?: string } }): ApiResponse<Post | null> => {
      const slug = query.slug
      const post = mockPosts.find(p => p.slug === slug) || null
      return {
        success: !!post,
        code: post ? 200 : 404,
        message: post ? 'Success' : 'Post not found',
        data: post,
      }
    },
  },
  {
    url: '/api/posts',
    method: 'post',
    response: (): ApiResponse<Post> => ({
      success: true,
      code: 200,
      message: 'Post created',
      data: mockPosts[0],
    }),
  },
  {
    url: '/api/posts/:slug',
    method: 'put',
    response: (): ApiResponse<Post> => ({
      success: true,
      code: 200,
      message: 'Post updated',
      data: mockPosts[0],
    }),
  },
  {
    url: '/api/posts/:slug',
    method: 'delete',
    response: (): ApiResponse<{ success: boolean }> => ({
      success: true,
      code: 200,
      message: 'Post deleted',
      data: { success: true },
    }),
  },
] as MockMethod[]
