<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { NButton, NDataTable, NDrawer, NDrawerContent, NInput, NSelect, NSpace, NTag, NPopconfirm, type DataTableColumns } from 'naive-ui'
import { integer, record, text, uuid, type LedgerView } from '@lanjian/hosted-contracts'
import { http, messageOf } from '../api/http'
import { points } from '../api/writing'
import { getUsers, list, receiptKey, units, type AdminUser } from './api'
const users = ref<AdminUser[]>([]), query = ref(''), filter = ref('all'), page = ref(1), pageSize = ref(10)
const chosen = ref<AdminUser>(), drawer = ref(false), amount = ref('10'), note = ref('体验积分')
const entries = ref<LedgerView[]>([]), busy = ref(false), error = ref(''), notice = ref('')
const filtered = computed(() => users.value.filter(u => {
  const needle = query.value.trim().toLocaleLowerCase()
  return (!needle || [u.name, u.username, u.subject, u.id].some(value => value.toLocaleLowerCase().includes(needle))) && (filter.value === 'all' || filter.value === 'admin' && u.role === 'admin' || filter.value === 'disabled' && u.disabled || filter.value === 'active' && !u.disabled)
}))
watch([query, filter], () => { page.value = 1 })
async function run(work: () => Promise<void>) { if (busy.value) return; busy.value = true; error.value = ''; notice.value = ''; try { await work() } catch (e) { error.value = messageOf(e) } finally { busy.value = false } }
async function refresh() { users.value = await getUsers(); if (chosen.value) chosen.value = users.value.find(u => u.id === chosen.value!.id) }
async function history(id: string) {
  entries.value = list(record(await http.request(`/api/admin/users/${id}/credits`)).entries, value => {
    const p = record(value)
    return { id: uuid(p.id), kind: text(p.kind, 40), amount: integer(p.amount, -1e12), note: text(p.note, 200, 0), createdAt: integer(p.createdAt, 0, Number.MAX_SAFE_INTEGER) }
  })
}
async function select(user: AdminUser) { await run(async () => { await history(user.id); chosen.value = user; drawer.value = true }) }
async function grant() { await run(async () => {
  if (!chosen.value) return
  const input = { userId: chosen.value.id, amount: units(amount.value), note: note.value }
  await http.request('/api/admin/credits', 'POST', { ...input, operation: receiptKey(input) })
  notice.value = '积分已发放。相同账户、数量与备注的重复提交会复用回执；再次发放请填写新的备注。'
  try { await refresh(); await history(input.userId) } catch { notice.value += ' 明细刷新失败，请刷新列表。' }
}) }
async function status(user: AdminUser) { await run(async () => { await http.request(`/api/admin/users/${user.id}/status`, 'PUT', { disabled: !user.disabled }); notice.value = user.disabled ? '账户已恢复。' : '账户已停用，现有会话已撤销。'; await refresh() }) }
const columns: DataTableColumns<AdminUser> = [
  { title: '用户', key: 'name', minWidth: 190, render: u => h('div', { class: 'user-cell' }, [h('span', { class: 'user-avatar', 'aria-hidden': 'true' }, (u.name || u.username).slice(0, 1)), h('div', [h('b', u.name || u.username), h('small', `@${u.username}`)])]) },
  { title: 'Linux DO ID', key: 'subject', width: 130 },
  { title: '角色', key: 'role', width: 100, render: u => h(NTag, { type: u.role === 'admin' ? 'warning' : 'default', bordered: false, size: 'small' }, () => u.role === 'admin' ? '管理员' : '用户') },
  { title: '状态', key: 'disabled', width: 95, render: u => h(NTag, { type: u.disabled ? 'error' : 'success', bordered: false, size: 'small' }, () => u.disabled ? '已停用' : '正常') },
  { title: '可用积分', key: 'available', width: 125, sorter: (a, b) => a.wallet.available - b.wallet.available, render: u => points(u.wallet.available) },
  { title: '预留积分', key: 'reserved', width: 115, render: u => points(u.wallet.reserved) },
  { title: '操作', key: 'actions', width: 215, fixed: 'right', render: u => h(NSpace, { size: 12 }, () => [
    h(NButton, { text: true, type: 'primary', disabled: busy.value, onClick: () => select(u) }, () => '积分明细 / 发放'),
    h(NPopconfirm, { onPositiveClick: () => status(u), disabled: u.role === 'admin' || busy.value }, {
      trigger: () => h(NButton, { text: true, type: u.disabled ? 'primary' : 'error', disabled: busy.value || u.role === 'admin' }, () => u.disabled ? '恢复' : '停用'),
      default: () => u.disabled ? `恢复 ${u.name} 的账户？` : `停用 ${u.name} 并撤销现有会话？作品与积分会保留。`
    })
  ]) }
]
onMounted(() => run(refresh))
</script>
<template>
  <section class="users-management">
    <div class="admin-page-heading"><div><p class="admin-breadcrumb">账户管理 / 用户与积分</p><h1>用户与积分</h1><p>查看账户状态、积分余额与发放记录。新身份首次登录赠送 10 积分。</p></div><NButton :loading="busy" @click="run(refresh)">刷新列表</NButton></div>
    <p v-if="error && !drawer" class="operator-alert error" role="alert">{{ error }}</p><p v-if="notice && !drawer" class="operator-alert success" role="status">{{ notice }}</p>
    <section class="admin-filter-panel" aria-label="筛选用户"><label>搜索用户<NInput v-model:value="query" placeholder="用户名、昵称或 Linux DO ID" clearable :input-props="{ 'aria-label': '搜索用户' }" /></label><label>账户状态<NSelect v-model:value="filter" :options="[{label:'全部用户',value:'all'},{label:'正常账户',value:'active'},{label:'已停用',value:'disabled'},{label:'管理员',value:'admin'}]" aria-label="账户状态" /></label><NButton @click="query = ''; filter = 'all'">重置</NButton></section>
    <section class="admin-table-panel" aria-label="用户列表"><header><h2>用户列表 <span>{{ filtered.length }}</span></h2><small>已加载 {{ users.length }} 位用户，最多展示最近 500 位</small></header><NDataTable :columns="columns" :data="filtered" :loading="busy" :row-key="(u: AdminUser) => u.id" :scroll-x="970" :bordered="false" :pagination="{ page, pageSize, showSizePicker: true, pageSizes: [10,20,50], prefix: ({ itemCount }) => `共 ${itemCount} 位用户` }" @update:page="page = $event" @update:page-size="pageSize = $event; page = 1" /></section>
    <NDrawer v-model:show="drawer" :width="520" style="max-width:100vw" :close-on-esc="!busy" :mask-closable="!busy"><NDrawerContent :title="`${chosen?.name || '用户'} · 积分管理`" :closable="!busy"><div class="operator-legacy"><p v-if="error" class="operator-alert error" role="alert">{{ error }}</p><p v-if="notice" class="operator-alert success" role="status">{{ notice }}</p><div class="credit-summary"><div><small>可用积分</small><strong>{{ chosen ? points(chosen.wallet.available) : '—' }}</strong></div><div><small>预留积分</small><strong>{{ chosen ? points(chosen.wallet.reserved) : '—' }}</strong></div></div><form @submit.prevent="grant"><fieldset :disabled="busy"><h3>手动发放积分</h3><label>积分数量<input v-model="amount" inputmode="decimal" required></label><label>发放备注<input v-model="note" maxlength="200" required></label><NButton type="primary" attr-type="submit" :loading="busy">确认发放积分</NButton></fieldset></form><h3>最近 100 条流水</h3><ul class="admin-ledger"><li v-for="entry in entries" :key="entry.id"><span>{{ entry.note || entry.kind }}<small>{{ new Date(entry.createdAt).toLocaleString() }}</small></span><b>{{ entry.amount > 0 ? '+' : '' }}{{ points(entry.amount) }}</b></li></ul><p v-if="!entries.length">暂无积分流水。</p></div></NDrawerContent></NDrawer>
  </section>
</template>
