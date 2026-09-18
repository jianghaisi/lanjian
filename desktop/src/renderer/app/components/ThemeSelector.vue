<script setup lang="ts">
import { themeChoices, type ThemeChoice } from '../composables/theme-preferences'
defineProps<{ modelValue: ThemeChoice; error?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: ThemeChoice] }>()
</script>

<template>
  <section class="theme-settings" data-testid="theme-settings">
    <header><h3>主题</h3><span role="status">{{ error ? '尚未保存' : '自动保存' }}</span></header>
    <div v-assist-field="{id:'ThemeSelector.theme',read:()=>modelValue,write:value=>emit('update:modelValue',value as ThemeChoice),options:()=>themeChoices.map(item=>item.id)}" class="theme-choices" role="radiogroup" aria-label="应用主题">
      <label v-for="item in themeChoices" :key="item.id" class="theme-choice" :class="{ selected: modelValue === item.id }" :data-preview-theme="item.id">
        <input type="radio" name="app-theme" :value="item.id" :checked="modelValue === item.id" :data-testid="`theme-${item.id}`" @change="emit('update:modelValue', item.id)">
        <span class="theme-mini" aria-hidden="true"><i class="mini-title"></i><i class="mini-nav"></i><span class="mini-lines"><i></i><i></i><i></i><i></i></span></span>
        <span class="theme-name">{{ item.label }}</span>
      </label>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
