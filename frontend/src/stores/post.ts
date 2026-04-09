import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Post, PostTreeNode } from '@/types/post'
import type { CreatePostRequest, UpdatePostRequest } from '@/types/post'
import * as postApi from '@/services/post'
import * as storage from '@/utils/storage'

export const usePostStore = defineStore('post', () => {
  const posts = ref<Post[]>([])
  const currentPost = ref<Post | null>(null)
  const postTree = ref<PostTreeNode[]>([])
  const treeLoading = ref<boolean>(false)
  const postLoading = ref<boolean>(false)

  const savedExpanded = storage.get<number[]>('expandedNodes') || []
  const expandedNodeIds = ref<Set<number>>(new Set(savedExpanded))

  watch(expandedNodeIds, (val) => {
    storage.set('expandedNodes', [...val])
  }, { deep: true })

  async function fetchPostTree(): Promise<void> {
    treeLoading.value = true
    try {
      postTree.value = await postApi.getPostTree()
    } finally {
      treeLoading.value = false
    }
  }

  async function fetchPostById(id: number): Promise<void> {
    postLoading.value = true
    try {
      currentPost.value = await postApi.getPostById(id)
    } catch (error) {
      currentPost.value = null
      throw error
    } finally {
      postLoading.value = false
    }
  }

  async function fetchPostBySlug(slug: string): Promise<void> {
    postLoading.value = true
    try {
      currentPost.value = await postApi.getPostBySlug(slug)
    } catch (error) {
      currentPost.value = null
      throw error
    } finally {
      postLoading.value = false
    }
  }

  async function fetchPost(slug: string): Promise<void> {
    postLoading.value = true
    try {
      currentPost.value = await postApi.getPostByPath(slug)
    } catch (error) {
      currentPost.value = null
      throw error
    } finally {
      postLoading.value = false
    }
  }

  async function createPost(data: CreatePostRequest): Promise<Post> {
    treeLoading.value = true
    try {
      const post = await postApi.createPost(data)
      await fetchPostTree()
      return post
    } finally {
      treeLoading.value = false
    }
  }

  async function updatePostById(id: number, data: UpdatePostRequest): Promise<Post> {
    treeLoading.value = true
    try {
      const post = await postApi.updatePostById(id, data)
      await fetchPostTree()
      return post
    } finally {
      treeLoading.value = false
    }
  }

  async function updatePostBySlug(slug: string, data: UpdatePostRequest): Promise<Post> {
    treeLoading.value = true
    try {
      const post = await postApi.updatePostBySlug(slug, data)
      await fetchPostTree()
      return post
    } finally {
      treeLoading.value = false
    }
  }

  async function deletePostById(id: number): Promise<void> {
    treeLoading.value = true
    try {
      await postApi.deletePostById(id)
      await fetchPostTree()
    } finally {
      treeLoading.value = false
    }
  }

  async function deletePostBySlug(slug: string): Promise<void> {
    treeLoading.value = true
    try {
      await postApi.deletePostBySlug(slug)
      await fetchPostTree()
    } finally {
      treeLoading.value = false
    }
  }

  async function updatePost(id: number, data: UpdatePostRequest): Promise<Post> {
    return updatePostById(id, data)
  }

  async function deletePost(id: number): Promise<void> {
    return deletePostById(id)
  }

  function toggleNodeExpand(nodeId: number): void {
    if (expandedNodeIds.value.has(nodeId)) {
      expandedNodeIds.value.delete(nodeId)
    } else {
      expandedNodeIds.value.add(nodeId)
    }
  }

  function isNodeExpanded(nodeId: number): boolean {
    return expandedNodeIds.value.has(nodeId)
  }

  return {
    posts,
    currentPost,
    postTree,
    treeLoading,
    postLoading,
    expandedNodeIds,
    fetchPostTree,
    fetchPostById,
    fetchPostBySlug,
    fetchPost,
    createPost,
    updatePostById,
    updatePostBySlug,
    deletePostById,
    deletePostBySlug,
    updatePost,
    deletePost,
    toggleNodeExpand,
    isNodeExpanded
  }
})
