<script setup lang="ts">
import { ref, watch } from 'vue'
const props=defineProps<{volume:number;title:string}>()
const emit=defineEmits<{rename:[value:string]}>()
const draft=ref(props.title)
let submitted=props.title
function save(){if(draft.value.trim()){submitted=draft.value;emit('rename',draft.value)}}
watch(()=>props.title,value=>{if(draft.value===submitted||draft.value===value)draft.value=value})
</script>
<template><span class="outline-volume-name"><input v-assist-field="{id:'OutlineVolumeName.title',read:()=>draft,write:value=>{draft=String(value)},identity:()=>volume,label:()=>`第 ${volume} 卷卷名`}" v-model="draft" maxlength="120" :aria-label="`第 ${volume} 卷卷名`" @click.stop @keydown.stop @change="save"><button v-if="draft!==title" type="button" @click.stop="save">保存卷名</button></span></template>
