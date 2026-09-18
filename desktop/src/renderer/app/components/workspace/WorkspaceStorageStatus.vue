<script setup lang="ts">
defineProps<{ label?: string; state?: string }>()
</script>
<template>
  <span class="workspace-storage-status" :class="state" data-testid="workspace-storage-status"><span class="storage-location" title="作品保存在本机"><i aria-hidden="true"></i>本地</span><span v-if="label" class="storage-save-label" :role="state === 'error' ? 'alert' : 'status'"><span aria-hidden="true">·</span>{{ label }}</span></span>
</template>
<style>
.workspace-storage-status { display:inline-flex;align-items:center;gap:.5rem;min-inline-size:0;color:var(--color-muted);font:400 .75rem/1.4 var(--sans);letter-spacing:0; }
.workspace-storage-status :is(.storage-location,.storage-save-label) { display:inline-flex;align-items:center;gap:.375rem; }
.workspace-storage-status .storage-location { flex:none; }
.workspace-storage-status .storage-location>i { width:6px;height:6px;flex:none;border-radius:50%;background:var(--color-jade);box-shadow:none; }
.workspace-storage-status.error .storage-save-label { color:var(--color-danger); }
.workspace-storage-status :is(.storage-location,.storage-save-label) { font:inherit; }
</style>
