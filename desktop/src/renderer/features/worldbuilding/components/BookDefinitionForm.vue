<script setup lang="ts">
import { computed } from 'vue'
import type { BookProfile } from '../../../../contracts/index'
import { calculateBookLength } from '../../../../contracts/worldbuilding/book-length'
import ArchiveFormField from '../../../ui/ArchiveFormField.vue'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
type AliasGroup = { characterId: string; canonicalName: string; aliases: string[] }
const bookProfile = defineModel<BookProfile>({ required: true })
const characterAliasDraft = defineModel<{ canonicalName: string; aliasesText: string }>('aliases', { required: true })
const autosaveCheckpointDelaySeconds = defineModel<number>('checkpointSeconds', { required: true })
const autosaveVersionIdleSeconds = defineModel<number>('versionSeconds', { required: true })
defineProps<{ busy: boolean; genreCatalog: ReadonlyArray<{ id: string; label: string }>; bookSubgenreOptions: string[]; legacyBookSubgenre: string; characterAliasesLoaded: boolean; groupedCharacterAliases: AliasGroup[] }>()
const emit = defineEmits<{ genreChange: []; editAliases: [item: AliasGroup]; saveAliases: [] }>()
const lengthPlan = computed(() => calculateBookLength(bookProfile.value))
const formatCount = (value: number) => value.toLocaleString('zh-CN')
</script>

<template>
<div class="profile-grid" data-testid="book-definition-fields">
            <label class="profile-premise"><span>核心设想 <i aria-hidden="true">PREMISE</i></span><textarea v-assist-field="{ id: 'definition.bookProfile.coreIdea', read: () => bookProfile.coreIdea, write: value => { bookProfile.coreIdea = String(value) }, identity: () => bookProfile }" v-model="bookProfile.coreIdea" placeholder="先写一个大概：主角是谁，遇到什么处境，故事最大的反差是什么……"></textarea><details class="profile-premise-help"><summary>填写建议</summary><p>先写核心冲突，人物与世界可稍后补充。</p></details></label>
            <fieldset class="profile-kind"><legend><span aria-hidden="true">01</span>作品类型</legend><label>主类别<select v-assist-field="{ id: 'definition.bookProfile.genre', read: () => bookProfile.genre, write: value => { bookProfile.genre = String(value); emit('genreChange') }, identity: () => bookProfile }" v-model="bookProfile.genre" data-testid="book-genre" @change="emit('genreChange')"><option v-for="item in genreCatalog" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><label>细分类<select v-assist-field="{ id: 'definition.bookProfile.subgenre', read: () => bookProfile.subgenre, write: value => { bookProfile.subgenre = String(value) }, identity: () => bookProfile }" v-model="bookProfile.subgenre" data-testid="book-subgenre"><option value="">暂不细分</option><option v-if="legacyBookSubgenre" :value="legacyBookSubgenre">原有分类：{{ legacyBookSubgenre }}</option><option v-for="item in bookSubgenreOptions" :key="item" :value="item">{{ item }}</option></select></label><small>用于匹配对应题材的创作方法。</small></fieldset>
            <fieldset class="profile-length-plan" data-testid="book-length-plan">
              <legend><span aria-hidden="true">02</span>篇幅计划</legend>
              <label><span>计划卷数</span><div class="profile-number-input"><input id="book-planned-volumes" data-testid="book-planned-volumes" v-assist-field="{ id: 'definition.bookProfile.plannedVolumes', read: () => bookProfile.plannedVolumes, write: value => { bookProfile.plannedVolumes = Number(value) }, identity: () => bookProfile }" v-model.number="bookProfile.plannedVolumes" type="number" min="1" max="100" step="1"><span aria-hidden="true">卷</span></div></label>
              <label><span>每卷章节数</span><div class="profile-number-input"><input id="book-chapters-per-volume" data-testid="book-chapters-per-volume" v-assist-field="{ id: 'definition.bookProfile.chaptersPerVolume', read: () => bookProfile.chaptersPerVolume, write: value => { bookProfile.chaptersPerVolume = Number(value) }, identity: () => bookProfile }" v-model.number="bookProfile.chaptersPerVolume" type="number" min="1" max="500" step="1"><span aria-hidden="true">章</span></div></label>
              <label><span>每章目标字数</span><div class="profile-number-input profile-number-input-words"><input id="book-words-per-chapter" data-testid="book-words-per-chapter" v-assist-field="{ id: 'definition.bookProfile.targetWordsPerChapter', read: () => bookProfile.targetWordsPerChapter, write: value => { bookProfile.targetWordsPerChapter = Number(value) }, identity: () => bookProfile }" v-model.number="bookProfile.targetWordsPerChapter" type="number" min="300" max="50000" step="100"><span aria-hidden="true">字</span></div><small>目标字数，不限制实际篇幅。</small></label>
              <div class="profile-length-summary">
                <span id="book-length-label">全书目标字数 <small>自动计算</small></span>
                <output data-testid="book-target-total-words" for="book-planned-volumes book-chapters-per-volume book-words-per-chapter" aria-labelledby="book-length-label" aria-live="polite" aria-atomic="true">{{ lengthPlan ? formatCount(lengthPlan.targetWords) : '—' }}<span v-if="lengthPlan">字</span></output>
                <small>{{ lengthPlan ? `共 ${formatCount(lengthPlan.chapters)} 章 × ${formatCount(bookProfile.targetWordsPerChapter)} 字` : '填写有效的卷数、章数和单章字数后计算' }}</small>
              </div>
            </fieldset>
            <fieldset class="profile-writing-brief" data-testid="book-writing-constraints">
              <legend><span aria-hidden="true">03</span>默认写作约束</legend>
              <div class="profile-brief-heading"><small>章纲或单次任务的具体要求优先。</small></div>
              <label><span>受众与内容尺度</span><input v-assist-field="{ id: 'definition.bookProfile.audienceScale', read: () => bookProfile.audienceScale, write: value => { bookProfile.audienceScale = String(value) }, identity: () => bookProfile }" v-model="bookProfile.audienceScale" data-testid="book-audience-rating" maxlength="2000" placeholder="例如：成年读者；暴力写实但不渲染血腥"><small>写清目标读者、敏感边界或平台尺度</small></label>
              <label><span>默认视角</span><input v-assist-field="{ id: 'definition.bookProfile.defaultPov', read: () => bookProfile.defaultPov, write: value => { bookProfile.defaultPov = String(value) }, identity: () => bookProfile }" v-model="bookProfile.defaultPov" data-testid="book-default-viewpoint" maxlength="2000" placeholder="例如：第三人称限知，主要跟随女主"><small>可写人称、视角人物与切换规则</small></label>
              <label><span>默认叙述距离</span><input v-assist-field="{ id: 'definition.bookProfile.narrativeDistance', read: () => bookProfile.narrativeDistance, write: value => { bookProfile.narrativeDistance = String(value) }, identity: () => bookProfile }" v-model="bookProfile.narrativeDistance" data-testid="book-narrative-distance" maxlength="2000" placeholder="例如：近距离，贴近当下感受但不直接读心"></label>
              <label class="profile-style-guide"><span>文风提示</span><textarea v-assist-field="{ id: 'definition.bookProfile.writingStyle', read: () => bookProfile.writingStyle, write: value => { bookProfile.writingStyle = String(value) }, identity: () => bookProfile }" v-model="bookProfile.writingStyle" data-testid="book-style-guide" maxlength="2000" placeholder="例如：句式克制，动作和对白推进；少用总结性旁白，不堆叠形容词。"></textarea><small>描述你真正希望长期保持的语言、节奏与禁忌</small></label>
            </fieldset>
            <details class="profile-disclosure" data-testid="profile-save-disclosure"><summary>保存与留痕<small>{{ bookProfile.autosaveEnabled ? '自动保存已开启' : '手动保存' }}</small></summary>
            <fieldset class="profile-autosave-policy" :class="{ muted: !bookProfile.autosaveEnabled }" data-testid="book-autosave-settings">
              <legend>保存与留痕</legend>
              <label class="profile-autosave-switch"><input v-assist-field="{ id: 'definition.bookProfile.autosaveEnabled', read: () => bookProfile.autosaveEnabled, write: value => { bookProfile.autosaveEnabled = Boolean(value) }, identity: () => bookProfile }" v-model="bookProfile.autosaveEnabled" data-testid="book-autosave-enabled" type="checkbox"><span><b>自动保存正文</b><small>停止输入片刻后保存到当前作品；关闭后仍可随时手动保存。</small></span></label>
              <label><span>保险草稿等待</span><div class="profile-duration-input"><input v-assist-field="{ id: 'definition.autosaveCheckpointDelaySeconds', read: () => autosaveCheckpointDelaySeconds, write: value => { autosaveCheckpointDelaySeconds = Number(value) } }" v-model.number="autosaveCheckpointDelaySeconds" data-testid="book-autosave-delay" type="number" min="0.25" max="60" step="0.25" :disabled="!bookProfile.autosaveEnabled"><i>秒</i></div><small>默认 1.5 秒；短暂停笔即更新防丢草稿，不增加历史版本</small></label>
              <label><span>停止输入后生成版本</span><div class="profile-duration-input"><input v-assist-field="{ id: 'definition.autosaveVersionIdleSeconds', read: () => autosaveVersionIdleSeconds, write: value => { autosaveVersionIdleSeconds = Number(value) } }" v-model.number="autosaveVersionIdleSeconds" data-testid="book-autosave-merge-window" type="number" min="1" max="600" step="1" :disabled="!bookProfile.autosaveEnabled"><i>秒</i></div><small>默认 30 秒；继续输入会重新计时，只在安静下来后增加一条历史版本</small></label>
            </fieldset>
            </details>
            <details v-if="characterAliasesLoaded" class="profile-disclosure" data-testid="profile-alias-disclosure"><summary>人物别名<small>统一同一人物的不同称呼</small></summary>
            <fieldset class="profile-character-aliases" data-testid="character-alias-editor">
              <legend>人物别名</legend>
              <div class="profile-brief-heading"><b>统一人物称呼</b><small>AI 会把别名识别为同一人物；不会由此新增人物关系或设定。</small></div>
              <div v-if="groupedCharacterAliases.length" class="character-alias-list"><button v-for="item in groupedCharacterAliases" :key="item.characterId" type="button" @click="emit('editAliases', item)"><b>{{ item.canonicalName }}</b><span>{{ item.aliases.join('、') }}</span><i>编辑</i></button></div>
              <p v-else class="character-alias-empty">尚未保存别名。需要时再填写即可。</p>
              <div class="character-alias-form">
                <ArchiveFormField label="人物本名" v-slot="{ controlProps }"><input v-bind="controlProps" v-assist-field="{ id: 'definition.characterAliasDraft.canonicalName', read: () => characterAliasDraft.canonicalName, write: value => { characterAliasDraft.canonicalName = String(value) }, identity: () => characterAliasDraft }" v-model="characterAliasDraft.canonicalName" maxlength="160" placeholder="例如：沈砚"></ArchiveFormField>
                <ArchiveFormField label="别名或称呼" help="用顿号、逗号或换行分隔；留空并保存可清除该人物的别名。" v-slot="{ controlProps }"><input v-bind="controlProps" v-assist-field="{ id: 'definition.characterAliasDraft.aliasesText', read: () => characterAliasDraft.aliasesText, write: value => { characterAliasDraft.aliasesText = String(value) }, identity: () => characterAliasDraft }" v-model="characterAliasDraft.aliasesText" maxlength="2000" placeholder="例如：阿砚、沈公子、少主"></ArchiveFormField>
                <ArchiveAction :disabled="busy" @click="emit('saveAliases')">保存称呼</ArchiveAction>
              </div>
            </fieldset>
            </details>
            <section v-else class="profile-character-aliases unavailable"><b>人物别名</b><small>启用 SQLite 正式数据后可使用；现有 Markdown 与 JSON 文件不会因此被改写。</small></section>
          </div>
</template>
