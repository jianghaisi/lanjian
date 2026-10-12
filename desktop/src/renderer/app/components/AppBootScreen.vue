<script setup lang="ts">
import CinematicBoot from './boot/CinematicBoot.vue'
import ImpactBoot from './boot/ImpactBoot.vue'
defineOptions({ inheritAttrs: false })
defineProps<{ bootStyle?: 'cinematic' | 'impact' | 'brief' }>()
</script>

<template>
  <ImpactBoot v-if="bootStyle==='impact'" v-bind="$attrs" theme="impact" />
  <CinematicBoot v-else v-bind="$attrs" :boot-style="bootStyle" />
</template>
