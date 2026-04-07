import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Post, PostTreeNode } from '@/types/post'
import type { CreatePostRequest, UpdatePostRequest } from '@/types/post'
import * as postApi from '@/services/post'

export const usePostStore = defineStore('post', () => {
  const posts = ref<Post[]>([])
  const currentPost = ref<Post | null>(null)
  const postTree = ref<PostTreeNode[]>([])
  const loading = ref<boolean>(false)

  async function fetchPostTree(): Promise<void> {
    loading.value = true
    try {
      postTree.value = await postApi.getPostTree()
    } finally {
      loading.value = false
    }
  }

  async function fetchPost(slug: string): Promise<void> {
    loading.value = true
    try {
      currentPost.value = await postApi.getPost(slug)
    } finally {
      loading.value = false
    }
  }

  async function createPost(data: CreatePostRequest): Promise<Post> {
    loading.value = true
    try {
      const post = await postApi.createPost(data)
      await fetchPostTree()
      return post
    } finally {
      loading.value = false
    }
  }

  async function updatePost(slug: string, data: UpdatePostRequest): Promise<Post> {
    loading.value = true
    try {
      const post = await postApi.updatePost(slug, data)
      await fetchPostTree()
      return post
    } finally {
      loading.value = false
    }
  }

  async function deletePost(slug: string): Promise<void> {
    loading.value = true
    try {
      await postApi.deletePost(slug)
      await fetchPostTree()
    } finally {
      loading.value = false
    }
  }

  return {
    posts,
    currentPost,
    postTree,
    loading,
    fetchPostTree,
    fetchPost,
    createPost,
    updatePost,
    deletePost
  }
})
