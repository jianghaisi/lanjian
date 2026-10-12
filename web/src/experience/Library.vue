<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { BookView } from '@lanjian/hosted-contracts'
import ArchivePageHeader from '../../../desktop/src/renderer/ui/ArchivePageHeader.vue'
import LibraryBookCover from '../../../desktop/src/renderer/features/library/components/LibraryBookCover.vue'
import { writing } from '../api/writing'
import { messageOf, type Session } from '../api/http'
import Workspace from './Workspace.vue'
const props = defineProps<{ session: Session }>()
const emit = defineEmits<{ 'refresh-wallet': [] }>()
const books = ref<BookView[]>([]), active = ref<BookView | null>(null), title = ref(''), query = ref(''), error = ref(''), loading = ref(true), busy = ref(false)
let createOperation = crypto.randomUUID(), submittedTitle = ''
const filtered = computed(() => books.value.filter(b => b.title.includes(query.value.trim())))
async function refresh() { loading.value = true; error.value = ''; try { books.value = await writing.books() } catch (e) { error.value = messageOf(e) } finally { loading.value = false } }
async function create() { if (!title.value.trim() || busy.value) return; busy.value = true; error.value = ''; if (submittedTitle !== title.value) { createOperation = crypto.randomUUID(); submittedTitle = title.value }
  try { const book = await writing.createBook(title.value.trim(), createOperation); books.value = [book, ...books.value.filter(b => b.id !== book.id)]; active.value = book; title.value = ''; createOperation = crypto.randomUUID() } catch (e) { error.value = messageOf(e) } finally { busy.value = false } }
onMounted(async () => { await refresh(); const id = new URLSearchParams(location.search).get('book'); if (id) active.value = books.value.find(book => book.id === id) ?? null })
</script>
<template>
  <Workspace v-if="active" :key="active.id" :book="active" :session="props.session" @back="active = null; refresh()" @refresh-wallet="emit('refresh-wallet')" />
  <main v-else class="library-page"><ArchivePageHeader eyebrow="MY WORKS / 私人创作档案" title="我的作品" description="收好每一个灵感，继续写你想讲的故事。"><span class="archive-count">{{ String(books.length).padStart(2, '0') }} <small>部作品</small></span></ArchivePageHeader><section class="reference-invitation"><div><p class="eyebrow">START WITH A STORY / 原创参考书</p><strong>渡口最后一盏灯</strong><p class="muted">五章完整短篇 · 设定、事件、章纲与正文齐备 · 阅读和复制免费</p></div><a class="button-link" href="/app/reference">翻开参考书 ↗</a></section><section class="library-actions"><form class="inline-form" @submit.prevent="create"><label>新作品名称<input v-model="title" maxlength="200" placeholder="为新世界起个名字" required></label><button class="primary" :disabled="busy">{{ busy ? '正在建档…' : '＋ 新建作品' }}</button></form><label>查找作品<input v-model="query" type="search" placeholder="输入书名"></label></section><p v-if="error" role="alert" class="error">{{ error }} <button @click="refresh">重新读取</button></p><p v-if="loading" role="status">正在整理书架…</p><div v-else class="book-grid"><button v-for="(book, i) in filtered" :key="book.id" class="book-card" @click="active = book"><LibraryBookCover :title="book.title" /><span class="book-card-copy"><span class="eyebrow">LJ / {{ String(i + 1).padStart(2, '0') }}</span><strong>{{ book.title }}</strong><span class="muted">创建于 {{ new Date(book.createdAt).toLocaleDateString('zh-CN') }}</span><span class="book-card-action">打开作品 ↗</span></span></button><section v-if="!filtered.length" class="empty-state"><h2>{{ query ? '没有找到这部作品' : '第一部作品，从一个念头开始。' }}</h2><p>{{ query ? '换个关键词试试。' : '在上方写下书名，就可以开始定书与写作。' }}</p></section></div><footer class="library-foot"><span>LANJIAN · ONLINE EDITION</span><span>你的书稿，始终由你决定。</span></footer></main>
</template>

<style scoped>
.reference-invitation{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.4rem 1.6rem;background:var(--jade-wash);border-left:3px solid var(--jade)}.reference-invitation strong{font:1.3rem var(--serif)}.reference-invitation p:last-child{margin:.6rem 0 0}.reference-invitation>a{flex:none}@media(max-width:600px){.reference-invitation{align-items:start;flex-direction:column}}
</style>
