<script setup lang="ts">
import '../../../desktop/src/renderer/assets/narrative-tokens.css'
import '../styles/page-base.css'
const retry = () => location.reload()
</script>
<template><main class="page-status"><h1>暂时无法打开创作工作台</h1><p role="alert">连接或资源加载未完成，请重试。</p><button @click="retry">重新打开</button><a href="/login">返回登录页</a></main></template>
