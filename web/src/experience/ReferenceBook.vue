<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { decodeBook, decodeReferenceBook, type ReferenceBookView } from '@lanjian/hosted-contracts'
import ArchivePageHeader from '../../../desktop/src/renderer/ui/ArchivePageHeader.vue'
import LibraryBookCover from '../../../desktop/src/renderer/features/library/components/LibraryBookCover.vue'
import { http, messageOf, type Session } from '../api/http'
const props = defineProps<{ session: Session | null }>()
const book = ref<ReferenceBookView | null>(null), selected = ref(0), error = ref(''), copying = ref(false)
const chapter = computed(() => selected.value >= 0 ? book.value?.chapters[selected.value] : undefined)
const guide = computed(() => book.value?.guide.split('\n\n') ?? [])
async function read() { error.value = ''; try { book.value = decodeReferenceBook(await http.request('/api/reference-book')) } catch (e) { error.value = messageOf(e) } }
async function copy() {
  if (copying.value) return
  copying.value = true; error.value = ''
  try { const own = decodeBook(await http.request('/api/reference-book/copy', 'POST', {})); location.assign(`/app?book=${encodeURIComponent(own.id)}`) }
  catch (e) { error.value = messageOf(e); copying.value = false }
}
onMounted(read)
</script>
<template>
  <main class="reference-page">
    <a class="reference-back" href="/app">← 返回我的作品</a>
    <ArchivePageHeader eyebrow="READ & CREATE / 原创参考书" :title="book?.title ?? '打开一部完整的故事'" description="先读完故事，再翻看它的设定与章纲。你的第一步，也可以从改写开始。"><span class="reference-stamp">五章 · 已完结</span></ArchivePageHeader>
    <p v-if="error" role="alert" class="error">{{ error }} <button v-if="!book" @click="read">重新读取</button></p>
    <p v-if="!book && !error" role="status">正在打开参考书…</p>
    <template v-if="book">
      <section class="reference-intro">
        <LibraryBookCover :title="book.title" />
        <div><p class="eyebrow">A COMPLETE LITTLE WORLD</p><h2>读一个完整故事，看看它怎样长成。</h2><p>{{ book.introduction }}</p><p class="muted">阅读和复制均免费，不消耗积分。副本归你独立编辑；再次复制会打开已有副本。</p></div>
        <div class="reference-actions"><button v-if="props.session" class="primary" :disabled="copying" @click="copy">{{ copying ? '正在建立你的副本…' : '复制到我的书库' }}</button><a v-else class="primary button-link" href="/login?next=%2Fapp%2Freference">登录后复制到书库 →</a><a class="button-link" href="/api/reference-book/export">下载完整参考书</a><span class="muted">设定、章纲与正文一并保留</span></div>
      </section>
      <div class="reference-layout">
        <nav class="reference-contents" aria-label="参考书目录"><p class="eyebrow">CONTENTS / 阅读目录</p><button :aria-current="selected === -1 ? 'page' : undefined" @click="selected = -1"><small>00</small> 完整创作资料</button><button v-for="(item, i) in book.chapters" :key="item.title" :aria-current="selected === i ? 'page' : undefined" @click="selected = i"><small>{{ String(i + 1).padStart(2, '0') }}</small> {{ item.title }}</button><p class="muted reference-permission">{{ book.permission }}</p></nav>
        <article class="reference-paper" aria-live="polite">
          <template v-if="chapter"><p class="eyebrow">CHAPTER {{ String(selected + 1).padStart(2, '0') }} / {{ book.chapters.length }}</p><h1>{{ chapter.title }}</h1><details class="reference-notes"><summary>对照这一章的事件与章纲</summary><p>{{ chapter.notes }}</p></details><div class="reference-prose"><p v-for="(paragraph, i) in chapter.content.split('\n\n')" :key="i">{{ paragraph }}</p></div><div class="reference-next"><button v-if="selected > 0" @click="selected--">← 上一章</button><button v-if="selected < book.chapters.length - 1" @click="selected++">下一章 →</button><button v-else @click="selected = -1">读完了，看看完整创作资料 →</button></div></template>
          <template v-else><p class="eyebrow">STORY BIBLE / 从设定到总纲</p><h1>完整创作资料</h1><template v-for="(paragraph, i) in guide" :key="i"><h2 v-if="paragraph.startsWith('#')">{{ paragraph.replace(/^#+\s*/u, '') }}</h2><p v-else class="reference-guide-text">{{ paragraph }}</p></template><p class="muted">各章的四要素事件与章纲，可在对应正文上方展开查看。副本保留这些资料，你可以继续改写。</p></template>
        </article>
      </div>
    </template>
  </main>
</template>
<style scoped>
.reference-page{max-width:1320px;margin:auto;padding:2.5rem 3rem 4rem}.reference-back{display:inline-block;margin-bottom:1.8rem;font-size:.8rem;color:var(--muted)}.reference-stamp{padding:.5rem .8rem;border:1px solid var(--jade);color:var(--jade);font-size:.75rem;white-space:nowrap}.reference-intro{display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:1.5rem;align-items:center;border-block:1px solid var(--line);padding:1.6rem 0;margin:2rem 0}.reference-intro h2{font-size:1.4rem;margin:.5rem 0}.reference-intro p{font-size:.83rem;margin-bottom:.55rem}.reference-actions{display:grid;gap:.7rem;text-align:center}.reference-actions .muted{font-size:.7rem}.reference-layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:2.4rem;align-items:start}.reference-contents{position:sticky;top:1.5rem}.reference-contents button{display:flex;align-items:center;gap:.8rem;width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid var(--line);padding:1rem .5rem;font-size:.85rem}.reference-contents button[aria-current=page]{color:var(--jade);background:var(--jade-wash);box-shadow:inset 3px 0 var(--jade)}.reference-contents small{font-size:.65rem;letter-spacing:.1em}.reference-permission{margin-top:2rem;font-size:.72rem}.reference-paper{min-width:0;background:var(--surface);border:1px solid var(--line);padding:3rem clamp(1.5rem,4vw,4rem)}.reference-paper h1{font-size:2rem;line-height:1.5;margin:1rem 0 1.8rem}.reference-paper h2{font-size:1.3rem;margin-top:2.5rem}.reference-notes{margin-bottom:2.2rem;border-block:1px solid var(--line);padding:1rem 0;font-size:.8rem;color:var(--muted)}.reference-notes p{white-space:pre-line;margin:1rem 0 0}.reference-prose{font-family:var(--serif);font-size:1.07rem;line-height:2.1}.reference-prose p{white-space:pre-line;line-height:2.1;margin-bottom:1.1em;overflow-wrap:anywhere}.reference-guide-text{white-space:pre-line;font-size:.95rem;line-height:2}.reference-next{border-top:1px solid var(--line);padding-top:1.5rem;margin-top:3rem;display:flex;gap:.7rem;justify-content:space-between;flex-wrap:wrap}
@media(max-width:850px){.reference-page{padding:1.5rem}.reference-intro{grid-template-columns:70px minmax(0,1fr)}.reference-actions{grid-column:1/-1}.reference-layout{grid-template-columns:1fr;gap:1.2rem}.reference-contents{position:static}.reference-contents button{padding:.7rem}.reference-permission{display:none}.reference-paper{padding:1.8rem 1.25rem}.reference-paper h1{font-size:1.7rem}}
</style>
