<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Layout from '@/components/layout/Layout.vue'
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { usePostStore } from '@/stores/post'

const router = useRouter()
const postStore = usePostStore()

const title = ref('')
const slug = ref('')
const content = ref('')

const handleCreate = async () => {
  if (!title.value.trim() || !slug.value.trim() || !content.value.trim()) {
    return
  }

  try {
    const post = await postStore.createPost({
      title: title.value,
      slug: slug.value,
      content: content.value
    })
    router.push(`/posts/${post.slug}`)
  } catch (error) {
    console.error('Failed to create post:', error)
  }
}

const handleCancel = () => {
  router.push('/')
}
</script>

<template>
  <Layout>
    <div class="p-6">
      <div class="max-w-4xl mx-auto space-y-6">
        <div>
          <label class="block text-sm font-medium mb-2 text-vscode-text-primary">Title</label>
          <Input v-model="title" placeholder="Enter post title" />
        </div>
        
        <div>
          <label class="block text-sm font-medium mb-2 text-vscode-text-primary">Slug</label>
          <Input v-model="slug" placeholder="Enter post slug" />
        </div>
        
        <div>
          <label class="block text-sm font-medium mb-2 text-vscode-text-primary">Content</label>
          <MarkdownEditor v-model="content" />
        </div>
        
        <div class="flex gap-4">
          <Button @click="handleCreate" :disabled="!title.trim() || !slug.trim() || !content.trim()">
            Create
          </Button>
          <Button variant="outline" @click="handleCancel">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  </Layout>
</template>
