<script setup lang="ts">
import { computed, useId } from 'vue'
const props = defineProps<{ label: string; help?: string; error?: string; controlId?: string }>()
const generatedId = useId()
const id = computed(() => props.controlId || `archive-field-${generatedId}`)
const descriptionId = computed(() => `${id.value}-description`)
const controlProps = computed(() => ({ id: id.value, 'aria-describedby': props.error || props.help ? descriptionId.value : undefined, 'aria-invalid': props.error ? true : undefined }))
</script>

<template>
  <label class="archive-form-field">
    <span class="archive-field-label">{{ label }}</span>
    <slot :control-props="controlProps" />
    <small v-if="error || help" :id="descriptionId" :class="{ 'archive-field-error': error }" :role="error ? 'alert' : undefined">{{ error || help }}</small>
  </label>
</template>
