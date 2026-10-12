<script setup lang="ts">
withDefaults(defineProps<{ eyebrow: string; title: string; description?: string; variant?: 'page' | 'display' }>(), { variant: 'page' })
</script>

<template>
  <header class="archive-page-heading" :style="{ '--page-heading-size': variant === 'display' ? 'var(--type-display)' : 'var(--type-page-title)' }">
    <div class="archive-page-heading-copy">
      <p :key="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <h2 :key="title">{{ title }}</h2>
      <p v-if="description" :key="description" class="archive-page-description">{{ description }}</p>
      <slot name="context" />
    </div>
    <div v-if="$slots.default" class="archive-page-heading-actions"><slot /></div>
  </header>
</template>

<style scoped>
.archive-page-heading-copy>.eyebrow{animation:archive-heading-arrive 180ms ease-out both}
.archive-page-heading-copy>h2{animation:archive-heading-arrive 240ms cubic-bezier(.2,.8,.2,1) 25ms both}
.archive-page-heading-copy>.archive-page-description{animation:archive-heading-arrive 240ms ease-out 55ms both}
@keyframes archive-heading-arrive{from{opacity:0;translate:0 6px}to{opacity:1;translate:0 0}}
@media(prefers-reduced-motion:reduce){.archive-page-heading-copy>:is(.eyebrow,h2,.archive-page-description){animation:none}}
</style>
