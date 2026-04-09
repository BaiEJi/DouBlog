export interface Post {
  id: number
  title: string
  name: string
  slug: string
  content: string
  summary: string
  parent_id: number | null
  level: number
  order: number
  author: string
  status: 'published' | 'archived'
  is_top: boolean
  view_count: number
  tags: string[]
  meta_data: Record<string, unknown>
  created_at: string
  updated_at: string
  parent: Post | null
  children: Post[]
}

export interface PostTreeNode extends Omit<Post, 'children'> {
  children: PostTreeNode[]
}

export interface CreatePostRequest {
  title: string
  name?: string
  slug?: string
  content: string
  summary?: string
  parent_id?: number | null
  order?: number
  status?: 'published' | 'archived'
  is_top?: boolean
  tags?: string[]
}

export interface UpdatePostRequest {
  title?: string
  name?: string
  content?: string
  summary?: string
  status?: 'published' | 'archived'
  is_top?: boolean
  order?: number
  tags?: string[]
  parent_id?: number | null
}
