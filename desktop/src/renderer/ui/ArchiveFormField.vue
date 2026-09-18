<script setup lang="ts">
defineProps<{ label: string; help?: string; error?: string }>()
</script>

<template>
  <label class="archive-form-field">
    <span class="archive-field-label">{{ label }}</span>
    <slot />
    <small v-if="error || help" :class="{ 'archive-field-error': error }" :role="error ? 'alert' : undefined">{{ error || help }}</small>
  </label>
</template>
