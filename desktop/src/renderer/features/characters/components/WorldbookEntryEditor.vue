<script setup lang="ts">
import { computed, ref } from 'vue'
import { emptyWorldbookEntry, readWorldbookProfile, writeWorldbookProfile, type WorldbookEntry } from '../../../../contracts/characters/worldbook'

const props = defineProps<{ modelValue: string; chapters: Array<{ id: number; position: number; title: string }>; entities: Array<{ id: string; entityType: string; canonicalName: string; status: string }> }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const error = ref('')
const parsed = computed(() => {
  try { return { value: readWorldbookProfile(JSON.parse(props.modelValue)), error: '' } }
  catch { return { value: null, error: '档案格式需要核对，请展开高级编辑；原内容仍然保留。' } }
})
const book = computed(() => parsed.value.value)
const characters = computed(() => props.entities.filter(item => item.entityType === 'character' && item.status === 'approved'))
function update(change: Partial<WorldbookEntry>) {
  try {
    emit('update:modelValue', writeWorldbookProfile(props.modelValue, { ...(book.value ?? emptyWorldbookEntry()), ...change }))
    error.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '世界书内容无效' }
}
function secret(index: number, change: Partial<WorldbookEntry['secrets'][number]>) {
  update({ secrets: book.value!.secrets.map((item, i) => i === index ? { ...item, ...change } : item) })
}
function addSecret() { update({ secrets: [...book.value!.secrets, { id: crypto.randomUUID(), text: '', revealChapterId: null, knownBy: [] }] }) }
const value = (event: Event) => (event.target as HTMLInputElement).value
function textInput(event: Event, write: (text: string) => void) {
  if (!(event as InputEvent).isComposing) write(value(event))
}
const selections = (event: Event) => Array.from((event.target as HTMLSelectElement).selectedOptions, option => option.value)
</script>

<template>
  <div class="worldbook-editor wide-field" data-testid="worldbook-editor">
    <p v-if="parsed.error || error" role="alert">{{ parsed.error || error }}</p>
    <div v-if="!book && !parsed.error">
      <p>启用表单后，原始资料仍可在高级编辑中查看。</p>
      <button class="control-button secondary" type="button" data-testid="worldbook-enable" @click="update({})">启用世界书表单</button>
    </div>
    <template v-if="book">
      <label>公开设定<textarea :value="book.description" maxlength="30000" data-testid="worldbook-description" placeholder="人物背景、世界规则或物品特征。秘密请单独填写。" @input="textInput($event, description => update({ description }))" @compositionend="update({ description: value($event) })" /></label>
      <details>
        <summary>本章取用与作者备注</summary>
        <label>别名（每行一个）<textarea :value="book.aliases.join('\n')" @change="update({ aliases: [...new Set(value($event).split('\n').map(item => item.trim()).filter(Boolean))] })" /></label>
        <label class="worldbook-checkbox"><input type="checkbox" :checked="book.alwaysInclude" @change="update({ alwaysInclude: ($event.target as HTMLInputElement).checked })" /> 每章都使用此条目</label>
        <label>指定章节（可多选）<select multiple @change="update({ chapterIds: selections($event).map(Number) })"><option v-for="chapter in chapters" :key="chapter.id" :value="String(chapter.id)" :selected="book.chapterIds.includes(chapter.id)">第 {{ chapter.position }} 章 · {{ chapter.title }}</option></select></label>
        <small v-if="book.chapterIds.some(id => !chapters.some(chapter => chapter.id === id))">部分指定章节已不可用，请重新核对。</small>
        <label>作者备注（不发送给模型）<textarea :value="book.authorNotes" maxlength="30000" data-testid="worldbook-notes" @input="textInput($event, authorNotes => update({ authorNotes }))" @compositionend="update({ authorNotes: value($event) })" /></label>
      </details>
      <details data-testid="worldbook-secrets">
        <summary>秘密与人物知情 · {{ book.secrets.length }}</summary>
        <fieldset v-for="(item, index) in book.secrets" :key="item.id">
          <legend>秘密 {{ index + 1 }}</legend>
          <label>内容<textarea :value="item.text" maxlength="10000" data-testid="worldbook-secret-text" @input="textInput($event, text => secret(index, { text }))" @compositionend="secret(index, { text: value($event) })" /></label>
          <label>何时允许用于正文<select :value="item.revealChapterId ?? ''" data-testid="worldbook-reveal" @change="secret(index, { revealChapterId: value($event) ? Number(value($event)) : null })"><option value="">仅作者保留</option><option v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">从第 {{ chapter.position }} 章 · {{ chapter.title }} 起</option><option v-if="item.revealChapterId && !chapters.some(chapter => chapter.id === item.revealChapterId)" :value="item.revealChapterId">原章节不可用 · 暂不披露</option></select></label>
          <label>届时知情的人物（可多选）<select multiple @change="secret(index, { knownBy: selections($event) })"><option v-for="character in characters" :key="character.id" :value="character.id" :selected="item.knownBy.includes(character.id)">{{ character.canonicalName }}</option></select></label>
          <small>未列出的人物不能自动知道；读者获知不等于人物获知。</small>
          <small v-if="item.knownBy.some(id => !characters.some(character => character.id === id))">知情人物引用已失效，此秘密暂不披露。</small>
          <button class="control-button secondary" type="button" @click="update({ secrets: book.secrets.filter((_, i) => i !== index) })">移除此片段</button>
        </fieldset>
        <button class="control-button secondary" type="button" :disabled="book.secrets.length >= 50" data-testid="worldbook-add-secret" @click="addSecret">添加秘密片段</button>
      </details>
      <small>此处不覆盖章前状态与资源账本。大纲中已披露的秘密仍需单独核对。</small>
    </template>
    <details>
      <summary>高级编辑 · 原始档案</summary>
      <label>档案 JSON<textarea :value="modelValue" spellcheck="false" data-testid="worldbook-json" @input="textInput($event, text => emit('update:modelValue', text))" @compositionend="emit('update:modelValue', value($event))" /></label>
    </details>
  </div>
</template>

<style scoped>
.worldbook-editor { display: grid; gap: 14px; min-width: 0; }
.worldbook-editor label { display: grid; gap: 8px; }
.worldbook-editor textarea { min-height: 100px; width: 100%; box-sizing: border-box; }
.worldbook-editor details > :not(summary) { margin-top: 12px; }
.worldbook-editor summary { cursor: pointer; padding: 8px 0; }
.worldbook-editor fieldset { display: grid; gap: 12px; min-width: 0; border: 1px solid var(--border-color, #71867b); }
.worldbook-editor .worldbook-checkbox { display: flex; align-items: center; }
.worldbook-editor .worldbook-checkbox input { width: auto; }
</style>
