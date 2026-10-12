<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NConfigProvider, NMessageProvider, zhCN, dateZhCN, type GlobalThemeOverrides } from 'naive-ui'
import { http, ApiError, messageOf, type Session } from '../api/http'
import Admin from './Admin.vue'
import './admin.css'
const session = ref<Session | null>(null), error = ref(''), loading = ref(true)
const theme: GlobalThemeOverrides = {
  common: { primaryColor: '#815128', primaryColorHover: '#98612d', primaryColorPressed: '#66401e', successColor: '#28643e', warningColor: '#80530c', errorColor: '#ae3248', textColor3: '#62605a', borderRadius: '4px', bodyColor: '#f3f1ec', cardColor: '#faf9f6', tableColor: '#faf9f6', fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif' },
  DataTable: { thColor: '#f0eee8', tdColor: '#faf9f6', tdColorHover: '#f1ede5', thFontWeight: '500' },
  Menu: { itemTextColor: '#c9c2b7', itemTextColorHover: '#f5dec2', itemTextColorActive: '#efbf85', itemTextColorActiveHover: '#efbf85', itemIconColor: '#b9b0a3', itemIconColorHover: '#efbf85', itemIconColorActive: '#efbf85', itemIconColorActiveHover: '#efbf85', itemColorHover: '#ffffff0a', itemColorActive: '#e9b87912', itemColorActiveHover: '#e9b8791c' }
}
http.onExpired = () => { session.value = null; error.value = '登录已过期，请重新登录。' }
async function load() { loading.value = true; error.value = ''; try { session.value = await http.me() } catch (e) { if (e instanceof ApiError && e.status === 401) location.replace('/login?next=%2Fadmin'); else error.value = messageOf(e) } finally { loading.value = false } }
onMounted(load)
</script>
<template><NConfigProvider :theme-overrides="theme" :locale="zhCN" :date-locale="dateZhCN"><NMessageProvider><Admin v-if="session?.user.role === 'admin'" :session="session" /><main v-else class="page-status"><template v-if="loading"><p role="status">正在核对管理员身份…</p></template><template v-else-if="error"><h1>暂时无法打开后台</h1><p role="alert">{{ error }}</p><a href="/login?next=%2Fadmin">重新登录</a><button @click="load">重试</button></template><template v-else-if="session"><h1>此页面需要管理员权限。</h1><a href="/app">返回创作</a></template></main></NMessageProvider></NConfigProvider></template>
