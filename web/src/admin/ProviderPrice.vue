<script setup lang="ts">
import { tokenRateKeys, type ProviderTokenPolicy, type TokenRateKey } from '@lanjian/hosted-contracts'
const policy = defineModel<ProviderTokenPolicy>('policy', { required: true })
const labels: Record<TokenRateKey, string> = { input: '普通输入', output: '输出（含推理）', cacheRead: '缓存命中', cacheWrite: '缓存写入 / 5 分钟', cacheWrite1h: '缓存写入 / 1 小时', audioInput: '音频输入' }
</script>

<template>
  <section class="provider-price" aria-label="供应商成本费率">
    <div class="form-row"><label>渠道 / 分组名称<input v-model="policy.groupName" required maxlength="80"></label><label>渠道倍率<input v-model="policy.groupMultiplier" inputmode="decimal" required></label></div>
    <div class="form-row"><label>1 美元余额折合人民币<input v-model="policy.usdToCny" inputmode="decimal" required></label><label>每元人民币折合积分<input v-model="policy.pointsPerCny" inputmode="decimal" required></label></div>
    <div class="price-tiers"><table>
      <caption>供应商美元 / 百万 tokens（乘分组倍率前）</caption>
      <thead><tr><th scope="col">用量</th><th v-for="tier in policy.tiers" :key="tier.name" scope="col">{{ tier.name }}<small>{{ tier.through === null ? '其余上下文' : `上下文 ≤ ${tier.through.toLocaleString()}` }}</small></th></tr></thead>
      <tbody><tr v-for="key in tokenRateKeys.filter(k => policy.tiers.some(t => t.rates[k] !== undefined))" :key="key"><th scope="row">{{ labels[key] }}</th><td v-for="tier in policy.tiers" :key="tier.name"><input v-if="tier.rates[key] !== undefined" v-model="tier.rates[key]" :aria-label="`${tier.name} ${labels[key]}`" inputmode="decimal" required><span v-else>包含在输入中</span></td></tr></tbody>
    </table></div>
    <p>按实际用量乘分组倍率后折算积分，每次调用仅在最后向上取整到 0.001 积分。缺少可靠用量时保留预留金额，待核对。</p>
    <label>费率来源 / 备注<input v-model="policy.sourceVersion" required maxlength="128"></label>
    <p class="muted">保存后生成新的计费版本，已受理任务保留原费率。</p>
  </section>
</template>

<style scoped>
.provider-price{min-width:0}.price-tiers{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.78rem}caption{text-align:left;margin-bottom:.6rem}th,td{text-align:left;padding:.6rem;border-bottom:1px solid var(--line);white-space:nowrap}small{display:block;font-weight:400;margin-top:.3rem}.muted{overflow-wrap:anywhere}
</style>
