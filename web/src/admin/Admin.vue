<script setup lang="ts">
import { computed, h, onMounted, onBeforeUnmount, ref } from 'vue'
import { NButton, NMenu, type MenuOption } from 'naive-ui'
import { Users, Layers, ClipboardList, Settings, Activity, Menu, LogOut } from '@lucide/vue'
import { integer, record, text, uuid } from '@lanjian/hosted-contracts'
import BrandLogo from '../../../desktop/src/renderer/ui/BrandLogo.vue'
import SoybeanLayout from '../vendor/soybean-admin/materials/libs/admin-layout/index.vue'
import { http, messageOf, type Session } from '../api/http'
import { points } from '../api/writing'
import { list, receiptKey, reservation, units, type Reservation } from './api'
import UsersTable from './UsersTable.vue'
import Models from './Models.vue'
import SiteSettings from './SiteSettings.vue'
const props = defineProps<{ session: Session }>()
const tab = ref('users'), busy = ref(false), error = ref(''), notice = ref(''), pending = ref<Reservation[]>([])
const audit = ref<{ id: string; actor: string; action: string; target: string; createdAt: number }[]>([]), jobs = ref<{ id: string; userId: string; modelId: string; kind: string; status: string; createdAt: number }[]>([]), usage = ref<{ modelId: string; attempts: number; inputTokens: number | null; outputTokens: number | null; unknownUsage: number }[]>([])
const review = ref<Reservation>(), charge = ref('0'), evidence = ref(''), checked = ref(false)
const mobileQuery = matchMedia('(max-width: 850px)'), mobile = ref(mobileQuery.matches), collapsed = ref(mobile.value)
const resize = () => { mobile.value = mobileQuery.matches; collapsed.value = mobile.value }
const names: Record<string,string> = { users:'用户与积分', models:'模型与计费', pending:'待核对用量', settings:'站点设置', activity:'运行记录' }
const title = computed(() => names[tab.value])
const icon = (component: typeof Users) => () => h(component, { size:18, strokeWidth:1.6 })
const menu: MenuOption[] = [ { key:'users',label:names.users,icon:icon(Users) }, { key:'models',label:names.models,icon:icon(Layers) }, { key:'pending',label:names.pending,icon:icon(ClipboardList) }, { key:'settings',label:names.settings,icon:icon(Settings) }, { key:'activity',label:names.activity,icon:icon(Activity) } ]
async function run(work: () => Promise<void>) { if (busy.value) return; busy.value = true; error.value = ''; notice.value = ''; try { await work() } catch (e) { error.value = messageOf(e) } finally { busy.value = false } }
async function logout() { await run(async () => { await http.logout(); location.assign('/login?next=%2Fadmin') }) }
async function loadPending() { pending.value = list(record(await http.request('/api/admin/reservations')).reservations, reservation) }
async function reconcile() { await run(async () => {
  if (!review.value || !checked.value) return
  const input = { amount: units(charge.value), note: evidence.value }, id = review.value.id
  await http.request(`/api/admin/reservations/${id}/reconcile`, 'POST', { ...input, operation: receiptKey({ id, ...input }) }); review.value = undefined; notice.value = '核对已入账，剩余预留已释放。'; await loadPending()
}) }
async function activity() {
  const p = record(await http.request('/api/admin/activity'))
  audit.value = list(p.audit, v => { const r = record(v); return { id: uuid(r.id), actor: text(r.actor, 100), action: text(r.action, 100), target: text(r.target, 150), createdAt: integer(r.createdAt, 0, Number.MAX_SAFE_INTEGER) } })
  jobs.value = list(p.jobs, v => { const r = record(v); return { id: uuid(r.id), userId: uuid(r.userId), modelId: text(r.modelId, 150), kind: text(r.kind, 50), status: text(r.status, 50), createdAt: integer(r.createdAt, 0, Number.MAX_SAFE_INTEGER) } })
  usage.value = list(p.usage, v => { const r = record(v); return { modelId: text(r.modelId, 150), attempts: integer(r.attempts), inputTokens: r.inputTokens === null ? null : integer(r.inputTokens), outputTokens: r.outputTokens === null ? null : integer(r.outputTokens), unknownUsage: integer(r.unknownUsage) } })
}
async function open(name: string) { if (busy.value) return; tab.value = name; error.value = ''; notice.value = ''; if (name === 'pending') await run(loadPending); if (name === 'activity') await run(activity) }

onMounted(() => mobileQuery.addEventListener('change',resize))
onBeforeUnmount(() => mobileQuery.removeEventListener('change',resize))
</script>
<template><div class="operator-shell"><SoybeanLayout v-model:sider-collapse="collapsed" :is-mobile="mobile" :sider-width="238" :sider-collapsed-width="70" :tab-visible="false" :header-height="64" :footer-visible="false" content-class="operator-content" sider-class="operator-sidebar" mobile-sider-class="operator-sidebar" common-class="operator-transition">
<template #sider><div class="operator-brand"><BrandLogo v-if="!collapsed || mobile" /><span v-else>岚</span><small v-if="!collapsed || mobile">站点管理</small></div><NMenu :value="tab" :options="menu" :collapsed="collapsed && !mobile" :collapsed-width="70" :collapsed-icon-size="20" @update:value="value => { void open(value); if (mobile) collapsed = true }" /><div v-if="!collapsed || mobile" class="operator-sidebar-foot"><span class="operator-status-dot"></span> 管理员工作区<p>Linux DO 身份 · 积分与模型</p></div></template>
<template #header><div class="operator-header"><NButton quaternary circle aria-label="折叠或展开管理菜单" @click="collapsed = !collapsed"><Menu :size="20" /></NButton><span class="operator-header-title">站点管理 <b>/</b> {{ title }}</span><div class="operator-account"><a class="operator-home" href="/app">打开创作 ↗</a><span>{{ props.session.user.name || props.session.user.username }}</span><small>管理员</small><NButton quaternary :disabled="busy" aria-label="退出登录" @click="logout"><LogOut :size="17" /></NButton></div></div></template>
<div class="operator-body"><p v-if="error" role="alert" class="operator-alert error">{{ error }}</p><p v-if="notice" role="status" class="operator-alert success">{{ notice }}</p><UsersTable v-if="tab === 'users'" /><div v-else class="operator-legacy"><div class="admin-page-heading"><div><p class="admin-breadcrumb">站点管理 / {{ title }}</p><h1>{{ title }}</h1></div><span v-if="busy" role="status">正在处理…</span></div><Models v-if="tab === 'models'" /><SiteSettings v-else-if="tab === 'settings'" /><section v-else-if="tab === 'pending'" class="admin-section"><header><h2>待核对用量</h2><button :disabled="busy" @click="run(loadPending)">刷新预留</button></header><p>正常执行中的预留会自动结算。只有上游结果不确定的记录允许人工核对；请先对照供应商账单与任务记录。</p><p v-if="!pending.length && !busy" class="paper-card">当前没有待处理的预留。</p><article v-for="r in pending" :key="r.id" class="paper-card admin-user"><div><b>{{ r.modelId }} · {{ points(r.amount) }} 积分</b><small>账户 {{ r.userId }}</small><small>预留 {{ r.id }} · 计费版本 {{ r.priceVersion }} · {{ r.status }}</small></div><button :disabled="busy || r.status !== 'unknown'" @click="review = r; charge = '0'; evidence = ''; checked = false">核对结算</button></article><form v-if="review" class="paper-card" @submit.prevent="reconcile"><h3>核对 {{ review.id }}</h3><fieldset :disabled="busy"><label>确认应扣积分（最多 {{ points(review.amount) }}）<input v-model="charge" inputmode="decimal" required></label><label>核对依据<input v-model="evidence" required maxlength="200" placeholder="供应商流水编号或核对说明"></label><label class="check-label"><input v-model="checked" type="checkbox" required>已查证本次用量，同意按上述金额入账</label><button class="primary" :disabled="!checked">确认结算</button><button type="button" @click="review = undefined">取消</button></fieldset></form></section><section v-else class="admin-section"><header><h2>运行记录</h2><button :disabled="busy" @click="run(activity)">刷新记录</button></header><h3>最近 24 小时模型用量</h3><p v-if="!usage.length">尚无调用记录。</p><div class="admin-scroll"><table v-if="usage.length"><thead><tr><th>模型</th><th>调用</th><th>已知输入 / 输出 tokens</th><th>未知用量</th></tr></thead><tbody><tr v-for="u in usage" :key="u.modelId"><td>{{ u.modelId }}</td><td>{{ u.attempts }}</td><td>{{ u.inputTokens ?? '—' }} / {{ u.outputTokens ?? '—' }}</td><td>{{ u.unknownUsage }}</td></tr></tbody></table></div><h3>最近 100 个任务</h3><p v-if="!jobs.length">尚无任务。</p><ul class="admin-ledger"><li v-for="j in jobs" :key="j.id"><span>{{ j.modelId }} / {{ j.kind }} / {{ j.status }}<small>{{ j.id }} · {{ new Date(j.createdAt).toLocaleString() }}</small></span></li></ul><h3>最近 100 条管理审计</h3><ul class="admin-ledger"><li v-for="a in audit" :key="a.id"><span>{{ a.action }}<small>操作者 {{ a.actor }} · 对象 {{ a.target }}</small></span><small>{{ new Date(a.createdAt).toLocaleString() }}</small></li></ul></section></div></div></SoybeanLayout></div></template>
