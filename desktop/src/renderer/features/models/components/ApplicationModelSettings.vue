<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { FieldAssistantApi } from '../../../../contracts/assistant/field-assistant-contracts'
const props=defineProps<{api:FieldAssistantApi}>()
const baseUrl=ref(''),model=ref(''),apiKey=ref(''),configured=ref(false),busy=ref(false),error=ref(''),saved=ref(false)
onMounted(async()=>{try{const config=await props.api.applicationModel();baseUrl.value=config.baseUrl;model.value=config.model;configured.value=config.apiKeyConfigured}catch{error.value='应用模型设置暂时无法读取。'}})
async function save(){busy.value=true;error.value='';saved.value=false;try{const config=await props.api.saveApplicationModel({baseUrl:baseUrl.value,model:model.value,...(apiKey.value?{apiKey:apiKey.value}:{})});apiKey.value='';configured.value=config.apiKeyConfigured;saved.value=true}catch{error.value='模型设置未保存，请检查接口地址和系统安全存储。'}finally{busy.value=false}}
</script>
<template><details class="field-model-options"><summary>{{ configured?'应用模型已配置':'配置应用模型' }}</summary><p>供作品库与新建表单使用；作品内仍使用本书接口。</p><label>接口地址<input v-model="baseUrl" data-assistant-protected="endpoint" autocomplete="url" placeholder="https://…/v1"></label><label>模型名称<input v-model="model" data-assistant-protected="assistant-model-setting" autocomplete="off"></label><label>密钥<input v-model="apiKey" data-assistant-protected="credential" type="password" autocomplete="new-password" :placeholder="configured?'已安全保存，留空不修改':'保存在本机安全存储'"></label><p v-if="error" class="field-assistant-error" role="alert">{{ error }}</p><p v-if="saved" role="status">应用模型设置已保存。</p><button class="control-button secondary" type="button" :disabled="busy||!baseUrl||!model" @click="save">保存应用模型</button></details></template>
