<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { DesktopAppApi } from '../../../contracts/core/app-api'
const props = defineProps<{ api: NonNullable<DesktopAppApi['hosted']>; library: boolean }>()
const account = ref<Awaited<ReturnType<typeof props.api.account>>>(), busy = ref(false), error = ref('')
const authenticated = ref<boolean | null>(null), menu = ref<HTMLDetailsElement | null>(null)
function closeMenu() { if (menu.value) { menu.value.open = false; menu.value.querySelector('summary')?.focus() } }
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false
async function refresh() {
  clearTimeout(timer)
  try {
    if (props.api.readOnly) { const result = await props.api.referenceSession?.(); if (!disposed) authenticated.value = result?.authenticated ?? false }
    else { const value = await props.api.account(); if (!disposed) { account.value = value; authenticated.value = true } }
    if (!disposed) error.value = ''
  } catch { if (!disposed) error.value = '账户信息暂时无法读取，请重试。' }
  if (!disposed) timer = setTimeout(() => { if (document.hidden) schedule(); else void refresh() }, 30000)
}
function schedule() { if (!disposed) timer = setTimeout(() => { if (document.hidden) schedule(); else void refresh() }, 30000) }
async function sample() {
  if (busy.value) return; busy.value = true; error.value = ''
  try { const destination = await props.api.copyReference(); if (!disposed) location.assign(destination) }
  catch { if (!disposed) error.value = '副本尚未打开，请重试；重复复制不会覆盖已有修改。' }
  finally { if (!disposed) busy.value = false }
}
async function logout() { if (busy.value) return; busy.value = true; try { await props.api.logout() } catch { if (!disposed) error.value = '退出失败，请重试。' } finally { if (!disposed) busy.value = false } }
onMounted(() => { void refresh() })
onBeforeUnmount(() => { disposed = true; clearTimeout(timer) })
</script>
<template>
  <div class="hosted-account">
    <span v-if="!api.readOnly && account" class="hosted-balance" :title="account.reserved ? `其中 ${(account.reserved / 1000).toFixed(3)} 积分已预留` : '可用于 AI 创作'">{{ ((account.balance - account.reserved) / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 3 }) }} 积分</span>
    <details ref="menu" @keydown.esc.prevent.stop="closeMenu"><summary aria-label="账户与参考书菜单">{{ api.readOnly ? '只读样书' : account?.name || '账户' }} <span aria-hidden="true">⌄</span></summary><div class="hosted-account-menu">
      <span v-if="api.readOnly" class="account-note">公开参考书 · 只读浏览</span>
      <span v-else-if="account" class="account-note">可用 {{ ((account.balance - account.reserved) / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 3 }) }} 积分</span>
      <a v-if="!api.readOnly" href="/app/reference">阅读完整参考书 ↗</a>
      <button v-if="authenticated" type="button" :disabled="busy" @click="sample">{{ busy ? '正在建立副本…' : '复制参考书到我的书库' }}</button>
      <a v-else-if="authenticated === false" href="/login?next=%2Fapp%2Freference">登录后复制到我的书库 ↗</a>
      <span v-else class="account-note" role="status">正在核对登录状态…</span>
      <a href="/api/reference-book/export">下载完整参考书</a>
      <a v-if="account?.admin" href="/admin">站点管理 ↗</a>
      <a href="/">项目介绍 ↗</a>
      <button v-if="authenticated" type="button" :disabled="busy" @click="logout">退出登录</button>
      <small v-if="error" role="alert">{{ error }}<button type="button" @click="refresh">重新读取账户</button></small>
    </div></details>
  </div>
</template>
<style scoped>
.hosted-account { display:flex; align-items:center; gap:14px; font:12px var(--sans); color:var(--muted); padding-inline:8px; }
details { position:relative; } summary { cursor:pointer; list-style:none; color:var(--ink); white-space:nowrap; } summary:focus-visible { outline:2px solid var(--jade); }
.hosted-account-menu { position:absolute; top:calc(100% + 16px); right:0; z-index:100; min-width:190px; display:grid; padding:8px; border:1px solid var(--line-strong); background:var(--surface); box-shadow:0 12px 28px #0002; }
.account-note { padding:8px 12px; line-height:1.5; }
summary { display:flex; align-items:center; min-height:38px; }
@media(max-width:900px) { .hosted-account{padding:0;gap:0;margin-left:auto}.hosted-balance{display:none}summary{min-height:44px}.hosted-account-menu{position:fixed;top:56px;right:8px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 72px);overflow:auto} }
button,a { border:0; background:none; padding:12px; text-align:left; font:inherit; color:var(--ink); text-decoration:none; cursor:pointer; } button:hover,a:hover { background:var(--line); } small { padding:8px; color:var(--danger); }
</style>
