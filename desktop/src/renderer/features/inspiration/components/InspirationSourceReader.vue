<script setup lang="ts">
import type { InspirationReadSource } from '../../../../contracts/inspiration/types'
import { sourceLink, videoTime } from '../utils/source-link'
defineProps<{reading:InspirationReadSource|null;busy:boolean}>()
defineEmits<{more:[]}>()
</script>
<template>
  <div class="inspiration-source-reader" :aria-busy="busy">
    <template v-if="reading">
      <details class="inspiration-source-details"><summary>来源详情</summary><p>{{ reading.source.title }}</p><p>来源版本：<code>{{ reading.source.version }}</code></p></details>
      <a v-if="sourceLink(reading.source)" :href="sourceLink(reading.source)" target="_blank" rel="noopener noreferrer">打开原视频 ↗</a>
      <article v-for="segment in reading.segments" :key="segment.id">
        <h4>{{ segment.title }}<span v-if="segment.startSeconds!==null"> · {{ videoTime(segment.startSeconds) }}—{{ videoTime(segment.endSeconds) }}</span></h4>
        <a v-if="segment.startSeconds!==null&&reading.source.platform==='bilibili'&&sourceLink(reading.source,segment.startSeconds)" :href="sourceLink(reading.source,segment.startSeconds)" target="_blank" rel="noopener noreferrer">从 {{ videoTime(segment.startSeconds) }} 查看视频 ↗</a>
        <pre>{{ segment.text }}</pre>
      </article>
      <button v-if="reading.nextOffset>=0" :disabled="busy" @click="$emit('more')">继续阅读来源</button>
      <p v-else class="inspiration-read-end">已显示这份来源的全部 {{ reading.source.segmentCount }} 个片段</p>
    </template>
    <p v-if="busy" role="status">正在读取原文…</p>
  </div>
</template>
