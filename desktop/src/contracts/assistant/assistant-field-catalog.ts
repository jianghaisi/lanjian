import type { FieldSpec } from './field-assistant-contracts'

/** Reviewed static field capabilities. No credentials, paths, approval or prose writes. */
export const assistantFieldCatalog: Readonly<Record<string, FieldSpec>> = {
  'Realm.name': {label:'境界名称',kind:'text',scope:'book',group:'设定',save:'draft',maxLength:200},
  'Realm.description': {label:'境界边界',kind:'text',scope:'book',group:'设定',save:'draft',maxLength:20000},
  'OutlineVolumeName.title': {label:'卷名',kind:'text',scope:'book',group:'谋篇',save:'draft',maxLength:120},
  ...Object.fromEntries(['beats','allowedFacts','forbiddenEvents','characters'].map((field,index)=>[`AppShell.chapter.${field}`, {label:['情节节拍','本章允许事实','本章禁止事件','出场人物'][index],kind:'text' as const,scope:'book' as const,group:'谋篇',save:'draft' as const,maxLength:20000}])),
  'WorldMap.throughPosition':{label:'地图截至章节',kind:'enum',scope:'book',group:'沙盘地图',save:'query'},
  'CharacterAtlas.throughPosition':{label:'人物轨迹截至章节',kind:'enum',scope:'book',group:'人物轨迹',save:'query'},
  'ThemeSelector.theme':{label:'应用主题',kind:'enum',scope:'application',group:'外观',save:'preference'},
  'LibraryAppearance.background':{label:'作品库背景',kind:'enum',scope:'application',group:'外观',save:'preference'},
  'LibraryAppearance.scene':{label:'作品库场景',kind:'enum',scope:'application',group:'外观',save:'preference'},
  'LibraryAppearance.scale':{label:'作品库立绘缩放',kind:'number',min:.7,max:2,step:.01,scope:'application',group:'外观',save:'preference'},
  'LibraryAppearance.inlineOffset':{label:'作品库立绘水平位置',kind:'number',min:-40,max:40,step:1,scope:'application',group:'外观',save:'preference'},
  'LibraryAppearance.blockOffset':{label:'作品库立绘垂直位置',kind:'number',min:-50,max:50,step:1,scope:'application',group:'外观',save:'preference'},
  'Companion.writingMode':{label:'伙伴展示方式',kind:'enum',options:['detailed','chibi','hidden'],scope:'either',group:'写作伙伴',save:'preference'},
  'Companion.intensity':{label:'伙伴动画强度',kind:'number',min:0,max:1,step:.05,scope:'either',group:'写作伙伴',save:'preference'},
  ...Object.fromEntries(['followPointer','autoBlink','stateFeedback','focusAutoHide'].map((field,index)=>[`Companion.${field}`,{label:['跟随鼠标视线','自动眨眼','AI状态反馈','专注模式自动隐藏'][index],kind:'boolean' as const,scope:'either' as const,group:'写作伙伴',save:'preference' as const}])),
  ...Object.fromEntries(['title','time','characters','location','event','result'].map((field,index)=>[`ChronicleEvents.${field}`, {label:['事件标题','时间或阶段','人物','地点','事件经过','结果与后续影响'][index],kind:'text' as const,scope:'book' as const,group:'纪事',save:'draft' as const,maxLength:[200,200,1000,500,20000,20000][index]}])),
  'PlannedChapterEditor.title': {label:'独立章纲标题',kind:'text',scope:'book',group:'谋篇',save:'draft',maxLength:200},
  'PlannedChapterEditor.content': {label:'独立章纲正文',kind:'markdown',scope:'book',group:'谋篇',save:'draft',maxLength:100000},
  "AppShell.chapterTreeQuery": {
    "label": "查找章节",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "query",
    "maxLength": 100000
  },
  "AppShell.outlineChapterSearch": {
    "label": "搜索全部章纲",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "query",
    "maxLength": 100000
  },
  "AppShell.settingsSearch": {
    "label": "搜索设置项",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "query",
    "maxLength": 100000
  },
  "AppShell.foundation.sourceNotes": {
    "label": "素材便签",
    "kind": "markdown",
    "scope": "either",
    "group": "设定",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.ideaDraft.title": {
    "label": "标题",
    "kind": "text",
    "scope": "either",
    "group": "素材",
    "save": "draft",
    "maxLength": 200
  },
  "AppShell.ideaDraft.content": {
    "label": "想法",
    "kind": "markdown",
    "scope": "either",
    "group": "素材",
    "save": "draft",
    "maxLength": 50000
  },
  "AppShell.ideaGenerationInstruction": {
    "label": "本次方向（可选）",
    "kind": "text",
    "scope": "either",
    "group": "素材",
    "save": "draft",
    "maxLength": 2000
  },
  "AppShell.materialSearch": {
    "label": "筛选采风",
    "kind": "text",
    "scope": "either",
    "group": "素材",
    "save": "query",
    "maxLength": 100000
  },
  "AppShell.sourceDraft.title": {
    "label": "资料标题",
    "kind": "text",
    "scope": "either",
    "group": "素材",
    "save": "draft",
    "maxLength": 200
  },
  "AppShell.sourceDraft.url": {
    "label": "来源网址（可选）",
    "kind": "text",
    "scope": "either",
    "group": "素材",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.sourceDraft.author": {
    "label": "作者（可选）",
    "kind": "text",
    "scope": "either",
    "group": "素材",
    "save": "draft",
    "maxLength": 200
  },
  "AppShell.sourceDraft.excerpt": {
    "label": "原始采风摘录",
    "kind": "markdown",
    "scope": "either",
    "group": "素材",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.sourceDraft.userNotes": {
    "label": "作者整理",
    "kind": "markdown",
    "scope": "either",
    "group": "素材",
    "save": "draft",
    "maxLength": 20000
  },
  "AppShell.researchQuery": {
    "label": "关键词与创作方向",
    "kind": "markdown",
    "scope": "either",
    "group": "素材",
    "save": "query",
    "maxLength": 100000
  },
  "AppShell.eventDraft.time": {
    "label": "时间",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.eventDraft.characters": {
    "label": "人物",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.eventDraft.location": {
    "label": "地点",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.eventDraft.event": {
    "label": "事件",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.eventDraft.result": {
    "label": "结果与影响",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.totalOutline": {
    "label": "总纲正文",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.volumeOutline": {
    "label": "卷纲正文",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.stageTitle": {
    "label": "阶段名称",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 120
  },
  "AppShell.stageOutline": {
    "label": "阶段纲正文",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.chapterOutline": {
    "label": "章纲正文",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.volumeDraft": {
    "label": "新卷名称",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 120
  },
  "AppShell.stageDraftTitle": {
    "label": "新阶段名称",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 120
  },
  "AppShell.foreshadowDraft.action": {
    "label": "动作",
    "kind": "enum",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "options": [
      "plant",
      "advance",
      "misdirect",
      "hold",
      "resolve",
      "discard"
    ]
  },
  "AppShell.foreshadowDraft.title": {
    "label": "伏笔名称",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 500
  },
  "AppShell.foreshadowDraft.description": {
    "label": "动作说明",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 5000
  },
  "AppShell.section.content": {
    "label": "接续候选内容",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.continuationVolumeTarget": {
    "label": "目标卷",
    "kind": "enum",
    "scope": "either",
    "group": "当前表单",
    "save": "draft"
  },
  "AppShell.continuationChapterTarget": {
    "label": "目标章节",
    "kind": "enum",
    "scope": "either",
    "group": "当前表单",
    "save": "draft"
  },
  "AppShell.continuationAnalysis.rationale": {
    "label": "接续分析整体判断",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.planningDraft.blueprint.worldView": {
    "label": "世界种子",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.item.name": {
    "label": "名称",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.item.role": {
    "label": "初始角色定位",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.item.arcSeed": {
    "label": "人物弧种子",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.planningDraft.blueprint.powerSystem": {
    "label": "力量体系候选",
    "kind": "markdown",
    "scope": "either",
    "group": "设定",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.planningDraft.blueprint.cheatSystem": {
    "label": "金手指候选",
    "kind": "markdown",
    "scope": "either",
    "group": "设定",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.chapter.entryState": {
    "label": "进入状态",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.chapter.exitState": {
    "label": "退出状态",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.planningDraft.totalOutline.title": {
    "label": "标题",
    "kind": "text",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.planningDraft.totalOutline.summary": {
    "label": "全书走势",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.planningDraft.totalOutline.content": {
    "label": "总纲正文",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.volume.title": {
    "label": "卷名",
    "kind": "text",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.volume.goal": {
    "label": "本卷目标",
    "kind": "text",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.volume.summary": {
    "label": "事件链",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.volume.ending": {
    "label": "卷末状态",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.chapter.title": {
    "label": "章名",
    "kind": "text",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.chapter.coreEvent": {
    "label": "核心事件",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.chapter.location": {
    "label": "地点",
    "kind": "text",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.chapter.result": {
    "label": "章末结果",
    "kind": "markdown",
    "scope": "either",
    "group": "谋篇",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.foundation.worldView": {
    "label": "世界观",
    "kind": "markdown",
    "scope": "either",
    "group": "设定",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.foundation.useRealms": {
    "label": "本书启用明确境界等级",
    "kind": "boolean",
    "scope": "either",
    "group": "设定",
    "save": "draft"
  },
  "AppShell.powerSystem.overview": {
    "label": "力量体系概述",
    "kind": "markdown",
    "scope": "either",
    "group": "设定",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.item.description": {
    "label": "描述",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.foundation.useSystem": {
    "label": "本书启用固定系统界面",
    "kind": "boolean",
    "scope": "either",
    "group": "设定",
    "save": "draft"
  },
  "AppShell.cheatSystem.overview": {
    "label": "金手指概述",
    "kind": "markdown",
    "scope": "either",
    "group": "设定",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.systemTemplate": {
    "label": "系统显示模板",
    "kind": "markdown",
    "scope": "either",
    "group": "设定",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.connection.name": {
    "label": "接口名称",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 80
  },
  "AppShell.ai.shared.temperature": {
    "label": "创造性",
    "kind": "number",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "min": 0,
    "max": 2,
    "step": 0.05
  },
  "AppShell.ai.shared.topP": {
    "label": "采样范围",
    "kind": "number",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "min": 0,
    "max": 1,
    "step": 0.05
  },
  "AppShell.ai.shared.maxTokens": {
    "label": "最大输出",
    "kind": "number",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "min": 128,
    "max": 128000,
    "step": 128
  },
  "AppShell.ai.tasks.key.temperature": {
    "label": "创造性",
    "kind": "number",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "min": 0,
    "max": 2,
    "step": 0.05
  },
  "AppShell.ai.tasks.key.topP": {
    "label": "采样范围",
    "kind": "number",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "min": 0,
    "max": 1,
    "step": 0.05
  },
  "AppShell.ai.tasks.key.maxTokens": {
    "label": "最大输出",
    "kind": "number",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "min": 128,
    "max": 128000,
    "step": 128
  },
  "AppShell.contextBudgetPreferences.modelContextLimit": {
    "label": "模型上下文窗口",
    "kind": "number",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "min": 16000,
    "max": 2000000,
    "step": 1000
  },
  "AppShell.contextBudgetPreferences.inputBudgetTokens": {
    "label": "作品输入上限",
    "kind": "number",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "min": 4000,
    "max": 1000000,
    "step": 1000
  },
  "AppShell.contextBudgetPreferences.outputReservePercent": {
    "label": "模型输出预留",
    "kind": "number",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "min": 10,
    "max": 60,
    "step": 1
  },
  "AppShell.contextBudgetPreferences.systemReserveTokens": {
    "label": "系统说明预留",
    "kind": "number",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "min": 1000,
    "max": 100000,
    "step": 1000
  },
  "AppShell.contextBudgetPreferences.recentSummaryCount": {
    "label": "近期摘要数量",
    "kind": "number",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "min": 2,
    "max": 5,
    "step": 1
  },
  "AppShell.contextBudgetPreferences.structuredRepairAttempts": {
    "label": "结构化结果修复",
    "kind": "enum",
    "scope": "either",
    "group": "当前表单",
    "save": "preference"
  },
  "AppShell.contextBudgetPreferences.minimumFactImportance": {
    "label": "事实审批门槛",
    "kind": "enum",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "options": [
      "high",
      "medium",
      "low"
    ]
  },
  "AppShell.contextBudgetPreferences.showFactConfirmations": {
    "label": "重复确认",
    "kind": "boolean",
    "scope": "either",
    "group": "当前表单",
    "save": "preference"
  },
  "AppShell.bookProfile.proseExpansionMode": {
    "label": "bookProfile.proseExpansionMode",
    "kind": "text",
    "scope": "either",
    "group": "作品偏好",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.bookProfile.reviewStrictness": {
    "label": "bookProfile.reviewStrictness",
    "kind": "text",
    "scope": "either",
    "group": "作品偏好",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.storyEntityDraft.entityType": {
    "label": "类型",
    "kind": "enum",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "options": [
      "character",
      "location",
      "item",
      "organization",
      "world_rule"
    ]
  },
  "AppShell.storyEntityDraft.canonicalName": {
    "label": "名称",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 160
  },
  "AppShell.storyEntityDraft.profileJson": {
    "label": "档案（JSON）",
    "kind": "json",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.resourceLedgerDraft.delta": {
    "label": "变化数量",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.resourceLedgerDraft.note": {
    "label": "说明（可选）",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 2000
  },
  "AppShell.storyRelationDraft.predicate": {
    "label": "例如：驻守于",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 160
  },
  "AppShell.storyRelationDraft.notes": {
    "label": "备注",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 5000
  },
  "AppShell.promptDraft": {
    "label": "提示词",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.explorerWidth": {
    "label": "explorerWidth",
    "kind": "number",
    "scope": "application",
    "group": "当前表单",
    "save": "draft",
    "min": 200,
    "max": 420,
    "step": 4
  },
  "AppShell.assistantWidth": {
    "label": "assistantWidth",
    "kind": "number",
    "scope": "application",
    "group": "当前表单",
    "save": "draft",
    "min": 280,
    "max": 460,
    "step": 4
  },
  "AppShell.realTrialDraft.notes": {
    "label": "想记一句再写（可选）",
    "kind": "markdown",
    "scope": "either",
    "group": "试写记录",
    "save": "draft",
    "maxLength": 10000
  },
  "AppShell.realTrialDraft.bypassedFeatures": {
    "label": "最常绕开的功能",
    "kind": "text",
    "scope": "either",
    "group": "试写记录",
    "save": "draft",
    "maxLength": 2000
  },
  "AppShell.realTrialConclusionDraft.highPriorityProblems": {
    "label": "一行一个问题，写清发生场景和影响",
    "kind": "markdown",
    "scope": "either",
    "group": "试写记录",
    "save": "draft",
    "maxLength": 4000
  },
  "AppShell.realTrialConclusionDraft.mediumPriorityProblems": {
    "label": "可以延后，但会持续增加负担的问题",
    "kind": "markdown",
    "scope": "either",
    "group": "试写记录",
    "save": "draft",
    "maxLength": 4000
  },
  "AppShell.realTrialConclusionDraft.lowPriorityProblems": {
    "label": "锦上添花或证据尚不足的问题",
    "kind": "markdown",
    "scope": "either",
    "group": "试写记录",
    "save": "draft",
    "maxLength": 4000
  },
  "AppShell.realTrialConclusionDraft.rationale": {
    "label": "决策依据",
    "kind": "markdown",
    "scope": "either",
    "group": "试写记录",
    "save": "draft",
    "maxLength": 10000
  },
  "AppShell.realTrialConclusionDraft.nextScope": {
    "label": "下一阶段范围",
    "kind": "markdown",
    "scope": "either",
    "group": "试写记录",
    "save": "draft",
    "maxLength": 10000
  },
  "AppShell.autoBackupDraft.enabled": {
    "label": "autoBackupDraft.enabled",
    "kind": "boolean",
    "scope": "either",
    "group": "当前表单",
    "save": "preference"
  },
  "AppShell.autoBackupDraft.backupOnFirstOpen": {
    "label": "每日首次打开",
    "kind": "boolean",
    "scope": "either",
    "group": "当前表单",
    "save": "preference"
  },
  "AppShell.autoBackupDraft.intervalMinutes": {
    "label": "变化检查周期",
    "kind": "enum",
    "scope": "either",
    "group": "当前表单",
    "save": "preference"
  },
  "AppShell.autoBackupDraft.retentionCount": {
    "label": "最多保留",
    "kind": "number",
    "scope": "either",
    "group": "当前表单",
    "save": "preference",
    "min": 1,
    "max": 50,
    "step": 1
  },
  "AppShell.researchSettings.model": {
    "label": "联网模型",
    "kind": "enum",
    "scope": "either",
    "group": "当前表单",
    "save": "query"
  },
  "AppShell.createForm.name": {
    "label": "作品名称",
    "kind": "text",
    "scope": "application",
    "group": "新建与导入",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.continuationExistingPlotDraft.time": {
    "label": "时间",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.continuationExistingPlotDraft.characters": {
    "label": "人物",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.continuationExistingPlotDraft.location": {
    "label": "地点",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.continuationExistingPlotDraft.event": {
    "label": "事件",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.continuationCharacterDraft.name": {
    "label": "人物名",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 120
  },
  "AppShell.continuationCharacterDraft.role": {
    "label": "初始角色定位",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 1000
  },
  "AppShell.continuationCharacterDraft.arcSeed": {
    "label": "人物弧方向",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 5000
  },
  "AppShell.chapterCardDraft.goal": {
    "label": "本章目标",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 2000
  },
  "AppShell.chapterCardDraft.entryState": {
    "label": "进入状态",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 2000
  },
  "AppShell.chapterCardDraft.exitChange": {
    "label": "退出变化",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 2000
  },
  "AppShell.chapterCardDraft.beatsText": {
    "label": "节拍 / 场景（每行一项）",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 25000
  },
  "AppShell.chapterCardDraft.conflict": {
    "label": "核心冲突",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 2000
  },
  "AppShell.chapterCardDraft.hook": {
    "label": "章末钩子",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 2000
  },
  "AppShell.chapterCardDraft.charactersText": {
    "label": "出场人物",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 5000
  },
  "AppShell.chapterCardDraft.pointOfView": {
    "label": "视角人物 / 人称",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 2000
  },
  "AppShell.chapterCardDraft.narrativeDistance": {
    "label": "叙述距离",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 2000
  },
  "AppShell.chapterSummaryDraft": {
    "label": "本章摘要",
    "kind": "markdown",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 50000
  },
  "AppShell.revisionLabelDraft": {
    "label": "版本名称",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "maxLength": 80
  },
  "AppShell.manifestRoles.file.token": {
    "label": "用途",
    "kind": "enum",
    "scope": "either",
    "group": "当前表单",
    "save": "draft",
    "options": [
      "",
      "manuscript",
      "material",
      "external",
      "skip"
    ]
  },
  "AppShell.txtImport.title": {
    "label": "导入作品名称",
    "kind": "text",
    "scope": "application",
    "group": "新建与导入",
    "save": "draft",
    "maxLength": 100000
  },
  "AppShell.txtImport.genre": {
    "label": "导入题材",
    "kind": "enum",
    "scope": "application",
    "group": "新建与导入",
    "save": "draft"
  },
  "definition.bookProfile.genre": {
    "label": "主类别",
    "kind": "enum",
    "scope": "either",
    "group": "作品定义",
    "save": "draft"
  },
  "definition.bookProfile.subgenre": {
    "label": "细分类",
    "kind": "enum",
    "scope": "either",
    "group": "作品定义",
    "save": "draft"
  },
  "definition.bookProfile.coreIdea": {
    "label": "核心设想",
    "kind": "markdown",
    "scope": "either",
    "group": "作品定义",
    "save": "draft",
    "maxLength": 5000
  },
  "definition.bookProfile.plannedVolumes": {
    "label": "计划卷数",
    "kind": "number",
    "scope": "either",
    "group": "作品定义",
    "save": "draft",
    "min": 1,
    "max": 100,
    "step": 1
  },
  "definition.bookProfile.chaptersPerVolume": {
    "label": "每卷章节数",
    "kind": "number",
    "scope": "either",
    "group": "作品定义",
    "save": "draft",
    "min": 1,
    "max": 500,
    "step": 1
  },
  "definition.bookProfile.targetWordsPerChapter": {
    "label": "每章目标字数",
    "kind": "number",
    "scope": "either",
    "group": "作品定义",
    "save": "draft",
    "min": 300,
    "max": 50000,
    "step": 100
  },
  "definition.bookProfile.audienceScale": {
    "label": "受众与内容尺度",
    "kind": "text",
    "scope": "either",
    "group": "作品定义",
    "save": "preference",
    "maxLength": 2000
  },
  "definition.bookProfile.defaultPov": {
    "label": "默认视角",
    "kind": "text",
    "scope": "either",
    "group": "作品定义",
    "save": "draft",
    "maxLength": 2000
  },
  "definition.bookProfile.narrativeDistance": {
    "label": "默认叙述距离",
    "kind": "text",
    "scope": "either",
    "group": "作品定义",
    "save": "draft",
    "maxLength": 2000
  },
  "definition.bookProfile.writingStyle": {
    "label": "文风提示",
    "kind": "markdown",
    "scope": "either",
    "group": "作品定义",
    "save": "draft",
    "maxLength": 2000
  },
  "definition.bookProfile.autosaveEnabled": {
    "label": "自动保存正文",
    "kind": "boolean",
    "scope": "either",
    "group": "作品定义",
    "save": "draft"
  },
  "definition.autosaveCheckpointDelaySeconds": {
    "label": "保险草稿等待",
    "kind": "number",
    "scope": "either",
    "group": "作品定义",
    "save": "draft",
    "min": 0.25,
    "max": 60,
    "step": 0.25
  },
  "definition.autosaveVersionIdleSeconds": {
    "label": "停止输入后生成版本",
    "kind": "number",
    "scope": "either",
    "group": "作品定义",
    "save": "draft",
    "min": 1,
    "max": 600,
    "step": 1
  },
  "definition.characterAliasDraft.canonicalName": {
    "label": "人物本名",
    "kind": "text",
    "scope": "either",
    "group": "作品定义",
    "save": "draft",
    "maxLength": 160
  },
  "definition.characterAliasDraft.aliasesText": {
    "label": "别名或称呼",
    "kind": "text",
    "scope": "either",
    "group": "作品定义",
    "save": "draft",
    "maxLength": 2000
  },
  "ChapterTreeList.query": {
    "label": "搜索关键词",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "query",
    "maxLength": 100000
  },
  "CharacterAtlas.query": {
    "label": "搜索关键词",
    "kind": "text",
    "scope": "either",
    "group": "人物轨迹",
    "save": "query",
    "maxLength": 160
  },
  "CharacterAtlas.location": {
    "label": "按所选进度内曾记录的地点筛选人物",
    "kind": "enum",
    "scope": "either",
    "group": "人物轨迹",
    "save": "draft"
  },
  "ConflictResolutionActions.exceptionReason": {
    "label": "例外说明",
    "kind": "markdown",
    "scope": "either",
    "group": "审校",
    "save": "draft",
    "maxLength": 2000
  },
  "FactReviewPanel.editDrafts.change.id": {
    "label": "事实候选内容",
    "kind": "json",
    "scope": "either",
    "group": "事实核对",
    "save": "draft",
    "maxLength": 100000
  },
  "LibraryWorksGallery.sortMode": {
    "label": "作品排序",
    "kind": "enum",
    "scope": "application",
    "group": "当前表单",
    "save": "query",
    "options": [
      "recent",
      "title",
      "words"
    ]
  },
  "ManuscriptEditor.fontFamily": {
    "label": "字体",
    "kind": "enum",
    "scope": "either",
    "group": "书稿",
    "save": "preference",
    "options": [
      "serif",
      "song",
      "kai",
      "sans"
    ]
  },
  "ManuscriptEditor.fontScale": {
    "label": "字号",
    "kind": "number",
    "scope": "either",
    "group": "书稿",
    "save": "preference",
    "min": 0.85,
    "max": 1.25,
    "step": 0.05
  },
  "ManuscriptEditor.editorLeading": {
    "label": "行距",
    "kind": "number",
    "scope": "either",
    "group": "书稿",
    "save": "preference",
    "min": 1.6,
    "max": 2.5,
    "step": 0.05
  },
  "ManuscriptEditor.pageWidth": {
    "label": "行宽",
    "kind": "number",
    "scope": "either",
    "group": "书稿",
    "save": "preference",
    "min": 620,
    "max": 980,
    "step": 20
  },
  "ManuscriptEditor.paragraphSpacing": {
    "label": "段间空行",
    "kind": "boolean",
    "scope": "either",
    "group": "书稿",
    "save": "preference"
  },
  "ManuscriptEditor.firstLineIndent": {
    "label": "首行缩进",
    "kind": "boolean",
    "scope": "either",
    "group": "书稿",
    "save": "preference"
  },
  "ManuscriptEditor.findQuery": {
    "label": "查找文字",
    "kind": "text",
    "scope": "either",
    "group": "书稿",
    "save": "query",
    "maxLength": 100000
  },
  "ManuscriptEditor.replaceText": {
    "label": "替换文字",
    "kind": "text",
    "scope": "either",
    "group": "书稿",
    "save": "query",
    "maxLength": 100000
  },
  "ManuscriptEditor.titleDraft": {
    "label": "章节标题",
    "kind": "text",
    "scope": "either",
    "group": "书稿",
    "save": "draft",
    "maxLength": 120
  },
  "ModelCatalogPicker.query": {
    "label": "搜索关键词",
    "kind": "text",
    "scope": "either",
    "group": "模型选择",
    "save": "query",
    "maxLength": 100000
  },
  "ModelCatalogPicker.manualModel": {
    "label": "模型名称",
    "kind": "text",
    "scope": "either",
    "group": "模型选择",
    "save": "draft",
    "maxLength": 100000
  },
  "OutlineExpansionPanel.count": {
    "label": "生成数量",
    "kind": "number",
    "scope": "either",
    "group": "逐层谋篇",
    "save": "draft",
    "min": 1,
    "max": 12,
    "step": 1
  },
  "OutlineExpansionPanel.instruction": {
    "label": "生成要求",
    "kind": "text",
    "scope": "either",
    "group": "逐层谋篇",
    "save": "draft",
    "maxLength": 2000
  },
  "ProjectLibrary.search": {
    "label": "搜索作品",
    "kind": "text",
    "scope": "application",
    "group": "我的作品",
    "save": "query",
    "maxLength": 100000
  },
  "QuickChapterOpen.query": {
    "label": "搜索关键词",
    "kind": "text",
    "scope": "either",
    "group": "当前表单",
    "save": "query",
    "maxLength": 100000
  },
  "WorldMap.query": {
    "label": "搜索关键词",
    "kind": "text",
    "scope": "either",
    "group": "沙盘地图",
    "save": "query",
    "maxLength": 200
  },
  "WorldMap.imageModel": {
    "label": "地图图像模型",
    "kind": "text",
    "scope": "either",
    "group": "沙盘地图",
    "save": "draft",
    "maxLength": 200
  },
  "WorldMap.coordinateX": {
    "label": "地图横坐标",
    "kind": "number",
    "scope": "either",
    "group": "沙盘地图",
    "save": "draft",
    "min": 0,
    "max": 100
  },
  "WorldMap.coordinateY": {
    "label": "地图纵坐标",
    "kind": "number",
    "scope": "either",
    "group": "沙盘地图",
    "save": "draft",
    "min": 0,
    "max": 100
  },
  "ChronicleEvents.query": {
    "label": "搜索关键词",
    "kind": "text",
    "scope": "either",
    "group": "纪事",
    "save": "query",
    "maxLength": 200
  },
  "ChronicleEvents.origin": {
    "label": "事件来源",
    "kind": "enum",
    "scope": "either",
    "group": "纪事",
    "save": "query",
    "options": [
      "all",
      "direct",
      "formal"
    ]
  }
}
