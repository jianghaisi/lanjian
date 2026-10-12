<script setup lang="ts">
import BrandMark from './BrandMark.vue'
</script>
<template>
  <span class="brand-logo" role="img" aria-label="岚笺">
    <BrandMark class="brand-archive-mark" />
    <span class="brand-wordmark" aria-hidden="true">岚笺</span>
    <small class="brand-latin" aria-hidden="true">/ LANJIAN</small>
  </span>
</template>

<style>
.brand-logo { display: inline-flex; align-items: center; gap: .75rem; flex: none; }
.brand-seal { display: grid; place-items: center; width: 32px; height: 34px; background: #a84337; color: #fff8e9; font: 400 25px/1 var(--serif); border-radius: 0; }
.brand-wordmark { color: var(--ink); font: 500 1.3125rem/1 var(--serif); letter-spacing: 0; }
.brand-logo>.brand-archive-mark.lanjian-mark{inline-size:1.75rem;block-size:1.75rem;flex:none;color:var(--ink)}
.brand-latin{font:.6875rem var(--sans);letter-spacing:.14em;color:var(--ink)}
</style>
