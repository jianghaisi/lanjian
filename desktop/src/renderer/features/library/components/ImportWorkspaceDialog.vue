<script setup>
import ModelCreationDefaults from '../../models/components/ModelCreationDefaults.vue'
import { hostedModelMode } from '../../models/services/hosted-model-mode'
import { genreCatalog } from '../../../../contracts/worldbuilding/genre-catalog'
import StudioIcon from '../../../ui/StudioIcon.vue'
import { computed, nextTick, onBeforeUnmount, ref, toRefs } from 'vue'

const props = defineProps({ scope: { type: Object, required: true } })
const {
  addContinuationDocuments,
  busy,
  chooseTxtDestination,
  commitTxtImport,
  current,
  desktop,
  importCreatedProject,
  importManifest,
  importModelsPreview,
  manifestChapterSelections,
  manifestRoles,
  moveManifestFile,
  partialImportCreation,
  showTxtImport,
  txtCanImport,
  txtImport,
  txtImportEntry,
  txtPreview
} = toRefs(props.scope)
const step = ref(0)
const steps = ['文件用途', '章节核对', '作品配置', '确认导入']
const scrollArea = ref(null)
const stepHeading = ref(null)
const scrollPositions = [0, 0, 0, 0]
let navigation = 0
const filesReady = computed(() => txtImportEntry.value === 'create-from-files'
  ? Boolean(importManifest.value?.files.length) && importManifest.value.files.every(file => Boolean(manifestRoles.value[file.token]))
  : Boolean(txtPreview.value))
const manuscriptFiles = computed(() => (importManifest.value?.files || []).filter(file => manifestRoles.value[file.token] === 'manuscript'))
const selectedChapters = computed(() => txtImportEntry.value === 'create-from-files'
  ? manuscriptFiles.value.reduce((count, file) => count + (manifestChapterSelections.value[file.token] || []).length, 0)
  : txtImport.value.selectedChapterIndexes.length)
async function goToStep(index) {
  if (busy.value || index < 0 || index >= steps.length || (index > 0 && !filesReady.value)) return
  scrollPositions[step.value] = scrollArea.value?.scrollTop || 0
  const ticket = ++navigation
  if (index === 1 && manuscriptFiles.value.length && !manuscriptFiles.value.some(file => file.token === txtPreview.value?.token)) txtPreview.value = manuscriptFiles.value[0]
  step.value = index
  await nextTick()
  if (ticket !== navigation || !scrollArea.value?.isConnected || scrollArea.value.closest('[inert]')) return
  scrollArea.value.scrollTop = scrollPositions[index]
  stepHeading.value?.focus({ preventScroll: true })
}
onBeforeUnmount(() => { navigation++ })
</script>

<template>
  <div class="modal-backdrop txt-import-backdrop" @click.self="!busy && (showTxtImport = false)">
    <section class="modal txt-import-modal import-workpage" role="dialog" aria-modal="true" aria-labelledby="txt-import-title">
      <header class="import-heading">
        <div>
          <p class="eyebrow">
            {{ txtImportEntry === 'create-from-files' ? '旧稿接续 · 先识别再建档' : '收书入案 · 先辨来源' }}
          </p>
          <h2 id="txt-import-title">
            {{ txtImportEntry === 'create-from-files' ? '从文稿创建作品' : '导入文稿或资料' }}
          </h2>
        </div>
        <button type="button" aria-label="关闭" :disabled="busy" @click="showTxtImport = false">
          <StudioIcon name="close" :size="18" />
        </button>
      </header>

      <nav class="import-steps" aria-label="导入步骤">
        <button v-for="(label, index) in steps" :key="label" type="button" :data-testid="`import-step-${index}`" :aria-current="step === index ? 'step' : undefined" :disabled="busy || (index > 0 && !filesReady)" @click="goToStep(index)"><i>{{ String(index + 1).padStart(2, '0') }}</i><span>{{ label }}</span></button>
      </nav>
      <div ref="scrollArea" class="import-scroll">
        <h3 ref="stepHeading" tabindex="-1" class="import-step-heading">{{ steps[step] }}<small>{{ step + 1 }} / 04</small></h3>
        <section v-if="txtPreview" v-show="step === 0" class="file-rubbing">
          <span class="file-seal">文</span>
          <div>
            <b>{{ txtPreview.fileName }}</b
            ><small
              >{{ txtPreview.sourceFormat }} · {{ txtPreview.encoding }} ·
              {{ txtPreview.wordCount.toLocaleString() }} 字 · {{ txtPreview.chapterCount }} 章</small
            >
          </div>
          <i>{{ (txtPreview.bytes / 1024).toFixed(1) }} KB</i>
        </section>

        <section
          v-if="txtImportEntry === 'create-from-files'"
          v-show="step === 0"
          class="import-purpose-note"
          data-testid="txt-create-explanation"
        >
          <b>从已有文稿开始，建立新的作品档案</b>
          <p>
            “打开岚笺作品”只识别已经由岚笺管理的工作项；这里会根据 TXT、Markdown 或 Word
            文稿新建一张书案。正文进入章节，作品相关文件进入素材库，模型只生成可审阅候选，不会直接改写正文或把推断当成正式事实。
          </p>
        </section>

        <section
          v-if="txtImportEntry === 'create-from-files' && !importManifest"
          v-show="step === 0"
          class="continuation-file-queue-empty"
          data-testid="continuation-file-queue-empty"
        >
          <span class="file-seal">续</span>
          <div>
            <b>先把正文、设定和大纲放进同一张接续清单</b>
            <p>可反复添加 TXT、Markdown 或 Word 文件；提交前逐份标明用途，之后 AI 才会用这批材料生成新的工作项。</p>
          </div>
          <button
            class="seal-action small"
            type="button"
            data-testid="add-continuation-documents"
            :disabled="busy"
            @click="addContinuationDocuments"
          >
            <span>添加本地文件</span><i>＋</i>
          </button>
        </section>

        <section
          v-if="txtImportEntry === 'create-from-files' && importManifest"
          v-show="step === 0"
          class="import-section manifest-review"
          data-testid="import-manifest"
        >
          <div class="section-kicker">
            <b>一、逐份确认文件用途</b><span>系统只给建议；每一份都需要你亲自选择，未确认时不能建立作品。</span
            ><button
              class="text-action compact"
              type="button"
              data-testid="add-continuation-documents"
              :disabled="busy || importManifest.files.length >= 20"
              @click="addContinuationDocuments"
            >
              <StudioIcon name="plus" :size="14" />添加文件
            </button>
          </div>
          <div class="manifest-summary">
            已添加 {{ importManifest.files.length }}/20 份 · 共
            {{
              importManifest.totalWordCount.toLocaleString()
            }}
            字。正文会按下方顺序导入；资料与参考文件只保留在对应资料区。
          </div>
          <div class="manifest-files">
            <article
              v-for="(file, index) in importManifest.files"
              :key="file.token"
              :class="['manifest-file', { active: txtPreview?.token === file.token }]"
              @click="txtPreview = file"
            >
              <button class="manifest-file-main" type="button" @click="txtPreview = file">
                <span class="file-seal">{{ file.recommendedRole === 'manuscript' ? '文' : '料' }}</span>
                <span
                  ><b>{{ file.fileName }}</b
                  ><small
                    >{{ file.sourceFormat }} · {{ file.wordCount.toLocaleString() }} 字 ·
                    {{ file.recommendationReason }}</small
                  ></span
                >
              </button>
              <div class="manifest-file-order" @click.stop>
                <button
                  type="button"
                  :disabled="busy || index === 0"
                  :aria-label="`将 ${file.fileName} 上移`"
                  title="上移导入顺序"
                  @click="moveManifestFile(file.token, -1)"
                >
                  ↑</button
                ><button
                  type="button"
                  :disabled="busy || index === importManifest.files.length - 1"
                  :aria-label="`将 ${file.fileName} 下移`"
                  title="下移导入顺序"
                  @click="moveManifestFile(file.token, 1)"
                >
                  ↓
                </button>
              </div>
              <label @click.stop
                >用途
                <select
                  v-assist-field="{
                    id: 'AppShell.manifestRoles.file.token',
                    read: () => manifestRoles[file.token],
                    write: (value) => {
                      manifestRoles[file.token] = String(value)
                    },
                    identity: () => file
                  }"
                  v-model="manifestRoles[file.token]"
                  :data-testid="`manifest-role-${file.token}`"
                >
                  <option value="" disabled>请选择用途</option>
                  <option value="manuscript">正文</option>
                  <option value="material">作品资料</option>
                  <option value="external">外部参考</option>
                  <option value="skip">暂不采用</option>
                </select>
              </label>
            </article>
          </div>
          <div class="import-warnings">
            <span v-for="warning in importManifest.warnings" :key="warning">{{ warning }}</span>
          </div>
          <label v-if="Object.values(manifestRoles).includes('external')" class="reference-confirm"
            ><input v-model="txtImport.externalConfirmed" type="checkbox" /><span
              >我确认标为“外部参考”的文件不是本书正文，只允许隔离收藏。</span
            ></label
          >
        </section>

        <section v-if="txtImportEntry !== 'create-from-files'" v-show="step === 0" class="import-section">
          <div class="section-kicker">
            <b>一、这份 TXT 是什么？</b><span>先分清正文、自己的创作资料和外部参考，避免互相污染。</span>
          </div>
          <div class="ownership-grid">
            <button
              type="button"
              :class="{ selected: txtImport.ownership === 'owned' }"
              @click="txtImport.ownership = 'owned';
txtImport.externalConfirmed = false;"
            >
              <span>正文</span><b>我的小说书稿</b><small>逐章核对后进入正文，可以继续修改、续写与审校。</small>
            </button>
            <button
              type="button"
              :disabled="!current"
              :class="{ selected: txtImport.ownership === 'material' }"
              @click="txtImport.ownership = 'material';
txtImport.externalConfirmed = false;"
            >
              <span>资料</span><b>我的作品相关</b
              ><small>人物、大纲、设定和情节碎片进入本书素材库，不会冒充正式事实。</small>
            </button>
            <button
              type="button"
              :class="{ selected: txtImport.ownership === 'external' }"
              @click="txtImport.ownership = 'external'"
            >
              <span>外部</span><b>别人的作品</b><small>只作参考收藏，不混进正文，也不自动进入模型上下文。</small>
            </button>
          </div>
        </section>

        <section v-if="txtImport.ownership === 'owned'" v-show="step === 2" class="import-section compact-section">
          <div class="section-kicker"><b>二、创作方式</b><span>只记录来源，不影响你继续编辑。</span></div>
          <div class="origin-pills">
            <button
              v-for="item in [
                { id: 'human', label: '我独立创作' },
                { id: 'ai', label: '主要由 AI 生成' },
                { id: 'mixed', label: '我与 AI 协作' }
              ]"
              :key="item.id"
              type="button"
              :class="{ selected: txtImport.creationMethod === item.id }"
              @click="txtImport.creationMethod = item.id"
            >
              {{ item.label }}
            </button>
          </div>
        </section>

        <section v-show="step === 2" class="import-section compact-section">
          <div class="section-kicker">
            <b>{{ txtImport.ownership === 'owned' ? '三、落入哪一张书案？' : '二、归入哪部作品？' }}</b
            ><span>{{
              txtImport.ownership === 'owned'
                ? '整份文稿默认建立为独立作品，避免污染当前书稿。'
                : '资料必须归属于一部已打开的作品。'
            }}</span>
          </div>
          <template v-if="txtImport.ownership === 'owned'">
            <div v-if="txtImportEntry !== 'create-from-files' && !hostedModelMode()" class="origin-pills destination-pills">
              <button
                type="button"
                :class="{ selected: txtImport.destination === 'new' }"
                @click="txtImport.destination = 'new'"
              >
                建立新作品
              </button>
              <button
                type="button"
                :disabled="!current"
                :class="{ selected: txtImport.destination === 'current' }"
                @click="txtImport.destination = 'current'"
              >
                追加到当前作品
              </button>
            </div>
            <div class="import-fields">
              <label
                >作品名<input
                  v-assist-field="{
                    id: 'AppShell.txtImport.title',
                    read: () => txtImport.title,
                    write: (value) => {
                      txtImport.title = String(value)
                    },
                    identity: () => txtImport
                  }"
                  v-model="txtImport.title"
              /></label>
              <label v-if="txtImport.destination === 'new'"
                >题材<select
                  v-assist-field="{
                    id: 'AppShell.txtImport.genre',
                    read: () => txtImport.genre,
                    write: (value) => {
                      txtImport.genre = String(value)
                    },
                    identity: () => txtImport
                  }"
                  v-model="txtImport.genre"
                >
                  <option v-for="item in genreCatalog" :key="item.id" :value="item.id">{{ item.label }}</option>
                </select></label
              >
              <label v-if="txtImport.destination === 'new'" class="import-path"
                >保存位置
                <div class="path-row">
                  <input v-model="txtImport.parentPath" readonly placeholder="选择本地文件夹" /><button
                    type="button"
                    class="text-action compact"
                    @click="chooseTxtDestination"
                  >
                    选择
                  </button>
                </div></label
              >
              <div v-else class="current-destination">
                <span>追加到</span><b>{{ current?.title }}</b
                ><small>从现有最后一章之后开始编号，绝不覆盖已有章节。</small>
              </div>
            </div>
          </template>
          <template v-else-if="txtImport.ownership === 'material'">
            <label class="single-title"
              >资料名称<input
                v-assist-field="{
                  id: 'AppShell.txtImport.title',
                  read: () => txtImport.title,
                  write: (value) => {
                    txtImport.title = String(value)
                  },
                  identity: () => txtImport
                }"
                v-model="txtImport.title"
            /></label>
            <div v-if="current" class="current-destination reference-destination">
              <span>归入统一素材库</span><b>{{ current.title }}</b
              ><small>原始 TXT 留档，正文、人物锚点、正式事件和大纲都不会自动改变。</small>
            </div>
            <div v-else class="import-blocked">请先关闭此窗口，打开或新建一部作品，再导入作品相关资料。</div>
          </template>
          <template v-else>
            <label class="single-title"
              >资料名称<input
                v-assist-field="{
                  id: 'AppShell.txtImport.title',
                  read: () => txtImport.title,
                  write: (value) => {
                    txtImport.title = String(value)
                  },
                  identity: () => txtImport
                }"
                v-model="txtImport.title"
            /></label>
            <div v-if="current" class="current-destination reference-destination">
              <span>归入参考资料</span><b>{{ current.title }}</b
              ><small>保存于“参考资料 / 外部书籍”，默认不进入任何生成提示词。</small>
            </div>
            <div v-else class="import-blocked">请先关闭此窗口，打开或新建一部作品，再导入外部参考书。</div>
            <label v-if="current" class="reference-confirm"
              ><input v-model="txtImport.externalConfirmed" type="checkbox" /><span
                >我明白这不是我的正文，应用应将它与原创书稿严格分开。</span
              ></label
            >
          </template>
        </section>

        <nav v-if="manuscriptFiles.length > 1" v-show="step === 1" class="import-file-tabs" aria-label="待核对正文文件">
          <button v-for="file in manuscriptFiles" :key="file.token" type="button" :aria-pressed="txtPreview?.token === file.token" @click="txtPreview = file">{{ file.fileName }}<small>{{ (manifestChapterSelections[file.token] || []).length }} / {{ file.chapterCount }} 章</small></button>
        </nav>
        <p v-if="step === 1 && (txtImport.ownership !== 'owned' || (txtImportEntry === 'create-from-files' && !manuscriptFiles.length))" class="import-purpose-note">资料与外部参考不作为正文章节导入。若要从文稿建立作品，请返回第一步将至少一份文件标为正文。</p>
        <details
          v-show="step === 1"
          v-if="
            txtPreview &&
            txtImport.ownership === 'owned' &&
            (txtImportEntry !== 'create-from-files' || manifestRoles[txtPreview.token] === 'manuscript')
          "
          class="chapter-preview"
          open
        >
          <summary>
            <span>章节识别与选择 · {{ txtPreview.fileName }}</span
            ><small
              >已选
              {{
                txtImportEntry === 'create-from-files'
                  ? (manifestChapterSelections[txtPreview.token] || []).length
                  : txtImport.selectedChapterIndexes.length
              }}/{{ txtPreview.chapterCount }} 章 · 建议 {{ txtPreview.recommendedChapterCount }} 章</small
            >
          </summary>
          <div v-if="txtPreview.reviewRequired" class="chapter-diagnostic">
            <b>发现乱序或草稿风险</b
            ><span>系统只预选最前面的连续可信章节。红色“待核”内容不会自动进入正文，你仍可手动选择。</span>
          </div>
          <ol>
            <li
              v-for="chapter in txtPreview.chapters"
              :key="chapter.sourceIndex"
              :class="{ review: chapter.status === 'review' }"
            >
              <label class="chapter-select"
                ><input
                  v-if="txtImportEntry === 'create-from-files'"
                  v-model="manifestChapterSelections[txtPreview.token]"
                  type="checkbox"
                  :value="chapter.sourceIndex"
                /><input
                  v-else
                  v-model="txtImport.selectedChapterIndexes"
                  type="checkbox"
                  :value="chapter.sourceIndex"
                /><span>{{ String(chapter.order).padStart(2, '0') }}</span></label
              >
              <span
                ><strong>{{ chapter.title }}</strong
                ><small>{{ chapter.wordCount }} 字 · {{ chapter.preview || '本章暂无正文' }}</small
                ><em v-if="chapter.issues.length">待核：{{ chapter.issues.join('；') }}</em></span
              >
            </li>
          </ol>
        </details>
        <div v-if="txtPreview" v-show="step < 2" class="import-warnings">
          <span v-for="warning in txtPreview.warnings" :key="warning">{{ warning }}</span>
        </div>
      <ModelCreationDefaults
        v-if="txtImport.ownership === 'owned' && txtImport.destination === 'new' && !importCreatedProject"
        v-show="step === 2"
        :api="desktop.modelConnections"
        :disabled="busy"
        @ready="importModelsPreview = $event"
      />
      <p v-if="partialImportCreation" role="alert">
        {{ partialImportCreation.message }}再次确认只会重试本次未完成创建，不会覆盖其他目录。
      </p>
      <section v-show="step === 3" class="import-review" aria-label="导入确认摘要">
        <p class="eyebrow">READY TO ARCHIVE / 核对后入档</p>
        <h3>{{ txtImport.title || '尚未填写名称' }}</h3>
        <dl><dt>导入内容</dt><dd>{{ txtImportEntry === 'create-from-files' ? `${importManifest?.files.length || 0} 份文件 · ${selectedChapters} 章正文` : txtImport.ownership === 'owned' ? `${selectedChapters} 章正文` : txtImport.ownership === 'material' ? '作品资料' : '外部参考' }}</dd>
          <dt>保存位置</dt><dd>{{ txtImport.ownership === 'owned' && txtImport.destination === 'new' ? txtImport.parentPath || '尚未选择文件夹' : current?.title || '尚未打开作品' }}</dd>
          <template v-if="txtImport.ownership === 'owned' && txtImport.destination === 'new'"><dt>模型分配</dt><dd>{{ !importModelsPreview ? '正在读取或尚未就绪，请返回作品配置查看' : importModelsPreview.withoutDefaults ? '这本书暂不使用 AI' : importModelsPreview.defaults.template ? '使用已配置的新书默认模型' : '尚无默认模型，可正常手写' }}</dd></template>
        </dl>
        <p>原始文件完整留档。只有你确认的章节会进入正文，资料与外部参考分别保存。</p>
        <p v-if="!txtCanImport" role="status" class="import-blocked">还有内容需要核对：请检查文件用途、正文章节选择、名称、保存位置及外部参考确认。</p>
      </section>
      </div>
      <footer class="import-footer">
        <span>{{
          importCreatedProject
            ? '作品书案已经建立；再次执行只会继续未完成文件，不会重复导入已完成内容。'
            : txtImportEntry === 'create-from-files'
              ? '确认后才建立工作项；原始文件完整留档，模型结果先作为候选。'
              : '原始文件会完整留档；没有勾选的内容不会丢失。'
        }}</span>
        <div>
          <button v-if="step > 0" type="button" class="text-action" :disabled="busy" @click="goToStep(step - 1)">上一步</button>
          <button v-else type="button" class="text-action" :disabled="busy" @click="showTxtImport = false">取消</button>
          <button v-if="step < 3" type="button" class="seal-action small" data-testid="import-next-step" :disabled="busy || !filesReady" @click="goToStep(step + 1)"><span>下一步</span><i>→</i></button>
          <button v-else type="button" class="seal-action small" :disabled="busy || !txtCanImport" @click="commitTxtImport">
            <span>{{
              importCreatedProject
                ? '继续未完成导入'
                : txtImportEntry === 'create-from-files'
                  ? '按清单建立作品'
                  : txtImport.ownership === 'owned'
                    ? `导入所选 ${txtImport.selectedChapterIndexes.length} 章`
                    : txtImport.ownership === 'material'
                      ? '存入我的素材'
                      : '存入外部参考'
            }}</span
            ><i>收</i>
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.txt-import-backdrop { padding:16px; }
.txt-import-modal.import-workpage { width:min(1280px,calc(100vw - 32px)); height:calc(100dvh - 32px); max-height:none; grid-template-rows:auto auto minmax(0,1fr) auto; background:var(--surface); border-color:var(--line); outline:none; box-shadow:0 24px 80px #0004; }
.import-workpage::before,.import-workpage::after { display:none; }
.import-workpage > .import-heading { padding:20px 32px 16px; }
.import-workpage .import-scroll { padding:24px 32px; scroll-behavior:auto; overscroll-behavior:contain; }
.import-step-heading { margin:0 0 24px; display:flex; justify-content:space-between; align-items:center; font:600 24px/1.4 var(--serif); outline:none; }
.import-step-heading small { font:11px var(--sans); color:var(--muted); letter-spacing:.18em; }
.import-steps { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); padding:0 32px; border-bottom:1px solid var(--line); }
.import-steps button { display:flex; gap:12px; align-items:center; padding:14px 8px; border:0; border-bottom:2px solid transparent; background:transparent; color:var(--muted); font:13px var(--sans); transition:color 160ms,border-color 160ms; }
.import-steps button[aria-current] { color:var(--jade); border-bottom-color:var(--jade); }
.import-steps i { font:11px var(--sans); opacity:.7; }
.import-steps button:disabled { opacity:.5; }
.import-file-tabs { display:flex; flex-wrap:wrap; gap:8px; margin:20px 0; }
.import-file-tabs button { padding:10px 14px; border:1px solid var(--line); background:var(--surface); color:var(--ink); text-align:left; }
.import-file-tabs button[aria-pressed=true] { border-color:var(--jade); }
.import-file-tabs small { display:block; margin-top:4px; color:var(--muted); }
.import-workpage > .import-footer { padding:16px 32px; display:flex; gap:16px; }
.import-footer > span { font-size:12px; line-height:1.6; max-width:60%; }
.import-footer > div { flex-shrink:0; }
.import-review { max-width:850px; margin:24px auto; padding:28px; border:1px solid var(--line); border-top:3px solid var(--jade); }
.import-review h3 { font:600 30px/1.5 var(--serif); margin:12px 0 28px; }
.import-review dl { display:grid; grid-template-columns:100px minmax(0,1fr); gap:20px; font:14px/1.7 var(--sans); }
.import-review dt { color:var(--muted); }.import-review dd { margin:0; overflow-wrap:anywhere; }
.import-review > p { line-height:1.8; color:var(--muted); }
.import-workpage :is(button,input,select):focus-visible { outline:2px solid var(--jade); outline-offset:3px; }
@media(max-width:760px) { .txt-import-backdrop { padding:8px; }.txt-import-modal.import-workpage { width:calc(100vw - 16px); height:calc(100dvh - 16px); }.import-workpage > .import-heading,.import-workpage .import-scroll,.import-workpage > .import-footer { padding:14px 18px; }.import-steps { padding:0 12px; }.import-steps button { gap:5px; font-size:12px; }.import-footer > span { display:none; }.import-workpage > .import-footer { justify-content:flex-end; }.import-review { padding:18px; }.import-review dl { grid-template-columns:70px minmax(0,1fr); } }
@media(prefers-reduced-motion:reduce) { .import-steps button { transition:none; } }
</style>
