<script setup lang="ts">
import { onMounted } from 'vue'
onMounted(() => {
  const target = new URL('/app', location.origin)
  target.search = location.search
  target.searchParams.set('guest', '1')
  target.hash = location.hash
  location.replace(target.href)
})
</script>
<template><main><p role="status">正在打开参考书…</p><a href="/app?guest=1">在创作工作台阅读</a></main></template>
