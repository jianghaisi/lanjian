<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'danger'; compact?: boolean; type?: 'button' | 'submit' | 'reset' }>(), { variant: 'secondary', type: 'button' })
</script>

<template>
  <button :type="type" class="control-button archive-action" :class="[variant, { compact }]"><slot /></button>
</template>
