<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DesktopApi } from '../../../../contracts'
import type { ModelProfile } from '../../../../contracts/models/types'
import type { GlobalConnectionsView } from '../../../../contracts/models/model-connections'
import { buildModelCatalog,type ModelCatalogChoice } from '../../models/services/model-catalog'
import { decodeGroupProfile } from '../../../../contracts/group-chat/group-chat'
import type { LocalModelView } from '../../../../contracts/models/local-model-contracts'
import ModelCatalogPicker from '../../models/components/ModelCatalogPicker.vue'
const props=defineProps<{api:DesktopApi;modelValue:ModelProfile|null;disabled?:boolean;visible:boolean}>()
const emit=defineEmits<{ 'update:modelValue':[ModelProfile] }>()
const local=ref<LocalModelView[]>([])
const catalog=ref<GlobalConnectionsView>(),models=ref<Record<string,string[]>>({}),error=ref('')
const choices=computed(()=>buildModelCatalog(catalog.value?.connections??[],models.value,props.modelValue?[props.modelValue]:[],local.value))
function choose(choice:ModelCatalogChoice|null){if(choice)emit('update:modelValue',decodeGroupProfile({connectionId:choice.connectionId,model:choice.model,parameterPolicy:{version:2,mode:'auto'}}))}
async function refresh(){try{const result=await props.api.groupChat.modelCatalog();catalog.value=result.connections;models.value=result.models;if(props.api.app.platform!=='browser')local.value=await props.api.localModels.list()}catch{error.value='模型列表无法读取，请在模型设置中核对接口。'}}
watch(()=>props.visible,visible=>{if(visible)void refresh()},{immediate:true})
</script>
<template><div><ModelCatalogPicker :choices="choices" :connections="catalog?.connections || []" :model="modelValue?.model" :connection-id="modelValue?.connectionId" label="提取模型" :disabled="disabled" allow-hosted-selection :allow-manual="api.app.platform !== 'browser'" @select="choose"/><button type="button" :disabled="disabled" @click="refresh">刷新模型</button><p v-if="error" role="alert">{{ error }}</p></div></template>
