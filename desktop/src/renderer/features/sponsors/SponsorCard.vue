<script setup lang="ts">
import { sponsor } from './sponsor'
import sponsorLogo from '../../assets/sponsors/fastaitoken.png'
defineProps<{ compact?: boolean }>()
</script>

<template>
  <section class="sponsor-card" :class="{ 'sponsor-card--compact': compact }" aria-label="FastAIToken 赞助推广" data-testid="sponsor-card">
    <div class="sponsor-brand">
      <span class="sponsor-label">赞助推广</span>
      <a class="sponsor-name" :href="sponsor.url" target="_blank" rel="noopener noreferrer sponsored"><img :src="sponsorLogo" alt="FastAIToken Logo" width="48" height="48"><span>{{ sponsor.name }}</span><span class="sponsor-arrow" aria-hidden="true">↗</span></a>
      <span class="sponsor-category">AI API 聚合平台</span>
    </div>
    <div class="sponsor-copy">
      <p v-if="!compact" class="sponsor-thanks">感谢 FastAIToken 对岚笺的支持。</p>
      <p>{{ sponsor.description }}</p>
      <a class="sponsor-action" :href="sponsor.url" target="_blank" rel="noopener noreferrer sponsored">{{ sponsor.action }}<span aria-hidden="true">↗</span></a>
      <p class="sponsor-note">第三方服务，模型与价格以平台说明为准；充值不计入岚笺站内积分。</p>
    </div>
  </section>
</template>

<style scoped>
.sponsor-card { display:grid; grid-template-columns:minmax(160px, .7fr) minmax(0, 2fr); gap:24px; padding:24px; border:1px solid var(--line, #d8d6cf); border-inline-start:3px solid var(--jade, #287a68); background:var(--surface, #faf9f5); color:var(--ink, #1d2220); font:14px/1.75 var(--sans, sans-serif); }
.sponsor-brand { display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:8px; min-width:0; }
.sponsor-label { font-size:12px; color:var(--muted, #676e69); }
.sponsor-name { display:inline-flex; flex-wrap:wrap; align-items:center; gap:8px; color:var(--ink, #1d2220); font-size:20px; font-weight:700; letter-spacing:-.5px; text-decoration:none; }
.sponsor-name img { width:48px; height:48px; object-fit:contain; flex:none; background:#fff; border-radius:4px; }
.sponsor-name .sponsor-arrow { color:var(--jade, #287a68); font-size:16px; font-weight:400; }
.sponsor-category { color:var(--muted, #676e69); font-size:12px; }
.sponsor-copy { min-width:0; }
.sponsor-copy p { margin:0; }
.sponsor-copy .sponsor-thanks { margin-bottom:6px; font-weight:600; }
.sponsor-action { display:inline-flex; align-items:center; justify-content:space-between; gap:16px; min-height:38px; margin-top:12px; padding:5px 12px; border:1px solid var(--jade, #287a68); color:var(--jade, #287a68); text-decoration:none; font-weight:600; }
.sponsor-action:hover { background:var(--surface-muted, #edf0ea); }
.sponsor-copy .sponsor-note { margin-top:10px; font-size:12px; line-height:1.6; color:var(--muted, #676e69); }
.sponsor-card a:focus-visible { outline:2px solid var(--jade, #287a68); outline-offset:4px; }
.sponsor-card--compact { padding:16px 20px; gap:20px; }
.sponsor-card--compact .sponsor-name { font-size:18px; }
@container library-settings (max-width:580px) { .sponsor-card { grid-template-columns:minmax(0,1fr); gap:16px; padding:18px; } }
@media(max-width:760px) { .sponsor-card { grid-template-columns:minmax(0,1fr); gap:16px; padding:18px; } }
</style>
