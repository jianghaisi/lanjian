<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { boolean, record } from '@lanjian/hosted-contracts'
import BrandLogo from '../../../desktop/src/renderer/ui/BrandLogo.vue'
import { http, ApiError, messageOf } from '../api/http'
import { loginDestination, rememberLoginDestination } from './destination'
import LanjianLoginCompanion from './LanjianLoginCompanion.vue'
import './login.css'
const ready = ref(false), checked = ref(false), error = ref(''), busy = ref(false)
const hovered = ref(false), keyboardFocus = ref(false)
const attentive = computed(() => hovered.value || keyboardFocus.value)
const outcome = new URLSearchParams(location.search).get('login')
const failed = outcome === 'failed' || outcome === 'cancelled'
async function check() {
  checked.value = false; ready.value = false; error.value = ''
  try { const session = await http.me(); if (session) { location.replace(loginDestination()); return } }
  catch (e) { if (!(e instanceof ApiError && e.status === 401)) { error.value = messageOf(e); return } }
  try { ready.value = boolean(record(await http.request('/api/site')).loginConfigured); checked.value = true }
  catch (e) { error.value = messageOf(e) }
}
function start() { if (!ready.value || busy.value) return; busy.value = true; rememberLoginDestination(); location.assign('/api/auth/linuxdo/start') }
onMounted(check)
</script>
<template>
  <main class="login-screen">
    <section class="login-art">
      <a href="/" class="login-brand" aria-label="岚笺项目介绍"><BrandLogo /></a>
      <div class="login-art-title"><p>LANJIAN / 一起写下去</p><h2>故事里的人，<br>已经在等你了。</h2></div>
      <LanjianLoginCompanion :focused="attentive" />
      <div class="login-art-floor"><span>从一页空白，到一个完整的世界。</span><span>岚笺 · V3</span></div>
    </section>
    <section class="login-content">
      <a href="/" class="login-back" aria-label="返回项目介绍"><span class="login-back-arrow" aria-hidden="true">↖</span><span><small>EXPLORE LANJIAN</small>项目介绍</span><i aria-hidden="true"></i></a>
      <div class="login-form">
        <p class="login-overline">YOUR NEXT CHAPTER</p><h1>欢迎回来。</h1>
        <button v-if="ready" class="linuxdo-login" :disabled="busy" @click="start" @pointerenter="hovered = true" @pointerleave="hovered = false" @focus="keyboardFocus = true" @blur="keyboardFocus = false" aria-label="使用 Linux DO 登录"><span class="login-button-label"><small>YOUR STORY STARTS HERE</small><span>{{ busy ? '正在前往 Linux DO…' : '使用 Linux DO 登录' }}</span></span><span class="login-button-arrow" aria-hidden="true">↗</span></button>
        <p v-else-if="checked" class="login-message" role="status">登录暂未开放，请稍后再来。</p>
        <p v-else-if="!error" class="login-message" role="status">正在确认登录状态…</p>
        <p v-if="error" class="login-message error" role="alert">{{ error }} <button @click="check">重新读取</button></p>
        <p v-if="failed" class="login-message" role="status">{{ outcome === 'cancelled' ? '你已取消授权，准备好后可以重新登录。' : '这次登录未完成，请重新授权。' }}</p>
        <a href="/app?guest=1" class="guest-entry"><span>以游客身份进入<small>只读浏览完整样书</small></span><span aria-hidden="true">↗</span></a>
        <div class="login-welcome"><span>10<small>积分</small></span><div><b>送给你的第一段故事</b><p>首次登录赠送。</p></div></div>
      </div>
    </section>
  </main>
</template>
