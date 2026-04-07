<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Layout from '@/components/layout/Layout.vue'
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue'
import { Button } from '@/components/ui/button'
import { usePostStore } from '@/stores/post'

const route = useRoute()
const router = useRouter()
const postStore = usePostStore()

const slug = route.params.slug as string
const content = ref('')

onMounted(async () => {
  await postStore.fetchPost(slug)
  if (postStore.currentPost) {
    content.value = postStore.currentPost.content
  }
})

const handleSave = async () => {
  await postStore.updatePost(slug, { content: content.value })
  router.push(`/post/${slug}`)
}

const handleCancel = () => {
  router.back()
}
</script>

<template>
  <Layout>
    <div class="max-w-4xl mx-auto p-6">
      <h1 class="text-2xl font-semibold mb-6">
        {{ postStore.currentPost?.title || '编辑文章' }}
      </h1>
      
      <div class="mb-4">
        <MarkdownEditor v-model="content" />
      </div>
      
      <div class="flex gap-4">
        <Button @click="handleSave" :disabled="postStore.loading">
          保存
        </Button>
        <Button variant="outline" @click="handleCancel">
          取消
        </Button>
      </div>
    </div>
  </Layout>
</template>
