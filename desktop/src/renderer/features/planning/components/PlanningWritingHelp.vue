<script setup lang="ts">
const props = defineProps<{ kind: string; empty: boolean; disabled?: boolean }>()
const emit = defineEmits<{ insert: [text: string] }>()
const guides: Record<string, { title: string; prompt: string; example: string; template: string }> = {
  total: { title: '总纲写什么', prompt: '主角想要什么？什么阻止了他？经历哪些转折，最终走向哪里？', example: '主角为寻找亲人进入陌生城镇，逐步发现失踪案背后的规则，最终决定打破它。', template: '# 故事核心\n\n## 主角与目标\n\n## 主要冲突\n\n## 关键转折\n\n## 最终结局\n' },
  volume: { title: '卷纲写什么', prompt: '这一卷要解决什么问题？冲突如何升级？卷末发生什么变化？', example: '从互不信任，到共同经历危机后决定合作。卷末找到线索，但尚未揭开真相。', template: '# 本卷目标\n\n## 开始时的局面\n\n## 冲突与关键事件\n\n## 人物变化\n\n## 卷末落点\n' },
  stage: { title: '阶段纲写什么', prompt: '这一段剧情从哪里开始，经历什么转折，到哪里结束？', example: '调查从一封匿名信开始，到找到见证者结束；这一阶段不揭示幕后者。', template: '# 进入状态\n\n## 阶段目标\n\n## 冲突与转折\n\n## 退出状态\n' },
  chapter: { title: '章纲写什么', prompt: '谁在什么时间、什么地点？按顺序发生什么？结果如何，本章停在哪里？', example: '两人在图书馆核对旧档案，发现日期矛盾，决定次日调查。本章不提前揭示幕后者。', template: '# 进入状态\n时间：\n人物：\n地点：\n\n## 剧情节点\n1. \n2. \n3. \n\n## 退出状态\n\n## 允许扩写\n\n## 禁止事项\n' }
}
</script>
<template>
  <details class="planning-writing-help" :open="empty">
    <summary>{{ (guides[kind] || guides.chapter).title }}<span>填写提示</span></summary>
    <div><p>{{ (guides[kind] || guides.chapter).prompt }}</p><p class="planning-example"><b>示例</b>{{ (guides[kind] || guides.chapter).example }}</p><button type="button" class="text-action compact" :disabled="disabled" @click="emit('insert', (guides[props.kind] || guides.chapter).template)">在光标处插入提纲</button><small>只插入草稿，可撤销；不会自动保存或确认。</small></div>
  </details>
</template>
