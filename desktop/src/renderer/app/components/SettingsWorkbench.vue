<script setup>
import ArchivePageHeader from '../../ui/ArchivePageHeader.vue'
import SponsorCard from '../../features/sponsors/SponsorCard.vue'
import WorldbookEntryEditor from '../../features/characters/components/WorldbookEntryEditor.vue'
import WritingPluginSettings from '../../features/writing-plugins/components/WritingPluginSettings.vue'
import LocalModelStore from '../../features/models/components/LocalModelStore.vue'
import ModelConnectionsSettings from '../../features/models/components/ModelConnectionsSettings.vue'
import StudioIcon from '../../ui/StudioIcon.vue'
import ArchiveAction from '../../ui/ArchiveAction.vue'
import CompanionSettings from '../../features/companion/components/CompanionSettings.vue'
import ThemeSelector from './ThemeSelector.vue'
import SoundPreferences from './SoundPreferences.vue'
import { settingsCategories } from '../services/settings-navigation'
import { toRefs, ref, computed, nextTick, onBeforeUnmount } from 'vue'

const props = defineProps({ scope: { type: Object, required: true } })
const {
  activeSettingsCategory,
  ai,
  appVersion,
  appendResourceLedgerEntry,
  approvedResourceEntities,
  assistantWidth,
  autoBackupDraft,
  autoBackupDraftDirty,
  autoBackupLoading,
  autoBackupRunning,
  autoBackupStatus,
  autoBackupTime,
  bookProfile,
  busy,
  cancelConsistencyEvaluation,
  chapters,
  chooseAutoBackupDirectory,
  companionError,
  companionOptions,
  companionProjectSpecific,
  consistencyEvaluationJob,
  consistencyEvaluationSummary,
  contextBudgetPreferences,
  createWorkspaceBackup,
  current,
  currentSettingsSection,
  desktop,
  editStoryEntity,
  evaluationTime,
  explorerWidth,
  exportManuscript,
  loadRealTrialDraft,
  migrateProject,
  migrationPreview,
  modelChoices,
  modelSettingsDirty,
  modelReturnLabel,
  returnFromModelSettings,
  openSqliteActivation,
  openSqliteShadowMigration,
  openWorkspaceRestore,
  promptDraft,
  promptDraftDirty,
  promptProfile,
  realTrialAvailableChapters,
  realTrialChapterId,
  realTrialConclusionDraft,
  realTrialDraft,
  realTrialExistingRecord,
  realTrialIssue,
  realTrialReport,
  realTrialSelectedChapter,
  rebuildReadableMirrors,
  recoverCompanionDefaults,
  refreshLocalModels,
  refreshModelAssignments,
  replayOpening,
  researchSettings,
  resetAppearancePreferences,
  resetContextEvidencePreferences,
  resetPromptOverride,
  resourceLedger,
  resourceLedgerDraft,
  retrySqliteMirrors,
  rollbackSqliteStorage,
  runAutomaticBackup,
  saveAppearancePreferences,
  saveAutoBackupPreferences,
  saveContextBudgetPreferences,
  savePromptOverride,
  saveRealTrialChapter,
  saveRealTrialConclusion,
  saveResearchSettings,
  saveStoryEntity,
  saveStoryEntityRelation,
  saveWritingPreferences,
  selectPromptTask,
  selectSettingsCategory,
  selectSettingsSection,
  selectTheme,
  selectedPromptEntry,
  selectedPromptTask,
  selectedResourceBalance,
  selectedResourceEntries,
  setCompanionProjectSpecific,
  settingsSection,
  sqliteShadowResult,
  sqliteStorageStatus,
  startConsistencyEvaluation,
  storyEntities,
  storyEntitiesLoaded,
  storyEntityDraft,
  storyEntityRelations,
  storyRelationDraft,
  themeChoice,
  themeError,
  trialPercent,
  updateCompanionOptions,
  useLocalModel,
  workspaceBackupResult
} = toRefs(props.scope)
const settingsRoot = ref(null)
const dataPage = ref('backup')
const dataPages = [
  { id: 'backup', label: '备份与恢复', note: '作品副本 · 自动护稿 · 导出' },
  { id: 'storage', label: '存储与迁移', note: '数据版本 · 保存方式 · 镜像' },
  { id: 'diagnostics', label: '诊断检查', note: '一致性能力 · 校验记录' }
]
const dataScroll = new Map()
let dataNavigation = 0
async function selectDataPage(id) {
  if (id === dataPage.value) return
  const root = settingsRoot.value
  let scroll = root
  while (scroll && !/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement
  dataScroll.set(dataPage.value, scroll?.scrollTop || 0)
  const ticket = ++dataNavigation
  dataPage.value = id
  await nextTick()
  if (ticket !== dataNavigation || !root?.isConnected) return
  if (scroll) scroll.scrollTop = dataScroll.get(id) || 0
}
onBeforeUnmount(() => { dataNavigation++ })
const worldbookSearch = ref('')
const worldbookType = ref('')
const visibleWorldbookEntities = computed(() => storyEntities.value.filter(item => (!worldbookType.value || item.entityType === worldbookType.value) && item.canonicalName.toLocaleLowerCase().includes(worldbookSearch.value.toLocaleLowerCase())))

</script>

<template>
  <div ref="settingsRoot" class="settings-editor settings-page" :class="{ 'story-content-page': settingsSection === 'story', 'model-settings-page': settingsSection === 'connection' || settingsSection === 'routing' }">
    <nav v-if="settingsSection !== 'story'" class="settings-category-navigation" aria-label="设置分类">
      <button
        v-for="category in settingsCategories"
        :key="category.id"
        type="button"
        :class="{ selected: activeSettingsCategory.id === category.id }"
        :aria-current="activeSettingsCategory.id === category.id ? 'page' : undefined"
        :data-testid="`settings-category-${category.id}`"
        @click="selectSettingsCategory(category.id)"
      >
        <i>{{ category.mark }}</i
        ><span>{{ category.label }}</span>
      </button>
    </nav>
    <header v-if="settingsSection === 'connection' || settingsSection === 'routing'" class="model-workflow-heading">
      <div class="model-heading-title"><p class="eyebrow">{{ settingsSection === 'connection' ? 'CONNECTION ARCHIVE / 接口档案' : 'WRITING MODELS / 创作配置' }}</p><h2>{{ currentSettingsSection.label }}</h2></div>
      <div class="model-heading-context"><span>{{ settingsSection === 'connection' ? '所有作品共用' : current?.title }}</span><ArchiveAction data-testid="model-return-to-writing" @click="returnFromModelSettings"><span aria-hidden="true">↗</span> {{ modelReturnLabel }}</ArchiveAction></div>
    </header>
    <ArchivePageHeader v-else-if="settingsSection !== 'story' && settingsSection !== 'local-models'" :eyebrow="`WORKSPACE / 设置 · ${activeSettingsCategory.label}`" :title="currentSettingsSection.label" :description="currentSettingsSection.description" />
    <ArchivePageHeader v-else-if="settingsSection === 'story'" class="story-content-header" eyebrow="03 / WORLDBOOK · 本书设定" title="人物与世界书" description="管理人物与世界；分别填写公开设定、作者备注和秘密。" />
    <WritingPluginSettings v-if="settingsSection === 'plugins'" :key="JSON.stringify([current?.id, current?.path])" :api="desktop.writingPlugins" :book-scope-key="current ? JSON.stringify([current.id, current.path]) : null" />
    <LocalModelStore
      v-if="settingsSection === 'local-models'"
      :api="desktop.localModels"
      :settings="ai"
      :busy="busy"
      @use="useLocalModel"
      @changed="refreshLocalModels"
    />
    <ModelConnectionsSettings :local-api="desktop.localModels"
      v-if="settingsSection === 'connection' || settingsSection === 'routing'"
      :key="current?.id + ':' + settingsSection"
      :api="desktop.modelConnections"
      :book-available="Boolean(current)"
      :page="settingsSection"
      :embedded="true"
      :return-label="modelReturnLabel"
      @dirty="modelSettingsDirty = $event"
      @changed="refreshModelAssignments"
      @navigate="selectSettingsSection"
      @return="returnFromModelSettings"
    />
    <section
      v-if="settingsSection === 'context'"
      class="settings-section settings-page-section"
      data-testid="settings-page-context-budget"
    >
      <header>
        <div>
          <b>AI 依据与事实减负</b
          ><small>以下数字都是可调整起始建议，不是模型标准。预算不足时会明确阻止发送，不会悄悄截断必须资料。</small>
        </div>
      </header>
      <div class="settings-form field-grid context-budget-form">
        <label
          ><span>模型上下文窗口</span>
          <div class="profile-duration-input">
            <input
              v-assist-field="{
                id: 'AppShell.contextBudgetPreferences.modelContextLimit',
                read: () => contextBudgetPreferences.modelContextLimit,
                write: (value) => {
                  contextBudgetPreferences.modelContextLimit = Number(value)
                },
                identity: () => contextBudgetPreferences
              }"
              v-model.number="contextBudgetPreferences.modelContextLimit"
              type="number"
              min="16000"
              max="2000000"
              step="1000"
              data-testid="context-model-limit"
            /><i>tokens</i>
          </div>
          <small>起始建议 150000；按当前模型服务公开的窗口填写。</small></label
        ><label
          ><span>作品输入上限</span>
          <div class="profile-duration-input">
            <input
              v-assist-field="{
                id: 'AppShell.contextBudgetPreferences.inputBudgetTokens',
                read: () => contextBudgetPreferences.inputBudgetTokens,
                write: (value) => {
                  contextBudgetPreferences.inputBudgetTokens = Number(value)
                },
                identity: () => contextBudgetPreferences
              }"
              v-model.number="contextBudgetPreferences.inputBudgetTokens"
              type="number"
              min="4000"
              max="1000000"
              step="1000"
              data-testid="context-input-budget"
            /><i>tokens</i>
          </div>
          <small>起始建议 120000；只限制本书资料，不要求每次用满。</small></label
        ><label
          ><span>模型输出预留</span>
          <div class="profile-duration-input">
            <input
              v-assist-field="{
                id: 'AppShell.contextBudgetPreferences.outputReservePercent',
                read: () => contextBudgetPreferences.outputReservePercent,
                write: (value) => {
                  contextBudgetPreferences.outputReservePercent = Number(value)
                },
                identity: () => contextBudgetPreferences
              }"
              v-model.number="contextBudgetPreferences.outputReservePercent"
              type="number"
              min="10"
              max="60"
              step="1"
              data-testid="context-output-reserve"
            /><i>%</i>
          </div>
          <small>起始建议 25%；写长章可提高，短任务可降低。</small></label
        ><label
          ><span>系统说明预留</span>
          <div class="profile-duration-input">
            <input
              v-assist-field="{
                id: 'AppShell.contextBudgetPreferences.systemReserveTokens',
                read: () => contextBudgetPreferences.systemReserveTokens,
                write: (value) => {
                  contextBudgetPreferences.systemReserveTokens = Number(value)
                },
                identity: () => contextBudgetPreferences
              }"
              v-model.number="contextBudgetPreferences.systemReserveTokens"
              type="number"
              min="1000"
              max="100000"
              step="1000"
              data-testid="context-system-reserve"
            /><i>tokens</i>
          </div>
          <small>起始建议 10000；用于任务契约、提示词与返回格式。</small></label
        ><label
          ><span>近期摘要数量</span>
          <div class="profile-duration-input">
            <input
              v-assist-field="{
                id: 'AppShell.contextBudgetPreferences.recentSummaryCount',
                read: () => contextBudgetPreferences.recentSummaryCount,
                write: (value) => {
                  contextBudgetPreferences.recentSummaryCount = Number(value)
                },
                identity: () => contextBudgetPreferences
              }"
              v-model.number="contextBudgetPreferences.recentSummaryCount"
              type="number"
              min="2"
              max="5"
              step="1"
              data-testid="context-recent-summary-count"
            /><i>章</i>
          </div>
          <small>起始建议 3 章；只读取仍绑定确认版正文的摘要。</small></label
        ><label
          ><span>结构化结果修复</span
          ><select
            v-assist-field="{
              id: 'AppShell.contextBudgetPreferences.structuredRepairAttempts',
              read: () => contextBudgetPreferences.structuredRepairAttempts,
              write: (value) => {
                contextBudgetPreferences.structuredRepairAttempts = Number(value)
              },
              identity: () => contextBudgetPreferences
            }"
            v-model.number="contextBudgetPreferences.structuredRepairAttempts"
            data-testid="structured-repair-attempts"
          >
            <option :value="0">不自动修复</option>
            <option :value="1">自动修复 1 次 · 起始建议</option>
            <option :value="2">自动修复 2 次</option>
            <option :value="3">自动修复 3 次</option></select
          ><small>只在 JSON 或字段校验失败时重试；网络错误不会重复请求。</small></label
        ><label
          ><span>事实审批门槛</span
          ><select
            v-assist-field="{
              id: 'AppShell.contextBudgetPreferences.minimumFactImportance',
              read: () => contextBudgetPreferences.minimumFactImportance,
              write: (value) => {
                contextBudgetPreferences.minimumFactImportance = String(value)
              },
              identity: () => contextBudgetPreferences
            }"
            v-model="contextBudgetPreferences.minimumFactImportance"
            data-testid="fact-review-minimum-importance"
          >
            <option value="high">只看关键变化</option>
            <option value="medium">关键与常规 · 起始建议</option>
            <option value="low">显示全部变化</option></select
          ><small>低于门槛的候选自动收起；冲突始终显示。</small></label
        ><label class="context-confirm-setting"
          ><span>重复确认</span
          ><span class="setting-switch-row"
            ><input
              v-assist-field="{
                id: 'AppShell.contextBudgetPreferences.showFactConfirmations',
                read: () => contextBudgetPreferences.showFactConfirmations,
                write: (value) => {
                  contextBudgetPreferences.showFactConfirmations = Boolean(value)
                },
                identity: () => contextBudgetPreferences
              }"
              v-model="contextBudgetPreferences.showFactConfirmations"
              type="checkbox"
              data-testid="show-fact-confirmations"
            /><b>{{ contextBudgetPreferences.showFactConfirmations ? '显示未变化事实' : '自动收起重复项' }}</b></span
          ><small>与已经批准的事实完全相同，不需要每天反复审批。</small></label
        ><label class="context-confirm-setting"
          ><span>发送前核对</span
          ><span class="setting-switch-row"
            ><input
              v-model="contextBudgetPreferences.alwaysConfirmBeforeSend"
              type="checkbox"
              data-testid="always-confirm-ai-context"
            /><b>{{ contextBudgetPreferences.alwaysConfirmBeforeSend ? '每次先看依据' : '按需查看依据' }}</b></span
          ><small>开启后，第一次点击发送只会展开本次依据；确认范围、模型与操作后才真正调用 AI。</small></label
        >
      </div>
      <div class="connection-command-bar">
        <div>
          <b>发送内容可在助笔中查看</b
          ><span
            >实际可用输入 =
            模型窗口扣除输出和系统预留，再与作品输入上限取较小值。固定或移除的前文与素材依据都会记录在本书设置中。</span
          >
        </div>
        <div class="connection-command-actions">
          <button
            class="control-button secondary"
            type="button"
            :disabled="
              busy ||
              (!contextBudgetPreferences.pinnedEvidenceKeys.length &&
                !contextBudgetPreferences.excludedEvidenceKeys.length)
            "
            @click="resetContextEvidencePreferences"
          >
            恢复自动选取</button
          ><button
            class="control-button primary save-action"
            type="button"
            :disabled="busy"
            @click="saveContextBudgetPreferences"
          >
            <StudioIcon name="save" :size="16" />保存本书设置
          </button>
        </div>
      </div>
    </section>
    <section
      v-if="settingsSection === 'writing'"
      class="settings-section settings-page-section writing-preferences"
      data-testid="settings-page-writing-preferences"
    >
      <header>
        <div>
          <b>正文生成偏好</b><small>这些设置属于当前作品，只影响之后生成的候选正文；不会改写已经保存的章节。</small>
        </div>
        <span class="writing-preference-status">本书独立</span>
      </header>
      <div class="writing-preference-group">
        <div class="writing-preference-intro writing-full-flow-note" data-testid="chapter-generation-full-flow">
          <span>完整生成流程</span
          ><small
            >先检查本章依据与章契，生成正文候选后进行章契、事实边界审校及本地完整性检查，最后由你核对采用。审校失败不会降级为快捷生成，也不会自动写入正式正文。</small
          >
        </div>
      </div>
      <div class="writing-preference-group">
        <div class="writing-preference-intro">
          <span>展开方式</span
          ><small>决定模型怎样使用对白、笑点、动作和场景细节。目标字数仍是完整度参考，不设上限。</small>
        </div>
        <div class="writing-preference-options" role="radiogroup" aria-label="正文展开方式">
          <label :class="{ selected: bookProfile.proseExpansionMode === 'web-serial' }"
            ><input
              v-assist-field="{
                id: 'AppShell.bookProfile.proseExpansionMode',
                read: () => bookProfile.proseExpansionMode,
                write: (value) => {
                  bookProfile.proseExpansionMode = String(value)
                },
                identity: () => bookProfile
              }"
              v-model="bookProfile.proseExpansionMode"
              type="radio"
              value="web-serial"
            /><i>网</i
            ><span><b>网文展开</b><small>允许较多对白、接梗、误会与角色反应；男主和配角都可以贡献笑点。</small></span
            ><em>推荐</em></label
          >
          <label :class="{ selected: bookProfile.proseExpansionMode === 'balanced' }"
            ><input
              v-assist-field="{
                id: 'AppShell.bookProfile.proseExpansionMode',
                read: () => bookProfile.proseExpansionMode,
                write: (value) => {
                  bookProfile.proseExpansionMode = String(value)
                },
                identity: () => bookProfile
              }"
              v-model="bookProfile.proseExpansionMode"
              type="radio"
              value="balanced"
            /><i>衡</i
            ><span><b>均衡叙事</b><small>对白、动作、环境与内心反应保持均衡，不刻意拉长每轮交流。</small></span></label
          >
          <label :class="{ selected: bookProfile.proseExpansionMode === 'compact' }"
            ><input
              v-assist-field="{
                id: 'AppShell.bookProfile.proseExpansionMode',
                read: () => bookProfile.proseExpansionMode,
                write: (value) => {
                  bookProfile.proseExpansionMode = String(value)
                },
                identity: () => bookProfile
              }"
              v-model="bookProfile.proseExpansionMode"
              type="radio"
              value="compact"
            /><i>简</i
            ><span><b>紧凑推进</b><small>优先保留改变场面、关系或读者判断的内容，适合快节奏章节。</small></span></label
          >
        </div>
      </div>
      <div class="writing-preference-group">
        <div class="writing-preference-intro">
          <span>精审时的事实范围</span
          ><small>仅核对作品已经确认的事实边界；不会因为玩笑、吐槽或普通办事流程而阻止生成。</small>
        </div>
        <div class="writing-preference-options compact-options" role="radiogroup" aria-label="事实审校强度">
          <label :class="{ selected: bookProfile.reviewStrictness === 'balanced' }"
            ><input
              v-assist-field="{
                id: 'AppShell.bookProfile.reviewStrictness',
                read: () => bookProfile.reviewStrictness,
                write: (value) => {
                  bookProfile.reviewStrictness = String(value)
                },
                identity: () => bookProfile
              }"
              v-model="bookProfile.reviewStrictness"
              type="radio"
              value="balanced"
            /><i>常</i><span><b>平衡审校</b><small>重点核对人物能力、身份、关键物品和作品内世界规则。</small></span
            ><em>推荐</em></label
          >
          <label :class="{ selected: bookProfile.reviewStrictness === 'strict' }"
            ><input
              v-assist-field="{
                id: 'AppShell.bookProfile.reviewStrictness',
                read: () => bookProfile.reviewStrictness,
                write: (value) => {
                  bookProfile.reviewStrictness = String(value)
                },
                identity: () => bookProfile
              }"
              v-model="bookProfile.reviewStrictness"
              type="radio"
              value="strict"
            /><i>严</i
            ><span><b>严格审校</b><small>额外核对本书已经明确建立的精密设定；不会引入题材外流程。</small></span></label
          >
        </div>
      </div>
      <footer class="writing-preference-footer">
        <p>
          <b>当前组合</b
          ><span
            >完整流程 ·
            {{
              bookProfile.proseExpansionMode === 'web-serial'
                ? '网文展开'
                : bookProfile.proseExpansionMode === 'balanced'
                  ? '均衡叙事'
                  : '紧凑推进'
            }}
            · {{ bookProfile.reviewStrictness === 'balanced' ? '平衡审校' : '严格审校' }}</span
          >
        </p>
        <button
          class="control-button primary save-action"
          type="button"
          :disabled="busy"
          data-testid="save-writing-preferences"
          @click="saveWritingPreferences"
        >
          <StudioIcon name="save" :size="16" />保存本书偏好
        </button>
      </footer>
    </section>
    <section
      v-if="settingsSection === 'story' && storyEntitiesLoaded"
      class="settings-section settings-page-section story-entity-section"
      data-testid="settings-page-story-entities"
    >

      <div class="story-entity-grid">
        <div class="story-entity-list">
          <header class="story-catalog-heading"><b>档案目录</b><span class="story-catalog-count">{{ storyEntities.length }} 项</span></header>
          <label>搜索世界书<input v-model="worldbookSearch" type="search" placeholder="条目名称" /></label>
          <label>类型<select v-model="worldbookType"><option value="">全部</option><option value="character">人物</option><option value="location">地点</option><option value="item">物品</option><option value="organization">组织</option><option value="world_rule">世界规则</option></select></label>
          <button
            v-for="item in visibleWorldbookEntities"
            :key="item.id"
            type="button"
            :class="{ selected: storyEntityDraft.id === item.id }"
            @click="editStoryEntity(item)"
          >
            <span>{{
              { character: '人', location: '地', item: '物', organization: '组', world_rule: '规' }[item.entityType]
            }}</span
            ><b>{{ item.canonicalName }}</b
            ><small>{{
              item.status === 'approved' ? '已确认' : item.status === 'candidate' ? '候选' : '已归档'
            }}</small>
          </button>
          <p v-if="!visibleWorldbookEntities.length">{{ storyEntities.length ? "没有匹配的条目。" : "尚未建立世界书条目。" }}</p>
        </div>
        <div class="story-entity-form">
          <label
            >类型<select
              v-assist-field="{
                id: 'AppShell.storyEntityDraft.entityType',
                read: () => storyEntityDraft.entityType,
                write: (value) => {
                  storyEntityDraft.entityType = String(value)
                },
                identity: () => storyEntityDraft
              }"
              v-model="storyEntityDraft.entityType"
            >
              <option value="character">人物</option>
              <option value="location">地点</option>
              <option value="item">物品</option>
              <option value="organization">组织</option>
              <option value="world_rule">世界规则</option>
            </select></label
          >
          <label
            >名称<input
              v-assist-field="{
                id: 'AppShell.storyEntityDraft.canonicalName',
                read: () => storyEntityDraft.canonicalName,
                write: (value) => {
                  storyEntityDraft.canonicalName = String(value)
                },
                identity: () => storyEntityDraft
              }"
              v-model="storyEntityDraft.canonicalName"
              maxlength="160"
              placeholder="例如：灵石"
          /></label>
          <label
            >状态<select v-model="storyEntityDraft.status">
              <option value="approved">已确认</option>
              <option value="candidate">候选</option>
              <option value="archived">归档</option>
            </select></label
          >
          <WorldbookEntryEditor v-model="storyEntityDraft.profileJson" :chapters="chapters" :entities="storyEntities" />
          <div class="section-action">
            <button class="control-button primary" type="button" :disabled="busy" @click="saveStoryEntity">
              <StudioIcon name="save" :size="16" />保存世界书条目</button
            ><button
              class="control-button secondary"
              type="button"
              @click="
                storyEntityDraft = {
                  id: '',
                  entityType: 'character',
                  canonicalName: '',
                  profileJson: '{}',
                  status: 'approved'
                }
              "
            >
              新建
            </button>
          </div>
        </div>
      </div>

      <section class="resource-ledger" data-testid="resource-ledger">
        <header>
          <div>
            <i>账</i
            ><span
              ><b>资源账本</b><small>金钱、道具与次数只在这里记变化；余额由历史自动累加，不能直接修改。</small></span
            >
          </div>
          <em>资源记录</em>
        </header>
        <div v-if="approvedResourceEntities.length" class="resource-ledger-grid">
          <div class="resource-balance-column">
            <button
              v-for="item in approvedResourceEntities"
              :key="item.id"
              type="button"
              :class="{ selected: resourceLedgerDraft.resourceEntityId === item.id }"
              @click="resourceLedgerDraft.resourceEntityId = item.id"
            >
              <span>{{ item.canonicalName }}</span>
              <b
                :class="{
                  negative: resourceLedger.balances.find((balance) => balance.resourceEntityId === item.id)?.isNegative
                }"
                >{{ resourceLedger.balances.find((balance) => balance.resourceEntityId === item.id)?.quantity ?? 0 }}</b
              >
            </button>
          </div>
          <div class="resource-entry-column">
            <div class="resource-current-balance">
              <span>当前余额</span
              ><b :class="{ negative: selectedResourceBalance?.isNegative }">{{
                selectedResourceBalance?.quantity ?? 0
              }}</b
              ><small v-if="selectedResourceBalance?.isNegative">余额为负，已提醒但不会阻止创作。</small>
            </div>
            <div class="resource-entry-form">
              <label
                >变化数量<input
                  v-assist-field="{
                    id: 'AppShell.resourceLedgerDraft.delta',
                    read: () => resourceLedgerDraft.delta,
                    write: (value) => {
                      resourceLedgerDraft.delta = String(value)
                    },
                    identity: () => resourceLedgerDraft
                  }"
                  v-model="resourceLedgerDraft.delta"
                  inputmode="numeric"
                  placeholder="增加填 3，消耗填 -1"
              /></label>
              <label
                >来源事件（可选）<input
                  v-model="resourceLedgerDraft.eventId"
                  maxlength="200"
                  placeholder="例如：第161章领取奖励"
              /></label>
              <label class="wide-field"
                >说明（可选）<input
                  v-assist-field="{
                    id: 'AppShell.resourceLedgerDraft.note',
                    read: () => resourceLedgerDraft.note,
                    write: (value) => {
                      resourceLedgerDraft.note = String(value)
                    },
                    identity: () => resourceLedgerDraft
                  }"
                  v-model="resourceLedgerDraft.note"
                  maxlength="2000"
                  placeholder="写清获得或消耗的原因"
              /></label>
              <button
                class="control-button primary"
                type="button"
                :disabled="busy"
                data-testid="append-resource-ledger"
                @click="appendResourceLedgerEntry"
              >
                <StudioIcon name="save" :size="16" />记入账本
              </button>
            </div>
            <ol v-if="selectedResourceEntries.length" class="resource-ledger-history">
              <li v-for="entry in selectedResourceEntries.slice(0, 50)" :key="entry.id">
                <time>{{ new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</time
                ><b :class="{ decrease: entry.delta < 0 }">{{ entry.delta > 0 ? '+' : '' }}{{ entry.delta }}</b
                ><span>余额 {{ entry.resultingQuantity }}</span
                ><small>{{ entry.note || entry.eventId || '未填写说明' }}</small>
              </li>
            </ol>
            <p v-else class="resource-ledger-empty">尚无记录。第一笔可以填初始数量，例如“100”。</p>
          </div>
        </div>
        <p v-else class="resource-ledger-empty">先新建一个“物品”并设为“已确认”，即可开始记录数量变化。</p>
      </section>

      <div class="story-relation-form">
        <b>资料关系</b>
        <div>
          <select v-model="storyRelationDraft.subjectEntityId">
            <option value="">关系主体</option>
            <option
              v-for="item in storyEntities.filter((item) => item.status === 'approved')"
              :key="item.id"
              :value="item.id"
            >
              {{ item.canonicalName }}
            </option></select
          ><input
            v-assist-field="{
              id: 'AppShell.storyRelationDraft.predicate',
              read: () => storyRelationDraft.predicate,
              write: (value) => {
                storyRelationDraft.predicate = String(value)
              },
              identity: () => storyRelationDraft
            }"
            v-model="storyRelationDraft.predicate"
            maxlength="160"
            placeholder="例如：驻守于"
          /><select v-model="storyRelationDraft.objectEntityId">
            <option value="">关系客体</option>
            <option
              v-for="item in storyEntities.filter((item) => item.status === 'approved')"
              :key="item.id"
              :value="item.id"
            >
              {{ item.canonicalName }}
            </option></select
          ><button class="control-button secondary" type="button" :disabled="busy" @click="saveStoryEntityRelation">
            保存关系
          </button>
        </div>
        <input
          v-assist-field="{
            id: 'AppShell.storyRelationDraft.notes',
            read: () => storyRelationDraft.notes,
            write: (value) => {
              storyRelationDraft.notes = String(value)
            },
            identity: () => storyRelationDraft
          }"
          v-model="storyRelationDraft.notes"
          maxlength="5000"
          placeholder="可选说明，例如：在旧港区设有哨所。"
        />
        <ul v-if="storyEntityRelations.length">
          <li v-for="item in storyEntityRelations" :key="item.id">
            {{ storyEntities.find((entity) => entity.id === item.subjectEntityId)?.canonicalName || '未知对象' }} ·
            {{ item.predicate }} ·
            {{ storyEntities.find((entity) => entity.id === item.objectEntityId)?.canonicalName || '未知对象'
            }}<small v-if="item.notes">{{ item.notes }}</small>
          </li>
        </ul>
      </div>
    </section>
    <section
      v-if="settingsSection === 'story' && !storyEntitiesLoaded"
      class="settings-section settings-page-section settings-empty"
    >
      <span>设</span>
      <div>
        <b>世界书尚未读取完成</b>
        <p>若读取失败，请重新进入此页重试；编辑草稿仍保留。</p>
        <button class="control-button secondary" type="button" :disabled="busy" @click="selectSettingsSection('story')">重新读取</button>
      </div>
    </section>
    <section
      v-if="settingsSection === 'prompts' && promptProfile && selectedPromptEntry"
      class="settings-section settings-page-section prompt-workshop"
      data-testid="prompt-workshop"
    >
      <header>
        <div>
          <b>题材提示词工坊</b
          ><small
            >当前题材：{{
              promptProfile.genreLabel
            }}。四类提示词分别服务谋篇、章纲、正文与审校，只影响以后生成的候选。</small
          >
        </div>
        <div class="prompt-source-marks">
          <span class="prompt-source-badge storage">{{
            promptProfile.storageMode === 'sqlite' ? 'SQLite 正式保存' : 'JSON 文件保存'
          }}</span
          ><span class="prompt-source-badge" :class="{ customized: selectedPromptEntry.customized }">{{
            selectedPromptEntry.customized ? '本书已修改' : '使用题材基线'
          }}</span>
        </div>
      </header>
      <div v-if="promptProfile.baselineChanged" class="prompt-baseline-warning" role="status">
        <b>题材基线已经变化</b><span>你修改过题材或细分类；本书覆写仍然保留。请核对后保存，或恢复新的题材基线。</span>
      </div>
      <div
        v-if="
          promptProfile.storageMode === 'sqlite' &&
          (promptProfile.mirrorStatus === 'conflict' || promptProfile.mirrorStatus === 'failed')
        "
        class="prompt-baseline-warning mirror"
        role="alert"
        data-testid="prompt-mirror-warning"
      >
        <b>{{ promptProfile.mirrorStatus === 'conflict' ? 'JSON 镜像有外部修改' : 'JSON 镜像暂未写入' }}</b
        ><span>SQLite 中的提示词仍然安全且继续生效。请到“项目数据”重新同步；应用不会覆盖外部修改。</span>
      </div>
      <details class="prompt-context-ledger" data-testid="prompt-context-ledger">
        <summary>
          <span><b>本次模型依据</b><small>发生冲突时严格按 1 → 5 服从，展开可查看来源</small></span
          ><em>{{ selectedPromptEntry.customized ? '本书提示词' : '题材基线' }}</em>
        </summary>
        <ol>
          <li v-for="layer in selectedPromptEntry.authorityLayers" :key="layer.id" :data-authority-id="layer.id">
            <i>{{ layer.order }}</i
            ><span
              ><b>{{ layer.label }}</b
              ><small>{{ layer.source }}</small></span
            >
            <p>{{ layer.summary }}</p>
          </li>
        </ol>
      </details>
      <nav class="prompt-task-tabs" aria-label="提示词任务">
        <button
          v-for="entry in promptProfile.entries"
          :key="entry.task"
          type="button"
          :class="{ selected: entry.task === selectedPromptTask, customized: entry.customized }"
          :aria-pressed="entry.task === selectedPromptTask"
          @click="selectPromptTask(entry.task)"
        >
          <span>{{ entry.label }}</span
          ><small>{{ entry.customized ? '已修改' : '内置' }}</small>
        </button>
      </nav>
      <div class="prompt-editor-grid">
        <label class="prompt-editor"
          ><span
            ><b>{{ selectedPromptEntry.label }}</b
            ><small>{{ selectedPromptEntry.description }}</small></span
          ><textarea
            v-assist-field="{
              id: 'AppShell.promptDraft',
              read: () => promptDraft,
              write: (value) => {
                promptDraft = String(value)
              }
            }"
            v-model="promptDraft"
            aria-label="当前任务提示词"
            spellcheck="false"
          ></textarea>
        </label>
        <aside class="prompt-safety-note">
          <span>不可编辑门禁</span><b>这些规则始终晚于自定义提示词注入，不能被关闭</b>
          <ul>
            <li v-for="item in selectedPromptEntry.guardrails" :key="item">{{ item }}</li>
          </ul>
        </aside>
      </div>
      <details class="prompt-built-in">
        <summary>查看当前题材的内置基线</summary>
        <pre>{{ selectedPromptEntry.builtIn }}</pre>
      </details>
      <footer>
        <div>
          <span>{{
            promptDraftDirty
              ? '有修改尚未保存'
              : selectedPromptEntry.customized
                ? '当前作品使用自定义提示词'
                : '当前作品跟随题材内置提示词'
          }}</span
          ><small
            >{{
              promptProfile.storageMode === 'sqlite'
                ? `正式数据已存入 SQLite${promptProfile.mirrorStatus === 'synced' ? '，JSON 可读镜像已同步' : ''}`
                : '当前由作品内 JSON 文件保存'
            }}；提示词不能改写已确认的大纲与正文。</small
          >
        </div>
        <div class="prompt-actions">
          <button
            class="control-button secondary"
            type="button"
            :disabled="!selectedPromptEntry.customized || busy"
            @click="resetPromptOverride"
          >
            恢复题材基线</button
          ><button
            class="control-button primary save-action"
            type="button"
            :disabled="!promptDraftDirty || busy"
            @click="savePromptOverride"
          >
            <StudioIcon name="save" :size="16" />保存本书提示词
          </button>
        </div>
      </footer>
    </section>
    <section
      v-if="settingsSection === 'prompts' && (!promptProfile || !selectedPromptEntry)"
      class="settings-section settings-page-section settings-empty"
      data-testid="settings-page-prompts-empty"
    >
      <span>词</span>
      <div>
        <b>请先在“作品定义”中选择小说类型</b>
        <p>岚笺会根据题材准备谋篇、章纲、正文与审校四类可修改提示词。</p>
      </div>
    </section>
    <CompanionSettings
      v-if="settingsSection === 'companion'"
      embedded
      :options="companionOptions"
      :error="companionError"
      :work-item="current?.path"
      :project-specific="companionProjectSpecific"
      @update="updateCompanionOptions"
      @scope="setCompanionProjectSpecific"
      @recover="recoverCompanionDefaults"
    />
    <template v-if="settingsSection === 'appearance'">
      <SoundPreferences />
      <ThemeSelector :model-value="themeChoice" :error="themeError" @update:model-value="selectTheme" />
      <section class="settings-section settings-page-section appearance-section">
        <header>
          <div><b>工作区宽度</b><small>也可以直接拖动左侧边栏右边缘</small></div>
        </header>
        <div class="appearance-sliders">
          <label
            ><span
              ><b>左侧边栏</b><small>{{ Math.round(explorerWidth) }} 像素</small></span
            ><input
              v-assist-field="{
                id: 'AppShell.explorerWidth',
                read: () => explorerWidth,
                write: (value) => {
                  explorerWidth = Number(value)
                  saveAppearancePreferences(false)
                }
              }"
              v-model.number="explorerWidth"
              type="range"
              min="200"
              max="420"
              step="4"
              @change="saveAppearancePreferences(false)"
          /></label>
          <label
            ><span
              ><b>智能助笔</b><small>{{ Math.round(assistantWidth) }} 像素</small></span
            ><input
              v-assist-field="{
                id: 'AppShell.assistantWidth',
                read: () => assistantWidth,
                write: (value) => {
                  assistantWidth = Number(value)
                  saveAppearancePreferences(false)
                }
              }"
              v-model.number="assistantWidth"
              type="range"
              min="280"
              max="720"
              step="4"
              @change="saveAppearancePreferences(false)"
          /></label>
        </div>
      </section>
      <section class="settings-section settings-page-section appearance-section">
        <header>
          <div><b>启动与恢复</b><small>这些偏好只保存在当前电脑</small></div>
        </header>
        <div class="preference-row">
          <p class="preference-status">
            <b>启动动画每次完整播放</b><small>初始化完成并播放三秒收束后，才会进入作品库</small>
          </p>
          <div class="appearance-actions">
            <button class="text-action compact" type="button" @click="resetAppearancePreferences">恢复默认界面</button
            ><button class="text-action compact" type="button" @click="replayOpening">现在重播</button
            ><button
              class="control-button primary compact save-action"
              type="button"
              @click="saveAppearancePreferences(true)"
            >
              <StudioIcon name="save" :size="15" />保存界面偏好
            </button>
          </div>
        </div>
      </section>
    </template>
    <section
      v-if="settingsSection === 'trial'"
      class="settings-section settings-page-section real-trial-section"
      data-testid="settings-page-real-trial"
    >
      <header>
        <div>
          <b>20—30 章真实试跑</b><small>只记录写作体验、人工负担与上下文成本；固定冲突样本在“项目数据”中单独评测</small>
        </div>
        <span class="real-trial-stage">{{
          realTrialReport ? `${realTrialReport.summary.chapterCount}/20 章` : '尚未开始'
        }}</span>
      </header>
      <div v-if="realTrialIssue" class="real-trial-unavailable">
        <i>测</i>
        <div>
          <b>完成 SQLite 正式切换后开始记录</b>
          <p>{{ realTrialIssue }}</p>
          <small>试跑记录属于作品数据，不会写进正文、设定或模型上下文。</small>
        </div>
        <button class="control-button secondary" type="button" @click="selectSettingsSection('project')">
          前往项目数据
        </button>
      </div>
      <template v-else-if="realTrialReport">
        <div class="real-trial-ledger">
          <div class="real-trial-progress">
            <span :style="{ width: `${Math.min(100, (realTrialReport.summary.chapterCount / 20) * 100)}%` }"></span>
          </div>
          <div class="real-trial-metrics">
            <article>
              <span>平均人工时间</span
              ><b>{{
                realTrialReport.summary.humanTimeRecordedChapters
                  ? `${realTrialReport.summary.averageHumanMinutes} 分钟`
                  : '尚未记录'
              }}</b
              ><small>{{
                realTrialReport.summary.humanTimeRecordedChapters
                  ? `已填 ${realTrialReport.summary.humanTimeRecordedChapters}/${realTrialReport.summary.chapterCount} 章；${realTrialReport.summary.averageReviewDecisions ? `另需审阅 ${realTrialReport.summary.averageReviewDecisions} 次 / 章` : '无需额外审阅决定'}`
                  : '耗时是可选项，未填写不会按 0 分钟计算'
              }}</small>
            </article>
            <article>
              <span>AI 任务</span
              ><b>{{
                realTrialReport.summary.aiSuccessRate === null
                  ? '尚无记录'
                  : `${Math.round(realTrialReport.summary.aiSuccessRate * 100)}% 成功`
              }}</b
              ><small
                >{{ realTrialReport.summary.aiSucceeded }}/{{ realTrialReport.summary.aiTasks }} 次 · 取消
                {{
                  realTrialReport.summary.aiCancellationRate === null
                    ? '—'
                    : `${Math.round(realTrialReport.summary.aiCancellationRate * 100)}%`
                }}
                · 重试
                {{
                  realTrialReport.summary.aiRetryRate === null
                    ? '—'
                    : `${Math.round(realTrialReport.summary.aiRetryRate * 100)}%`
                }}</small
              >
            </article>
            <article>
              <span>修改采用率</span><b>{{ trialPercent(realTrialReport.summary.diffAcceptanceRate) }}</b
              ><small>误应用 {{ realTrialReport.summary.misappliedChanges }} 次</small>
            </article>
            <article>
              <span>继续使用意愿</span><b>{{ trialPercent(realTrialReport.summary.continueNextChapterRate) }}</b
              ><small>平均满意度 {{ realTrialReport.summary.averageSatisfaction }}/5</small>
            </article>
          </div>
          <div class="real-trial-reliability" data-testid="real-trial-autosave-reliability">
            <span>自动护稿</span>
            <p v-if="realTrialReport.summary.autosaveCheckpoints">
              <b
                >{{ realTrialReport.summary.autosaveFinalized }}/{{
                  realTrialReport.summary.autosaveCheckpoints
                }}
                次已形成正式版本</b
              >
              · 无冲突完成率 {{ trialPercent(realTrialReport.summary.autosaveConflictFreeRate)
              }}<template v-if="realTrialReport.summary.autosaveConflicts">
                · {{ realTrialReport.summary.autosaveConflicts }} 次安全停在冲突核对</template
              ><template v-if="realTrialReport.summary.autosavePending">
                · {{ realTrialReport.summary.autosavePending }} 份待恢复</template
              ><template v-if="realTrialReport.summary.autosaveDiscarded">
                · {{ realTrialReport.summary.autosaveDiscarded }} 份已明确放弃</template
              >
            </p>
            <p v-else><b>本轮尚无自动保存记录</b> · 不据此判断可靠或失败</p>
          </div>
          <p class="real-trial-scope">{{ realTrialReport.scopeNotice }}</p>
        </div>

        <form class="real-trial-form" @submit.prevent="saveRealTrialChapter">
          <header>
            <div>
              <span>本章记录</span
              ><b>{{ realTrialExistingRecord ? '更新当前正文版本的体验' : '记录一章真实写作体验' }}</b>
            </div>
            <label
              >选择章节<select
                v-model.number="realTrialChapterId"
                data-testid="real-trial-chapter"
                @change="loadRealTrialDraft"
              >
                <option v-for="chapter in realTrialAvailableChapters" :key="chapter.id" :value="chapter.id">
                  第 {{ chapter.position }} 章 · {{ chapter.title }}
                </option>
              </select></label
            >
          </header>
          <div v-if="realTrialSelectedChapter" class="real-trial-form-body">
            <fieldset class="real-trial-quick-view">
              <legend>只回答两个问题即可保存</legend>
              <label
                >这章写得顺不顺<select
                  v-model.number="realTrialDraft.satisfaction"
                  data-testid="real-trial-satisfaction"
                >
                  <option :value="1">1 · 很不顺</option>
                  <option :value="2">2 · 不太顺</option>
                  <option :value="3">3 · 一般</option>
                  <option :value="4">4 · 顺手</option>
                  <option :value="5">5 · 很顺手</option>
                </select></label
              ><label class="continue-choice"
                ><input
                  v-model="realTrialDraft.continueNextChapter"
                  data-testid="real-trial-continue"
                  type="checkbox"
                /><span>下一章愿意继续使用</span></label
              ><label class="wide-field"
                >想记一句再写（可选）<textarea
                  v-assist-field="{
                    id: 'AppShell.realTrialDraft.notes',
                    read: () => realTrialDraft.notes,
                    write: (value) => {
                      realTrialDraft.notes = String(value)
                    },
                    identity: () => realTrialDraft
                  }"
                  v-model="realTrialDraft.notes"
                  maxlength="10000"
                  placeholder="例如：哪里卡住了，或什么真正帮到了我；可以留空"
                ></textarea>
              </label>
              <div class="real-trial-quick-actions wide-field">
                <small>其余数据由 SQLite 自动汇总；保存后同步可读报告。</small
                ><button
                  class="control-button primary save-action"
                  data-testid="save-real-trial-chapter"
                  type="submit"
                  :disabled="busy || !realTrialSelectedChapter"
                >
                  <StudioIcon name="save" :size="16" />保存本章记录
                </button>
              </div>
            </fieldset>
            <details class="real-trial-details" data-testid="real-trial-details">
              <summary>
                <span><b>补充详细记录</b><small>耗时、误应用、费用和绕开的功能；全部可选</small></span
                ><i aria-hidden="true">＋</i>
              </summary>
              <div class="real-trial-detail-grid">
                <fieldset>
                  <legend>人工时间（分钟）</legend>
                  <label
                    >规划<input
                      v-model.number="realTrialDraft.planningMinutes"
                      type="number"
                      min="0"
                      max="1440" /></label
                  ><label
                    >写作<input
                      v-model.number="realTrialDraft.writingMinutes"
                      data-testid="real-trial-writing-minutes"
                      type="number"
                      min="0"
                      max="1440" /></label
                  ><label
                    >AI 修改<input
                      v-model.number="realTrialDraft.aiEditingMinutes"
                      type="number"
                      min="0"
                      max="1440" /></label
                  ><label
                    >事实处理<input v-model.number="realTrialDraft.factReviewMinutes" type="number" min="0" max="1440"
                  /></label>
                </fieldset>
                <fieldset>
                  <legend>只在发生时填写</legend>
                  <label
                    >误应用次数<input
                      v-model.number="realTrialDraft.misappliedChanges"
                      type="number"
                      min="0"
                      max="100000" /></label
                  ><label
                    >模型费用<input
                      v-model="realTrialDraft.modelCost"
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.0001"
                      placeholder="不知道可留空" /></label
                  ><label class="wide-field"
                    >最常绕开的功能<input
                      v-assist-field="{
                        id: 'AppShell.realTrialDraft.bypassedFeatures',
                        read: () => realTrialDraft.bypassedFeatures,
                        write: (value) => {
                          realTrialDraft.bypassedFeatures = String(value)
                        },
                        identity: () => realTrialDraft
                      }"
                      v-model="realTrialDraft.bypassedFeatures"
                      maxlength="2000"
                      placeholder="没有可留空"
                  /></label>
                  <p class="real-trial-auto-note">
                    修改采用率和一致性提示的有用 / 误报数量读取 SQLite
                    中已经完成的作者决定，不需要再数一遍；“有意安排”不会被当成误报。
                  </p>
                </fieldset>
              </div>
            </details>
          </div>
          <div v-if="realTrialExistingRecord" class="real-trial-automatic">
            <span>自动记录</span>
            <p>
              自动保存 {{ realTrialExistingRecord.automatic.autosaveFinalized }}/{{
                realTrialExistingRecord.automatic.autosaveCheckpoints
              }}
              次 · 审阅决定
              {{
                realTrialExistingRecord.automatic.diffAcceptedBlocks +
                realTrialExistingRecord.automatic.diffRejectedBlocks +
                realTrialExistingRecord.automatic.factDecisions +
                realTrialExistingRecord.automatic.findingDecisions
              }}
              次 · AI {{ realTrialExistingRecord.automatic.aiTasks }} 次 · 接受
              {{ realTrialExistingRecord.automatic.diffAcceptedBlocks }} 块 / 保留
              {{ realTrialExistingRecord.automatic.diffRejectedBlocks }} 块 · 上下文约
              {{ realTrialExistingRecord.automatic.contextEstimatedTokens.toLocaleString() }} tokens · 事实候选
              {{ realTrialExistingRecord.automatic.factCandidates }} 条（同次提交
              {{ realTrialExistingRecord.automatic.factBatchSubmittedDecisions }}/{{
                realTrialExistingRecord.automatic.factDecisions
              }}）· 一致性提示 {{ realTrialExistingRecord.automatic.findings }} 条（有用
              {{ realTrialExistingRecord.automatic.usefulFindings }} / 误报
              {{ realTrialExistingRecord.automatic.falsePositiveFindings }}）
            </p>
          </div>
        </form>
        <form
          class="real-trial-conclusion"
          data-testid="real-trial-conclusion"
          @submit.prevent="saveRealTrialConclusion"
        >
          <header>
            <div><span>阶段结论</span><b>由作者决定下一轮怎么走</b></div>
            <small v-if="realTrialReport.summary.chapterCount < 20"
              >再记录 {{ 20 - realTrialReport.summary.chapterCount }} 章后开放</small
            ><small v-else>基于 {{ Math.min(30, realTrialReport.summary.chapterCount) }} 章真实记录</small>
          </header>
          <div v-if="realTrialReport.summary.chapterCount < 20" class="real-trial-conclusion-lock">
            <i>{{ realTrialReport.summary.chapterCount }}</i>
            <p>
              <b>先完成真实试跑，不提前下结论</b
              ><span>记录达到20章后，再整理问题优先级并决定继续、收缩或调整范围。</span>
            </p>
          </div>
          <template v-else>
            <fieldset class="real-trial-decision">
              <legend>范围决定</legend>
              <label :class="{ active: realTrialConclusionDraft.decision === 'continue' }"
                ><input v-model="realTrialConclusionDraft.decision" type="radio" value="continue" /><b>继续</b
                ><span>保留当前范围进入下一轮</span></label
              ><label :class="{ active: realTrialConclusionDraft.decision === 'narrow' }"
                ><input v-model="realTrialConclusionDraft.decision" type="radio" value="narrow" /><b>收缩</b
                ><span>砍掉负担高、收益低的环节</span></label
              ><label :class="{ active: realTrialConclusionDraft.decision === 'adjust' }"
                ><input v-model="realTrialConclusionDraft.decision" type="radio" value="adjust" /><b>调整</b
                ><span>保留闭环，修改流程或默认值</span></label
              >
            </fieldset>
            <div class="real-trial-priorities">
              <label
                ><span><b>高优先级</b><small>必须先解决</small></span
                ><textarea
                  v-assist-field="{
                    id: 'AppShell.realTrialConclusionDraft.highPriorityProblems',
                    read: () => realTrialConclusionDraft.highPriorityProblems,
                    write: (value) => {
                      realTrialConclusionDraft.highPriorityProblems = String(value)
                    },
                    identity: () => realTrialConclusionDraft
                  }"
                  v-model="realTrialConclusionDraft.highPriorityProblems"
                  maxlength="4000"
                  required
                  placeholder="一行一个问题，写清发生场景和影响"
                ></textarea></label
              ><label
                ><span><b>中优先级</b><small>下一轮处理</small></span
                ><textarea
                  v-assist-field="{
                    id: 'AppShell.realTrialConclusionDraft.mediumPriorityProblems',
                    read: () => realTrialConclusionDraft.mediumPriorityProblems,
                    write: (value) => {
                      realTrialConclusionDraft.mediumPriorityProblems = String(value)
                    },
                    identity: () => realTrialConclusionDraft
                  }"
                  v-model="realTrialConclusionDraft.mediumPriorityProblems"
                  maxlength="4000"
                  placeholder="可以延后，但会持续增加负担的问题"
                ></textarea></label
              ><label
                ><span><b>低优先级</b><small>暂不扩张</small></span
                ><textarea
                  v-assist-field="{
                    id: 'AppShell.realTrialConclusionDraft.lowPriorityProblems',
                    read: () => realTrialConclusionDraft.lowPriorityProblems,
                    write: (value) => {
                      realTrialConclusionDraft.lowPriorityProblems = String(value)
                    },
                    identity: () => realTrialConclusionDraft
                  }"
                  v-model="realTrialConclusionDraft.lowPriorityProblems"
                  maxlength="4000"
                  placeholder="锦上添花或证据尚不足的问题"
                ></textarea>
              </label>
            </div>
            <div class="real-trial-conclusion-notes">
              <label
                ><span>决策依据</span
                ><textarea
                  v-assist-field="{
                    id: 'AppShell.realTrialConclusionDraft.rationale',
                    read: () => realTrialConclusionDraft.rationale,
                    write: (value) => {
                      realTrialConclusionDraft.rationale = String(value)
                    },
                    identity: () => realTrialConclusionDraft
                  }"
                  v-model="realTrialConclusionDraft.rationale"
                  maxlength="10000"
                  required
                  placeholder="结合人工耗时、误报、采用率、失败率和继续使用意愿说明"
                ></textarea></label
              ><label
                ><span>下一阶段范围</span
                ><textarea
                  v-assist-field="{
                    id: 'AppShell.realTrialConclusionDraft.nextScope',
                    read: () => realTrialConclusionDraft.nextScope,
                    write: (value) => {
                      realTrialConclusionDraft.nextScope = String(value)
                    },
                    identity: () => realTrialConclusionDraft
                  }"
                  v-model="realTrialConclusionDraft.nextScope"
                  maxlength="10000"
                  required
                  placeholder="明确保留、删除、调整什么；不要把愿望清单当成已验证需求"
                ></textarea>
              </label>
            </div>
            <footer>
              <small>结论写入 SQLite，并随同一份试跑 JSON 报告导出；不会进入正文或 AI 上下文。</small
              ><button
                class="control-button primary save-action"
                data-testid="save-real-trial-conclusion"
                type="submit"
                :disabled="busy"
              >
                <StudioIcon name="save" :size="16" />保存阶段结论
              </button>
            </footer>
          </template>
        </form>
      </template>
    </section>
    <section
      v-if="settingsSection === 'about'"
      class="settings-section settings-page-section about-lanjian"
      data-testid="settings-page-about"
    >
      <header class="about-lanjian-hero">
        <div class="about-lanjian-seal" aria-hidden="true">岚</div>
        <div>
          <span>本地小说写作助手</span>
          <h3>岚笺</h3>
          <p>版本 {{ appVersion || '读取中…' }} · 单机单用户 MVP</p>
        </div>
      </header>
      <SponsorCard />
      <div class="about-principles">
        <article>
          <i>主</i>
          <div>
            <b>作者拥有最终决定</b>
            <p>AI 生成、修改、章卡方案和事实变化默认都是候选；只有你明确采用或确认后，才会进入正式正文与资料。</p>
          </div>
        </article>
        <article>
          <i>存</i>
          <div>
            <b>本地优先，可读可恢复</b>
            <p>
              新建或已迁移作品的正文与大纲直接保存为
              Markdown，数据库记录版本与资料关系；旧作品在安全迁移前保留原保存方式。AI
              或网络不可用时仍可手写、保存和恢复版本。
            </p>
          </div>
        </article>
        <article>
          <i>界</i>
          <div>
            <b>工具提供辅助，不承诺结果</b>
            <p>岚笺不保证小说好看、商业成功、零冲突或没有“AI 味”。一致性提示和表达建议都需要作者结合故事判断。</p>
          </div>
        </article>
      </div>
      <footer class="about-scope-note">
        <span>当前范围</span>
        <p>服务单人作者的本地创作闭环；不包含云同步、多人协作、自动发布和无人值守整书生成。</p>
      </footer>
    </section>
    <nav v-if="settingsSection === 'project'" class="data-page-navigation" aria-label="作品数据设置">
      <button v-for="page in dataPages" :key="page.id" type="button" :data-testid="`data-page-${page.id}`" :aria-current="dataPage === page.id ? 'page' : undefined" @click="selectDataPage(page.id)"><b>{{ page.label }}</b><small>{{ page.note }}</small></button>
    </nav>
    <section
      v-if="settingsSection === 'project' && migrationPreview"
      class="settings-section settings-page-section"
      v-show="dataPage === 'storage'"
      data-testid="settings-page-project"
    >
      <header>
        <div>
          <b>作品格式与版本</b
          ><small
            >{{ migrationPreview.format === 'lanjian-legacy' ? '旧版岚笺作品' : '当前岚笺作品' }} · 当前版本
            {{ migrationPreview.currentVersion }} · 应用版本 {{ migrationPreview.targetVersion }}</small
          >
        </div>
      </header>
      <div
        class="migration-card"
        :class="{
          required: migrationPreview.required,
          blocked: migrationPreview.required && !migrationPreview.canMigrate
        }"
      >
        <div>
          <b>{{
            migrationPreview.required
              ? migrationPreview.canMigrate
                ? '可以安全升级旧作品'
                : '需要先核对旧作品'
              : '项目数据版本正常'
          }}</b
          ><span>{{
            migrationPreview.required
              ? migrationPreview.canMigrate
                ? '升级前会备份旧清单并转换可识别配置；正文与大纲原样保留。'
                : '检测到不能自动判断的身份或章节冲突，已停止写入。'
              : '这是岚笺当前格式，可以直接打开，不需要重新导入。'
          }}</span>
        </div>
        <button
          v-if="migrationPreview.required && migrationPreview.canMigrate"
          class="text-action compact"
          type="button"
          :disabled="busy"
          @click="migrateProject"
        >
          确认并安全升级
        </button>
      </div>
      <div v-if="migrationPreview.issues.length" class="migration-issues" data-testid="migration-issues">
        <article v-for="issue in migrationPreview.issues" :key="issue.id" :class="issue.severity">
          <span>{{ issue.severity === 'blocker' ? '阻断' : issue.severity === 'attention' ? '待核' : '说明' }}</span>
          <div>
            <b>{{ issue.title }}</b>
            <p>{{ issue.message }}</p>
            <small v-for="evidence in issue.evidence" :key="evidence">{{ evidence }}</small>
          </div>
        </article>
      </div>
    </section>
    <section
      v-if="settingsSection === 'project' && migrationPreview"
      class="settings-section settings-page-section sqlite-shadow-section"
      v-show="dataPage === 'storage'"
      data-testid="sqlite-shadow-section"
    >
      <header>
        <div><b>作品存储</b><small>正文、大纲与结构化资料的保存方式</small></div>
        <span class="shadow-stage-mark">{{
          sqliteStorageStatus?.textAuthority === 'files-v1'
            ? '文件正文'
            : sqliteStorageStatus?.storageMode === 'sqlite'
              ? '旧版数据库正文'
              : sqliteStorageStatus?.storageMode === 'shadow'
                ? '影子就绪'
                : '文件阶段'
        }}</span>
      </header>
      <div
        v-if="sqliteStorageStatus?.textAuthority === 'files-v1'"
        class="shadow-migration-card formal-storage-card active"
        data-testid="file-text-authority"
      >
        <div class="shadow-migration-seal formal" aria-hidden="true">文</div>
        <div class="shadow-migration-copy">
          <b>正文与大纲直接保存为 Markdown</b>
          <p>
            {{ sqliteStorageStatus.chapterCount }} 章 · {{ sqliteStorageStatus.outlineCount }} 项大纲。SQLite
            只记录这些稿件的身份、顺序、版本引用和资料关系，不存放正文全文。
          </p>
          <small
            >历史快照保留在 .webnovel/history/text；缺失或外改的正文不会被数据库自动覆盖。AI
            候选与来源证据仍单独留存。</small
          >
        </div>
        <button class="control-button secondary" type="button" :disabled="busy" @click="retrySqliteMirrors">
          同步资料 JSON
        </button>
      </div>
      <div v-else class="shadow-migration-card" :class="{ complete: sqliteShadowResult }">
        <div class="shadow-migration-seal" aria-hidden="true">库</div>
        <div class="shadow-migration-copy">
          <b>{{
            sqliteStorageStatus?.databaseExists
              ? 'SQLite 副本已经建立'
              : migrationPreview.required
                ? '请先完成上方旧格式升级'
                : '先核对，再建立 SQLite 影子副本'
          }}</b>
          <p>
            {{
              sqliteStorageStatus?.databaseExists
                ? `数据库中已有 ${sqliteStorageStatus.chapterCount} 章；建立影子副本不会改变当前保存方式。`
                : '只读扫描章节、顺序和字数；确认后才会在作品内建立数据库，不接管编辑和保存。'
            }}
          </p>
          <small>{{
            sqliteStorageStatus?.databaseExists
              ? '.webnovel/workspace.sqlite'
              : '重复执行不会制造重复正文版本；删除影子数据库后，现有作品仍可照常打开。'
          }}</small>
        </div>
        <button
          v-if="sqliteStorageStatus?.storageMode !== 'sqlite'"
          class="control-button primary"
          data-testid="open-sqlite-shadow-migration"
          type="button"
          :disabled="busy || migrationPreview.required"
          @click="openSqliteShadowMigration"
        >
          <StudioIcon name="search" :size="16" />{{
            sqliteStorageStatus?.databaseExists ? '重新核对副本' : '核对迁移内容'
          }}
        </button>
      </div>
      <div v-if="sqliteStorageStatus?.storageMode === 'shadow'" class="shadow-migration-card formal-storage-card">
        <div class="shadow-migration-seal formal" aria-hidden="true">正</div>
        <div class="shadow-migration-copy">
          <b>影子副本已就绪，可以预演正式切换</b>
          <p>切换后，书稿保存和历史版本以 SQLite 为准；每次保存仍会同步写出可直接阅读的 Markdown。</p>
          <small>切换前会再次逐章核对，凭证只可使用一次；任何变化都会中止。</small>
        </div>
        <button
          class="control-button primary"
          data-testid="open-sqlite-activation"
          type="button"
          :disabled="busy"
          @click="openSqliteActivation"
        >
          <StudioIcon name="save" :size="16" />核对正式切换
        </button>
      </div>
      <div
        v-else-if="sqliteStorageStatus?.storageMode === 'sqlite' && sqliteStorageStatus?.textAuthority !== 'files-v1'"
        class="shadow-migration-card formal-storage-card active"
      >
        <div class="shadow-migration-seal formal" aria-hidden="true">正</div>
        <div class="shadow-migration-copy">
          <b
            >正文{{ sqliteStorageStatus.outlineStorageMode === 'sqlite' ? '、大纲' : ''
            }}{{ sqliteStorageStatus.promptStorageMode === 'sqlite' ? '与作品提示词' : '' }}正在由 SQLite 正式保存</b
          >
          <p>
            {{ sqliteStorageStatus.chapterCount }} 章<span v-if="sqliteStorageStatus.outlineStorageMode === 'sqlite'">
              · {{ sqliteStorageStatus.outlineCount }} 项大纲</span
            ><span v-if="sqliteStorageStatus.promptStorageMode === 'sqlite'">
              · 提示词 JSON
              {{
                sqliteStorageStatus.promptMirrorStatus === 'synced'
                  ? '已同步'
                  : sqliteStorageStatus.promptMirrorStatus
                    ? '待处理'
                    : '按需生成'
              }}</span
            >
            ·
            {{
              sqliteStorageStatus.pendingMirrors +
              sqliteStorageStatus.conflictMirrors +
              sqliteStorageStatus.failedMirrors
                ? `${sqliteStorageStatus.pendingMirrors + sqliteStorageStatus.conflictMirrors + sqliteStorageStatus.failedMirrors} 项镜像待处理`
                : 'Markdown 与 JSON 可读镜像已同步'
            }}
          </p>
          <small>外部修改不会被覆盖；镜像完全一致时可以安全退回文件保存。</small>
        </div>
        <div class="storage-card-actions">
          <button
            class="control-button secondary"
            data-testid="rebuild-readable-mirrors"
            type="button"
            :disabled="busy"
            title="从 SQLite 正式数据重新生成缺失的 Markdown 与 JSON；外部修改不会被覆盖"
            @click="rebuildReadableMirrors"
          >
            重建可读副本</button
          ><button
            v-if="
              sqliteStorageStatus.pendingMirrors +
              sqliteStorageStatus.conflictMirrors +
              sqliteStorageStatus.failedMirrors
            "
            class="control-button secondary"
            type="button"
            :disabled="busy"
            @click="retrySqliteMirrors"
          >
            重新同步</button
          ><button
            class="control-button primary"
            data-testid="rollback-sqlite-storage"
            type="button"
            :disabled="busy"
            @click="rollbackSqliteStorage"
          >
            安全退回文件模式
          </button>
        </div>
      </div>
    </section>
    <section
      v-if="settingsSection === 'project' && migrationPreview"
      class="settings-section settings-page-section workspace-backup-section"
      v-show="dataPage === 'backup'"
      data-testid="workspace-backup-section"
    >
      <header>
        <div><b>备份与恢复</b><small>保存完整作品副本；恢复时始终新建作品，不覆盖现在这一本</small></div>
        <span class="shadow-stage-mark">可校验</span>
      </header>
      <div class="shadow-migration-card backup-safety-card" :class="{ complete: workspaceBackupResult }">
        <div class="shadow-migration-seal" aria-hidden="true">备</div>
        <div class="shadow-migration-copy">
          <b>{{
            workspaceBackupResult
              ? '最近一次备份已通过完整性校验'
              : sqliteStorageStatus?.databaseExists
                ? '建立一致、可核对的作品备份'
                : '建立 SQLite 影子副本后即可备份'
          }}</b>
          <p>
            {{
              workspaceBackupResult
                ? `${workspaceBackupResult.chapterCount} 章 · ${workspaceBackupResult.fileCount} 个文件 · ${workspaceBackupResult.storageMode === 'sqlite' ? 'SQLite 正式存储' : 'SQLite 影子存储'}`
                : '备份包含 SQLite 一致快照、Markdown / JSON、设定和大纲；不会复制密钥，也不会直接拷贝正在使用的数据库文件。'
            }}
          </p>
          <small v-if="workspaceBackupResult" class="backup-result-path">{{ workspaceBackupResult.backupPath }}</small>
          <small v-else>保存期间若作品文件变化，本次备份会自动作废，不留下半成品。</small>
        </div>
        <div class="storage-card-actions">
          <button
            class="control-button secondary"
            data-testid="preview-workspace-restore"
            type="button"
            :disabled="busy"
            @click="openWorkspaceRestore"
          >
            <StudioIcon name="search" :size="16" />核对并恢复备份</button
          ><button
            class="control-button primary"
            data-testid="create-workspace-backup"
            type="button"
            :disabled="busy || !sqliteStorageStatus?.databaseExists"
            @click="createWorkspaceBackup"
          >
            <StudioIcon name="save" :size="16" />建立完整备份
          </button>
        </div>
      </div>
      <div class="shadow-migration-card manuscript-export-card" data-testid="manuscript-export-card">
        <div class="shadow-migration-seal export" aria-hidden="true">出</div>
        <div class="shadow-migration-copy">
          <b>导出一份干净的整书阅读稿</b>
          <p>
            按当前章序汇总书名、章节标题和正文，可选 TXT 或 Markdown；不会带出密钥、AI
            对话、版本记录、事实审批或检查结果。
          </p>
          <small>阅读稿用于阅读、投稿前整理或交给其他文本工具；完整迁移和恢复仍应使用上方作品备份。</small>
        </div>
        <button
          class="control-button secondary"
          data-testid="export-manuscript"
          type="button"
          :disabled="busy || !chapters.length"
          @click="exportManuscript"
        >
          <StudioIcon name="manuscript" :size="16" />导出阅读稿
        </button>
      </div>
      <div
        class="auto-backup-card"
        :class="[`state-${autoBackupStatus.state}`, { enabled: autoBackupDraft.enabled }]"
        data-testid="auto-backup-card"
      >
        <header>
          <div>
            <span>定时护稿</span><b>每日首次打开，并在有变化时按周期备份</b
            ><small>这是本机设置，备份路径不会写进作品数据库或可读镜像。</small>
          </div>
          <label class="auto-backup-switch"
            ><input
              v-assist-field="{
                id: 'AppShell.autoBackupDraft.enabled',
                read: () => autoBackupDraft.enabled,
                write: (value) => {
                  autoBackupDraft.enabled = Boolean(value)
                  autoBackupDraftDirty = true
                },
                identity: () => autoBackupDraft
              }"
              v-model="autoBackupDraft.enabled"
              type="checkbox"
              :disabled="autoBackupLoading || !sqliteStorageStatus?.databaseExists"
              data-testid="auto-backup-enabled"
              @change="autoBackupDraftDirty = true"
            /><span>{{ autoBackupDraft.enabled ? '已准备启用' : '保持手动' }}</span></label
          >
        </header>
        <div class="auto-backup-path">
          <span>保存文件夹</span><code>{{ autoBackupDraft.targetParentPath || '尚未选择' }}</code
          ><button
            class="text-action compact"
            type="button"
            :disabled="busy || autoBackupLoading"
            data-testid="choose-auto-backup-directory"
            @click="chooseAutoBackupDirectory"
          >
            选择
          </button>
        </div>
        <div class="auto-backup-options">
          <label
            ><span>每日首次打开</span
            ><span class="setting-switch-row"
              ><input
                v-assist-field="{
                  id: 'AppShell.autoBackupDraft.backupOnFirstOpen',
                  read: () => autoBackupDraft.backupOnFirstOpen,
                  write: (value) => {
                    autoBackupDraft.backupOnFirstOpen = Boolean(value)
                    autoBackupDraftDirty = true
                  },
                  identity: () => autoBackupDraft
                }"
                v-model="autoBackupDraft.backupOnFirstOpen"
                type="checkbox"
                :disabled="autoBackupLoading"
                data-testid="auto-backup-first-open"
                @change="autoBackupDraftDirty = true"
              /><b>{{ autoBackupDraft.backupOnFirstOpen ? '保留当日快照 · 起始建议' : '只按周期检查' }}</b></span
            ><small>可单独关闭，不影响下面的变化检查周期。</small></label
          >
          <label
            ><span>变化检查周期</span
            ><select
              v-assist-field="{
                id: 'AppShell.autoBackupDraft.intervalMinutes',
                read: () => autoBackupDraft.intervalMinutes,
                write: (value) => {
                  autoBackupDraft.intervalMinutes = Number(value)
                  autoBackupDraftDirty = true
                },
                identity: () => autoBackupDraft
              }"
              v-model.number="autoBackupDraft.intervalMinutes"
              :disabled="autoBackupLoading"
              data-testid="auto-backup-interval"
              @change="autoBackupDraftDirty = true"
            >
              <option :value="30">30 分钟 · 起始建议</option>
              <option :value="60">1 小时</option>
              <option :value="120">2 小时</option>
              <option :value="360">6 小时</option>
              <option :value="1440">24 小时</option></select
            ><small>这是可调整起始建议，只在作品发生变化时建立副本。</small></label
          >
          <label
            ><span>最多保留</span
            ><span class="auto-backup-retention"
              ><input
                v-assist-field="{
                  id: 'AppShell.autoBackupDraft.retentionCount',
                  read: () => autoBackupDraft.retentionCount,
                  write: (value) => {
                    autoBackupDraft.retentionCount = Number(value)
                    autoBackupDraftDirty = true
                  },
                  identity: () => autoBackupDraft
                }"
                v-model.number="autoBackupDraft.retentionCount"
                type="number"
                min="1"
                max="50"
                :disabled="autoBackupLoading"
                data-testid="auto-backup-retention"
                @input="autoBackupDraftDirty = true"
              /><i>份自动备份</i></span
            ><small>起始建议 10 份，可按磁盘空间调整。</small></label
          >
          <div class="auto-backup-state">
            <span>{{
              autoBackupStatus.lastSuccessAt
                ? `最近成功 ${autoBackupTime(autoBackupStatus.lastSuccessAt)}`
                : '还没有自动备份'
            }}</span
            ><small v-if="autoBackupStatus.lastError">{{ autoBackupStatus.lastError }}</small
            ><small v-else-if="autoBackupStatus.nextDueAt && autoBackupStatus.enabled"
              >下次检查 {{ autoBackupTime(autoBackupStatus.nextDueAt) }}</small
            ><small v-else>手动完整备份仍可随时使用。</small>
          </div>
        </div>
        <footer>
          <p>
            只有作品发生变化才建立周期副本；是否在每日首次打开时额外保留快照由上方设置决定。清理只处理岚笺标记的本书自动备份，不删除手动备份或其他文件夹。
          </p>
          <div>
            <button
              class="control-button secondary"
              type="button"
              :disabled="busy || autoBackupLoading || autoBackupRunning || !autoBackupStatus.enabled"
              data-testid="run-auto-backup"
              @click="runAutomaticBackup(true)"
            >
              {{ autoBackupRunning ? '正在核对…' : '现在检查' }}</button
            ><button
              class="control-button primary"
              type="button"
              :disabled="busy || autoBackupLoading || autoBackupRunning || !sqliteStorageStatus?.databaseExists"
              data-testid="save-auto-backup"
              @click="saveAutoBackupPreferences"
            >
              保存自动备份
            </button>
          </div>
        </footer>
      </div>
    </section>
    <section
      v-if="settingsSection === 'project'" v-show="dataPage === 'diagnostics'"
      class="settings-section settings-page-section consistency-evaluation-section"
      data-testid="consistency-evaluation-section"
    >
      <header>
        <div><b>一致性能力校验</b><small>固定样本与实际作品分开；这里只验证检查器，不读取或修改你的小说</small></div>
        <span class="shadow-stage-mark">220 条</span>
      </header>
      <div
        class="consistency-evaluation-card"
        :class="{ running: consistencyEvaluationJob?.status === 'running', complete: consistencyEvaluationSummary }"
      >
        <div class="shadow-migration-seal evaluation" aria-hidden="true">验</div>
        <div class="consistency-evaluation-copy">
          <b>{{
            consistencyEvaluationJob?.status === 'running'
              ? consistencyEvaluationJob.message
              : consistencyEvaluationSummary
                ? '最近一次固定样本评测已保存'
                : '用本书“校验与修订”模型核对语义样本'
          }}</b>
          <p v-if="consistencyEvaluationJob?.status === 'running'">
            已完成 {{ consistencyEvaluationJob.completedBatches }}/{{
              consistencyEvaluationJob.totalBatches
            }}
            组；可以停止，未完成结果不会写成正式报告。
          </p>
          <p v-else-if="consistencyEvaluationSummary">
            语义样本 {{ consistencyEvaluationSummary.semanticEvaluatedCount }}/{{
              consistencyEvaluationSummary.semanticSampleCount
            }}
            条已判断 · 漏报 {{ consistencyEvaluationSummary.semanticFalseNegative }} · 误报
            {{ consistencyEvaluationSummary.semanticFalsePositive }} · 无法判断
            {{ consistencyEvaluationSummary.semanticUnableToJudge }}
          </p>
          <p v-else>
            160 条确定性与文学性样本在本机直接运行；另用 5 组模型请求核对 60 条时间、身份、资源、规则、知情和动机样本。
          </p>
          <small v-if="consistencyEvaluationSummary"
            >{{ consistencyEvaluationSummary.modelVersion }} ·
            {{ evaluationTime(consistencyEvaluationSummary.completedAt) }} ·
            {{ consistencyEvaluationSummary.reportRelativePath }}</small
          >
          <small v-else>模型只会收到固定测试句，不会收到当前作品正文、设定、密钥或上下文包。</small>
          <div
            v-if="consistencyEvaluationJob?.status === 'running'"
            class="evaluation-progress"
            role="progressbar"
            :aria-valuenow="consistencyEvaluationJob.completedBatches"
            :aria-valuemax="consistencyEvaluationJob.totalBatches"
          >
            <i
              :style="{
                width: `${consistencyEvaluationJob.totalBatches ? (consistencyEvaluationJob.completedBatches / consistencyEvaluationJob.totalBatches) * 100 : 0}%`
              }"
            ></i>
          </div>
        </div>
        <button
          v-if="consistencyEvaluationJob?.status === 'running'"
          class="control-button secondary"
          data-testid="cancel-consistency-evaluation"
          type="button"
          @click="cancelConsistencyEvaluation"
        >
          停止评测
        </button>
        <button
          v-else
          class="control-button primary"
          data-testid="start-consistency-evaluation"
          type="button"
          :disabled="busy || !(ai.modelConfigured ?? ai.apiKeyConfigured)"
          @click="startConsistencyEvaluation"
        >
          <StudioIcon name="spark" :size="16" />{{ consistencyEvaluationSummary ? '重新评测' : '运行语义样本' }}
        </button>
      </div>
    </section>
    <section
      v-if="settingsSection === 'project' && !migrationPreview"
      class="settings-section settings-page-section settings-empty"
      data-testid="settings-page-project-empty"
    >
      <span>项</span>
      <div>
        <b>正在读取当前作品的数据版本</b>
        <p>这里仅用于格式诊断与安全迁移，不会自动改写正文或大纲。</p>
      </div>
    </section>
    <section
      v-if="settingsSection === 'research'"
      class="settings-section settings-page-section"
      data-testid="settings-page-research"
    >
      <header>
        <div><b>方舟联网连接</b><small>用于搜索公开网页。</small></div>
      </header>
      <div class="settings-form field-grid">
        <label class="wide-field">方舟接口地址<input v-model="researchSettings.baseUrl" /></label
        ><label
          >联网模型<select
            v-assist-field="{
              id: 'AppShell.researchSettings.model',
              read: () => researchSettings.model,
              write: (value) => {
                researchSettings.model = String(value)
              },
              identity: () => researchSettings
            }"
            v-model="researchSettings.model"
          >
            <option v-for="model in modelChoices(researchSettings.model)" :key="model" :value="model">
              {{ model }}
            </option>
          </select></label
        ><label
          >联网密钥<input
            v-model="researchSettings.apiKey"
            type="password"
            :placeholder="researchSettings.apiKeyConfigured ? '已经安全保存；留空表示不修改' : '请输入密钥'"
        /></label>
      </div>
      <div class="section-action">
        <button class="control-button primary" type="button" :disabled="busy" @click="saveResearchSettings">
          <StudioIcon name="save" :size="16" />保存联网采风
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-page .shadow-migration-card { background:var(--surface-muted); border-color:var(--line); }
.settings-page .shadow-migration-seal { color:var(--jade); background:var(--surface); border-color:var(--line); }
.settings-page .shadow-migration-copy p { color:var(--ink); }
.data-page-navigation { position:sticky; top:0; z-index:3; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); margin:0 0 24px; border:1px solid var(--line); background:var(--surface); }
.data-page-navigation button { display:grid; gap:6px; padding:16px 18px; text-align:left; color:var(--muted); background:transparent; border:0; border-bottom:2px solid transparent; transition:background-color 160ms,color 160ms,border-color 160ms; }
.data-page-navigation button + button { border-left:1px solid var(--line); }
.data-page-navigation button[aria-current] { border-bottom-color:var(--jade); color:var(--ink); background:var(--surface-muted); }
.data-page-navigation b { font:600 14px var(--sans); }.data-page-navigation small { font:11px/1.6 var(--sans); color:var(--muted); }
.data-page-navigation button:focus-visible { outline:2px solid var(--jade); outline-offset:-3px; }
@media(max-width:760px) { .data-page-navigation button { padding:12px 8px; }.data-page-navigation small { display:none; } }
@media(prefers-reduced-motion:reduce) { .data-page-navigation button { transition:none; } }

.settings-category-navigation button,
.settings-category-navigation button i { transition: color 160ms ease, background-color 160ms ease, border-color 160ms ease; }
.settings-category-navigation button i { transition: color 160ms ease, background-color 160ms ease, border-color 160ms ease, scale 120ms ease; }
.settings-category-navigation button:active i { scale: .9; }
.settings-page > :is(.settings-page-section, .theme-settings) { animation: settings-section-arrive 220ms var(--interaction-ease); }
@keyframes settings-section-arrive {
  from { opacity: .4; translate: 0 6px; }
  to { opacity: 1; translate: 0 0; }
}
@media (prefers-reduced-motion: reduce) {
  .settings-category-navigation button, .settings-category-navigation button i { transition: none !important; }
  .settings-category-navigation button:active i { scale: none; }
  .settings-page > :is(.settings-page-section, .theme-settings) { animation: none; }
}
:global(.redesigned-studio:not(.library-mode) .workbench > div.settings-editor.model-settings-page) {
  background-color:var(--canvas);
  background-image:linear-gradient(color-mix(in srgb,var(--muted) 8%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--muted) 8%,transparent) 1px,transparent 1px);
  background-size:64px 64px;
}
.settings-editor.model-settings-page > .model-workflow-heading { position:relative; align-items:center; gap:16px; margin-bottom:16px; padding:4px 0 22px; }
.model-workflow-heading::after { content:''; position:absolute; bottom:-1px; right:0; width:76px; height:6px; background:repeating-linear-gradient(130deg,#eaa247 0 5px,transparent 5px 10px); }
.model-workflow-heading .model-heading-title { padding-left:14px; border-left:3px solid var(--ink); }
.settings-editor.model-settings-page > .model-workflow-heading h2 { margin:6px 0 0; font:600 var(--type-display)/1.3 var(--serif); letter-spacing:.02em; }
.model-settings-page .model-workflow-heading .eyebrow { margin:0; color:var(--muted); font:10px/1.5 var(--sans); letter-spacing:.15em; }
.model-heading-context { display:grid; justify-items:end; gap:8px; min-width:0; max-width:55%; }
.model-heading-context > span { color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
.model-settings-page .model-heading-context button.archive-action.control-button { color:#f5f3eb; background:#25322b; border:1px solid #56685c; border-radius:0; gap:10px; }
.model-settings-page .model-heading-context button.archive-action.control-button:hover { background:#34473a; color:#f5f3eb; border-color:#809d8c; }
.settings-editor.model-settings-page > .settings-category-navigation { margin-bottom:22px; background:var(--canvas); }
@media(max-width:1000px) { .settings-editor.model-settings-page > .model-workflow-heading { gap:12px; } .model-heading-context { max-width:100%; } }
</style>
