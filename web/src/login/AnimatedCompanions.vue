<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import AnimatedCharacters from '../vendor/animatedlogin-react/AnimatedCharacters.jsx'
const props = defineProps<{ focused: boolean; failed: boolean }>()
const host = ref<HTMLElement>()
let root: Root | undefined
const render = () => root?.render(createElement(AnimatedCharacters, { isTyping: props.focused, loginFailed: props.failed }))
onMounted(() => { root = createRoot(host.value!); render() })
watch(() => [props.focused, props.failed], render)
onBeforeUnmount(() => root?.unmount())
</script>
<template><div ref="host" class="login-companions" aria-hidden="true"></div></template>
