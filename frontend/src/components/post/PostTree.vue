<script setup lang="ts">
import { onMounted } from 'vue'
import { usePostStore } from '@/stores/post'
import PostTreeItem from './PostTreeItem.vue'

const postStore = usePostStore()

onMounted(() => {
  postStore.fetchPostTree()
})
</script>

<template>
  <div class="h-full bg-vscode-bg-primary overflow-auto">
    <PostTreeItem
      v-for="node in postStore.postTree"
      :key="node.id"
      :node="node"
    />
  </div>
</template>
