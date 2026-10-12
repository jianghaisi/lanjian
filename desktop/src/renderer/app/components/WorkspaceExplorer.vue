<script setup>
import ChapterTreeList from '../../features/manuscript/components/ChapterTreeList.vue'
import ManuscriptExportDialog from '../../features/manuscript/components/ManuscriptExportDialog.vue'
import StudioIcon from '../../ui/StudioIcon.vue'
import { timelineEventTitle } from '../../features/timeline/timeline-workbench'
import { categoryForSettingsSection } from '../services/settings-navigation'
import { ref, toRefs } from 'vue'
import { ArrowDownUp, Download, Upload } from '@lucide/vue'

const props = defineProps({ scope: { type: Object, required: true } })
const {
  active,
  activeSettingsCategory,
  activeTitle,
  activeWorkspaceGroup,
  activeWorkspaceLeaf,
  approvedEvents,
  busy,
  candidateIdeaCount,
  canonicalEvents,
  chapterOrderIssue,
  chapterPosition,
  chapterTitle,
  chapterTrashEntries,
  chapterTrashOpen,
  chapterTreeQuery,
  chapters,
  characterAtlasCards,
  characterLinesError,
  characterLinesLoaded,
  characterLinesLoading,
  chooseForeshadow,
  current,
  eventPlacementLabel,
  explorerScrolling,
  exportSelectedChapters,
  foreshadowLedger,
  foreshadowLedgerLoaded,
  formatChapterTrashTime,
  ideas,
  importRecoveries,
  isTimelineEntryOpen,
  legacyLeafActivity,
  loadTimelineVolume,
  loading,
  manualSourceCount,
  materialSection,
  newChapter,
  noteExplorerScroll,
  openChapterTrash,
  openProject,
  openTxtImport,
  outlinePlanning,
  planningDraft,
  preparationMode,
  projects,
  recoverDamagedPlanningDraft,
  recoverDamagedPromptProfile,
  recoveryBusyId,
  requestDeleteChapter,
  researchEventsIssue,
  researchSourcesIssue,
  restoreDeletedChapter,
  resumeImportManifest,
  workspaceRecoveryBusy, workspaceRecoveryFeedback, recheckWorkspaceIssues,
  workspaceIssueDiagnostic, copyWorkspaceIssueDiagnostic,
  revealBootstrapIssue,
  sectionNavigation,
  selectChapter,
  selectSettingsSection,
  selectWorkspaceLeaf,
  selectedCharacterLineId,
  selectedForeshadowId,
  selectedId,
  selectedTimelineVolume,
  settingsSearch,
  settingsSearchResults,
  settingsSection,
  timeline,
  timelineEntryCount,
  timelineMode,
  timelineVolumeCards,
  toggleTimelineEntry,
  volumeLineRange,
  webSourceCount,
  workspaceBootstrapIssues,
  workspaceLeafTestId,
  worldMapDirty,
  worldMapView
} = toRefs(props.scope)
const transferMenu = ref(null)
const exportDialog = ref(null)
function positionTransferMenu(event) {
  const bounds = event.currentTarget.getBoundingClientRect()
  transferMenu.value.style.top = `${bounds.bottom + 6}px`
  transferMenu.value.style.left = `${Math.max(8, Math.min(bounds.right - 264, window.innerWidth - 280))}px`
}
function transfer(action) {
  transferMenu.value.hidePopover()
  if (action === 'export') return exportDialog.value?.open()
  return openTxtImport.value(action)
}
</script>

<template>
  <aside class="explorer" :class="{ 'is-scrolling': explorerScrolling }" @scroll.passive="noteExplorerScroll">
    <nav v-if="activeWorkspaceGroup.id === 'manuscript'" class="manuscript-view-nav" aria-label="书稿视图">
      <button type="button" data-nav-leaf="chapters" :aria-current="active === 'desk' ? 'page' : undefined" @click="selectWorkspaceLeaf('chapters')">正文</button>
      <button type="button" data-nav-leaf="review" :aria-current="active === 'review' ? 'page' : undefined" @click="selectWorkspaceLeaf('review')">审校</button>
    </nav>
    <div
      v-if="active === 'desk' && !chapterTrashOpen"
      class="chapter-explorer-tools"
      data-testid="chapter-explorer-tools"
    >
      <label class="chapter-explorer-search"
        ><StudioIcon name="search" :size="14" /><input
          v-assist-field="{
            id: 'AppShell.chapterTreeQuery',
            read: () => chapterTreeQuery,
            write: (value) => {
              chapterTreeQuery = String(value)
            }
          }"
          v-model="chapterTreeQuery"
          type="search"
          aria-label="查找章节"
          data-testid="chapter-tree-search"
          placeholder="搜索章节"
          autocomplete="off"
      /></label>
      <button
        type="button"
        class="chapter-new-compact"
        data-testid="archive-new-chapter"
        title="新建章节"
        aria-label="新建章节"
        :disabled="Boolean(chapterOrderIssue)"
        @click="newChapter"
      >
        <StudioIcon name="plus" :size="16" />
      </button>
      <button
        type="button"
        class="chapter-new-compact chapter-trash-compact"
        data-testid="open-chapter-trash"
        title="章节回收站"
        aria-label="打开章节回收站"
        @click="openChapterTrash"
      >
        <StudioIcon name="trash" :size="16" />
      </button>
      <button class="chapter-new-compact" type="button" aria-label="导入或导出文稿" title="导入 / 导出" data-testid="chapter-transfer-toggle" popovertarget="chapter-transfer-menu" @click="positionTransferMenu"><ArrowDownUp :size="16" /></button>
      <div ref="transferMenu" id="chapter-transfer-menu" class="chapter-transfer-menu" popover="auto" aria-label="文稿导入与导出">
        <button type="button" data-testid="import-manuscript-in-book" :disabled="busy" @click="transfer('inside-work-item')"><Upload :size="16"/><span>导入文稿<small>识别章节，勾选后新建或追加</small></span></button>
        <button type="button" data-testid="continue-manuscript-files" :disabled="busy" @click="transfer('create-from-files')"><Upload :size="16"/><span>从旧稿新建作品<small>添加多份正文、大纲和设定</small></span></button>
        <button type="button" data-testid="export-manuscript-in-book" :disabled="busy || !chapters.length || Boolean(chapterOrderIssue)" @click="transfer('export')"><Download :size="16"/><span>批量导出<small>选择章节或整书 · TXT / Markdown</small></span></button>
      </div>
    </div>
    <div v-else-if="active === 'desk'" class="chapter-trash-toolbar" aria-label="章节回收站">
      <button type="button" data-testid="close-chapter-trash" @click="chapterTrashOpen = false">
        <StudioIcon name="undo" :size="15" /><span>返回章节目录</span>
      </button>
    </div>
    <nav
      v-if="sectionNavigation.length && activeWorkspaceGroup.id !== 'manuscript'"
      class="section-navigation"
      aria-label="工作区目录"
    >
      <button
        v-for="item in sectionNavigation"
        :key="item.id"
        type="button"
        :data-activity="legacyLeafActivity(item.id, item.target.active)"
        :data-nav-leaf="item.id"
        :data-testid="workspaceLeafTestId(item.id)"
        :class="{ selected: activeWorkspaceLeaf?.id === item.id }"
        :aria-current="activeWorkspaceLeaf?.id === item.id ? 'page' : undefined"
        @click="selectWorkspaceLeaf(item.id)"
      >
        <StudioIcon :name="item.icon" :size="16" /><span
          ><b>{{ item.label }}</b
          ><small>{{ item.description }}</small></span
        >
      </button>
    </nav>
    <div v-if="activeWorkspaceGroup.id === 'settings'" class="pane-title settings-pane-title">
      <span>设置</span><small>{{ activeSettingsCategory.label }}</small>
    </div>

    <details
      v-for="recovery in active === 'settings' ? [] : importRecoveries"
      :key="recovery.id"
      class="import-recovery-card import-recovery-disclosure"
      data-testid="import-recovery"
    >
      <summary data-testid="import-recovery-summary">
        <span class="recovery-summary-main"
          ><i aria-hidden="true">续</i
          ><span
            ><b>{{ recovery.canResume ? '文稿接续待继续' : '文稿接续待核对' }}</b
            ><small>已完成 {{ recovery.completedCount }}/{{ recovery.totalCount }} 份</small></span
          ></span
        >
        <span class="recovery-summary-toggle"
          ><span class="when-closed">详情</span><span class="when-open">收起</span><StudioIcon name="arrow" :size="13"
        /></span>
      </summary>
      <div class="recovery-detail">
        <p>{{ recovery.message }}</p>
        <ul>
          <li v-for="file in recovery.files" :key="file.fileName">
            <span>{{ file.fileName }}</span
            ><small>{{
              file.status === 'completed'
                ? '已完成'
                : file.status === 'skipped'
                  ? '未采用'
                  : file.status === 'pending'
                    ? '待继续'
                    : '待核对'
            }}</small>
          </li>
        </ul>
        <button
          v-if="recovery.canResume"
          type="button"
          :disabled="Boolean(recoveryBusyId)"
          data-testid="resume-import-manifest"
          @click="resumeImportManifest(recovery)"
        >
          {{ recoveryBusyId === recovery.id ? '正在恢复…' : '继续未完成导入' }}
        </button>
        <span v-else class="recovery-blocked">已停止自动写入，请检查项目内恢复日志</span>
      </div>
    </details>

    <p v-if="workspaceRecoveryFeedback" class="workspace-recovery-feedback" role="status" data-testid="workspace-recovery-feedback">{{ workspaceRecoveryFeedback }}</p>
    <details
      v-if="workspaceBootstrapIssues.length"
      class="bootstrap-issue-group"
      data-testid="workspace-bootstrap-issues"
    >
      <summary data-testid="workspace-bootstrap-issues-summary">
        <span
          ><i aria-hidden="true">!</i
          ><span
            ><b>{{ workspaceBootstrapIssues.length }} 项资料尚未加载</b><small>展开查看原因和处理方式</small></span
          ></span
        >
        <span class="bootstrap-issue-toggle"
          ><span class="when-closed">处理</span><span class="when-open">收起</span
          ><StudioIcon name="chevron-right" :size="14"
        /></span>
      </summary>
      <div class="bootstrap-issue-list">
        <section
          v-for="issue in workspaceBootstrapIssues"
          :key="issue.id"
          class="import-recovery-card bootstrap-issue-card"
          data-testid="workspace-bootstrap-issue"
          :data-issue-id="issue.id"
        >
          <header>
            <span>{{ issue.title }}</span
            ><b>{{ issue.reason === 'busy' ? '可重新检查' : '原文件保留' }}</b>
          </header>
          <p>
            {{ issue.message }}
            {{
              issue.reason ? '' : issue.id === 'chapterOrderUnreadable'
                ? '每份正文仍可只读核对，但叙事顺序未知；岚笺没有覆盖账本或正文。'
                : '正式设定、大纲与正文仍可正常读取，岚笺没有覆盖原文件。'
            }}
          </p>
          <div v-if="['unifiedEventsUnreadable', 'modelSettingsUnreadable'].includes(issue.id)" class="workspace-recovery-actions">
            <button type="button" :disabled="busy || workspaceRecoveryBusy" data-testid="recheck-workspace-issues" @click="recheckWorkspaceIssues">
              {{ workspaceRecoveryBusy ? '正在检查…' : '重新检查' }}
            </button>
            <button type="button" class="workspace-recovery-secondary" data-testid="copy-workspace-diagnostic" @click="copyWorkspaceIssueDiagnostic(issue)">复制诊断信息</button>
            <details class="workspace-recovery-diagnostic"><summary>诊断信息</summary><pre>{{ workspaceIssueDiagnostic(issue) }}</pre></details>
          </div>
          <button
            v-if="issue.recovery === 'quarantinePlanningDraft'"
            type="button"
            data-testid="recover-damaged-planning-draft"
            :disabled="busy"
            @click="recoverDamagedPlanningDraft"
          >
            保留原文件并重新开始
          </button>
          <button
            v-else-if="issue.recovery === 'quarantinePromptProfile'"
            type="button"
            data-testid="recover-damaged-prompt-profile"
            :disabled="busy"
            @click="recoverDamagedPromptProfile"
          >
            保留原文件并使用内置提示词
          </button>
          <button
            v-else-if="issue.recovery === 'manualReview' && issue.reason !== 'busy'"
            type="button"
            :data-testid="`reveal-bootstrap-issue-${issue.id}`"
            :disabled="busy"
            @click="revealBootstrapIssue(issue)"
          >
            {{ issue.id === 'modelSettingsUnreadable' ? '核对模型设置' : '在文件管理器中定位' }}
          </button>
        </section>
      </div>
    </details>

    <template v-if="!current">
      <div class="tree-caption">
        <span>书稿工作项</span><b>{{ projects.length }}</b>
      </div>
      <div v-if="loading" class="tree-empty">正在整理书稿…</div>
      <div v-else-if="!projects.length" class="tree-empty">还没有书稿</div>
      <template v-else>
        <button
          v-for="project in projects"
          :key="project.path"
          class="tree-project"
          type="button"
          @click="openProject(project)"
        >
          <i></i
          ><span
            ><b>{{ project.title }}</b
            ><small>{{ project.genre || '未分类' }}</small></span
          >
        </button>
      </template>
    </template>

    <template v-else-if="active === 'desk'">
      <div v-if="chapterOrderIssue" class="tree-caption"><span>正文文件 / 顺序待核</span></div>
      <ChapterTreeList
        v-if="!chapterTrashOpen"
        v-model:query="chapterTreeQuery"
        external-search
        deletable
        :chapters="chapters"
        :selected-id="selectedId"
        :selected-title="chapterTitle"
        :volumes="outlinePlanning.volumes"
        :placements="outlinePlanning.chapterPlacements"
        @select="selectChapter"
        @delete="requestDeleteChapter"
      />
      <section v-else class="chapter-trash-list" aria-label="最近删除的章节" data-testid="chapter-trash-list">
        <article v-for="item in chapterTrashEntries" :key="item.id" class="chapter-trash-item">
          <span
            ><small>原第 {{ item.position }} 章 · {{ item.word_count.toLocaleString() }} 字</small
            ><b :title="item.title">{{ item.title }}</b
            ><small>{{ formatChapterTrashTime(item.deletedAt) }} 删除</small></span
          >
          <button
            type="button"
            :aria-label="`恢复第 ${item.position} 章《${item.title}》`"
            :disabled="busy || Boolean(chapterOrderIssue)"
            @click="restoreDeletedChapter(item)"
          >
            <StudioIcon name="restore" :size="14" /><span>恢复</span>
          </button>
        </article>
        <div v-if="!chapterTrashEntries.length" class="tree-empty rich">
          <b>回收站是空的</b><span>最近删除的章节会保存在这里。</span>
        </div>
      </section>
    </template>

    <template v-else-if="active === 'research'">
      <div class="tree-caption"><span>当前素材页</span></div>
      <div class="workspace-leaf-summary">
        <span class="file-glyph">{{
          materialSection === 'notes'
            ? '灵'
            : materialSection === 'manual'
              ? '录'
              : materialSection === 'research'
                ? '访'
                : '事'
        }}</span
        ><span
          ><b>{{ activeTitle }}</b
          ><small>{{
            materialSection === 'notes'
              ? ideas.length
                ? `${ideas.length} 条便签 · ${candidateIdeaCount} 条候选`
                : '随手记下一个想法'
              : materialSection === 'manual'
                ? researchSourcesIssue
                  ? '来源账本待核对'
                  : `${manualSourceCount} 份可追溯资料`
                : materialSection === 'research'
                  ? researchSourcesIssue
                    ? '来源账本待核对'
                    : `${webSourceCount} 份采风结果`
                  : researchEventsIssue
                    ? '事件账本待核对'
                    : `${canonicalEvents.length} 项候选与事实`
          }}</small></span
        >
      </div>
    </template>

    <template v-else-if="active === 'timeline'">
      <div class="tree-caption">
        <span>故事脉络</span
        ><b>{{
          timelineMode === 'map'
            ? (worldMapView?.events.length ?? '—')
            : timelineMode === 'events'
              ? timelineEntryCount
              : timelineMode === 'characters'
                ? characterAtlasCards.length
                : timelineMode === 'foreshadows'
                  ? foreshadowLedger.foreshadows.length
                  : timelineVolumeCards.length
        }}</b>
      </div>
      <template v-if="timelineMode === 'map'">
        <div class="tree-empty rich">
          先选择地点，再点击“定位”标注位置。这里保存的是小说沙盘，不推断实际方位或距离。
        </div>
        <div v-if="worldMapDirty" class="tree-empty rich" role="status">定位有调整，尚未保存。</div>
      </template>
      <template v-else-if="timelineMode === 'events'">
        <div v-if="researchEventsIssue" class="tree-empty rich">正式事件账本待核对；作者直接纪事仍可读取。</div>
        <button
          v-for="item in approvedEvents"
          :key="item.id"
          class="tree-item event-tree canonical"
          type="button"
          :class="{ selected: isTimelineEntryOpen('formal', item.id) }"
          @click="toggleTimelineEntry('formal', item.id)"
        >
          <span class="file-glyph">正</span
          ><span
            ><b>{{ timelineEventTitle(item.event) }}</b
            ><small>{{ eventPlacementLabel(item.id) }} · {{ item.time }}</small></span
          >
        </button>
        <button
          v-for="(item, index) in timeline"
          :key="item.id"
          class="tree-item event-tree"
          type="button"
          :class="{ selected: isTimelineEntryOpen('direct', item.id) }"
          @click="toggleTimelineEntry('direct', item.id)"
        >
          <span class="chapter-no">{{ String(index + 1).padStart(2, '0') }}</span
          ><span
            ><b>{{ timelineEventTitle(item.event, item.title) }}</b
            ><small>{{ item.time || '时间待定' }} · {{ item.location || '地点待定' }}</small></span
          >
        </button>
        <div v-if="!researchEventsIssue && !approvedEvents.length && !timeline.length" class="tree-empty">
          还没有正式事件或直接纪事
        </div>
      </template>
      <template v-else-if="timelineMode === 'characters'">
        <button
          v-for="line in characterAtlasCards"
          :key="line.characterId"
          class="tree-item timeline-character-tree"
          type="button"
          :class="{ selected: selectedCharacterLineId === line.characterId }"
          data-testid="timeline-character-line"
          @click="selectedCharacterLineId = line.characterId"
        >
          <span class="file-glyph">人</span
          ><span
            ><b>{{ line.name }}</b
            ><small
              >{{ line.points.length }} 个状态节点 · 至第 {{ line.points.at(-1)?.chapterPosition || '—' }} 章</small
            ></span
          >
        </button>
        <div v-if="characterLinesError" class="tree-empty rich" role="status">人物记录读取失败，请在右侧重试。</div>
        <div v-else-if="characterLinesLoading" class="tree-empty">正在读取人物记录…</div>
        <div v-else-if="characterLinesLoaded && !characterAtlasCards.length" class="tree-empty rich">
          所选章节范围还没有人物记录。确认人物事实后，这里会按章节形成轨迹。
        </div>
      </template>
      <template v-else-if="timelineMode === 'foreshadows'">
        <button
          v-for="item in foreshadowLedger.foreshadows"
          :key="item.id"
          class="tree-item timeline-foreshadow-tree"
          type="button"
          :class="{ selected: selectedForeshadowId === item.id }"
          data-testid="timeline-foreshadow-line"
          @click="chooseForeshadow(item)"
        >
          <span class="file-glyph">伏</span
          ><span
            ><b>{{ item.title }}</b
            ><small>{{
              item.status === 'open'
                ? '待回收'
                : item.status === 'resolved'
                  ? `已于第 ${item.payoffChapterId ? chapterPosition(item.payoffChapterId) : '—'} 章回收`
                  : '已废弃'
            }}</small></span
          >
        </button>
        <div v-if="foreshadowLedgerLoaded && !foreshadowLedger.foreshadows.length" class="tree-empty rich">
          还没有正式伏笔。可以在右侧手动埋设，或让已采用正文按章纲结算。
        </div>
        <div v-else-if="!foreshadowLedgerLoaded" class="tree-empty">正在整理伏笔账本…</div>
      </template>
      <template v-else>
        <button
          v-for="volume in timelineVolumeCards"
          :key="volume.volume"
          class="tree-item timeline-volume-tree"
          type="button"
          :class="{ selected: selectedTimelineVolume === volume.volume }"
          data-testid="timeline-volume-line"
          @click="loadTimelineVolume(volume.volume)"
        >
          <span class="file-glyph">{{ volume.volume }}</span
          ><span
            ><b>{{ volume.title }}</b
            ><small>{{ volumeLineRange(volume) }} · {{ volume.eventCount }} 项事件</small></span
          >
        </button>
        <div v-if="!timelineVolumeCards.length" class="tree-empty rich">尚未建立篇卷。请先在“谋篇”中建立卷目录。</div>
      </template>
    </template>

    <template v-else-if="active === 'preparation' && activeWorkspaceLeaf?.id === 'preparation'">
      <div class="tree-caption"><span>创作筹备</span><b>候选</b></div>
      <button
        class="tree-item"
        :class="{ selected: preparationMode === 'automatic' }"
        type="button"
        data-testid="preparation-automatic"
        @click="preparationMode = 'automatic'"
      >
        <span class="file-glyph">谋</span><span><b>自动筹备</b><small>从定义与素材生成可编辑候选</small></span>
      </button>
      <button
        class="tree-item"
        :class="{ selected: preparationMode === 'continuation' }"
        type="button"
        data-testid="preparation-continuation"
        @click="preparationMode = 'continuation'"
      >
        <span class="file-glyph">续</span><span><b>旧稿接续</b><small>核对导入文稿与原文证据</small></span>
      </button>
      <div class="preparation-order-note">
        <b>这里不直接改正式内容</b><span>采用候选后，仍需前往“设定”或“谋篇”复核确认。</span>
      </div>
    </template>

    <template v-else-if="activeWorkspaceLeaf?.id === 'chapter-skeleton'">
      <div class="tree-caption">
        <span>全书结构候选</span><b>{{ planningDraft?.chapterSkeleton?.chapters.length || 0 }} 章</b>
      </div>
      <div class="workspace-leaf-summary">
        <span class="file-glyph">骨</span><span><b>全书章节安排</b><small>按卷安排每章核心事件与停点</small></span>
      </div>
    </template>

    <template v-else-if="['world', 'realms', 'system'].includes(active)"></template>

    <template v-else-if="active === 'review'">
      <div class="tree-caption"><span>检查范围</span></div>
      <ChapterTreeList
        :chapters="chapters"
        :selected-id="selectedId"
        :selected-title="chapterTitle"
        @select="selectChapter"
      />
    </template>
    <template v-else-if="activeWorkspaceGroup.id === 'settings'">
      <label class="settings-search"
        ><StudioIcon name="search" :size="15" /><input
          v-assist-field="{
            id: 'AppShell.settingsSearch',
            read: () => settingsSearch,
            write: (value) => {
              settingsSearch = String(value)
            }
          }"
          v-model="settingsSearch"
          type="search"
          placeholder="搜索设置项"
          aria-label="搜索设置项" /><button
          v-if="settingsSearch"
          type="button"
          aria-label="清空设置搜索"
          @click="settingsSearch = ''"
        >
          <StudioIcon name="close" :size="13" /></button
      ></label>
      <div class="settings-category-heading">
        <span>{{ settingsSearch ? '搜索结果' : activeSettingsCategory.label }}</span
        ><small>{{
          settingsSearch ? `找到 ${settingsSearchResults.length} 项设置` : activeSettingsCategory.description
        }}</small>
      </div>
      <div class="settings-nav-group settings-category-sections">
        <button
          v-for="item in settingsSearchResults"
          :key="item.id"
          class="tree-item"
          :class="{ selected: settingsSection === item.id }"
          type="button"
          :data-testid="`settings-nav-${item.id}`"
          @click="selectSettingsSection(item.id)"
        >
          <span class="file-glyph">{{ item.mark }}</span
          ><span
            ><b>{{ item.label }}</b
            ><small v-if="settingsSearch"
              >{{ categoryForSettingsSection(item.id).label }} · {{ item.description }}</small
            ><small v-else>{{ item.description }}</small></span
          >
        </button>
        <p v-if="settingsSearch && !settingsSearchResults.length" class="settings-search-empty">
          没有找到相关设置。试试“模型”“备份”或“字体”。
        </p>
      </div>
      <details class="settings-material-note"><summary>人物与世界在哪里？</summary><p>在“设定”中管理人物、地点与世界规则。</p></details>
    </template>
    <ManuscriptExportDialog ref="exportDialog" :work-item="current" :chapters="chapters" :selected-id="selectedId" :volumes="outlinePlanning.volumes" :placements="outlinePlanning.chapterPlacements" :blocked="busy || Boolean(chapterOrderIssue)" :export-selection="exportSelectedChapters" />
  </aside>
</template>

<style scoped>
.workspace-recovery-feedback { margin: 10px; padding: 10px; border: 1px solid var(--jade); color: var(--ink); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.workspace-recovery-actions { display: grid; gap: 8px; margin-block: 10px; }
.workspace-recovery-actions .workspace-recovery-secondary { background: transparent; color: var(--ink); border: 1px solid var(--line); }
.workspace-recovery-diagnostic { color: var(--muted); font-size: 12px; }
.workspace-recovery-diagnostic pre { white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.chapter-transfer-menu { position:fixed; inset:auto; margin:0; width:264px; max-width:calc(100vw - 16px); padding:6px; border:1px solid var(--line); border-radius:4px; background:var(--surface); color:var(--ink); box-shadow:0 8px 24px #0004; }
.chapter-transfer-menu button { display:flex; align-items:center; gap:10px; width:100%; padding:10px; border:0; background:transparent; color:var(--ink); text-align:left; font:500 13px/1.4 var(--sans); cursor:pointer; }
.chapter-transfer-menu button:hover { background:var(--surface-muted); }
.chapter-transfer-menu button:disabled { opacity:.5; cursor:default; }
.chapter-transfer-menu button:focus-visible { outline:2px solid var(--jade); outline-offset:-2px; }
.chapter-transfer-menu small { display:block; margin-top:3px; color:var(--muted); font-size:11px; }
</style>
