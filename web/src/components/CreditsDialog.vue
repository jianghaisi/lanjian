<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { record, decodeWallet, text, integer, type WalletView } from '@lanjian/hosted-contracts'
import { http, messageOf } from '../api/http'
import { array, points } from '../api/writing'
defineEmits<{ close: [] }>()
const wallet = ref<WalletView | null>(null), entries = ref<Array<{ id: string; kind: string; amount: number; note: string; createdAt: number }>>([]), error = ref('')
onMounted(async () => { try { const p = record(await http.request('/api/credits')); wallet.value = decodeWallet(p.wallet); entries.value = array(p.entries).map(value => { const row = record(value); return { id: text(row.id, 100), kind: text(row.kind, 50), amount: integer(row.amount, -1e12, 1e12), note: text(row.note, 500, 0), createdAt: integer(row.createdAt, 0, Number.MAX_SAFE_INTEGER) } }) } catch (e) { error.value = messageOf(e) } })
const labels: Record<string, string> = { welcome: '首次登录赠送', grant: '站长发放', usage: '模型任务消耗', charge: '模型任务消耗', reconcile: '用量核对' }
</script>
<template><div class="modal-backdrop"><section class="paper-card dialog-card" v-dialog="() => $emit('close')" role="dialog" aria-modal="true" aria-label="积分明细"><header><h2>积分明细</h2><button @click="$emit('close')">关闭</button></header><p v-if="error" class="error" role="alert">{{ error }}</p><template v-if="wallet"><p>可用 <b>{{ points(wallet.available) }}</b> 积分 · 预留 {{ points(wallet.reserved) }} 积分</p><p class="muted">新用户首次登录赠送 10 积分。余额不足可联系站长；正在运行或待核对的请求会预留积分。</p><table class="ledger-table"><thead><tr><th>时间</th><th>说明</th><th>积分</th></tr></thead><tbody><tr v-for="entry in entries" :key="entry.id"><td>{{ new Date(entry.createdAt).toLocaleString('zh-CN') }}</td><td>{{ labels[entry.kind] || entry.kind }}<small>{{ entry.note }}</small></td><td>{{ entry.amount > 0 ? '+' : '' }}{{ points(entry.amount) }}</td></tr></tbody></table></template><p v-else-if="!error" role="status">正在读取积分…</p></section></div></template>
