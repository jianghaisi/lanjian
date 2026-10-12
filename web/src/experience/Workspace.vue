<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BookView } from '@lanjian/hosted-contracts'
import type { Session } from '../api/http'
import { writing } from '../api/writing'
import Definitions from './Definitions.vue'
import Manuscript from './Manuscript.vue'
import Events from './Events.vue'
import Planning from './Planning.vue'
const props = defineProps<{ book: BookView; session: Session }>()
const emit = defineEmits<{ back: []; 'refresh-wallet': [] }>()
const api = writing.book(props.book.id), section = ref('manuscript'), composing = ref(false)
const sections = [{ id: 'profile', name: '定书', index: '01' }, { id: 'world', name: '设定', index: '02' }, { id: 'events', name: '纪事', index: '03' }, { id: 'planning', name: '谋篇', index: '04' }, { id: 'manuscript', name: '正文', index: '05' }]
const label = computed(() => sections.find(s => s.id === section.value)?.name)
</script>
<template><main class="workspace" @compositionstart.capture="composing = true" @compositionend.capture="composing = false"><header class="book-bar"><button :disabled="composing" @click="emit('back')">← 我的作品</button><span>{{ book.title }}</span><span class="book-bar-state">{{ label }} / 在线档案</span></header><div class="workspace-layout"><nav class="work-rail" aria-label="作品模块"><button v-for="item in sections" :key="item.id" :disabled="composing" :class="{ selected: section === item.id }" :aria-current="section === item.id ? 'page' : undefined" @click="section = item.id"><small>{{ item.index }}</small>{{ item.name }}</button><details class="online-capabilities"><summary>在线版说明</summary><p>本地模型、语音、独立桌宠窗口和外部代码插件请在桌面版使用。</p></details></nav><div class="work-content"><KeepAlive><Definitions v-if="section === 'profile' || section === 'world'" :key="section" :api="api" :owner="session.user.id" :kind="section" /><Events v-else-if="section === 'events'" :api="api" :owner="session.user.id" /><Planning v-else-if="section === 'planning'" :api="api" :owner="session.user.id" @refresh-wallet="emit('refresh-wallet')" /><Manuscript v-else :api="api" :session="session" @refresh-wallet="emit('refresh-wallet')" /></KeepAlive></div></div></main></template>
