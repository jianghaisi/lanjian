<script setup>
import { isLocalConnection } from '../../../../contracts/models/local-model-contracts'
import CharacterAtlas from '../../characters/components/CharacterAtlas.vue'
import WorldMap from '../../world-map/components/WorldMap.vue'
import ChronicleHeader from './ChronicleHeader.vue'
import ChronicleEvents from './ChronicleEvents.vue'
import StudioIcon from '../../../ui/StudioIcon.vue'
import { toRefs } from 'vue'

const props = defineProps({ scope: { type: Object, required: true } })
const {
  addTimeline,
  adoptTimelineCandidate,
  approvedEvents,
  busy,
  chapterPosition,
  chapters,
  characterAtlasCards,
  characterAtlasThroughPosition,
  characterDisplayMode,
  characterLines,
  characterLinesError,
  characterLinesLoading,
  characterPointDetails,
  chronicleMapLocation,
  current,
  discardTimelineCandidate,
  expandedTimelineEntry,
  foreshadowDraft,
  foreshadowLedger,
  generateTimelineCandidates,
  loadCharacterLines,
  loadTimelineVolume,
  moveTimelineEvent,
  oneOffConnections,
  openCharacterAtlasChapter,
  openChronicleMap,
  openForeshadowChapter,
  openForeshadows,
  openTimelineVolumeInOutline,
  openWorldMapCharacter,
  openWorldMapEvent,
  outlinePlanning,
  quickChapterItems,
  recordForeshadowAction,
  removeTimelineEvent,
  researchEventsIssue,
  reviewCanonicalEvents,
  saveTimeline,
  selectWorkspaceLeaf,
  selectedCharacterLine,
  selectedCharacterLineId,
  selectedForeshadow,
  selectedForeshadowActions,
  selectedTimelineVolume,
  selectedTimelineVolumeMeta,
  timeline,
  timelineAiCandidates,
  timelineAiGenerating,
  timelineEntryId,
  timelineMode,
  timelineVolumeCards,
  timelineVolumeContent,
  timelineVolumeError,
  timelineVolumeLoading,
  updateChronicleField,
  volumeLineRange,
  volumeLineStatus,
  worldMapAdopting,
  worldMapBackground,
  worldMapBackgroundError,
  worldMapCandidate,
  worldMapDirty,
  worldMapError,
  worldMapGenerating,
  worldMapGenerationError,
  worldMapLoading,
  worldMapSaveError,
  worldMapSaving,
  worldMapView,
  worldMapWorkspace
} = toRefs(props.scope)
</script>

<template>
  <div
    class="structured-editor timeline-editor timeline-workbench"
    :class="{
      'character-atlas-workbench': timelineMode === 'characters',
      'world-map-workbench': timelineMode === 'map'
    }"
  >
    <ChronicleHeader v-if="timelineMode === 'events'">
      <div v-if="timelineMode === 'events'" class="timeline-primary-actions">
        <button
          class="control-button secondary"
          type="button"
          data-testid="generate-timeline-candidates"
          :disabled="busy || timelineAiGenerating || Boolean(researchEventsIssue)"
          @click="generateTimelineCandidates"
        >
          <StudioIcon name="spark" :size="15" />{{ timelineAiGenerating ? '正在起草…' : 'AI 起草' }}
        </button>
        <button class="ink-action" type="button" data-testid="add-timeline-event" @click="addTimeline">
          <StudioIcon name="plus" :size="15" />新建事件
        </button>
        <button class="control-button secondary" type="button" :disabled="busy" @click="saveTimeline">
          <StudioIcon name="save" :size="15" />保存时间线
        </button>
      </div>
    </ChronicleHeader>
    <header
      v-if="!['map', 'events'].includes(timelineMode)"
      class="timeline-workbench-header chronicle-auxiliary-heading"
    >
      <div>
        <h2>
          {{ timelineMode === 'characters' ? '人物状态' : timelineMode === 'foreshadows' ? '伏笔备忘' : '卷概览' }}
        </h2>
        <p>
          {{
            timelineMode === 'characters'
              ? '核对某章时人物已记录的位置、目标与知识；原文始终是核对依据。'
              : timelineMode === 'foreshadows'
                ? '记住埋下的线索，跟踪推进与回收。记录不一定完整。'
                : '汇总卷纲、归卷章节与事件，修改仍在谋篇完成。'
          }}
        </p>
      </div>
      <nav v-if="timelineMode === 'characters'" class="character-atlas-view-switch" aria-label="人物状态视图">
        <button
          type="button"
          data-testid="timeline-character-cards"
          :aria-pressed="characterDisplayMode === 'cards'"
          @click="characterDisplayMode = 'cards'"
        >
          人物卡
        </button>
        <button
          type="button"
          data-testid="timeline-character-tracks"
          :aria-pressed="characterDisplayMode === 'tracks'"
          @click="characterDisplayMode = 'tracks'"
        >
          按章核对
        </button>
      </nav>
      <span v-else-if="timelineMode === 'foreshadows'" class="timeline-read-source"
        >{{ openForeshadows.length }} 项待回收</span
      >
      <button
        v-else-if="selectedTimelineVolumeMeta"
        class="text-action compact"
        type="button"
        @click="openTimelineVolumeInOutline(selectedTimelineVolumeMeta.volume)"
      >
        编辑卷纲
      </button>
    </header>
    <ChronicleEvents
      v-if="timelineMode === 'events'"
      :key="current.path"
      :formal="approvedEvents"
      :direct="timeline"
      :candidates="timelineAiCandidates"
      :selected="expandedTimelineEntry"
      :busy="busy"
      :issue="Boolean(researchEventsIssue)"
      :placements="outlinePlanning.eventChapterPlacements"
      :chapters="chapters"
      @select="(kind, id) => (expandedTimelineEntry = timelineEntryId(kind, id))"
      @update="updateChronicleField"
      @add="addTimeline"
      @save="saveTimeline"
      @review="reviewCanonicalEvents"
      @map="openChronicleMap"
      @foreshadows="selectWorkspaceLeaf('foreshadows')"
      @chapter="openCharacterAtlasChapter"
      @move="moveTimelineEvent"
      @remove="removeTimelineEvent"
      @adopt="adoptTimelineCandidate"
      @discard="discardTimelineCandidate"
    />

    <WorldMap
      v-else-if="timelineMode === 'map'"
      :key="current.path"
      :focus-location="chronicleMapLocation"
      :view="worldMapView"
      :loading="worldMapLoading"
      :error="worldMapError"
      :saving="worldMapSaving"
      :save-error="worldMapSaveError"
      :background="worldMapBackground"
      :background-error="worldMapBackgroundError"
      :candidate="worldMapCandidate"
      :generating="worldMapGenerating"
      :adopting="worldMapAdopting"
      :generation-error="worldMapGenerationError"
      :ai-connections="
        oneOffConnections
          .filter((c) => !isLocalConnection(c.id))
          .map(({ id, name, apiKeyConfigured }) => ({ id, name, apiKeyConfigured }))
      "
      @dirty="worldMapDirty = $event"
      @save="worldMapWorkspace.save"
      @retry="worldMapWorkspace.load"
      @generate="worldMapWorkspace.generate"
      @cancel-generation="worldMapWorkspace.cancelGeneration"
      @adopt="worldMapWorkspace.adopt"
      @discard-candidate="worldMapWorkspace.discardCandidate"
      @open-chapter="openCharacterAtlasChapter"
      @open-event="openWorldMapEvent"
      @open-character="openWorldMapCharacter"
    />
    <CharacterAtlas
      v-else-if="timelineMode === 'characters' && characterDisplayMode === 'cards'"
      :lines="characterLines"
      :chapters="quickChapterItems"
      :selected-id="selectedCharacterLineId"
      :through-position="characterAtlasThroughPosition"
      :loading="characterLinesLoading"
      :error="characterLinesError"
      @select="selectedCharacterLineId = $event"
      @through-position="characterAtlasThroughPosition = $event"
      @retry="loadCharacterLines(true)"
      @open-chapter="openCharacterAtlasChapter"
    />
    <section
      v-else-if="timelineMode === 'characters'"
      class="timeline-readonly-shell character-lines-view"
      data-testid="timeline-characters-view"
    >
      <header class="timeline-readonly-heading">
        <div>
          <span
            >人物状态轨迹 ·
            {{
              characterAtlasThroughPosition === null ? '全书记录' : `截至第 ${characterAtlasThroughPosition} 章`
            }}</span
          ><b
            >{{ characterAtlasCards.length }} 人 ·
            {{ characterAtlasCards.reduce((sum, line) => sum + line.points.length, 0) }} 个已记录节点</b
          >
        </div>
        <small
          >沿用人物卡的章节范围；{{
            characterLines.source === 'sqlite-approved-facts' ? '来自批准事实' : '来自已采用正文'
          }}，不代表重新核对了当前原文。</small
        >
      </header>
      <div v-if="characterLinesError" class="timeline-readonly-empty" role="alert">
        <h3>暂时无法读取人物记录</h3>
        <p>{{ characterLinesError }}</p>
        <button type="button" class="control-button secondary" @click="loadCharacterLines(true)">重新读取</button>
      </div>
      <p v-else-if="characterLinesLoading" role="status">正在读取人物记录…</p>
      <article v-else-if="selectedCharacterLine" class="character-line-sheet">
        <header>
          <div>
            <i>人</i
            ><span
              ><small>人物线</small>
              <h3>{{ selectedCharacterLine.name }}</h3></span
            >
          </div>
          <em>{{ selectedCharacterLine.points.length }} 个节点</em>
        </header>
        <ol class="character-line-axis" :aria-label="`${selectedCharacterLine.name}的人物状态轨迹`">
          <li
            v-for="point in selectedCharacterLine.points"
            :key="point.sourceId"
            data-testid="timeline-character-point"
          >
            <div class="character-line-marker">
              <b>{{ String(point.chapterPosition).padStart(2, '0') }}</b
              ><span>章</span><i></i>
            </div>
            <section>
              <header>
                <b>第 {{ point.chapterPosition }} 章后的状态</b
                ><span>{{ point.present ? '本章出现' : '状态承接' }}</span>
              </header>
              <dl v-if="characterPointDetails(point).length">
                <div v-for="detail in characterPointDetails(point)" :key="detail.label">
                  <dt>{{ detail.label }}</dt>
                  <dd>{{ detail.value }}</dd>
                </div>
              </dl>
              <p v-else>本节点只确认人物存在与章节承接，没有新增可展示的动态字段。</p>
              <footer>
                {{ point.source === 'approved_fact' ? '来自作者批准的人物事实' : '来自作者已采用的正文状态' }}
              </footer>
            </section>
          </li>
        </ol>
      </article>
      <div v-else class="timeline-readonly-empty">
        <i>人</i>
        <h3>还没有人物轨迹</h3>
        <p>采用正文并确认人物变化后，地点、目标、关系和已知信息会按章节沉淀在这里。</p>
      </div>
    </section>

    <section
      v-else-if="timelineMode === 'foreshadows'"
      class="timeline-readonly-shell foreshadow-ledger-view"
      data-testid="timeline-foreshadows-view"
    >
      <header class="timeline-readonly-heading">
        <div>
          <span>正式伏笔投影</span
          ><b>{{ openForeshadows.length }} 项待回收 · {{ foreshadowLedger.foreshadows.length }} 项全部记录</b>
        </div>
        <small>快速候选只有在作者采用并保存后才结算；未采用候选不会进入账本。</small>
      </header>
      <div class="foreshadow-workbench">
        <article v-if="selectedForeshadow" class="foreshadow-sheet">
          <header>
            <div>
              <i>伏</i
              ><span
                ><small>{{
                  selectedForeshadow.status === 'open'
                    ? '待回收伏笔'
                    : selectedForeshadow.status === 'resolved'
                      ? '已经回收'
                      : '已经废弃'
                }}</small>
                <h3>{{ selectedForeshadow.title }}</h3></span
              >
            </div>
            <em :class="`status-${selectedForeshadow.status}`">{{
              selectedForeshadow.status === 'open' ? '开放' : selectedForeshadow.status === 'resolved' ? '回收' : '废弃'
            }}</em>
          </header>
          <dl>
            <div>
              <dt>埋设章节</dt>
              <dd>
                <button
                  v-if="selectedForeshadow.plantedChapterId"
                  type="button"
                  @click="openForeshadowChapter(selectedForeshadow.plantedChapterId)"
                >
                  第 {{ chapterPosition(selectedForeshadow.plantedChapterId) }} 章</button
                ><span v-else>未绑定章节</span>
              </dd>
            </div>
            <div>
              <dt>回收章节</dt>
              <dd>
                <button
                  v-if="selectedForeshadow.payoffChapterId"
                  type="button"
                  @click="openForeshadowChapter(selectedForeshadow.payoffChapterId)"
                >
                  第 {{ chapterPosition(selectedForeshadow.payoffChapterId) }} 章</button
                ><span v-else>尚未回收</span>
              </dd>
            </div>
          </dl>
          <ol class="foreshadow-history">
            <li v-for="item in selectedForeshadowActions" :key="item.id">
              <i>{{
                { plant: '埋', advance: '推', misdirect: '误', resolve: '收', hold: '留', discard: '弃' }[item.action]
              }}</i>
              <div>
                <header>
                  <b>{{
                    {
                      plant: '埋设',
                      advance: '推进',
                      misdirect: '误导',
                      resolve: '回收',
                      hold: '保持',
                      discard: '废弃'
                    }[item.action]
                  }}</b
                  ><span>{{ item.chapterId ? `第 ${chapterPosition(item.chapterId)} 章` : '手动记录' }}</span>
                </header>
                <p>{{ item.description || '没有补充说明' }}</p>
                <small>{{
                  item.sourceType === 'manual'
                    ? '作者手动记录'
                    : item.sourceType === 'chapter_draft'
                      ? '正文候选采用后结算'
                      : '智能助笔候选采用后结算'
                }}</small>
              </div>
            </li>
          </ol>
        </article>
        <div v-else class="timeline-readonly-empty">
          <i>伏</i>
          <h3>还没有正式伏笔</h3>
          <p>在右侧写下伏笔名称并埋设；后续章节可以继续推进、误导、保持、回收或废弃。</p>
        </div>
        <form class="foreshadow-action-form" @submit.prevent="recordForeshadowAction">
          <header><b>记录一次伏笔动作</b><small>每次操作都会留下不可改删的历史</small></header>
          <label
            >动作<select
              v-assist-field="{
                id: 'AppShell.foreshadowDraft.action',
                read: () => foreshadowDraft.action,
                write: (value) => {
                  foreshadowDraft.action = String(value)
                },
                identity: () => foreshadowDraft
              }"
              v-model="foreshadowDraft.action"
            >
              <option value="plant">埋设新伏笔</option>
              <option value="advance">推进 / 强化</option>
              <option value="misdirect">误导读者</option>
              <option value="hold">保持未揭晓</option>
              <option value="resolve">正式回收</option>
              <option value="discard">废弃伏笔</option>
            </select></label
          >
          <label v-if="foreshadowDraft.action === 'plant'"
            >伏笔名称<input
              v-assist-field="{
                id: 'AppShell.foreshadowDraft.title',
                read: () => foreshadowDraft.title,
                write: (value) => {
                  foreshadowDraft.title = String(value)
                },
                identity: () => foreshadowDraft
              }"
              v-model="foreshadowDraft.title"
              maxlength="500"
              placeholder="例如：信封边缘残留海盐"
          /></label>
          <label v-else
            >选择待回收伏笔<select v-model="foreshadowDraft.foreshadowId">
              <option value="">请选择</option>
              <option v-for="item in openForeshadows" :key="item.id" :value="item.id">{{ item.title }}</option>
            </select></label
          >
          <label
            >来源章节（可选）<input v-model="foreshadowDraft.legacyChapterId" inputmode="numeric" placeholder="例如 27"
          /></label>
          <label
            >动作说明<textarea
              v-assist-field="{
                id: 'AppShell.foreshadowDraft.description',
                read: () => foreshadowDraft.description,
                write: (value) => {
                  foreshadowDraft.description = String(value)
                },
                identity: () => foreshadowDraft
              }"
              v-model="foreshadowDraft.description"
              maxlength="5000"
              placeholder="本章怎样埋设、推进、误导或回收"
            ></textarea>
          </label>
          <button class="control-button primary" type="submit" :disabled="busy" data-testid="record-foreshadow-action">
            <StudioIcon name="save" :size="16" />记入正式账本
          </button>
        </form>
      </div>
    </section>

    <section v-else class="timeline-readonly-shell volume-lines-view" data-testid="timeline-volumes-view">
      <header class="timeline-readonly-heading">
        <div>
          <span>卷概览 · 只读</span
          ><b>{{ timelineVolumeCards.length }} 卷 · {{ outlinePlanning.chapterPlacements.length }} 章已归卷</b>
        </div>
        <small>这里只展示正式谋篇账本；卷纲修改、版本确认与章节归属仍在“谋篇”完成。</small>
      </header>
      <nav v-if="timelineVolumeCards.length" class="volume-line-ribbon" aria-label="全书篇卷顺序">
        <button
          v-for="volume in timelineVolumeCards"
          :key="volume.volume"
          type="button"
          :class="{ selected: selectedTimelineVolume === volume.volume }"
          @click="loadTimelineVolume(volume.volume)"
        >
          <i>{{ String(volume.volume).padStart(2, '0') }}</i
          ><span
            ><b>{{ volume.title }}</b
            ><small>{{ volumeLineRange(volume) }}</small></span
          >
        </button>
      </nav>
      <article v-if="selectedTimelineVolumeMeta" class="volume-line-sheet">
        <header>
          <div>
            <p class="eyebrow">第 {{ selectedTimelineVolumeMeta.volume }} 卷</p>
            <h3>{{ selectedTimelineVolumeMeta.title }}</h3>
          </div>
          <span :class="`approval-${selectedTimelineVolumeMeta.approval?.status || 'missing'}`">{{
            volumeLineStatus(selectedTimelineVolumeMeta)
          }}</span>
        </header>
        <dl class="volume-line-facts">
          <div>
            <dt>章节范围</dt>
            <dd>{{ volumeLineRange(selectedTimelineVolumeMeta) }}</dd>
          </div>
          <div>
            <dt>已归卷章节</dt>
            <dd>{{ selectedTimelineVolumeMeta.chapterCount }} 章</dd>
          </div>
          <div>
            <dt>正式事件</dt>
            <dd>{{ selectedTimelineVolumeMeta.eventCount }} 项</dd>
          </div>
          <div>
            <dt>卷纲版本</dt>
            <dd>
              {{
                selectedTimelineVolumeMeta.outlineExists ? `第 ${selectedTimelineVolumeMeta.revision} 版` : '尚未建立'
              }}
            </dd>
          </div>
        </dl>
        <section class="volume-outline-reading">
          <header><b>卷纲正文</b><small>只读</small></header>
          <p v-if="timelineVolumeError" role="alert">{{ timelineVolumeError }}</p>
          <p v-if="timelineVolumeLoading">正在读取卷纲…</p>
          <pre v-else-if="timelineVolumeContent.trim()">{{ timelineVolumeContent }}</pre>
          <p v-else>本卷还没有卷纲正文。</p>
        </section>
        <footer>
          <span>事件与章节归属来自当前正式规划账本</span
          ><button
            class="ink-action compact-search"
            type="button"
            @click="openTimelineVolumeInOutline(selectedTimelineVolumeMeta.volume)"
          >
            在谋篇中打开
          </button>
        </footer>
      </article>
      <div v-else class="timeline-readonly-empty">
        <i>卷</i>
        <h3>还没有故事阶段</h3>
        <p>先在“谋篇”建立卷目录，再把章节和正式事件放入对应篇卷。</p>
      </div>
    </section>
  </div>
</template>
