<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import Layout from '@/components/layout/Layout.vue'
import MarkdownRenderer from '@/components/post/MarkdownRenderer.vue'
import { usePostStore } from '@/stores/post'

const route = useRoute()
const postStore = usePostStore()

const slug = computed(() => route.params.slug as string)
const currentPost = computed(() => postStore.currentPost)
const loading = computed(() => postStore.loading)

onMounted(() => {
  if (slug.value) {
    postStore.fetchPost(slug.value)
  }
})
</script>

<template>
  <Layout>
    <div class="max-w-4xl mx-auto p-6">
      <div v-if="loading" class="text-vscode-text-secondary">
        加载中...
      </div>
      <div v-else-if="currentPost">
        <h1 class="text-3xl font-semibold mb-6">{{ currentPost.title }}</h1>
        <MarkdownRenderer :content="currentPost.content" />
      </div>
    </div>
  </Layout>
</template>
