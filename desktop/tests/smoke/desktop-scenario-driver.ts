import { runRealCaseWritingScenario } from './scenarios/real-case-writing'
import { runContinuationManifestSceneScenario } from './scenarios/continuation-manifest-scene'
import { runIdeaSceneScenario } from './scenarios/idea-scene'
import { runNamedVersionScenario } from './scenarios/named-version'
import { runFocusedChapterCardSceneScenario } from './scenarios/focused-chapter-card-scene'
import { runAutomaticBackupSceneScenario } from './scenarios/automatic-backup-scene'
import { runContextPreflightSceneScenario } from './scenarios/context-preflight-scene'
import { runCreateUiPassedScenario } from './scenarios/create-ui-passed'
import { runFactReviewSceneScenario } from './scenarios/fact-review-scene'
import { runResourceLedgerSceneScenario } from './scenarios/resource-ledger-scene'
import { runPromptWorkshopPassedScenario } from './scenarios/prompt-workshop-passed'
import { runPlanningPassedScenario } from './scenarios/planning-passed'
import { runResearchLedgerPassedScenario } from './scenarios/research-ledger-passed'
import { runOutlineGatePassedScenario } from './scenarios/outline-gate-passed'
import { runAgentValidScenario } from './scenarios/agent-valid'
import { runSelectionDiffReadyScenario } from './scenarios/selection-diff-ready'
import { runWritingTaskRecoveryScenario } from './scenarios/writing-task-recovery'
import { runFactPackVerifiedScenario } from './scenarios/fact-pack-verified'
import type { DesktopRuntime } from '../../src/main/bootstrap/create-desktop-runtime'
import { WritingAgentTaskService } from '../../src/main/modules/assistant/application/writing-agent-task-service'
import { createDesktopScenarioSeeds } from './create-desktop-scenario-seeds'
import { app } from 'electron'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { SqliteManuscriptService } from '../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { AppError } from '../../src/main/core/errors/app-error'
import { SqliteWorkspaceDatabaseFactory } from '../../src/main/platform/storage/workspace-database'
import { projectDirectory } from '../../src/main/platform/storage/project-path'
import type { BrowserWindow } from 'electron'
import type { ChapterDerivativeStatus } from '../../src/contracts/index'
import type { CharacterAtlasSmokeSeeder } from './character-atlas-smoke'
import type { WorldMapSmokeSeeder } from './world-map-smoke'

export function runDesktopScenarios(window: BrowserWindow, runtime: DesktopRuntime): void {
  const { projects, documents, characterStates, sqliteManuscripts, workspace, researchLibrary, outlinePlanning, databases, writingAgent, workspaceWrites } = runtime.scenarioServices
  let nativeTaskPauseSmoke: ((window: BrowserWindow, capturePath: string) => Promise<{ ok: boolean; exitForColdRestart?: boolean }>) | undefined
  const { smokeSeedFactReview, smokeSeedCharacterAtlas, smokeSeedWorldMap, smokeSeedContextState, smokeSeedDerivativeStale } = createDesktopScenarioSeeds(runtime.scenarioServices)
  if (process.env.LANJIAN_SMOKE === '1' && process.env.LANJIAN_SMOKE_NATIVE_TASK_PAUSE_ONLY === '1') {
    nativeTaskPauseSmoke = async (window, capturePath) => {
      const { runNativeTaskPauseSmoke } = await import('./native-task-pause-smoke')
      const workItemPath = await projects.currentPath()
      return runNativeTaskPauseSmoke(window, capturePath, {
        workItemPath,
        readTask: async (id) => {
          const database = await databases.openExisting(workItemPath)
          try { return database?.taskRun(id) } finally { database?.close() }
        },
        restorePaused: (id) => new WritingAgentTaskService(writingAgent, projects, databases, undefined, undefined, undefined, workspaceWrites).status(id)
      })
    }
  }
      let smokeDriverStage = 'bootstrap'
      void (async () => {
      const bridgeReady = await window.webContents.executeJavaScript('Boolean(window.novelDesktop)')
      console.info(`[desktop] preload bridge ${bridgeReady ? 'ready' : 'missing'}`)
      if (process.env.LANJIAN_SMOKE_BOOT_VISIBILITY_ONLY === '1') {
        if (!bridgeReady) return app.exit(1)
        window.webContents.setBackgroundThrottling(false)
        const result = await window.webContents.executeJavaScript(`(async()=>{
          const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
          for(let i=0;i<100&&!document.querySelector('[data-testid="app-boot"]');i++)await wait(50);
          const root=document.querySelector('[data-testid="app-boot"]');
          if(!root)return {ok:false,step:'boot-missing'};
          for(let i=0;i<100&&(!root.classList.contains('motion-ready')||document.visibilityState!=='visible');i++)await wait(50);
          const slash=root.querySelector('.impact-slash'),animation=slash?.getAnimations()[0];
          const start=Number(animation?.currentTime||0);
          const noBypass=!root.querySelector('[data-testid="app-boot-skip"]')&&!document.body.textContent.includes('隐藏启动画面');
          await wait(180);
          const progressed=Number(animation?.currentTime||0)>start;
          const motionObserved=start>0||progressed;
          for(let i=0;i<160&&document.querySelector('[data-testid="app-boot"]');i++)await wait(50);
          return {ok:noBypass&&motionObserved&&!document.querySelector('[data-testid="app-boot"]'),step:'boot-completed-after-window-show',start,after:Number(animation?.currentTime||0),noBypass,progressed,motionObserved};
        })()`)
        console.info(`[desktop smoke] boot visibility: ${JSON.stringify(result)}`)
        return app.exit(result.ok ? 0 : 1)
      }
      if (process.env.LANJIAN_REAL_CASE_RUN === '1') {
        if (!bridgeReady) return app.exit(1)
        const result = await runRealCaseWritingScenario({ window })
        const candidate = result?.task?.candidate || ''
        if (candidate && process.env.LANJIAN_REAL_CASE_CANDIDATE_PATH) {
          await mkdir(dirname(process.env.LANJIAN_REAL_CASE_CANDIDATE_PATH), { recursive: true })
          await writeFile(process.env.LANJIAN_REAL_CASE_CANDIDATE_PATH, candidate, 'utf8')
        }
        if (process.env.LANJIAN_REAL_CASE_REPORT_PATH) {
          const report = structuredClone(result)
          if (report?.task) delete report.task.candidate
          await mkdir(dirname(process.env.LANJIAN_REAL_CASE_REPORT_PATH), { recursive: true })
          await writeFile(process.env.LANJIAN_REAL_CASE_REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
        }
        console.info(`[real case] ${result.ok ? 'passed' : 'failed'}: ${JSON.stringify({ ...result, task: result.task ? { ...result.task, candidate: undefined } : undefined })}`)
        return app.exit(result.ok ? 0 : 1)
      }
      if (process.env.LANJIAN_SMOKE === '1') {
        await new Promise((resolve) => setTimeout(resolve, 1600))
        const openingCapturePath = process.env.LANJIAN_OPENING_CAPTURE_PATH
        if (openingCapturePath) await writeFile(openingCapturePath, (await window.capturePage()).toPNG())
        await window.webContents.executeJavaScript("document.querySelector('.opening-screen > button')?.click()")
        await new Promise((resolve) => setTimeout(resolve, 650))
        const capturePath = process.env.LANJIAN_CAPTURE_PATH
        if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
        if (process.env.LANJIAN_SMOKE_PLANNED_COLD_PHASE === 'verify') {
          const coldRecovery = await window.webContents.executeJavaScript(`(async () => {
            let opened = false
            for (let n = 0; n < 100; n++) {
              if (document.querySelector('[aria-label="谋篇"]')) break
              const book = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
              if (book && !opened) { opened = true; book.click() }
              await new Promise(resolve => setTimeout(resolve, 100))
            }
            document.querySelector('[aria-label="谋篇"]')?.click()
            for (let n = 0; n < 80 && !document.querySelector('[data-testid="open-planned-chapter-999"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
            document.querySelector('[data-testid="open-planned-chapter-999"]')?.click()
            for (let n = 0; n < 80 && !document.querySelector('[data-testid="planned-outline-recovery"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
            const panel = document.querySelector('[data-testid="planned-outline-recovery"]')
            const before = await window.novelDesktop.outlines.getPlannedChapter(999)
            if (!panel?.textContent.includes('完整进程冷启动恢复。') || before.content.includes('完整进程冷启动恢复。')) return false
            const confirm = window.confirm
            try {
              window.confirm = () => false
              document.querySelector('[data-testid="discard-planned-recovery"]')?.click()
              await new Promise(resolve => setTimeout(resolve, 100))
              if (!document.querySelector('[data-testid="planned-outline-recovery"]')) return false
              window.confirm = () => true
              document.querySelector('[data-testid="discard-planned-recovery"]')?.click()
              for (let n = 0; n < 80 && document.querySelector('[data-testid="planned-outline-recovery"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
              const after = await window.novelDesktop.outlines.getPlannedChapter(999)
              const drafts = JSON.parse(localStorage.getItem('lanjian.planned-outline-recovery.v1') || '{}').drafts || []
              return after.revision === before.revision && after.content === before.content
                && !drafts.some(draft => draft.chapterId === 999) && Boolean(document.querySelector('[aria-label="独立章纲正文"]'))
            } finally { window.confirm = confirm }
          })()`)
          console.info('[desktop smoke] planned outline cold-start and explicit discard: ' + coldRecovery)
          return app.exit(coldRecovery ? 0 : 1)
        }
        if (process.env.LANJIAN_SMOKE_MULTI_FILE_CONTINUATION === '1') {
          if (!bridgeReady) return app.exit(1)
          const continuationManifestScene = await runContinuationManifestSceneScenario({ window })
          if (!continuationManifestScene.ok) {
            console.error(`[desktop smoke] multi-file continuation scene failed: ${JSON.stringify(continuationManifestScene)}`)
            return app.exit(1)
          }
          console.info(`[desktop smoke] multi-file continuation scene passed: ${JSON.stringify(continuationManifestScene)}`)
          return app.exit(0)
        }
        if (process.env.LANJIAN_SMOKE_STORAGE_ONLY === '1') {
          if (!bridgeReady) return app.exit(1)
          let focusedProjectOpen: { ok: boolean; step: string; projectStatus?: unknown }
          try {
            focusedProjectOpen = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const workItem = Array.from(document.querySelectorAll('.work-item-open')).find((button) => button.getAttribute('aria-label')?.includes('烟测书稿'))
              if (!workItem) return { ok: false, step: 'project-entry-missing' }
              workItem.click()
              for (let index = 0; index < 60; index += 1) {
                const status = await window.novelDesktop.projects.status().catch(() => null)
                if (status?.project?.title === '烟测书稿' && document.querySelector('.activitybar')) return { ok: true, step: 'project-open', projectStatus: status }
                await wait(100)
              }
              return { ok: false, step: 'project-open-timeout', projectStatus: await window.novelDesktop.projects.status().catch(() => null) }
            })()`)
          } catch (error) {
            console.error(`[desktop smoke] focused project open script failed: ${error instanceof Error ? error.stack || error.message : String(error)}`)
            return app.exit(1)
          }
          if (!focusedProjectOpen.ok) {
            console.error(`[desktop smoke] focused project open failed: ${JSON.stringify(focusedProjectOpen)}`)
            return app.exit(1)
          }
          console.info('[desktop smoke] storage stage: project opened')
          if (process.env.LANJIAN_SMOKE_NATIVE_PAUSE_COLD === '1' && process.env.LANJIAN_SMOKE_NATIVE_PAUSE_COLD_PHASE === 'verify') {
            // Reopen the existing SQLite work item. Never replay fixture migration/seeding.
            if (!nativeTaskPauseSmoke || !capturePath) return app.exit(1)
            const result = await nativeTaskPauseSmoke(window, capturePath)
            console.info('[desktop smoke] native task cold recovery: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          let focusedStoragePrepared: { ok: boolean; step: string; [key: string]: unknown }
          try {
            focusedStoragePrepared = await window.webContents.executeJavaScript(`(async () => {
              let currentStep = 'project-status'
              try {
                const projectStatus = await window.novelDesktop.projects.status()
                if (projectStatus?.project?.title !== '烟测书稿') return { ok: false, step: 'project-open', projectStatus }
                currentStep = 'project-migration-preview'
                const migration = await window.novelDesktop.projects.migrationPreview()
                if (migration.required) {
                  if (!migration.canMigrate) return { ok: false, step: 'project-migration-blocked', migration }
                  currentStep = 'project-migration'
                  await window.novelDesktop.projects.migrate()
                }
                currentStep = 'shadow-preview'
                const shadowPreview = await window.novelDesktop.projects.previewSqliteShadowMigration()
                if (!shadowPreview.canImport || !shadowPreview.token) return { ok: false, step: 'shadow-preview', shadowPreview }
                currentStep = 'shadow-import'
                const shadowImport = await window.novelDesktop.projects.importSqliteShadowMigration(shadowPreview.token)
                if (!shadowImport.verified || shadowImport.storageMode !== 'shadow') return { ok: false, step: 'shadow-import', shadowImport }
                currentStep = 'activation-preview'
                const activationPreview = await window.novelDesktop.projects.previewSqliteActivation()
                if (!activationPreview.canActivate || !activationPreview.token) return { ok: false, step: 'activation-preview', activationPreview }
                currentStep = 'activation-commit'
                const activation = await window.novelDesktop.projects.activateSqliteStorage(activationPreview.token)
                return { ok: activation.verified && activation.storageMode === 'sqlite', step: 'storage-prepared', activation }
              } catch (error) {
                return { ok: false, step: currentStep, error: error?.message || JSON.stringify(error), code: error?.code || '', details: error?.details || null, stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
          } catch (error) {
            console.error(`[desktop smoke] focused SQLite preparation script failed: ${error instanceof Error ? error.stack || error.message : String(error)}`)
            return app.exit(1)
          }
          if (!focusedStoragePrepared.ok) {
            console.error(`[desktop smoke] focused SQLite preparation failed: ${JSON.stringify(focusedStoragePrepared)}`)
            return app.exit(1)
          }
          console.info('[desktop smoke] storage stage: SQLite prepared')
          if (process.env.LANJIAN_SMOKE_DESKTOP_PET_ONLY === '1' && capturePath) {
            const { runDesktopPetWindowSmoke } = await import('./desktop-pet-window-smoke')
            const result = await runDesktopPetWindowSmoke(window, capturePath)
            console.info('[desktop smoke] desktop pet: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_OUTLINE_STORAGE_FEEDBACK_ONLY === '1' && capturePath) {
            const { runOutlineStorageFeedbackSmoke } = await import('./outline-storage-feedback-smoke')
            const result = await runOutlineStorageFeedbackSmoke(window, capturePath)
            console.info('[desktop smoke] outline storage feedback: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_QUICK_CHAPTER_ONLY === '1' && capturePath) {
            const { runQuickChapterOpenSmoke } = await import('./quick-chapter-open-smoke')
            const result = await runQuickChapterOpenSmoke(window, capturePath)
            console.info('[desktop smoke] quick chapter open: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_WORLD_MAP_ONLY === '1' && capturePath) {
            const { runWorldMapSmoke } = await import('./world-map-smoke')
            if (!smokeSeedWorldMap) return app.exit(1)
            const result = await runWorldMapSmoke(window, capturePath, smokeSeedWorldMap)
            console.info('[desktop smoke] world map: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_CHARACTER_ATLAS_ONLY === '1' && capturePath) {
            const { runCharacterAtlasSmoke } = await import('./character-atlas-smoke')
            if (!smokeSeedCharacterAtlas) return app.exit(1)
            const result = await runCharacterAtlasSmoke(window, capturePath, smokeSeedCharacterAtlas)
            console.info('[desktop smoke] character atlas: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_APPROVED_REFERENCE_ONLY === '1' && capturePath) {
            const { runApprovedReferenceUiSmoke } = await import('./approved-reference-ui-smoke')
            const result = await runApprovedReferenceUiSmoke(window, capturePath)
            console.info('[desktop smoke] approved reference: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_NATIVE_TASK_PAUSE_ONLY === '1' && capturePath) {
            if (!nativeTaskPauseSmoke) return app.exit(1)
            const result = await nativeTaskPauseSmoke(window, capturePath)
            console.info('[desktop smoke] native task pause: ' + JSON.stringify(result))
            return app.exit(result.ok ? (result.exitForColdRestart ? 74 : 0) : 1)
          }
          if (process.env.LANJIAN_SMOKE_FINDING_RESOLUTION_ONLY === '1' && capturePath) {
            const { runFindingResolutionSmoke } = await import('./finding-resolution-smoke')
            const result = await runFindingResolutionSmoke(window, capturePath)
            console.info('[desktop smoke] finding resolution: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_NARRATIVE_ONLY === '1' && capturePath) {
            const { runNarrativeTerminalSmoke } = await import('./narrative-terminal-smoke')
            const result = await runNarrativeTerminalSmoke(window, capturePath)
            console.info('[desktop smoke] narrative terminal: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_WORKSPACE_DESIGN_ONLY === '1' && capturePath) {
            const { runWorkspaceDesignSmoke } = await import('./workspace-design-smoke')
            const result = await runWorkspaceDesignSmoke(window, capturePath)
              .catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
            console.info('[desktop smoke] workspace design: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_QUESTION_ONLY === '1') {
            const { runQuestionRetrievalSmoke } = await import('./question-retrieval-smoke')
            const result = await runQuestionRetrievalSmoke(window, process.env.LANJIAN_SMOKE_MODEL_URL || '')
              .catch((error: unknown) => ({ ok: false, step: 'question-driver-error', error: error instanceof Error ? error.message : String(error) }))
            console.info('[desktop smoke] question retrieval: ' + JSON.stringify(result))
            const questionScenario = process.env.LANJIAN_SMOKE_QUESTION_SCENARIO || 'positive'
            const questionCapture = questionScenario === 'positive' ? 'question-retrieval.png' : `question-retrieval-${questionScenario}.png`
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', questionCapture), (await window.capturePage()).toPNG())
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_EDITOR_PARITY_ONLY === '1') {
            if (!smokeSeedFactReview) return app.exit(1)
            await smokeSeedFactReview()
            const { runEditorParitySmoke } = await import('./editor-parity-smoke')
            const result = await runEditorParitySmoke(window, capturePath?.replace('single-workbench.png', 'editor-parity.png'))
              .catch((error: unknown) => ({ ok: false, step: 'editor-parity-driver-error', error: error instanceof Error ? error.message : String(error) }))
            console.info('[desktop smoke] editor parity: ' + JSON.stringify(result))
            if (!result.ok && capturePath) await writeFile(capturePath.replace('single-workbench.png', 'editor-parity-failure.png'), (await window.capturePage()).toPNG())
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_FACT_GUIDANCE_ONLY === '1') {
            if (!smokeSeedFactReview) return app.exit(1)
            await smokeSeedFactReview()
            const { runFactGuidanceSmoke } = await import('./fact-guidance-smoke')
            const result = await runFactGuidanceSmoke(window, capturePath?.replace('single-workbench.png', 'fact-review-guidance.png'))
              .catch((error: unknown) => ({ ok: false, step: 'fact-guidance-driver-error', error: error instanceof Error ? error.message : String(error) }))
            console.info('[desktop smoke] fact guidance: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_GUIDANCE_ONLY === '1') {
            if (!smokeSeedFactReview || !smokeSeedContextState) return app.exit(1)
            await smokeSeedFactReview()
            await smokeSeedContextState()
            const { runWorkflowGuidanceSmoke } = await import('./workflow-guidance-smoke')
            const result = await runWorkflowGuidanceSmoke(window, capturePath?.replace('single-workbench.png', 'workflow-conflict-guidance.png'))
              .catch(() => ({ ok: false, step: 'guidance-driver-error' }))
            console.info('[desktop smoke] workflow guidance: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_ACTIVE_RECOVERY_ONLY === '1') {
            const { runActiveManuscriptRecoverySmoke } = await import('./active-manuscript-recovery-smoke')
            const result = await runActiveManuscriptRecoverySmoke(window).catch((error: unknown) => ({
              ok: false,
              step: 'active-recovery-driver-error',
              error: error instanceof Error ? error.message : String(error)
            }))
            console.info('[desktop smoke] active manuscript recovery: ' + JSON.stringify(result))
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'active-manuscript-recovery.png'), (await window.capturePage()).toPNG())
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_CORE_WRITING_ONLY === '1') {
            const { runCoreWritingSmoke } = await import('./core-writing-smoke')
            const result = await runCoreWritingSmoke(window, process.env.LANJIAN_SMOKE_MODEL_URL || '').catch((error: unknown) => ({ ok: false, step: 'core-driver-error', error: error instanceof Error ? error.message : String(error) }))
            console.info('[desktop smoke] core writing chain: ' + JSON.stringify(result))
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'core-writing-chain.png'), (await window.capturePage()).toPNG())
            return app.exit((result as { ok: boolean }).ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_REAL_TRIAL_ONLY === '1') {
            const { runRealTrialSmoke } = await import('./real-trial-smoke')
            const result = await runRealTrialSmoke(window, process.env.LANJIAN_REAL_TRIAL_CAPTURE_PATH)
              .catch((error: unknown) => ({ ok: false, step: 'real-trial-driver-error', error: error instanceof Error ? error.message : String(error) }))
            console.info('[desktop smoke] real trial ledger: ' + JSON.stringify(result))
            return app.exit((result as { ok: boolean }).ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_ACTIVE_STREAM_EDIT_ONLY === '1') {
            const { runActiveStreamEditSmoke } = await import('./active-stream-edit-smoke')
            const result = await runActiveStreamEditSmoke(
              window,
              process.env.LANJIAN_SMOKE_MODEL_URL || '',
              process.env.LANJIAN_SMOKE_PROJECT_PATH || '',
              process.env.LANJIAN_MIXED_DIFF_CAPTURE_PATH
            ).catch((error: unknown) => ({
              ok: false, step: 'active-stream-edit-driver-error', error: error instanceof Error ? error.message : String(error)
            }))
            console.info('[desktop smoke] active stream edit: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_MIXED_DIFF_ONLY === '1') {
            const { runMixedDiffSmoke } = await import('./mixed-diff-smoke')
            const result = await runMixedDiffSmoke(
              window,
              process.env.LANJIAN_SMOKE_MODEL_URL || '',
              process.env.LANJIAN_SMOKE_PROJECT_PATH || '',
              process.env.LANJIAN_MIXED_DIFF_CAPTURE_PATH
            ).catch((error: unknown) => ({
              ok: false, step: 'mixed-diff-driver-error', error: error instanceof Error ? error.message : String(error)
            }))
            console.info('[desktop smoke] mixed diff: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_MATERIAL_CONTEXT_ONLY === '1') {
            const { runMaterialContextSmoke } = await import('./material-context-smoke')
            const materialCapturePath = process.env.LANJIAN_MATERIAL_CONTEXT_CAPTURE_PATH
            const result = await runMaterialContextSmoke(window, materialCapturePath).catch((error: unknown) => ({
              ok: false, step: 'material-context-driver-error', error: error instanceof Error ? error.message : String(error)
            }))
            console.info('[desktop smoke] material context: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_MULTI_API_ONLY === '1') {
            const { runMultiApiSettingsSmoke } = await import('./multi-api-settings-smoke')
            const result = await runMultiApiSettingsSmoke(
              window,
              process.env.LANJIAN_SMOKE_GPT_URL || '',
              process.env.LANJIAN_SMOKE_GEMINI_URL || '',
              process.env.LANJIAN_MULTI_API_CAPTURE_PATH
            ).catch((error: unknown) => ({
              ok: false, step: 'multi-api-settings-driver-error', error: error instanceof Error ? error.message : String(error)
            }))
            console.info('[desktop smoke] multi-api settings: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_TASK_PAUSE_ONLY === '1') {
            const { runWritingTaskPauseSmoke } = await import('./writing-task-pause-smoke')
            const result = await runWritingTaskPauseSmoke(window, process.env.LANJIAN_SMOKE_MODEL_URL || '').catch((error: unknown) => ({
              ok: false, step: 'task-pause-driver-error', error: error instanceof Error ? error.message : String(error)
            }))
            console.info('[desktop smoke] writing task pause/resume: ' + JSON.stringify(result))
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'writing-task-pause-resume.png'), (await window.capturePage()).toPNG())
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_TASK_DISMISS_ONLY === '1') {
            const { runWritingTaskDismissSmoke } = await import('./writing-task-dismiss-smoke')
            const result = await runWritingTaskDismissSmoke(
              window,
              process.env.LANJIAN_SMOKE_MODEL_URL || '',
              process.env.LANJIAN_TASK_DISMISS_CAPTURE_PATH
            ).catch((error: unknown) => ({
              ok: false, step: 'task-dismiss-driver-error', error: error instanceof Error ? error.message : String(error)
            }))
            console.info('[desktop smoke] writing task dismiss: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_IDEA_SOURCE_ONLY === '1') {
            const { runIdeaSourceSmoke } = await import('./idea-source-smoke')
            const result = await runIdeaSourceSmoke(window, process.env.LANJIAN_SMOKE_MODEL_URL || '').catch((error: unknown) => ({
              ok: false, step: 'idea-source-driver-error', error: error instanceof Error ? error.message : String(error)
            }))
            console.info('[desktop smoke] idea candidate visible source: ' + JSON.stringify(result))
            if (process.env.LANJIAN_IDEA_PROMOTION_CAPTURE_PATH) {
              await writeFile(process.env.LANJIAN_IDEA_PROMOTION_CAPTURE_PATH.replace('idea-to-world-rule.png', 'idea-candidate-source.png'), (await window.capturePage()).toPNG())
            }
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_OUTLINE_EXPANSION_ONLY === '1') {
            const result = await window.webContents.executeJavaScript(`(async () => {
              const settings = await window.novelDesktop.ai.getSettings()
              await window.novelDesktop.ai.updateSettings({ baseUrl: ${JSON.stringify(process.env.LANJIAN_SMOKE_MODEL_URL || '')}, apiKey: 'expansion-smoke-key', routingMode: 'shared', shared: { ...settings.shared, model: 'gemini-smoke-model' } })
              const api = window.novelDesktop.workspace
              const source = await api.getPlanningOutline('total')
              if (!source) return { ok: false, step: 'missing-source' }
              const before = await window.novelDesktop.chapters.list()
              const request = { operationId: crypto.randomUUID(), parentKey: 'total', expectedRevision: source.revision, count: 1, instruction: '' }
              const started = await api.startOutlineExpansion(request)
              for (let attempt = 0; attempt < 100; attempt++) {
                const task = (await api.listOutlineExpansions()).find(item => item.id === started.id)
                if (task?.status === 'succeeded') {
                  const replay = await api.startOutlineExpansion(request)
                  return { ok: task.proposal?.childType === 'volume' && task.proposal?.children.length === 1
                    && replay.id === task.id && (await api.getPlanningOutline('total')).revision === source.revision
                    && JSON.stringify(before) === JSON.stringify(await window.novelDesktop.chapters.list()), step: 'candidate-persisted', id: task.id }
                }
                if (['failed', 'cancelled', 'interrupted'].includes(task?.status)) return { ok: false, step: task.status }
                await new Promise(resolve => setTimeout(resolve, 100))
              }
              return { ok: false, step: 'timeout' }
            })()`)
            console.info(`[desktop smoke] outline expansion IPC: ${JSON.stringify(result)}`)
            if (!result.ok) return app.exit(1)
            const panelResult = await window.webContents.executeJavaScript(`(async () => {
              const wait = () => new Promise(resolve => setTimeout(resolve, 100))
              document.querySelector('[aria-label="谋篇"]')?.click()
              for (let n = 0; n < 50 && !document.querySelector('[data-testid="open-outline-expansion"]'); n++) await wait()
              document.querySelector('[data-testid="open-outline-expansion"]')?.click()
              for (let n = 0; n < 50 && !document.querySelector('[data-testid="start-outline-expansion"]'); n++) await wait()
              const count = document.querySelector('[data-testid="outline-expansion-count"]')
              if (!count) return { ok: false, step: 'no-form' }
              count.value = '1'; count.dispatchEvent(new Event('input', { bubbles: true }))
              await wait()
              const before = (await window.novelDesktop.workspace.listOutlineExpansions()).length
              document.querySelector('[data-testid="start-outline-expansion"]')?.click()
              for (let n = 0; n < 100; n++) {
                const tasks = await window.novelDesktop.workspace.listOutlineExpansions()
                if (tasks.length > before && tasks[0].status === 'succeeded'
                  && document.querySelectorAll('[data-testid="outline-expansion-task"]').length > before
                  && document.querySelector('[data-testid="outline-expansion-task"]')?.textContent.includes('候选已保存')) break
                await wait()
              }
              const panel = document.querySelector('[data-testid="outline-expansion-panel"]')
              const tasks = await window.novelDesktop.workspace.listOutlineExpansions()
              const tree = document.querySelector('.explorer')
              return { ok: tasks.length > before && tasks[0].status === 'succeeded'
                && document.querySelector('[data-testid="outline-expansion-task"]')?.textContent.includes('候选已保存')
                && panel?.textContent.includes('旧街回声') && panel.getBoundingClientRect().height > 200
                && Boolean(tree && tree.getBoundingClientRect().width > 100), step: 'panel-candidate-visible' }
            })()`)
            console.info(`[desktop smoke] outline expansion panel: ${JSON.stringify(panelResult)}`)
            await new Promise(resolve => setTimeout(resolve, 300))
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'outline-expansion-panel.png'), (await window.capturePage()).toPNG())
            const adoptionPreview = await window.webContents.executeJavaScript(`(async () => {
              const api = window.novelDesktop.workspace
              const task = (await api.listOutlineExpansions()).find(item => item.status === 'succeeded' && !item.adoptedKeys?.length)
              const source = await api.getPlanningOutline('total')
              const manuscripts = JSON.stringify(await window.novelDesktop.chapters.list())
              const outlines = JSON.stringify(await window.novelDesktop.outlines.list())
              const treeCount = document.querySelectorAll('.outline-volume-node').length
              document.querySelector('[data-testid="preview-outline-expansion-adoption"]')?.click()
              for (let n = 0; n < 80 && !document.querySelector('[data-testid="outline-expansion-adoption-preview"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
              const preview = document.querySelector('[data-testid="outline-expansion-adoption-preview"]')
              const content = preview?.querySelector('.expansion-child p')?.textContent
              window.__expansionAdoptionSmoke = { taskId: task.id, source, manuscripts, content, treeCount }
              return { ok: Boolean(content && preview.getBoundingClientRect().width > 200)
                && outlines === JSON.stringify(await window.novelDesktop.outlines.list()), step: 'click-preview-zero-write' }
            })()`)
            console.info('[desktop smoke] outline expansion preview: ' + JSON.stringify(adoptionPreview))
            if (!adoptionPreview.ok) return app.exit(1)
            await new Promise(resolve => setTimeout(resolve, 250))
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'outline-expansion-adoption-preview.png'), (await window.capturePage()).toPNG())
            const fullBounds = window.getBounds()
            window.setSize(1100, 760)
            await new Promise(resolve => setTimeout(resolve, 250))
            const narrow = await window.webContents.executeJavaScript(`(() => {
              const panel = document.querySelector('[data-testid="outline-expansion-panel"]')
              const tree = document.querySelector('.explorer').getBoundingClientRect()
              const rect = panel.getBoundingClientRect()
              return rect.left >= tree.right - 1 && rect.right <= innerWidth + 1 && panel.scrollWidth <= panel.clientWidth + 1
            })()`)
            console.info('[desktop smoke] outline expansion narrow layout: ' + narrow)
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'outline-expansion-adoption-narrow.png'), (await window.capturePage()).toPNG())
            window.setBounds(fullBounds)
            if (!narrow) return app.exit(1)
            const cancelledPreview = await window.webContents.executeJavaScript(`(async () => {
              const before = JSON.stringify(await window.novelDesktop.outlines.list())
              document.querySelector('[data-testid="outline-expansion-adoption-preview"] .secondary')?.click()
              await new Promise(resolve => setTimeout(resolve, 100))
              if (document.querySelector('[data-testid="outline-expansion-adoption-preview"]') || before !== JSON.stringify(await window.novelDesktop.outlines.list())) return false
              document.querySelector('[data-testid="preview-outline-expansion-adoption"]')?.click()
              for (let n = 0; n < 80 && !document.querySelector('[data-testid="confirm-outline-expansion-adoption"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
              return Boolean(document.querySelector('[data-testid="confirm-outline-expansion-adoption"]'))
            })()`)
            if (!cancelledPreview) return app.exit(1)
            const adoptionResult = await window.webContents.executeJavaScript(`(async () => {
              document.querySelector('[data-testid="confirm-outline-expansion-adoption"]')?.click()
              for (let n = 0; n < 100; n++) {
                if (document.querySelector('[data-testid="outline-expansion-notice"]')?.textContent.includes('已新增')
                  && document.querySelector('[data-testid="outline-expansion-task"]')?.textContent.includes('已采用 · 待复核')) break
                await new Promise(resolve => setTimeout(resolve, 100))
              }
              const api = window.novelDesktop.workspace
              const previous = window.__expansionAdoptionSmoke
              const task = (await api.listOutlineExpansions()).find(item => item.id === previous.taskId)
              const node = task.adoptedKeys?.length ? await api.getPlanningOutline(task.adoptedKeys[0]) : null
              const noticeRect = document.querySelector('[data-testid="outline-expansion-notice"]')?.getBoundingClientRect()
              return { ok: task.adoptedKeys?.length === 1 && node?.content === previous.content
                && (await api.getPlanningOutline('total')).revision === previous.source.revision
                && previous.manuscripts === JSON.stringify(await window.novelDesktop.chapters.list())
                && document.querySelectorAll('.outline-volume-node').length === previous.treeCount + 1
                && Boolean(document.querySelector('[data-testid="outline-expansion-notice"]')?.textContent.includes('已新增'))
                && noticeRect?.top >= 0 && noticeRect?.bottom < innerHeight
                && !document.querySelector('[data-testid="outline-expansion-adoption-preview"]')
                && !document.querySelector('.expansion-error'), step: 'click-adoption-visible', treeCount: document.querySelectorAll('.outline-volume-node').length,
                error: document.querySelector('.expansion-error')?.textContent, notice: document.querySelector('[data-testid="outline-expansion-notice"]')?.textContent }
            })()`)
            console.info('[desktop smoke] outline expansion adoption: ' + JSON.stringify(adoptionResult))
            if (!adoptionResult.ok) return app.exit(1)
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'outline-expansion-adopted.png'), (await window.capturePage()).toPNG())
            if (!panelResult.ok) return app.exit(1)
            const returned = await window.webContents.executeJavaScript(`(async () => {
              document.querySelector('[data-testid="open-outline-expansion"]')?.click()
              await new Promise(resolve => setTimeout(resolve, 200))
              return !document.querySelector('[data-testid="outline-expansion-panel"]')
                && document.querySelector('[aria-label="全局总纲正文"]')?.getBoundingClientRect().height > 100
            })()`)
            if (!returned) return app.exit(1)
            const beforeEdit = await window.webContents.executeJavaScript('document.querySelector("[aria-label=全局总纲正文]").textContent')
            await window.webContents.executeJavaScript('document.querySelector("[aria-label=全局总纲正文]").focus()')
            const key = async (keyCode: string) => {
              window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] })
              window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] })
              await new Promise(resolve => setTimeout(resolve, 200))
            }
            await key('End')
            await window.webContents.insertText('候选往返保留撤销。')
            await key('s')
            await window.webContents.executeJavaScript('document.querySelector("[data-testid=open-outline-expansion]").click()')
            await new Promise(resolve => setTimeout(resolve, 400))
            await window.webContents.executeJavaScript('document.querySelector("[data-testid=open-outline-expansion]").click(); document.querySelector("[aria-label=全局总纲正文]").focus()')
            await new Promise(resolve => setTimeout(resolve, 100))
            await window.webContents.executeJavaScript('document.querySelector("[aria-label=全局总纲正文]").focus()')
            await key('z')
            const undoPreserved = await window.webContents.executeJavaScript('document.querySelector("[aria-label=全局总纲正文]").textContent')
            if (undoPreserved !== beforeEdit) return app.exit(1)
            console.info('[desktop smoke] outline expansion return preserves editor undo: passed')
            const plannedRoot = process.env.LANJIAN_SMOKE_PROJECT_PATH
            if (!plannedRoot) return app.exit(1)
            const plannedDb = (await new SqliteWorkspaceDatabaseFactory().openExisting(plannedRoot))!
            try {
              const volume = plannedDb.formalOutlines().find(node => node.nodeType === 'volume')!
              plannedDb.writeFormalOutline({ legacyKey: 'stage-900', parentLegacyKey: volume.legacyKey, nodeType: 'stage', seq: 900, title: '独立章纲测试阶段', content: '阶段目标。' })
              plannedDb.writeFormalOutline({ legacyKey: 'chapter-900', parentLegacyKey: 'stage-900', nodeType: 'chapter', seq: 900, title: '尚无正文的章纲', content: '初始章纲。' })
            } finally { plannedDb.close() }
            const plannedResult = await window.webContents.executeJavaScript(`(async () => {
              const api = window.novelDesktop.outlines
              const before = JSON.stringify(await window.novelDesktop.chapters.list())
              const entry = (await api.list()).chapterOutlines.find(item => item.chapterId === 900)
              const opened = await api.getPlannedChapter(900)
              const saved = await api.updatePlannedChapter({ chapterId: 900, title: '独立章纲已编辑', content: '保存章纲，不生成空正文。', expectedRevision: opened.revision })
              let staleRejected = false
              try { await api.updatePlannedChapter({ chapterId: 900, title: '过期', content: '', expectedRevision: opened.revision }) } catch { staleRejected = true }
              return { ok: entry && !entry.hasManuscript && !('content' in entry) && entry.stage === 900
                && saved.title === '独立章纲已编辑' && saved.content === '保存章纲，不生成空正文。' && saved.mirrorStatus === 'synced'
                && (await api.getPlannedChapter(900)).revision === saved.revision && staleRejected
                && before === JSON.stringify(await window.novelDesktop.chapters.list()), step: 'standalone-outline-ipc' }
            })()`)
            console.info('[desktop smoke] planned chapter: ' + JSON.stringify(plannedResult))
            if (!plannedResult.ok) return app.exit(1)
            const plannedUiOpened = await window.webContents.executeJavaScript(`(async () => {
              window.__plannedUiManuscripts = JSON.stringify(await window.novelDesktop.chapters.list())
              document.querySelector('[aria-label="谋篇"]')?.click()
              for (let n = 0; n < 80 && !document.querySelector('[data-testid="open-planned-chapter-900"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
              document.querySelector('[data-testid="open-planned-chapter-900"]')?.click()
              for (let n = 0; n < 80 && !document.querySelector('[aria-label="独立章纲正文"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
              const editor = document.querySelector('[aria-label="独立章纲正文"]')
              editor?.focus()
              return Boolean(editor && editor.textContent === '保存章纲，不生成空正文。' && editor.getBoundingClientRect().height > 100)
            })()`)
            if (!plannedUiOpened) { console.error('[desktop smoke] planned chapter editor missing'); return app.exit(1) }
            await key('End')
            await window.webContents.insertText('新增独立编辑内容。')
            await key('s')
            const plannedUiSaved = await window.webContents.executeJavaScript(`(async () => {
              for (let n = 0; n < 80; n++) {
                const saved = await window.novelDesktop.outlines.getPlannedChapter(900)
                if (saved.content === '保存章纲，不生成空正文。新增独立编辑内容。'
                  && document.querySelector('[data-testid="planned-chapter-status"]')?.textContent.includes('章纲已保存')) return true
                await new Promise(resolve => setTimeout(resolve, 100))
              }
              return false
            })()`)
            console.info('[desktop smoke] planned chapter editor save: ' + plannedUiSaved)
            if (!plannedUiSaved) return app.exit(1)
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'planned-chapter-editor.png'), (await window.capturePage()).toPNG())
            // A stale revision must block navigation and leave the exact unsaved local draft visible.
            await window.webContents.executeJavaScript('document.querySelector("[aria-label=独立章纲正文]").focus()')
            await key('End')
            await window.webContents.insertText('未保存草稿必须保留。')
            const plannedConflict = await window.webContents.executeJavaScript(`(async () => {
              const api = window.novelDesktop.outlines
              const current = await api.getPlannedChapter(900)
              await api.updatePlannedChapter({ chapterId: 900, title: current.title, content: '另一处已保存的章纲版本。', expectedRevision: current.revision })
              Array.from(document.querySelectorAll('.tree-item')).find(item => item.textContent.includes('全局总纲'))?.click()
              for (let n = 0; n < 80 && !document.querySelector('.planned-error'); n++) await new Promise(resolve => setTimeout(resolve, 100))
              return Boolean(document.querySelector('.planned-error') && document.querySelector('[aria-label="独立章纲正文"]')?.textContent.endsWith('未保存草稿必须保留。'))
                && JSON.stringify(await window.novelDesktop.chapters.list()) === window.__plannedUiManuscripts
            })()`)
            console.info('[desktop smoke] planned chapter failed navigation preserves draft: ' + plannedConflict)
            if (!plannedConflict) return app.exit(1)
            const plannedReloaded = await window.webContents.executeJavaScript(`(async () => {
              const originalConfirm = window.confirm
              window.confirm = () => true
              document.querySelector('[data-testid="reload-planned-chapter"]')?.click()
              for (let n = 0; n < 80; n++) {
                if (!document.querySelector('.planned-error') && document.querySelector('[aria-label="独立章纲正文"]')?.textContent === '另一处已保存的章纲版本。') break
                await new Promise(resolve => setTimeout(resolve, 100))
              }
              window.confirm = originalConfirm
              const ok = document.querySelector('[aria-label="独立章纲正文"]')?.textContent === '另一处已保存的章纲版本。'
              Array.from(document.querySelectorAll('.tree-item')).find(item => item.textContent.includes('全局总纲'))?.click()
              await new Promise(resolve => setTimeout(resolve, 200))
              return ok && !document.querySelector('[data-testid="planned-chapter-editor"]')
                && JSON.stringify(await window.novelDesktop.chapters.list()) === window.__plannedUiManuscripts
            })()`)
            console.info('[desktop smoke] planned chapter conflict recovery: ' + plannedReloaded)
            if (!plannedReloaded) return app.exit(1)
            const fullPlanningChain = await window.webContents.executeJavaScript(`(async () => {
              const wait = () => new Promise(resolve => setTimeout(resolve, 100))
              const until = async (predicate) => { for (let n = 0; n < 150; n++) { if (await predicate()) return true; await wait() } return false }
              document.querySelector('.outline-volume-outline')?.click()
              if (!await until(() => document.querySelector('[aria-label="当前卷纲正文"]'))) return { ok: false, step: 'open-volume' }
              let lastKey = ''
              for (const kind of ['stage', 'chapter']) {
                document.querySelector('[data-testid="open-outline-expansion"]')?.click()
                if (!await until(() => document.querySelector('[data-testid="outline-expansion-count"]'))) return { ok: false, step: kind + '-panel' }
                const input = document.querySelector('[data-testid="outline-expansion-count"]')
                input.value = '1'; input.dispatchEvent(new Event('input', { bubbles: true }))
                await wait()
                if (!await until(() => {
                  const button = document.querySelector('[data-testid="start-outline-expansion"]')
                  return button && !button.disabled
                })) return { ok: false, step: kind + '-generation-not-ready' }
                document.querySelector('[data-testid="start-outline-expansion"]')?.click()
                if (!await until(() => document.querySelector('[data-testid="outline-expansion-task"]')?.textContent.includes('候选已保存'))) return { ok: false, step: kind + '-generation', text: document.querySelector('[data-testid="outline-expansion-panel"]')?.textContent }
                document.querySelector('[data-testid="preview-outline-expansion-adoption"]')?.click()
                if (!await until(() => document.querySelector('[data-testid="confirm-outline-expansion-adoption"]'))) return { ok: false, step: kind + '-preview' }
                document.querySelector('[data-testid="confirm-outline-expansion-adoption"]')?.click()
                if (!await until(() => document.querySelector('[data-testid="outline-expansion-task"]')?.textContent.includes('已采用 · 待复核'))) return { ok: false, step: kind + '-adoption', text: document.querySelector('.expansion-error')?.textContent }
                const task = (await window.novelDesktop.workspace.listOutlineExpansions()).find(item => item.proposal?.childType === kind && item.adoptedKeys?.length)
                lastKey = task.adoptedKeys[0]
                const id = Number(lastKey.split('-')[1])
                const selector = kind === 'stage' ? '[data-testid="open-stage-' + id + '"]' : '[data-testid="open-planned-chapter-' + id + '"]'
                if (!await until(() => document.querySelector(selector))) return { ok: false, step: kind + '-missing-tree' }
                document.querySelector(selector).click()
                if (!await until(() => document.querySelector(kind === 'stage' ? '[aria-label="当前阶段纲正文"]' : '[aria-label="独立章纲正文"]'))) return { ok: false, step: kind + '-missing-editor' }
              }
              const formal = await window.novelDesktop.outlines.getPlannedChapter(Number(lastKey.split('-')[1]))
              const rendered = Array.from(document.querySelectorAll('[aria-label="独立章纲正文"] .cm-line')).map(line => line.textContent).join(String.fromCharCode(10))
              return { ok: rendered === formal.content
                && !formal.hasManuscript && JSON.stringify(await window.novelDesktop.chapters.list()) === window.__plannedUiManuscripts, step: 'volume-stage-chapter-opened', key: lastKey }
            })()`)
            console.info('[desktop smoke] full planning click chain: ' + JSON.stringify(fullPlanningChain))
            if (!fullPlanningChain.ok) return app.exit(1)
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'planned-chapter-generated.png'), (await window.capturePage()).toPNG())
            const manuscriptHandoff = await window.webContents.executeJavaScript(`(async () => {
              const id = Number(${JSON.stringify(fullPlanningChain.key)}.split('-')[1])
              const source = await window.novelDesktop.outlines.getPlannedChapter(id)
              const before = await window.novelDesktop.chapters.list()
              const confirm = window.confirm
              try {
                window.confirm = () => false
                document.querySelector('[data-testid="start-planned-chapter"]')?.click()
                await new Promise(resolve => setTimeout(resolve, 200))
                if (JSON.stringify(before) !== JSON.stringify(await window.novelDesktop.chapters.list())) return { ok: false, step: 'cancel-created-body' }
                window.confirm = () => true
                document.querySelector('[data-testid="start-planned-chapter"]')?.click()
                for (let n = 0; n < 100; n++) {
                  if (document.querySelector('.creation-activity.selected')?.getAttribute('data-activity') === 'desk') break
                  await new Promise(resolve => setTimeout(resolve, 100))
                }
                const after = await window.novelDesktop.chapters.list()
                const created = after.find(chapter => chapter.id === id)
                const outline = await window.novelDesktop.outlines.getPlannedChapter(id)
                const status = await window.novelDesktop.outlines.planningStatus(id)
                return { ok: after.length === before.length + 1 && created?.content === ''
                  && before.every(chapter => JSON.stringify(chapter) === JSON.stringify(after.find(item => item.id === chapter.id)))
                  && outline.revision === source.revision && outline.content === source.content
                  && status.chapterPlacements.find(item => item.chapterId === id)?.volume === source.volume
                  && document.querySelector('.creation-activity.selected')?.getAttribute('data-activity') === 'desk',
                  step: 'planned-chapter-to-manuscript', id, volume: source.volume }
              } finally { window.confirm = confirm }
            })()`)
            console.info('[desktop smoke] manuscript handoff: ' + JSON.stringify(manuscriptHandoff))
            if (!manuscriptHandoff.ok) return app.exit(1)
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'planned-chapter-started.png'), (await window.capturePage()).toPNG())
            const allocationDb = (await new SqliteWorkspaceDatabaseFactory().openExisting(process.env.LANJIAN_SMOKE_PROJECT_PATH!))!
            try {
              const parent = allocationDb.formalOutlines().find(node => node.nodeType === 'stage')!
              allocationDb.writeFormalOutline({ legacyKey: 'chapter-999', parentLegacyKey: parent.legacyKey, nodeType: 'chapter', seq: 999, title: '保留章纲身份', content: '只有章纲，不能被普通新建正文占用。' })
            } finally { allocationDb.close() }
            const allocation = await window.webContents.executeJavaScript(`(async () => {
              const source = await window.novelDesktop.outlines.getPlannedChapter(999)
              const before = await window.novelDesktop.chapters.list()
              document.querySelector('[aria-label="新建章节"]')?.click()
              let after = before
              for (let n = 0; n < 100; n++) {
                after = await window.novelDesktop.chapters.list()
                if (after.some(chapter => chapter.id === 1000)) break
                await new Promise(resolve => setTimeout(resolve, 100))
              }
              const outline = await window.novelDesktop.outlines.getPlannedChapter(999)
              return { ok: after.length === before.length + 1 && after.some(chapter => chapter.id === 1000 && chapter.content === '')
                && !outline.hasManuscript && outline.revision === source.revision && outline.content === source.content
                && before.every(chapter => JSON.stringify(chapter) === JSON.stringify(after.find(item => item.id === chapter.id))), step: 'ordinary-create-reserves-outline-id' }
            })()`)
            console.info('[desktop smoke] chapter allocation: ' + JSON.stringify(allocation))
            if (!allocation.ok) return app.exit(1)
            const firstOutlineSave = await window.webContents.executeJavaScript(`(async () => {
              const before = JSON.stringify(await window.novelDesktop.chapters.list())
              await window.novelDesktop.outlines.placeChapter(1000, 1)
              await window.novelDesktop.chapterOutlines.update(1000, '新建正文后首次保存的章纲。')
              const saved = await window.novelDesktop.chapterOutlines.get(1000)
              return { ok: saved.content === '新建正文后首次保存的章纲。'
                && JSON.stringify(await window.novelDesktop.chapters.list()) === before,
                step: 'first-outline-save-with-selected-volume' }
            })()`)
            console.info('[desktop smoke] first outline save: ' + JSON.stringify(firstOutlineSave))
            if (!firstOutlineSave.ok) return app.exit(1)
            const recoveryOpened = await window.webContents.executeJavaScript(`(async () => {
              document.querySelector('[aria-label="谋篇"]')?.click()
              for (let n = 0; n < 80 && !document.querySelector('[data-testid="open-planned-chapter-999"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
              document.querySelector('[data-testid="open-planned-chapter-999"]')?.click()
              for (let n = 0; n < 80 && !document.querySelector('[aria-label="独立章纲正文"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
              const editor = document.querySelector('[aria-label="独立章纲正文"]')
              editor?.focus()
              return Boolean(editor)
            })()`)
            if (!recoveryOpened) return app.exit(1)
            await key('End')
            await window.webContents.insertText('尚未保存的章纲恢复测试。')
            const recoverySnapshotReady = await window.webContents.executeJavaScript(`(async () => {
              for (let n = 0; n < 80; n++) {
                const drafts = JSON.parse(localStorage.getItem('lanjian.planned-outline-recovery.v1') || '{}').drafts || []
                if (drafts.some(draft => draft.chapterId === 999 && draft.content.endsWith('尚未保存的章纲恢复测试。'))) {
                  const formal = await window.novelDesktop.outlines.getPlannedChapter(999)
                  await window.novelDesktop.outlines.updatePlannedChapter({ chapterId: 999, title: formal.title, content: '另一处保存的较新章纲。', expectedRevision: formal.revision })
                  return true
                }
                await new Promise(resolve => setTimeout(resolve, 50))
              }
              return false
            })()`)
            if (!recoverySnapshotReady) return app.exit(1)
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Planned recovery reload timed out')), 15_000)
              window.webContents.once('did-finish-load', () => { clearTimeout(timeout); resolve() })
              window.webContents.reload()
            })
            const recoveryCompared = await window.webContents.executeJavaScript(`(async () => {
              let opened = false
              for (let n = 0; n < 100; n++) {
                if (document.querySelector('[aria-label="谋篇"]')) break
                const book = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
                if (book && !opened) { opened = true; book.click() }
                await new Promise(resolve => setTimeout(resolve, 100))
              }
              document.querySelector('[aria-label="谋篇"]')?.click()
              for (let n = 0; n < 80 && !document.querySelector('[data-testid="open-planned-chapter-999"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
              document.querySelector('[data-testid="open-planned-chapter-999"]')?.click()
              for (let n = 0; n < 80 && !document.querySelector('[data-testid="planned-outline-recovery"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
              const panel = document.querySelector('[data-testid="planned-outline-recovery"]')
              return Boolean(panel?.textContent.includes('尚未保存的章纲恢复测试。') && panel?.textContent.includes('另一处保存的较新章纲。'))
                && (await window.novelDesktop.outlines.getPlannedChapter(999)).content === '另一处保存的较新章纲。'
            })()`)
            console.info('[desktop smoke] planned recovery reload comparison: ' + recoveryCompared)
            if (!recoveryCompared) return app.exit(1)
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'planned-outline-recovery.png'), (await window.capturePage()).toPNG())
            const recoveredOutline = await window.webContents.executeJavaScript(`(async () => {
              const confirm = window.confirm
              try {
                window.confirm = () => false
                document.querySelector('[data-testid="restore-planned-recovery"]')?.click()
                await new Promise(resolve => setTimeout(resolve, 250))
                if (!document.querySelector('[data-testid="planned-outline-recovery"]')) return false
                window.confirm = () => true
                document.querySelector('[data-testid="restore-planned-recovery"]')?.click()
                for (let n = 0; n < 80 && !document.querySelector('[aria-label="独立章纲正文"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
                if ((await window.novelDesktop.outlines.getPlannedChapter(999)).content !== '另一处保存的较新章纲。') return false
                document.querySelector('[data-testid="save-planned-chapter"]')?.click()
                for (let n = 0; n < 80; n++) {
                  const formal = await window.novelDesktop.outlines.getPlannedChapter(999)
                  const drafts = JSON.parse(localStorage.getItem('lanjian.planned-outline-recovery.v1') || '{}').drafts || []
                  if (formal.content.endsWith('尚未保存的章纲恢复测试。') && !drafts.some(draft => draft.chapterId === 999)) return true
                  await new Promise(resolve => setTimeout(resolve, 100))
                }
                return false
              } finally { window.confirm = confirm }
            })()`)
            console.info('[desktop smoke] planned recovery explicit restore and save: ' + recoveredOutline)
            if (!recoveredOutline) return app.exit(1)
            if (process.env.LANJIAN_SMOKE_PLANNED_COLD !== '1') {
              const { DatabaseSync } = await import('node:sqlite')
              const archiveFixture = new DatabaseSync(join(process.env.LANJIAN_SMOKE_PROJECT_PATH!, '.webnovel', 'workspace.sqlite'))
              try { archiveFixture.prepare("UPDATE outline_nodes SET status = 'archived' WHERE legacy_key = 'chapter-900'").run() }
              finally { archiveFixture.close() }
              const shelfResult = await window.webContents.executeJavaScript(`(async () => {
                const before = JSON.stringify(await window.novelDesktop.chapters.list())
                const projectStatus = await window.novelDesktop.projects.status()
                const draft = { version: 1, workItemId: projectStatus.project.path, chapterId: 900,
                  title: '已归档章纲恢复', content: '归档之前未保存的完整章纲。', baseRevision: 'a'.repeat(64), operationId: 'shelf-archived', updatedAt: new Date().toISOString() }
                localStorage.setItem('lanjian.planned-outline-recovery.v1', JSON.stringify({ version: 1, drafts: [draft,
                  { ...draft, chapterId: 901, title: '已有正文的章纲恢复', content: '只能由作者核对采用。', operationId: 'shelf-existing' },
                  { ...draft, workItemId: 'another-isolated-work-item', title: '其他作品不可见', operationId: 'shelf-other-book' }] }))
                document.querySelector('[data-testid="open-outline-recovery-shelf"]')?.click()
                for (let n = 0; n < 80 && !document.querySelector('[data-testid="outline-recovery-shelf"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
                const picker = document.querySelector('[aria-label="选择章纲恢复稿"]')
                if (!picker || picker.options.length !== 2 || !document.querySelector('[aria-label="章纲恢复稿全文"]')?.value.includes(draft.content)) return { ok: false, step: 'shelf-isolation', options: picker ? Array.from(picker.options).map(option => option.text) : null, shelf: document.querySelector('[data-testid="outline-recovery-shelf"]')?.textContent, entryExists: Boolean(document.querySelector('[data-testid="open-outline-recovery-shelf"]')) }
                const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
                let copied = ''
                try {
                  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text } } })
                  document.querySelector('[data-testid="copy-shelf-recovery"]')?.click()
                  await new Promise(resolve => setTimeout(resolve, 100))
                  if (copied !== document.querySelector('[aria-label="章纲恢复稿全文"]').value) return { ok: false, step: 'shelf-copy' }
                } finally { if (original) Object.defineProperty(navigator, 'clipboard', original); else delete navigator.clipboard }
                document.querySelector('[data-testid="open-shelf-outline"]')?.click()
                await new Promise(resolve => setTimeout(resolve, 250))
                if (!document.querySelector('[data-testid="outline-recovery-shelf"]')) return { ok: false, step: 'archived-outline-recreated' }
                picker.value = '901'; picker.dispatchEvent(new Event('change', { bubbles: true }))
                await new Promise(resolve => setTimeout(resolve, 100))
                document.querySelector('[data-testid="open-shelf-outline"]')?.click()
                for (let n = 0; n < 80 && !document.querySelector('[aria-label="当前章纲正文"]'); n++) await new Promise(resolve => setTimeout(resolve, 100))
                const retained = JSON.parse(localStorage.getItem('lanjian.planned-outline-recovery.v1')).drafts
                return { ok: Boolean(document.querySelector('[aria-label="当前章纲正文"]')) && retained.length === 3
                  && JSON.stringify(await window.novelDesktop.chapters.list()) === before, step: 'orphan-and-attached-outline-recovery' }
              })()`)
              console.info('[desktop smoke] outline recovery shelf: ' + JSON.stringify(shelfResult))
              if (!shelfResult.ok) return app.exit(1)
              await window.webContents.executeJavaScript('document.querySelector("[data-testid=open-outline-recovery-shelf]")?.click()')
              await new Promise(resolve => setTimeout(resolve, 150))
              if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'outline-recovery-shelf.png'), (await window.capturePage()).toPNG())
            }
            if (process.env.LANJIAN_SMOKE_PLANNED_COLD === '1') {
              await window.webContents.executeJavaScript('document.querySelector("[aria-label=独立章纲正文]").focus()')
              await key('End')
              await window.webContents.insertText('完整进程冷启动恢复。')
              const coldReady = await window.webContents.executeJavaScript(`(async () => {
                for (let n = 0; n < 80; n++) {
                  const drafts = JSON.parse(localStorage.getItem('lanjian.planned-outline-recovery.v1') || '{}').drafts || []
                  if (drafts.some(draft => draft.chapterId === 999 && draft.content.endsWith('完整进程冷启动恢复。'))) {
                    return !(await window.novelDesktop.outlines.getPlannedChapter(999)).content.includes('完整进程冷启动恢复。')
                  }
                  await new Promise(resolve => setTimeout(resolve, 50))
                }
                return false
              })()`)
              console.info('[desktop smoke] unsaved cold-start snapshot ready: ' + coldReady)
              // Test-only exit bypasses the window's save/close handshake; the harness starts a new PID.
              return app.exit(coldReady ? 73 : 1)
            }
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_SHARED_MANUSCRIPT_ONLY === '1') {
            await window.webContents.executeJavaScript('document.querySelector("[aria-label=\\\"书稿\\\"]")?.click()')
            await new Promise((resolve) => setTimeout(resolve, 300))
            const key = async (keyCode: string, modifiers: Array<'control' | 'shift'> = []) => {
              window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
              window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
              await new Promise((resolve) => setTimeout(resolve, 120))
            }
            const readEditor = () => window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[data-testid=\\\"manuscript-input\\\"] .cm-line")).map(line => line.textContent).join("\\n")')
            const before = await readEditor()
            await window.webContents.executeJavaScript('document.querySelector("[data-testid=\\\"manuscript-input\\\"]").focus()')
            await key('End', ['control'])
            await window.webContents.insertText('共同编辑核心验收。')
            await new Promise((resolve) => setTimeout(resolve, 150))
            const after = await readEditor()
            await key('z', ['control'])
            const undone = await readEditor()
            await key('y', ['control'])
            const redone = await readEditor()
            console.info(`[desktop smoke] shared manuscript history: ${JSON.stringify({ input: after.includes('共同编辑核心验收。'), undo: undone === before, redo: redone === after })}`)
            if (!after.includes('共同编辑核心验收。') || undone !== before || redone !== after) return app.exit(1)
            // Exercise a CodeMirror-handled deletion (no browser beforeinput event is required).
            await key('Backspace')
            const deleted = await readEditor()
            await key('z', ['control'])
            if (deleted === after || await readEditor() !== after) return app.exit(1)
            await key('Enter')
            await window.webContents.insertText('第二段保持正文格式。')
            await new Promise((resolve) => setTimeout(resolve, 150))
            const paragraphs = await readEditor()
            if (!paragraphs.includes('\n\n　　第二段保持正文格式。')) return app.exit(1)
            await key('s', ['control'])
            const saved = await window.webContents.executeJavaScript('window.novelDesktop.chapters.get(1)')
            if (saved.content !== paragraphs) return app.exit(1)
            window.webContents.debugger.attach('1.3')
            try {
              await window.webContents.debugger.sendCommand('Input.imeSetComposition', { text: '组合输入', selectionStart: 4, selectionEnd: 4 })
              await window.webContents.debugger.sendCommand('Input.insertText', { text: '组合输入完成。' })
            } finally { window.webContents.debugger.detach() }
            await new Promise((resolve) => setTimeout(resolve, 300))
            await key('s', ['control'])
            const composed = await window.webContents.executeJavaScript('window.novelDesktop.chapters.get(1)')
            if (!composed.content.endsWith('组合输入完成。')) return app.exit(1)
            await key('a', ['control'])
            const selectionVisible = await window.webContents.executeJavaScript('Boolean(document.querySelector("[data-testid=\\\"manuscript-selection-word-count\\\"]"))')
            if (!selectionVisible) return app.exit(1)
            await window.webContents.executeJavaScript('document.querySelector(\'[data-testid="manuscript-focus"]\')?.click()')
            await new Promise((resolve) => setTimeout(resolve, 150))
            const focusVisible = await window.webContents.executeJavaScript('document.querySelector("[data-testid=\\\"manuscript-input\\\"]").getBoundingClientRect().height > 100 && Boolean(document.querySelector(".manuscript-editor.is-focus-mode"))')
            if (!focusVisible) return app.exit(1)
            // Use the real editor selection and shortcut; do not manufacture textarea events.
            await window.webContents.executeJavaScript('document.querySelector("[data-testid=manuscript-input]").focus()')
            await key('a', ['control'])
            await key('a', ['control', 'shift'])
            const assistantLayout = await window.webContents.executeJavaScript(`(() => {
              const input = document.querySelector('[data-testid="writing-agent-input"]')
              const panel = document.querySelector('.assistant-panel')
              const editor = document.querySelector('.manuscript-editor')
              const p = panel?.getBoundingClientRect()
              const e = editor?.getBoundingClientRect()
              return {
                selection: Boolean(document.querySelector('.agent-selection-state')?.textContent?.includes('已选中正文')),
                focused: document.activeElement === input,
                docked: Boolean(p && e && p.width > 200 && e.width > 300 && e.right <= p.left + 1),
                focusMode: Boolean(document.querySelector('.manuscript-editor.is-focus-mode'))
              }
            })()`)
            console.info(`[desktop smoke] shared manuscript focus AI: ${JSON.stringify(assistantLayout)}`)
            if (!Object.values(assistantLayout).every(Boolean)) return app.exit(1)
            // Let the dock transition paint before capturing the actual composed frame.
            await new Promise((resolve) => setTimeout(resolve, 500))
            if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'shared-manuscript-editor.png'), (await window.capturePage()).toPNG())
            await key('Escape')
            await window.webContents.executeJavaScript('document.querySelector("[aria-label=关闭智能助笔侧栏]")?.click(); document.querySelector("[data-testid=manuscript-input]").focus()')
            await key('End', ['control'])
            const longAppend = '\n\n' + Array.from({ length: 600 }, (_, index) => `　　第${index + 1}段，长文滚动与保存验证。`).join('\n\n') + '\n\n　　末尾定位标记。'
            await window.webContents.insertText(longAppend)
            await new Promise((resolve) => setTimeout(resolve, 300))
            await key('s', ['control'])
            const longSaved = await window.webContents.executeJavaScript('window.novelDesktop.chapters.get(1)')
            if (longSaved.content !== composed.content + longAppend) throw new Error('Long manuscript save differs from native input')
            // Leave the document through its actual chapter tree, then verify history isolation.
            await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("button.chapter-tree-row")).find(button => button.querySelector(".chapter-no")?.textContent === "第2章").click()')
            await new Promise((resolve) => setTimeout(resolve, 600))
            const secondBefore = await readEditor()
            await window.webContents.executeJavaScript('document.querySelector("[data-testid=manuscript-input]").focus()')
            await key('z', ['control'])
            if (await readEditor() !== secondBefore) throw new Error('Undo crossed into previous chapter')
            await key('End', ['control'])
            await window.webContents.insertText('第二章独立修改。')
            await key('s', ['control'])
            const secondSaved = await window.webContents.executeJavaScript('window.novelDesktop.chapters.get(2)')
            if (!secondSaved.content.endsWith('第二章独立修改。')) throw new Error('Second chapter save failed')
            const firstUnchanged = await window.webContents.executeJavaScript('window.novelDesktop.chapters.get(1)')
            if (firstUnchanged.content !== longSaved.content) throw new Error('Second chapter edit changed first chapter')
            await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("button.chapter-tree-row")).find(button => button.querySelector(".chapter-no")?.textContent === "第1章").click()')
            await new Promise((resolve) => setTimeout(resolve, 600))
            await window.webContents.executeJavaScript('document.querySelector("[data-testid=manuscript-input]").focus()')
            await key('End', ['control'])
            await key('Home', ['shift'])
            const endSelection = await window.webContents.executeJavaScript('window.getSelection()?.toString()')
            if (!endSelection?.includes('末尾定位标记。')) throw new Error('Long document tail selection failed')
            await key('a', ['control', 'shift'])
            const tailHandoff = await window.webContents.executeJavaScript('Boolean(document.querySelector(".agent-selection-state")?.textContent?.includes("已选中正文")) && document.activeElement === document.querySelector("[data-testid=writing-agent-input]")')
            if (!tailHandoff) throw new Error('Long document selection AI handoff failed')
            console.info('[desktop smoke] shared manuscript long document/save/chapter isolation/tail selection: passed')
            await window.webContents.executeJavaScript('document.querySelector("[aria-label=关闭智能助笔侧栏]")?.click(); document.querySelector("[data-testid=manuscript-input]").focus()')
            await key('End', ['control'])
            const recoverySuffix = '未保存恢复验收。'
            await window.webContents.insertText(recoverySuffix)
            const recoveryReady = await window.webContents.executeJavaScript(`(async () => {
              for (let attempt = 0; attempt < 30; attempt++) {
                const drafts = JSON.parse(localStorage.getItem('lanjian.manuscript-recovery.v1') || '{}').drafts || []
                if (drafts.some(draft => draft.chapterId === 1 && draft.content.endsWith(${JSON.stringify(recoverySuffix)}))) return true
                await new Promise(resolve => setTimeout(resolve, 30))
              }
              return false
            })()`)
            if (!recoveryReady) throw new Error('Native edit did not leave a recovery snapshot')
            const beforeReload = await window.webContents.executeJavaScript('window.novelDesktop.chapters.get(1)')
            if (beforeReload.content !== longSaved.content) throw new Error('Recovery test requires an uncommitted draft')
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Recovery reload timed out')), 15_000)
              window.webContents.once('did-finish-load', () => { clearTimeout(timeout); resolve() })
              window.webContents.reload()
            })
            const restored = await window.webContents.executeJavaScript(`(async () => {
              const wait = () => new Promise(resolve => setTimeout(resolve, 100))
              let opened = false
              for (let attempt = 0; attempt < 100; attempt++) {
                if (document.querySelector('[data-testid="manuscript-recovery-dialog"]')) break
                const item = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
                if (item && !opened) { opened = true; item.click() }
                await wait()
              }
              const action = document.querySelector('[data-testid="manuscript-recovery-dialog"] .restore-action')
              if (!action) return false
              action.click()
              for (let attempt = 0; attempt < 100; attempt++) {
                const chapter = await window.novelDesktop.chapters.get(1)
                if (chapter.content.endsWith(${JSON.stringify(recoverySuffix)})) return true
                await wait()
              }
              return false
            })()`)
            if (!restored) throw new Error('Recovery dialog failed to restore native draft')
            const recoveredChapter = await window.webContents.executeJavaScript('window.novelDesktop.chapters.get(1)')
            if (recoveredChapter.content !== longSaved.content + recoverySuffix) throw new Error('Recovered long document differs from draft')
            console.info('[desktop smoke] shared manuscript unsaved draft/reload/explicit recovery/full content: passed')
            console.info('[desktop smoke] shared manuscript delete/paragraph/save/IME/selection/focus: passed')
            return app.exit(0)
          }
          if (process.env.LANJIAN_SMOKE_IDEA_PROMOTION_ONLY === '1') {
            const ideaScene = await runIdeaSceneScenario({ window })
            if (!ideaScene.ok) {
              console.error(`[desktop smoke] idea promotion failed: ${JSON.stringify(ideaScene)}`)
              return app.exit(1)
            }
            const workItemRoot = process.env.LANJIAN_SMOKE_PROJECT_PATH || ''
            const ideasMirror = await readFile(join(workItemRoot, '.webnovel', 'ideas', 'ideas.json'), 'utf8').then((value) => JSON.parse(value)).catch(() => null)
            if (ideasMirror?.authority !== 'sqlite-ideas' || ideasMirror?.ideas?.[0]?.promotedToType !== 'world_rule') {
              console.error(`[desktop smoke] idea mirror missing: ${JSON.stringify(ideasMirror)}`)
              return app.exit(1)
            }
            const ideaCapturePath = process.env.LANJIAN_IDEA_PROMOTION_CAPTURE_PATH
            if (ideaCapturePath) await writeFile(ideaCapturePath, (await window.capturePage()).toPNG())
            console.info(`[desktop smoke] idea promotion passed: ${JSON.stringify({ ideaScene, mirrorCount: ideasMirror.ideas.length })}`)
            const planningFromIdea = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const foundation = await window.novelDesktop.workspace.getFoundation()
              if (foundation.sourceNotes.trim()) return { ok: false, step: 'notes-not-empty' }
              document.querySelector('[aria-label="设置"]')?.click()
              for (let n = 0; n < 60 && !document.querySelector('[data-testid="settings-nav-connection"]'); n++) await wait(100)
              document.querySelector('[data-testid="settings-nav-connection"]')?.click()
              await wait(150)
              const page = document.querySelector('[data-testid="settings-page-connection"]')
              const inputs = page?.querySelectorAll('input')
              if (!inputs || inputs.length < 2) return { ok: false, step: 'connection-missing' }
              inputs[0].value = ${JSON.stringify(process.env.LANJIAN_SMOKE_MODEL_URL || '')}
              inputs[1].value = 'idea-planning-smoke-key'
              for (const input of inputs) input.dispatchEvent(new Event('input', { bubbles: true }))
              Array.from(page.querySelectorAll('button')).find((button) => button.textContent.includes('保存接口'))?.click()
              for (let n = 0; n < 60; n++) {
                if ((await window.novelDesktop.ai.getSettings()).apiKeyConfigured) break
                await wait(100)
              }
              await wait(250)
              const modelSettings = await window.novelDesktop.ai.getSettings()
              await window.novelDesktop.ai.updateSettings({
                baseUrl: ${JSON.stringify(process.env.LANJIAN_SMOKE_MODEL_URL || '')},
                routingMode: 'shared',
                shared: { ...modelSettings.shared, model: 'gemini-smoke-model' }
              })
              document.querySelector('[aria-label="筹备"]')?.click()
              await wait(150)
              document.querySelector('[data-testid="preparation-automatic"]')?.click()
              let start = null
              for (let n = 0; n < 60; n++) {
                start = document.querySelector('[data-testid="start-planning"]')
                if (start && !start.disabled) break
                await wait(100)
              }
              if (!start || start.disabled) return { ok: false, step: 'planning-disabled-without-notes' }
              start.click()
              for (let n = 0; n < 160; n++) {
                const proposal = document.querySelector('[data-testid="planning-proposal"]')
                if (proposal) return { ok: true, step: 'idea-to-planning-candidate', text: proposal.textContent.slice(0, 300) }
                await wait(100)
              }
              return { ok: false, step: 'planning-candidate-missing', text: document.body.textContent.slice(-1600) }
            })()`)
            console.info(`[desktop smoke] idea planning: ${JSON.stringify(planningFromIdea)}`)
            if (!planningFromIdea.ok) return app.exit(1)
            const ideaGenerationScene = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[aria-label="素材"]')?.click()
              await wait(150)
              document.querySelector('[data-testid="idea-list"] button')?.click()
              await wait(200)
              const before = await window.novelDesktop.workspace.listIdeas()
              for (const selector of ['idea-diverge', 'idea-synopsis']) {
                const button = document.querySelector('[data-testid="' + selector + '"]')
                if (!button || button.disabled) return { ok: false, step: selector + '-disabled' }
                button.click()
                for (let n = 0; n < 120; n++) {
                  const tasks = await window.novelDesktop.workspace.listIdeaGenerations()
                  const mode = selector === 'idea-diverge' ? 'diverge' : 'synopsis'
                  if (tasks.some((task) => task.mode === mode && task.status === 'succeeded')) break
                  await wait(100)
                }
                for (let n = 0; n < 60 && document.querySelector('[data-testid="idea-synopsis"]')?.disabled; n++) await wait(100)
              }
              const tasks = await window.novelDesktop.workspace.listIdeaGenerations()
              const after = await window.novelDesktop.workspace.listIdeas()
              for (let n = 0; n < 60; n++) {
                if (document.querySelectorAll('[data-testid="idea-generation-result"] details').length === 2) break
                await wait(100)
              }
              document.querySelector('[data-testid="idea-generation"]')?.scrollIntoView({ block: 'start' })
              await wait(150)
              const result = document.querySelector('[data-testid="idea-generation-result"]')
              return { ok: tasks.length === 2 && tasks.every((task) => task.status === 'succeeded' && task.proposal?.options.length === 1)
                && JSON.stringify(before) === JSON.stringify(after) && Boolean(result?.textContent.includes('钟楼偏偏记得那句吐槽')),
                tasks: tasks.map((task) => ({ mode: task.mode, status: task.status, model: task.model, proposal: task.proposal })), ideaCount: after.length,
                unchanged: JSON.stringify(before) === JSON.stringify(after), rendered: result?.textContent || '', renderedCount: document.querySelectorAll('[data-testid="idea-generation-result"] details').length }
            })()`)
            console.info(`[desktop smoke] independent idea generation: ${JSON.stringify(ideaGenerationScene)}`)
            if (ideaCapturePath) await writeFile(ideaCapturePath.replace('idea-to-world-rule.png', 'idea-generation-candidates.png'), (await window.capturePage()).toPNG())
            if (!ideaGenerationScene.ok) return app.exit(1)
            const generatedIdeas: import('../../src/contracts/index').IdeaGenerationTask[] = await window.webContents.executeJavaScript('window.novelDesktop.workspace.listIdeaGenerations()')
            for (const generated of generatedIdeas) {
              const mirrorPath = join(workItemRoot, '.webnovel', 'ideas', 'generations', `${generated.id}.json`)
              let mirror: { taskId: string; model: string; proposal: unknown } | null = null
              for (let attempt = 0; attempt < 30 && !mirror; attempt++) {
                mirror = await readFile(mirrorPath, 'utf8').then((content) => JSON.parse(content)).catch(() => null)
                if (!mirror) await new Promise((resolve) => setTimeout(resolve, 100))
              }
              if (!mirror || mirror.taskId !== generated.id || mirror.model !== generated.model
                || JSON.stringify(mirror.proposal) !== JSON.stringify(generated.proposal)) return app.exit(1)
            }
            console.info('[desktop smoke] idea candidate readable mirrors: passed')
            const candidateEdit = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-testid="idea-generation-result"] details button')?.click()
              await wait(100)
              const title = document.querySelector('[data-testid="idea-title-input"]')
              if (title?.value !== '钟楼偏偏记得那句吐槽') return { ok: false, step: 'candidate-not-in-editor' }
              if ((await window.novelDesktop.workspace.listIdeas()).length !== 1) return { ok: false, step: 'copy-wrote-without-save' }
              document.querySelector('[data-testid="idea-editor"]')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
              for (let n = 0; n < 60; n++) {
                const ideas = await window.novelDesktop.workspace.listIdeas()
                const saved = ideas.find((idea) => idea.title === '钟楼偏偏记得那句吐槽')
                if (saved) {
                  const origin = saved.generationSource ? await window.novelDesktop.workspace.ideaGeneration(saved.generationSource.taskId) : null
                  let originVisible = false
                  for (let attempt = 0; attempt < 60; attempt++) {
                    const panel = document.querySelector('[data-testid="idea-origin"]')
                    panel?.setAttribute('open', '')
                    originVisible = Boolean(document.querySelector('[data-testid="idea-origin-content"]')?.textContent?.includes('钟楼偏偏记得那句吐槽'))
                    if (originVisible) break
                    await wait(100)
                  }
                  return { ok: ideas.length === 2 && saved.status === 'candidate' && saved.promotedToId === null
                    && saved.generationSource?.optionIndex === 0 && origin?.proposal?.options[0]?.title === saved.title && originVisible,
                    step: 'candidate-saved-with-visible-origin', originVisible }
                }
                await wait(100)
              }
              return { ok: false, step: 'candidate-save-missing' }
            })()`)
            console.info(`[desktop smoke] idea candidate editing: ${JSON.stringify(candidateEdit)}`)
            if (!candidateEdit.ok) return app.exit(1)
            if (process.env.LANJIAN_SMOKE_IDEA_SUMMARY_ONLY === '1') {
              const summaryScene = await window.webContents.executeJavaScript(`(async () => {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                const before = await window.novelDesktop.chapters.list()
                const button = document.querySelector('[data-testid="promote-idea-summary"]')
                if (!button || button.disabled) return { ok: false, step: 'summary-action-missing' }
                button.click()
                for (let attempt = 0; attempt < 60; attempt++) {
                  const ideas = await window.novelDesktop.workspace.listIdeas()
                  if (ideas.some((idea) => idea.promotedToType === 'summary')) break
                  await wait(100)
                }
                const total = await window.novelDesktop.outlines.get('total')
                await wait(200)
                document.querySelector('[aria-label="谋篇"]')?.click()
                await wait(200)
                const root = [...document.querySelectorAll('.tree-item')].find((item) => item.textContent.includes('全局总纲'))
                root?.click()
                let visible = false
                for (let attempt = 0; attempt < 60; attempt++) {
                  const editor = document.querySelector('[aria-label="全局总纲正文"]')
                  visible = editor?.textContent === total.content && editor.getBoundingClientRect().height > 100
                  if (visible) break
                  await wait(100)
                }
                return { ok: total.content.includes('男主为了掩饰尴尬') && visible
                  && JSON.stringify(before) === JSON.stringify(await window.novelDesktop.chapters.list()), step: 'summary-visible-with-manuscript-unchanged',
                  total: total.content, visible,
                  unchanged: JSON.stringify(before) === JSON.stringify(await window.novelDesktop.chapters.list()) }
              })()`)
              console.info(`[desktop smoke] idea to summary: ${JSON.stringify(summaryScene)}`)
              if (ideaCapturePath) await writeFile(ideaCapturePath.replace('idea-to-world-rule.png', 'idea-to-summary.png'), (await window.capturePage()).toPNG())
              if (!summaryScene.ok) return app.exit(1)
              const originalSummary = await window.webContents.executeJavaScript('window.novelDesktop.outlines.get("total").then(value => value.content)')
              await window.webContents.executeJavaScript('document.querySelector("[aria-label=\\\"全局总纲正文\\\"]").focus()')
              const editorKey = async (keyCode: string, modifiers: Array<'control'> = ['control']) => {
                window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
                window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
                await new Promise((resolve) => setTimeout(resolve, 150))
              }
              await editorKey('End')
              await window.webContents.insertText('统一编辑器键盘验收。')
              await new Promise((resolve) => setTimeout(resolve, 150))
              await editorKey('z')
              const undone = await window.webContents.executeJavaScript('document.querySelector("[aria-label=\\\"全局总纲正文\\\"]").textContent')
              if (undone !== originalSummary) return app.exit(1)
              await editorKey('y')
              await editorKey('s')
              const savedSummary = await window.webContents.executeJavaScript('window.novelDesktop.outlines.get("total").then(value => value.content)')
              if (savedSummary !== originalSummary + '统一编辑器键盘验收。') return app.exit(1)
              await editorKey('f')
              if (!(await window.webContents.executeJavaScript('Boolean(document.querySelector(".cm-search"))'))) return app.exit(1)
              await editorKey('Escape', [])
              console.info('[desktop smoke] shared editor native typing/undo/redo/save/search: passed')
              if (ideaCapturePath) await writeFile(ideaCapturePath.replace('idea-to-world-rule.png', 'shared-planning-editor.png'), (await window.capturePage()).toPNG())
            }
            return app.exit(0)
          }
          if (process.env.LANJIAN_SMOKE_FOUNDATION_SQLITE_ONLY === '1') {
            const expectedNotes = 'SQLite 正式作者札记：雨夜来信必须在旧城钟楼形成下一阶段转折。'
            const foundationScene = await window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                document.querySelector('[aria-label="素材"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="foundation-notes-input"]'); index += 1) await wait(100)
                const input = document.querySelector('[data-testid="foundation-notes-input"]')
                const save = document.querySelector('[data-testid="save-foundation-notes"]')
                if (!input || !save) return { ok: false, step: 'foundation-editor-missing', input: Boolean(input), save: Boolean(save) }
                input.value = ${JSON.stringify('SQLite 正式作者札记：雨夜来信必须在旧城钟楼形成下一阶段转折。')}
                input.dispatchEvent(new Event('input', { bubbles: true }))
                save.click()
                let foundation = null
                for (let index = 0; index < 80; index += 1) {
                  foundation = await window.novelDesktop.workspace.getFoundation()
                  if (foundation.sourceNotes === ${JSON.stringify('SQLite 正式作者札记：雨夜来信必须在旧城钟楼形成下一阶段转折。')}) break
                  await wait(100)
                }
                return {
                  ok: foundation?.sourceNotes === ${JSON.stringify('SQLite 正式作者札记：雨夜来信必须在旧城钟楼形成下一阶段转折。')},
                  step: 'foundation-ui-saved',
                  foundation,
                  visible: input.getBoundingClientRect().height > 120,
                  status: document.body.textContent.includes('作者札记已保存')
                }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
            const workItemRoot = process.env.LANJIAN_SMOKE_PROJECT_PATH || ''
            const smokeFoundationService = new SqliteManuscriptService(new SqliteWorkspaceDatabaseFactory())
            const foundationMirrorPath = join(workItemRoot, '.webnovel', 'config', 'foundation.json')
            let mirrorBefore: Record<string, unknown> | null = null
            for (let index = 0; index < 80; index += 1) {
              mirrorBefore = await readFile(foundationMirrorPath, 'utf8').then((value) => JSON.parse(value) as Record<string, unknown>).catch(() => null)
              if (mirrorBefore?.sourceNotes === expectedNotes) break
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
            const formalFoundation = await smokeFoundationService.foundationConfig(workItemRoot).catch(() => null)
            if (!foundationScene.ok || formalFoundation?.sourceNotes !== expectedNotes || mirrorBefore?.sourceNotes !== expectedNotes) {
              console.error(`[desktop smoke] SQLite foundation save failed: ${JSON.stringify({ foundationScene, formalFoundation, mirrorBefore })}`)
              return app.exit(1)
            }
            await unlink(foundationMirrorPath)
            const rebuilt = await smokeFoundationService.rebuildReadableMirrors(workItemRoot)
            const mirrorAfter = await readFile(foundationMirrorPath, 'utf8').then((value) => JSON.parse(value)).catch(() => null)
            if (rebuilt.recreated < 1 || mirrorAfter?.sourceNotes !== expectedNotes) {
              console.error(`[desktop smoke] SQLite foundation mirror rebuild failed: ${JSON.stringify({ rebuilt, mirrorAfter })}`)
              return app.exit(1)
            }
            const foundationCapturePath = process.env.LANJIAN_FOUNDATION_SQLITE_CAPTURE_PATH
            if (foundationCapturePath) await writeFile(foundationCapturePath, (await window.capturePage()).toPNG())
            console.info(`[desktop smoke] SQLite foundation authority passed: ${JSON.stringify({ foundationScene, formalFoundation, rebuilt })}`)
            return app.exit(0)
          }
          if (process.env.LANJIAN_SMOKE_COMPACT_IMPORT_RECOVERY_ONLY === '1') {
            const compactRecoveryScene = await window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                document.querySelector('[data-activity="desk"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="import-recovery"]'); index += 1) await wait(100)
                const recovery = document.querySelector('[data-testid="import-recovery"]')
                const summary = document.querySelector('[data-testid="import-recovery-summary"]')
                const explorer = document.querySelector('.explorer')
                const chapterRow = document.querySelector('.chapter-tree-row')
                if (!recovery || !summary || !explorer || !chapterRow) return {
                  ok: false, step: 'compact-recovery-missing', recovery: Boolean(recovery), summary: Boolean(summary), explorer: Boolean(explorer), chapterRow: Boolean(chapterRow)
                }
                const collapsed = recovery.getBoundingClientRect()
                const chapterBefore = chapterRow.getBoundingClientRect()
                if (recovery.open || collapsed.height > 72) return { ok: false, step: 'compact-recovery-default', open: recovery.open, collapsedHeight: collapsed.height }
                summary.click()
                await wait(180)
                const expanded = recovery.getBoundingClientRect()
                const resume = recovery.querySelector('[data-testid="resume-import-manifest"]')
                const detail = recovery.querySelector('.recovery-detail')
                const detailsReadable = recovery.textContent.includes('已完成正文.txt') && recovery.textContent.includes('待恢复外部参考.txt')
                if (!recovery.open || !resume || !detail || !detailsReadable || expanded.height > 300) return {
                  ok: false, step: 'compact-recovery-expanded', open: recovery.open, expandedHeight: expanded.height, resume: Boolean(resume), detail: Boolean(detail), detailsReadable
                }
                summary.click()
                await wait(180)
                const finalRect = recovery.getBoundingClientRect()
                const explorerRect = explorer.getBoundingClientRect()
                const finalChapterRect = chapterRow.getBoundingClientRect()
                return {
                  ok: !recovery.open && finalRect.height <= 72 && finalChapterRect.top < explorerRect.bottom,
                  step: 'compact-recovery-verified',
                  collapsedHeight: finalRect.height,
                  expandedHeight: expanded.height,
                  explorer: { width: explorerRect.width, height: explorerRect.height },
                  chapterTopBefore: chapterBefore.top,
                  chapterTopAfter: finalChapterRect.top,
                  chapterVisible: finalChapterRect.top < explorerRect.bottom,
                  label: summary.textContent.trim()
                }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
            if (!compactRecoveryScene.ok) {
              console.error(`[desktop smoke] compact import recovery failed: ${JSON.stringify(compactRecoveryScene)}`)
              return app.exit(1)
            }
            const compactRecoveryCapturePath = process.env.LANJIAN_COMPACT_IMPORT_RECOVERY_CAPTURE_PATH
            if (compactRecoveryCapturePath) await writeFile(compactRecoveryCapturePath, (await window.capturePage()).toPNG())
            console.info(`[desktop smoke] compact import recovery passed: ${JSON.stringify(compactRecoveryScene)}`)
            return app.exit(0)
          }
          if (process.env.LANJIAN_SMOKE_OFFLINE_MANUAL_ONLY === '1') {
            const offlineText = '模型不可用时，作者仍然可以继续手写，并把这一段可靠地保存到本地。'
            const formattedOfflineText = `　　${offlineText}`
            const writeScene = await window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                const settings = await window.novelDesktop.ai.getSettings()
                if (settings.apiKeyConfigured) return { ok: false, step: 'model-unexpectedly-configured' }
                const forbiddenGlobals = {
                  require: typeof window.require,
                  process: typeof window.process,
                  Buffer: typeof window.Buffer
                }
                const exposed = []
                for (const [group, value] of Object.entries(window.novelDesktop || {})) {
                  for (const key of Object.keys(value || {})) exposed.push(group + '.' + key)
                }
                const forbiddenBridgeMethods = exposed.filter((name) => /(?:^|\.)(?:readFile|writeFile|unlink|removeFile|query|executeSql|rawSql|database|openDatabase|fs)$/i.test(name))
                document.querySelector('[data-activity="desk"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="manuscript-input"]'); index += 1) await wait(100)
                const editor = document.querySelector('[data-testid="manuscript-input"]')
                const save = document.querySelector('[data-testid="save-manuscript"]')
                if (!editor || !save) return { ok: false, step: 'editor-missing', forbiddenGlobals, forbiddenBridgeMethods }
                editor.focus()
                document.execCommand('selectAll')
                document.execCommand('insertText', false, ${JSON.stringify('模型不可用时，作者仍然可以继续手写，并把这一段可靠地保存到本地。')})
                await wait(300)
                save.click()
                let chapter = null
                for (let index = 0; index < 80; index += 1) {
                  chapter = await window.novelDesktop.chapters.get(1)
                  if (chapter.content === ${JSON.stringify('　　模型不可用时，作者仍然可以继续手写，并把这一段可靠地保存到本地。')}) break
                  await wait(100)
                }
                return {
                  ok: chapter?.content === ${JSON.stringify('　　模型不可用时，作者仍然可以继续手写，并把这一段可靠地保存到本地。')}
                    && chapter.storageMode === 'sqlite'
                    && Object.values(forbiddenGlobals).every((value) => value === 'undefined')
                    && forbiddenBridgeMethods.length === 0,
                  step: 'offline-manual-save', chapterStorageMode: chapter?.storageMode, chapterContent: chapter?.content || '',
                  forbiddenGlobals, forbiddenBridgeMethods, exposedCount: exposed.length,
                  status: document.querySelector('footer.statusbar')?.textContent || ''
                }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
            if (!writeScene.ok || !String(writeScene.status || '').includes('模型未配置')) {
              console.error(`[desktop smoke] offline manual save failed: ${JSON.stringify(writeScene)}`)
              return app.exit(1)
            }
            console.info(`[desktop smoke] offline manual save passed: ${JSON.stringify(writeScene)}`)
            const reloaded = await new Promise<boolean>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('重新加载写作界面超时')), 15_000)
              window.webContents.once('did-finish-load', () => {
                clearTimeout(timeout)
                resolve(true)
              })
              window.webContents.reload()
            }).catch((error) => {
              console.error(`[desktop smoke] offline renderer reload failed: ${error instanceof Error ? error.message : String(error)}`)
              return false
            })
            if (!reloaded) return app.exit(1)
            if (window.isDestroyed()) return
            await new Promise((resolve) => setTimeout(resolve, 800))
            console.info('[desktop smoke] offline renderer reloaded')
            const recoveredScene = await window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                let projectStatus = null
                for (let index = 0; index < 100; index += 1) {
                  if (window.novelDesktop) projectStatus = await window.novelDesktop.projects.status().catch(() => null)
                  if (projectStatus?.project?.title === '烟测书稿' && (document.querySelector('[data-activity="desk"]') || document.querySelector('.work-item-open'))) break
                  await wait(100)
                }
                if (!document.querySelector('[data-activity="desk"]')) {
                  const workItem = Array.from(document.querySelectorAll('.work-item-open')).find((button) => button.getAttribute('aria-label')?.includes('烟测书稿'))
                  workItem?.click()
                  for (let index = 0; index < 100 && !document.querySelector('[data-activity="desk"]'); index += 1) await wait(100)
                }
                const manuscriptNav = document.querySelector('[data-activity="desk"]')
                if (!manuscriptNav) return {
                  ok: false,
                  step: 'navigation-not-restored',
                  projectStatus,
                  bodyText: document.body?.textContent?.slice(0, 1600) || '',
                  bodyHtml: document.body?.innerHTML?.slice(0, 1600) || '',
                  location: location.href
                }
                manuscriptNav.click()
                let rowClicked = false
                for (let index = 0; index < 100 && !document.querySelector('[data-testid="manuscript-input"]'); index += 1) {
                  const row = document.querySelector('.chapter-tree-row[type="button"]')
                  if (row && !rowClicked) {
                    row.click()
                    rowClicked = true
                  }
                  await wait(100)
                }
                const editor = document.querySelector('[data-testid="manuscript-input"]')
                const chapter = await window.novelDesktop.chapters.get(1)
                const settings = await window.novelDesktop.ai.getSettings()
                for (let index = 0; index < 40 && document.querySelector('.opening-screen'); index += 1) await wait(100)
                const editorRect = editor?.getBoundingClientRect()
                const editorText = Array.from(editor?.querySelectorAll('.cm-line') || []).map((line) => line.textContent || '').join('\\n')
                return {
                  ok: editorText === ${JSON.stringify('　　模型不可用时，作者仍然可以继续手写，并把这一段可靠地保存到本地。')}
                    && chapter.content === ${JSON.stringify('　　模型不可用时，作者仍然可以继续手写，并把这一段可靠地保存到本地。')}
                    && chapter.storageMode === 'sqlite'
                    && !settings.apiKeyConfigured
                    && typeof window.require === 'undefined'
                    && typeof window.process === 'undefined'
                    && typeof window.Buffer === 'undefined'
                    && !document.querySelector('.opening-screen')
                    && Boolean(editorRect && editorRect.width >= 560 && editorRect.height >= 320 && editorRect.top >= 0 && editorRect.bottom <= innerHeight),
                  step: 'offline-reloaded', editor: editorText, chapterStorageMode: chapter.storageMode, projectStatus,
                  status: document.querySelector('footer.statusbar')?.textContent || '',
                  layout: editorRect && { left: editorRect.left, top: editorRect.top, right: editorRect.right, bottom: editorRect.bottom, width: editorRect.width, height: editorRect.height },
                  openingVisible: Boolean(document.querySelector('.opening-screen'))
                }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`).catch((error: unknown) => ({
              ok: false,
              step: 'recovery-script-rejected',
              error: error instanceof Error ? error.message : String(error)
            }))
            if (!recoveredScene.ok || !String(recoveredScene.status || '').includes('模型未配置')) {
              console.error(`[desktop smoke] offline manual recovery failed: ${JSON.stringify({ writeScene, recoveredScene })}`)
              return app.exit(1)
            }
            const offlineCapturePath = process.env.LANJIAN_OFFLINE_MANUAL_CAPTURE_PATH
            if (offlineCapturePath) await writeFile(offlineCapturePath, (await window.capturePage()).toPNG())
            console.info(`[desktop smoke] offline manual recovery passed: ${JSON.stringify({ writeScene, recoveredScene, characters: offlineText.length, formattedCharacters: formattedOfflineText.length })}`)
            return app.exit(0)
          }
          if (process.env.LANJIAN_SMOKE_SELECTION_SKILLS_ONLY === '1') {
            const result = await window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                document.querySelector('[data-activity="desk"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="manuscript-input"]'); index += 1) await wait(100)
                const editor = document.querySelector('[data-testid="manuscript-input"]')
                if (!editor) return { ok: false, step: 'editor-missing' }
                const draft = '他说这句话的时候，先解释了一遍，又换个说法解释了一遍。'
                editor.focus()
                editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: draft }))
                editor.value = draft
                editor.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(260)
                const start = editor.value.indexOf('他说')
                editor.setSelectionRange(start, editor.value.length)
                editor.dispatchEvent(new Event('select', { bubbles: true }))
                if (!document.querySelector('.assistant-panel')) document.querySelector('[aria-controls="assistant-drawer"]')?.click()
                for (let index = 0; index < 40 && !document.querySelector('[data-testid="assistant-mode-agent"]'); index += 1) await wait(100)
                document.querySelector('[data-testid="assistant-mode-agent"]')?.click()
                document.querySelector('[data-testid="open-agent-skills"]')?.click()
                await wait(100)
                const menu = document.querySelector('[data-testid="agent-skills-view"]')
                const labels = Array.from(menu?.querySelectorAll('button') || []).map((item) => item.textContent || '')
                const expand = Array.from(menu?.querySelectorAll('button') || []).find((item) => item.textContent?.includes('扩写'))
                const compress = Array.from(menu?.querySelectorAll('button') || []).find((item) => item.textContent?.includes('压缩'))
                const custom = Array.from(menu?.querySelectorAll('button') || []).find((item) => item.textContent?.includes('自定义'))
                const menuRect = menu?.getBoundingClientRect()
                if (!expand || !compress || !custom) return { ok: false, step: 'selection-skills-missing', labels }
                if (menuRect && (menuRect.top < 0 || menuRect.bottom > window.innerHeight)) return { ok: false, step: 'selection-skills-overflow', labels, menuRect: { top: menuRect.top, bottom: menuRect.bottom, height: menuRect.height } }
                custom.click()
                await wait(100)
                const selectionState = document.querySelector('.agent-selection-state')
                const selectedSkill = document.querySelector('.agent-mounted-skill')
                const sidebar = document.querySelector('[data-testid="assistant-sidebar"]')
                const editorRect = document.querySelector('.manuscript-page')?.getBoundingClientRect()
                return {
                  ok: Boolean(selectionState?.textContent?.includes('已选中正文')
                    && selectedSkill?.textContent?.includes('自定义')
                    && sidebar?.getAttribute('data-layout') === 'sidebar'
                    && editorRect && editorRect.width >= 700),
                  step: 'selection-writing-skills',
                  labels,
                  selectionState: selectionState?.textContent || '',
                  selectedSkill: selectedSkill?.textContent || '',
                  editorWidth: editorRect?.width || 0,
                  menuHeight: menuRect?.height || 0
                }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
            if (!result.ok) {
              console.error(`[desktop smoke] selection writing skills failed: ${JSON.stringify(result)}`)
              return app.exit(1)
            }
            const capturePath = process.env.LANJIAN_SELECTION_SKILLS_CAPTURE_PATH
            if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
            console.info(`[desktop smoke] selection writing skills passed: ${JSON.stringify(result)}`)
            return app.exit(0)
          }
          if (process.env.LANJIAN_SMOKE_MANUSCRIPT_METRICS_ONLY === '1') {
            const result = await window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                document.querySelector('[data-activity="desk"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="manuscript-input"]'); index += 1) await wait(100)
                const editor = document.querySelector('[data-testid="manuscript-input"]')
                if (!editor) return { ok: false, step: 'editor-missing' }
                const draft = '陈景安与 AI-2 在雨夜写作。'
                const selectedText = '陈景安与 AI-2'
                editor.focus()
                editor.setSelectionRange(0, 0)
                editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: draft }))
                editor.value = draft
                editor.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(260)
                const selectionStart = editor.value.indexOf(selectedText)
                editor.setSelectionRange(selectionStart, selectionStart + selectedText.length)
                editor.dispatchEvent(new Event('select', { bubbles: true }))
                for (let index = 0; index < 20 && !document.querySelector('[data-testid="manuscript-selection-word-count"]'); index += 1) await wait(80)
                const chapters = await window.novelDesktop.chapters.list()
                const selected = chapters.find((item) => item.id === 1)
                const persistedTotal = chapters.reduce((sum, item) => sum + (item.word_count || 0), 0)
                const expectedProjectWords = persistedTotal - (selected?.word_count || 0) + 11
                const chapterMetric = document.querySelector('.manuscript-metrics')
                const selectionMetric = document.querySelector('[data-testid="manuscript-selection-word-count"]')
                const projectMetric = document.querySelector('[data-testid="manuscript-project-word-count"]')
                const footer = document.querySelector('.editor-foot')
                return {
                  ok: Boolean(chapterMetric?.textContent?.includes('本章 11 字')
                    && selectionMetric?.textContent?.includes('选区 6 字')
                    && projectMetric?.textContent?.includes('全书 ' + expectedProjectWords.toLocaleString('zh-CN') + ' 字')
                    && footer && footer.scrollWidth <= footer.clientWidth),
                  step: 'live-manuscript-metrics',
                  chapter: chapterMetric?.textContent || '',
                  selection: selectionMetric?.textContent || '',
                  project: projectMetric?.textContent || '',
                  expectedProjectWords,
                  layout: footer ? { width: footer.clientWidth, scrollWidth: footer.scrollWidth } : null
                }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
            if (!result.ok) {
              console.error(`[desktop smoke] manuscript live metrics failed: ${JSON.stringify(result)}`)
              return app.exit(1)
            }
            const capturePath = process.env.LANJIAN_MANUSCRIPT_METRICS_CAPTURE_PATH
            if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
            console.info(`[desktop smoke] manuscript live metrics passed: ${JSON.stringify(result)}`)
            return app.exit(0)
          }
          if (process.env.LANJIAN_SMOKE_UNDO_REDO_ONLY === '1') {
            const result = await window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                document.querySelector('[data-activity="desk"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="manuscript-input"]'); index += 1) await wait(100)
                const editor = document.querySelector('[data-testid="manuscript-input"]')
                const undo = document.querySelector('[data-testid="manuscript-undo"]')
                const redo = document.querySelector('[data-testid="manuscript-redo"]')
                if (!editor || !undo || !redo) return { ok: false, step: 'history-controls-missing' }
                const baseline = editor.value
                const addition = '撤销重做桌面验收。'
                editor.focus()
                editor.setSelectionRange(baseline.length, baseline.length)
                editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: addition }))
                editor.value = baseline + addition
                editor.setSelectionRange(editor.value.length, editor.value.length)
                editor.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(180)
                if (undo.disabled || !redo.disabled) return { ok: false, step: 'history-state-after-input', undoDisabled: undo.disabled, redoDisabled: redo.disabled }
                undo.click()
                await wait(180)
                const undone = editor.value === baseline && undo.disabled && !redo.disabled
                if (!undone) return { ok: false, step: 'undo-failed', value: editor.value, undoDisabled: undo.disabled, redoDisabled: redo.disabled }
                return { ok: true, step: 'undo-ready-for-capture', baseline, addition }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
            if (!result.ok) {
              console.error(`[desktop smoke] manuscript undo failed: ${JSON.stringify(result)}`)
              return app.exit(1)
            }
            const capturePath = process.env.LANJIAN_MANUSCRIPT_UNDO_REDO_CAPTURE_PATH
            if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
            const redoResult = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const editor = document.querySelector('[data-testid="manuscript-input"]')
              const undo = document.querySelector('[data-testid="manuscript-undo"]')
              const redo = document.querySelector('[data-testid="manuscript-redo"]')
              redo?.click()
              for (let index = 0; index < 50; index += 1) {
                const checkpoints = await window.novelDesktop.chapters.autosaveRecoveries()
                const checkpoint = checkpoints.find((item) => item.chapterId === 1 && item.content.endsWith('撤销重做桌面验收。'))
                if (checkpoint) {
                  return { ok: Boolean(editor?.value.endsWith('撤销重做桌面验收。') && !undo?.disabled && redo?.disabled), step: 'redo-staged-in-sqlite', checkpoint }
                }
                await wait(120)
              }
              return { ok: false, step: 'redo-autosave-timeout', value: editor?.value || '', undoDisabled: undo?.disabled, redoDisabled: redo?.disabled }
            })()`)
            if (!redoResult.ok) {
              console.error(`[desktop smoke] manuscript redo failed: ${JSON.stringify(redoResult)}`)
              return app.exit(1)
            }
            console.info(`[desktop smoke] manuscript undo/redo passed: ${JSON.stringify(redoResult)}`)
            return app.exit(0)
          }
          if (process.env.LANJIAN_SMOKE_MIRROR_REBUILD_ONLY === '1') {
            const workItemRoot = process.env.LANJIAN_SMOKE_PROJECT_PATH || ''
            if (!workItemRoot) return app.exit(1)
            const chapterMirrorPath = join(workItemRoot, '正文', '第1章-雨夜追迹.md')
            const orderMirrorPath = join(workItemRoot, '.webnovel', 'manuscript', 'chapter-order.json')
            await Promise.all([unlink(chapterMirrorPath), unlink(orderMirrorPath)])
            const result = await window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                document.querySelector('[aria-label="设置"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="settings-nav-project"]'); index += 1) await wait(100)
                document.querySelector('[data-testid="settings-nav-project"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="rebuild-readable-mirrors"]'); index += 1) await wait(100)
                const action = document.querySelector('[data-testid="rebuild-readable-mirrors"]')
                if (!action) return { ok: false, step: 'rebuild-action-missing' }
                action.scrollIntoView({ block: 'center' })
                action.click()
                for (let index = 0; index < 80 && !document.body.textContent?.includes('可读副本已核对：重建 2 项'); index += 1) await wait(100)
                const rect = action.getBoundingClientRect()
                const formalChapter = await window.novelDesktop.chapters.get(1)
                return {
                  ok: Boolean(document.body.textContent?.includes('可读副本已核对：重建 2 项') && rect.width >= 100 && rect.bottom <= innerHeight),
                  step: 'readable-mirror-rebuild-only',
                  formalContent: formalChapter.content,
                  text: document.querySelector('[data-testid="settings-page-project"]')?.textContent?.slice(0, 1200) || '',
                  layout: { width: rect.width, top: rect.top, bottom: rect.bottom }
                }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
            const [chapterMirror, orderMirror] = await Promise.all([
              readFile(chapterMirrorPath, 'utf8').catch(() => null),
              readFile(orderMirrorPath, 'utf8').catch(() => null)
            ])
            const persisted = chapterMirror !== null && orderMirror !== null
              && chapterMirror === result.formalContent
              && JSON.parse(orderMirror).chapterIds?.[0] === 1
            if (!result.ok || !persisted) {
              console.error(`[desktop smoke] focused readable mirror rebuild failed: ${JSON.stringify({ result, persisted, chapterMirror, orderMirror })}`)
              return app.exit(1)
            }
            const capturePath = process.env.LANJIAN_READABLE_MIRROR_CAPTURE_PATH
            if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
            console.info(`[desktop smoke] focused readable mirror rebuild passed: ${JSON.stringify({ ...result, persisted })}`)
            return app.exit(0)
          }
          if (process.env.LANJIAN_SMOKE_NAMED_VERSION_ONLY === '1') {
            const result = await runNamedVersionScenario({ window })
            if (!result.ok) {
              console.error(`[desktop smoke] focused named version failed: ${JSON.stringify(result)}`)
              return app.exit(1)
            }
            const revisionCapturePath = process.env.LANJIAN_REVISION_CAPTURE_PATH
            if (revisionCapturePath) await writeFile(revisionCapturePath, (await window.capturePage()).toPNG())
            console.info(`[desktop smoke] focused named version passed: ${JSON.stringify(result)}`)
            return app.exit(0)
          }
          if (process.env.LANJIAN_SMOKE_AUTO_BACKUP_ONLY === '1') {
            const result = await window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                document.querySelector('[aria-label="设置"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="settings-nav-project"]'); index += 1) await wait(100)
                document.querySelector('[data-testid="settings-nav-project"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="auto-backup-card"]'); index += 1) await wait(100)
                const card = document.querySelector('[data-testid="auto-backup-card"]')
                const enabled = document.querySelector('[data-testid="auto-backup-enabled"]')
                const retention = document.querySelector('[data-testid="auto-backup-retention"]')
                let choose = document.querySelector('[data-testid="choose-auto-backup-directory"]')
                let save = document.querySelector('[data-testid="save-auto-backup"]')
                if (!card || !enabled || !retention || !choose || !save) return { ok: false, step: 'controls-missing', text: card?.textContent || '' }
                for (let index = 0; index < 60; index += 1) {
                  choose = document.querySelector('[data-testid="choose-auto-backup-directory"]')
                  save = document.querySelector('[data-testid="save-auto-backup"]')
                  if (choose && save && !choose.disabled && !save.disabled) break
                  await wait(100)
                }
                if (!choose || !save || choose.disabled || save.disabled) return { ok: false, step: 'controls-disabled' }
                choose.click()
                for (let index = 0; index < 40 && card.textContent?.includes('尚未选择'); index += 1) await wait(100)
                if (!enabled.checked) enabled.click()
                retention.value = '2'
                retention.dispatchEvent(new Event('input', { bubbles: true }))
                retention.dispatchEvent(new Event('change', { bubbles: true }))
                save.click()
                let status = null
                for (let index = 0; index < 120; index += 1) {
                  status = await window.novelDesktop.projects.getAutoBackup()
                  if (status.lastSuccessAt && status.lastResult?.backupPath) break
                  if (status.state === 'failed') return { ok: false, step: 'backup-failed', status, text: card.textContent || '' }
                  await wait(100)
                }
                const chapter = await window.novelDesktop.chapters.get(1)
                card.scrollIntoView({ block: 'center' })
                await wait(120)
                const rect = card.getBoundingClientRect()
                return {
                  ok: Boolean(status?.enabled && status.retentionCount === 2 && status.lastResult?.verified && chapter.storageMode === 'sqlite' && rect.width >= 560),
                  step: 'automatic-backup-only', status, chapterStorageMode: chapter.storageMode,
                  text: card.textContent || '', layout: { width: rect.width, height: rect.height }
                }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
            if (!result.ok) {
              console.error(`[desktop smoke] focused automatic backup failed: ${JSON.stringify(result)}`)
              return app.exit(1)
            }
            const autoBackupCapturePath = process.env.LANJIAN_AUTO_BACKUP_CAPTURE_PATH
            if (autoBackupCapturePath) await writeFile(autoBackupCapturePath, (await window.capturePage()).toPNG())
            console.info(`[desktop smoke] focused automatic backup passed: ${JSON.stringify(result)}`)
            return app.exit(0)
          }
          if (process.env.LANJIAN_SMOKE_MANUSCRIPT_EXPORT_ONLY === '1') {
            const scene = await window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                document.querySelector('[aria-label="设置"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="settings-nav-project"]'); index += 1) await wait(100)
                document.querySelector('[data-testid="settings-nav-project"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="manuscript-export-card"]'); index += 1) await wait(100)
                const card = document.querySelector('[data-testid="manuscript-export-card"]')
                const button = document.querySelector('[data-testid="export-manuscript"]')
                if (!card || !button) return { ok: false, step: 'controls-missing' }
                card.scrollIntoView({ block: 'center' })
                await wait(120)
                for (let index = 0; index < 30 && button.disabled; index += 1) await wait(100)
                if (button.disabled) return { ok: false, step: 'button-disabled', text: card.textContent || '' }
                button.click()
                let toast = ''
                for (let index = 0; index < 60; index += 1) {
                  toast = document.querySelector('.toast')?.textContent || ''
                  if (toast.includes('整书阅读稿已导出')) break
                  await wait(100)
                }
                card.scrollIntoView({ block: 'center' })
                await wait(180)
                const rect = card.getBoundingClientRect()
                const settingsMain = document.querySelector('.settings-page')?.getBoundingClientRect()
                return {
                  ok: toast.includes('整书阅读稿已导出') && rect.width >= 560 && rect.top >= 40 && rect.bottom <= innerHeight - 40 && Boolean(settingsMain && rect.left >= settingsMain.left && rect.right <= settingsMain.right + 1),
                  step: 'export-settings', toast, text: card.textContent || '',
                  layout: { card: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }, viewport: { width: innerWidth, height: innerHeight }, settingsMain: settingsMain && { left: settingsMain.left, right: settingsMain.right, width: settingsMain.width } }
                }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
            const exportTarget = process.env.LANJIAN_SMOKE_MANUSCRIPT_EXPORT_PATH
            let exported = ''
            for (let index = 0; index < 60 && !exported; index += 1) {
              if (exportTarget) exported = await readFile(exportTarget, 'utf8').catch(() => '')
              if (!exported) await new Promise((resolve) => setTimeout(resolve, 100))
            }
            const firstHeading = exported.indexOf('## 第1章　雨夜追迹')
            const secondHeading = exported.indexOf('## 第2章　待删旧章')
            const contentOk = exported.startsWith('# 烟测书稿\n\n')
              && firstHeading >= 0
              && secondHeading > firstHeading
              && (exported.match(/^## /gm) || []).length === 2
              && !exported.includes('.webnovel')
              && !exported.includes('apiKey')
              && !exported.includes('Writing Agent')
            if (!scene.ok || !contentOk) {
              console.error(`[desktop smoke] manuscript export failed: ${JSON.stringify({ scene, contentPreview: exported.slice(0, 600) })}`)
              return app.exit(1)
            }
            const exportCapturePath = process.env.LANJIAN_MANUSCRIPT_EXPORT_CAPTURE_PATH
            if (exportCapturePath) await writeFile(exportCapturePath, (await window.capturePage()).toPNG())
            console.info(`[desktop smoke] manuscript export passed: ${JSON.stringify({ scene, exportedCharacters: exported.length })}`)
            return app.exit(0)
          }
          let sqliteStorageScene: { ok: boolean; step: string; [key: string]: unknown }
          try {
            sqliteStorageScene = await window.webContents.executeJavaScript(`(async () => {
            let currentStep = 'chapter-read'
            try {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            const bounded = (promise, step) => Promise.race([promise, wait(10000).then(() => { throw new Error('烟测等待超时：' + step) })])
            const formalChapter = await bounded(window.novelDesktop.chapters.get(1), currentStep)
            currentStep = 'outline-read-before'
            const before = await bounded(window.novelDesktop.outlines.get('total'), currentStep)
            const content = before.content + '\\n\\nSQLite 正式大纲烟测。'
            currentStep = 'outline-update'
            const saved = await bounded(window.novelDesktop.outlines.update('total', content), currentStep)
            currentStep = 'outline-read-after'
            const after = await bounded(window.novelDesktop.outlines.get('total'), currentStep)
            currentStep = 'storage-status'
            const storageStatus = await bounded(window.novelDesktop.projects.sqliteStorageStatus(), currentStep)
            currentStep = 'outline-ui'
            document.querySelector('.activitybar [data-activity="outline"]')?.click()
            for (let index = 0; index < 100 && !document.querySelector('.outline-statusbar')?.textContent?.includes('Markdown 已同步'); index += 1) await wait(100)
            const explorer = document.querySelector('.explorer')
            const resizer = document.querySelector('.explorer-resizer')
            const editor = document.querySelector('.outline-editor')
            const explorerRect = explorer?.getBoundingClientRect()
            const resizerRect = resizer?.getBoundingClientRect()
            const editorRect = editor?.getBoundingClientRect()
            const outlineStatusText = document.querySelector('.outline-statusbar')?.textContent || ''
            const uiReady = Boolean(
              explorer?.textContent?.includes('全局总纲')
              && explorerRect && explorerRect.width >= 220
              && resizerRect && resizerRect.width > 0
              && editorRect && editorRect.width >= 420
              && explorerRect.right <= editorRect.left
              && outlineStatusText.includes('SQLite')
              && outlineStatusText.includes('Markdown 已同步')
            )
            return {
              ok: formalChapter.storageMode === 'sqlite'
                && saved.storageMode === 'sqlite'
                && saved.mirrorStatus === 'synced'
                && after.content === content
                && storageStatus.outlineStorageMode === 'sqlite'
                && storageStatus.outlineCount >= 2
                && uiReady,
              step: 'formal-outline-scene',
              saved,
              storageStatus,
              outlineStatusText,
              uiReady,
              layout: {
                explorer: explorerRect && { left: explorerRect.left, right: explorerRect.right, width: explorerRect.width },
                resizer: resizerRect && { left: resizerRect.left, right: resizerRect.right, width: resizerRect.width },
                editor: editorRect && { left: editorRect.left, right: editorRect.right, width: editorRect.width }
              }
            }
            } catch (error) {
              return { ok: false, step: currentStep, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
            }
          })()`)
          } catch (error) {
            console.error(`[desktop smoke] focused SQLite outline script failed: ${error instanceof Error ? error.stack || error.message : String(error)}`)
            return app.exit(1)
          }
          if (!sqliteStorageScene.ok) {
            console.error(`[desktop smoke] focused SQLite outline scene failed: ${JSON.stringify(sqliteStorageScene)}`)
            return app.exit(1)
          }
          console.info('[desktop smoke] storage stage: outline verified')
          const sqliteFormalCapturePath = process.env.LANJIAN_SQLITE_FORMAL_CAPTURE_PATH
          if (sqliteFormalCapturePath) await writeFile(sqliteFormalCapturePath, (await window.capturePage()).toPNG())
          const stageOutlineCapturePath = process.env.LANJIAN_STAGE_OUTLINE_CAPTURE_PATH
          if (stageOutlineCapturePath && process.env.LANJIAN_SMOKE_STAGE_OUTLINE === '1') {
            const stageOutlinePassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const setValue = (element, value) => {
                if (element.isContentEditable) { element.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, value); return }
                element.value = value
                element.dispatchEvent(new Event('input', { bubbles: true }))
              }
              let inspector = document.querySelector('[data-testid="outline-inspector"]')
              if (!inspector || getComputedStyle(inspector).display === 'none') {
                document.querySelector('[data-testid="outline-inspector-toggle"]')?.click()
                for (let index = 0; index < 20 && (!document.querySelector('[data-testid="outline-inspector"]') || getComputedStyle(document.querySelector('[data-testid="outline-inspector"]')).display === 'none'); index += 1) await wait(100)
                inspector = document.querySelector('[data-testid="outline-inspector"]')
              }
              const volumeInput = inspector?.querySelector('#volume-title')
              const volumeSubmit = inspector?.querySelector('.volume-planner form button')
              if (!volumeInput || !volumeSubmit) return { ok: false, step: 'volume-input', inspector: inspector?.textContent || '' }
              setValue(volumeInput, '旧声入梦')
              for (let index = 0; index < 30 && volumeSubmit.disabled; index += 1) await wait(100)
              if (volumeSubmit.disabled) return { ok: false, step: 'volume-submit-disabled' }
              volumeSubmit.click()
              for (let index = 0; index < 30 && !document.querySelector('.volume-strip article'); index += 1) await wait(100)
              document.querySelector('.volume-strip article')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="create-outline-stage"]'); index += 1) await wait(100)
              if (!document.querySelector('[data-testid="create-outline-stage"]')) return { ok: false, step: 'volume-mode' }
              const volumeOutline = document.querySelector('.outline-editor > .plain-text-editor .cm-content')
              if (!volumeOutline) return { ok: false, step: 'volume-editor' }
              setValue(volumeOutline, '本卷目标：沈砚确认异世录音的来历，并决定重新登台。')
              const saveVolume = document.querySelector('[data-testid="save-outline-document"]')
              for (let index = 0; index < 30 && saveVolume?.disabled; index += 1) await wait(100)
              saveVolume?.click()
              for (let index = 0; index < 40 && !(await window.novelDesktop.outlines.list()).volumes.some((item) => item.volume === 1); index += 1) await wait(100)
              if (!(await window.novelDesktop.outlines.list()).volumes.some((item) => item.volume === 1)) return { ok: false, step: 'volume-formal-save' }
              const stageInput = document.querySelector('[aria-label="新阶段名称"]')
              if (!stageInput) return { ok: false, step: 'stage-input', inspector: document.querySelector('[data-testid="outline-inspector"]')?.textContent || '' }
              setValue(stageInput, '旧城追索')
              const createStage = document.querySelector('[data-testid="create-outline-stage"]')
              for (let index = 0; index < 30 && createStage?.disabled; index += 1) await wait(100)
              if (!createStage || createStage.disabled) return { ok: false, step: 'stage-submit-disabled' }
              createStage.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid^="open-stage-"]'); index += 1) await wait(100)
              const stageButton = document.querySelector('[data-testid^="open-stage-"]')
              if (!stageButton || !stageButton.textContent?.includes('旧城追索')) return { ok: false, step: 'stage-tree', text: stageButton?.textContent || '' }
              const stageId = Number(stageButton.getAttribute('data-testid')?.replace('open-stage-', ''))
              stageButton.click()
              for (let index = 0; index < 20 && !document.querySelector('[data-testid="stage-outline-editor"]'); index += 1) await wait(100)
              const editor = document.querySelector('[data-testid="stage-outline-editor"]')
              const stageContent = editor?.querySelector('.cm-content')
              if (!editor || !stageContent) return { ok: false, step: 'stage-editor' }
              setValue(stageContent, '沈砚验证旧录音来源，并在阶段末决定重新登台。')
              await wait(100)
              document.querySelector('[data-testid="save-outline-document"]')?.click()
              let listed = await window.novelDesktop.outlines.list()
              for (let index = 0; index < 40 && !listed.stages?.find((item) => item.stage === stageId)?.content.includes('阶段末决定重新登台'); index += 1) {
                await wait(100)
                listed = await window.novelDesktop.outlines.list()
              }
              const stage = listed.stages?.find((item) => item.stage === stageId)
              return { ok: Boolean(stage?.content.includes('阶段末决定重新登台') && stage.chapterIds.length === 0 && document.querySelector('[data-testid^="open-stage-"]')?.textContent?.includes('0 章')), step: 'stage-editor', stage }
            })()`)
            if (!stageOutlinePassed.ok) {
              console.error(`[desktop smoke] stage outline workbench failed: ${JSON.stringify(stageOutlinePassed)}`)
              return app.exit(1)
            }
            await writeFile(stageOutlineCapturePath, (await window.capturePage()).toPNG())
            return app.exit(0)
          }
          const focusedChapterCardScene = await runFocusedChapterCardSceneScenario({ window })
          if (!focusedChapterCardScene.ok) {
            console.error(`[desktop smoke] focused chapter-card scene failed: ${JSON.stringify(focusedChapterCardScene)}`)
            return app.exit(1)
          }
          console.info('[desktop smoke] storage stage: chapter card verified')
          const chapterCardCapturePath = process.env.LANJIAN_CHAPTER_CARD_CAPTURE_PATH
          if (chapterCardCapturePath) await writeFile(chapterCardCapturePath, (await window.capturePage()).toPNG())
          await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"chapter-card-sheet\"] header > button')?.click()")
          const focusedChapterConfirmationScene = await window.webContents.executeJavaScript(`(async () => {
            try {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              for (let index = 0; index < 60 && !document.querySelector('[data-testid="confirm-current-chapter"]'); index += 1) await wait(100)
              const button = document.querySelector('[data-testid="confirm-current-chapter"]')
              const before = await window.novelDesktop.chapters.getPlanning(2)
              if (!button || !before?.currentBodyVersionId) return { ok: false, step: 'confirmation-entry', before, text: document.body.textContent?.slice(0, 1000) || '' }
              const rectBefore = button.getBoundingClientRect()
              const style = getComputedStyle(button)
              const saveRect = document.querySelector('[data-testid="save-manuscript"]')?.getBoundingClientRect()
              button.click()
              let planning = null
              for (let index = 0; index < 80; index += 1) {
                planning = await window.novelDesktop.chapters.getPlanning(2)
                if (planning?.lifecycleStatus === 'CONFIRMED' && planning.confirmedBodyVersionId) break
                await wait(100)
              }
              const chapter = await window.novelDesktop.chapters.get(2)
              let liveButton = document.querySelector('[data-testid="confirm-current-chapter"]')
              for (let index = 0; index < 40 && (!liveButton?.disabled || !liveButton.textContent?.includes('已确认本章')); index += 1) {
                await wait(100)
                liveButton = document.querySelector('[data-testid="confirm-current-chapter"]')
              }
              return {
                ok: planning?.lifecycleStatus === 'CONFIRMED'
                  && planning.currentBodyVersionId === planning.confirmedBodyVersionId
                  && planning.confirmedBodyVersionId !== before.currentBodyVersionId
                  && chapter.bodyVersionId === planning.confirmedBodyVersionId
                  && liveButton?.disabled
                  && liveButton.textContent?.includes('已确认本章')
                  && style.whiteSpace === 'nowrap'
                  && rectBefore.width > 0
                  && rectBefore.height >= 28
                  && Boolean(saveRect && saveRect.width > 0 && saveRect.height >= 32),
                step: 'confirmation-complete', before, planning,
                chapterBodyVersionId: chapter.bodyVersionId,
                button: { text: liveButton?.textContent || '', disabled: liveButton?.disabled, width: rectBefore.width, height: rectBefore.height, saveHeight: saveRect?.height || null, whiteSpace: style.whiteSpace },
                toast: document.querySelector('.toast')?.textContent || ''
              }
            } catch (error) {
              return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
            }
          })()`)
          if (!focusedChapterConfirmationScene.ok) {
            console.error(`[desktop smoke] focused chapter confirmation scene failed: ${JSON.stringify(focusedChapterConfirmationScene)}`)
            return app.exit(1)
          }
          console.info('[desktop smoke] storage stage: chapter confirmation verified')
          let focusedConfigurationScene: { ok: boolean; step: string; [key: string]: unknown }
          try {
            focusedConfigurationScene = await window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                const setValue = (element, value) => {
                  element.value = value
                  element.dispatchEvent(new Event('input', { bubbles: true }))
                }
                document.querySelector('[data-activity="materials"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-activity="realms"]'); index += 1) await wait(100)
                document.querySelector('[data-activity="realms"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="realm-config-page"]'); index += 1) await wait(100)
                const realmPage = document.querySelector('[data-testid="realm-config-page"]')
                if (!realmPage || document.querySelector('.assistant-panel') || document.querySelector('[aria-label="切换智能助笔侧栏"]')) return { ok: false, step: 'realm-layout' }
                const realmToggle = realmPage.querySelector('.inline-preference input')
                if (!realmToggle.checked) realmToggle.click()
                const overview = realmPage.querySelector('.power-system-overview textarea')
                setValue(overview, '能力来自对城市回声的精确辨认，每次越级都会造成记忆缺损。')
                if (!realmPage.querySelector('.realm-row')) realmPage.querySelector('[data-testid="add-realm-level"]')?.click()
                await wait(60)
                const realmName = realmPage.querySelector('.realm-row input')
                const realmBoundary = realmPage.querySelector('.realm-row textarea')
                setValue(realmName, '听雨境')
                setValue(realmBoundary, '只能辨认十步内的异常回声；突破前不得隔墙定位。')
                document.querySelector('[data-activity="system"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="system-ui-config-page"]'); index += 1) await wait(100)
                const systemPage = document.querySelector('[data-testid="system-ui-config-page"]')
                if (!systemPage || document.querySelector('.assistant-panel') || document.querySelector('[aria-label="切换智能助笔侧栏"]')) return { ok: false, step: 'system-layout' }
                const systemToggle = systemPage.querySelector('.inline-preference input')
                if (!systemToggle.checked) systemToggle.click()
                setValue(systemPage.querySelector('.power-system-overview textarea'), '旧录音只提供一次有限提示，不能代替主角完成选择。')
                const template = '[回声记录]\\n状态：{{status}}\\n线索：{{clue}}\\n代价：{{cost}}'
                setValue(systemPage.querySelector('[aria-label="系统界面模板"]'), template)
                await wait(120)
                const pageRect = systemPage.getBoundingClientRect()
                const previewText = systemPage.querySelector('.system-template-preview pre')?.textContent || ''
                return {
                  ok: realmToggle.checked
                    && systemToggle.checked
                    && realmName.value === '听雨境'
                    && realmBoundary.value.includes('不得隔墙定位')
                    && overview.value.includes('记忆缺损')
                    && systemPage.querySelector('.power-system-overview textarea').value.includes('不能代替主角完成选择')
                    && systemPage.querySelector('[aria-label="系统界面模板"]').value === template
                    && previewText === template
                    && pageRect.width >= 850,
                  step: 'configuration-scene',
                  pageWidth: pageRect.width,
                  previewText
                }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
          } catch (error) {
            console.error(`[desktop smoke] focused configuration script failed: ${error instanceof Error ? error.stack || error.message : String(error)}`)
            return app.exit(1)
          }
          if (!focusedConfigurationScene.ok) {
            console.error(`[desktop smoke] focused configuration scene failed: ${JSON.stringify(focusedConfigurationScene)}`)
            return app.exit(1)
          }
          console.info('[desktop smoke] storage stage: configuration UI verified')
          const focusedConfigurationPersistence = await window.webContents.executeJavaScript(`(async () => {
            try {
              const template = '[回声记录]\\n状态：{{status}}\\n线索：{{clue}}\\n代价：{{cost}}'
              const currentFoundation = await window.novelDesktop.workspace.getFoundation()
              await window.novelDesktop.workspace.saveRealms([{ id: 'realm-smoke', name: '听雨境', description: '只能辨认十步内的异常回声；突破前不得隔墙定位。' }])
              await window.novelDesktop.workspace.savePowerSystem({ overview: '能力来自对城市回声的精确辨认，每次越级都会造成记忆缺损。' })
              await window.novelDesktop.workspace.saveCheatSystem({ overview: '旧录音只提供一次有限提示，不能代替主角完成选择。' })
              await window.novelDesktop.workspace.saveSystemTemplate(template)
              await window.novelDesktop.workspace.saveFoundation({ ...currentFoundation, useRealms: true, useSystem: true })
              const [foundation, realms, powerSystem, cheatSystem, systemTemplate] = await Promise.all([
                window.novelDesktop.workspace.getFoundation(),
                window.novelDesktop.workspace.getRealms(),
                window.novelDesktop.workspace.getPowerSystem(),
                window.novelDesktop.workspace.getCheatSystem(),
                window.novelDesktop.workspace.getSystemTemplate()
              ])
              return {
                ok: foundation.useRealms && foundation.useSystem
                  && realms.levels[0]?.name === '听雨境'
                  && realms.levels[0]?.description.includes('不得隔墙定位')
                  && powerSystem.overview.includes('记忆缺损')
                  && cheatSystem.overview.includes('不能代替主角完成选择')
                  && systemTemplate.template === template,
                foundation,
                realms,
                powerSystem,
                cheatSystem,
                systemTemplate
              }
            } catch (error) {
              return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
            }
          })()`)
          if (!focusedConfigurationPersistence.ok) {
            console.error(`[desktop smoke] focused configuration persistence failed: ${JSON.stringify(focusedConfigurationPersistence)}`)
            return app.exit(1)
          }
          console.info('[desktop smoke] storage stage: configuration persisted')
          const configurationCapturePath = process.env.LANJIAN_CONFIGURATION_CAPTURE_PATH
          if (configurationCapturePath) await writeFile(configurationCapturePath, (await window.capturePage()).toPNG())
          const automaticBackupScene = process.env.LANJIAN_SMOKE_CONTEXT_PREFLIGHT === '1' || process.env.LANJIAN_SMOKE_OFFLINE_FAILURE_ONLY === '1' || process.env.LANJIAN_SMOKE_DERIVATIVE_STALE_ONLY === '1'
            ? { ok: true, step: 'skipped-for-focused-ai' }
            : await runAutomaticBackupSceneScenario({ window })
          if (!automaticBackupScene.ok) {
            console.error(`[desktop smoke] automatic backup scene failed: ${JSON.stringify(automaticBackupScene)}`)
            return app.exit(1)
          }
          console.info(`[desktop smoke] storage stage: automatic backup ${automaticBackupScene.step === 'skipped-for-focused-ai' ? 'skipped for focused AI scene' : 'verified'}`)
          const autoBackupCapturePath = process.env.LANJIAN_AUTO_BACKUP_CAPTURE_PATH
          if (autoBackupCapturePath) await writeFile(autoBackupCapturePath, (await window.capturePage()).toPNG())
          const recoveryCapturePath = process.env.LANJIAN_RECOVERY_CAPTURE_PATH
          if (recoveryCapturePath) {
            const recoveryScene = await window.webContents.executeJavaScript(`(async () => {
              try {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const project = (await window.novelDesktop.projects.list()).projects.find((item) => item.title === '烟测书稿')
              const chapter = await window.novelDesktop.chapters.get(1)
              if (!project || !chapter) return { ok: false, step: 'recovery-seed-prerequisite' }
              localStorage.setItem('lanjian.manuscript-recovery.v1', JSON.stringify({
                version: 1,
                drafts: [{
                  version: 1,
                  workItemId: project.id,
                  chapterId: chapter.id,
                  title: chapter.title,
                  content: chapter.content + '\\n\\n这是异常退出前尚未归档的一段正文。',
                  baseRevision: chapter.revision || null,
                  operationId: '20000000-0000-4000-8000-000000000001',
                  updatedAt: new Date().toISOString()
                }]
              }))
              document.querySelector('.project-switch')?.click()
              for (let index = 0; index < 60 && !document.querySelector('.work-item-open'); index += 1) await wait(100)
              const workItem = Array.from(document.querySelectorAll('.work-item-open')).find((button) => button.getAttribute('aria-label')?.includes('烟测书稿'))
              workItem?.click()
              for (let index = 0; index < 60 && !document.querySelector('[data-testid="manuscript-recovery-dialog"]'); index += 1) await wait(100)
              await wait(400)
              const dialog = document.querySelector('[data-testid="manuscript-recovery-dialog"]')
              const rect = dialog?.getBoundingClientRect()
              const backdrop = dialog?.closest('.recovery-backdrop')
              return {
                ok: Boolean(dialog && dialog.textContent?.includes('发现尚未归档的正文') && dialog.textContent?.includes('本机恢复草稿')),
                step: 'recovery-dialog',
                layout: rect && { left: rect.left, right: rect.right, width: rect.width, top: rect.top, bottom: rect.bottom },
                display: backdrop ? getComputedStyle(backdrop).display : 'missing',
                opacity: dialog ? getComputedStyle(dialog).opacity : 'missing',
                viewport: { width: innerWidth, height: innerHeight }
              }
              } catch (error) {
                return { ok: false, step: 'recovery-exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
            if (!recoveryScene.ok) {
              console.error(`[desktop smoke] recovery dialog failed: ${JSON.stringify(recoveryScene)}`)
              return app.exit(1)
            }
            console.info(`[desktop smoke] recovery dialog ready: ${JSON.stringify(recoveryScene)}`)
            await new Promise((resolve) => setTimeout(resolve, 250))
            await writeFile(recoveryCapturePath, (await window.capturePage()).toPNG())
            const recoveryApplied = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const dialog = document.querySelector('[data-testid="manuscript-recovery-dialog"]')
              const restore = Array.from(dialog?.querySelectorAll('button') || []).find((button) => button.textContent?.includes('恢复为新版本'))
              restore?.click()
              for (let index = 0; index < 60 && document.querySelector('[data-testid="manuscript-recovery-dialog"]'); index += 1) await wait(100)
              const chapter = await window.novelDesktop.chapters.get(1)
              const persisted = localStorage.getItem('lanjian.manuscript-recovery.v1')
              return {
                ok: chapter.content.includes('这是异常退出前尚未归档的一段正文。') && !document.querySelector('[data-testid="manuscript-recovery-dialog"]') && !persisted,
                chapter,
                persisted
              }
            })()`)
            if (!recoveryApplied.ok) {
              console.error(`[desktop smoke] recovery apply failed: ${JSON.stringify(recoveryApplied)}`)
              return app.exit(1)
            }
          }
          const sqliteStorageRollback = process.env.LANJIAN_SMOKE_CONTEXT_PREFLIGHT === '1' || process.env.LANJIAN_SMOKE_OFFLINE_FAILURE_ONLY === '1' || process.env.LANJIAN_SMOKE_DERIVATIVE_STALE_ONLY === '1'
            ? { ok: true, step: 'skipped-for-focused-ai' }
            : await window.webContents.executeJavaScript(`(async () => {
            try {
            const result = await window.novelDesktop.projects.rollbackSqliteStorage()
            const chapter = await window.novelDesktop.chapters.get(1)
            const outline = await window.novelDesktop.outlines.get('total')
            const status = await window.novelDesktop.projects.sqliteStorageStatus()
            return {
              ok: result.verified
                && chapter.storageMode !== 'sqlite'
                && outline.storageMode !== 'sqlite'
                && outline.content.includes('SQLite 正式大纲烟测。')
                && status.storageMode !== 'sqlite'
                && status.outlineStorageMode === 'files',
              result,
              chapterStorageMode: chapter.storageMode,
              outlineStorageMode: outline.storageMode,
              status
            }
            } catch (error) {
              return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
            }
          })()`)
          if (!sqliteStorageRollback.ok) {
            console.error(`[desktop smoke] focused SQLite outline rollback failed: ${JSON.stringify(sqliteStorageRollback)}`)
            return app.exit(1)
          }
          const dockedAssistantScene = await window.webContents.executeJavaScript(`(async () => {
            try {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-activity="desk"]')?.click()
              for (let index = 0; index < 60 && !document.querySelector('[data-testid="manuscript-input"]'); index += 1) await wait(100)
              if (!document.querySelector('.assistant-panel')) document.querySelector('[aria-controls="assistant-drawer"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('.assistant-panel'); index += 1) await wait(100)
              const panel = document.querySelector('.assistant-panel')
              const workbench = document.querySelector('.workbench')
              const resizer = document.querySelector('.assistant-resizer')
              const editor = document.querySelector('[data-testid="manuscript-input"]')
              const editorSurface = editor?.closest('.cm-scroller') || editor
              const panelRect = panel?.getBoundingClientRect()
              const workbenchRect = workbench?.getBoundingClientRect()
              const resizerRect = resizer?.getBoundingClientRect()
              const panelPosition = panel ? getComputedStyle(panel).position : 'missing'
              const beforeWidth = panelRect?.width || 0
              resizer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
              await wait(80)
              const resizedWidth = panel?.getBoundingClientRect().width || 0
              document.querySelector('[aria-label="关闭智能助笔侧栏"]')?.click()
              await wait(80)
              const restoredWidth = workbench?.getBoundingClientRect().width || 0
              return {
                ok: Boolean(panel
                  && resizer
                  && panel.dataset.layout === 'sidebar'
                  && panelPosition === 'static'
                  && editorSurface
                  && getComputedStyle(editorSurface).backgroundImage.includes('repeating-linear-gradient')
                  && panelRect
                  && workbenchRect
                  && Math.abs(workbenchRect.right - panelRect.left) <= 1
                  && beforeWidth >= 280
                  && resizedWidth > beforeWidth
                  && restoredWidth > workbenchRect.width),
                step: 'docked-assistant',
                beforeWidth,
                resizedWidth,
                restoredWidth,
                workbenchWidth: workbenchRect?.width,
                editorBackground: editorSurface ? getComputedStyle(editorSurface).backgroundImage : 'missing',
                contentBackground: editor ? getComputedStyle(editor).backgroundImage : 'missing',
                panelPosition,
                panelLayout: panelRect && { left: panelRect.left, right: panelRect.right, width: panelRect.width },
                workbenchLayout: workbenchRect && { left: workbenchRect.left, right: workbenchRect.right, width: workbenchRect.width },
                resizerLayout: resizerRect && { left: resizerRect.left, right: resizerRect.right, width: resizerRect.width },
                layoutGap: panelRect && workbenchRect ? panelRect.left - workbenchRect.right : null
              }
            } catch (error) {
              return { ok: false, step: 'docked-assistant-exception', error: error instanceof Error ? error.message : String(error) }
            }
          })()`)
          if (!dockedAssistantScene.ok) {
            console.error(`[desktop smoke] docked assistant scene failed: ${JSON.stringify(dockedAssistantScene)}`)
            return app.exit(1)
          }
          const continuationManifestScene = process.env.LANJIAN_SMOKE_MULTI_FILE_CONTINUATION === '1'
            ? await window.webContents.executeJavaScript(`(async () => {
            try {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const setValue = (element, value) => {
                element.value = value
                element.dispatchEvent(new Event('input', { bubbles: true }))
                element.dispatchEvent(new Event('change', { bubbles: true }))
              }
              document.querySelector('.project-switch')?.click()
              for (let index = 0; index < 80 && !document.querySelector('.library-home'); index += 1) await wait(100)
              await wait(450)
              const entry = document.querySelector('[data-testid="create-from-txt"]')
              if (!entry) return { ok: false, step: 'continuation-library-entry', library: Boolean(document.querySelector('.library-home')), activity: document.querySelector('.creation-activity.selected')?.getAttribute('data-activity') || '' }
              entry.click()
              for (let index = 0; index < 40 && !document.querySelector('[data-testid="continuation-file-queue-empty"]'); index += 1) await wait(100)
              const addInitial = document.querySelector('[data-testid="add-continuation-documents"]')
              if (!addInitial) return { ok: false, step: 'continuation-empty-queue', modal: Boolean(document.querySelector('.txt-import-modal')), entry: entry.outerHTML, body: document.body.textContent?.slice(0, 400) || '' }
              addInitial.click()
              for (let index = 0; index < 40 && document.querySelectorAll('.manifest-file').length !== 2; index += 1) await wait(100)
              const initialFiles = Array.from(document.querySelectorAll('.manifest-file'))
              if (initialFiles.length !== 2) return { ok: false, step: 'initial-file-batch', count: initialFiles.length }
              const initialRoles = Array.from(document.querySelectorAll('.manifest-file select'))
              setValue(initialRoles[0], 'manuscript')
              setValue(initialRoles[1], 'material')
              const title = document.querySelector('.import-fields input')
              setValue(title, '多文件接续烟测')
              document.querySelector('.import-path button')?.click()
              for (let index = 0; index < 20 && !document.querySelector('.import-path input')?.value; index += 1) await wait(50)
              document.querySelector('[data-testid="add-continuation-documents"]')?.click()
              for (let index = 0; index < 40 && document.querySelectorAll('.manifest-file').length !== 3; index += 1) await wait(100)
              const files = Array.from(document.querySelectorAll('.manifest-file'))
              const roles = Array.from(document.querySelectorAll('.manifest-file select'))
              if (files.length !== 3 || roles.length !== 3) return { ok: false, step: 'append-file-batch', count: files.length, roleCount: roles.length }
              setValue(roles[2], 'material')
              await wait(80)
              const submit = document.querySelector('.import-footer .seal-action')
              if (!submit || submit.disabled) return { ok: false, step: 'manifest-not-ready', title: title?.value, path: document.querySelector('.import-path input')?.value, roles: roles.map((item) => item.value) }
              submit.click()
              for (let index = 0; index < 80 && !document.querySelector('[data-testid="continuation-analysis"]'); index += 1) await wait(100)
              const chapters = await window.novelDesktop.chapters.list()
              const analysis = document.querySelector('[data-testid="continuation-analysis"]')
              return {
                ok: Boolean(!document.querySelector('.txt-import-modal')
                  && analysis
                  && analysis.textContent?.includes('已有剧情')
                  && chapters.length > 0),
                step: 'multi-file-continuation',
                fileNames: files.map((file) => file.querySelector('b')?.textContent),
                roles: roles.map((item) => item.value),
                chapterCount: chapters.length,
                analysis: analysis?.textContent?.slice(0, 120) || ''
              }
            } catch (error) {
              return { ok: false, step: 'multi-file-continuation-exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
            }
          })()`)
            : { ok: true, step: 'skipped' }
          if (!continuationManifestScene.ok) {
            console.error(`[desktop smoke] multi-file continuation scene failed: ${JSON.stringify(continuationManifestScene)}`)
            return app.exit(1)
          }
          if (process.env.LANJIAN_SMOKE_OFFLINE_FAILURE_ONLY === '1') {
            const { runOfflineAiFailureSmoke } = await import('./offline-ai-failure-smoke')
            const result = await runOfflineAiFailureSmoke(
              window,
              process.env.LANJIAN_SMOKE_MODEL_URL || '',
              process.env.LANJIAN_OFFLINE_FAILURE_CAPTURE_PATH
            ).catch((error: unknown) => ({
              ok: false, step: 'offline-ai-failure-driver-error', error: error instanceof Error ? error.message : String(error)
            }))
            console.info('[desktop smoke] offline AI failure and manual recovery: ' + JSON.stringify(result))
            return app.exit(result.ok ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_DERIVATIVE_STALE_ONLY === '1') {
            if (!smokeSeedDerivativeStale) {
              console.error('[desktop smoke] derivative stale setup unavailable')
              return app.exit(1)
            }
            const derivatives = await smokeSeedDerivativeStale()
            const { runChapterDerivativeStaleSmoke } = await import('./chapter-derivative-stale-smoke')
            const ui = await runChapterDerivativeStaleSmoke(window, process.env.LANJIAN_DERIVATIVE_STALE_CAPTURE_PATH)
              .catch((error: unknown) => ({ ok: false, step: 'derivative-stale-driver-error', error: error instanceof Error ? error.message : String(error) }))
            const result = { ...ui, derivatives }
            console.info('[desktop smoke] chapter derivative stale status: ' + JSON.stringify(result))
            return app.exit(ui.ok && derivatives.factBatches.stale >= 1 && derivatives.summaries.stale >= 1 && derivatives.ruleRuns.stale >= 1 ? 0 : 1)
          }
          if (process.env.LANJIAN_SMOKE_CONTEXT_PREFLIGHT === '1') {
            const contextPreflightScene = await runContextPreflightSceneScenario({ window })
            if (!contextPreflightScene.ok) {
              console.error(`[desktop smoke] writing context preflight failed: ${JSON.stringify(contextPreflightScene)}`)
              return app.exit(1)
            }
            const contextPreflightCapturePath = process.env.LANJIAN_CONTEXT_PREFLIGHT_CAPTURE_PATH
            if (contextPreflightCapturePath) await writeFile(contextPreflightCapturePath, (await window.capturePage()).toPNG())
            console.info(`[desktop smoke] writing context preflight passed: ${JSON.stringify(contextPreflightScene)}`)
          }
          console.info(`[desktop smoke] focused SQLite, chapter-card, configuration, automatic-backup and docked-assistant scenes passed: ${JSON.stringify({ outline: sqliteStorageScene.layout, chapterCard: focusedChapterCardScene.layout, configurationWidth: focusedConfigurationScene.pageWidth, automaticBackup: automaticBackupScene.layout, assistant: dockedAssistantScene, continuationSmoke: continuationManifestScene.step })}`)
          return app.exit(0)
        }
        const createParent = process.env.LANJIAN_SMOKE_CREATE_PARENT
        if (createParent && bridgeReady) {
          // The loading-screen smoke only needs the isolated shelf fixture. Run it
          // before the much broader legacy shelf workflow so homepage redesigns do
          // not prevent us from checking this independent safety/escape surface.
          if (process.env.LANJIAN_SMOKE_WORKSPACE_DESIGN_ONLY === '1' && capturePath) {
            const { runWorkspaceDesignSmoke } = await import('./workspace-design-smoke')
            const result = await runWorkspaceDesignSmoke(window, capturePath)
              .catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
            console.info(`[desktop smoke] ${process.env.LANJIAN_SMOKE_WORKSPACE_LOADING_ONLY === '1' ? 'workspace loading' : 'workspace design'}: ${JSON.stringify(result)}`)
            return app.exit(result.ok ? 0 : 1)
          }
          const expectedLibraryWords = process.env.LANJIAN_SMOKE_CORE_WRITING_ONLY === '1'
            ? '40 字'
            : process.env.LANJIAN_SMOKE_MIXED_DIFF_ONLY === '1' || process.env.LANJIAN_SMOKE_ACTIVE_STREAM_EDIT_ONLY === '1'
              ? '28 字'
              : '10 字'
          const createUiPassed = await runCreateUiPassedScenario({ window, expectedLibraryWords, createParent })
          if (!createUiPassed.ok) {
            console.error(`[desktop smoke] create-project click failed at ${createUiPassed.step}: ${JSON.stringify(createUiPassed)}`)
            return app.exit(1)
          }
          const consistencyCapturePath = process.env.LANJIAN_CONSISTENCY_CAPTURE_PATH
          if (consistencyCapturePath) await writeFile(consistencyCapturePath, (await window.capturePage()).toPNG())
          const profileCapturePath = process.env.LANJIAN_PROFILE_CAPTURE_PATH
          if (profileCapturePath) await writeFile(profileCapturePath, (await window.capturePage()).toPNG())
          const aboutCapturePath = process.env.LANJIAN_ABOUT_CAPTURE_PATH
          if (aboutCapturePath) {
            await window.webContents.executeJavaScript(`(async () => {
              document.querySelector('[data-activity="settings"]')?.click()
              await new Promise((resolve) => setTimeout(resolve, 100))
              document.querySelector('[data-testid="settings-nav-about"]')?.click()
              await new Promise((resolve) => setTimeout(resolve, 120))
            })()`)
            await writeFile(aboutCapturePath, (await window.capturePage()).toPNG())
          }
          const timelineClicked = await window.webContents.executeJavaScript(`(async () => {
            document.querySelector('[data-activity="timeline"]')?.click()
            await new Promise((resolve) => setTimeout(resolve, 120))
            const heading = document.querySelector('.timeline-workbench h2')
            const generate = document.querySelector('[data-testid="generate-timeline-candidates"]')
            const add = document.querySelector('[data-testid="add-timeline-event"]')
            if (!heading?.textContent?.includes('事件时间线') || !generate || !add) return { ok: false, step: 'timeline-workbench-entry' }
            if (document.querySelector('[data-testid="timeline-event-detail"]')) return { ok: false, step: 'timeline-default-collapsed' }
            add.click()
            await new Promise((resolve) => setTimeout(resolve, 60))
            const detail = document.querySelector('[data-testid="timeline-event-detail"]')
            const inputs = detail?.querySelectorAll('input') || []
            const textareas = detail?.querySelectorAll('textarea') || []
            if (!detail || inputs.length !== 4 || textareas.length !== 2) return { ok: false, step: 'timeline-new-event-detail', inputCount: inputs.length, textareaCount: textareas.length }
            const values = ['陌生来信抵达', '开端后的第三日', '沈砚、林舟', '旧邮局']
            inputs.forEach((input, index) => {
              input.value = values[index]
              input.dispatchEvent(new Event('input', { bubbles: true }))
            })
            textareas[0].value = '两人收到一封来自未来的退信。'
            textareas[0].dispatchEvent(new Event('input', { bubbles: true }))
            textareas[1].value = '他们决定追查寄信人。'
            textareas[1].dispatchEvent(new Event('input', { bubbles: true }))
            document.querySelector('.timeline-node.open .timeline-node-summary')?.click()
            await new Promise((resolve) => setTimeout(resolve, 40))
            const summary = Array.from(document.querySelectorAll('.timeline-node-summary')).find((item) => item.textContent?.includes('陌生来信抵达'))
            if (document.querySelector('[data-testid="timeline-event-detail"]') || !summary?.textContent?.includes('陌生来信抵达')) {
              return { ok: false, step: 'timeline-collapse-after-edit', summary: summary?.textContent || '' }
            }
            document.querySelector('[data-testid="timeline-mode-characters"]')?.click()
            await new Promise((resolve) => setTimeout(resolve, 120))
            document.querySelector('[data-testid="timeline-character-tracks"]')?.click()
            await new Promise((resolve) => setTimeout(resolve, 40))
            const characterView = document.querySelector('[data-testid="timeline-characters-view"]')
            if (!characterView || !document.querySelector('.timeline-workbench h2')?.textContent?.includes('人物档案')
              || characterView.querySelector('input, textarea')) return { ok: false, step: 'timeline-character-line-readonly' }
            document.querySelector('[data-testid="timeline-mode-volumes"]')?.click()
            await new Promise((resolve) => setTimeout(resolve, 100))
            const volumeView = document.querySelector('[data-testid="timeline-volumes-view"]')
            if (!volumeView || !document.querySelector('.timeline-workbench h2')?.textContent?.includes('卷线')
              || volumeView.querySelector('input, textarea')) return { ok: false, step: 'timeline-volume-line-readonly' }
            document.querySelector('[data-testid="timeline-mode-events"]')?.click()
            await new Promise((resolve) => setTimeout(resolve, 60))
            const restoredSummary = Array.from(document.querySelectorAll('.timeline-node-summary')).find((item) => item.textContent?.includes('陌生来信抵达'))
            return { ok: Boolean(restoredSummary), step: 'timeline-three-views', summary: restoredSummary?.textContent || '' }
          })()`)
          if (!timelineClicked.ok) {
            console.error(`[desktop smoke] timeline workbench click failed at ${timelineClicked.step}: ${JSON.stringify(timelineClicked)}`)
            return app.exit(1)
          }
        }
        const settingsCapturePath = process.env.LANJIAN_SETTINGS_CAPTURE_PATH
        if (settingsCapturePath) {
          await window.webContents.executeJavaScript("document.querySelector('.tree-project')?.click()")
          await new Promise((resolve) => setTimeout(resolve, 700))
          await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"设置\"]')?.click()")
          await new Promise((resolve) => setTimeout(resolve, 350))
          const smokeModelUrl = process.env.LANJIAN_SMOKE_MODEL_URL
          if (smokeModelUrl) {
            console.info('[desktop smoke] settings stage: testing unsaved interface and model routing')
            const modelProbe = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-testid="settings-nav-connection"]')?.click()
              await wait(80)
              const connectionCard = document.querySelector('[data-testid="settings-page-connection"] .ai-connection-card')
              const connectionInputs = connectionCard?.querySelectorAll('.ai-connection-fields input') || []
              const connectionId = connectionCard?.getAttribute('data-connection-id') || ''
              if (connectionInputs.length < 3 || !connectionId) return { ok: false, step: 'connection-inputs', count: connectionInputs.length }
              connectionInputs[1].value = ${JSON.stringify(smokeModelUrl)}
              connectionInputs[1].dispatchEvent(new Event('input', { bubbles: true }))
              connectionInputs[2].value = 'smoke-model-key'
              connectionInputs[2].dispatchEvent(new Event('input', { bubbles: true }))
              await wait(80)
              document.querySelector('[data-testid="test-ai-connection"]')?.click()
              for (let attempt = 0; attempt < 50 && !document.querySelector('.connection-result'); attempt += 1) await wait(100)
              let connectionResult = document.querySelector('.connection-result')
              if (connectionResult?.classList.contains('failed')) {
                document.querySelector('[data-testid="settings-nav-routing"]')?.click()
                await wait(80)
                const discoveredModel = document.querySelector('[data-testid="shared-model-select"]')
                discoveredModel?.click()
                await wait(80)
                const discoveredChoice = document.querySelector('.model-choice-list button[data-model="gemini-smoke-model"][data-connection-id="' + connectionId + '"]')
                if (discoveredModel?.tagName !== 'BUTTON' || !discoveredChoice) {
                  return { ok: false, step: 'discovered-model', text: discoveredModel?.textContent || '' }
                }
                discoveredChoice.click()
                document.querySelector('[data-testid="settings-nav-connection"]')?.click()
                await wait(80)
                document.querySelector('[data-testid="test-ai-connection"]')?.click()
                for (let attempt = 0; attempt < 50 && !document.querySelector('.connection-result.success'); attempt += 1) await wait(100)
                connectionResult = document.querySelector('.connection-result')
              }
              if (!connectionResult?.classList.contains('success') || !connectionResult.textContent?.includes('真实生成')) {
                return { ok: false, step: 'connection-result', text: connectionResult?.textContent || '' }
              }
              document.querySelector('[data-testid="settings-nav-routing"]')?.click()
              await wait(80)
              const modelSelect = document.querySelector('[data-testid="shared-model-select"]')
              if (modelSelect?.tagName !== 'BUTTON'
                || modelSelect.getAttribute('data-model') !== 'gemini-smoke-model'
                || modelSelect.getAttribute('data-connection-id') !== connectionId) return { ok: false, step: 'model-routing' }
              document.querySelector('[data-testid="settings-nav-connection"]')?.click()
              await wait(80)
              Array.from(document.querySelectorAll('.connection-command-actions button')).find((item) => item.textContent?.includes('保存全部接口'))?.click()
              await wait(500)
              return { ok: Boolean((await window.novelDesktop.ai.getSettings()).apiKeyConfigured), step: 'saved-settings' }
            })()`).catch((error: unknown) => ({
              ok: false,
              step: 'model-probe-driver-error',
              errorType: error instanceof AppError ? error.code : error instanceof Error ? error.name : typeof error
            }))
            if (!modelProbe.ok) {
              console.error(`[desktop smoke] real model-probe click failed at ${modelProbe.step}: ${JSON.stringify(modelProbe)}`)
              return app.exit(1)
            }
            console.info('[desktop smoke] settings stage: unsaved interface tested, routed and saved')
            console.info('[desktop smoke] settings stage: starting fixed semantic evaluation')
            const evaluationPassed = await window.webContents.executeJavaScript(`(async () => {
              document.querySelector('[data-activity="settings"]')?.click()
              await new Promise((resolve) => setTimeout(resolve, 100))
              document.querySelector('[data-testid="settings-nav-project"]')?.click()
              await new Promise((resolve) => setTimeout(resolve, 150))
              const section = document.querySelector('[data-testid="consistency-evaluation-section"]')
              const start = document.querySelector('[data-testid="start-consistency-evaluation"]')
              if (!section || !start || start.disabled || !section.textContent?.includes('不读取或修改你的小说')) return { ok: false, step: 'evaluation-entry', section: Boolean(section), start: Boolean(start), disabled: Boolean(start?.disabled), text: section?.textContent || '' }
              start.click()
              for (let index = 0; index < 80; index += 1) {
                await new Promise((resolve) => setTimeout(resolve, 100))
                const current = document.querySelector('[data-testid="consistency-evaluation-section"]')
                if (current?.textContent?.includes('语义样本 60/60 条已判断')) {
                  current.scrollIntoView({ block: 'center' })
                  await new Promise((resolve) => setTimeout(resolve, 250))
                  return { ok: current.textContent.includes('漏报 0') && current.textContent.includes('误报 0') && current.textContent.includes('无法判断 0'), step: 'evaluation-result', text: current.textContent }
                }
              }
              return { ok: false, step: 'evaluation-timeout', text: document.querySelector('[data-testid="consistency-evaluation-section"]')?.textContent || '' }
            })()`).catch((error: unknown) => ({
              ok: false,
              step: 'evaluation-driver-error',
              errorType: error instanceof AppError
                ? error.code
                : error instanceof Error
                  ? error.name
                  : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
                    ? error.code
                    : typeof error
            }))
            if (!evaluationPassed.ok) {
              console.error(`[desktop smoke] consistency evaluation failed at ${evaluationPassed.step}: ${JSON.stringify(evaluationPassed)}`)
              return app.exit(1)
            }
            console.info('[desktop smoke] settings stage: fixed semantic evaluation passed')
            const consistencyEvaluationCapturePath = process.env.LANJIAN_CONSISTENCY_EVALUATION_CAPTURE_PATH
            if (consistencyEvaluationCapturePath) await writeFile(consistencyEvaluationCapturePath, (await window.capturePage()).toPNG())
            console.info('[desktop smoke] timeline stage: generating and adopting one candidate')
            const timelineCandidatePassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const trace = []
              try {
                trace.push('open-timeline')
                document.querySelector('[data-activity="timeline"]')?.click()
                await wait(120)
                trace.push('read-before')
                const before = await window.novelDesktop.workspace.getTimeline()
                trace.push('generate-candidates')
                document.querySelector('[data-testid="generate-timeline-candidates"]')?.click()
                await wait(900)
                const drawer = document.querySelector('[data-testid="timeline-candidate-drawer"]')
                const detail = document.querySelector('[data-testid="timeline-candidate-detail"]')
                if (!drawer?.textContent?.includes('钟声第一次倒流') || !detail) return { ok: false, step: 'ai-timeline-candidate-visible', drawer: drawer?.textContent || '', trace }
                trace.push('adopt-locally')
                Array.from(detail.querySelectorAll('button')).find((item) => item.textContent?.includes('采用为作者事件'))?.click()
                await wait(100)
                trace.push('verify-no-premature-write')
                const afterAdopt = await window.novelDesktop.workspace.getTimeline()
                if (JSON.stringify(afterAdopt) !== JSON.stringify(before)) return { ok: false, step: 'ai-timeline-adoption-premature-write', trace }
                const adoptedNode = Array.from(document.querySelectorAll('.timeline-node-summary')).find((item) => item.textContent?.includes('钟声第一次倒流'))
                if (!adoptedNode) return { ok: false, step: 'ai-timeline-adopted-node', trace }
                trace.push('save-timeline')
                document.querySelector('.timeline-primary-actions .control-button.primary')?.click()
                await wait(500)
                trace.push('read-saved')
                const saved = await window.novelDesktop.workspace.getTimeline()
                return { ok: saved.events.some((item) => item.title === '钟声第一次倒流' && item.event.includes('倒流的钟声')), step: 'ai-timeline-save', saved, trace }
              } catch (error) {
                return { ok: false, step: 'ai-timeline-driver-error', trace, errorType: error?.code || error?.name || typeof error }
              }
            })()`)
            if (!timelineCandidatePassed.ok) {
              console.error(`[desktop smoke] AI timeline candidate click failed at ${timelineCandidatePassed.step}: ${JSON.stringify(timelineCandidatePassed)}`)
              return app.exit(1)
            }
            console.info('[desktop smoke] timeline stage: candidate adoption passed')
            console.info('[desktop smoke] continuation stage: generating editable analysis')
            const continuationPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const trace = []
              try {
                trace.push('open-preparation')
                document.querySelector('[data-activity="preparation"]')?.click()
                await wait(180)
                trace.push('open-continuation')
                document.querySelector('[data-testid="preparation-continuation"]')?.click()
                await wait(120)
                const ready = document.querySelector('[data-testid="continuation-analysis-ready"]')
                const generate = document.querySelector('[data-testid="generate-continuation-analysis"]')
                if (!ready?.textContent?.includes('生成可审阅的接续分析') || !generate || generate.disabled) return { ok: false, step: 'continuation-ready', trace }
                trace.push('read-formal-before')
                const foundationBefore = JSON.stringify(await window.novelDesktop.workspace.getFoundation())
                const outlinesBefore = JSON.stringify(await window.novelDesktop.outlines.list())
                trace.push('generate-analysis')
                generate.click()
                for (let index = 0; index < 50 && !document.querySelector('[data-testid="continuation-analysis"]'); index += 1) await wait(100)
                const panel = document.querySelector('[data-testid="continuation-analysis"]')
                const editors = Array.from(panel?.querySelectorAll('.continuation-sections textarea') || [])
                if (!panel?.textContent?.includes('继续写作前必核') || editors.length !== 9 || !panel.textContent.includes('已有剧情')) return { ok: false, step: 'continuation-generated', editorCount: editors.length, panelText: panel?.textContent || '', active: document.querySelector('.creation-activity.selected')?.getAttribute('data-activity'), preparationSelection: Array.from(document.querySelectorAll('[data-testid^="preparation-"]')).map((item) => ({ id: item.getAttribute('data-testid'), selected: item.classList.contains('selected') })), trace }
                trace.push('verify-zero-write')
                if (JSON.stringify(await window.novelDesktop.workspace.getFoundation()) !== foundationBefore || JSON.stringify(await window.novelDesktop.outlines.list()) !== outlinesBefore) return { ok: false, step: 'continuation-zero-formal-write', trace }
                editors[0].value = '烟测修改：轻小说悬疑方向，仍需作者确认。'
                editors[0].dispatchEvent(new Event('input', { bubbles: true }))
                trace.push('save-analysis')
                panel.querySelector('[data-testid="save-continuation-analysis"]')?.click()
                await wait(450)
                trace.push('read-saved-analysis')
                const saved = (await window.novelDesktop.imports.continuationAnalysis()).candidate
                if (saved?.sections?.find((item) => item.area === 'projectDefinition')?.content !== editors[0].value) return { ok: false, step: 'continuation-edit-save', trace }
                return { ok: true, trace }
              } catch (error) {
                return { ok: false, step: 'continuation-driver-error', trace, errorType: error?.code || error?.name || typeof error }
              }
            })()`)
            if (!continuationPassed.ok) {
               console.error(`[desktop smoke] continuation analysis click failed at ${continuationPassed.step}: ${JSON.stringify(continuationPassed)}`)
              return app.exit(1)
            }
            console.info('[desktop smoke] continuation stage: editable analysis passed')
            const continuationCapturePath = process.env.LANJIAN_CONTINUATION_CAPTURE_PATH
            if (continuationCapturePath) await writeFile(continuationCapturePath, (await window.capturePage()).toPNG())
            smokeDriverStage = 'continuation-project-definition-preview'
            const continuationAdoptionPreviewPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              window.__continuationProfileBefore = await window.novelDesktop.workspace.getBookProfile()
              document.querySelector('[data-testid="preview-continuation-project-definition"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="continuation-project-definition-preview"]'); index += 1) await wait(100)
              const preview = document.querySelector('[data-testid="continuation-project-definition-preview"]')
              return Boolean(preview?.textContent?.includes('只改一处') && preview.textContent.includes('其余 5 项保持原样') && preview.textContent.includes('烟测修改：轻小说悬疑方向'))
            })()`)
            if (!continuationAdoptionPreviewPassed) {
              console.error('[desktop smoke] continuation project-definition preview click failed')
              return app.exit(1)
            }
            const continuationAdoptionCapturePath = process.env.LANJIAN_CONTINUATION_ADOPTION_CAPTURE_PATH
            if (continuationAdoptionCapturePath) await writeFile(continuationAdoptionCapturePath, (await window.capturePage()).toPNG())
            smokeDriverStage = 'continuation-project-definition-adoption'
            const continuationAdoptionPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-testid="confirm-continuation-project-definition"]')?.click()
              for (let index = 0; index < 30 && document.querySelector('[data-testid="continuation-project-definition-preview"]'); index += 1) await wait(100)
              const before = window.__continuationProfileBefore
              const after = await window.novelDesktop.workspace.getBookProfile()
              const candidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              delete window.__continuationProfileBefore
              return after.coreIdea === '烟测修改：轻小说悬疑方向，仍需作者确认。'
                && after.genre === before.genre && after.subgenre === before.subgenre
                && after.plannedVolumes === before.plannedVolumes && after.chaptersPerVolume === before.chaptersPerVolume
                && after.targetWordsPerChapter === before.targetWordsPerChapter
                && Boolean(candidate?.adoption?.projectDefinition)
            })()`)
            if (!continuationAdoptionPassed) {
              console.error('[desktop smoke] continuation project-definition adoption failed or changed preserved fields')
              return app.exit(1)
            }
            smokeDriverStage = 'continuation-existing-plot-preview'
            const continuationPlotPreviewPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              window.__continuationTimelineBefore = await window.novelDesktop.workspace.getTimeline()
              window.__continuationFoundationBeforePlot = await window.novelDesktop.workspace.getFoundation()
              window.__continuationOutlinesBeforePlot = await window.novelDesktop.outlines.list()
              document.querySelector('[data-testid="preview-continuation-existing-plot"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="continuation-existing-plot-preview"]'); index += 1) await wait(100)
              const preview = document.querySelector('[data-testid="continuation-existing-plot-preview"]')
              const event = preview?.querySelector('[data-testid="continuation-plot-event"]')
              return Boolean(preview?.textContent?.includes('逐事确认') && event?.value?.includes('沈砚在雨夜发现脚印并开始追查'))
            })()`)
            if (!continuationPlotPreviewPassed) {
              console.error('[desktop smoke] continuation existing-plot preview failed')
              return app.exit(1)
            }
            const continuationPlotCapturePath = process.env.LANJIAN_CONTINUATION_PLOT_CAPTURE_PATH
            if (continuationPlotCapturePath) await writeFile(continuationPlotCapturePath, (await window.capturePage()).toPNG())
            smokeDriverStage = 'continuation-existing-plot-adoption'
            const continuationPlotAdoptionPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const set = (selector, value) => { const input = document.querySelector(selector); if (!input) return false; input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); return true }
              if (!set('[data-testid="continuation-plot-time"]', '第一日雨夜')
                || !set('[data-testid="continuation-plot-characters"]', '沈砚')
                || !set('[data-testid="continuation-plot-location"]', '长安城门')) return false
              await wait(80)
              document.querySelector('[data-testid="confirm-continuation-existing-plot"]')?.click()
              for (let index = 0; index < 30 && document.querySelector('[data-testid="continuation-existing-plot-preview"]'); index += 1) await wait(100)
              const timeline = await window.novelDesktop.workspace.getTimeline()
              const candidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              const foundation = await window.novelDesktop.workspace.getFoundation()
              const outlines = await window.novelDesktop.outlines.list()
              const before = window.__continuationTimelineBefore
              const safe = timeline.events.length === before.events.length + 1
                && timeline.events.at(-1)?.time === '第一日雨夜'
                && timeline.events.at(-1)?.characters === '沈砚'
                && timeline.events.at(-1)?.location === '长安城门'
                && candidate?.adoption?.existingPlot?.length === 1
                && JSON.stringify(foundation) === JSON.stringify(window.__continuationFoundationBeforePlot)
                && JSON.stringify(outlines) === JSON.stringify(window.__continuationOutlinesBeforePlot)
              delete window.__continuationTimelineBefore
              delete window.__continuationFoundationBeforePlot
              delete window.__continuationOutlinesBeforePlot
              return safe
            })()`)
            if (!continuationPlotAdoptionPassed) {
              console.error('[desktop smoke] continuation existing-plot adoption failed or changed unrelated formal data')
              return app.exit(1)
            }
            smokeDriverStage = 'continuation-character-preview'
            const continuationCharacterPreviewPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const set = (selector, value) => { const input = document.querySelector(selector); if (!input) return false; input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); return true }
              window.__continuationCharacterBefore = await window.novelDesktop.workspace.getCharacterState()
              window.__continuationFoundationBeforeCharacter = await window.novelDesktop.workspace.getFoundation()
              window.__continuationOutlinesBeforeCharacter = await window.novelDesktop.outlines.list()
              document.querySelector('[data-testid="open-continuation-character"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="continuation-character-editor"]'); index += 1) await wait(100)
              if (!set('[data-testid="continuation-character-name"]', '沈砚')
                || !set('[data-testid="continuation-character-role"]', '追查城门异闻的失意歌者')
                || !set('[data-testid="continuation-character-arc"]', '从借用异世回声，到建立自己的表达。')) return false
              await wait(80)
              document.querySelector('[data-testid="preview-continuation-character"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="continuation-character-preview"]'); index += 1) await wait(100)
              const preview = document.querySelector('[data-testid="continuation-character-preview"]')
              return Boolean(preview?.textContent?.includes('建立新人物锚点') && preview.textContent.includes('正文状态不变'))
            })()`)
            if (!continuationCharacterPreviewPassed) {
              console.error('[desktop smoke] continuation character impact preview failed')
              return app.exit(1)
            }
            const continuationCharacterCapturePath = process.env.LANJIAN_CONTINUATION_CHARACTER_CAPTURE_PATH
            if (continuationCharacterCapturePath) await writeFile(continuationCharacterCapturePath, (await window.capturePage()).toPNG())
            smokeDriverStage = 'continuation-character-adoption'
            const continuationCharacterAdoptionPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-testid="confirm-continuation-character"]')?.click()
              for (let index = 0; index < 30 && document.querySelector('[data-testid="continuation-character-editor"]'); index += 1) await wait(100)
              const state = await window.novelDesktop.workspace.getCharacterState()
              const candidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              const before = window.__continuationCharacterBefore
              const anchor = state.anchors.find((item) => item.name === '沈砚')
              const safe = state.anchors.length === before.anchors.length + 1
                && state.events.length === before.events.length
                && state.pendingConflicts.length === before.pendingConflicts.length
                && anchor?.role === '追查城门异闻的失意歌者'
                && anchor?.arcSeed === '从借用异世回声，到建立自己的表达。'
                && state.snapshots.find((item) => item.name === '沈砚')?.lastEventId === ''
                && candidate?.adoption?.characters?.some((item) => item.name === '沈砚')
                && JSON.stringify(await window.novelDesktop.workspace.getFoundation()) === JSON.stringify(window.__continuationFoundationBeforeCharacter)
                && JSON.stringify(await window.novelDesktop.outlines.list()) === JSON.stringify(window.__continuationOutlinesBeforeCharacter)
              delete window.__continuationCharacterBefore
              delete window.__continuationFoundationBeforeCharacter
              delete window.__continuationOutlinesBeforeCharacter
              return safe
            })()`)
            if (!continuationCharacterAdoptionPassed) {
              console.error('[desktop smoke] continuation character adoption failed or changed dynamic/formal data')
              return app.exit(1)
            }
            smokeDriverStage = 'continuation-world-view-preview'
            const continuationWorldViewPreviewPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              window.__continuationWorldBefore = {
                foundation: await window.novelDesktop.workspace.getFoundation(),
                powerSystem: await window.novelDesktop.workspace.getPowerSystem(),
                realms: await window.novelDesktop.workspace.getRealms(),
                cheatSystem: await window.novelDesktop.workspace.getCheatSystem(),
                systemTemplate: await window.novelDesktop.workspace.getSystemTemplate(),
                timeline: await window.novelDesktop.workspace.getTimeline(),
                characters: await window.novelDesktop.workspace.getCharacterState(),
                outlines: await window.novelDesktop.outlines.list(),
                chapters: await window.novelDesktop.chapters.list()
              }
              document.querySelector('[data-testid="preview-continuation-world-view"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="continuation-world-view-preview"]'); index += 1) await wait(100)
              const preview = document.querySelector('[data-testid="continuation-world-view-preview"]')
              return Boolean(preview?.textContent?.includes('天地留白')
                && preview.textContent.includes('不会自动扩展成僵硬规则')
                && preview.textContent.includes('架空长安以现实生活秩序为底'))
            })()`)
            if (!continuationWorldViewPreviewPassed) {
              console.error('[desktop smoke] continuation world-view impact preview failed')
              return app.exit(1)
            }
            const continuationWorldViewCapturePath = process.env.LANJIAN_CONTINUATION_WORLD_VIEW_CAPTURE_PATH
            if (continuationWorldViewCapturePath) await writeFile(continuationWorldViewCapturePath, (await window.capturePage()).toPNG())
            smokeDriverStage = 'continuation-world-view-adoption'
            const continuationWorldViewAdoptionPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-testid="confirm-continuation-world-view"]')?.click()
              for (let index = 0; index < 30 && document.querySelector('[data-testid="continuation-world-view-preview"]'); index += 1) await wait(100)
              const before = window.__continuationWorldBefore
              const after = {
                foundation: await window.novelDesktop.workspace.getFoundation(),
                powerSystem: await window.novelDesktop.workspace.getPowerSystem(),
                realms: await window.novelDesktop.workspace.getRealms(),
                cheatSystem: await window.novelDesktop.workspace.getCheatSystem(),
                systemTemplate: await window.novelDesktop.workspace.getSystemTemplate(),
                timeline: await window.novelDesktop.workspace.getTimeline(),
                characters: await window.novelDesktop.workspace.getCharacterState(),
                outlines: await window.novelDesktop.outlines.list(),
                chapters: await window.novelDesktop.chapters.list()
              }
              const candidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              const preservedFoundation = { ...after.foundation, worldView: before.foundation.worldView }
              const safe = after.foundation.worldView === '架空长安以现实生活秩序为底，异世录音只作为有限线索。'
                && JSON.stringify(preservedFoundation) === JSON.stringify(before.foundation)
                && JSON.stringify(after.powerSystem) === JSON.stringify(before.powerSystem)
                && JSON.stringify(after.realms) === JSON.stringify(before.realms)
                && JSON.stringify(after.cheatSystem) === JSON.stringify(before.cheatSystem)
                && JSON.stringify(after.systemTemplate) === JSON.stringify(before.systemTemplate)
                && JSON.stringify(after.timeline) === JSON.stringify(before.timeline)
                && JSON.stringify(after.characters) === JSON.stringify(before.characters)
                && JSON.stringify(after.outlines) === JSON.stringify(before.outlines)
                && JSON.stringify(after.chapters) === JSON.stringify(before.chapters)
                && Boolean(candidate?.adoption?.worldView)
              delete window.__continuationWorldBefore
              return safe
            })()`)
            if (!continuationWorldViewAdoptionPassed) {
              console.error('[desktop smoke] continuation world-view adoption changed preserved formal data')
              return app.exit(1)
            }
            smokeDriverStage = 'continuation-power-system-preview'
            const continuationPowerSystemPreviewPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              window.__continuationPowerBefore = {
                foundation: await window.novelDesktop.workspace.getFoundation(),
                powerSystem: await window.novelDesktop.workspace.getPowerSystem(),
                realms: await window.novelDesktop.workspace.getRealms(),
                cheatSystem: await window.novelDesktop.workspace.getCheatSystem(),
                systemTemplate: await window.novelDesktop.workspace.getSystemTemplate(),
                timeline: await window.novelDesktop.workspace.getTimeline(),
                characters: await window.novelDesktop.workspace.getCharacterState(),
                outlines: await window.novelDesktop.outlines.list(),
                chapters: await window.novelDesktop.chapters.list()
              }
              document.querySelector('[data-testid="preview-continuation-power-system"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="continuation-power-system-preview"]'); index += 1) await wait(100)
              const preview = document.querySelector('[data-testid="continuation-power-system-preview"]')
              return Boolean(preview?.textContent?.includes('力量脉络')
                && preview.textContent.includes('不会把摘要擅自拆成境界等级')
                && preview.textContent.includes('作品、舞台与公众信任构成成长路径'))
            })()`)
            if (!continuationPowerSystemPreviewPassed) {
              console.error('[desktop smoke] continuation power-system impact preview failed')
              return app.exit(1)
            }
            const continuationPowerSystemCapturePath = process.env.LANJIAN_CONTINUATION_POWER_SYSTEM_CAPTURE_PATH
            if (continuationPowerSystemCapturePath) await writeFile(continuationPowerSystemCapturePath, (await window.capturePage()).toPNG())
            smokeDriverStage = 'continuation-power-system-adoption'
            const continuationPowerSystemAdoptionPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-testid="confirm-continuation-power-system"]')?.click()
              for (let index = 0; index < 30 && document.querySelector('[data-testid="continuation-power-system-preview"]'); index += 1) await wait(100)
              const before = window.__continuationPowerBefore
              const after = {
                foundation: await window.novelDesktop.workspace.getFoundation(),
                powerSystem: await window.novelDesktop.workspace.getPowerSystem(),
                realms: await window.novelDesktop.workspace.getRealms(),
                cheatSystem: await window.novelDesktop.workspace.getCheatSystem(),
                systemTemplate: await window.novelDesktop.workspace.getSystemTemplate(),
                timeline: await window.novelDesktop.workspace.getTimeline(),
                characters: await window.novelDesktop.workspace.getCharacterState(),
                outlines: await window.novelDesktop.outlines.list(),
                chapters: await window.novelDesktop.chapters.list()
              }
              const candidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              const safe = after.powerSystem.overview === '作品、舞台与公众信任构成成长路径；没有可量化境界。'
                && JSON.stringify(after.foundation) === JSON.stringify(before.foundation)
                && JSON.stringify(after.realms) === JSON.stringify(before.realms)
                && JSON.stringify(after.cheatSystem) === JSON.stringify(before.cheatSystem)
                && JSON.stringify(after.systemTemplate) === JSON.stringify(before.systemTemplate)
                && JSON.stringify(after.timeline) === JSON.stringify(before.timeline)
                && JSON.stringify(after.characters) === JSON.stringify(before.characters)
                && JSON.stringify(after.outlines) === JSON.stringify(before.outlines)
                && JSON.stringify(after.chapters) === JSON.stringify(before.chapters)
                && Boolean(candidate?.adoption?.powerSystem)
              delete window.__continuationPowerBefore
              return safe
            })()`)
            if (!continuationPowerSystemAdoptionPassed) {
              console.error('[desktop smoke] continuation power-system adoption changed preserved formal data')
              return app.exit(1)
            }
            smokeDriverStage = 'continuation-cheat-system-preview'
            const continuationCheatSystemPreviewPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              window.__continuationCheatBefore = {
                foundation: await window.novelDesktop.workspace.getFoundation(),
                powerSystem: await window.novelDesktop.workspace.getPowerSystem(),
                realms: await window.novelDesktop.workspace.getRealms(),
                cheatSystem: await window.novelDesktop.workspace.getCheatSystem(),
                systemTemplate: await window.novelDesktop.workspace.getSystemTemplate(),
                timeline: await window.novelDesktop.workspace.getTimeline(),
                characters: await window.novelDesktop.workspace.getCharacterState(),
                outlines: await window.novelDesktop.outlines.list(),
                chapters: await window.novelDesktop.chapters.list()
              }
              document.querySelector('[data-testid="preview-continuation-cheat-system"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="continuation-cheat-system-preview"]'); index += 1) await wait(100)
              const preview = document.querySelector('[data-testid="continuation-cheat-system-preview"]')
              return Boolean(preview?.textContent?.includes('奇策留白')
                && preview.textContent.includes('不会替作者启用系统')
                && preview.textContent.includes('只能听见有限的异世录音'))
            })()`)
            if (!continuationCheatSystemPreviewPassed) {
              console.error('[desktop smoke] continuation cheat-system impact preview failed')
              return app.exit(1)
            }
            const continuationCheatSystemCapturePath = process.env.LANJIAN_CONTINUATION_CHEAT_SYSTEM_CAPTURE_PATH
            if (continuationCheatSystemCapturePath) await writeFile(continuationCheatSystemCapturePath, (await window.capturePage()).toPNG())
            smokeDriverStage = 'continuation-cheat-system-adoption'
            const continuationCheatSystemAdoptionPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-testid="confirm-continuation-cheat-system"]')?.click()
              for (let index = 0; index < 30 && document.querySelector('[data-testid="continuation-cheat-system-preview"]'); index += 1) await wait(100)
              const before = window.__continuationCheatBefore
              const after = {
                foundation: await window.novelDesktop.workspace.getFoundation(),
                powerSystem: await window.novelDesktop.workspace.getPowerSystem(),
                realms: await window.novelDesktop.workspace.getRealms(),
                cheatSystem: await window.novelDesktop.workspace.getCheatSystem(),
                systemTemplate: await window.novelDesktop.workspace.getSystemTemplate(),
                timeline: await window.novelDesktop.workspace.getTimeline(),
                characters: await window.novelDesktop.workspace.getCharacterState(),
                outlines: await window.novelDesktop.outlines.list(),
                chapters: await window.novelDesktop.chapters.list()
              }
              const candidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              const safe = after.cheatSystem.overview === '沈砚只能听见有限的异世录音，不能直接复制未来成果。'
                && JSON.stringify(after.foundation) === JSON.stringify(before.foundation)
                && JSON.stringify(after.powerSystem) === JSON.stringify(before.powerSystem)
                && JSON.stringify(after.realms) === JSON.stringify(before.realms)
                && JSON.stringify(after.systemTemplate) === JSON.stringify(before.systemTemplate)
                && JSON.stringify(after.timeline) === JSON.stringify(before.timeline)
                && JSON.stringify(after.characters) === JSON.stringify(before.characters)
                && JSON.stringify(after.outlines) === JSON.stringify(before.outlines)
                && JSON.stringify(after.chapters) === JSON.stringify(before.chapters)
                && Boolean(candidate?.adoption?.cheatSystem)
              delete window.__continuationCheatBefore
              return safe
            })()`)
            if (!continuationCheatSystemAdoptionPassed) {
              console.error('[desktop smoke] continuation cheat-system adoption changed preserved formal data')
              return app.exit(1)
            }
            smokeDriverStage = 'continuation-total-outline-preview'
            const continuationTotalOutlinePreviewPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              window.__continuationTotalBefore = {
                foundation: await window.novelDesktop.workspace.getFoundation(),
                profile: await window.novelDesktop.workspace.getBookProfile(),
                powerSystem: await window.novelDesktop.workspace.getPowerSystem(),
                realms: await window.novelDesktop.workspace.getRealms(),
                cheatSystem: await window.novelDesktop.workspace.getCheatSystem(),
                systemTemplate: await window.novelDesktop.workspace.getSystemTemplate(),
                timeline: await window.novelDesktop.workspace.getTimeline(),
                characters: await window.novelDesktop.workspace.getCharacterState(),
                outlines: await window.novelDesktop.outlines.list(),
                chapterOutlines: await window.novelDesktop.chapterOutlines.list(),
                chapters: await window.novelDesktop.chapters.list()
              }
              document.querySelector('[data-testid="preview-continuation-total-outline"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="continuation-total-outline-preview"]'); index += 1) await wait(100)
              const preview = document.querySelector('[data-testid="continuation-total-outline-preview"]')
              return Boolean(preview?.textContent?.includes('总纲定稿')
                && preview.textContent.includes('采用后仍待复核')
                && preview.textContent.includes('沈砚追查异世录音，在现实舞台上重建自己的声音'))
            })()`)
            if (!continuationTotalOutlinePreviewPassed) {
              console.error('[desktop smoke] continuation total-outline impact preview failed')
              return app.exit(1)
            }
            const continuationTotalOutlineCapturePath = process.env.LANJIAN_CONTINUATION_TOTAL_OUTLINE_CAPTURE_PATH
            if (continuationTotalOutlineCapturePath) await writeFile(continuationTotalOutlineCapturePath, (await window.capturePage()).toPNG())
            smokeDriverStage = 'continuation-total-outline-adoption'
            const continuationTotalOutlineAdoptionPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-testid="confirm-continuation-total-outline"]')?.click()
              for (let index = 0; index < 30 && document.querySelector('[data-testid="continuation-total-outline-preview"]'); index += 1) await wait(100)
              const before = window.__continuationTotalBefore
              const after = {
                foundation: await window.novelDesktop.workspace.getFoundation(),
                profile: await window.novelDesktop.workspace.getBookProfile(),
                powerSystem: await window.novelDesktop.workspace.getPowerSystem(),
                realms: await window.novelDesktop.workspace.getRealms(),
                cheatSystem: await window.novelDesktop.workspace.getCheatSystem(),
                systemTemplate: await window.novelDesktop.workspace.getSystemTemplate(),
                timeline: await window.novelDesktop.workspace.getTimeline(),
                characters: await window.novelDesktop.workspace.getCharacterState(),
                outlines: await window.novelDesktop.outlines.list(),
                chapterOutlines: await window.novelDesktop.chapterOutlines.list(),
                chapters: await window.novelDesktop.chapters.list(),
                planning: await window.novelDesktop.outlines.planningStatus()
              }
              const candidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              const preservedOutlines = { ...after.outlines, total: before.outlines.total }
              const safe = after.outlines.total?.content === '沈砚追查异世录音，在现实舞台上重建自己的声音，并确认选择比答案更重要。'
                && after.planning.totalApproval.status !== 'confirmed'
                && JSON.stringify(preservedOutlines) === JSON.stringify(before.outlines)
                && JSON.stringify(after.foundation) === JSON.stringify(before.foundation)
                && JSON.stringify(after.profile) === JSON.stringify(before.profile)
                && JSON.stringify(after.powerSystem) === JSON.stringify(before.powerSystem)
                && JSON.stringify(after.realms) === JSON.stringify(before.realms)
                && JSON.stringify(after.cheatSystem) === JSON.stringify(before.cheatSystem)
                && JSON.stringify(after.systemTemplate) === JSON.stringify(before.systemTemplate)
                && JSON.stringify(after.timeline) === JSON.stringify(before.timeline)
                && JSON.stringify(after.characters) === JSON.stringify(before.characters)
                && JSON.stringify(after.chapterOutlines) === JSON.stringify(before.chapterOutlines)
                && JSON.stringify(after.chapters) === JSON.stringify(before.chapters)
                && Boolean(candidate?.adoption?.totalOutline)
              delete window.__continuationTotalBefore
              return safe
            })()`)
            if (!continuationTotalOutlineAdoptionPassed) {
              console.error('[desktop smoke] continuation total-outline adoption changed downstream or preserved formal data')
              return app.exit(1)
            }
            smokeDriverStage = 'continuation-total-outline-review'
            const continuationTotalOutlineReviewPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const reviewButton = document.querySelector('[data-testid="review-continuation-total-outline"]')
              if (!reviewButton || reviewButton.disabled) return { ok: false, step: 'review-action' }
              reviewButton.click()
              for (let index = 0; index < 30 && !document.querySelector('.outline-inspector'); index += 1) await wait(100)
              const editor = document.querySelector('.outline-editor > .plain-text-editor .cm-content')
              const review = document.querySelector('.outline-inspector .planning-review')
              if (!editor?.textContent?.includes('沈砚追查异世录音') || !review?.querySelector('.planning-confirm')) return { ok: false, step: 'review-editor' }
              const acknowledge = review.querySelector('.review-acknowledge')
              if (acknowledge && !acknowledge.disabled) {
                acknowledge.click()
                await wait(350)
              }
              const confirm = document.querySelector('.outline-inspector .planning-confirm')
              if (!confirm || confirm.disabled) return { ok: false, step: 'review-confirm-disabled' }
              confirm.click()
              await wait(400)
              let status = await window.novelDesktop.outlines.planningStatus()
              if (status.totalApproval.status !== 'confirmed') return { ok: false, step: 'review-not-confirmed' }
              const volumeTitle = document.querySelector('#volume-title')
              const volumeForm = volumeTitle?.closest('form')
              if (!volumeTitle || !volumeForm) return { ok: false, step: 'volume-directory-form' }
              volumeTitle.value = '城门旧雨'
              volumeTitle.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(80)
              const createVolumeAction = volumeForm.querySelector('button')
              if (!createVolumeAction || createVolumeAction.disabled) return { ok: false, step: 'volume-directory-create-disabled' }
              createVolumeAction.click()
              await wait(450)
              status = await window.novelDesktop.outlines.planningStatus()
              if (status.volumes.length !== 1 || status.volumes[0]?.title !== '城门旧雨' || status.totalApproval.status === 'confirmed') return { ok: false, step: 'volume-directory-created', volumes: status.volumes.map((item) => ({ volume: item.volume, title: item.title })), totalStatus: status.totalApproval.status, toast: document.querySelector('.toast')?.textContent }
              let totalReview = (await window.novelDesktop.outlines.planningStatus()).totalReview
              if (totalReview.status === 'attention') await window.novelDesktop.outlines.acknowledgeReview('total')
              status = await window.novelDesktop.outlines.confirmPlanning('total')
              if (status.totalApproval.status !== 'confirmed') return { ok: false, step: 'total-reconfirm-after-volume-directory' }
              document.querySelector('[data-activity="preparation"]')?.click()
              await wait(220)
              document.querySelector('[data-testid="preparation-continuation"]')?.click()
              for (let index = 0; index < 30; index += 1) {
                if (document.querySelector('[data-testid="view-confirmed-continuation-total-outline"]')) break
                await wait(100)
              }
              const candidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              const confirmedAction = document.querySelector('[data-testid="view-confirmed-continuation-total-outline"]')
              confirmedAction?.scrollIntoView({ block: 'center' })
              await wait(120)
              const planning = await window.novelDesktop.outlines.planningStatus()
              return { ok: Boolean(candidate?.adoption?.totalOutline && planning.totalApproval.status === 'confirmed'), step: 'review-confirmed-state', planning }
            })()`)
            if (!continuationTotalOutlineReviewPassed.ok) {
              console.error(`[desktop smoke] continuation total-outline review handoff failed: ${JSON.stringify(continuationTotalOutlineReviewPassed)}`)
              return app.exit(1)
            }
            const continuationTotalOutlineReviewCapturePath = process.env.LANJIAN_CONTINUATION_TOTAL_OUTLINE_REVIEW_CAPTURE_PATH
            if (continuationTotalOutlineReviewCapturePath) await writeFile(continuationTotalOutlineReviewCapturePath, (await window.capturePage()).toPNG())
            smokeDriverStage = 'continuation-volume-outline-preview'
            const continuationVolumeOutlinePreviewPassed = await window.webContents.executeJavaScript(`(async () => {
              window.__continuationVolumeBefore = {
                outlines: await window.novelDesktop.outlines.list(),
                chapterOutlines: await window.novelDesktop.chapterOutlines.list(),
                chapters: await window.novelDesktop.chapters.list()
              }
              const candidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              if (!candidate) return { ok: false, step: 'candidate-missing' }
              const preview = await window.novelDesktop.imports.previewContinuationVolumeOutline(candidate.id, 1)
              window.__continuationVolumePreview = preview
              return { ok: Boolean(preview.canAdopt
                && preview.volumeTitle === '城门旧雨'
                && preview.candidateOutline.includes('第一卷从城门脚印追到旧录音棚')), step: 'preview-visible' }
            })()`)
            if (!continuationVolumeOutlinePreviewPassed.ok) {
              console.error(`[desktop smoke] continuation volume-outline preview failed at ${continuationVolumeOutlinePreviewPassed.step}`)
              return app.exit(1)
            }
            smokeDriverStage = 'continuation-volume-outline-adoption'
            const continuationVolumeOutlineAdoptionPassed = await window.webContents.executeJavaScript(`(async () => {
              const before = window.__continuationVolumeBefore
              const preview = window.__continuationVolumePreview
              if (!preview) return false
              await window.novelDesktop.imports.adoptContinuationVolumeOutline({ candidateId: preview.candidateId, volume: preview.volume, candidateFingerprint: preview.candidateFingerprint, currentOutlineFingerprint: preview.currentOutlineFingerprint, parentTotalFingerprint: preview.parentTotalFingerprint })
              const outlines = await window.novelDesktop.outlines.list()
              const chapterOutlines = await window.novelDesktop.chapterOutlines.list()
              const chapters = await window.novelDesktop.chapters.list()
              const planning = await window.novelDesktop.outlines.planningStatus()
              const candidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              const safe = outlines.volumes[0]?.content === '第一卷从城门脚印追到旧录音棚，沈砚最终决定重返舞台。'
                && planning.totalApproval.status === 'confirmed'
                && planning.volumes[0]?.approval.status !== 'confirmed'
                && candidate?.adoption?.volumeOutlines?.[0]?.volume === 1
                && JSON.stringify(chapterOutlines) === JSON.stringify(before.chapterOutlines)
                && JSON.stringify(chapters) === JSON.stringify(before.chapters)
                && outlines.total?.content === before.outlines.total?.content
              delete window.__continuationVolumeBefore
              delete window.__continuationVolumePreview
              return safe
            })()`)
            if (!continuationVolumeOutlineAdoptionPassed) {
              console.error('[desktop smoke] continuation volume-outline adoption changed parent, chapters or unrelated content')
              return app.exit(1)
            }
            smokeDriverStage = 'continuation-volume-outline-review'
            const continuationVolumeOutlineReviewPassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              let status = await window.novelDesktop.outlines.planningStatus()
              const volumeReview = status.volumes[0]?.review
              if (volumeReview?.status === 'attention') await window.novelDesktop.outlines.acknowledgeReview(1)
              status = await window.novelDesktop.outlines.confirmPlanning(1)
              if (status.volumes[0]?.approval.status !== 'confirmed') return { ok: false, step: 'review-not-confirmed' }
              status = await window.novelDesktop.outlines.placeChapter(1, 1)
              if (status.chapterPlacements.find((item) => item.chapterId === 1)?.volume !== 1 || status.totalApproval.status === 'confirmed') return { ok: false, step: 'chapter-placement-not-versioned' }
              if (status.totalReview.status === 'attention') await window.novelDesktop.outlines.acknowledgeReview('total')
              status = await window.novelDesktop.outlines.confirmPlanning('total')
              const staleVolume = status.volumes.find((item) => item.volume === 1)
              if (staleVolume?.review.status === 'attention') await window.novelDesktop.outlines.acknowledgeReview(1)
              status = await window.novelDesktop.outlines.confirmPlanning(1)
              status = await window.novelDesktop.outlines.planningStatus(1)
              if (status.totalApproval.status !== 'confirmed' || status.volumes[0]?.approval.status !== 'confirmed') return { ok: false, step: 'placed-hierarchy-not-confirmed' }
              document.querySelector('[data-activity="preparation"]')?.click()
              await wait(220)
              document.querySelector('[data-testid="preparation-continuation"]')?.click()
              await wait(100)
              const candidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              const planning = await window.novelDesktop.outlines.planningStatus()
              return { ok: Boolean(candidate?.adoption?.volumeOutlines?.some((item) => item.volume === 1) && planning.volumes.find((item) => item.volume === 1)?.approval.status === 'confirmed'), step: 'confirmed-state' }
            })()`)
            if (!continuationVolumeOutlineReviewPassed.ok) {
              console.error(`[desktop smoke] continuation volume-outline review failed at ${continuationVolumeOutlineReviewPassed.step}`)
              return app.exit(1)
            }
            smokeDriverStage = 'continuation-chapter-outline'
            const continuationChapterOutlinePassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              window.__continuationChapterBefore = {
                outlines: await window.novelDesktop.outlines.list(),
                chapterOutlines: await window.novelDesktop.chapterOutlines.list(),
                chapters: await window.novelDesktop.chapters.list()
              }
              const candidateBefore = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              if (!candidateBefore) return { ok: false, step: 'candidate-missing' }
              const preview = await window.novelDesktop.imports.previewContinuationChapterOutline(candidateBefore.id, 1)
              if (!preview.canAdopt || !preview.candidateOutline.includes('沿线索追到旧录音棚')) return { ok: false, step: 'preview-visible' }
              await window.novelDesktop.imports.adoptContinuationChapterOutline({ candidateId: preview.candidateId, chapterId: preview.chapterId, candidateFingerprint: preview.candidateFingerprint, currentOutlineFingerprint: preview.currentOutlineFingerprint, parentTotalFingerprint: preview.parentTotalFingerprint, parentVolumeFingerprint: preview.parentVolumeFingerprint })
              const before = window.__continuationChapterBefore
              const outlines = await window.novelDesktop.outlines.list()
              const chapterOutlines = await window.novelDesktop.chapterOutlines.list()
              const chapters = await window.novelDesktop.chapters.list()
              const status = await window.novelDesktop.outlines.planningStatus(1)
              const candidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              if (!chapterOutlines.find((item) => item.chapterId === 1)?.content.includes('沿线索追到旧录音棚')
                || candidate?.adoption?.chapterOutlines?.[0]?.chapterId !== 1
                || status.chapter?.review.status === 'confirmed'
                || status.totalApproval.status !== 'confirmed'
                || status.volumes[0]?.approval.status !== 'confirmed'
                || JSON.stringify(outlines) !== JSON.stringify(before.outlines)
                || JSON.stringify(chapters) !== JSON.stringify(before.chapters)
                || before.chapterOutlines.filter((item) => item.chapterId !== 1).some((item) => chapterOutlines.find((next) => next.chapterId === item.chapterId)?.content !== item.content)) return { ok: false, step: 'adoption-safety' }
              const confirmed = await window.novelDesktop.outlines.confirmChapter(1)
              if (confirmed.chapter?.review.status !== 'confirmed') return { ok: false, step: 'review-not-confirmed' }
              document.querySelector('[data-activity="preparation"]')?.click()
              await wait(220)
              document.querySelector('[data-testid="preparation-continuation"]')?.click()
              await wait(100)
              const persistedCandidate = (await window.novelDesktop.imports.continuationAnalysis()).candidate
              delete window.__continuationChapterBefore
              return { ok: Boolean(persistedCandidate?.adoption?.chapterOutlines?.some((item) => item.chapterId === 1) && (await window.novelDesktop.outlines.planningStatus(1)).chapter?.review.status === 'confirmed'), step: 'confirmed-state' }
            })()`)
            if (!continuationChapterOutlinePassed.ok) {
              console.error(`[desktop smoke] continuation chapter-outline flow failed: ${JSON.stringify(continuationChapterOutlinePassed)}`)
              return app.exit(1)
            }
            await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"设置\"]')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 120))
            await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"settings-nav-project\"]')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 250))
          }
          const migrationPassed = await window.webContents.executeJavaScript(`(async () => {
            const button = Array.from(document.querySelectorAll('.migration-card button')).find((item) => item.textContent?.includes('安全升级'))
            if (!button) return false
            window.confirm = () => true
            button.click()
            await new Promise((resolve) => setTimeout(resolve, 650))
            return Boolean(document.querySelector('.migration-card')?.textContent?.includes('项目数据版本正常'))
          })()`)
          if (!migrationPassed) {
            console.error('[desktop smoke] project-migration click failed')
            return app.exit(1)
          }
          const shadowPreviewPassed = await window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            const open = document.querySelector('[data-testid="open-sqlite-shadow-migration"]')
            if (!open || open.disabled) return { ok: false, step: 'entry-missing' }
            const workbenchBefore = document.querySelector('.workbench')?.getBoundingClientRect()
            open.click()
            for (let index = 0; index < 40 && !document.querySelector('[data-testid="sqlite-shadow-migration-dialog"]'); index += 1) await wait(100)
            const dialog = document.querySelector('[data-testid="sqlite-shadow-migration-dialog"]')
            const confirm = document.querySelector('[data-testid="confirm-sqlite-shadow-migration"]')
            const workbenchAfter = document.querySelector('.workbench')?.getBoundingClientRect()
            const rect = dialog?.getBoundingClientRect()
            return {
              ok: Boolean(dialog?.textContent?.includes('建立 SQLite 影子副本')
                && dialog.textContent.includes('原稿不改写')
                && dialog.textContent.includes('版本只追加')
                && dialog.textContent.includes('.webnovel/workspace.sqlite')
                && confirm && !confirm.disabled
                && !document.querySelector('.assistant-panel')
                && workbenchBefore && workbenchAfter && Math.abs(workbenchBefore.width - workbenchAfter.width) < 1
                && rect && rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight),
              step: 'preview-visible',
              text: dialog?.textContent || '',
              workbenchBefore: workbenchBefore?.width,
              workbenchAfter: workbenchAfter?.width,
              dialogRect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null
            }
          })()`)
          if (!shadowPreviewPassed.ok) {
            console.error(`[desktop smoke] SQLite shadow preview failed: ${JSON.stringify(shadowPreviewPassed)}`)
            return app.exit(1)
          }
          const sqliteShadowCapturePath = process.env.LANJIAN_SQLITE_SHADOW_CAPTURE_PATH
          if (sqliteShadowCapturePath) await writeFile(sqliteShadowCapturePath, (await window.capturePage()).toPNG())
          const shadowImportPassed = await window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            document.querySelector('[data-testid="confirm-sqlite-shadow-migration"]')?.click()
            for (let index = 0; index < 60; index += 1) {
              const dialog = document.querySelector('[data-testid="sqlite-shadow-migration-dialog"]')
              if (dialog?.textContent?.includes('影子副本核对完成')) return dialog.textContent.includes('正式来源')
              await wait(100)
            }
            return false
          })()`)
          if (!shadowImportPassed) {
            console.error('[desktop smoke] SQLite shadow reviewed import failed')
            return app.exit(1)
          }
          await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('[data-testid=\"sqlite-shadow-migration-dialog\"] button')).find((item) => item.textContent?.includes('完成'))?.click()")
          const sqliteActivationPreviewPassed = await window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            for (let index = 0; index < 40 && !document.querySelector('[data-testid="open-sqlite-activation"]'); index += 1) await wait(100)
            const open = document.querySelector('[data-testid="open-sqlite-activation"]')
            if (!open || open.disabled) return { ok: false, step: 'activation-entry-missing', page: document.body.textContent }
            const workbenchBefore = document.querySelector('.workbench')?.getBoundingClientRect()
            open.click()
            for (let index = 0; index < 40 && !document.querySelector('[data-testid="sqlite-activation-dialog"]'); index += 1) await wait(100)
            const dialog = document.querySelector('[data-testid="sqlite-activation-dialog"]')
            const confirm = document.querySelector('[data-testid="confirm-sqlite-activation"]')
            const rect = dialog?.getBoundingClientRect()
            const workbenchAfter = document.querySelector('.workbench')?.getBoundingClientRect()
            return {
              ok: Boolean(dialog?.textContent?.includes('把 SQLite 设为正式数据源')
                && dialog.textContent.includes('不覆盖外部修改')
                && dialog.textContent.includes('安全退回')
                && confirm && !confirm.disabled
                && !document.querySelector('.assistant-panel')
                && workbenchBefore && workbenchAfter && Math.abs(workbenchBefore.width - workbenchAfter.width) < 1
                && rect && rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight),
              step: 'activation-preview-visible', text: dialog?.textContent || ''
            }
          })()`)
          if (!sqliteActivationPreviewPassed.ok) {
            console.error(`[desktop smoke] SQLite activation preview failed: ${JSON.stringify(sqliteActivationPreviewPassed)}`)
            return app.exit(1)
          }
          const sqliteActivationAuthorityPassed = await window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            document.querySelector('[data-testid="confirm-sqlite-activation"]')?.click()
            for (let index = 0; index < 60; index += 1) {
              const dialog = document.querySelector('[data-testid="sqlite-activation-dialog"]')
              if (dialog?.textContent?.includes('SQLite 已接管正文保存')) break
              await wait(100)
            }
            const formal = await window.novelDesktop.chapters.get(1)
            if (formal.storageMode !== 'sqlite') return { ok: false, step: 'formal-not-active', formal }
            Array.from(document.querySelectorAll('[data-testid="sqlite-activation-dialog"] button')).find((item) => item.textContent?.includes('完成'))?.click()
            const before = await window.novelDesktop.outlines.get('total')
            const content = before.content + '\\n\\nSQLite 正式大纲烟测。'
            const saved = await window.novelDesktop.outlines.update('total', content)
            const after = await window.novelDesktop.outlines.get('total')
            const status = await window.novelDesktop.projects.sqliteStorageStatus()
            document.querySelector('[aria-label="谋篇"]')?.click()
            for (let index = 0; index < 40 && !document.querySelector('.outline-editor'); index += 1) await wait(100)
            const explorer = document.querySelector('.explorer')
            const resizer = document.querySelector('.explorer-resizer')
            const editor = document.querySelector('.outline-editor')
            const uiReady = Boolean(explorer?.textContent?.includes('全局总纲') && resizer?.getBoundingClientRect().width && editor?.getBoundingClientRect().width)
            return {
              ok: saved.storageMode === 'sqlite' && after.content === content
                && status.outlineStorageMode === 'sqlite' && status.outlineCount >= 2
                && status.outlinePendingMirrors === 0 && status.outlineConflictMirrors === 0 && status.outlineFailedMirrors === 0 && uiReady,
              step: 'formal-outline-authority', saved, after: after.content, status, uiReady
            }
          })()`)
          if (!sqliteActivationAuthorityPassed.ok) {
            console.error(`[desktop smoke] SQLite outline authority failed: ${JSON.stringify(sqliteActivationAuthorityPassed)}`)
            return app.exit(1)
          }
          const realTrialScene = await window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            const setValue = (element, value) => {
              element.value = String(value)
              element.dispatchEvent(new Event('input', { bubbles: true }))
            }
            document.querySelector('[data-activity="settings"]')?.click()
            await wait(120)
            document.querySelector('[data-testid="settings-nav-trial"]')?.click()
            for (let index = 0; index < 40; index += 1) {
              const ready = document.querySelector('[data-testid="save-real-trial-chapter"]')
              if (ready && !ready.disabled && document.querySelector('[data-testid="real-trial-conclusion"]')) break
              await wait(100)
            }
            const section = document.querySelector('[data-testid="settings-page-real-trial"]')
            const chapter = document.querySelector('[data-testid="real-trial-chapter"]')
            const writing = document.querySelector('[data-testid="real-trial-writing-minutes"]')
            const save = document.querySelector('[data-testid="save-real-trial-chapter"]')
            const conclusion = document.querySelector('[data-testid="real-trial-conclusion"]')
            if (!section || !chapter || !writing || !save || save.disabled || !conclusion || !section.textContent.includes('自动统计')) return { ok: false, step: 'trial-entry', text: section?.textContent || '' }
            setValue(writing, 36)
            save.click()
            for (let index = 0; index < 40; index += 1) {
              await wait(100)
              const report = await window.novelDesktop.projects.realTrialReport()
              if (report.summary.chapterCount === 1) {
                section.scrollIntoView({ block: 'start' })
                await wait(200)
                return { ok: section.textContent.includes('1/20 章') && conclusion.textContent.includes('再记录 19 章后开放') && !document.querySelector('[data-testid="save-real-trial-conclusion"]') && report.summary.totalHumanMinutes === 36 && report.summary.diffAcceptedBlocks === 0, step: 'trial-saved', report: report.summary }
              }
            }
            return { ok: false, step: 'trial-timeout', text: section.textContent || '' }
          })()`)
          if (!realTrialScene.ok) {
            console.error(`[desktop smoke] real chapter trial failed at ${realTrialScene.step}: ${JSON.stringify(realTrialScene)}`)
            return app.exit(1)
          }
          const realTrialCapturePath = process.env.LANJIAN_REAL_TRIAL_CAPTURE_PATH
          if (realTrialCapturePath) {
            await window.webContents.executeJavaScript(`document.querySelector('[data-testid="real-trial-conclusion"]')?.scrollIntoView({ block: 'center' })`)
            await new Promise((resolve) => setTimeout(resolve, 200))
            await writeFile(realTrialCapturePath, (await window.capturePage()).toPNG())
          }
          if (process.env.LANJIAN_SMOKE === '1') {
            if (!smokeSeedFactReview) {
              console.error('[desktop smoke] fact review seeder is unavailable')
              return app.exit(1)
            }
            await smokeSeedFactReview()
            const factReviewScene = await runFactReviewSceneScenario({ window })
            if (!factReviewScene.ok) {
              console.error(`[desktop smoke] partial fact approval failed: ${JSON.stringify(factReviewScene)}`)
              return app.exit(1)
            }
            const factReviewCapturePath = process.env.LANJIAN_FACT_REVIEW_CAPTURE_PATH
            if (factReviewCapturePath) await writeFile(factReviewCapturePath, (await window.capturePage()).toPNG())
          }
          const resourceLedgerScene = await runResourceLedgerSceneScenario({ window })
          if (!resourceLedgerScene.ok) {
            console.error(`[desktop smoke] resource ledger flow failed: ${JSON.stringify(resourceLedgerScene)}`)
            return app.exit(1)
          }
          const resourceLedgerCapturePath = process.env.LANJIAN_RESOURCE_LEDGER_CAPTURE_PATH
          if (resourceLedgerCapturePath) await writeFile(resourceLedgerCapturePath, (await window.capturePage()).toPNG())
          const foreshadowLedgerScene = await window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            const planted = await window.novelDesktop.workspace.recordForeshadowAction({
              operationKey: '30000000-0000-4000-8000-000000000101', action: 'plant', title: '半枚脚印带有酒馆后巷的红泥',
              legacyChapterId: 1, description: '雨夜城门首次出现半枚脚印', sourceType: 'manual'
            })
            document.querySelector('[data-activity="timeline"]')?.click()
            for (let index = 0; index < 40 && !document.querySelector('[data-testid="timeline-mode-foreshadows"]'); index += 1) await wait(100)
            document.querySelector('[data-testid="timeline-mode-foreshadows"]')?.click()
            for (let index = 0; index < 40 && !document.querySelector('[data-testid="timeline-foreshadows-view"]'); index += 1) await wait(100)
            const view = document.querySelector('[data-testid="timeline-foreshadows-view"]')
            const form = view?.querySelector('.foreshadow-action-form')
            const selects = form?.querySelectorAll('select') || []
            const inputs = form?.querySelectorAll('input') || []
            const textarea = form?.querySelector('textarea')
            const submit = form?.querySelector('[data-testid="record-foreshadow-action"]')
            if (!view || selects.length < 1 || inputs.length < 1 || !textarea || !submit) return {
              ok: false,
              step: 'foreshadow-ui-missing',
              activeActivity: document.querySelector('.creation-activity.selected')?.getAttribute('data-activity') || '',
              timelineModeAvailable: Boolean(document.querySelector('[data-testid="timeline-mode-foreshadows"]')),
              mainText: document.querySelector('.workbench')?.textContent?.slice(0, 500) || ''
            }
            const setValue = (element, value, eventName = 'input') => {
              element.value = value
              element.dispatchEvent(new Event(eventName, { bubbles: true }))
            }
            setValue(selects[0], 'advance', 'change')
            await wait(80)
            const refreshedForm = view.querySelector('.foreshadow-action-form')
            const refreshedSelects = refreshedForm?.querySelectorAll('select') || []
            if (!refreshedForm || refreshedSelects.length < 2) return { ok: false, step: 'foreshadow-target-missing' }
            setValue(refreshedSelects[1], planted.foreshadow.id, 'change')
            setValue(refreshedForm.querySelector('input'), '1')
            setValue(refreshedForm.querySelector('textarea'), '脚印的红泥与酒馆后巷泥层一致')
            refreshedForm.querySelector('[data-testid="record-foreshadow-action"]')?.click()
            let ledger = null
            let refreshedAfterWrite = false
            for (let index = 0; index < 40; index += 1) {
              ledger = await window.novelDesktop.workspace.getForeshadowLedger()
              if (ledger.actions.length === 2 && document.querySelectorAll('[data-testid="timeline-foreshadows-view"] .foreshadow-history li').length === 2) break
              if (ledger.actions.length === 2 && !refreshedAfterWrite) {
                refreshedAfterWrite = true
                document.querySelector('[data-testid="timeline-mode-events"]')?.click()
                await wait(80)
                document.querySelector('[data-testid="timeline-mode-foreshadows"]')?.click()
              }
              await wait(100)
            }
            const refreshedView = document.querySelector('[data-testid="timeline-foreshadows-view"]')
            return {
              ok: Boolean(ledger?.foreshadows[0]?.status === 'open' && ledger.actions.length === 2
                && document.querySelector('.timeline-workbench-header')?.textContent?.includes('动作历史不会被无痕改写')
                && refreshedView.querySelectorAll('.foreshadow-history li').length === 2),
              step: 'foreshadow-recorded', ledger
            }
          })()`)
          if (!foreshadowLedgerScene.ok) {
            console.error(`[desktop smoke] foreshadow ledger flow failed: ${JSON.stringify(foreshadowLedgerScene)}`)
            return app.exit(1)
          }
          const foreshadowLedgerCapturePath = process.env.LANJIAN_FORESHADOW_LEDGER_CAPTURE_PATH
          if (foreshadowLedgerCapturePath) await writeFile(foreshadowLedgerCapturePath, (await window.capturePage()).toPNG())
          const sqliteFormalCapturePath = process.env.LANJIAN_SQLITE_FORMAL_CAPTURE_PATH
          if (sqliteFormalCapturePath) await writeFile(sqliteFormalCapturePath, (await window.capturePage()).toPNG())
          if (process.env.LANJIAN_SMOKE_CONTEXT_PREFLIGHT === '1') {
            const contextPreflightScene = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-activity="desk"]')?.click()
              for (let index = 0; index < 50 && !document.querySelector('[data-testid="manuscript-input"]'); index += 1) await wait(100)
              if (!document.querySelector('.assistant-panel')) document.querySelector('[aria-controls="assistant-drawer"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="assistant-mode-agent"]'); index += 1) await wait(100)
              document.querySelector('[data-testid="assistant-mode-agent"]')?.click()
              await wait(80)
              document.querySelector('[data-testid="open-agent-skills"]')?.click()
              await wait(60)
              const querySkill = Array.from(document.querySelectorAll('.agent-skill-menu button')).find((item) => item.textContent?.includes('问答'))
              if (!querySkill) return { ok: false, step: 'query-skill-missing' }
              if (querySkill.getAttribute('aria-pressed') === 'true') document.querySelector('[data-testid="open-agent-skills"]')?.click()
              else querySkill.click()
              document.querySelector('[data-testid="open-writing-agent-context"]')?.click()
              for (let index = 0; index < 50 && !document.querySelector('[data-context-preview-id="workspace:timeline"]'); index += 1) await wait(100)
              let preflight = document.querySelector('[data-testid="writing-agent-context-preflight"]')
              let timeline = preflight?.querySelector('[data-context-preview-id="workspace:timeline"]')
              const remove = Array.from(timeline?.querySelectorAll('button') || []).find((item) => item.textContent?.includes('移除'))
              const temporary = preflight?.querySelector('.agent-context-temporary textarea')
              if (!preflight || !timeline || !remove || !temporary) return { ok: false, step: 'preflight-controls-missing', text: preflight?.textContent || '' }
              remove.click()
              temporary.value = '烟测临时依据：窗外正在下雨。'
              temporary.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(60)
              preflight.querySelector('.agent-context-temporary > button')?.click()
              for (let index = 0; index < 50; index += 1) {
                preflight = document.querySelector('[data-testid="writing-agent-context-preflight"]')
                timeline = preflight?.querySelector('[data-context-preview-id="workspace:timeline"]')
                if (preflight?.textContent?.includes('本次补充 1') && timeline?.textContent?.includes('本次移除')) break
                await wait(100)
              }
              if (!preflight?.textContent?.includes('本次补充 1') || !timeline?.textContent?.includes('作者本次移除')) return { ok: false, step: 'selection-not-reflected', text: preflight?.textContent || '' }
              preflight.querySelector('[aria-label="收起本次依据"]')?.click()
              const input = document.querySelector('[data-testid="writing-agent-input"]')
              if (!input) return { ok: false, step: 'composer-missing' }
              input.value = '烟测本次上下文预检：当前章依据是什么？'
              input.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(80)
              document.querySelector('[data-testid="run-writing-agent"]')?.click()
              let storedTask = null
              for (let index = 0; index < 100; index += 1) {
                const tasks = await window.novelDesktop.ai.listWritingAgentTasks(1)
                storedTask = tasks.find((task) => task.message.includes('烟测本次上下文预检')) || null
                if (storedTask?.status === 'succeeded') break
                if (storedTask?.status === 'failed') return { ok: false, step: 'task-failed', task: storedTask }
                await wait(100)
              }
              const frozen = storedTask?.contextPackage?.contexts || []
              if (!frozen.some((context) => context.id?.startsWith('temporary:') && context.preview.includes('烟测临时依据：窗外正在下雨。'))) return { ok: false, step: 'temporary-not-frozen', frozen }
              if (frozen.some((context) => context.id === 'workspace:timeline')) return { ok: false, step: 'removed-source-frozen', frozen }
              document.querySelector('[data-testid="open-writing-agent-context"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="writing-agent-context-preflight"]'); index += 1) await wait(80)
              return { ok: true, step: 'preflight-frozen', frozenIds: frozen.map((context) => context.id), contextCount: storedTask.contextPackage.contextCount }
            })()`)
            if (!contextPreflightScene.ok) {
              console.error(`[desktop smoke] writing context preflight failed: ${JSON.stringify(contextPreflightScene)}`)
              return app.exit(1)
            }
            const contextPreflightCapturePath = process.env.LANJIAN_CONTEXT_PREFLIGHT_CAPTURE_PATH
            if (contextPreflightCapturePath) await writeFile(contextPreflightCapturePath, (await window.capturePage()).toPNG())
            console.info(`[desktop smoke] writing context preflight passed: ${JSON.stringify(contextPreflightScene)}`)
          }
          smokeDriverStage = 'sqlite-activation-round-trip'
          const rollbackTriggered = await window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            document.querySelector('[aria-label="设置"]')?.click()
            for (let index = 0; index < 40 && !document.querySelector('[data-testid="settings-nav-project"]'); index += 1) await wait(100)
            document.querySelector('[data-testid="settings-nav-project"]')?.click()
            for (let index = 0; index < 40 && !document.querySelector('[data-testid="rollback-sqlite-storage"]'); index += 1) await wait(100)
            const rollback = document.querySelector('[data-testid="rollback-sqlite-storage"]')
            if (!rollback || rollback.disabled) return false
            window.confirm = () => true
            rollback.click()
            return true
          })()`)
          let rollbackStatus: { storageMode?: string } | null = null
          for (let index = 0; rollbackTriggered && index < 80 && rollbackStatus?.storageMode !== 'file' && rollbackStatus?.storageMode !== 'shadow'; index += 1) {
            await new Promise((resolve) => setTimeout(resolve, 100))
            rollbackStatus = await window.webContents.executeJavaScript('window.novelDesktop.projects.sqliteStorageStatus()').catch(() => rollbackStatus)
          }
          if (rollbackStatus?.storageMode === 'file' || rollbackStatus?.storageMode === 'shadow') {
            // The renderer reloads the active work item after rollback. Let that
            // in-flight reload settle before the test reactivates SQLite.
            await new Promise((resolve) => setTimeout(resolve, 2_500))
          }
          let sqliteActivationRoundTripPassed: { ok: boolean; step: string; [key: string]: unknown }
          if (!rollbackTriggered || !rollbackStatus || rollbackStatus.storageMode === 'sqlite') {
            sqliteActivationRoundTripPassed = { ok: false, step: rollbackTriggered ? 'rollback-timeout' : 'rollback-action-missing', rollbackStorageMode: rollbackStatus?.storageMode }
          } else {
            smokeDriverStage = 'sqlite-round-trip-file-read'
            const fileChapter = await window.webContents.executeJavaScript('window.novelDesktop.chapters.get(1)')
            smokeDriverStage = 'sqlite-round-trip-preview'
            const preview = await window.webContents.executeJavaScript('window.novelDesktop.projects.previewSqliteActivation()')
            if (fileChapter.storageMode === 'sqlite') {
              sqliteActivationRoundTripPassed = { ok: false, step: 'round-trip-file-read', rollbackStorageMode: rollbackStatus.storageMode }
            } else if (!preview.canActivate || !preview.token) {
              sqliteActivationRoundTripPassed = { ok: false, step: 'round-trip-reactivation-preview', preview }
            } else {
              smokeDriverStage = 'sqlite-round-trip-commit'
              const activated = await window.webContents.executeJavaScript(`window.novelDesktop.projects.activateSqliteStorage(${JSON.stringify(preview.token)})`)
              smokeDriverStage = 'sqlite-round-trip-formal-read'
              let formal: { storageMode?: string } | null = null
              let formalReadError = ''
              for (let index = 0; index < 50 && formal?.storageMode !== 'sqlite'; index += 1) {
                try {
                  formal = await window.webContents.executeJavaScript('window.novelDesktop.chapters.get(1)')
                } catch (error) {
                  formalReadError = error instanceof Error ? error.message : String(error)
                }
                if (formal?.storageMode !== 'sqlite') await new Promise((resolve) => setTimeout(resolve, 100))
              }
              sqliteActivationRoundTripPassed = {
                ok: activated.storageMode === 'sqlite' && formal?.storageMode === 'sqlite',
                step: 'round-trip-complete-and-reactivated',
                rollbackStorageMode: rollbackStatus.storageMode,
                finalStorageMode: activated.storageMode,
                formalReadError
              }
            }
          }
          if (!sqliteActivationRoundTripPassed.ok) {
            console.error(`[desktop smoke] SQLite activation round trip failed: ${JSON.stringify(sqliteActivationRoundTripPassed)}`)
            return app.exit(1)
          }
          if (process.env.LANJIAN_SMOKE_STORAGE_ONLY === '1') return app.exit(0)
          smokeDriverStage = 'prompt-workshop'
          const promptWorkshopPassed = await runPromptWorkshopPassedScenario({ window })
          if (!promptWorkshopPassed.ok) {
            console.error('[desktop smoke] prompt workshop click failed', promptWorkshopPassed)
            return app.exit(1)
          }
          await new Promise((resolve) => setTimeout(resolve, 180))
          await writeFile(settingsCapturePath, (await window.capturePage()).toPNG())
          const actionSystemCapturePath = process.env.LANJIAN_ACTION_SYSTEM_CAPTURE_PATH
          if (actionSystemCapturePath) {
            smokeDriverStage = 'action-system-capture'
            await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"settings-nav-research\"]')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 180))
            await writeFile(actionSystemCapturePath, (await window.capturePage()).toPNG())
          }
          const appearanceCapturePath = process.env.LANJIAN_APPEARANCE_CAPTURE_PATH
          if (appearanceCapturePath) {
            smokeDriverStage = 'appearance-settings'
            const appearanceValid = await window.webContents.executeJavaScript(`(async () => {
              document.querySelector('[data-testid="settings-nav-appearance"]')?.click()
              await new Promise((resolve) => setTimeout(resolve, 180))
              const page = document.querySelector('[data-testid="settings-page-appearance"]')
              const ranges = document.querySelectorAll('.appearance-sliders input[type="range"]')
              const save = Array.from(document.querySelectorAll('.appearance-section button')).find((item) => item.textContent?.includes('保存界面偏好'))
              const resizer = document.querySelector('.explorer-resizer')
              const explorer = document.querySelector('.explorer')
              const before = explorer?.getBoundingClientRect().width || 0
              const resizerLeft = resizer?.getBoundingClientRect().left || 0
              resizer?.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: resizerLeft, bubbles: true }))
              window.dispatchEvent(new PointerEvent('pointermove', { clientX: resizerLeft + 16 }))
              window.dispatchEvent(new PointerEvent('pointerup', { clientX: resizerLeft + 16 }))
              await new Promise((resolve) => setTimeout(resolve, 40))
              const afterPointer = explorer?.getBoundingClientRect().width || 0
              resizer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
              await new Promise((resolve) => setTimeout(resolve, 40))
              const afterKeyboard = explorer?.getBoundingClientRect().width || 0
              return Boolean(page && ranges.length === 2 && save?.classList.contains('save-action') && resizer && afterPointer >= before + 15 && afterKeyboard <= afterPointer - 15)
            })()`)
            if (!appearanceValid) {
              console.error('[desktop smoke] appearance settings or explorer resizer missing')
              return app.exit(1)
            }
            await writeFile(appearanceCapturePath, (await window.capturePage()).toPNG())
          }
        }
        const planningCapturePath = process.env.LANJIAN_PLANNING_CAPTURE_PATH
        if (planningCapturePath && bridgeReady) {
          smokeDriverStage = 'automatic-planning'
          const planningPassed = await runPlanningPassedScenario({ window })
          if (!planningPassed.ok) {
            console.error(`[desktop smoke] automatic-planning click failed at ${planningPassed.step}: ${JSON.stringify(planningPassed)}`)
            return app.exit(1)
          }
          await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"planning-proposal\"]')?.scrollIntoView({ block: 'start' })")
          await new Promise((resolve) => setTimeout(resolve, 160))
          await writeFile(planningCapturePath, (await window.capturePage()).toPNG())
          const chapterSkeletonCapturePath = process.env.LANJIAN_CHAPTER_SKELETON_CAPTURE_PATH
          if (chapterSkeletonCapturePath) {
            await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"chapter-skeleton-candidate\"]')?.scrollIntoView({ block: 'start' })")
            await new Promise((resolve) => setTimeout(resolve, 160))
            await writeFile(chapterSkeletonCapturePath, (await window.capturePage()).toPNG())
          }
          const chapterDetailCapturePath = process.env.LANJIAN_CHAPTER_DETAIL_CAPTURE_PATH
          if (chapterDetailCapturePath) {
            await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"chapter-detail-candidate\"]')?.scrollIntoView({ block: 'start' })")
            await new Promise((resolve) => setTimeout(resolve, 160))
            await writeFile(chapterDetailCapturePath, (await window.capturePage()).toPNG())
          }
          const chapterDetailAdoptionCapturePath = process.env.LANJIAN_CHAPTER_DETAIL_ADOPTION_CAPTURE_PATH
          if (chapterDetailAdoptionCapturePath) {
            await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"chapter-detail-candidate\"]')?.scrollIntoView({ block: 'start' })")
            await new Promise((resolve) => setTimeout(resolve, 160))
            await writeFile(chapterDetailAdoptionCapturePath, (await window.capturePage()).toPNG())
          }
        }
        const researchCapturePath = process.env.LANJIAN_RESEARCH_CAPTURE_PATH
        if (researchCapturePath) {
          await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"素材\"]')?.click()")
          await new Promise((resolve) => setTimeout(resolve, 300))
          smokeDriverStage = 'research-ledger'
          const researchLedgerPassed = await runResearchLedgerPassedScenario({ window })
          if (!researchLedgerPassed.ok) {
            console.error(`[desktop smoke] research-ledger click failed at ${researchLedgerPassed.step}: ${JSON.stringify(researchLedgerPassed)}`)
            return app.exit(1)
          }
          await window.webContents.executeJavaScript("document.querySelector('.material-workbench')?.scrollIntoView({ block: 'start' })")
          await new Promise((resolve) => setTimeout(resolve, 180))
          await writeFile(researchCapturePath, (await window.capturePage()).toPNG())
        }
        const timelineCapturePath = process.env.LANJIAN_TIMELINE_CAPTURE_PATH
        if (timelineCapturePath) {
          smokeDriverStage = 'timeline-projection'
          const timelineProjectionPassed = await window.webContents.executeJavaScript(`(async () => {
            document.querySelector('[aria-label="纪事"]')?.click()
            await new Promise((resolve) => setTimeout(resolve, 300))
            const projected = Array.from(document.querySelectorAll('.timeline-axis-entry.formal')).find((item) => item.textContent?.includes('旧录音设备'))
            const candidateLeaked = Array.from(document.querySelectorAll('.timeline-axis-entry')).some((item) => item.textContent?.includes('候选'))
            return Boolean(projected?.textContent?.includes('待入总纲') && !candidateLeaked)
          })()`)
          if (!timelineProjectionPassed) {
            console.error('[desktop smoke] approved-event timeline projection failed')
            return app.exit(1)
          }
          await writeFile(timelineCapturePath, (await window.capturePage()).toPNG())
          const characterLinesCapturePath = process.env.LANJIAN_CHARACTER_LINES_CAPTURE_PATH
          if (characterLinesCapturePath) {
            await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"timeline-mode-characters\"]')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 220))
            await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"timeline-character-tracks\"]')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 80))
            await writeFile(characterLinesCapturePath, (await window.capturePage()).toPNG())
          }
          const volumeLinesCapturePath = process.env.LANJIAN_VOLUME_LINES_CAPTURE_PATH
          if (volumeLinesCapturePath) {
            await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"timeline-mode-volumes\"]')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 180))
            await writeFile(volumeLinesCapturePath, (await window.capturePage()).toPNG())
          }
          await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"timeline-mode-events\"]')?.click()")
        }
        const outlineCapturePath = process.env.LANJIAN_OUTLINE_CAPTURE_PATH
        if (outlineCapturePath) {
          smokeDriverStage = 'outline-version-gate'
          const outlineGatePassed = await runOutlineGatePassedScenario({ window })
          if (!outlineGatePassed.ok) {
            console.error(`[desktop smoke] outline-version gate failed: ${JSON.stringify(outlineGatePassed)}`)
            return app.exit(1)
          }
          smokeDriverStage = 'outline-captures'
          const totalOutlineEditorCapturePath = process.env.LANJIAN_TOTAL_OUTLINE_EDITOR_CAPTURE_PATH
          if (totalOutlineEditorCapturePath) {
            await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.trim() === '总纲')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 160))
            await writeFile(totalOutlineEditorCapturePath, (await window.capturePage()).toPNG())
          }
          const volumeCapturePath = process.env.LANJIAN_VOLUME_CAPTURE_PATH
          if (volumeCapturePath) {
            await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.trim() === '卷纲')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 160))
            await writeFile(volumeCapturePath, (await window.capturePage()).toPNG())
            await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.includes('当前章纲'))?.click()")
            await new Promise((resolve) => setTimeout(resolve, 120))
          }
          await writeFile(outlineCapturePath, (await window.capturePage()).toPNG())
          smokeDriverStage = 'outline-version-recovery'
          const outlineRecovered = await window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            const confirmScope = async (scope) => {
              let planning = await window.novelDesktop.outlines.planningStatus(1)
              const status = scope === 'total' ? planning.totalApproval : planning.volumes.find((item) => item.volume === scope)?.approval
              if (status?.status === 'confirmed') return true
              const review = scope === 'total' ? planning.totalReview : planning.volumes.find((item) => item.volume === scope)?.review
              if (review?.status === 'attention') await window.novelDesktop.outlines.acknowledgeReview(scope)
              planning = await window.novelDesktop.outlines.confirmPlanning(scope)
              const confirmed = scope === 'total' ? planning.totalApproval : planning.volumes.find((item) => item.volume === scope)?.approval
              return confirmed?.status === 'confirmed'
            }
            if (!await confirmScope('total')) return { ok: false, step: 'total-formal-recovery', planning: await window.novelDesktop.outlines.planningStatus(1) }
            if (!await confirmScope(1)) return { ok: false, step: 'volume-formal-recovery', planning: await window.novelDesktop.outlines.planningStatus(1) }
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.includes('当前章纲'))?.click()
            await wait(120)
            const button = document.querySelector('[data-testid="save-outline-document"]')
            button?.click()
            await wait(350)
            const recoveryStatus = await window.novelDesktop.outlines.planningStatus(1)
            if (!recoveryStatus.chapter?.review.canConfirm) return { ok: false, step: 'chapter-confirm-recovery-ready', planning: recoveryStatus }
            await window.novelDesktop.outlines.confirmChapter(1)
            const confirmedStatus = await window.novelDesktop.outlines.planningStatus(1)
            return { ok: confirmedStatus.chapter?.review.status === 'confirmed'
              && !document.querySelector('.assistant-panel > .ink-action')?.disabled, step: 'chapter-confirm-recovery', planning: confirmedStatus }
          })()`)
          if (!outlineRecovered.ok) {
            console.error(`[desktop smoke] outline-version recovery failed at ${outlineRecovered.step}`)
            return app.exit(1)
          }
        }
        smokeDriverStage = 'manuscript-open'
        await window.webContents.executeJavaScript(`document.querySelector('[data-activity="desk"]')?.click()`)
        await new Promise((resolve) => setTimeout(resolve, 320))
        smokeDriverStage = 'manuscript-chapter-select'
        await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.tree-item')).find((item) => item.textContent?.includes('雨夜追迹'))?.click()`)
        await new Promise((resolve) => setTimeout(resolve, 280))
        smokeDriverStage = 'manuscript-layout-search'
        const manuscriptSearchPassed = await window.webContents.executeJavaScript(`(async () => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
          const search = document.querySelector('[data-testid="chapter-tree-search"]')
          const list = document.querySelector('[data-testid="chapter-tree-window"]')
          if (!search || !list) return { ok: false, step: 'chapter-search-elements' }
          const chapters = await window.novelDesktop.chapters.list()
          const target = chapters.find((chapter) => chapter.id !== 1) ?? chapters[0]
          if (!target) return { ok: false, step: 'chapter-search-fixture' }
          search.value = target.title
          search.dispatchEvent(new Event('input', { bubbles: true }))
          for (let index = 0; index < 40 && list.dataset.renderedCount !== '1'; index += 1) await wait(50)
          const filtered = list.dataset.renderedCount === '1' && list.textContent?.includes('第' + target.position + '章') && list.textContent?.includes(target.title)
          search.value = ''
          search.dispatchEvent(new Event('input', { bubbles: true }))
          const expected = String(chapters.length)
          for (let index = 0; index < 40 && list.dataset.renderedCount !== expected; index += 1) await wait(50)
          const after = await window.novelDesktop.chapters.list()
          const restored = list.dataset.renderedCount === expected
            && chapters.every((chapter) => list.textContent?.includes('第' + chapter.position + '章'))
            && !document.querySelector('[data-testid="chapter-window-previous"], [data-testid="chapter-window-next"]')
            && JSON.stringify(after) === JSON.stringify(chapters)
          return { ok: Boolean(filtered && restored), step: 'chapter-search', filtered, restored, renderedCount: list.dataset.renderedCount, chapterCount: chapters.length }
        })()`)
        if (!manuscriptSearchPassed.ok) {
          console.error(`[desktop smoke] manuscript search failed: ${JSON.stringify(manuscriptSearchPassed)}`)
          return app.exit(1)
        }
        smokeDriverStage = 'manuscript-layout-title'
        const manuscriptTitlePassed = await window.webContents.executeJavaScript(`(async () => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
          const input = document.querySelector('[data-testid="manuscript-title-input"]')
          const treeTitle = () => document.querySelector('.chapter-tree-editor b')
          if (!input || !treeTitle()) return { ok: false, step: 'title-elements' }
          input.focus()
          input.value = '雨夜追迹·标题烟测'
          input.dispatchEvent(new Event('input', { bubbles: true }))
          for (let index = 0; index < 40 && treeTitle()?.textContent !== '雨夜追迹·标题烟测'; index += 1) await wait(50)
          const synced = treeTitle()?.textContent === '雨夜追迹·标题烟测'
          input.value = '雨夜追迹'
          input.dispatchEvent(new Event('input', { bubbles: true }))
          for (let index = 0; index < 40 && treeTitle()?.textContent !== '雨夜追迹'; index += 1) await wait(50)
          return { ok: Boolean(synced && input.value === '雨夜追迹' && treeTitle()?.textContent === '雨夜追迹'), step: 'title-sync', synced, value: input.value, treeTitle: treeTitle()?.textContent || '' }
        })()`)
        if (!manuscriptTitlePassed.ok) {
          console.error(`[desktop smoke] manuscript title sync failed: ${JSON.stringify(manuscriptTitlePassed)}`)
          return app.exit(1)
        }
        await new Promise((resolve) => setTimeout(resolve, 1_200))
        smokeDriverStage = 'manuscript-layout'
        const manuscriptLayoutPassed = process.env.LANJIAN_SMOKE_DEEP_LAYOUT === '1'
          ? JSON.parse(await window.webContents.executeJavaScript(`(() => {
          try {
            const editor = document.querySelector('[data-testid="manuscript-input"]')
            const titleInput = document.querySelector('[data-testid="manuscript-title-input"]')
            const page = document.querySelector('.manuscript-page')
            const saveAction = document.querySelector('[data-testid="save-manuscript"]')
            const confirmAction = document.querySelector('[data-testid="confirm-current-chapter"]')
            const currentTreeTitle = document.querySelector('.chapter-tree-editor b')
            const currentTreeChapterLabel = document.querySelector('.chapter-tree-editor .chapter-no')
            if (!editor || !titleInput || !page || !saveAction || !currentTreeTitle || !currentTreeChapterLabel) return JSON.stringify({ ok: false, step: 'editor-layout-elements' })
            const editorRect = editor.getBoundingClientRect()
            const pageRect = page.getBoundingClientRect()
            const editorFrame = editor.closest('.plain-text-editor')?.getBoundingClientRect()
            const style = getComputedStyle(editor)
            const saveStyle = getComputedStyle(saveAction)
            const saveRect = saveAction.getBoundingClientRect()
            const confirmStyle = confirmAction ? getComputedStyle(confirmAction) : null
            const confirmRect = confirmAction?.getBoundingClientRect() || null
            const bodyStyle = getComputedStyle(document.body)
            const checks = {
              noPositionControl: !document.querySelector('.chapter-position-control'),
              titleValue: titleInput.value === '雨夜追迹',
              treeTitle: currentTreeTitle.textContent === '雨夜追迹',
              treeChapterLabel: currentTreeChapterLabel.textContent?.trim() === '第1章',
              saveClasses: saveAction.classList.contains('control-button') && saveAction.classList.contains('primary') && saveAction.classList.contains('save-action'),
              saveIcon: saveAction.querySelectorAll('svg').length === 1,
              saveBackground: saveStyle.backgroundColor !== 'rgba(0, 0, 0, 0)',
              saveRadius: saveStyle.borderRadius === '4px',
              saveFont: saveStyle.fontFamily === bodyStyle.fontFamily,
              confirmSizing: !confirmAction || (confirmStyle?.whiteSpace === 'nowrap' && Math.abs(confirmRect.height - saveRect.height) <= 1 && confirmRect.width >= 70),
              editorFont: style.fontFamily.includes('LanjianSerif'),
              editorFontSize: Number.parseFloat(style.fontSize) >= 15,
              guideLines: style.backgroundImage.includes('repeating-linear-gradient'),
              editorFrameWidth: Boolean(editorFrame && editorFrame.width >= pageRect.width - 2),
              editorFrameRight: Boolean(editorFrame && Math.abs(editorFrame.right - pageRect.right) <= 2),
              editorRectLeft: Boolean(editorFrame && editorRect.width > 0 && editorRect.left >= editorFrame.left - 1),
              editorRectRight: Boolean(editorFrame && editorRect.right <= editorFrame.right + 1)
            }
            const ok = Object.values(checks).every(Boolean)
            return JSON.stringify({ ok, step: ok ? 'manuscript-layout' : 'manuscript-layout-projection', checks, editorRect: { left: editorRect.left, right: editorRect.right, width: editorRect.width }, editorFrame: editorFrame ? { left: editorFrame.left, right: editorFrame.right, width: editorFrame.width } : null, pageRect: { left: pageRect.left, right: pageRect.right, width: pageRect.width }, background: style.backgroundImage, editorFamily: style.fontFamily, editorFontSize: style.fontSize, bodyFamily: bodyStyle.fontFamily, saveFamily: saveStyle.fontFamily, saveBackground: saveStyle.backgroundColor, saveRadius: saveStyle.borderRadius, saveWidth: saveRect.width, saveHeight: saveRect.height, confirmWidth: confirmRect?.width || null, confirmHeight: confirmRect?.height || null, confirmWhiteSpace: confirmStyle?.whiteSpace || null })
          } catch (error) {
            return JSON.stringify({ ok: false, step: 'manuscript-layout-exception', error: error?.stack || error?.message || String(error), view: document.body?.textContent?.slice(0, 1200) || '' })
          }
          })()`))
          : {
              ok: await (async () => {
                for (let attempt = 0; attempt < 50; attempt += 1) {
                  try {
                    const ready = await window.webContents.executeJavaScript(`(() => {
                      if (document.querySelector('[data-testid="manuscript-input"]')
                        && document.querySelector('.manuscript-page')
                        && document.querySelector('[data-testid="save-manuscript"]')
                        && document.querySelector('.chapter-tree-editor')) return true
                      const work = Array.from(document.querySelectorAll('.work-item-open')).find((button) => button.getAttribute('aria-label')?.includes('烟测书稿'))
                      if (work) work.click()
                      else document.querySelector('[data-activity="desk"]')?.click()
                      return false
                    })()`)
                    if (ready) return true
                  } catch {
                    // A title save may briefly replace the renderer context.
                  }
                  await new Promise((resolve) => setTimeout(resolve, 200))
                }
                return false
              })(),
              step: 'manuscript-layout-elements'
            }
        if (!manuscriptLayoutPassed.ok) {
          if (capturePath) await writeFile(capturePath.replace('single-workbench.png', 'manuscript-layout-failure.png'), (await window.capturePage()).toPNG())
          console.error(`[desktop smoke] manuscript layout failed at ${manuscriptLayoutPassed.step}: ${JSON.stringify(manuscriptLayoutPassed)}`)
          return app.exit(1)
        }
        const manuscriptLayoutCapturePath = process.env.LANJIAN_MANUSCRIPT_LAYOUT_CAPTURE_PATH
        if (manuscriptLayoutCapturePath) {
          smokeDriverStage = 'manuscript-layout-capture'
          await writeFile(manuscriptLayoutCapturePath, (await window.capturePage()).toPNG())
        }
        const importCapturePath = process.env.LANJIAN_IMPORT_CAPTURE_PATH
        if (importCapturePath) {
          smokeDriverStage = 'manuscript-import-open'
          await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"书稿\"]')?.click()")
          await new Promise((resolve) => setTimeout(resolve, 250))
          await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"import-manuscript-files\"]')?.click()")
          await new Promise((resolve) => setTimeout(resolve, 400))
          smokeDriverStage = 'manuscript-import-diagnosis'
          const importDiagnosisReady = await window.webContents.executeJavaScript(`(() => {
            const checked = Array.from(document.querySelectorAll('.chapter-select input')).filter((item) => item.checked)
            const reviewRows = document.querySelectorAll('.chapter-preview li.review')
            const materialChoice = Array.from(document.querySelectorAll('.ownership-grid button')).find((item) => item.textContent?.includes('我的作品相关'))
            const ok = checked.length === 2
              && reviewRows.length >= 2
              && document.querySelector('.chapter-diagnostic')?.textContent?.includes('连续可信章节')
              && Boolean(materialChoice && !materialChoice.disabled)
            return { ok, checked: checked.length, reviewRows: reviewRows.length, diagnostic: document.querySelector('.chapter-diagnostic')?.textContent || '', materialEnabled: Boolean(materialChoice && !materialChoice.disabled), entry: document.querySelector('.txt-import-modal')?.textContent?.slice(0, 1000) || '' }
          })()`)
          if (!importDiagnosisReady.ok) {
            console.error(`[desktop smoke] messy TXT diagnosis or material routing was not actionable: ${JSON.stringify(importDiagnosisReady)}`)
            return app.exit(1)
          }
          await writeFile(importCapturePath, (await window.capturePage()).toPNG())
          const externalImportCapturePath = process.env.LANJIAN_EXTERNAL_IMPORT_CAPTURE_PATH
          if (externalImportCapturePath) {
            await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.ownership-grid button')).find((item) => item.textContent?.includes('别人的作品'))?.click()")
            await new Promise((resolve) => setTimeout(resolve, 180))
            await writeFile(externalImportCapturePath, (await window.capturePage()).toPNG())
          }
          const proposalCapturePath = process.env.LANJIAN_PROPOSAL_CAPTURE_PATH
          const revisionCapturePath = process.env.LANJIAN_REVISION_CAPTURE_PATH
          if (revisionCapturePath) {
            await window.webContents.executeJavaScript("document.querySelector('.txt-import-modal .import-heading button')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 180))
            await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"open-manuscript-history\"]')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 350))
            await window.webContents.executeJavaScript("document.querySelector('.revision-body nav button:not([data-revision-current=\"true\"])')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 180))
            const revisionComparisonReady = await window.webContents.executeJavaScript(`(() => {
              const ledger = document.querySelector('.revision-ledger')
              const diff = ledger?.querySelector('[data-testid="revision-diff"]')
              const changes = diff?.querySelectorAll('.revision-change-block').length || 0
              return { ok: Boolean(ledger && diff && ledger.textContent.includes('与当前正文比较') && changes > 0), changes, text: ledger?.textContent?.slice(0, 900) || '' }
            })()`)
            if (!revisionComparisonReady.ok) {
              console.error(`[desktop smoke] revision comparison was not actionable: ${JSON.stringify(revisionComparisonReady)}`)
              return app.exit(1)
            }
            await writeFile(revisionCapturePath, (await window.capturePage()).toPNG())
            await window.webContents.executeJavaScript("document.querySelector('.revision-ledger > header > button')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 180))
          }
          if (proposalCapturePath) {
            if (!revisionCapturePath) {
              await window.webContents.executeJavaScript("document.querySelector('.txt-import-modal .import-heading button')?.click()")
              await new Promise((resolve) => setTimeout(resolve, 180))
            }
            const originalBounds = window.getBounds()
            window.setSize(1360, originalBounds.height)
            await new Promise((resolve) => setTimeout(resolve, 180))
            await window.webContents.executeJavaScript(`(() => {
              if (!document.querySelector('.assistant-panel')) document.querySelector('[aria-controls="assistant-drawer"]')?.click()
            })()`)
            await new Promise((resolve) => setTimeout(resolve, 180))
            const adaptiveAssistantLayout = await window.webContents.executeJavaScript(`(() => {
              const studio = document.querySelector('.studio')
              const explorer = document.querySelector('.explorer')
              const workbench = document.querySelector('.workbench')
              const panel = document.querySelector('.assistant-panel')
              const resizer = document.querySelector('.explorer-resizer')
              const assistantResizer = document.querySelector('.assistant-resizer')
              const explorerStyle = explorer ? getComputedStyle(explorer) : null
              const panelStyle = panel ? getComputedStyle(panel) : null
              const explorerRect = explorer?.getBoundingClientRect()
              const workbenchRect = workbench?.getBoundingClientRect()
              const panelRect = panel?.getBoundingClientRect()
              const manuscriptSaveRect = document.querySelector('[data-testid="save-manuscript"]')?.getBoundingClientRect()
              const columns = studio ? getComputedStyle(studio).gridTemplateColumns : ''
              return {
                ok: Boolean(explorerStyle
                  && panelStyle
                  && explorerRect
                  && workbenchRect
                  && panelRect
                  && manuscriptSaveRect
                  && resizer
                  && assistantResizer
                  && panelStyle.position === 'static'
                  && panel.dataset.layout === 'sidebar'
                  && explorerStyle.display !== 'none'
                  && explorerRect.width >= 180
                  && columns.split(' ').length === 4
                  && Math.abs(panelRect.right - window.innerWidth) <= 1
                  && Math.abs(explorerRect.right - workbenchRect.left) <= 1
                  && Math.abs(workbenchRect.right - panelRect.left) <= 1
                  && panelRect.left >= workbenchRect.right
                  && manuscriptSaveRect.right <= workbenchRect.right),
                position: panelStyle?.position,
                explorerDisplay: explorerStyle?.display,
                explorerWidth: explorerRect?.width,
                explorerRight: explorerRect?.right,
                columns,
                workbenchLeft: workbenchRect?.left,
                workbenchRight: workbenchRect?.right,
                panelRight: panelRect?.right,
                panelLeft: panelRect?.left,
                manuscriptSaveRight: manuscriptSaveRect?.right,
                resizerLeft: resizer?.getBoundingClientRect().left,
                assistantResizerLeft: assistantResizer?.getBoundingClientRect().left,
                viewportRight: window.innerWidth
              }
            })()`)
            window.setBounds(originalBounds)
            await new Promise((resolve) => setTimeout(resolve, 180))
            if (!adaptiveAssistantLayout.ok) {
              console.error(`[desktop smoke] adaptive assistant layout failed: ${JSON.stringify(adaptiveAssistantLayout)}`)
              return app.exit(1)
            }
            const assistantCloseRestore = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const before = document.querySelector('.workbench')?.getBoundingClientRect()
              document.querySelector('[aria-label="关闭智能助笔侧栏"]')?.click()
              await wait(100)
              const closed = !document.querySelector('.assistant-panel')
              const afterClose = document.querySelector('.workbench')?.getBoundingClientRect()
              document.querySelector('[aria-controls="assistant-drawer"]')?.click()
              await wait(100)
              const reopened = document.querySelector('.assistant-panel')
              const afterOpen = document.querySelector('.workbench')?.getBoundingClientRect()
              return {
                ok: Boolean(closed && reopened
                  && getComputedStyle(reopened).position === 'static'
                  && before && afterClose && afterOpen
                  && afterClose.width > before.width
                  && Math.abs(before.width - afterOpen.width) < 1),
                closed,
                reopened: Boolean(reopened),
                beforeWidth: before?.width,
                afterCloseWidth: afterClose?.width,
                afterOpenWidth: afterOpen?.width
              }
            })()`)
            if (!assistantCloseRestore.ok) {
              console.error(`[desktop smoke] assistant close/restore failed: ${JSON.stringify(assistantCloseRestore)}`)
              return app.exit(1)
            }
            smokeDriverStage = 'writing-agent-candidate'
            console.info('[desktop smoke] stage: writing-agent-candidate')
            const agentValid = await runAgentValidScenario({ window })
            if (!agentValid.ok) {
              console.error(`[desktop smoke] writing agent candidate failed: ${agentValid.reason}`)
              return app.exit(1)
            }
            await new Promise((resolve) => setTimeout(resolve, 120))
            await writeFile(proposalCapturePath, (await window.capturePage()).toPNG())
            const characterSettled = await window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const acceptInsertion = Array.from(document.querySelectorAll('.agent-diff-block button')).find((item) => item.textContent?.includes('接受修改'))
              if (!acceptInsertion) return { ok: false, reason: 'anchored-insertion-decision-missing' }
              acceptInsertion.click()
              await wait(80)
              const adopt = document.querySelector('[data-testid^="apply-agent-candidate-"]')
              if (!adopt || adopt.disabled) return { ok: false, reason: 'adopt-action-missing-or-disabled' }
              adopt.click()
              for (let attempt = 0; attempt < 20; attempt += 1) {
                if (window.__smokeEditorText().includes('临江酒馆前')) break
                await wait(100)
              }
              const appliedText = window.__smokeEditorText()
              if (!appliedText.includes('临江酒馆前')) return { ok: false, reason: 'candidate-not-applied-to-editor' }
              if (window.__anchoredContinuationTail && !appliedText.endsWith(window.__anchoredContinuationTail)) return { ok: false, reason: 'anchored-candidate-overwrote-existing-tail' }
              let stored = null
              for (let attempt = 0; attempt < 40; attempt += 1) {
                stored = await window.novelDesktop.chapters.get(1)
                if (stored.content.includes('临江酒馆前')) break
                await wait(120)
              }
              if (!stored?.content.includes('临江酒馆前')) return { ok: false, reason: 'candidate-not-saved-as-explicit-version' }
              for (let attempt = 0; attempt < 20 && !document.querySelector('[data-testid="manuscript-save-state"]')?.textContent?.includes('已存'); attempt += 1) await wait(100)
              const state = await window.novelDesktop.workspace.getCharacterState()
              const ok = !state.snapshots.some((item) => item.name === '沈砚' && item.throughChapter === 1)
              return { ok, reason: ok ? 'fast-candidate-saved-without-unreviewed-settlement' : 'fast-candidate-settled-without-review' }
            })()`)
            if (!characterSettled.ok) {
              console.error(`[desktop smoke] fast candidate settlement boundary failed: ${characterSettled.reason}`)
              return app.exit(1)
            }
            smokeDriverStage = 'selection-diff-preview'
            console.info('[desktop smoke] stage: selection-diff-preview')
            const selectionDiffReady = await runSelectionDiffReadyScenario({ window })
            if (!selectionDiffReady.ok) {
              console.error(`[desktop smoke] selection AI diff preview failed: ${JSON.stringify(selectionDiffReady)}`)
              return app.exit(1)
            }
            const diffCapturePath = process.env.LANJIAN_SELECTION_DIFF_CAPTURE_PATH
            if (diffCapturePath) await writeFile(diffCapturePath, (await window.capturePage()).toPNG())
            smokeDriverStage = 'selection-diff-apply'
            console.info('[desktop smoke] stage: selection-diff-apply')
            const diffBaseline = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify({ before: window.__selectionDiffBefore || '', tail: window.__selectionDiffTail || '' })`))
            const expectedAppliedText = ('连接正常' + diffBaseline.tail)
              .replace(/\r\n?/g, '\n')
              .split('\n')
              .map((line) => line.trim().replace(/^[\t 　]+/, ''))
              .filter(Boolean)
              .map((paragraph) => '　　' + paragraph)
              .join('\n\n')
            await window.webContents.executeJavaScript(`document.querySelector('[data-testid^="apply-agent-candidate-"]')?.click()`)
            let applied = false
            let explicitVersionSaved = false
            for (let index = 0; index < 60; index += 1) {
              try {
                const state = JSON.parse(await window.webContents.executeJavaScript(`(async () => JSON.stringify({ editor: window.__smokeEditorText?.() || '', saved: (await window.novelDesktop.chapters.get(1)).content }))()`))
                applied = state.editor === expectedAppliedText
                explicitVersionSaved = applied && state.saved === state.editor
                if (explicitVersionSaved) break
              } catch {
                // Applying a candidate remounts the result card; retry against the live context.
              }
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
            if (explicitVersionSaved) await window.webContents.executeJavaScript(`document.querySelector('[data-testid="manuscript-undo"]')?.click()`)
            let historyUndone = false
            for (let index = 0; index < 30 && explicitVersionSaved; index += 1) {
              try {
                historyUndone = await window.webContents.executeJavaScript(`window.__smokeEditorText?.() === ${JSON.stringify(diffBaseline.before)}`)
                if (historyUndone) break
              } catch {
                // Retry after the editor applies its history transaction.
              }
              await new Promise((resolve) => setTimeout(resolve, 80))
            }
            if (historyUndone) await window.webContents.executeJavaScript(`document.querySelector('[data-testid="save-manuscript"]')?.click()`)
            let restored = false
            for (let index = 0; index < 60 && historyUndone; index += 1) {
              try {
                restored = await window.webContents.executeJavaScript(`window.novelDesktop.chapters.get(1).then((chapter) => chapter.content === ${JSON.stringify(diffBaseline.before)})`)
                if (restored) break
              } catch {
                // Retry while the explicit save settles.
              }
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
            await window.webContents.executeJavaScript(`delete window.__selectionDiffBefore; delete window.__selectionDiffTail`).catch(() => undefined)
            const selectionDiffApplied = { ok: Boolean(applied && explicitVersionSaved && historyUndone && restored), applied, explicitVersionSaved, historyUndone, restored }
            if (!selectionDiffApplied.ok) {
              console.error(`[desktop smoke] selection AI diff apply failed: ${JSON.stringify(selectionDiffApplied)}`)
              return app.exit(1)
            }
            smokeDriverStage = 'writing-task-recovery'
            console.info('[desktop smoke] stage: writing-task-recovery')
            const writingTaskRecovery = await runWritingTaskRecoveryScenario({ window })
            if (!writingTaskRecovery.ok) {
              console.error(`[desktop smoke] writing task pause/resume failed: ${JSON.stringify(writingTaskRecovery)}`)
              return app.exit(1)
            }
            const writingTaskRecoveryCapturePath = process.env.LANJIAN_WRITING_TASK_RECOVERY_CAPTURE_PATH
            if (writingTaskRecoveryCapturePath) await writeFile(writingTaskRecoveryCapturePath, (await window.capturePage()).toPNG())
          }
        }
        if (bridgeReady) {
          if (process.env.LANJIAN_SMOKE === '1') {
            if (!smokeSeedContextState) {
              console.error('[desktop smoke] context-state seeder is unavailable')
              return app.exit(1)
            }
            // Other smoke scenes intentionally revise the first chapter. Seed
            // this author-adopted state at the point of assertion so the fact
            // pack verifies the current formal text, not an earlier revision.
            await smokeSeedContextState()
          }
          smokeDriverStage = 'context-fact-pack'
          console.info('[desktop smoke] stage: context-fact-pack')
          const factPackVerified = await runFactPackVerifiedScenario({ window })
          if (!factPackVerified.ok) {
            console.error(`[desktop smoke] context fact pack review failed: ${factPackVerified.reason}`)
            return app.exit(1)
          }
          const factPackCapturePath = process.env.LANJIAN_CONTEXT_FACT_PACK_CAPTURE_PATH
          if (factPackCapturePath) await writeFile(factPackCapturePath, (await window.capturePage()).toPNG())
          const findingLocated = await window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            const firstChapter = Array.from(document.querySelectorAll('.tree-item')).find((item) => item.textContent?.includes('第1章'))
              || document.querySelector('.tree-item')
            if (!firstChapter) return { ok: false, step: 'finding-first-chapter-missing' }
            firstChapter.click()
            for (let attempt = 0; attempt < 30; attempt += 1) {
              if (document.querySelector('[data-testid="manuscript-input"]')) break
              await wait(80)
            }
            document.querySelector('[data-activity="outline"]')?.click()
            for (let attempt = 0; attempt < 30; attempt += 1) {
              if (document.querySelector('[data-consistency-id="characterState"]')) break
              await wait(80)
            }
            document.querySelector('[data-consistency-id="characterState"]')?.click()
            for (let attempt = 0; attempt < 30; attempt += 1) {
              if (document.querySelector('[data-testid="locate-continuity-evidence"]')) break
              await wait(80)
            }
            const locate = document.querySelector('[data-testid="locate-continuity-evidence"]')
            if (!locate) return { ok: false, step: 'finding-locate-action-missing', docket: document.querySelector('.character-conflict-docket')?.textContent || '' }
            locate.click()
            await wait(180)
            const editor = document.querySelector('[data-testid="manuscript-input"]')
            const query = document.querySelector('.manuscript-find input[aria-label="查找正文"]')
            const selected = window.getSelection()?.toString() || ''
            return {
              ok: Boolean(editor && query && selected && query.value === selected && window.__smokeEditorText().includes(selected) && !document.querySelector('.character-conflict-docket')),
              step: 'finding-evidence-selected', selected, query: query?.value || '', active: document.querySelector('.activity-button.active')?.getAttribute('data-activity') || ''
            }
          })()`)
          if (!findingLocated.ok) {
            console.error(`[desktop smoke] finding evidence location failed: ${JSON.stringify(findingLocated)}`)
            return app.exit(1)
          }
          const characterConflictCapturePath = process.env.LANJIAN_CHARACTER_CONFLICT_CAPTURE_PATH
          if (characterConflictCapturePath) await writeFile(characterConflictCapturePath, (await window.capturePage()).toPNG())
        }
        if (process.env.LANJIAN_SMOKE_TRASH_DIR && bridgeReady) {
          await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"书稿\"]')?.click()")
          await new Promise((resolve) => setTimeout(resolve, 180))
          const deleteOpened = await window.webContents.executeJavaScript(`(async () => {
            const target = Array.from(document.querySelectorAll('.tree-item')).find((item) => item.textContent?.includes('待删旧章'))
            if (!target) return false
            target.click()
            await new Promise((resolve) => setTimeout(resolve, 120))
            document.querySelector('.danger-link')?.click()
            await new Promise((resolve) => setTimeout(resolve, 100))
            return Boolean(document.querySelector('.delete-sheet .trash-confirm'))
          })()`)
          if (!deleteOpened) return app.exit(1)
          const deleteCapturePath = process.env.LANJIAN_DELETE_CAPTURE_PATH
          if (deleteCapturePath) await writeFile(deleteCapturePath, (await window.capturePage()).toPNG())
          await window.webContents.executeJavaScript("document.querySelector('.delete-sheet .trash-confirm')?.click()")
          await new Promise((resolve) => setTimeout(resolve, 420))
          const deleted = await window.webContents.executeJavaScript("window.novelDesktop.chapters.list().then((chapters) => !chapters.some((chapter) => chapter.id === 2))")
          if (!deleted) return app.exit(1)
        }
        const autosaveText = process.env.LANJIAN_SMOKE_AUTOSAVE_TEXT
        if (autosaveText && bridgeReady) {
          smokeDriverStage = 'manuscript-editor-interactions'
          console.info('[desktop smoke] stage: manuscript-editor-interactions')
          const selectionAiEntryPassed = await window.webContents.executeJavaScript(`(async () => {
            const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
            const firstChapter = Array.from(document.querySelectorAll('.chapter-tree-row')).find((item) => item.querySelector('.chapter-no')?.textContent?.trim() === '第1章')
            firstChapter?.click()
            for (let index = 0; index < 50; index += 1) {
              const currentLabel = document.querySelector('.chapter-tree-editor .chapter-no')?.textContent?.trim()
              if (currentLabel === '第1章' && !document.querySelector('.agent-disabled-note')) break
              await wait(100)
            }
            const editor = document.querySelector('[data-testid="manuscript-input"]')
            const text = window.__smokeEditorText()
            if (!editor || !text || document.querySelector('.agent-disabled-note')) return { ok: false, step: 'selection-ai-editor-missing', chapter: document.querySelector('.chapter-tree-editor .chapter-no')?.textContent || '', panel: document.querySelector('.assistant-panel')?.textContent?.slice(0, 800) || '' }
            const end = Math.max(1, text.indexOf('。') + 1)
            window.__smokeEditorSelect(0, end)
            await wait(100)
            editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, shiftKey: true, bubbles: true }))
            await wait(100)
            const shortcutInput = document.querySelector('[data-testid="writing-agent-input"]')
            const shortcutReady = document.querySelector('.agent-mounted-skill')?.textContent?.includes('自定义')
              && document.querySelector('.agent-selection-state')?.textContent?.includes('已选中正文')
              && document.activeElement === shortcutInput
            if (!shortcutReady) return { ok: false, step: 'selection-ai-shortcut', panel: document.querySelector('.assistant-panel')?.textContent || '', active: document.activeElement?.getAttribute?.('data-testid') || '' }
            document.querySelector('[aria-label="关闭智能助笔侧栏"]')?.click()
            // Closing the dock reflows CodeMirror. Re-select after that reflow, just as a
            // user would, and wait until the editor has published the live selection.
            let contextPrevented = false
            let contextSelection = ''
            for (let attempt = 0; attempt < 8 && !contextPrevented; attempt += 1) {
              await wait(attempt ? 80 : 220)
              window.__smokeEditorSelect(0, end)
              await wait(80)
              const contextEditor = document.querySelector('[data-testid="manuscript-input"]')
              contextSelection = window.getSelection()?.toString() || ''
              contextPrevented = Boolean(contextEditor && !contextEditor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })))
            }
            await wait(140)
            const contextReady = document.querySelector('.agent-mounted-skill')?.textContent?.includes('改写')
              && document.activeElement === document.querySelector('[data-testid="writing-agent-input"]')
            return { ok: Boolean(contextPrevented && contextReady), step: 'selection-ai-context-menu', contextPrevented, contextReady, contextSelection }
          })()`)
          if (!selectionAiEntryPassed.ok) {
            console.error(`[desktop smoke] selection AI entry failed: ${JSON.stringify(selectionAiEntryPassed)}`)
            return app.exit(1)
          }
          const selectionAiEntryCapturePath = process.env.LANJIAN_SELECTION_AI_ENTRY_CAPTURE_PATH
          if (selectionAiEntryCapturePath) await writeFile(selectionAiEntryCapturePath, (await window.capturePage()).toPNG())
          await window.webContents.executeJavaScript(`document.querySelector('[aria-label="关闭智能助笔侧栏"]')?.click()`)
          await new Promise((resolve) => setTimeout(resolve, 160))
          const editorInteractionPassed = await window.webContents.executeJavaScript(`(async () => {
            const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
            const editor = document.querySelector('[data-testid="manuscript-input"]')
            if (!editor) return { ok: false, step: 'editor-missing' }
            editor.focus()
            editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
            await wait(60)
            if (!document.querySelector('.manuscript-find')) return { ok: false, step: 'find-shortcut' }
            document.querySelector('.find-close')?.click()
            await wait(30)
            if (document.querySelector('.manuscript-find') || document.querySelector('.cm-search')) return { ok: false, step: 'find-close-left-duplicate-search' }
            const focusButton = document.querySelector('[data-testid="manuscript-focus"]')
            focusButton?.click()
            await wait(120)
            if (!document.querySelector('.studio')?.classList.contains('writing-focus')) return { ok: false, step: 'focus-mode-enter' }
            const focusedWorkbench = document.querySelector('.workbench')?.getBoundingClientRect()
            const focusedEditor = document.querySelector('[data-testid="manuscript-editor"]')?.getBoundingClientRect()
            const assistantButton = document.querySelector('[data-testid="manuscript-focus-assistant"]')
            if (!focusedWorkbench || !focusedEditor || focusedEditor.width < 600 || focusedEditor.height < 400 || !assistantButton) return {
              ok: false,
              step: 'focus-mode-surface-or-assistant-missing',
              studio: document.querySelector('.studio') && {
                classes: document.querySelector('.studio').className,
                width: document.querySelector('.studio').getBoundingClientRect().width,
                columns: getComputedStyle(document.querySelector('.studio')).gridTemplateColumns
              },
              workbench: focusedWorkbench && { width: focusedWorkbench.width, height: focusedWorkbench.height },
              editor: focusedEditor && { width: focusedEditor.width, height: focusedEditor.height },
              assistantButton: Boolean(assistantButton)
            }
            // The assistant can already be open when focus mode starts.  Make
            // both toggle directions explicit; a single blind click would
            // otherwise close an already-visible dock and misreport it as a
            // layout failure.
            if (document.querySelector('.assistant-panel')) {
              assistantButton.click()
              await wait(60)
            }
            assistantButton.click()
            await wait(60)
            const assistant = document.querySelector('.assistant-panel')
            const assistantRect = assistant?.getBoundingClientRect()
            const focusWorkbenchWithAssistant = document.querySelector('.workbench')?.getBoundingClientRect()
            if (!assistant || getComputedStyle(assistant).display === 'none' || getComputedStyle(assistant).position !== 'static'
              || !assistantRect || !focusWorkbenchWithAssistant || Math.abs(focusWorkbenchWithAssistant.right - assistantRect.left) > 1) return { ok: false, step: 'focus-mode-assistant-open' }
            document.querySelector('[aria-label="关闭智能助笔侧栏"]')?.click()
            await wait(60)
            if (document.querySelector('.assistant-panel')) return { ok: false, step: 'focus-mode-assistant-close' }
            editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            await wait(60)
            if (document.querySelector('.studio')?.classList.contains('writing-focus')) return { ok: false, step: 'focus-mode-exit' }
            const typewriterButton = document.querySelector('[data-testid="manuscript-typewriter"]')
            typewriterButton?.click()
            await wait(60)
            if (typewriterButton?.getAttribute('aria-pressed') !== 'true') return { ok: false, step: 'typewriter-mode' }
            return { ok: true }
          })()`)
          if (!editorInteractionPassed.ok) {
            console.error(`[desktop smoke] manuscript editor interaction failed: ${JSON.stringify(editorInteractionPassed)}`)
            return app.exit(1)
          }
          const manuscriptEditorCapturePath = process.env.LANJIAN_MANUSCRIPT_EDITOR_CAPTURE_PATH
          if (manuscriptEditorCapturePath) await writeFile(manuscriptEditorCapturePath, (await window.capturePage()).toPNG())
          const compositionProtected = await window.webContents.executeJavaScript(`(async () => {
            const editor = document.querySelector('[data-testid="manuscript-input"]')
            const profileButton = document.querySelector('[data-activity="profile"]')
            const deskButton = document.querySelector('[data-activity="desk"]')
            if (!editor || !profileButton || !deskButton) return { ok: false, step: 'controls-missing' }
            const expected = '　　' + ${JSON.stringify(autosaveText)}
            editor.focus()
            editor.dispatchEvent(new CompositionEvent('compositionstart', { data: '两秒', bubbles: true }))
            document.execCommand('selectAll')
            document.execCommand('insertText', false, ${JSON.stringify(autosaveText)})
            profileButton.click()
            await new Promise((resolve) => setTimeout(resolve, 2400))
            const premature = await window.novelDesktop.chapters.get(1).then((chapter) => chapter.content === expected)
            const switchedBeforeCompositionEnd = document.querySelector('[data-activity="profile"]')?.classList.contains('selected')
            editor.dispatchEvent(new CompositionEvent('compositionend', { data: ${JSON.stringify(autosaveText)}, bubbles: true }))
            await new Promise((resolve) => setTimeout(resolve, 1200))
            const savedChapter = await window.novelDesktop.chapters.get(1)
            const savedAfterComposition = savedChapter.content === expected
            const switchedAfterCompositionEnd = document.querySelector('[data-activity="profile"]')?.classList.contains('selected')
            deskButton.click()
            await new Promise((resolve) => setTimeout(resolve, 500))
            return {
              ok: !premature && !switchedBeforeCompositionEnd && savedAfterComposition && switchedAfterCompositionEnd && Boolean(document.querySelector('.manuscript')),
              premature,
              switchedBeforeCompositionEnd,
              savedAfterComposition,
              switchedAfterCompositionEnd,
              saved: savedChapter.content,
              expected
            }
          })()`)
          if (!compositionProtected.ok) {
            console.error(`[desktop smoke] Chinese IME flush handoff failed: ${JSON.stringify(compositionProtected)}`)
            return app.exit(1)
          }
          const saveFailureText = process.env.LANJIAN_SMOKE_CHAPTER_SAVE_FAILURE_TEXT
          if (saveFailureText) {
            const failureRecovery = await window.webContents.executeJavaScript(`(async () => {
              const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
              const editor = document.querySelector('[data-testid="manuscript-input"]')
              const profileButton = document.querySelector('[data-activity="profile"]')
              if (!editor || !profileButton) return { ok: false, step: 'controls-missing' }
              const firstDraft = ${JSON.stringify(process.env.LANJIAN_SMOKE_CHAPTER_SAVE_FAILURE_TEXT || '')} + ' 第一版草稿'
              const latestDraft = firstDraft + '，作者又补上了最后一句。'
              const firstEditorDraft = '　　' + firstDraft
              const latestEditorDraft = '　　' + latestDraft
              if (!await window.__smokeEditorReplace(firstDraft)) return { ok: false, step: 'first-draft-input' }
              for (let index = 0; index < 60; index += 1) {
                if (document.querySelector('[data-testid="manuscript-save-state"]')?.textContent?.includes('草稿仍在当前窗口')) break
                await wait(100)
              }
              const failedState = document.querySelector('[data-testid="manuscript-save-state"]')?.textContent || ''
              const retryButton = document.querySelector('[data-testid="save-manuscript"]')
              const diskStayedOld = await window.novelDesktop.chapters.get(1).then((chapter) => chapter.content !== firstDraft)
              if (!failedState.includes('草稿仍在当前窗口') || retryButton?.textContent?.trim() !== '重试保存' || retryButton?.dataset.saveAction !== 'retry' || window.__smokeEditorText() !== firstEditorDraft || !diskStayedOld) {
                return { ok: false, step: 'persistent-error', failedState, retryText: retryButton?.textContent, action: retryButton?.dataset.saveAction, editor: window.__smokeEditorText(), diskStayedOld }
              }
              await window.__smokeEditorReplace(latestDraft)
              profileButton.click()
              await wait(450)
              const stayedOnDesk = document.querySelector('[data-activity="desk"]')?.classList.contains('selected')
              if (!stayedOnDesk || window.__smokeEditorText() !== latestEditorDraft) return { ok: false, step: 'navigation-failure-did-not-retain-draft', stayedOnDesk, editor: window.__smokeEditorText() }
              document.querySelector('[data-testid="save-manuscript"]')?.click()
              for (let index = 0; index < 40 && !/已存(?:于本地|入数据库)/.test(document.querySelector('[data-testid="manuscript-save-state"]')?.textContent || ''); index += 1) await wait(100)
              const persistedLatest = await window.novelDesktop.chapters.get(1).then((chapter) => chapter.content === latestEditorDraft)
              const recoveredState = document.querySelector('[data-testid="manuscript-save-state"]')?.textContent || ''
              const recoveredButton = document.querySelector('[data-testid="save-manuscript"]')
              return { ok: persistedLatest && /已存(?:于本地|入数据库)/.test(recoveredState) && recoveredButton?.textContent?.trim() === '立即保存' && recoveredButton?.dataset.saveAction === 'save', persistedLatest, recoveredState, button: recoveredButton?.textContent, action: recoveredButton?.dataset.saveAction }
            })()`)
            if (!failureRecovery.ok) {
              console.error(`[desktop smoke] manuscript save recovery failed: ${JSON.stringify(failureRecovery)}`)
              return app.exit(1)
            }
          }
          const externalConflictText = process.env.LANJIAN_SMOKE_EXTERNAL_CONFLICT_TEXT
          if (externalConflictText) {
            const projectRoot = process.env.LANJIAN_SMOKE_PROJECT_PATH
            if (!projectRoot) return app.exit(1)
            const mirrorDatabase = await new SqliteWorkspaceDatabaseFactory().openExisting(projectRoot)
            if (!mirrorDatabase) return app.exit(1)
            const chapterMirrorRelativePath = mirrorDatabase.formalChapters().find((chapter) => chapter.legacyChapterId === 1)?.mirrorRelativePath || ''
            mirrorDatabase.close()
            if (!chapterMirrorRelativePath) return app.exit(1)
            const chapterPath = await projectDirectory(projectRoot, join(projectRoot, ...chapterMirrorRelativePath.split('/')))
            await writeFile(chapterPath, externalConflictText, 'utf8')
            const conflictProtected = await window.webContents.executeJavaScript(`(async () => {
              const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
              const editor = document.querySelector('[data-testid="manuscript-input"]')
              const localDraft = '岚笺中尚未保存、不能丢失的本地草稿。'
              const localEditorDraft = '　　' + localDraft
              if (!editor) return { ok: false, step: 'editor-missing' }
              await window.__smokeEditorReplace(localDraft)
              document.querySelector('[data-testid="save-manuscript"]')?.click()
              for (let index = 0; index < 50 && !document.querySelector('[data-testid="recover-external-mirror"]'); index += 1) await wait(100)
              const panel = document.querySelector('[data-testid="manuscript-mirror-notice"]')
              const databasePreserved = await window.novelDesktop.chapters.get(1).then((chapter) => chapter.content === localEditorDraft && chapter.mirrorStatus === 'conflict')
              document.querySelector('[data-activity="profile"]')?.click()
              await wait(250)
              const navigationAllowed = document.querySelector('[data-activity="profile"]')?.classList.contains('selected')
              document.querySelector('[data-activity="desk"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="recover-external-mirror"]'); index += 1) await wait(100)
              const livePanel = document.querySelector('[data-testid="manuscript-mirror-notice"]')
              return { ok: Boolean(panel && panel.textContent.includes('Markdown 有外部修改') && panel.textContent.includes('SQLite 与可读正文都已保留') && databasePreserved && navigationAllowed && livePanel && window.__smokeEditorText() === localEditorDraft), panel: livePanel?.textContent || panel?.textContent || '', state: document.querySelector('[data-testid="manuscript-save-state"]')?.textContent || '', databasePreserved, navigationAllowed, editor: window.__smokeEditorText() }
            })()`)
            const externalMirrorPreserved = await readFile(chapterPath, 'utf8').then((content) => content === externalConflictText).catch(() => false)
            if (!conflictProtected.ok || !externalMirrorPreserved) {
              console.error(`[desktop smoke] external manuscript conflict was not protected: ${JSON.stringify({ ...conflictProtected, externalMirrorPreserved })}`)
              return app.exit(1)
            }
            const conflictCapturePath = process.env.LANJIAN_MANUSCRIPT_CONFLICT_CAPTURE_PATH
            if (conflictCapturePath) await writeFile(conflictCapturePath, (await window.capturePage()).toPNG())
            const conflictRecovered = await window.webContents.executeJavaScript(`(async () => {
              const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
              window.confirm = () => true
              document.querySelector('[data-testid="recover-external-mirror"]')?.click()
              for (let index = 0; index < 40 && document.querySelector('[data-testid="recover-external-mirror"]'); index += 1) await wait(100)
              const editor = document.querySelector('[data-testid="manuscript-input"]')
              const disk = await window.novelDesktop.chapters.get(1)
              const revisions = await window.novelDesktop.chapters.revisions(1)
              return { ok: !document.querySelector('[data-testid="recover-external-mirror"]') && Boolean(editor) && window.__smokeEditorText() === ${JSON.stringify(process.env.LANJIAN_SMOKE_EXTERNAL_CONFLICT_TEXT || '')} && disk.content === ${JSON.stringify(process.env.LANJIAN_SMOKE_EXTERNAL_CONFLICT_TEXT || '')} && revisions.some((revision) => revision.content.includes('岚笺中尚未保存、不能丢失的本地草稿。')), editor: window.__smokeEditorText(), disk: disk.content, priorVersionPreserved: revisions.some((revision) => revision.content.includes('岚笺中尚未保存、不能丢失的本地草稿。')) }
            })()`)
            if (!conflictRecovered.ok) {
              console.error(`[desktop smoke] external manuscript conflict recovery failed: ${JSON.stringify(conflictRecovered)}`)
              return app.exit(1)
            }
          }
          smokeDriverStage = 'long-manuscript'
          console.info('[desktop smoke] stage: long-manuscript')
          let longChapter = ''
          for (let index = 1; longChapter.length < 22000; index += 1) longChapter += `第${index}段：陈景安核对书页上的每一行，输入、滚动与保存都不能丢字。\n\n`
          longChapter = longChapter.slice(0, 22000)
          const longEditorChapter = `　　${longChapter}`
          const longEditorReady = await window.webContents.executeJavaScript(`(() => { const editor = document.querySelector('[data-testid="manuscript-input"]'); if (!editor) return false; editor.focus(); return true })()`)
          if (!longEditorReady) {
            console.error('[desktop smoke] long manuscript editor missing')
            return app.exit(1)
          }
          window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] })
          window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] })
          await new Promise((resolve) => setTimeout(resolve, 80))
          const longRenderMs = await window.webContents.executeJavaScript(`(() => {
            const editor = document.querySelector('[data-testid="manuscript-input"]')
            if (!editor) return Number.POSITIVE_INFINITY
            const transfer = new DataTransfer()
            transfer.setData('text/plain', ${JSON.stringify(longEditorChapter)})
            const startedAt = performance.now()
            editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
            return performance.now() - startedAt
          })()`)
          const longChapterResult = await window.webContents.executeJavaScript(`(async () => {
            const longEditorChapter = ${JSON.stringify(longEditorChapter)}
            const renderMs = ${JSON.stringify(longRenderMs)}
            const metricsText = document.querySelector('.manuscript-metrics')?.textContent || ''
            const displayedWords = Number((/([\\d,]+)\\s*字/.exec(metricsText)?.[1] || '0').replaceAll(',', ''))
            const metricsVisible = displayedWords > 10000
            let persisted = false
            let checkpointVisible = false
            for (let index = 0; index < 120 && !persisted && !checkpointVisible; index += 1) {
              await new Promise((resolve) => setTimeout(resolve, 100))
              persisted = await window.novelDesktop.chapters.get(1).then((chapter) => chapter.content === longEditorChapter)
              checkpointVisible = document.querySelector('[data-testid="manuscript-save-state"]')?.textContent?.includes('恢复草稿') || false
            }
            if (!persisted && checkpointVisible) {
              document.querySelector('[data-testid="save-manuscript"]')?.click()
              for (let index = 0; index < 80 && !persisted; index += 1) {
                await new Promise((resolve) => setTimeout(resolve, 100))
                persisted = await window.novelDesktop.chapters.get(1).then((chapter) => chapter.content === longEditorChapter)
              }
            }
            const saveState = document.querySelector('[data-testid="manuscript-save-state"]')?.textContent || ''
            return { ok: Boolean(metricsVisible && persisted && renderMs < 1500), renderMs, length: longEditorChapter.length, displayedWords, metricsVisible, checkpointVisible, persisted, saveState }
          })()`)
          if (!longChapterResult.ok) {
            console.error(`[desktop smoke] long manuscript failed: ${JSON.stringify(longChapterResult)}`)
            return app.exit(1)
          }
          if (process.env.LANJIAN_SMOKE === '1') {
            const reconciled = await window.webContents.executeJavaScript(`window.novelDesktop.workspace.getCharacterState().then((state) => state.events.some((event) => event.chapterId === 1 && event.active === false) && state.snapshots.every((snapshot) => snapshot.throughChapter === 0))`)
            if (!reconciled) {
              console.error('[desktop smoke] manuscript autosave did not retire stale character state')
              return app.exit(1)
            }
          }
          if (process.env.LANJIAN_SMOKE_BACKUP_TARGET && process.env.LANJIAN_SMOKE_RESTORE_TARGET) {
            const sourcePath = process.env.LANJIAN_SMOKE_PROJECT_PATH
            const closeText = process.env.LANJIAN_SMOKE_CLOSE_FLUSH_TEXT || ''
            const storedCloseText = `　　${closeText}`
            const backupRestorePassed = await window.webContents.executeJavaScript(`(async () => {
              const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
              const editor = document.querySelector('[data-testid="manuscript-input"]')
              if (!editor) return { ok: false, step: 'editor-missing' }
              if (!await window.__smokeEditorReplace(${JSON.stringify(process.env.LANJIAN_SMOKE_CLOSE_FLUSH_TEXT || '')})) return { ok: false, step: 'backup-draft-input' }
              document.querySelector('[data-testid="save-manuscript"]')?.click()
              let backupDraftPersisted = false
              for (let index = 0; index < 50; index += 1) {
                const chapter = await window.novelDesktop.chapters.get(1)
                if (chapter.content === ${JSON.stringify(`　　${process.env.LANJIAN_SMOKE_CLOSE_FLUSH_TEXT || ''}`)}) {
                  backupDraftPersisted = true
                  break
                }
                await wait(100)
              }
              if (!backupDraftPersisted) return { ok: false, step: 'backup-draft-save', editor: window.__smokeEditorText(), saveState: document.querySelector('[data-testid="manuscript-save-state"]')?.textContent || '' }
              document.querySelector('[aria-label="设置"]')?.click()
              await wait(120)
              document.querySelector('[data-testid="settings-nav-project"]')?.click()
              for (let index = 0; index < 40 && !document.querySelector('[data-testid="create-workspace-backup"]'); index += 1) await wait(100)
              const create = document.querySelector('[data-testid="create-workspace-backup"]')
              if (!create || create.disabled) return { ok: false, step: 'backup-entry', page: document.body.textContent }
              create.click()
              for (let index = 0; index < 80 && !document.querySelector('[data-testid="workspace-backup-section"]')?.textContent?.includes('最近一次备份已通过完整性校验'); index += 1) await wait(100)
              const backupSection = document.querySelector('[data-testid="workspace-backup-section"]')
              if (!backupSection?.textContent?.includes('不会直接拷贝正在使用的数据库文件') && !backupSection?.textContent?.includes('最近一次备份已通过完整性校验')) {
                return { ok: false, step: 'backup-result', text: backupSection?.textContent || '' }
              }
              document.querySelector('[data-testid="preview-workspace-restore"]')?.click()
              for (let index = 0; index < 80 && !document.querySelector('[data-testid="workspace-restore-dialog"]'); index += 1) await wait(100)
              const dialog = document.querySelector('[data-testid="workspace-restore-dialog"]')
              const rect = dialog?.getBoundingClientRect()
              if (!dialog?.textContent?.includes('原作品不变') || !dialog.textContent.includes('逐文件校验')
                || !dialog.textContent.includes('另存为新的作品文件夹') || !document.querySelector('[data-testid="confirm-workspace-restore"]')
                || document.querySelector('.assistant-panel') || !rect || rect.left < 0 || rect.right > window.innerWidth || rect.top < 0 || rect.bottom > window.innerHeight) {
                return { ok: false, step: 'restore-preview', text: dialog?.textContent || '', rect }
              }
              return { ok: true, step: 'preview-ready' }
            })()`)
            if (!backupRestorePassed.ok) {
              console.error(`[desktop smoke] workspace backup/restore preview failed: ${JSON.stringify(backupRestorePassed)}`)
              return app.exit(1)
            }
            const capturePath = process.env.LANJIAN_BACKUP_RESTORE_CAPTURE_PATH
            if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
            const sourceBeforeRestore = sourcePath
              ? await readFile(join(sourcePath, '正文', '第1章-雨夜追迹.md'), 'utf8').catch(() => '')
              : ''
            const restored = await window.webContents.executeJavaScript(`(async () => {
              const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
              document.querySelector('[data-testid="confirm-workspace-restore"]')?.click()
              for (let index = 0; index < 100; index += 1) {
                const status = await window.novelDesktop.projects.status()
                const chapter = await window.novelDesktop.chapters.get(1).catch(() => null)
                if (status.project?.title?.includes('恢复副本') && chapter?.content === ${JSON.stringify(`　　${process.env.LANJIAN_SMOKE_CLOSE_FLUSH_TEXT || ''}`)}) {
                  return { ok: true, path: status.project.path, title: status.project.title, storageMode: chapter.storageMode || 'files' }
                }
                await wait(100)
              }
              return { ok: false, step: 'restore-timeout', page: document.body.textContent }
            })()`)
            const sourceAfterRestore = sourcePath
              ? await readFile(join(sourcePath, '正文', '第1章-雨夜追迹.md'), 'utf8').catch(() => '')
              : ''
            if (!restored.ok || sourceBeforeRestore !== storedCloseText || sourceAfterRestore !== sourceBeforeRestore || resolve(restored.path) === resolve(sourcePath || restored.path)) {
              console.error(`[desktop smoke] workspace restore-as-copy failed: ${JSON.stringify({ restored, sourceBeforeRestore, sourceAfterRestore })}`)
              return app.exit(1)
            }
            process.env.LANJIAN_SMOKE_RESTORE_COMPLETED = '1'
          }
        }
        const closeFlushText = process.env.LANJIAN_SMOKE_CLOSE_FLUSH_TEXT
        if (closeFlushText && bridgeReady) {
          if (process.env.LANJIAN_SMOKE_RESTORE_COMPLETED === '1') {
            window.close()
            return
          }
          const closeDrafted = await window.webContents.executeJavaScript(`window.__smokeEditorReplace?.(${JSON.stringify(closeFlushText)}) || false`)
          if (!closeDrafted) return app.exit(1)
          await new Promise((resolve) => setTimeout(resolve, 100))
          window.close()
          return
        }
        app.exit(bridgeReady ? 0 : 1)
      }
      })().catch((error: unknown) => {
        const errorType = error instanceof AppError
          ? error.code
          : error instanceof Error
            ? error.name
            : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
              ? error.code
              : typeof error
        const errorMessage = error instanceof Error ? error.message : ''
        const errorStack = error instanceof Error ? error.stack || '' : ''
        console.error(`[desktop smoke] driver rejected at ${smokeDriverStage}: ${errorType}${errorMessage ? ` ${errorMessage}` : ''}${errorStack ? `\n${errorStack}` : ''}`)
        app.exit(1)
      })
    
}
