<script setup lang="ts">
import { nextTick, ref } from 'vue'
defineProps<{ busy?: boolean; decidable?: boolean; accepted?: boolean; literary?: boolean }>()
defineEmits<{ locate: []; decide: [decision: 'accepted' | 'ignored' | 'later' | 'exception', reason?: string] }>()
const exceptionOpen = ref(false)
const exceptionReason = ref('')
const reasonInput = ref<HTMLTextAreaElement>()
async function openException() {
  exceptionOpen.value = true
  await nextTick()
  reasonInput.value?.focus()
}
</script>

<template>
  <section class="conflict-resolution-actions" aria-label="如何处理这条提示">
    <p>先对照上面的正文证据。{{ literary ? '想调整表达，就去正文修改；喜欢现在的写法，可以忽略建议。' : '确实写错了，就去正文修改；原文没有矛盾，可以标为误报。' }}</p>
    <div class="conflict-main-actions">
      <button class="control-button primary compact" type="button" :data-testid="literary ? 'locate-literary-evidence' : 'locate-continuity-evidence'" :disabled="busy" @click="$emit('locate')">去正文修改</button>
      <button v-if="decidable" class="control-button secondary compact" type="button" :disabled="busy" @click="$emit('decide', 'ignored')">{{ literary ? '保留写法，忽略建议' : '原文没问题，这是误报' }}</button>
    </div>
    <details v-if="decidable" class="conflict-other-actions">
      <summary>其他处理方式</summary>
      <button v-if="!accepted" type="button" :data-testid="literary ? 'literary-needs-fix' : 'continuity-needs-fix'" :disabled="busy" @click="$emit('decide', 'accepted')"><b>加入修改待办</b><small>记录下来，正文由你之后修改。</small></button>
      <button type="button" data-testid="open-conflict-exception" :disabled="busy" @click="openException"><b>{{ literary ? '这是刻意的表达' : '这是有意安排的剧情' }}</b><small>填写原因，保留当前正文。</small></button>
      <form v-if="exceptionOpen" class="conflict-exception-form" @submit.prevent="!busy && exceptionReason.trim() && $emit('decide', 'exception', exceptionReason.trim())">
        <label>说明你的安排<textarea v-assist-field="{ id: 'ConflictResolutionActions.exceptionReason', read: () => exceptionReason, write: value => { exceptionReason = String(value) } }" ref="reasonInput" v-model="exceptionReason" maxlength="2000" rows="3" data-testid="conflict-exception-reason" placeholder="例如：角色这里在说谎，后文会揭示真实身份。"></textarea></label>
        <small>保存后将这条提醒标为有意安排，正文保持原样。</small>
        <div class="conflict-main-actions"><button class="control-button primary compact" type="submit" data-testid="save-conflict-exception" :disabled="busy || !exceptionReason.trim()">保存说明，保留正文</button><button class="control-button secondary compact" type="button" :disabled="busy" @click="exceptionOpen = false">取消</button></div>
      </form>
      <button type="button" :disabled="busy" @click="$emit('decide', 'later')"><b>还不确定，稍后处理</b><small>保留这条提醒，下次继续核对。</small></button>
    </details>
  </section>
</template>
