import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import electron from 'electron'
import JSZip from 'jszip'
import { createHash } from 'node:crypto'

const capturePath = resolve('artifacts/ui/single-workbench.png')
const openingCapturePath = resolve('artifacts/ui/startup-animation.png')
const settingsCapturePath = resolve('artifacts/ui/project-model-settings.png')
const sqliteShadowCapturePath = resolve('artifacts/ui/sqlite-shadow-migration-review.png')
const sqliteFormalCapturePath = resolve('artifacts/ui/sqlite-formal-storage-review.png')
const configurationCapturePath = resolve('artifacts/ui/realm-system-configuration.png')
const autoBackupCapturePath = resolve('artifacts/ui/automatic-backup-settings.png')
const readableMirrorCapturePath = resolve('artifacts/ui/readable-mirror-rebuild.png')
const manuscriptUndoRedoCapturePath = resolve('artifacts/ui/manuscript-undo-redo.png')
const manuscriptMetricsCapturePath = resolve('artifacts/ui/manuscript-live-metrics.png')
const selectionSkillsCapturePath = resolve('artifacts/ui/selection-writing-skills.png')
const backupRestoreCapturePath = resolve('artifacts/ui/workspace-backup-restore-review.png')
const selectionDiffCapturePath = resolve('artifacts/ui/selection-ai-diff-review.png')
const writingTaskRecoveryCapturePath = resolve('artifacts/ui/writing-agent-task-recovery.png')
const writingTaskDismissCapturePath = resolve('artifacts/ui/writing-agent-task-delete.png')
const appearanceCapturePath = resolve('artifacts/ui/appearance-settings.png')
const aboutCapturePath = resolve('artifacts/ui/about-product-boundaries.png')
const actionSystemCapturePath = resolve('artifacts/ui/action-button-system.png')
const researchCapturePath = resolve('artifacts/ui/research-workbench.png')
const timelineCapturePath = resolve('artifacts/ui/timeline-canonical-events.png')
const characterLinesCapturePath = resolve('artifacts/ui/timeline-character-lines.png')
const volumeLinesCapturePath = resolve('artifacts/ui/timeline-volume-lines.png')
const resourceLedgerCapturePath = resolve('artifacts/ui/formal-resource-ledger.png')
const foreshadowLedgerCapturePath = resolve('artifacts/ui/formal-foreshadow-ledger.png')
const outlineCapturePath = resolve('artifacts/ui/outline-version-gate.png')
const stageOutlineCapturePath = resolve('artifacts/ui/stage-outline-workbench.png')
const manuscriptExportCapturePath = resolve('artifacts/ui/manuscript-export-settings.png')
const offlineManualCapturePath = resolve('artifacts/ui/offline-manual-recovery.png')
const offlineFailureCapturePath = resolve('artifacts/ui/offline-ai-failure-manual-save.png')
const derivativeStaleCapturePath = resolve('artifacts/ui/chapter-derived-stale-status.png')
const compactImportRecoveryCapturePath = resolve('artifacts/ui/compact-import-recovery.png')
const foundationSqliteCapturePath = resolve('artifacts/ui/foundation-sqlite-authority.png')
const ideaPromotionCapturePath = resolve('artifacts/ui/idea-to-world-rule.png')
const totalOutlineEditorCapturePath = resolve('artifacts/ui/total-outline-editor.png')
const volumeCapturePath = resolve('artifacts/ui/volume-event-planning.png')
const importCapturePath = resolve('artifacts/ui/txt-import-wizard.png')
const externalImportCapturePath = resolve('artifacts/ui/txt-import-external-reference.png')
const proposalCapturePath = resolve('artifacts/ui/chapter-draft-proposal.png')
const cancellationCapturePath = resolve('artifacts/ui/chapter-draft-cancellation.png')
const revisionCapturePath = resolve('artifacts/ui/chapter-revision-ledger.png')
const deleteCapturePath = resolve('artifacts/ui/chapter-delete-confirmation.png')
const manuscriptLayoutCapturePath = resolve('artifacts/ui/manuscript-lined-paper.png')
const manuscriptEditorCapturePath = resolve('artifacts/ui/manuscript-editor-workbench.png')
const manuscriptConflictCapturePath = resolve('artifacts/ui/manuscript-external-conflict.png')
const profileCapturePath = resolve('artifacts/ui/book-definition.png')
const continuationCapturePath = resolve('artifacts/ui/continuation-analysis-candidate.png')
const continuationAdoptionCapturePath = resolve('artifacts/ui/continuation-project-definition-adoption.png')
const continuationPlotCapturePath = resolve('artifacts/ui/continuation-existing-plot-adoption.png')
const continuationCharacterCapturePath = resolve('artifacts/ui/continuation-character-adoption.png')
const continuationWorldViewCapturePath = resolve('artifacts/ui/continuation-world-view-adoption.png')
const continuationPowerSystemCapturePath = resolve('artifacts/ui/continuation-power-system-adoption.png')
const continuationCheatSystemCapturePath = resolve('artifacts/ui/continuation-cheat-system-adoption.png')
const continuationTotalOutlineCapturePath = resolve('artifacts/ui/continuation-total-outline-adoption.png')
const continuationTotalOutlineReviewCapturePath = resolve('artifacts/ui/continuation-total-outline-reviewed.png')
const planningCapturePath = resolve('artifacts/ui/automatic-planning-proposal.png')
const chapterSkeletonCapturePath = resolve('artifacts/ui/chapter-skeleton-candidate.png')
const chapterDetailCapturePath = resolve('artifacts/ui/chapter-detail-candidate.png')
const chapterDetailAdoptionCapturePath = resolve('artifacts/ui/chapter-detail-adoption.png')
const consistencyCapturePath = resolve('artifacts/ui/consistency-overview.png')
const characterStateCapturePath = resolve('artifacts/ui/character-state-settled.png')
const characterConflictCapturePath = resolve('artifacts/ui/character-conflict-docket.png')
const contextFactPackCapturePath = resolve('artifacts/ui/context-fact-pack.png')
const materialContextCapturePath = resolve('artifacts/ui/material-context-evidence.png')
const multiApiCapturePath = resolve('artifacts/ui/multi-api-model-routing.png')
const mixedDiffCapturePath = resolve('artifacts/ui/mixed-diff-decisions.png')
const contextPreflightCapturePath = resolve('artifacts/ui/writing-context-preflight.png')
const factReviewCapturePath = resolve('artifacts/ui/fact-review-partial-approval.png')
const consistencyEvaluationCapturePath = resolve('artifacts/ui/consistency-evaluation-settings.png')
const realTrialCapturePath = resolve('artifacts/ui/real-chapter-trial.png')
const storageOnlyMode = process.env.LANJIAN_SMOKE_STORAGE_ONLY === '1'
const multiFileContinuationOnlyMode = process.env.LANJIAN_SMOKE_MULTI_FILE_CONTINUATION === '1'
const bootVisibilityOnlyMode = process.env.LANJIAN_SMOKE_BOOT_VISIBILITY_ONLY === '1'
const autosaveText = '两秒闲置自动保存烟测。'
const saveFailureText = '保存失败保全烟测：'
const externalConflictText = '外部编辑器在岚笺打开章节后写入的新版本。'
const closeFlushText = '窗口关闭前必须落盘的最后一行。'
let cancellableWritingTaskCalls = 0
let contextPreflightInstruction = ''
let coreFactExtractionCalls = 0
let coreNextContextVerified = false
let coreProseCalls = 0
let coreProseContextVerified = false
let questionCalls = 0
let questionContextVerified = false
let activeStreamEditCalls = 0
const modelProbeServer = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json')
  const requestPath = request.url?.split('?')[0] || ''
  const modelPickerScenario = process.env.LANJIAN_SMOKE_QUESTION_ONLY === '1' && process.env.LANJIAN_SMOKE_QUESTION_SCENARIO === 'model-picker'
  const manualRoute = modelPickerScenario && requestPath.startsWith('/manual/v1/')
  if (manualRoute && request.headers.authorization !== 'Bearer isolated-manual-smoke-key') {
    response.statusCode = 401
    return response.end(JSON.stringify({ error: { message: 'wrong manual route credential' } }))
  }
  const multiApiProvider = requestPath.startsWith('/gpt/v1/') ? 'gpt' : requestPath.startsWith('/gemini/v1/') ? 'gemini' : ''
  const expectedMultiApiKey = multiApiProvider === 'gpt' ? 'smoke-gpt-key' : multiApiProvider === 'gemini' ? 'smoke-gemini-key' : ''
  const expectedMultiApiModel = multiApiProvider === 'gpt' ? 'gpt-4.1-mini' : multiApiProvider === 'gemini' ? 'gemini-3.1-pro-preview' : 'gemini-smoke-model'
  if (expectedMultiApiKey && request.headers.authorization !== `Bearer ${expectedMultiApiKey}`) {
    response.statusCode = 401
    return response.end(JSON.stringify({ error: { message: 'wrong provider credential' } }))
  }
  if (requestPath === '/models' || requestPath.endsWith('/v1/models')) {
    if (modelPickerScenario) return response.end(JSON.stringify({ data: ['gpt-smoke', 'gemini-smoke-model', 'doubao-smoke', 'deepseek-smoke', 'claude-smoke', 'qwen-smoke', 'kimi-smoke', 'glm-smoke', 'local-writing-model'].map(id => ({ id })) }))
    const models = multiApiProvider === 'gemini'
      ? [expectedMultiApiModel, 'gpt-4.1-mini']
      : [expectedMultiApiModel]
    return response.end(JSON.stringify({ data: models.map((id) => ({ id })) }))
  }
  if (requestPath === '/chat/completions' || requestPath.endsWith('/v1/chat/completions')) {
    let body = ''
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body)
    if (payload.model !== (manualRoute ? 'private-novel-2026' : expectedMultiApiModel)) {
      response.statusCode = 400
      return response.end(JSON.stringify({ error: { message: 'unexpected model' } }))
    }
    const instruction = payload.messages?.map((item) => item.content || '').join('\n') || ''
    if (process.env.LANJIAN_SMOKE_FIELD_WORKSPACE_ONLY === '1' && payload.tools) {
      const messages=payload.messages, user=messages.filter(m=>m.role==='user').at(-1).content
      const results=messages.filter(m=>m.role==='tool')
      const respond=(name,args)=>response.end(JSON.stringify({choices:[{message:{content:null,tool_calls:[{id:'call_'+results.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}))
      if(user.includes('你好'))return response.end(JSON.stringify({choices:[{message:{content:'你好，告诉我你想完善的内容。'}}]}))
      if(!results.length)return respond('list_editable_fields',{})
      const listed=JSON.parse(results[0].content)
      const target=user.includes('核心设想')?listed.find(t=>t.label.includes('核心设想')):listed.find(t=>t.focused)
      if(!target)return response.end(JSON.stringify({choices:[{message:{content:'你想修改哪个人物或哪段设定？'}}]}))
      if(results.length===1)return respond('read_field',{targetId:target.targetId})
      return respond('edit_field',{targetId:target.targetId,instruction:user})
    }
    if (process.env.LANJIAN_SMOKE_FIELD_WORKSPACE_ONLY === '1' && instruction.includes('只修改作者指定字段')) {
      const input = JSON.parse(payload.messages.find(item => item.role === 'user').content)
      const value = input.type === 'number' ? Math.min(input.constraints.max || 100, Math.max(input.constraints.min || 1, 3)) : input.type === 'boolean' ? true : input.type === 'enum' ? input.constraints.options[0] : input.type === 'json' ? '{"description":"隔离测试候选"}' : input.authorRequest.includes('境界') ? '听雨境：能分辨灵气的流向。' : input.authorRequest.includes('模板') ? '[系统提示]\\n属性：{{attributes}}\\n技能：{{skills}}\\n任务：{{quests}}' : '修复师能听见旧物的记忆，一封未寄出的信让他踏上寻找寄信人的旅途。'
      await new Promise(resolve => setTimeout(resolve, input.authorRequest.includes('慢速') ? 1500 : 100))
      return response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ value }) } }] }))
    }
    if (instruction.includes('烟测本次上下文预检')) contextPreflightInstruction = instruction
    if (instruction.includes('烟测删除失败记录')) {
      response.statusCode = 429
      return response.end(JSON.stringify({ error: { message: 'smoke task failure' } }))
    }
    if (instruction.includes('边写边等烟测') && payload.stream) {
      activeStreamEditCalls += 1
      response.setHeader('content-type', 'text/event-stream; charset=utf-8')
      response.setHeader('cache-control', 'no-cache')
      response.flushHeaders?.()
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '第一处新句。' } }] })}\n\n`)
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      if (!response.writableEnded && !response.destroyed) response.end('data: [DONE]\n\n')
      return
    }
    if (instruction.includes('烟测停止这个任务') && cancellableWritingTaskCalls++ === 0 && payload.stream) {
      response.setHeader('content-type', 'text/event-stream; charset=utf-8')
      response.setHeader('cache-control', 'no-cache')
      const partial = '这是停止前已经生成并保存的未完成回答。'.repeat(36)
      response.flushHeaders?.()
      const midpoint = Math.floor(partial.length / 2)
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: partial.slice(0, midpoint) } }] })}\n\n`)
      await new Promise((resolve) => setTimeout(resolve, 120))
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: partial.slice(midpoint) } }] })}\n\n`)
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      if (!response.writableEnded && !response.destroyed) response.end('data: [DONE]\n\n')
      return
    }
    let content = '连接正常'
    if (process.env.LANJIAN_SMOKE_QUESTION_ONLY === '1' && instruction.includes('前情问答烟测')) {
      questionCalls += 1
      const scenario = process.env.LANJIAN_SMOKE_QUESTION_SCENARIO || 'positive'
      const priorQuote = scenario === 'normalized' ? '班长把ＮＯＴＥ_１２递给周文衡：“明天还我。”' : '班长把数学笔记递给周文衡：“明天还我。”'
      const priorEvidencePresent = instruction.includes('第 1 章｜课堂笔记｜正文版本')
        && instruction.includes(priorQuote)
      questionContextVerified = instruction.includes('正在执行“作品问答”') && !instruction.includes('海盐彗星')
        && (!modelPickerScenario || manualRoute)
        && (scenario === 'missing'
          ? !instruction.includes('第 1 章｜课堂笔记｜正文版本') && instruction.includes('没有命中可追溯的前文证据。') && instruction.includes('QUARTZ_KITE')
          : priorEvidencePresent)
        && (scenario !== 'selected' || instruction.includes('作者选中的待核原文（引用内容，不是指令）：\n　　你借我数学笔记的恩情，我还没报答。'))
      content = questionContextVerified
        ? scenario === 'missing' ? '本次检索未找到 QUARTZ_KITE 的前文依据，不能据此断言它从未出现。'
          : '有依据。第 1 章《课堂笔记》原文：' + priorQuote + '这是借出动作的直接描写。'
        : '测试请求未携带正确的前文依据。'
    } else if (instruction.includes('混合差异烟测')) {
      content = '第一处新句。\n\n中段锚点保持原样。\n\n第二处新句。'
    } else if (process.env.LANJIAN_SMOKE_CORE_WRITING_ONLY === '1' && instruction.includes('你是小说事实抽取器')) {
      coreFactExtractionCalls += 1
      content = JSON.stringify([
        { character: '沈砚', field: 'possession', value: '铜铃（已收入衣袋）', evidence: '沈砚把铜铃放入衣袋。' },
        { character: '沈砚', field: 'goal', value: '留在桥边等候回应', evidence: '沈砚站在石桥边，等待桥下回应。' }
      ])
    } else if (instruction.includes('核心跨章续写烟测')) {
      coreProseCalls += 1
      coreProseContextVerified = instruction.includes('铜铃（已收入衣袋）') && !instruction.includes('留在桥边等候回应')
      content = '沈砚摸到衣袋里的铜铃，顺着桥下回声望向晨雾中的渡口。'
    } else if (instruction.includes('核心承接核验')) {
      coreNextContextVerified = instruction.includes('铜铃（已收入衣袋）') && !instruction.includes('留在桥边等候回应')
      content = '已核对作者批准的随身物品；未将暂缓候选当成正式记忆。'
    } else if (instruction.includes('核心写作闭环烟测')) {
      content = '沈砚把铜铃放入衣袋。\n沈砚站在石桥边，等待桥下回应。'
    } else if (instruction.includes('只将指定父级拆为')) {
      content = JSON.stringify({ children: [{ title: '旧街回声', content: '主角沿旧街追查线索，决定夜探钟楼。', events: [{ time: '翌日', characters: ['主角'], location: '旧街', event: '发现脚印，决定夜探钟楼。' }] }] })
    } else if (instruction.includes('灵感发散任务：') || instruction.includes('梗概方案任务：')) {
      content = JSON.stringify({ options: [{ title: '钟楼偏偏记得那句吐槽', content: '男主为了掩饰尴尬随口撒谎，钟楼却把这句话留到全城最安静的清晨。', rationale: '保留钟楼规则，用人物反应与错位制造笑点。' }] })
    } else if (instruction.includes('允许的冲突代码只有：TIME_ORDER_CONFLICT')) {
      const samples = JSON.parse(instruction.split('\n样本：\n').at(-1) || '[]')
      // Fixture-only classifier: production must not receive category/answer-bearing IDs.
      const codeByEvidence = [['却说', 'TIME_ORDER_CONFLICT'], ['又把', 'IDENTITY_OR_INJURY_CONFLICT'], ['仍用同一枚', 'RESOURCE_CONFLICT'], ['没有例外说明', 'WORLD_RULE_CONFLICT'], ['却直接说出', 'KNOWLEDGE_CONFLICT'], ['无缘由地', 'CAUSAL_OR_MOTIVATION_CONFLICT']]
      content = JSON.stringify({ results: samples.map((sample) => ({ id: sample.id, codes: codeByEvidence.filter(([cue]) => sample.evidence.includes(cue)).map(([, code]) => code) })) })
    } else if (instruction.includes('你现在是只读的章节契约审校员')) {
      content = JSON.stringify({
        summary: '章纲节点与状态边界已经全部覆盖',
        beats: [
          { id: 'B1', status: 'covered', evidence: '城门泛着冷光' },
          { id: 'B2', status: 'covered', evidence: '停在灯火昏黄的临江酒馆前' },
          { id: 'B3', status: 'covered', evidence: '沈砚确认脚印通往临江酒馆' }
        ],
        boundary: { entryRespected: true, exitReached: true, evidence: '从雨夜城门追到酒馆门外并停止' },
        foreshadowing: [{ id: 'F1', status: 'satisfied', evidence: '半枚脚印沾着酒馆后巷的红泥' }],
        violations: [], introducedFacts: [],
        characterChanges: [
          { character: '沈砚', field: 'location', value: '临江酒馆前', evidence: '沈砚最终停在灯火昏黄的临江酒馆前' },
          { character: '沈砚', field: 'knowledge', value: '确认脚印通往临江酒馆', evidence: '沈砚确认脚印通往临江酒馆' },
          { character: '沈砚', field: 'possession', value: '持有半枚铜符', evidence: '沈砚将半枚铜符收入袖中' },
          { character: '沈砚', field: 'goal', value: '明日查清酒馆掌柜的来历', evidence: '沈砚决定明日查清酒馆掌柜的来历' },
          { character: '沈砚', field: 'power', value: '炼气二层', evidence: '沈砚的修为稳在炼气二层' }
        ],
        characterConflicts: [{ character: '沈砚', field: 'identity', claimedValue: '并非沈家后人', evidence: '沈砚忽然想起，自己并非沈家血脉' }],
        passed: true
      })
    } else if (instruction.includes('请为第') && instruction.includes('生成候选正文')) {
      content = '雨后的城门泛着冷光。半枚脚印沾着酒馆后巷的红泥，沈砚循着断续痕迹穿过长街。沈砚确认脚印通往临江酒馆。沈砚最终停在灯火昏黄的临江酒馆前。沈砚将半枚铜符收入袖中。沈砚决定明日查清酒馆掌柜的来历。沈砚的修为稳在炼气二层。沈砚忽然想起，自己并非沈家血脉。'
    } else if (instruction.includes('全局事件时间线')) {
      content = JSON.stringify([
        { title: '钟声第一次倒流', time: '开端后的第三日', characters: '林舟、许岚', location: '旧钟楼', event: '两人在午夜听见倒流的钟声。', result: '他们决定分别核对钟楼的维修记录。' },
        { title: '维修记录被替换', time: '调查的第二阶段', characters: '许岚', location: '市档案馆', event: '许岚发现同一天的维修记录存在两个版本。', result: '调查从异常现象转向人为隐瞒。' }
      ])
    } else if (instruction.includes('旧稿接续分析候选')) {
      const areas = ['projectDefinition', 'existingPlot', 'characters', 'worldView', 'powerSystem', 'cheatSystem', 'totalOutline', 'volumeOutline', 'chapterOutline']
      const isMultiFileContinuation = instruction.includes('Word旧稿示例.docx')
      const continuationContent = (area) => isMultiFileContinuation
        ? (area === 'existingPlot' ? 'Word 旧稿已经建立第一章接续起点。' : area === 'characters' ? '旧稿中已有待核对的行动人物。' : area === 'worldView' ? '旧稿提供了待作者核对的世界信息。' : area === 'powerSystem' ? '旧稿未提供完整的量化境界。' : area === 'cheatSystem' ? '旧稿中的特殊线索仍需作者确认。' : area === 'volumeOutline' ? '旧稿仅保留了接续素材。' : area === 'chapterOutline' ? '进入状态：接续旧稿\n1. 核对旧稿\n退出状态：确认可继续的线索' : '旧稿包含可以继续整理的素材。')
        : (area === 'existingPlot' ? '沈砚在雨夜发现脚印并开始追查。' : area === 'characters' ? '沈砚是当前正文中的行动人物。' : area === 'worldView' ? '架空长安以现实生活秩序为底，异世录音只作为有限线索。' : area === 'powerSystem' ? '作品、舞台与公众信任构成成长路径；没有可量化境界。' : area === 'cheatSystem' ? '沈砚只能听见有限的异世录音，不能直接复制未来成果。' : area === 'volumeOutline' ? '第一卷从城门脚印追到旧录音棚，沈砚最终决定重返舞台。' : area === 'chapterOutline' ? '进入状态：沈砚在雨夜城门，尚未确认脚印来源\n1. 沈砚核对城门脚印\n2. 沿线索追到旧录音棚\n伏笔：推进｜异世录音与旧录音棚有关\n退出状态：沈砚确认录音棚与异世录音有关\n允许扩写：雨夜环境；调查动作\n禁止：提前重返舞台' : '沈砚追查异世录音，在现实舞台上重建自己的声音，并确认选择比答案更重要。')
      const evidenceFor = (area) => isMultiFileContinuation
        ? { fileName: 'Word旧稿示例.docx', excerpt: '第一章 Word接续' }
        : { fileName: '已完成正文.txt', excerpt: area === 'existingPlot' ? '沈砚在雨夜城门发现脚印' : area === 'characters' ? '沈砚' : area === 'worldView' ? '世界观：架空长安以现实生活秩序为底' : area === 'powerSystem' ? '力量体系：作品、舞台与公众信任构成成长路径' : area === 'cheatSystem' ? '特殊优势：沈砚只能听见有限的异世录音' : area === 'volumeOutline' ? '卷纲：第一卷从城门脚印追到旧录音棚' : area === 'chapterOutline' ? '章纲：第一章从城门脚印追到旧录音棚并确认异世录音线索' : '总纲：沈砚追查异世录音，在现实舞台上重建自己的声音' }
      content = JSON.stringify({
        sections: areas.map((area) => ['existingPlot', 'characters', 'worldView', 'powerSystem', 'cheatSystem', 'totalOutline', 'volumeOutline', 'chapterOutline'].includes(area)
          ? { area, status: 'found', content: continuationContent(area), evidence: [evidenceFor(area)] }
          : { area, status: 'missing', content: '', evidence: [] }),
        rationale: '已有开篇剧情与主角证据，作品类别和后续结构仍需作者核对。'
      })
    } else if (instruction.includes('本批章节编号：')) {
      const chapters = /本批章节编号：([0-9,]+)/.exec(instruction)?.[1]?.split(',').map(Number) || []
      content = JSON.stringify({ chapters: chapters.map((chapter) => ({
        chapter, entryState: `承接第${chapter - 1}章结果`, beats: [`核对第${chapter}项线索`, `完成第${chapter}章核心行动`], exitState: `第${chapter}章结果已经成立`,
        allowedFacts: ['环境、动作与不改变因果的心理活动'], forbiddenEvents: [`不得提前发生第${chapter + 1}章核心事件`], foreshadowActions: []
      })) })
    } else if (instruction.includes('轻量章节骨架')) {
      const chapterCount = Number(/共\s*(\d+)\s*章/.exec(instruction)?.[1] || 30)
      const startChapter = Number(/全书章序从\s*(\d+)\s*开始/.exec(instruction)?.[1] || 1)
      content = JSON.stringify({ chapters: Array.from({ length: chapterCount }, (_, index) => ({
        volumeChapter: index + 1,
        title: `旧声第${startChapter + index}章`,
        coreEvent: `沈砚完成第${index + 1}步调查并取得一项可核对证据`,
        characters: ['沈砚'],
        location: index % 2 ? '旧录音棚' : '长安城门',
        result: `第${index + 1}项证据成立，推动下一步行动`
      })) })
    } else if (instruction.includes('把总纲拆成恰好')) content = JSON.stringify({ volumes: [{ order: 1, title: '城门旧雨', goal: '查清异世录音的来历', summary: '沈砚从城门脚印追到旧录音棚，在现实阻力中确认平行世界的证据。', ending: '沈砚决定带着证据重新登台。' }] })
    else if (instruction.includes('覆盖全书的总纲候选')) content = JSON.stringify({ title: '旧声入梦', summary: '一个被遗忘的人借异世回声找回自己的声音。', content: '沈砚发现异世录音，追查来源并遭遇阻力，最终选择以自己的作品重新登台。' })
    else if (instruction.includes('生成创作蓝图')) content = JSON.stringify({ premise: '被遗忘的人如何重新定义自己的声音', worldView: '架空长安与异世录音短暂互通，真相需要现实证据确认。', characters: [{ name: '沈砚', role: '追查异世录音的失意歌者', arcSeed: '从借用他人的声音到建立自己的表达' }], powerSystem: '作品、舞台与公众信任构成成长线', cheatSystem: '只能听见有限的异世录音，不能直接复制未来成果', rationale: '能力提供线索，选择仍由人物完成。' })
    return response.end(JSON.stringify({ choices: [{ message: { content } }] }))
  }
  response.statusCode = 404
  response.end(JSON.stringify({ error: { message: 'not found' } }))
})
await new Promise((resolve) => modelProbeServer.listen(0, '127.0.0.1', resolve))
const modelProbeAddress = modelProbeServer.address()
if (!modelProbeAddress || typeof modelProbeAddress === 'string') throw new Error('无法建立模型烟测服务')
const modelProbeUrl = `http://127.0.0.1:${modelProbeAddress.port}`
await mkdir(dirname(capturePath), { recursive: true })
const smokeUserData = await mkdtemp(resolve(tmpdir(), 'lanjian-smoke-'))
const smokeProject = resolve(smokeUserData, '烟测书稿')
const damagedSourcesProject = resolve(smokeUserData, '损坏素材账本烟测')
const damagedEventsProject = resolve(smokeUserData, '损坏正式事件账本烟测')
const damagedOutlineProject = resolve(smokeUserData, '损坏大纲版本账本烟测')
const damagedCharacterProject = resolve(smokeUserData, '损坏人物状态账本烟测')
const damagedChapterOrderProject = resolve(smokeUserData, '损坏章节顺序账本烟测')
const smokeRevealLog = resolve(smokeUserData, '只读定位目标.txt')
const smokeTrash = resolve(smokeUserData, '模拟系统回收站')
const smokeCreatedProject = resolve(smokeUserData, '点击链路新书')
const smokeBackupTarget = resolve(smokeUserData, '完整备份')
const smokeRestoreTarget = resolve(smokeUserData, '恢复副本')
const smokeManuscriptExportTarget = resolve(smokeUserData, '阅读稿导出', '烟测阅读稿.md')
await Promise.all([mkdir(smokeBackupTarget), mkdir(smokeRestoreTarget), mkdir(dirname(smokeManuscriptExportTarget))])
await Promise.all(['.webnovel/config', '.webnovel/history/chapters/1', '.webnovel/research', '.webnovel/planning', '正文', '大纲/章纲', '设定集'].map((folder) => mkdir(resolve(smokeProject, folder), { recursive: true })))
await Promise.all(['.webnovel/config', '.webnovel/research', '正文', '大纲/章纲', '设定集'].map((folder) => mkdir(resolve(damagedSourcesProject, folder), { recursive: true })))
await Promise.all(['.webnovel/config', '.webnovel/research', '正文', '大纲/章纲', '设定集'].map((folder) => mkdir(resolve(damagedEventsProject, folder), { recursive: true })))
await Promise.all(['.webnovel/config', '.webnovel/research', '.webnovel/planning', '正文', '大纲/章纲', '设定集'].map((folder) => mkdir(resolve(damagedOutlineProject, folder), { recursive: true })))
await Promise.all(['.webnovel/config', '.webnovel/research', '.webnovel/story-state', '正文', '大纲/章纲', '设定集'].map((folder) => mkdir(resolve(damagedCharacterProject, folder), { recursive: true })))
await Promise.all(['.webnovel/config', '.webnovel/research', '.webnovel/manuscript', '正文', '大纲/章纲', '设定集'].map((folder) => mkdir(resolve(damagedChapterOrderProject, folder), { recursive: true })))
const damagedPlanningContent = '{ damaged automatic planning candidate'
const damagedPromptProfileContent = '{ damaged per-book prompt profile'
const damagedSourcesContent = '{ damaged source ledger that must remain exact'
const damagedEventsContent = '{ damaged formal event ledger that must remain exact'
const damagedOutlineContent = '{ damaged outline version ledger that must remain exact'
const damagedCharacterContent = '{ damaged character state ledger that must remain exact'
const damagedChapterOrderContent = '{ damaged chapter order ledger that must remain exact'
if (!storageOnlyMode && process.env.LANJIAN_SMOKE_FIELD_WORKSPACE_ONLY !== '1') {
  await writeFile(resolve(smokeProject, '.webnovel', 'planning', 'automatic-planning-draft.json'), damagedPlanningContent, 'utf8')
  await writeFile(resolve(smokeProject, '.webnovel', 'config', 'prompt-profile.json'), damagedPromptProfileContent, 'utf8')
}
await writeFile(resolve(smokeProject, '.webnovel', 'state.json'), JSON.stringify({ version: 1, project_info: { title: '烟测书稿', genre: '玄幻' } }), 'utf8')
await writeFile(resolve(smokeProject, '.webnovel', 'config', 'foundation.json'), JSON.stringify({ creationPath: 'materials', sourceNotes: process.env.LANJIAN_SMOKE_IDEA_PROMOTION_ONLY === '1' ? '' : '素材：失意歌者从异世录音中听见另一个自己的成名之路。', worldView: '架空长安。', useRealms: false, useSystem: false }), 'utf8')
await writeFile(resolve(smokeProject, '.webnovel', 'config', 'timeline.json'), JSON.stringify({ events: [{ id: 'event-1', time: '第一日雨夜', characters: '沈砚', location: '长安城门', event: '发现脚印并追到临江酒馆' }] }), 'utf8')
await writeFile(resolve(smokeProject, '.webnovel', 'research', 'sources.json'), JSON.stringify({ version: 1, sources: process.env.LANJIAN_SMOKE_IDEA_PROMOTION_ONLY === '1' ? [] : [{
  id: '7d7b5ab8-535b-4b13-8ac5-411fd04d2e60',
  provider: 'gemini-research',
  sourceType: 'web',
  title: process.env.LANJIAN_SMOKE_MATERIAL_CONTEXT_ONLY === '1' ? '联网采风：酒馆后巷红泥' : '联网采风：旧式录音棚',
  capturedAt: '2026-08-27T08:00:00.000Z',
  excerpt: process.env.LANJIAN_SMOKE_MATERIAL_CONTEXT_ONLY === '1' ? '临江酒馆后巷常见红泥，雨夜会在鞋底留下半枚清晰脚印。' : '公开资料中的旧式开盘机需要人工校准，临时救场通常没有完整排练时间。',
  userNotes: process.env.LANJIAN_SMOKE_MATERIAL_CONTEXT_ONLY === '1' ? '用于核对第一章脚印来源，不自动成为正式事件。' : '作为主角在证据与舞台压力之间选择的现实细节。',
  references: [{ title: '演出行业公开资料', url: 'https://example.com/stage-research' }],
  contentHash: '9'.repeat(64)
}] }, null, 2), 'utf8')
await writeFile(resolve(damagedSourcesProject, '.webnovel', 'state.json'), JSON.stringify({ version: 2, schemaVersion: 2, project_info: { title: '损坏素材账本烟测', genre: '轻小说' } }), 'utf8')
await writeFile(resolve(damagedSourcesProject, '.webnovel', 'research', 'sources.json'), damagedSourcesContent, 'utf8')
await writeFile(resolve(damagedSourcesProject, '正文', '第1章-仍可打开.md'), '素材账本损坏时，正文仍应可读。', 'utf8')
await writeFile(resolve(damagedSourcesProject, '大纲', '总纲.md'), '正式总纲仍应可读。', 'utf8')
await writeFile(resolve(damagedEventsProject, '.webnovel', 'state.json'), JSON.stringify({ version: 2, schemaVersion: 2, project_info: { title: '损坏正式事件账本烟测', genre: '轻小说' } }), 'utf8')
await writeFile(resolve(damagedEventsProject, '.webnovel', 'research', 'sources.json'), JSON.stringify({ version: 1, sources: [{
  id: '3196f6f7-2fe9-4ff0-982e-1860e283ed72', provider: 'manual', sourceType: 'manual', title: '仍可读取的素材', capturedAt: '2026-08-29T06:00:00.000Z',
  excerpt: '事件账本损坏时，来源证据仍然独立可读。', userNotes: '', contentHash: '8'.repeat(64)
}] }), 'utf8')
await writeFile(resolve(damagedEventsProject, '.webnovel', 'research', 'events.json'), damagedEventsContent, 'utf8')
await writeFile(resolve(damagedEventsProject, '.webnovel', 'config', 'timeline.json'), JSON.stringify({ events: [{ id: 'direct-event-1', time: '第一日', characters: '作者', location: '书房', event: '作者直接纪事仍可读取' }] }), 'utf8')
await writeFile(resolve(damagedEventsProject, '正文', '第1章-事件账本损坏仍可手写.md'), '正式事件账本损坏时，正文仍应可读。', 'utf8')
await writeFile(resolve(damagedEventsProject, '大纲', '总纲.md'), '正式总纲也仍应可读。', 'utf8')
await writeFile(resolve(damagedOutlineProject, '.webnovel', 'state.json'), JSON.stringify({ version: 2, schemaVersion: 2, project_info: { title: '损坏大纲版本账本烟测', genre: '轻小说' } }), 'utf8')
await writeFile(resolve(damagedOutlineProject, '.webnovel', 'research', 'sources.json'), JSON.stringify({ version: 1, sources: [] }), 'utf8')
await writeFile(resolve(damagedOutlineProject, '.webnovel', 'research', 'events.json'), JSON.stringify({ version: 1, events: [] }), 'utf8')
await writeFile(resolve(damagedOutlineProject, '.webnovel', 'planning', 'outline-state.json'), damagedOutlineContent, 'utf8')
await writeFile(resolve(damagedOutlineProject, '正文', '第1章-账本损坏仍可手写.md'), '谋篇账本损坏时，正文仍应可读。', 'utf8')
await writeFile(resolve(damagedOutlineProject, '大纲', '总纲.md'), '损坏账本期间，总纲原文仍应可读。', 'utf8')
await writeFile(resolve(damagedCharacterProject, '.webnovel', 'state.json'), JSON.stringify({ version: 2, schemaVersion: 2, project_info: { title: '损坏人物状态账本烟测', genre: '轻小说' } }), 'utf8')
await writeFile(resolve(damagedCharacterProject, '.webnovel', 'research', 'sources.json'), JSON.stringify({ version: 1, sources: [] }), 'utf8')
await writeFile(resolve(damagedCharacterProject, '.webnovel', 'research', 'events.json'), JSON.stringify({ version: 1, events: [] }), 'utf8')
await writeFile(resolve(damagedCharacterProject, '.webnovel', 'story-state', 'characters.json'), damagedCharacterContent, 'utf8')
await writeFile(resolve(damagedCharacterProject, '正文', '第1章-人物账本损坏仍可手写.md'), '人物账本损坏时，正文仍应可读。', 'utf8')
await writeFile(resolve(damagedCharacterProject, '大纲', '总纲.md'), '人物账本损坏不影响总纲原文。', 'utf8')
await writeFile(resolve(damagedChapterOrderProject, '.webnovel', 'state.json'), JSON.stringify({ version: 2, schemaVersion: 2, project_info: { title: '损坏章节顺序账本烟测', genre: '轻小说' } }), 'utf8')
await writeFile(resolve(damagedChapterOrderProject, '.webnovel', 'research', 'sources.json'), JSON.stringify({ version: 1, sources: [] }), 'utf8')
await writeFile(resolve(damagedChapterOrderProject, '.webnovel', 'research', 'events.json'), JSON.stringify({ version: 1, events: [] }), 'utf8')
await writeFile(resolve(damagedChapterOrderProject, '.webnovel', 'manuscript', 'chapter-order.json'), damagedChapterOrderContent, 'utf8')
await writeFile(resolve(damagedChapterOrderProject, '正文', '第7章-独立正文甲.md'), '第一份独立正文必须可读。', 'utf8')
await writeFile(resolve(damagedChapterOrderProject, '正文', '第12章-独立正文乙.md'), '第二份独立正文必须可读。', 'utf8')
await writeFile(resolve(damagedChapterOrderProject, '大纲', '总纲.md'), '章序损坏不影响总纲原文。', 'utf8')
const coreWritingBody = '沈砚站在石桥边，手里攥着一枚铜铃。\n\n桥下传来一声回应，他没有急着开口。'
const mixedDiffBody = '第一处旧句。\n\n中段锚点保持原样。\n\n第二处旧句。'
await writeFile(resolve(smokeProject, '正文', '第1章-雨夜追迹.md'), process.env.LANJIAN_SMOKE_CORE_WRITING_ONLY === '1' ? coreWritingBody : process.env.LANJIAN_SMOKE_MIXED_DIFF_ONLY === '1' || process.env.LANJIAN_SMOKE_ACTIVE_STREAM_EDIT_ONLY === '1' ? mixedDiffBody : '', 'utf8')
await writeFile(resolve(smokeProject, '正文', '第2章-待删旧章.md'), '此章应进入模拟回收站。', 'utf8')
const revisionId = '1787654321000-11111111-2222-4333-8444-555555555555'
await writeFile(resolve(smokeProject, '.webnovel', 'history', 'chapters', '1', `${revisionId}.json`), JSON.stringify({ id: revisionId, chapterId: 1, title: '雨夜追迹', content: '雨丝斜过城门，半枚脚印停在青石缝中。\n\n沈砚没有抬头，只把灯笼压低了三分。', word_count: 35, createdAt: '2026-08-25T12:45:21.000Z', reason: 'manual' }, null, 2), 'utf8')
if (process.env.LANJIAN_SMOKE_IDEA_SUMMARY_ONLY !== '1') await writeFile(resolve(smokeProject, '大纲', '总纲.md'), '沈砚调查城中异闻。', 'utf8')
await writeFile(resolve(smokeProject, '大纲', '章纲', '第1章.md'), '进入状态：沈砚独自在雨夜城门，尚未确认脚印去向\n1. 城门外发现带泥脚印\n2. 沿着脚印追到临江酒馆\n伏笔：埋设｜半枚脚印带有酒馆后巷的红泥\n退出状态：沈砚停在酒馆门外，尚未进入调查\n允许扩写：雨夜环境；追踪动作；不改变事实的心理活动\n禁止：提前揭示幕后主使', 'utf8')
const recoveryManifestId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const recoveryCompletedSource = '第一章 雨夜追迹\n沈砚在雨夜城门发现脚印。\n世界观：架空长安以现实生活秩序为底。\n力量体系：作品、舞台与公众信任构成成长路径。\n特殊优势：沈砚只能听见有限的异世录音。\n总纲：沈砚追查异世录音，在现实舞台上重建自己的声音，并确认选择比答案更重要。\n卷纲：第一卷从城门脚印追到旧录音棚，沈砚最终决定重返舞台。\n章纲：第一章从城门脚印追到旧录音棚并确认异世录音线索。'
const recoveryCompletedHash = createHash('sha256').update(recoveryCompletedSource).digest('hex')
const recoverySource = '外部参考只用于恢复入口烟测，不进入正文或模型上下文。'
const recoveryHash = createHash('sha256').update(recoverySource).digest('hex')
const recoveryRelativeSource = `.webnovel/imports/manifests/${recoveryManifestId}/sources/${recoveryHash}.txt`
await mkdir(resolve(smokeProject, '.webnovel', 'imports', 'manifests', recoveryManifestId, 'sources'), { recursive: true })
const recoveryCompletedRelativeSource = `.webnovel/imports/manifests/${recoveryManifestId}/sources/${recoveryCompletedHash}.txt`
await writeFile(resolve(smokeProject, recoveryCompletedRelativeSource), recoveryCompletedSource, 'utf8')
await writeFile(resolve(smokeProject, recoveryRelativeSource), recoverySource, 'utf8')
await writeFile(resolve(smokeProject, '.webnovel', 'imports', 'manifests', recoveryManifestId, 'manifest.json'), JSON.stringify({
  version: 1,
  id: recoveryManifestId,
  status: 'interrupted',
  createdAt: '2026-08-27T20:00:00.000Z',
  updatedAt: '2026-08-27T20:01:00.000Z',
  lastError: '烟测：第二份文件开始前中断。',
  files: [
    {
      token: '11111111-2222-4333-8444-555555555555', fileName: '已完成正文.txt', sha256: recoveryCompletedHash, stagedSource: recoveryCompletedRelativeSource,
      request: { token: '11111111-2222-4333-8444-555555555555', ownership: 'owned', creationMethod: 'human', title: '已完成正文', selectedChapterIndexes: [0] },
      status: 'completed', result: { ownership: 'owned', title: '已完成正文', importedChapterIds: [1] }
    },
    {
      token: '22222222-3333-4444-8555-666666666666', fileName: '待恢复外部参考.txt', sha256: recoveryHash, stagedSource: recoveryRelativeSource,
      request: { token: '22222222-3333-4444-8555-666666666666', ownership: 'external', title: '待恢复外部参考' }, status: 'pending'
    }
  ]
}, null, 2), 'utf8')
await writeFile(resolve(smokeUserData, 'settings.json'), JSON.stringify({
  recentProjects: storageOnlyMode || multiFileContinuationOnlyMode
    ? [smokeProject]
    : [damagedSourcesProject, damagedEventsProject, damagedOutlineProject, damagedCharacterProject, damagedChapterOrderProject, smokeProject],
  currentProject: multiFileContinuationOnlyMode ? null : smokeProject,
  projectApiKeys: {}
}), 'utf8')
const smokeTxt = resolve(smokeUserData, '旧稿示例.txt')
await writeFile(smokeTxt, '旧稿题记\n\n第一章 春灯\n长安灯市初见。\n\n第二章 雨巷\n故人隔雨重逢。\n\n第三章 归舟\n一叶归舟载月。\n\n第三章 重写片段\n这段需要作者核对。\n\n第五章 跳章札记\n这段不能默认进入正文。', 'utf8')
const smokeDocx = resolve(smokeUserData, 'Word旧稿示例.docx')
const smokeSupplement = resolve(smokeUserData, '接续设定补充.md')
const smokeDocxZip = new JSZip()
smokeDocxZip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
smokeDocxZip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
smokeDocxZip.folder('word').file('document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第一章 Word接续</w:t></w:r></w:p><w:p><w:r><w:t>这是一份等待作者确认的旧稿。</w:t></w:r></w:p></w:body></w:document>')
await writeFile(smokeDocx, await smokeDocxZip.generateAsync({ type: 'nodebuffer' }))
await writeFile(smokeSupplement, '# 旧稿接续设定\n\n主角沈砚保留雨夜城门的线索，不能提前揭晓录音来源。', 'utf8')

const launchOptions = {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    LANJIAN_SMOKE: '1',
    LANJIAN_CAPTURE_PATH: capturePath,
    LANJIAN_OPENING_CAPTURE_PATH: openingCapturePath,
    LANJIAN_SETTINGS_CAPTURE_PATH: settingsCapturePath,
    LANJIAN_SQLITE_SHADOW_CAPTURE_PATH: sqliteShadowCapturePath,
    LANJIAN_SQLITE_FORMAL_CAPTURE_PATH: sqliteFormalCapturePath,
    LANJIAN_CONFIGURATION_CAPTURE_PATH: configurationCapturePath,
    LANJIAN_AUTO_BACKUP_CAPTURE_PATH: autoBackupCapturePath,
    LANJIAN_READABLE_MIRROR_CAPTURE_PATH: readableMirrorCapturePath,
    LANJIAN_MANUSCRIPT_UNDO_REDO_CAPTURE_PATH: manuscriptUndoRedoCapturePath,
    LANJIAN_MANUSCRIPT_METRICS_CAPTURE_PATH: manuscriptMetricsCapturePath,
    LANJIAN_SELECTION_SKILLS_CAPTURE_PATH: selectionSkillsCapturePath,
    LANJIAN_BACKUP_RESTORE_CAPTURE_PATH: backupRestoreCapturePath,
    LANJIAN_SELECTION_DIFF_CAPTURE_PATH: selectionDiffCapturePath,
    LANJIAN_WRITING_TASK_RECOVERY_CAPTURE_PATH: writingTaskRecoveryCapturePath,
    LANJIAN_TASK_DISMISS_CAPTURE_PATH: writingTaskDismissCapturePath,
    LANJIAN_SMOKE_BACKUP_TARGET: smokeBackupTarget,
    LANJIAN_SMOKE_RESTORE_TARGET: smokeRestoreTarget,
    LANJIAN_APPEARANCE_CAPTURE_PATH: appearanceCapturePath,
    LANJIAN_ABOUT_CAPTURE_PATH: aboutCapturePath,
    LANJIAN_ACTION_SYSTEM_CAPTURE_PATH: actionSystemCapturePath,
    LANJIAN_RESEARCH_CAPTURE_PATH: researchCapturePath,
    LANJIAN_TIMELINE_CAPTURE_PATH: timelineCapturePath,
    LANJIAN_CHARACTER_LINES_CAPTURE_PATH: characterLinesCapturePath,
    LANJIAN_VOLUME_LINES_CAPTURE_PATH: volumeLinesCapturePath,
    LANJIAN_RESOURCE_LEDGER_CAPTURE_PATH: resourceLedgerCapturePath,
    LANJIAN_FORESHADOW_LEDGER_CAPTURE_PATH: foreshadowLedgerCapturePath,
    LANJIAN_OUTLINE_CAPTURE_PATH: outlineCapturePath,
    LANJIAN_STAGE_OUTLINE_CAPTURE_PATH: stageOutlineCapturePath,
    LANJIAN_MANUSCRIPT_EXPORT_CAPTURE_PATH: manuscriptExportCapturePath,
    LANJIAN_OFFLINE_MANUAL_CAPTURE_PATH: offlineManualCapturePath,
    LANJIAN_OFFLINE_FAILURE_CAPTURE_PATH: offlineFailureCapturePath,
    LANJIAN_DERIVATIVE_STALE_CAPTURE_PATH: derivativeStaleCapturePath,
    LANJIAN_COMPACT_IMPORT_RECOVERY_CAPTURE_PATH: compactImportRecoveryCapturePath,
    LANJIAN_FOUNDATION_SQLITE_CAPTURE_PATH: foundationSqliteCapturePath,
    LANJIAN_IDEA_PROMOTION_CAPTURE_PATH: ideaPromotionCapturePath,
    LANJIAN_SMOKE_MANUSCRIPT_EXPORT_PATH: smokeManuscriptExportTarget,
    LANJIAN_TOTAL_OUTLINE_EDITOR_CAPTURE_PATH: totalOutlineEditorCapturePath,
    LANJIAN_VOLUME_CAPTURE_PATH: volumeCapturePath,
    LANJIAN_IMPORT_CAPTURE_PATH: importCapturePath,
    LANJIAN_EXTERNAL_IMPORT_CAPTURE_PATH: externalImportCapturePath,
    LANJIAN_PROPOSAL_CAPTURE_PATH: proposalCapturePath,
    LANJIAN_CANCELLATION_CAPTURE_PATH: cancellationCapturePath,
    LANJIAN_REVISION_CAPTURE_PATH: revisionCapturePath,
    LANJIAN_DELETE_CAPTURE_PATH: deleteCapturePath,
    LANJIAN_MANUSCRIPT_LAYOUT_CAPTURE_PATH: manuscriptLayoutCapturePath,
    LANJIAN_MANUSCRIPT_EDITOR_CAPTURE_PATH: manuscriptEditorCapturePath,
    LANJIAN_PROFILE_CAPTURE_PATH: profileCapturePath,
    LANJIAN_CONTINUATION_CAPTURE_PATH: continuationCapturePath,
    LANJIAN_CONTINUATION_ADOPTION_CAPTURE_PATH: continuationAdoptionCapturePath,
    LANJIAN_CONTINUATION_PLOT_CAPTURE_PATH: continuationPlotCapturePath,
    LANJIAN_CONTINUATION_CHARACTER_CAPTURE_PATH: continuationCharacterCapturePath,
    LANJIAN_CONTINUATION_WORLD_VIEW_CAPTURE_PATH: continuationWorldViewCapturePath,
    LANJIAN_CONTINUATION_POWER_SYSTEM_CAPTURE_PATH: continuationPowerSystemCapturePath,
    LANJIAN_CONTINUATION_CHEAT_SYSTEM_CAPTURE_PATH: continuationCheatSystemCapturePath,
    LANJIAN_CONTINUATION_TOTAL_OUTLINE_CAPTURE_PATH: continuationTotalOutlineCapturePath,
    LANJIAN_CONTINUATION_TOTAL_OUTLINE_REVIEW_CAPTURE_PATH: continuationTotalOutlineReviewCapturePath,
    LANJIAN_PLANNING_CAPTURE_PATH: planningCapturePath,
    LANJIAN_CHAPTER_SKELETON_CAPTURE_PATH: chapterSkeletonCapturePath,
    LANJIAN_CHAPTER_DETAIL_CAPTURE_PATH: chapterDetailCapturePath,
    LANJIAN_CHAPTER_DETAIL_ADOPTION_CAPTURE_PATH: chapterDetailAdoptionCapturePath,
    LANJIAN_CONSISTENCY_CAPTURE_PATH: consistencyCapturePath,
    LANJIAN_CHARACTER_STATE_CAPTURE_PATH: characterStateCapturePath,
    LANJIAN_CHARACTER_CONFLICT_CAPTURE_PATH: characterConflictCapturePath,
    LANJIAN_CONTEXT_FACT_PACK_CAPTURE_PATH: contextFactPackCapturePath,
    LANJIAN_MATERIAL_CONTEXT_CAPTURE_PATH: materialContextCapturePath,
    LANJIAN_MULTI_API_CAPTURE_PATH: multiApiCapturePath,
    LANJIAN_MIXED_DIFF_CAPTURE_PATH: mixedDiffCapturePath,
    LANJIAN_CONTEXT_PREFLIGHT_CAPTURE_PATH: contextPreflightCapturePath,
    LANJIAN_FACT_REVIEW_CAPTURE_PATH: factReviewCapturePath,
    LANJIAN_CONSISTENCY_EVALUATION_CAPTURE_PATH: consistencyEvaluationCapturePath,
    LANJIAN_REAL_TRIAL_CAPTURE_PATH: realTrialCapturePath,
    LANJIAN_SMOKE_AUTOSAVE_TEXT: autosaveText,
    LANJIAN_SMOKE_CHAPTER_SAVE_FAILURE_TEXT: saveFailureText,
    LANJIAN_SMOKE_CHAPTER_SAVE_FAILURES: '2',
    LANJIAN_SMOKE_EXTERNAL_CONFLICT_TEXT: externalConflictText,
    LANJIAN_MANUSCRIPT_CONFLICT_CAPTURE_PATH: manuscriptConflictCapturePath,
    LANJIAN_SMOKE_PROJECT_PATH: smokeProject,
    LANJIAN_SMOKE_CLOSE_FLUSH_TEXT: closeFlushText,
    LANJIAN_SMOKE_TXT_PATH: smokeTxt,
    LANJIAN_SMOKE_DOCUMENT_PATHS: JSON.stringify([smokeDocx, smokeTxt]),
    LANJIAN_SMOKE_APPEND_DOCUMENT_PATHS: JSON.stringify([smokeSupplement]),
    LANJIAN_USER_DATA_PATH: smokeUserData,
    LANJIAN_SMOKE_TRASH_DIR: smokeTrash,
    LANJIAN_SMOKE_REVEAL_LOG: smokeRevealLog,
    LANJIAN_SMOKE_CREATE_PARENT: smokeUserData,
    LANJIAN_SMOKE_MODEL_URL: modelProbeUrl,
    LANJIAN_SMOKE_GPT_URL: `${modelProbeUrl}/gpt/v1`,
    LANJIAN_SMOKE_GEMINI_URL: `${modelProbeUrl}/gemini/v1`
  },
  stdio: 'inherit'
}
// Software paint keeps isolated screenshots reliable on occluded Windows desktops.
const child = spawn(electron, process.env.LANJIAN_SMOKE_FIELD_WORKSPACE_ONLY === '1' ? ['--disable-gpu', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '.'] : ['.'], launchOptions)

const timeout = setTimeout(() => {
  console.error('[desktop smoke] full click workflow exceeded 420 seconds')
  child.kill()
  process.exitCode = 1
}, 420_000)

child.once('exit', async (code) => {
  clearTimeout(timeout)
  let result = code ?? 1
  if (result === 74 && process.env.LANJIAN_SMOKE_NATIVE_PAUSE_COLD === '1') {
    console.info('[desktop smoke] paused process exited: ' + child.pid)
    result = await new Promise(resolve => {
      const restarted = spawn(electron, ['.'], { ...launchOptions, env: { ...launchOptions.env, LANJIAN_SMOKE_NATIVE_PAUSE_COLD_PHASE: 'verify' } })
      console.info('[desktop smoke] pause recovery process started: ' + restarted.pid)
      const coldTimeout = setTimeout(() => { restarted.kill(); resolve(1) }, 90_000)
      restarted.once('error', () => { clearTimeout(coldTimeout); resolve(1) })
      restarted.once('exit', exitCode => { clearTimeout(coldTimeout); resolve(exitCode ?? 1) })
    })
  }
  if (result === 73 && process.env.LANJIAN_SMOKE_PLANNED_COLD === '1') {
    console.info('[desktop smoke] first process exited: ' + child.pid)
    result = await new Promise(resolve => {
      const restarted = spawn(electron, ['.'], { ...launchOptions, env: { ...launchOptions.env, LANJIAN_SMOKE_PLANNED_COLD_PHASE: 'verify' } })
      console.info('[desktop smoke] cold process started: ' + restarted.pid)
      const coldTimeout = setTimeout(() => { restarted.kill(); resolve(1) }, 60_000)
      restarted.once('error', () => { clearTimeout(coldTimeout); resolve(1) })
      restarted.once('exit', exitCode => { clearTimeout(coldTimeout); resolve(exitCode ?? 1) })
    })
  }
  await new Promise((resolve) => modelProbeServer.close(resolve))
  if (result === 0 && process.env.LANJIAN_SMOKE_QUESTION_ONLY === '1') {
    console.info('[desktop smoke] question provider delivery: ' + JSON.stringify({ calls: questionCalls, contextVerified: questionContextVerified }))
    if (questionCalls !== 1 || !questionContextVerified) result = 1
  }
  if (result === 0 && process.env.LANJIAN_SMOKE_CORE_WRITING_ONLY === '1') {
    const mirror = await readFile(resolve(smokeProject, '正文', '第1章-雨夜追迹.md'), 'utf8')
    const mirrorMatches = mirror === '　　沈砚把铜铃放入衣袋。\n\n　　沈砚站在石桥边，等待桥下回应。'
    console.info('[desktop smoke] core writing Markdown mirror: ' + mirrorMatches)
    if (!mirrorMatches) result = 1
    console.info('[desktop smoke] core facts extracted once and next model context verified: ' + JSON.stringify({ extractionCalls: coreFactExtractionCalls, contextVerified: coreNextContextVerified }))
    if (coreFactExtractionCalls !== 1 || !coreNextContextVerified) result = 1
    const nextMirror = await readFile(resolve(smokeProject, '正文', '第3章-未命名.md'), 'utf8').catch(() => '')
    const proseMirrorMatches = nextMirror === '　　沈砚摸到衣袋里的铜铃，顺着桥下回声望向晨雾中的渡口。'
    console.info('[desktop smoke] core next prose and mirror: ' + JSON.stringify({ proseCalls: coreProseCalls, contextVerified: coreProseContextVerified, mirrorMatches: proseMirrorMatches }))
    if (coreProseCalls !== 1 || !coreProseContextVerified || !proseMirrorMatches) result = 1
  }
  if (result === 0 && process.env.LANJIAN_SMOKE_ACTIVE_STREAM_EDIT_ONLY === '1') {
    console.info('[desktop smoke] active stream edit provider calls: ' + activeStreamEditCalls)
    if (activeStreamEditCalls !== 1) result = 1
  }
  if (result === 0 && process.env.LANJIAN_SMOKE_CONTEXT_PREFLIGHT === '1') {
    if (!contextPreflightInstruction.includes('烟测临时依据：窗外正在下雨。') || contextPreflightInstruction.includes('第一日雨夜')) {
      console.error('[desktop smoke] final model request did not preserve the context preflight selection')
      result = 1
    }
  }
  if (result === 0
    && !bootVisibilityOnlyMode
    && process.env.LANJIAN_SMOKE_STORAGE_ONLY !== '1'
    && process.env.LANJIAN_SMOKE_MULTI_FILE_CONTINUATION !== '1'
    && process.env.LANJIAN_SMOKE_WORKSPACE_DESIGN_ONLY !== '1') {
    const persisted = await readFile(resolve(smokeProject, '正文', '第1章-雨夜追迹.md'), 'utf8').catch(() => '')
    if (persisted !== `　　${closeFlushText}`) {
      console.error('[desktop smoke] close handshake did not flush the final manuscript text')
      result = 1
    }
    const trashed = await readFile(resolve(smokeTrash, '第2章-待删旧章.md'), 'utf8').catch(() => '')
    if (trashed !== '此章应进入模拟回收站。') {
      console.error('[desktop smoke] chapter was not moved into the isolated trash directory')
      result = 1
    }
    const sourceLedgerText = await readFile(resolve(smokeProject, '.webnovel', 'research', 'sources.json'), 'utf8').catch(() => '')
    try {
      const sourceLedger = JSON.parse(sourceLedgerText)
      const origins = new Set(sourceLedger.sources?.map((source) => source.sourceType))
      if (!origins.has('manual') || !origins.has('web') || !sourceLedger.sources.some((source) => source.references?.[0]?.url === 'https://example.com/stage-research')) {
        console.error('[desktop smoke] unified material ledger did not preserve both manual and web provenance')
        result = 1
      }
    } catch {
      console.error('[desktop smoke] unified material ledger was missing or invalid')
      result = 1
    }
    const damagedSourceLedgerAfter = await readFile(resolve(damagedSourcesProject, '.webnovel', 'research', 'sources.json'), 'utf8').catch(() => '')
    if (damagedSourceLedgerAfter !== damagedSourcesContent) {
      console.error('[desktop smoke] damaged source ledger was changed during locked material interactions')
      result = 1
    }
    const damagedEventLedgerAfter = await readFile(resolve(damagedEventsProject, '.webnovel', 'research', 'events.json'), 'utf8').catch(() => '')
    if (damagedEventLedgerAfter !== damagedEventsContent) {
      console.error('[desktop smoke] damaged formal event ledger was changed during locked event interactions')
      result = 1
    }
    const damagedOutlineLedgerAfter = await readFile(resolve(damagedOutlineProject, '.webnovel', 'planning', 'outline-state.json'), 'utf8').catch(() => '')
    if (damagedOutlineLedgerAfter !== damagedOutlineContent) {
      console.error('[desktop smoke] damaged outline version ledger was changed during locked planning interactions')
      result = 1
    }
    const editableManuscriptAfter = await readFile(resolve(damagedOutlineProject, '正文', '第1章-账本损坏仍可手写.md'), 'utf8').catch(() => '')
    if (editableManuscriptAfter !== '　　损坏谋篇账本期间，正文点击保存仍然有效。') {
      console.error('[desktop smoke] manuscript did not remain editable while the outline ledger was locked')
      result = 1
    }
    const damagedCharacterLedgerAfter = await readFile(resolve(damagedCharacterProject, '.webnovel', 'story-state', 'characters.json'), 'utf8').catch(() => '')
    if (damagedCharacterLedgerAfter !== damagedCharacterContent) {
      console.error('[desktop smoke] damaged character state ledger was changed during locked character interactions')
      result = 1
    }
    const characterManuscriptAfter = await readFile(resolve(damagedCharacterProject, '正文', '第1章-人物账本损坏仍可手写.md'), 'utf8').catch(() => '')
    if (characterManuscriptAfter !== '　　损坏人物账本期间，正文点击保存仍然有效。') {
      console.error('[desktop smoke] manuscript did not remain editable while the character ledger was locked')
      result = 1
    }
    const damagedChapterOrderAfter = await readFile(resolve(damagedChapterOrderProject, '.webnovel', 'manuscript', 'chapter-order.json'), 'utf8').catch(() => '')
    if (damagedChapterOrderAfter !== damagedChapterOrderContent) {
      console.error('[desktop smoke] damaged chapter order ledger was changed during read-only manuscript checks')
      result = 1
    }
    const unsequencedManuscriptsAfter = await Promise.all([
      readFile(resolve(damagedChapterOrderProject, '正文', '第7章-独立正文甲.md'), 'utf8').catch(() => ''),
      readFile(resolve(damagedChapterOrderProject, '正文', '第12章-独立正文乙.md'), 'utf8').catch(() => '')
    ])
    if (unsequencedManuscriptsAfter[0] !== '第一份独立正文必须可读。' || unsequencedManuscriptsAfter[1] !== '第二份独立正文必须可读。') {
      console.error('[desktop smoke] manuscript files changed while chapter order was locked')
      result = 1
    }
    const revealedPath = await readFile(smokeRevealLog, 'utf8').catch(() => '')
    const expectedRevealedPath = resolve(await realpath(damagedChapterOrderProject), '.webnovel', 'manuscript', 'chapter-order.json')
    if (revealedPath.toLocaleLowerCase() !== expectedRevealedPath.toLocaleLowerCase()) {
      console.error('[desktop smoke] safe reveal did not resolve the fixed current-book chapter order path')
      result = 1
    }
    const planningRecoveryDirectory = resolve(smokeProject, '.webnovel', 'planning', 'recovery')
    const planningRecoveryFiles = await readdir(planningRecoveryDirectory).catch(() => [])
    const preservedPlanningCandidates = await Promise.all(planningRecoveryFiles.map((file) => readFile(resolve(planningRecoveryDirectory, file), 'utf8').catch(() => '')))
    if (!preservedPlanningCandidates.includes(damagedPlanningContent)) {
      console.error('[desktop smoke] damaged planning candidate was not preserved byte-for-byte in recovery')
      result = 1
    }
    const promptRecoveryDirectory = resolve(smokeProject, '.webnovel', 'config', 'recovery')
    const promptRecoveryFiles = await readdir(promptRecoveryDirectory).catch(() => [])
    const preservedPromptProfiles = await Promise.all(promptRecoveryFiles.map((file) => readFile(resolve(promptRecoveryDirectory, file), 'utf8').catch(() => '')))
    if (!preservedPromptProfiles.includes(damagedPromptProfileContent)) {
      console.error('[desktop smoke] damaged prompt profile was not preserved byte-for-byte in recovery')
      result = 1
    }
    const trashedCreatedProject = resolve(smokeTrash, '点击链路新书')
    const createdState = await readFile(resolve(trashedCreatedProject, '.webnovel', 'state.json'), 'utf8').catch(() => '')
    if (!createdState.includes('点击链路新书')) {
      console.error('[desktop smoke] created work item did not reach the isolated system trash')
      result = 1
    }
    const createdProfile = await readFile(resolve(trashedCreatedProject, '.webnovel', 'config', 'book-profile.json'), 'utf8').catch(() => '')
    if (!createdProfile.includes('点击链路新书') || !createdProfile.includes('plannedVolumes')) {
      console.error('[desktop smoke] trashed work item did not preserve its independent book definition')
      result = 1
    }
    if (await readFile(resolve(smokeCreatedProject, '.webnovel', 'state.json'), 'utf8').catch(() => '')) {
      console.error('[desktop smoke] trashed work item still exists at its original location')
      result = 1
    }
    const migratedStateText = await readFile(resolve(smokeProject, '.webnovel', 'state.json'), 'utf8').catch(() => '')
    try {
      const migratedState = JSON.parse(migratedStateText)
      if (migratedState.schemaVersion !== 2 || migratedState.migrationHistory?.length !== 1) {
        console.error('[desktop smoke] project migration state was not persisted exactly once')
        result = 1
      }
      const backupRelativePath = migratedState.migrationHistory?.[0]?.backupRelativePath
      const backup = backupRelativePath ? await readFile(resolve(smokeProject, backupRelativePath), 'utf8').catch(() => '') : ''
      if (!backup.includes('"version":1')) {
        console.error('[desktop smoke] project migration did not preserve the original manifest')
        result = 1
      }
    } catch {
      console.error('[desktop smoke] migrated project manifest was missing or invalid')
      result = 1
    }
    const shadowDatabase = await readFile(resolve(smokeProject, '.webnovel', 'workspace.sqlite')).catch(() => Buffer.alloc(0))
    if (!shadowDatabase.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) {
      console.error('[desktop smoke] SQLite shadow database was not created by the reviewed click flow')
      result = 1
    }
    const resourceLedgerText = await readFile(resolve(smokeProject, '.webnovel', 'story-state', 'resource-ledger.json'), 'utf8').catch(() => '')
    try {
      const resourceLedger = JSON.parse(resourceLedgerText)
      const smokeBalance = resourceLedger.balances?.find((item) => item.resourceName === '烟测灵石')
      if (resourceLedger.authority !== 'sqlite-resource-ledger' || smokeBalance?.quantity !== 3 || resourceLedger.entries?.length !== 2) {
        console.error('[desktop smoke] formal resource ledger mirror did not preserve the derived balance')
        result = 1
      }
    } catch {
      console.error('[desktop smoke] formal resource ledger mirror was missing or invalid')
      result = 1
    }
  }
  process.exitCode = result
})
