<script setup>
import ArchivePageHeader from '../../../ui/ArchivePageHeader.vue'
import StudioIcon from '../../../ui/StudioIcon.vue'
import { toRefs } from 'vue'

const props = defineProps({ scope: { type: Object, required: true } })
const {
  activeIdeas,
  addResearchToMaterials,
  ai,
  approveCanonicalEvent,
  beginEventCandidate,
  busy,
  candidateIdeaCount,
  canonicalEvents,
  createEventCandidate,
  creatingIdea,
  creatingSource,
  editIdeaGenerationOption,
  eventDraft,
  formatRevisionTime,
  foundation,
  ideaDraft,
  ideaDraftDirty,
  ideaGenerationInstruction,
  ideaGenerationRunning,
  ideaGenerationStatus,
  ideaSourceIssue,
  ideaSourceTask,
  ideas,
  loadIdeaSource,
  manualSourceCount,
  manualSources,
  materialSearch,
  materialSection,
  materialSectionInfo,
  openIdea,
  openSourceCard,
  promoteIdeaToSummary,
  promoteIdeaToWorldRule,
  researchEventsIssue,
  researchQuery,
  researchResult,
  researchSettings,
  researchSourcesIssue,
  retryIdeaGeneration,
  runResearch,
  saveFoundation,
  saveIdea,
  saveSourceCard,
  selectedEventSource,
  selectedIdea,
  selectedIdeaGenerations,
  selectedIdeaId,
  selectedIdeaSourceOption,
  selectedSource,
  selectedSourceId,
  sourceCards,
  sourceDraft,
  sourceDraftDirty,
  sourceOriginLabel,
  startIdea,
  startIdeaGeneration,
  startSourceCard,
  stopIdeaGeneration,
  visibleMaterialSources,
  webSourceCount,
  webSources
} = toRefs(props.scope)
</script>

<template>
  <div class="source-editor material-workbench archive-page">
    <ArchivePageHeader eyebrow="02 / SOURCE ARCHIVE · 创作素材" :title="materialSectionInfo.title" :description="materialSectionInfo.description">
      <div v-if="materialSection === 'notes'" class="material-counts" aria-label="灵感概况">
        <span>便签 {{ ideas.length }}</span
        ><span>候选 {{ candidateIdeaCount }}</span
        ><span>已提升 {{ ideas.filter((item) => item.promotedToId).length }}</span>
      </div>
      <div v-else class="material-counts" aria-label="素材概况">
        <span>自备 {{ researchSourcesIssue ? '待核对' : manualSourceCount }}</span
        ><span>采风 {{ researchSourcesIssue ? '待核对' : webSourceCount }}</span
        ><span
          >待确认
          {{
            researchEventsIssue ? '待核对' : canonicalEvents.filter((item) => item.status === 'candidate').length
          }}</span
        >
      </div>
    </ArchivePageHeader>

    <section
      v-if="materialSection === 'notes'"
      class="material-section material-ideas-view"
      data-testid="material-notes-view"
    >
      <details class="foundation-note-card" data-testid="foundation-note-card">
        <summary>
          <span
            ><b>全书备注</b
            ><small>{{
              foundation.sourceNotes.trim() ? '已保存长期创作方向' : '可选：记录全书共同遵循的方向'
            }}</small></span
          ><i>展开</i>
        </summary>
        <div>
          <label
            >长期创作方向<textarea
              v-assist-field="{
                id: 'AppShell.foundation.sourceNotes',
                read: () => foundation.sourceNotes,
                write: (value) => {
                  foundation.sourceNotes = String(value)
                },
                identity: () => foundation
              }"
              v-model="foundation.sourceNotes"
              data-testid="foundation-notes-input"
              placeholder="写下全书共同遵循的基调、边界或核心想法……"
            ></textarea></label
          ><button
            class="control-button primary compact save-action"
            type="button"
            :disabled="busy"
            data-testid="save-foundation-notes"
            @click="saveFoundation"
          >
            <StudioIcon name="save" :size="15" />保存全书备注
          </button>
        </div>
      </details>
      <div class="material-catalog-view idea-catalog-view">
        <aside class="material-catalog source-list idea-catalog">
          <header>
            <div>
              <b>灵感便签</b
              ><small
                >候选 {{ candidateIdeaCount }} · 已批准
                {{ ideas.filter((item) => item.status === 'approved').length }}</small
              >
            </div>
            <button class="control-button secondary compact" type="button" data-testid="new-idea" @click="startIdea">
              <StudioIcon name="plus" :size="15" />新建
            </button>
          </header>
          <div class="material-source-list idea-list" data-testid="idea-list">
            <button
              v-for="idea in activeIdeas"
              :key="idea.id"
              type="button"
              :class="{ selected: selectedIdeaId === idea.id }"
              @click="openIdea(idea)"
            >
              <span
                ><b>{{ idea.title }}</b
                ><small>{{ idea.content }}</small></span
              ><em :class="`idea-status-${idea.status}`">{{
                idea.promotedToId ? '已提升' : idea.status === 'approved' ? '已批准' : '候选'
              }}</em>
            </button>
            <p v-if="!activeIdeas.length">还没有灵感。先记一句，不必一次写完整设定。</p>
          </div>
        </aside>
        <form
          v-if="creatingIdea || selectedIdea"
          class="source-detail-editor source-capture idea-editor"
          data-testid="idea-editor"
          @submit.prevent="saveIdea()"
        >
          <header>
            <div>
              <b>{{ creatingIdea ? '新建灵感' : '整理灵感' }}</b
              ><small>便签始终保留；提升只会复制一份到正式设定。</small>
            </div>
            <span v-if="ideaDraftDirty">尚未保存</span>
          </header>
          <label
            >标题<input
              v-assist-field="{
                id: 'AppShell.ideaDraft.title',
                read: () => ideaDraft.title,
                write: (value) => {
                  ideaDraft.title = String(value)
                },
                identity: () => ideaDraft
              }"
              v-model="ideaDraft.title"
              maxlength="200"
              data-testid="idea-title-input"
              placeholder="一句能认出来的名字"
          /></label>
          <label
            >想法<textarea
              v-assist-field="{
                id: 'AppShell.ideaDraft.content',
                read: () => ideaDraft.content,
                write: (value) => {
                  ideaDraft.content = String(value)
                },
                identity: () => ideaDraft
              }"
              v-model="ideaDraft.content"
              maxlength="50000"
              data-testid="idea-content-input"
              placeholder="人物反差、世界规则、桥段、冲突或一句对白都可以……"
            ></textarea>
          </label>
          <div v-if="selectedIdea?.promotedToId" class="idea-promotion-state">
            <span>{{
              selectedIdea.promotedToType === 'summary' ? '已创建正式梗概 · 在谋篇的总纲中编辑' : '已复制为正式世界设定'
            }}</span
            ><small>以后修改便签不会覆盖正式内容。</small>
          </div>
          <details v-if="selectedIdea?.generationSource" class="idea-origin" data-testid="idea-origin">
            <summary>
              <span
                ><b>查看 AI 候选来源</b
                ><small v-if="ideaSourceTask"
                  >{{ ideaSourceTask.mode === 'diverge' ? '灵感发散' : '梗概方案' }} ·
                  {{ formatRevisionTime(ideaSourceTask.createdAt) }} · {{ ideaSourceTask.model }}</small
                ><small v-else>{{ ideaSourceIssue || '正在读取来源……' }}</small></span
              ><i aria-hidden="true">›</i>
            </summary>
            <div v-if="selectedIdeaSourceOption" data-testid="idea-origin-content">
              <b>{{ selectedIdeaSourceOption.title }}</b>
              <p>{{ selectedIdeaSourceOption.content }}</p>
              <small>{{ selectedIdeaSourceOption.rationale }}</small
              ><em>当前便签可能经过你的修改；这里始终显示当时被采用的原候选。</em>
            </div>
            <div v-else-if="ideaSourceIssue" class="idea-origin-error">
              <p>{{ ideaSourceIssue }}</p>
              <button
                class="control-button secondary compact"
                type="button"
                @click="loadIdeaSource(selectedIdea.generationSource)"
              >
                重新读取
              </button>
            </div>
          </details>
          <section v-if="selectedIdea" class="idea-generation" data-testid="idea-generation">
            <header>
              <b>与 AI 讨论这条灵感</b><small>跟随谋篇模型 · 格式失败按本书设置修复 · 不自动修改正式内容</small>
            </header>
            <label
              >本次方向（可选）<input
                v-assist-field="{
                  id: 'AppShell.ideaGenerationInstruction',
                  read: () => ideaGenerationInstruction,
                  write: (value) => {
                    ideaGenerationInstruction = String(value)
                  }
                }"
                v-model="ideaGenerationInstruction"
                maxlength="2000"
                placeholder="例如：多些喜剧反差，保留主角吐槽"
            /></label>
            <div class="idea-generation-actions">
              <button
                class="control-button secondary compact"
                type="button"
                data-testid="idea-diverge"
                :disabled="
                  busy || ideaDraftDirty || ideaGenerationRunning || !(ai.modelConfigured ?? ai.apiKeyConfigured)
                "
                @click="startIdeaGeneration('diverge')"
              >
                发散灵感</button
              ><button
                class="control-button secondary compact"
                type="button"
                data-testid="idea-synopsis"
                :disabled="
                  busy || ideaDraftDirty || ideaGenerationRunning || !(ai.modelConfigured ?? ai.apiKeyConfigured)
                "
                @click="startIdeaGeneration('synopsis')"
              >
                生成梗概方案
              </button>
            </div>
            <small v-if="ideaDraftDirty">先保存便签修改，再生成。</small
            ><small v-else-if="!(ai.modelConfigured ?? ai.apiKeyConfigured)">请先在设置中配置谋篇模型连接。</small>
            <article
              v-for="task in selectedIdeaGenerations"
              :key="task.id"
              class="idea-generation-result"
              data-testid="idea-generation-result"
            >
              <header>
                <b>{{ task.mode === 'diverge' ? '灵感发散' : '梗概方案' }}</b
                ><small>{{ ideaGenerationStatus[task.status] }} · {{ task.model }}</small
                ><button
                  v-if="['queued', 'preparing', 'running', 'streaming'].includes(task.status)"
                  class="control-button secondary compact"
                  type="button"
                  @click="stopIdeaGeneration(task.id)"
                >
                  停止</button
                ><button
                  v-else-if="['failed', 'cancelled', 'interrupted'].includes(task.status)"
                  class="control-button secondary compact"
                  type="button"
                  :data-testid="`retry-idea-generation-${task.id}`"
                  :disabled="busy || ideaGenerationRunning || task.sourceStale"
                  @click="retryIdeaGeneration(task.id)"
                >
                  重试
                </button>
              </header>
              <p v-if="task.error">{{ task.error }}</p>
              <p v-if="task.sourceStale">原灵感已修改：这些是旧版本方案，仍可查看，请重新生成后再采用。</p>
              <details v-if="task.rawResult" class="idea-generation-raw">
                <summary>查看模型最初返回的内容</summary>
                <p>{{ task.rawResult }}</p>
              </details>
              <details v-for="(option, index) in task.proposal?.options || []" :key="index" :open="index === 0">
                <summary>{{ option.title }}</summary>
                <p class="idea-option-content">{{ option.content }}</p>
                <small>{{ option.rationale }}</small
                ><button
                  class="control-button secondary compact"
                  type="button"
                  :disabled="task.sourceStale"
                  @click="editIdeaGenerationOption(task, option)"
                >
                  作为新便签编辑
                </button>
              </details>
            </article>
          </section>
          <footer>
            <template v-if="selectedIdea && !selectedIdea.promotedToId"
              ><button
                class="control-button secondary compact"
                type="button"
                :disabled="busy || ideaDraftDirty"
                data-testid="promote-idea-world-rule"
                @click="promoteIdeaToWorldRule"
              >
                提升为世界设定</button
              ><button
                class="control-button secondary compact"
                type="button"
                :disabled="busy || ideaDraftDirty"
                data-testid="promote-idea-summary"
                title="仅在尚无总纲时创建，保留原便签，不覆盖已有大纲"
                @click="promoteIdeaToSummary"
              >
                创建为梗概
              </button></template
            ><button
              v-if="selectedIdea && ideaDraft.status === 'candidate'"
              class="control-button secondary compact"
              type="button"
              :disabled="busy"
              @click="saveIdea('approved')"
            >
              仅批准</button
            ><button
              class="ink-action compact-search"
              type="submit"
              :disabled="busy || !ideaDraft.title.trim() || !ideaDraft.content.trim()"
            >
              <StudioIcon name="save" :size="15" />{{ creatingIdea ? '保存便签' : '保存修改' }}
            </button>
          </footer>
        </form>
        <div v-else class="material-detail-empty">
          <i>灵</i><b>先记下一条灵感</b>
          <p>它可以一直只是便签，也可以由你批准后提升成正式世界设定。</p>
          <button class="control-button secondary" type="button" @click="startIdea">新建灵感</button>
        </div>
      </div>
    </section>

    <section
      v-else-if="materialSection === 'manual' && researchSourcesIssue"
      class="material-section material-source-locked"
      data-testid="material-source-ledger-locked"
    >
      <i>锁</i>
      <div>
        <b>自备资料暂时只读锁定</b>
        <p>{{ researchSourcesIssue.message }} 岚笺没有把损坏账本当作空素材库，也不会自动覆盖或移走它。</p>
        <small
          >正文、正式大纲、作者札记与既有事件仍可使用；请先人工核对项目内 `.webnovel/research/sources.json`。</small
        >
      </div>
    </section>

    <section
      v-else-if="materialSection === 'manual'"
      class="material-section material-catalog-view"
      data-testid="material-manual-view"
    >
      <aside class="material-catalog source-list">
        <header>
          <div><b>自备资料目录</b><small>每条资料单独打开，不再挤在一张长表里。</small></div>
          <button
            class="control-button secondary compact"
            type="button"
            data-testid="new-manual-source"
            @click="startSourceCard"
          >
            <StudioIcon name="plus" :size="15" />新建资料
          </button>
        </header>
        <label class="material-filter"
          ><span>筛选资料</span
          ><input
            v-assist-field="{
              id: 'AppShell.materialSearch',
              read: () => materialSearch,
              write: (value) => {
                materialSearch = String(value)
              }
            }"
            v-model="materialSearch"
            type="search"
            placeholder="输入标题或正文关键词"
        /></label>
        <div class="material-source-list">
          <button
            v-for="source in visibleMaterialSources"
            :key="source.id"
            type="button"
            :class="{ selected: selectedSourceId === source.id }"
            @click="openSourceCard(source)"
          >
            <span
              ><b>{{ source.title }}</b
              ><small
                >{{ source.provider === 'txt-import' ? '文稿导入' : '本人录入' }} ·
                {{ source.excerpt || source.userNotes }}</small
              ></span
            ><em>查看</em>
          </button>
          <p v-if="!visibleMaterialSources.length">
            {{ manualSources.length ? '没有符合筛选条件的资料。' : '还没有自备资料，可以新建一条或从文稿导入。' }}
          </p>
        </div>
      </aside>
      <form
        v-if="creatingSource || selectedSource"
        class="source-detail-editor source-capture"
        data-testid="source-detail-editor"
        @submit.prevent="saveSourceCard"
      >
        <header>
          <div>
            <b>{{ creatingSource ? '新建自备资料' : '修改自备资料' }}</b
            ><small>修改只影响当前作品的素材卡，不会自动写入正式设定或大纲。</small>
          </div>
          <span v-if="sourceDraftDirty">尚未保存</span>
        </header>
        <label
          >资料标题<input
            v-assist-field="{
              id: 'AppShell.sourceDraft.title',
              read: () => sourceDraft.title,
              write: (value) => {
                sourceDraft.title = String(value)
              },
              identity: () => sourceDraft
            }"
            v-model="sourceDraft.title"
            maxlength="200"
            placeholder="人物、地点、事件或灵感名称"
        /></label>
        <div class="two-fields">
          <label
            >来源网址（可选）<input
              v-assist-field="{
                id: 'AppShell.sourceDraft.url',
                read: () => sourceDraft.url,
                write: (value) => {
                  sourceDraft.url = String(value)
                },
                identity: () => sourceDraft
              }"
              v-model="sourceDraft.url"
              placeholder="https://..." /></label
          ><label
            >作者（可选）<input
              v-assist-field="{
                id: 'AppShell.sourceDraft.author',
                read: () => sourceDraft.author,
                write: (value) => {
                  sourceDraft.author = String(value)
                },
                identity: () => sourceDraft
              }"
              v-model="sourceDraft.author"
              maxlength="200"
          /></label>
        </div>
        <label
          >资料正文<textarea
            v-assist-field="{
              id: 'AppShell.sourceDraft.excerpt',
              read: () => sourceDraft.excerpt,
              write: (value) => {
                sourceDraft.excerpt = String(value)
              },
              identity: () => sourceDraft
            }"
            v-model="sourceDraft.excerpt"
            maxlength="20000"
            placeholder="整理或粘贴需要保留的内容"
          ></textarea></label
        ><label
          >我的判断<textarea
            v-assist-field="{
              id: 'AppShell.sourceDraft.userNotes',
              read: () => sourceDraft.userNotes,
              write: (value) => {
                sourceDraft.userNotes = String(value)
              },
              identity: () => sourceDraft
            }"
            v-model="sourceDraft.userNotes"
            maxlength="20000"
            placeholder="为什么值得写、准备怎样使用、哪些地方需要核对"
          ></textarea>
        </label>
        <footer>
          <button
            v-if="selectedSource"
            class="control-button secondary compact"
            type="button"
            @click="beginEventCandidate(selectedSource)"
          >
            提炼为事件候选</button
          ><button
            class="ink-action compact-search"
            type="submit"
            :disabled="
              busy || !sourceDraft.title.trim() || !(sourceDraft.excerpt.trim() || sourceDraft.userNotes.trim())
            "
          >
            <StudioIcon name="save" :size="15" />{{ creatingSource ? '建立资料卡' : '保存修改' }}
          </button>
        </footer>
      </form>
      <div v-else class="material-detail-empty">
        <i>札</i><b>从左侧选择一条资料</b>
        <p>这里会显示完整正文、来源和你的整理判断，并可直接修改。</p>
        <button class="control-button secondary" type="button" @click="startSourceCard">新建自备资料</button>
      </div>
    </section>

    <section
      v-else-if="materialSection === 'research' && researchSourcesIssue"
      class="material-section material-source-locked"
      data-testid="material-source-ledger-locked"
    >
      <i>锁</i>
      <div>
        <b>联网采风入库暂时锁定</b>
        <p>{{ researchSourcesIssue.message }} 新采风不会写进一个伪装为空的账本。</p>
        <small>原始文件保持不变；正文与正式大纲仍可继续编辑。</small>
      </div>
    </section>

    <section
      v-else-if="materialSection === 'research'"
      class="material-section material-research-view"
      data-testid="material-research-view"
    >
      <div class="research-compose">
        <header>
          <div>
            <b>开始一次联网采风</b><small>采风只在你点击时联网；结果先成为带来源的素材，不会覆盖作者设想。</small>
          </div>
          <span>{{
            researchSettings.apiKeyConfigured ? `使用 ${researchSettings.model}` : '请先在模型设置中保存采风密钥'
          }}</span>
        </header>
        <label
          >关键词与创作方向<textarea
            v-assist-field="{
              id: 'AppShell.researchQuery',
              read: () => researchQuery,
              write: (value) => {
                researchQuery = String(value)
              }
            }"
            v-model="researchQuery"
            placeholder="例如：KING；重点寻找人物反差、热梗、争议观点与可改编事件"
          ></textarea></label
        ><button
          class="ink-action compact-search"
          type="button"
          :disabled="busy || !researchSettings.apiKeyConfigured || !researchQuery.trim()"
          @click="runResearch"
        >
          <StudioIcon name="research" :size="16" />开始联网采风
        </button>
        <article v-if="researchResult" class="research-result">
          <header>
            <div>
              <b>采风摘要</b
              ><small
                >{{ researchResult.webSearchCalls }} 次联网搜索 ·
                {{ researchResult.sources.length }} 个可追溯来源</small
              >
            </div>
            <button
              class="control-button secondary compact"
              type="button"
              :disabled="!researchResult.sources.length"
              @click="addResearchToMaterials"
            >
              保存为采风资料
            </button>
          </header>
          <div class="research-content">{{ researchResult.content }}</div>
          <details v-if="researchResult.sources.length">
            <summary>查看来源</summary>
            <a
              v-for="item in researchResult.sources"
              :key="item.url"
              :href="item.url"
              target="_blank"
              rel="noreferrer"
              >{{ item.title }}</a
            >
          </details>
        </article>
      </div>
      <div class="material-catalog-layout">
        <aside class="material-catalog source-list">
          <header>
            <div><b>采风资料目录</b><small>来源证据与作者整理分开显示。</small></div>
          </header>
          <label class="material-filter"
            ><span>筛选采风</span
            ><input
              v-assist-field="{
                id: 'AppShell.materialSearch',
                read: () => materialSearch,
                write: (value) => {
                  materialSearch = String(value)
                }
              }"
              v-model="materialSearch"
              type="search"
              placeholder="输入标题或内容关键词"
          /></label>
          <div class="material-source-list">
            <button
              v-for="source in visibleMaterialSources"
              :key="source.id"
              type="button"
              :class="{ selected: selectedSourceId === source.id }"
              @click="openSourceCard(source)"
            >
              <span
                ><b>{{ source.title }}</b
                ><small
                  >{{ source.references?.length || (source.url ? 1 : 0) }} 个来源 · {{ source.excerpt }}</small
                ></span
              ><em>核对</em>
            </button>
            <p v-if="!visibleMaterialSources.length">
              {{ webSources.length ? '没有符合筛选条件的采风。' : '还没有联网采风资料。' }}
            </p>
          </div>
        </aside>
        <form
          v-if="selectedSource"
          class="source-detail-editor source-capture web-source-detail"
          data-testid="source-detail-editor"
          @submit.prevent="saveSourceCard"
        >
          <header>
            <div><b>核对采风资料</b><small>原始摘录与来源只读；标题和作者整理可以修改。</small></div>
            <span v-if="sourceDraftDirty">尚未保存</span>
          </header>
          <label
            >资料标题<input
              v-assist-field="{
                id: 'AppShell.sourceDraft.title',
                read: () => sourceDraft.title,
                write: (value) => {
                  sourceDraft.title = String(value)
                },
                identity: () => sourceDraft
              }"
              v-model="sourceDraft.title"
              maxlength="200" /></label
          ><label
            >原始采风摘录<textarea
              v-assist-field="{
                id: 'AppShell.sourceDraft.excerpt',
                read: () => sourceDraft.excerpt,
                write: (value) => {
                  sourceDraft.excerpt = String(value)
                },
                identity: () => sourceDraft
              }"
              v-model="sourceDraft.excerpt"
              readonly
              aria-readonly="true"
            ></textarea
            ><small>为保证溯源，这部分不能改写。</small></label
          ><label
            >作者整理<textarea
              v-assist-field="{
                id: 'AppShell.sourceDraft.userNotes',
                read: () => sourceDraft.userNotes,
                write: (value) => {
                  sourceDraft.userNotes = String(value)
                },
                identity: () => sourceDraft
              }"
              v-model="sourceDraft.userNotes"
              maxlength="20000"
              placeholder="记录可用梗、情绪共鸣、改编方向和待核问题"
            ></textarea>
          </label>
          <details v-if="selectedSource.references?.length || selectedSource.url" class="source-provenance">
            <summary>查看 {{ selectedSource.references?.length || 1 }} 个原始来源</summary>
            <a v-if="selectedSource.url" :href="selectedSource.url" target="_blank" rel="noreferrer">{{
              selectedSource.url
            }}</a
            ><a
              v-for="item in selectedSource.references || []"
              :key="item.url"
              :href="item.url"
              target="_blank"
              rel="noreferrer"
              >{{ item.title }}</a
            >
          </details>
          <footer>
            <button class="control-button secondary compact" type="button" @click="beginEventCandidate(selectedSource)">
              提炼为事件候选</button
            ><button
              class="ink-action compact-search"
              type="submit"
              :disabled="
                busy || !sourceDraft.title.trim() || !(sourceDraft.excerpt.trim() || sourceDraft.userNotes.trim())
              "
            >
              <StudioIcon name="save" :size="15" />保存作者整理
            </button>
          </footer>
        </form>
        <div v-else class="material-detail-empty">
          <i>证</i><b>选择一条采风资料核对</b>
          <p>原始证据保持只读，你可以在右侧整理它对小说有什么用。</p>
        </div>
      </div>
    </section>

    <section
      v-else-if="researchEventsIssue"
      class="material-section material-source-locked"
      data-testid="material-event-ledger-locked"
    >
      <i>锁</i>
      <div>
        <b>正式事件账本暂时只读锁定</b>
        <p>{{ researchEventsIssue.message }} 岚笺没有把损坏账本当作零条事件，也不会自动修复、覆盖或移动它。</p>
        <small>正文、总纲与作者直接纪事仍可读取；请人工核对项目内 `.webnovel/research/events.json`。</small>
      </div>
    </section>

    <section v-else class="material-section material-event-view" data-testid="material-events-view">
      <header>
        <div><b>事件提炼</b><small>只有补齐时间、人物、地点、事件并人工确认，资料才会成为作品事实。</small></div>
        <span>{{ canonicalEvents.filter((item) => item.status === 'approved').length }} 项正式事件</span>
      </header>
      <div
        v-if="researchSourcesIssue"
        class="event-source-picker material-event-source-locked"
        data-testid="material-event-source-locked"
      >
        <b>来源账本待核对，暂不能提炼新事件</b>
        <p>已有事件记录保持可见；岚笺不会在来源证据不可读时建立新的候选事件。</p>
      </div>
      <div v-else-if="!selectedEventSource" class="event-source-picker">
        <b>先选择作为证据的资料</b>
        <p>选择后只会建立候选，不会直接进入总纲或正文。</p>
        <div>
          <button v-for="source in sourceCards" :key="source.id" type="button" @click="beginEventCandidate(source)">
            <span>{{ source.title }}</span
            ><small>{{ sourceOriginLabel(source) }}</small>
          </button>
        </div>
      </div>
      <section v-else class="event-candidate-form">
        <header>
          <div>
            <b>从《{{ selectedEventSource.title }}》提炼事件</b><small>确认前不是作品事实</small>
          </div>
          <button type="button" aria-label="关闭事件候选" @click="eventDraft.sourceId = ''">
            <StudioIcon name="close" :size="15" />
          </button>
        </header>
        <div class="event-fields">
          <label
            >时间<input
              v-assist-field="{
                id: 'AppShell.eventDraft.time',
                read: () => eventDraft.time,
                write: (value) => {
                  eventDraft.time = String(value)
                },
                identity: () => eventDraft
              }"
              v-model="eventDraft.time"
              placeholder="相对顺序也可以" /></label
          ><label
            >人物<input
              v-assist-field="{
                id: 'AppShell.eventDraft.characters',
                read: () => eventDraft.characters,
                write: (value) => {
                  eventDraft.characters = String(value)
                },
                identity: () => eventDraft
              }"
              v-model="eventDraft.characters"
              placeholder="多人用顿号分隔" /></label
          ><label
            >地点<input
              v-assist-field="{
                id: 'AppShell.eventDraft.location',
                read: () => eventDraft.location,
                write: (value) => {
                  eventDraft.location = String(value)
                },
                identity: () => eventDraft
              }"
              v-model="eventDraft.location" /></label
          ><label class="wide"
            >事件<textarea
              v-assist-field="{
                id: 'AppShell.eventDraft.event',
                read: () => eventDraft.event,
                write: (value) => {
                  eventDraft.event = String(value)
                },
                identity: () => eventDraft
              }"
              v-model="eventDraft.event"
            ></textarea></label
          ><label class="wide"
            >结果与影响<textarea
              v-assist-field="{
                id: 'AppShell.eventDraft.result',
                read: () => eventDraft.result,
                write: (value) => {
                  eventDraft.result = String(value)
                },
                identity: () => eventDraft
              }"
              v-model="eventDraft.result"
            ></textarea>
          </label>
        </div>
        <button
          class="ink-action compact-search"
          type="button"
          :disabled="
            busy ||
            !eventDraft.time.trim() ||
            !eventDraft.characters.trim() ||
            !eventDraft.location.trim() ||
            !eventDraft.event.trim()
          "
          @click="createEventCandidate"
        >
          保存为候选事件
        </button>
      </section>
      <section class="candidate-events">
        <header><b>事件记录</b><small>候选与已确认事实分开标识；冲突不会自动裁决。</small></header>
        <article
          v-for="item in canonicalEvents"
          :key="item.id"
          :class="{ approved: item.status === 'approved', conflict: item.conflictGroupId }"
        >
          <i>{{ item.status === 'approved' ? '正' : '候' }}</i>
          <div>
            <b>{{ item.event }}</b
            ><small>{{ item.time }} · {{ item.characters.join('、') }} · {{ item.location }}</small
            ><span v-if="item.conflictGroupId">存在同槽位冲突，请人工核对</span>
          </div>
          <button v-if="item.status === 'candidate'" type="button" :disabled="busy" @click="approveCanonicalEvent(item.id)">
            确认入库</button
          ><em v-else>已确认</em>
        </article>
        <p v-if="!canonicalEvents.length">还没有事件记录。</p>
      </section>
    </section>
  </div>
</template>
