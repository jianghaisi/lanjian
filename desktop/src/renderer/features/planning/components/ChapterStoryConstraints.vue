<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { ChapterStoryContractPreview } from '../../../../contracts/planning/chapter-story-contract'
const props = defineProps<{ workItemId: string; chapterId: number; content: string; disabled?: boolean }>()
const emit = defineEmits<{ saved: [] }>()
const preview = ref<ChapterStoryContractPreview | null>(null), pending = ref(false), message = ref('')
let generation = 0
watch(() => [props.workItemId, props.chapterId, props.content], () => { generation++; preview.value = null; pending.value = false; message.value = '' })
onBeforeUnmount(() => generation++)
async function run(adopt = false) {
  if (pending.value || props.disabled || !props.content.trim()) return
  const ticket = ++generation
  pending.value = true; message.value = ''
  try {
    if (adopt && preview.value) {
      await window.novelDesktop.planning.adoptChapterStoryContract(preview.value.token)
      if (ticket !== generation) return
      preview.value = null; message.value = '写作约束已绑定本版章纲；请再确认本版。'; emit('saved')
    } else {
      const result = await window.novelDesktop.planning.prepareChapterStoryContract(props.chapterId)
      if (ticket === generation) preview.value = result
    }
  } catch (e) { if (ticket === generation) message.value = e instanceof Error ? e.message : '准备失败，请重试。' }
  finally { if (ticket === generation) pending.value = false }
}
</script>
<template>
  <section class="story-constraints" data-testid="chapter-story-constraints" aria-label="故事章纲写作约束">
    <button type="button" :disabled="disabled || pending || !content.trim()" @click="run()">{{ pending ? '正在处理…' : '准备写作约束' }}</button>
    <small>故事章纲写自然段。保存后提取约束供核对，核对后再确认本版；不把规则加回故事。</small>
    <div v-if="preview" class="constraint-preview" data-testid="story-contract-preview">
      <p><b>开始处境</b>{{ preview.constraints.entryState }}</p>
      <ol><li v-for="(beat, index) in preview.constraints.beats" :key="index">{{ beat }}</li></ol>
      <p><b>章末结果</b>{{ preview.constraints.exitState }}</p>
      <p><b>可展开事实</b>{{ preview.constraints.allowedFacts.join('；') }}</p>
      <p><b>不能提前发生</b>{{ preview.constraints.forbiddenEvents.join('；') }}</p>
      <p v-for="(item, index) in preview.constraints.foreshadowActions" :key="index"><b>伏笔 {{ item.action }}</b>{{ item.description }}</p>
      <button type="button" :disabled="pending || disabled" @click="run(true)">核对无误，采用约束</button>
      <button type="button" :disabled="pending" @click="preview = null">暂不采用</button>
    </div>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>
<style scoped>
.story-constraints { border: 1px solid var(--line); padding: 12px; min-width: 0; }
small { display: block; margin-top: 8px; line-height: 1.6; }
.constraint-preview { max-height: 360px; overflow: auto; }
p, li { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; }
b { display: block; }
button { color: inherit; background: var(--surface-raised); border: 1px solid var(--line); padding: 7px 10px; margin-right: 8px; }
button:disabled { opacity: .5; }
button:focus-visible { outline: 2px solid var(--jade); outline-offset: 2px; }
</style>
