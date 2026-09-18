<script setup>
import { genreCatalog } from '../../../../contracts/worldbuilding/genre-catalog'
import BookDefinitionForm from './BookDefinitionForm.vue'
import StudioIcon from '../../../ui/StudioIcon.vue'
import { toRefs } from 'vue'

const props = defineProps({ scope: { type: Object, required: true } })
const {
  active,
  adoptedPlanningVolumeCount,
  ai,
  autosaveCheckpointDelaySeconds,
  autosaveVersionIdleSeconds,
  bookProfile,
  bookSubgenreOptions,
  busy,
  cancelAutomaticPlanning,
  cancelPlanningChapterDetail,
  cancelPlanningChapterSkeleton,
  characterAliasDraft,
  characterAliasesLoaded,
  continuationAnalysis,
  continuationAreaLabels,
  continuationBlockedReason,
  continuationChapterTarget,
  continuationEligibleChapters,
  continuationGapLabels,
  continuationManifestId,
  continuationSelectedChapterConfirmed,
  continuationSelectedChapterReceipt,
  continuationSelectedVolumeConfirmed,
  continuationSelectedVolumeReceipt,
  continuationVolumeTarget,
  discardPlanningProposal,
  editCharacterAliases,
  generateContinuationAnalysis,
  groupedCharacterAliases,
  handleBookGenreChange,
  legacyBookSubgenre,
  markPlanningChapterDetailEdited,
  markPlanningCharacterSeedsEdited,
  markPlanningCheatSystemEdited,
  markPlanningPowerSystemEdited,
  markPlanningSkeletonEdited,
  markPlanningTotalEdited,
  markPlanningVolumeOutlineEdited,
  markPlanningVolumeStructureEdited,
  markPlanningWorldSeedEdited,
  newProjectGuide,
  nextPlanningChapterDetailCandidate,
  nextPlanningDetailVolume,
  nextPlanningVolumeCandidate,
  openChapterOutlineReview,
  openContinuationChapterOutlineAdoption,
  openContinuationCharacterEditor,
  openContinuationCheatSystemAdoption,
  openContinuationExistingPlotAdoption,
  openContinuationPowerSystemAdoption,
  openContinuationProjectDefinitionAdoption,
  openContinuationTotalOutlineAdoption,
  openContinuationVolumeOutlineAdoption,
  openContinuationWorldViewAdoption,
  openPlanningChapterDetailAdoption,
  openPlanningCharacterSeedAdoption,
  openPlanningCheatSystemAdoption,
  openPlanningPowerSystemAdoption,
  openPlanningRequirement,
  openPlanningTotalAdoption,
  openPlanningVolumeOutlineAdoption,
  openPlanningVolumeStructure,
  openPlanningWorldSeedAdoption,
  openTotalOutlineReview,
  openVolumeOutlineReview,
  outlinePlanning,
  planningAdoptionBusy,
  planningAdoptionGuidance,
  planningAdoptionMarker,
  planningAdoptionStageLabel,
  planningDetailJob,
  planningDetailRunning,
  planningDetailStatuses,
  planningDraft,
  planningDraftSaveState,
  planningFoundationAdoptedCount,
  planningFoundationReady,
  planningJob,
  planningMaterialsReady,
  planningRunning,
  planningSkeletonRunning,
  planningSkeletonStatus,
  planningSkeletonVolumes,
  planningStageLabel,
  planningTotalConfirmed,
  planningVolumesConfirmed,
  preparationMode,
  saveBookProfile,
  saveBookProfileAndContinue,
  saveCharacterAliases,
  saveContinuationAnalysis,
  selectWorkspaceLeaf,
  startAutomaticPlanning,
  startPlanningChapterDetail,
  startPlanningChapterSkeleton,
  updatePlanningChapterDetailList,
  updateSkeletonCharacters
} = toRefs(props.scope)
</script>

<template>
  <div class="profile-editor" :class="{ 'preparation-editor': active === 'preparation' }">
    <header v-if="active === 'profile'">
      <div>
        <p class="eyebrow">第 1 步 · 作品定义</p>
        <h2>先定下这是一部什么小说</h2>
        <p>这里保存本书独立的题材、篇幅和默认写作约束；人物、世界观与大纲仍在各自区域维护。</p>
      </div>
      <button
        v-if="!newProjectGuide"
        class="control-button primary save-action"
        type="button"
        :disabled="busy"
        @click="saveBookProfile"
      >
        <StudioIcon name="save" :size="16" />保存作品定义
      </button>
    </header>
    <section
      v-if="active === 'profile' && newProjectGuide"
      class="new-project-guide"
      role="status"
      data-testid="new-project-guide"
    >
      <div>
        <span>作品已建立</span><b>《{{ newProjectGuide.title }}》已安全保存在本地</b
        ><small
          >{{ newProjectGuide.path }}<br />先补全作品定义；继续后只会前往“素材 →
          灵感便签”，不会自动生成或确认正式内容。</small
        >
      </div>
      <button
        class="control-button primary"
        type="button"
        :disabled="busy"
        data-testid="save-profile-and-continue"
        @click="saveBookProfileAndContinue"
      >
        <StudioIcon name="save" :size="16" /><span>{{ busy ? '正在保存…' : '保存并继续到素材' }}</span>
      </button>
    </section>
    <header v-if="active === 'preparation'">
      <div>
        <p class="eyebrow">{{ preparationMode === 'skeleton' ? '谋篇 · 章节安排' : '谋篇 · 创作筹备' }}</p>
        <h2>
          {{
            preparationMode === 'automatic'
              ? '把素材整理成可修改的创作候选'
              : preparationMode === 'skeleton'
                ? '按卷安排全书章节与核心事件停点'
                : '从旧稿中核清事实与缺口'
          }}
        </h2>
        <p>
          {{
            preparationMode === 'automatic'
              ? '模型结果只放在候选工作区。人物、世界观和大纲采用后，仍要回到各自模块复核。'
              : preparationMode === 'skeleton'
                ? '每章先用几句话写核心事件、人物、地点和章末结果，再扩写详细章纲。这里保存的是候选；采用和正式确认会另行提示。'
                : '逐项核对原文证据；没有经过你采用的内容不会进入正式设定、大纲或正文。'
          }}
        </p>
      </div>
      <span class="candidate-safety-mark">候选不等于正式</span>
    </header>
    <section
      v-if="active === 'preparation' && preparationMode === 'continuation' && continuationBlockedReason"
      class="continuation-analysis blocked"
      data-testid="continuation-analysis-blocked"
    >
      <div>
        <p class="eyebrow">旧稿接续 · 已保护</p>
        <h3>接续分析候选需要人工核对</h3>
        <p>{{ continuationBlockedReason }}</p>
      </div>
    </section>
    <section
      v-else-if="active === 'preparation' && preparationMode === 'continuation' && continuationAnalysis"
      class="continuation-analysis"
      data-testid="continuation-analysis"
    >
      <header>
        <div>
          <p class="eyebrow">旧稿接续 · 模型整理候选</p>
          <h3>先核清已有事实，再决定怎样续写</h3>
          <p>以下内容仍是可编辑候选；保存不会写入正式设定、人物记忆或三级大纲。</p>
        </div>
        <button
          class="control-button primary compact save-action"
          type="button"
          data-testid="save-continuation-analysis"
          :disabled="busy"
          @click="saveContinuationAnalysis"
        >
          <StudioIcon name="save" :size="15" />保存候选修改
        </button>
      </header>
      <div class="continuation-gap-summary">
        <span v-for="level in ['required', 'conflict', 'recommended']" :key="level" :class="`gap-${level}`"
          ><b>{{ continuationAnalysis.gaps.filter((item) => item.level === level).length }}</b
          >{{ continuationGapLabels[level] }}</span
        >
      </div>
      <div v-if="continuationAnalysis.gaps.length" class="continuation-gaps">
        <article v-for="gap in continuationAnalysis.gaps" :key="gap.id" :class="`gap-${gap.level}`">
          <i>{{ gap.level === 'required' ? '必' : gap.level === 'conflict' ? '核' : '补' }}</i>
          <div>
            <b>{{ gap.title }}</b
            ><small>{{ gap.suggestion }}</small>
          </div>
        </article>
      </div>
      <div class="continuation-sections">
        <article
          v-for="section in continuationAnalysis.sections"
          :key="section.area"
          :class="`section-${section.status}`"
        >
          <header>
            <b>{{ continuationAreaLabels[section.area] }}</b>
            <div>
              <em v-if="section.area === 'projectDefinition' && continuationAnalysis.adoption?.projectDefinition"
                >已采用为核心设想</em
              ><em v-if="section.area === 'existingPlot' && continuationAnalysis.adoption?.existingPlot?.length"
                >已确认 {{ continuationAnalysis.adoption.existingPlot.length }} 项纪事</em
              ><em v-if="section.area === 'characters' && continuationAnalysis.adoption?.characters?.length"
                >已确认 {{ continuationAnalysis.adoption.characters.length }} 人</em
              ><em v-if="section.area === 'worldView' && continuationAnalysis.adoption?.worldView">已采用为世界观</em
              ><em v-if="section.area === 'powerSystem' && continuationAnalysis.adoption?.powerSystem"
                >已采用为力量总述</em
              ><em v-if="section.area === 'cheatSystem' && continuationAnalysis.adoption?.cheatSystem"
                >已采用为特殊优势</em
              ><em v-if="section.area === 'totalOutline' && continuationAnalysis.adoption?.totalOutline">{{
                planningTotalConfirmed ? '总纲已正式确认' : '已采用为正式总纲 · 待复核'
              }}</em
              ><em v-if="section.area === 'volumeOutline' && continuationAnalysis.adoption?.volumeOutlines?.length"
                >已落入 {{ continuationAnalysis.adoption.volumeOutlines.length }} 卷 · 待逐卷复核</em
              ><em v-if="section.area === 'chapterOutline' && continuationAnalysis.adoption?.chapterOutlines?.length"
                >已落入 {{ continuationAnalysis.adoption.chapterOutlines.length }} 章 · 待逐章确认</em
              ><span>{{
                section.status === 'found' ? '已有线索' : section.status === 'conflict' ? '存在冲突' : '尚未找到'
              }}</span>
            </div>
          </header>
          <textarea
            v-assist-field="{
              id: 'AppShell.section.content',
              read: () => section.content,
              write: (value) => {
                section.content = String(value)
              },
              identity: () => section
            }"
            v-model="section.content"
            :aria-label="`${continuationAreaLabels[section.area]}候选`"
            :placeholder="
              section.status === 'missing' ? '可以补写你的想法，或保留为空等待后续生成' : '核对并修改模型整理结果'
            "
          ></textarea>
          <details v-if="section.evidence.length">
            <summary>查看 {{ section.evidence.length }} 条原文证据</summary>
            <blockquote v-for="item in section.evidence" :key="`${item.fileName}:${item.excerpt}`">
              <b>{{ item.fileName }}</b
              ><span>{{ item.excerpt }}</span>
            </blockquote>
          </details>
          <footer v-if="section.area === 'projectDefinition'" class="continuation-section-action">
            <small>只会更新下方“核心设想”，不会改类别、细分类与篇幅。</small
            ><button
              class="ink-action compact-search"
              type="button"
              data-testid="preview-continuation-project-definition"
              :disabled="busy || !section.content.trim()"
              @click="openContinuationProjectDefinitionAdoption"
            >
              {{ continuationAnalysis.adoption?.projectDefinition ? '重新核对采用' : '预览影响并采用' }}
            </button>
          </footer>
          <footer v-else-if="section.area === 'existingPlot'" class="continuation-section-action">
            <small>不会把整段摘要直接定案；每次只补齐并确认一项时间、人物、地点、事件。</small
            ><button
              class="ink-action compact-search"
              type="button"
              data-testid="preview-continuation-existing-plot"
              :disabled="busy || !section.content.trim() || !section.evidence.length"
              @click="openContinuationExistingPlotAdoption"
            >
              逐项整理为正式纪事
            </button>
          </footer>
          <footer v-else-if="section.area === 'characters'" class="continuation-section-action">
            <small>每次只确认一人；稳定身份与人物弧和正文形成的动态状态分开保存。</small
            ><button
              class="ink-action compact-search"
              type="button"
              data-testid="open-continuation-character"
              :disabled="busy || !section.content.trim() || !section.evidence.length"
              @click="openContinuationCharacterEditor"
            >
              逐人核对人物锚点
            </button>
          </footer>
          <footer v-else-if="section.area === 'worldView'" class="continuation-section-action">
            <small>只更新本书可继续修改的世界观描述；不自动补规则，也不改力量、境界、特殊优势、大纲或正文。</small
            ><button
              class="ink-action compact-search"
              type="button"
              data-testid="preview-continuation-world-view"
              :disabled="busy || !section.content.trim() || !section.evidence.length"
              @click="openContinuationWorldViewAdoption"
            >
              {{ continuationAnalysis.adoption?.worldView ? '重新核对世界观' : '预览影响并采用' }}
            </button>
          </footer>
          <footer v-else-if="section.area === 'powerSystem'" class="continuation-section-action">
            <small>只更新力量体系的开放总述；不会拆分境界等级，也不会自动启用境界系统。</small
            ><button
              class="ink-action compact-search"
              type="button"
              data-testid="preview-continuation-power-system"
              :disabled="busy || !section.content.trim() || !section.evidence.length"
              @click="openContinuationPowerSystemAdoption"
            >
              {{ continuationAnalysis.adoption?.powerSystem ? '重新核对力量总述' : '预览影响并采用' }}
            </button>
          </footer>
          <footer v-else-if="section.area === 'cheatSystem'" class="continuation-section-action">
            <small>只更新金手指或特殊优势的开放总述；不会启用系统，也不会改写固定显示模板。</small
            ><button
              class="ink-action compact-search"
              type="button"
              data-testid="preview-continuation-cheat-system"
              :disabled="busy || !section.content.trim() || !section.evidence.length"
              @click="openContinuationCheatSystemAdoption"
            >
              {{ continuationAnalysis.adoption?.cheatSystem ? '重新核对特殊优势' : '预览影响并采用' }}
            </button>
          </footer>
          <footer v-else-if="section.area === 'totalOutline'" class="continuation-section-action">
            <small v-if="!continuationAnalysis.adoption?.totalOutline"
              >六类前置事实全部确认后，才可只写入正式总纲；采用不等于确认，也不会生成卷纲、章纲或正文。</small
            ><small v-else-if="!planningTotalConfirmed"
              >总纲已经进入正式编辑区，但尚未确认；请先完成本地结构检查，卷纲碎片继续保持候选。</small
            ><small v-else>当前总纲已正式确认；下一步才可逐卷核对旧稿卷纲碎片，仍不会自动生成章纲或正文。</small
            ><button
              v-if="!continuationAnalysis.adoption?.totalOutline"
              class="ink-action compact-search"
              type="button"
              data-testid="preview-continuation-total-outline"
              :disabled="busy || !section.content.trim() || !section.evidence.length"
              @click="openContinuationTotalOutlineAdoption"
            >
              预览影响并采用</button
            ><button
              v-else-if="!planningTotalConfirmed"
              class="ink-action compact-search"
              type="button"
              data-testid="review-continuation-total-outline"
              :disabled="busy"
              @click="openTotalOutlineReview"
            >
              前往谋篇复核总纲</button
            ><button
              v-else
              class="text-action compact"
              type="button"
              data-testid="view-confirmed-continuation-total-outline"
              :disabled="busy"
              @click="openTotalOutlineReview"
            >
              查看已确认总纲
            </button>
          </footer>
          <footer
            v-else-if="section.area === 'volumeOutline'"
            class="continuation-section-action continuation-volume-action"
          >
            <small v-if="!continuationAnalysis.adoption?.totalOutline"
              >先采用并确认父级总纲；卷纲候选不会提前写入。</small
            >
            <small v-else-if="!planningTotalConfirmed">父级总纲尚未正式确认；请先完成总纲复核。</small>
            <small v-else-if="!outlinePlanning.volumes.length"
              >请先在“谋篇”建立篇卷目录；系统不会从一段旧稿中猜测目标卷。</small
            >
            <small v-else>明确选择一卷后只写入该卷；其他卷纲、章纲和正文均不变化。</small>
            <label v-if="planningTotalConfirmed && outlinePlanning.volumes.length" class="continuation-volume-target"
              >目标卷
              <select
                v-assist-field="{
                  id: 'AppShell.continuationVolumeTarget',
                  read: () => continuationVolumeTarget,
                  write: (value) => {
                    continuationVolumeTarget = Number(value)
                  }
                }"
                v-model.number="continuationVolumeTarget"
                data-testid="continuation-volume-target"
              >
                <option :value="0">选择目标卷</option>
                <option v-for="volume in outlinePlanning.volumes" :key="volume.volume" :value="volume.volume">
                  第 {{ volume.volume }} 卷 · {{ volume.title }}
                </option>
              </select>
            </label>
            <button
              v-if="continuationSelectedVolumeReceipt"
              class="text-action compact"
              type="button"
              data-testid="review-continuation-volume-outline"
              :disabled="busy"
              @click="openVolumeOutlineReview(continuationVolumeTarget)"
            >
              {{ continuationSelectedVolumeConfirmed ? '查看已确认卷纲' : '前往谋篇复核本卷' }}
            </button>
            <button
              v-else-if="planningTotalConfirmed && outlinePlanning.volumes.length"
              class="ink-action compact-search"
              type="button"
              data-testid="preview-continuation-volume-outline"
              :disabled="busy || !continuationVolumeTarget || !section.content.trim() || !section.evidence.length"
              @click="openContinuationVolumeOutlineAdoption"
            >
              预览落入目标卷
            </button>
            <button v-else class="text-action compact" type="button" :disabled="busy" @click="openTotalOutlineReview">
              前往谋篇
            </button>
          </footer>
          <footer
            v-else-if="section.area === 'chapterOutline'"
            class="continuation-section-action continuation-volume-action"
          >
            <small v-if="!continuationAnalysis.adoption?.volumeOutlines?.length"
              >先采用一段父级卷纲并完成总纲、卷纲复核；章纲候选不会提前写入。</small
            >
            <small v-else-if="!continuationEligibleChapters.length"
              >请先在“谋篇”把已有章节归入已经确认的接续篇卷；系统不会猜测章序或新建章节。</small
            >
            <small v-else>明确选择一章后，只替换该章章纲；正文、标题、其他章纲与父级大纲保持不变。</small>
            <label v-if="continuationEligibleChapters.length" class="continuation-volume-target"
              >目标章节
              <select
                v-assist-field="{
                  id: 'AppShell.continuationChapterTarget',
                  read: () => continuationChapterTarget,
                  write: (value) => {
                    continuationChapterTarget = Number(value)
                  }
                }"
                v-model.number="continuationChapterTarget"
                data-testid="continuation-chapter-target"
              >
                <option :value="0">选择已有章节</option>
                <option v-for="chapter in continuationEligibleChapters" :key="chapter.id" :value="chapter.id">
                  第 {{ chapter.position }} 章 · {{ chapter.title }}
                </option>
              </select>
            </label>
            <button
              v-if="continuationSelectedChapterReceipt"
              class="text-action compact"
              type="button"
              data-testid="review-continuation-chapter-outline"
              :disabled="busy"
              @click="openChapterOutlineReview(continuationChapterTarget)"
            >
              {{ continuationSelectedChapterConfirmed ? '查看已确认章纲' : '前往谋篇复核本章' }}
            </button>
            <button
              v-else-if="continuationEligibleChapters.length"
              class="ink-action compact-search"
              type="button"
              data-testid="preview-continuation-chapter-outline"
              :disabled="busy || !continuationChapterTarget || !section.content.trim() || !section.evidence.length"
              @click="openContinuationChapterOutlineAdoption"
            >
              预览落入目标章
            </button>
            <button v-else class="text-action compact" type="button" :disabled="busy" @click="openTotalOutlineReview">
              前往谋篇
            </button>
          </footer>
        </article>
      </div>
      <label class="continuation-rationale"
        >整体判断<textarea
          v-assist-field="{
            id: 'AppShell.continuationAnalysis.rationale',
            read: () => continuationAnalysis.rationale,
            write: (value) => {
              continuationAnalysis.rationale = String(value)
            },
            identity: () => continuationAnalysis
          }"
          v-model="continuationAnalysis.rationale"
          aria-label="接续分析整体判断"
        ></textarea>
      </label>
    </section>
    <section
      v-else-if="active === 'preparation' && preparationMode === 'continuation' && continuationManifestId"
      class="continuation-analysis awaiting"
      data-testid="continuation-analysis-ready"
    >
      <div>
        <p class="eyebrow">旧稿接续 · 文件已经安全归档</p>
        <h3>生成可审阅的接续分析</h3>
        <p>模型会整理作品定义、已有剧情、人物、世界与三级大纲碎片，并标出硬缺口和冲突；不会自动采用。</p>
      </div>
      <button
        class="ink-action compact-search"
        type="button"
        data-testid="generate-continuation-analysis"
        :disabled="busy || !(ai.modelConfigured ?? ai.apiKeyConfigured)"
        @click="generateContinuationAnalysis"
      >
        {{ ai.apiKeyConfigured ? '开始整理旧稿' : '请先配置模型' }}
      </button>
    </section>
    <BookDefinitionForm
      v-if="active === 'profile'"
      v-model="bookProfile"
      v-model:aliases="characterAliasDraft"
      v-model:checkpoint-seconds="autosaveCheckpointDelaySeconds"
      v-model:version-seconds="autosaveVersionIdleSeconds"
      :busy="busy"
      :genre-catalog="genreCatalog"
      :book-subgenre-options="bookSubgenreOptions"
      :legacy-book-subgenre="legacyBookSubgenre"
      :character-aliases-loaded="characterAliasesLoaded"
      :grouped-character-aliases="groupedCharacterAliases"
      @genre-change="handleBookGenreChange"
      @edit-aliases="editCharacterAliases"
      @save-aliases="saveCharacterAliases"
    />
    <section v-if="active === 'profile' && !newProjectGuide" class="profile-next-step" data-testid="profile-next-step">
      <div>
        <span>下一步 · 素材 → 灵感便签</span><b>定义保存后，整理你已有的资料或发起联网采风</b
        ><small>有资料和采风可以一起使用；没有素材也可以先写几条自己的想法。前往素材不会自动生成或确认正式内容。</small>
      </div>
      <button class="control-button primary" type="button" @click="selectWorkspaceLeaf('ideas')">
        <span>前往素材</span><StudioIcon name="arrow" :size="15" />
      </button>
    </section>
    <section
      v-if="active === 'preparation' && preparationMode !== 'continuation'"
      class="planning-run"
      data-testid="planning-run"
    >
      <header>
        <div>
          <span>自动谋篇 · 候选工作区</span><b>从类别与素材，一次生成创作蓝图、总纲和卷纲</b
          ><small>分三阶段生成；停止、失败或切换书稿都不会改写正式设定与大纲。</small>
        </div>
        <button
          v-if="!planningRunning"
          class="ink-action compact-search"
          type="button"
          data-testid="start-planning"
          :disabled="busy || !planningMaterialsReady || !(ai.modelConfigured ?? ai.apiKeyConfigured)"
          @click="startAutomaticPlanning"
        >
          <StudioIcon name="spark" :size="16" />自动谋篇
        </button>
        <button
          v-else
          class="text-action compact"
          type="button"
          data-testid="cancel-planning"
          @click="cancelAutomaticPlanning()"
        >
          停止
        </button>
      </header>
      <p
        v-if="!planningRunning && (!planningMaterialsReady || !(ai.modelConfigured ?? ai.apiKeyConfigured))"
        class="workspace-action-hint"
        data-testid="planning-requirement-hint"
      >
        <span>{{
          !planningMaterialsReady
            ? '先补充作品素材，自动谋篇才有内容可以参考。'
            : '尚未配置可用的模型接口；你仍可直接在谋篇中手写。'
        }}</span
        ><button class="control-button secondary compact" type="button" @click="openPlanningRequirement">
          {{ !planningMaterialsReady ? '去整理素材' : '去设置接口' }}<StudioIcon name="arrow" :size="14" />
        </button>
      </p>
      <div v-if="planningJob" class="planning-progress" :class="planningJob.status">
        <div>
          <b>{{ planningStageLabel }}</b
          ><span>{{ planningJob.progress.completed }} / {{ planningJob.progress.total }}</span>
        </div>
        <progress :value="planningJob.progress.completed" :max="planningJob.progress.total"></progress>
        <small>{{ planningJob.progress.message }}</small>
        <p v-if="planningJob.error">{{ planningJob.error.message }}</p>
      </div>
    </section>
    <article
      v-if="active === 'preparation' && preparationMode !== 'continuation' && planningDraft"
      class="planning-proposal"
      data-testid="planning-proposal"
    >
      <header>
        <div>
          <span>{{ planningAdoptionStageLabel }}</span>
          <h3>{{ planningDraft.totalOutline.title }}</h3>
          <p>{{ planningDraft.blueprint.rationale }}</p>
          <small class="planning-save-label" :class="planningDraftSaveState">{{
            planningDraftSaveState === 'saving'
              ? '正在保存候选'
              : planningDraftSaveState === 'dirty'
                ? '候选有改动'
                : planningDraftSaveState === 'error'
                  ? '候选保存失败'
                  : '候选已保存到当前作品'
          }}</small>
        </div>
        <i>{{ planningAdoptionMarker }}</i>
      </header>
      <ol class="planning-adoption-order four-stage" aria-label="候选生成与采用顺序">
        <li :class="{ complete: planningFoundationReady, current: !planningFoundationReady }">
          <i>1</i
          ><span
            ><b>前置设定</b><small>人物、世界、力量、特殊优势 {{ planningFoundationAdoptedCount }}/4</small></span
          >
        </li>
        <li
          :class="{
            complete: Boolean(planningDraft.adoption?.totalOutline),
            current: planningFoundationReady && !planningDraft.adoption?.totalOutline
          }"
        >
          <i>2</i
          ><span
            ><b>全书总纲</b
            ><small>{{
              planningDraft.adoption?.totalOutline
                ? '已进入正式编辑区'
                : planningFoundationReady
                  ? '可以核对采用'
                  : '等待前置设定'
            }}</small></span
          >
        </li>
        <li
          :class="{
            complete: Boolean(planningDraft.adoption?.volumeStructure) && !nextPlanningVolumeCandidate,
            current:
              Boolean(planningDraft.adoption?.totalOutline) &&
              !(planningDraft.adoption?.volumeStructure && !nextPlanningVolumeCandidate)
          }"
        >
          <i>3</i
          ><span
            ><b>篇卷规划</b
            ><small>{{
              planningDraft.adoption?.volumeStructure
                ? `已采用 ${adoptedPlanningVolumeCount}/${planningDraft.volumes.length} 卷`
                : '等待总纲采用'
            }}</small></span
          >
        </li>
        <li
          :class="{
            complete: Boolean(planningDraft.chapterSkeleton) && !planningSkeletonStatus.stale,
            current: planningVolumesConfirmed && (!planningDraft.chapterSkeleton || planningSkeletonStatus.stale)
          }"
        >
          <i>4</i
          ><span
            ><b>章节安排</b
            ><small>{{
              planningDraft.chapterSkeleton
                ? planningSkeletonStatus.stale
                  ? '上游变化，待重生成'
                  : `${planningDraft.chapterSkeleton.chapters.length} 章已保存`
                : planningVolumesConfirmed
                  ? '可以按卷生成'
                  : '等待卷纲确认'
            }}</small></span
          >
        </li>
        <li
          :class="{
            complete:
              Boolean(planningDraft.chapterDetails?.length === planningDraft.volumes.length) &&
              !nextPlanningDetailVolume,
            current:
              Boolean(planningDraft.chapterSkeleton) &&
              !planningSkeletonStatus.stale &&
              Boolean(nextPlanningDetailVolume)
          }"
        >
          <i>5</i
          ><span
            ><b>详细章纲</b
            ><small>{{
              planningDraft.chapterDetails?.length
                ? `${planningDraft.chapterDetails.length}/${planningDraft.volumes.length} 卷候选`
                : '等待章节安排'
            }}</small></span
          >
        </li>
      </ol>
      <section class="planning-blueprint">
        <div>
          <b>核心命题</b>
          <p>{{ planningDraft.blueprint.premise }}</p>
        </div>
        <div class="planning-text-seed">
          <header><b>世界种子</b><em v-if="planningDraft.adoption?.worldSeed">已采用为世界观</em></header>
          <textarea
            v-assist-field="{
              id: 'AppShell.planningDraft.blueprint.worldView',
              read: () => planningDraft.blueprint.worldView,
              write: (value) => {
                planningDraft.blueprint.worldView = String(value)
                markPlanningWorldSeedEdited()
              },
              identity: () => planningDraft.blueprint
            }"
            v-model="planningDraft.blueprint.worldView"
            aria-label="世界种子"
            @input="markPlanningWorldSeedEdited"
          ></textarea
          ><small>这是一段可继续修改的开放描述，不要求现在穷尽时代、社会与规则；采用前只比较本书当前世界观。</small>
        </div>
        <div class="planning-character-seeds">
          <header><b>人物种子</b><em v-if="planningDraft.adoption?.characterSeeds">已建立稳定锚点</em></header>
          <ul>
            <li v-for="(item, index) in planningDraft.blueprint.characters" :key="index">
              <label
                >人物名<input
                  v-assist-field="{
                    id: 'AppShell.item.name',
                    read: () => item.name,
                    write: (value) => {
                      item.name = String(value)
                      markPlanningCharacterSeedsEdited()
                    },
                    identity: () => item
                  }"
                  v-model="item.name"
                  @input="markPlanningCharacterSeedsEdited" /></label
              ><label
                >初始角色定位<input
                  v-assist-field="{
                    id: 'AppShell.item.role',
                    read: () => item.role,
                    write: (value) => {
                      item.role = String(value)
                      markPlanningCharacterSeedsEdited()
                    },
                    identity: () => item
                  }"
                  v-model="item.role"
                  @input="markPlanningCharacterSeedsEdited" /></label
              ><label class="arc-field"
                >人物弧种子<textarea
                  v-assist-field="{
                    id: 'AppShell.item.arcSeed',
                    read: () => item.arcSeed,
                    write: (value) => {
                      item.arcSeed = String(value)
                      markPlanningCharacterSeedsEdited()
                    },
                    identity: () => item
                  }"
                  v-model="item.arcSeed"
                  @input="markPlanningCharacterSeedsEdited"
                ></textarea>
              </label>
            </li>
          </ul>
          <small>这里是可修改的初始方向；正文采用后，人物地点、关系、目标和实力等仍会逐章变化。</small>
        </div>
        <div class="planning-text-seed">
          <header><b>力量体系</b><em v-if="planningDraft.adoption?.powerSystem">已采用为体系总述</em></header>
          <textarea
            v-assist-field="{
              id: 'AppShell.planningDraft.blueprint.powerSystem',
              read: () => planningDraft.blueprint.powerSystem,
              write: (value) => {
                planningDraft.blueprint.powerSystem = String(value)
                markPlanningPowerSystemEdited()
              },
              identity: () => planningDraft.blueprint
            }"
            v-model="planningDraft.blueprint.powerSystem"
            aria-label="力量体系候选"
            placeholder="本书不需要力量体系时可以留空"
            @input="markPlanningPowerSystemEdited"
          ></textarea
          ><small>这里只描述力量、职业或成长机制；具体境界等级仍由作者在境界设定中确认。</small>
        </div>
        <div class="planning-text-seed">
          <header><b>金手指 / 特殊优势</b><em v-if="planningDraft.adoption?.cheatSystem">已采用为能力总述</em></header>
          <textarea
            v-assist-field="{
              id: 'AppShell.planningDraft.blueprint.cheatSystem',
              read: () => planningDraft.blueprint.cheatSystem,
              write: (value) => {
                planningDraft.blueprint.cheatSystem = String(value)
                markPlanningCheatSystemEdited()
              },
              identity: () => planningDraft.blueprint
            }"
            v-model="planningDraft.blueprint.cheatSystem"
            aria-label="金手指候选"
            placeholder="本书没有金手指时可以留空"
            @input="markPlanningCheatSystemEdited"
          ></textarea
          ><small>这里只定义能力、限制与代价；不会自动启用系统界面或写入固定显示模板。</small>
        </div>
      </section>
      <section
        v-if="planningDraft.chapterDetails?.length"
        class="planning-chapter-details"
        data-testid="chapter-detail-candidate"
      >
        <header>
          <div>
            <b>逐卷详细章纲候选</b
            ><small>进入状态 → 剧情节拍 → 退出状态，并明确允许扩写与禁止提前发生；尚未写入正式章纲。</small>
          </div>
          <em>{{ planningDraft.chapterDetails.length }}/{{ planningDraft.volumes.length }} 卷</em>
        </header>
        <details
          v-for="detail in planningDraft.chapterDetails"
          :key="detail.volume"
          class="detail-volume"
          :open="detail.volume === 1"
        >
          <summary>
            <b>第 {{ detail.volume }} 卷 · {{ planningDraft.volumes[detail.volume - 1]?.title }}</b
            ><small
              >{{ detail.chapters.length }} 章 ·
              {{
                planningDetailStatuses.find((item) => item.volume === detail.volume)?.stale
                  ? '上游变化，候选仅供比较'
                  : '候选可修改'
              }}</small
            >
          </summary>
          <div class="detail-chapters">
            <details v-for="chapter in detail.chapters" :key="chapter.chapter" class="detail-chapter">
              <summary>
                <i>{{ String(chapter.chapter).padStart(3, '0') }}</i
                ><b>{{ chapter.title }}</b
                ><em v-if="planningDraft.adoption?.chapterOutlines?.some((item) => item.chapter === chapter.chapter)"
                  >已写入正式章纲 · 待复核</em
                >
              </summary>
              <div>
                <label
                  >进入状态<textarea
                    v-assist-field="{
                      id: 'AppShell.chapter.entryState',
                      read: () => chapter.entryState,
                      write: (value) => {
                        chapter.entryState = String(value)
                        markPlanningChapterDetailEdited(chapter.chapter)
                      },
                      identity: () => chapter
                    }"
                    v-model="chapter.entryState"
                    :disabled="planningDetailRunning"
                    @input="markPlanningChapterDetailEdited(chapter.chapter)"
                  ></textarea>
                </label>
                <label
                  >剧情节拍（每行一项）<textarea
                    v-assist-field="{
                      id: 'AppShell.chapter.beats',
                      read: () => chapter.beats.join('\n'),
                      write: (value) => updatePlanningChapterDetailList(chapter, 'beats', String(value)),
                      identity: () => chapter
                    }"
                    :value="chapter.beats.join('\n')"
                    :disabled="planningDetailRunning"
                    @input="updatePlanningChapterDetailList(chapter, 'beats', $event.target.value)"
                  ></textarea>
                </label>
                <label
                  >退出状态<textarea
                    v-assist-field="{
                      id: 'AppShell.chapter.exitState',
                      read: () => chapter.exitState,
                      write: (value) => {
                        chapter.exitState = String(value)
                        markPlanningChapterDetailEdited(chapter.chapter)
                      },
                      identity: () => chapter
                    }"
                    v-model="chapter.exitState"
                    :disabled="planningDetailRunning"
                    @input="markPlanningChapterDetailEdited(chapter.chapter)"
                  ></textarea>
                </label>
                <label
                  >允许扩写（每行一项）<textarea
                    v-assist-field="{
                      id: 'AppShell.chapter.allowedFacts',
                      read: () => chapter.allowedFacts.join('\n'),
                      write: (value) => updatePlanningChapterDetailList(chapter, 'allowedFacts', String(value)),
                      identity: () => chapter
                    }"
                    :value="chapter.allowedFacts.join('\n')"
                    :disabled="planningDetailRunning"
                    @input="updatePlanningChapterDetailList(chapter, 'allowedFacts', $event.target.value)"
                  ></textarea>
                </label>
                <label
                  >禁止提前发生（每行一项）<textarea
                    v-assist-field="{
                      id: 'AppShell.chapter.forbiddenEvents',
                      read: () => chapter.forbiddenEvents.join('\n'),
                      write: (value) => updatePlanningChapterDetailList(chapter, 'forbiddenEvents', String(value)),
                      identity: () => chapter
                    }"
                    :value="chapter.forbiddenEvents.join('\n')"
                    :disabled="planningDetailRunning"
                    @input="updatePlanningChapterDetailList(chapter, 'forbiddenEvents', $event.target.value)"
                  ></textarea>
                </label>
              </div>
            </details>
          </div>
        </details>
      </section>
      <section class="planning-outline-candidate editable">
        <header><b>总纲候选</b><small>修改总纲会影响下面所有卷纲；采用前会比较正式总纲并列出下游影响。</small></header>
        <label
          >标题<input
            v-assist-field="{
              id: 'AppShell.planningDraft.totalOutline.title',
              read: () => planningDraft.totalOutline.title,
              write: (value) => {
                planningDraft.totalOutline.title = String(value)
                markPlanningTotalEdited()
              },
              identity: () => planningDraft.totalOutline
            }"
            v-model="planningDraft.totalOutline.title"
            @input="markPlanningTotalEdited" /></label
        ><label
          >全书走势<textarea
            v-assist-field="{
              id: 'AppShell.planningDraft.totalOutline.summary',
              read: () => planningDraft.totalOutline.summary,
              write: (value) => {
                planningDraft.totalOutline.summary = String(value)
                markPlanningTotalEdited()
              },
              identity: () => planningDraft.totalOutline
            }"
            v-model="planningDraft.totalOutline.summary"
            @input="markPlanningTotalEdited"
          ></textarea></label
        ><label
          >总纲正文<textarea
            v-assist-field="{
              id: 'AppShell.planningDraft.totalOutline.content',
              read: () => planningDraft.totalOutline.content,
              write: (value) => {
                planningDraft.totalOutline.content = String(value)
                markPlanningTotalEdited()
              },
              identity: () => planningDraft.totalOutline
            }"
            v-model="planningDraft.totalOutline.content"
            class="outline-body"
            @input="markPlanningTotalEdited"
          ></textarea>
        </label>
      </section>
      <section class="planning-volume-list editable">
        <article v-for="volume in planningDraft.volumes" :key="volume.order">
          <span
            ><b>第 {{ volume.order }} 卷</b
            ><em v-if="planningDraft.adoption?.volumeOutlines?.some((item) => item.order === volume.order)"
              >已采用 · 待确认</em
            ></span
          ><label
            >卷名<input
              v-assist-field="{
                id: 'AppShell.volume.title',
                read: () => volume.title,
                write: (value) => {
                  volume.title = String(value)
                  markPlanningVolumeStructureEdited()
                },
                identity: () => volume
              }"
              v-model="volume.title"
              @input="markPlanningVolumeStructureEdited" /></label
          ><label
            >本卷目标<input
              v-assist-field="{
                id: 'AppShell.volume.goal',
                read: () => volume.goal,
                write: (value) => {
                  volume.goal = String(value)
                  markPlanningVolumeOutlineEdited(volume.order)
                },
                identity: () => volume
              }"
              v-model="volume.goal"
              @input="markPlanningVolumeOutlineEdited(volume.order)" /></label
          ><label
            >事件链<textarea
              v-assist-field="{
                id: 'AppShell.volume.summary',
                read: () => volume.summary,
                write: (value) => {
                  volume.summary = String(value)
                  markPlanningVolumeOutlineEdited(volume.order)
                },
                identity: () => volume
              }"
              v-model="volume.summary"
              @input="markPlanningVolumeOutlineEdited(volume.order)"
            ></textarea></label
          ><label
            >卷末状态<textarea
              v-assist-field="{
                id: 'AppShell.volume.ending',
                read: () => volume.ending,
                write: (value) => {
                  volume.ending = String(value)
                  markPlanningVolumeOutlineEdited(volume.order)
                },
                identity: () => volume
              }"
              v-model="volume.ending"
              @input="markPlanningVolumeOutlineEdited(volume.order)"
            ></textarea>
          </label>
        </article>
      </section>
      <section
        v-if="planningDraft.chapterSkeleton"
        class="planning-chapter-skeleton"
        :class="{ stale: planningSkeletonStatus.stale }"
        data-testid="chapter-skeleton-candidate"
      >
        <header>
          <div>
            <b>全书章节安排</b
            ><small
              >{{ planningDraft.chapterSkeleton.chapters.length }} 章 · 单章目标
              {{ planningDraft.chapterSkeleton.targetWordsPerChapter }} 字 · 这里只定事件停点，不是详细章纲</small
            >
          </div>
          <em>{{ planningSkeletonStatus.stale ? '上游已变化' : '候选已保存' }}</em>
        </header>
        <p v-if="planningSkeletonStatus.stale" class="skeleton-stale-note">
          {{ planningSkeletonStatus.reason }}旧章节安排不会被删除，可在重新生成前保留比较。
        </p>
        <details
          v-for="volume in planningSkeletonVolumes"
          :key="volume.order"
          class="skeleton-volume"
          :open="volume.order === 1"
        >
          <summary>
            <i>{{ String(volume.order).padStart(2, '0') }}</i
            ><span
              ><b>第 {{ volume.order }} 卷 · {{ volume.title }}</b
              ><small>{{ volume.chapters.length }} 章 · {{ volume.goal }}</small></span
            >
          </summary>
          <ol>
            <li v-for="chapter in volume.chapters" :key="chapter.chapter">
              <span class="skeleton-number">{{ String(chapter.chapter).padStart(3, '0') }}</span>
              <label
                >章名<input
                  v-assist-field="{
                    id: 'AppShell.chapter.title',
                    read: () => chapter.title,
                    write: (value) => {
                      chapter.title = String(value)
                      markPlanningSkeletonEdited()
                    },
                    identity: () => chapter
                  }"
                  v-model="chapter.title"
                  :disabled="planningSkeletonRunning"
                  @input="markPlanningSkeletonEdited"
              /></label>
              <label class="skeleton-event"
                >核心事件<textarea
                  v-assist-field="{
                    id: 'AppShell.chapter.coreEvent',
                    read: () => chapter.coreEvent,
                    write: (value) => {
                      chapter.coreEvent = String(value)
                      markPlanningSkeletonEdited()
                    },
                    identity: () => chapter
                  }"
                  v-model="chapter.coreEvent"
                  :disabled="planningSkeletonRunning"
                  @input="markPlanningSkeletonEdited"
                ></textarea>
              </label>
              <label
                >人物<input
                  v-assist-field="{
                    id: 'AppShell.chapter.characters',
                    read: () => chapter.characters.join('、'),
                    write: (value) => updateSkeletonCharacters(chapter, String(value)),
                    identity: () => chapter
                  }"
                  :value="chapter.characters.join('、')"
                  :disabled="planningSkeletonRunning"
                  @input="updateSkeletonCharacters(chapter, $event.target.value)"
              /></label>
              <label
                >地点<input
                  v-assist-field="{
                    id: 'AppShell.chapter.location',
                    read: () => chapter.location,
                    write: (value) => {
                      chapter.location = String(value)
                      markPlanningSkeletonEdited()
                    },
                    identity: () => chapter
                  }"
                  v-model="chapter.location"
                  :disabled="planningSkeletonRunning"
                  @input="markPlanningSkeletonEdited"
              /></label>
              <label class="skeleton-result"
                >章末结果<textarea
                  v-assist-field="{
                    id: 'AppShell.chapter.result',
                    read: () => chapter.result,
                    write: (value) => {
                      chapter.result = String(value)
                      markPlanningSkeletonEdited()
                    },
                    identity: () => chapter
                  }"
                  v-model="chapter.result"
                  :disabled="planningSkeletonRunning"
                  @input="markPlanningSkeletonEdited"
                ></textarea>
              </label>
            </li>
          </ol>
        </details>
      </section>
      <footer>
        <button class="text-action compact" type="button" @click="discardPlanningProposal">放弃候选</button
        ><small>{{ planningAdoptionGuidance }}</small
        ><button
          v-if="!planningDraft.adoption?.characterSeeds"
          class="ink-action compact-search"
          type="button"
          data-testid="preview-character-seed-adoption"
          :disabled="planningAdoptionBusy || planningDraftSaveState === 'error'"
          @click="openPlanningCharacterSeedAdoption"
        >
          核对并建立人物锚点</button
        ><button
          v-else-if="!planningDraft.adoption?.worldSeed"
          class="ink-action compact-search"
          type="button"
          data-testid="preview-world-seed-adoption"
          :disabled="planningAdoptionBusy || planningDraftSaveState === 'error'"
          @click="openPlanningWorldSeedAdoption"
        >
          核对并采用世界种子</button
        ><button
          v-else-if="!planningDraft.adoption?.powerSystem"
          class="ink-action compact-search"
          type="button"
          data-testid="preview-power-system-adoption"
          :disabled="planningAdoptionBusy || planningDraftSaveState === 'error'"
          @click="openPlanningPowerSystemAdoption"
        >
          核对并采用力量体系</button
        ><button
          v-else-if="!planningDraft.adoption?.cheatSystem"
          class="ink-action compact-search"
          type="button"
          data-testid="preview-cheat-system-adoption"
          :disabled="planningAdoptionBusy || planningDraftSaveState === 'error'"
          @click="openPlanningCheatSystemAdoption"
        >
          核对并采用特殊优势</button
        ><button
          v-else-if="!planningDraft.adoption?.totalOutline"
          class="ink-action compact-search"
          type="button"
          data-testid="preview-total-adoption"
          :disabled="planningAdoptionBusy || planningDraftSaveState === 'error'"
          @click="openPlanningTotalAdoption"
        >
          预览影响并采用总纲</button
        ><button
          v-else-if="!planningDraft.adoption?.volumeStructure"
          class="ink-action compact-search"
          type="button"
          data-testid="preview-volume-structure"
          :disabled="planningAdoptionBusy || planningDraftSaveState === 'error'"
          @click="openPlanningVolumeStructure"
        >
          预览并建立篇卷目录</button
        ><button
          v-else-if="!planningTotalConfirmed"
          class="text-action compact"
          type="button"
          data-testid="review-total-after-volume-init"
          @click="openTotalOutlineReview"
        >
          前往总纲复核</button
        ><button
          v-else-if="nextPlanningVolumeCandidate"
          class="ink-action compact-search"
          type="button"
          data-testid="preview-volume-outline-adoption"
          :disabled="planningAdoptionBusy || planningDraftSaveState === 'error'"
          @click="openPlanningVolumeOutlineAdoption(nextPlanningVolumeCandidate.order)"
        >
          预览采用第 {{ nextPlanningVolumeCandidate.order }} 卷</button
        ><button
          v-else-if="!planningVolumesConfirmed"
          class="text-action compact"
          type="button"
          data-testid="review-adopted-volume-outlines"
          @click="
            openVolumeOutlineReview(
              planningDraft.volumes.find(
                (volume) =>
                  outlinePlanning.volumes.find((item) => item.volume === volume.order)?.approval?.status !== 'confirmed'
              )?.order || 1
            )
          "
        >
          前往卷纲复核</button
        ><button
          v-else-if="planningSkeletonRunning"
          class="ink-action compact-search is-stopping"
          type="button"
          data-testid="cancel-chapter-skeleton"
          @click="cancelPlanningChapterSkeleton"
        >
          <span>停止生成 · 不保留半套</span></button
        ><button
          v-else-if="!planningDraft.chapterSkeleton || planningSkeletonStatus.stale"
          class="ink-action compact-search"
          type="button"
          data-testid="start-chapter-skeleton"
          :disabled="planningDraftSaveState === 'error'"
          @click="startPlanningChapterSkeleton"
        >
          {{ planningDraft.chapterSkeleton ? '重新生成全书章节安排' : '生成全书章节安排' }}</button
        ><button
          v-else-if="planningDetailRunning"
          class="ink-action compact-search is-stopping"
          type="button"
          data-testid="cancel-chapter-detail"
          @click="cancelPlanningChapterDetail"
        >
          停止第 {{ planningDetailJob.volume }} 卷生成</button
        ><button
          v-else-if="nextPlanningDetailVolume"
          class="ink-action compact-search"
          type="button"
          data-testid="start-chapter-detail"
          :disabled="planningDraftSaveState === 'error'"
          @click="startPlanningChapterDetail(nextPlanningDetailVolume.order)"
        >
          生成第 {{ nextPlanningDetailVolume.order }} 卷详细章纲</button
        ><button
          v-else-if="nextPlanningChapterDetailCandidate"
          class="ink-action compact-search"
          type="button"
          data-testid="preview-chapter-detail-adoption"
          :disabled="planningAdoptionBusy || planningDraftSaveState === 'error'"
          @click="openPlanningChapterDetailAdoption(nextPlanningChapterDetailCandidate.chapter)"
        >
          预览采用第 {{ nextPlanningChapterDetailCandidate.chapter }} 章章纲</button
        ><span v-else class="planning-completion-note">详细章纲已逐章写入正式编辑区；请复核确认后再生成正文。</span>
      </footer>
    </article>
  </div>
</template>
