<script setup lang="ts">
import { categoryLabel } from '../../../../contracts/writing-plugins/contributions'
defineProps<{ source: string; category: string; query: string; categories: string[]; count: number }>()
defineEmits<{ 'update:source': [value: string]; 'update:category': [value: string]; 'update:query': [value: string] }>()
const views = [{ id: 'all', label: '全部已安装' }, { id: 'official', label: '官方' }, { id: 'community', label: '社区' }, { id: 'mine', label: '我创建的' }]
</script>
<template>
  <div class="plugin-filters" aria-label="筛选插件">
    <div class="source-views"><button v-for="item in views" :key="item.id" type="button" :aria-pressed="source === item.id" @click="$emit('update:source', item.id)">{{ item.label }}</button></div>
    <div class="filter-fields">
      <label>类别<select aria-label="类别" :value="category" @change="$emit('update:category', ($event.target as HTMLSelectElement).value)"><option value="">全部类别</option><option v-for="id in categories" :key="id" :value="id">{{ categoryLabel(id) }}</option></select></label>
      <label class="search">查找插件<input type="search" :value="query" placeholder="名称、说明或标签" @input="$emit('update:query', ($event.target as HTMLInputElement).value)" /></label>
      <span role="status">{{ count }} 项</span>
    </div>
    <p v-if="source === 'mine'">展示本机创建记录或已验证账号名下的插件。安装其他人的插件不会改变作者归属。</p>
    <p v-else-if="source === 'official' || source === 'community'">按已验证的发布来源筛选；本地安装包的自述不会获得发布者标识。</p>
  </div>
</template>
<style scoped>
.plugin-filters { display: grid; gap: 14px; border-block: 1px solid var(--line); padding: 18px 0; }
.source-views { display: flex; flex-wrap: wrap; gap: 8px; }.source-views button { border: 1px solid var(--line); border-radius: 20px; padding: 7px 14px; background: var(--surface); color: var(--ink); cursor: pointer; }.source-views button[aria-pressed="true"] { border-color: var(--jade); color: var(--jade); }
.filter-fields { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }.filter-fields label { display: grid; gap: 6px; font-size: 13px; }.search { flex: 1; min-width: 160px; }input, select { padding: 9px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); min-width: 0; }p { margin: 0; font-size: 13px; line-height: 1.7; }button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--jade); outline-offset: 3px; }
</style>
