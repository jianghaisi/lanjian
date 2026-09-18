<script setup lang="ts">
import { childrenForParent } from '../../library/services/workspace-navigation'
import StudioIcon from '../../../ui/StudioIcon.vue'
import '../../../assets/chronicle.css'

defineProps<{ activeLeaf?: string }>()
const emit = defineEmits<{ navigate: [id: string] }>()
const pages = childrenForParent('chronicle')
const subtitles: Record<string, string> = { 'event-timeline': 'STORY EVENTS', 'world-map': 'WORLD ATLAS' }
</script>

<template>
  <aside class="chronicle-sidebar" aria-label="纪事导航">
    <div class="chronicle-sidebar-title"><h2>纪事</h2><small>STORY ARCHIVE</small></div>
    <nav aria-label="纪事主视图">
      <button v-for="page in pages.filter(item => !item.auxiliary)" :key="page.id" type="button" :aria-current="activeLeaf === page.id ? 'page' : undefined" :data-testid="`timeline-mode-${page.target.timelineMode}`" @click="emit('navigate', page.id)">
        <i class="archive-index-mark" aria-hidden="true"></i><span><b>{{ page.label }}</b><small>{{ subtitles[page.id] }}</small></span><StudioIcon name="chevron-right" :size="13"/>
      </button>
    </nav>
    <nav class="chronicle-sidebar-tools" aria-label="写作辅助工具"><p>写作工具 <span>TOOLS</span></p>
      <button v-for="page in pages.filter(item => item.auxiliary)" :key="page.id" type="button" :title="page.description" :aria-current="activeLeaf === page.id ? 'page' : undefined" :data-testid="`timeline-mode-${page.target.timelineMode}`" @click="emit('navigate', page.id)"><StudioIcon :name="page.icon" :size="16"/><span>{{ page.label }}</span><span aria-hidden="true">↗</span></button>
    </nav>
    <footer><span aria-hidden="true">—</span><p>在文字的废墟上，<br>我们重建更大的真实。</p><i aria-hidden="true">／</i><small>WRITE<br>ARCHIVE<br>IMAGINE<br>REPEAT.</small><span class="archive-footer-mark" aria-hidden="true"></span></footer>
  </aside>
</template>
