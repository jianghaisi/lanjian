import type { BrowserWindow } from 'electron'

export function runRealCaseWritingScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
          const projectPath = ${JSON.stringify(process.env.LANJIAN_REAL_CASE_PROJECT_PATH || '')}
          const chapterId = ${Number(process.env.LANJIAN_REAL_CASE_CHAPTER_ID || 1)}
          const model = ${JSON.stringify(process.env.LANJIAN_REAL_CASE_MODEL || '')}
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
          const trace = []
          try {
            // Let the renderer finish restoring its previously selected work item
            // before the real-case runner performs the one authoritative switch.
            // Otherwise a late bootstrap switch can legitimately cancel the run.
            await wait(1800)
            trace.push('switch-project')
            await window.novelDesktop.projects.switch(projectPath)
            const migration = await window.novelDesktop.projects.migrationPreview()
            if (migration.required) {
              trace.push('migrate-project-manifest')
              if (!migration.canMigrate) return { ok: false, step: 'project-migration-blocked', migration, trace }
              await window.novelDesktop.projects.migrate()
            }
            let storage = await window.novelDesktop.projects.sqliteStorageStatus()
            if (storage.storageMode === 'files') {
              trace.push('create-shadow-database')
              const shadow = await window.novelDesktop.projects.previewSqliteShadowMigration()
              if (!shadow.canImport || !shadow.token) return { ok: false, step: 'shadow-preview', shadow, trace }
              await window.novelDesktop.projects.importSqliteShadowMigration(shadow.token)
              storage = await window.novelDesktop.projects.sqliteStorageStatus()
            }
            if (storage.storageMode !== 'sqlite') {
              trace.push('activate-sqlite-authority')
              const activation = await window.novelDesktop.projects.previewSqliteActivation()
              if (!activation.canActivate || !activation.token) return { ok: false, step: 'activation-preview', activation, storage, trace }
              await window.novelDesktop.projects.activateSqliteStorage(activation.token)
              storage = await window.novelDesktop.projects.sqliteStorageStatus()
            }
            if (storage.storageMode !== 'sqlite') return { ok: false, step: 'sqlite-not-active', storage, trace }

            trace.push('verify-planning-gates')
            let planning = await window.novelDesktop.outlines.planningStatus(chapterId)
            if (planning.totalApproval.status !== 'confirmed') {
              if (planning.totalReview.status === 'attention') await window.novelDesktop.outlines.acknowledgeReview('total')
              await window.novelDesktop.outlines.confirmPlanning('total')
              planning = await window.novelDesktop.outlines.planningStatus(chapterId)
            }
            const volumeNumber = planning.chapterPlacements.find((entry) => entry.chapterId === chapterId)?.volume
            const volume = planning.volumes.find((entry) => entry.volume === volumeNumber)
            if (volume && volume.approval.status !== 'confirmed') {
              if (volume.review.status === 'attention') await window.novelDesktop.outlines.acknowledgeReview(volume.volume)
              await window.novelDesktop.outlines.confirmPlanning(volume.volume)
              planning = await window.novelDesktop.outlines.planningStatus(chapterId)
            }
            if (planning.chapter?.stale || planning.chapter?.review.status === 'stale') {
              trace.push('rebind-chapter-outline')
              const currentOutline = await window.novelDesktop.chapterOutlines.get(chapterId)
              await window.novelDesktop.chapterOutlines.update(chapterId, currentOutline.content)
              planning = await window.novelDesktop.outlines.planningStatus(chapterId)
            }
            if (planning.chapter?.review.status !== 'confirmed') {
              await window.novelDesktop.outlines.reviewChapter(chapterId)
              planning = await window.novelDesktop.outlines.planningStatus(chapterId)
              if (planning.chapter?.review.canConfirm) await window.novelDesktop.outlines.confirmChapter(chapterId)
            }
            const projection = await window.novelDesktop.workspace.getChapterProjection(chapterId)
            if (!projection.workflow.readyForProse) return { ok: false, step: 'prose-gate', projection, trace }
            const chapter = await window.novelDesktop.chapters.get(chapterId)
            trace.push('start-writing-agent')
            let task = await window.novelDesktop.ai.startWritingAgent({
              operationId: crypto.randomUUID(),
              request: {
                chapterId,
                message: ${JSON.stringify(process.env.LANJIAN_REAL_CASE_WRITING_INSTRUCTION || '按当前已确认章纲完成候选正文，遵守本书设定，交由作者审阅，不自动采用。')},
                currentDraft: chapter.content,
                preferredSkill: 'continue',
                ...(model ? { model } : {})
              }
            })
            for (let index = 0; index < 1800 && ['queued', 'preparing', 'running', 'streaming'].includes(task.status); index += 1) {
              await wait(500)
              task = await window.novelDesktop.ai.writingAgentTask(task.id)
            }
            const finalProjection = await window.novelDesktop.workspace.getChapterProjection(chapterId)
            return {
              ok: task.status === 'succeeded' && Boolean(task.turn?.candidate?.content),
              step: 'writing-agent-complete',
              trace,
              storage,
              chapter: { id: chapter.id, position: chapter.position, title: chapter.title, originalCharacters: chapter.content.length, bodyVersionId: chapter.bodyVersionId },
              planning: {
                totalApproval: planning.totalApproval.status,
                volume: volumeNumber || null,
                volumeApproval: planning.volumes.find((entry) => entry.volume === volumeNumber)?.approval.status || null,
                chapterReview: planning.chapter?.review.status || null
              },
              task: {
                id: task.id,
                status: task.status,
                attempt: task.attempt,
                model: task.turn?.model || task.model || null,
                skill: task.skill,
                error: task.error || null,
                contextPackage: task.contextPackage || null,
                artifact: task.artifact || null,
                proposalReport: task.turn?.proposal?.report || null,
                candidateCharacters: task.turn?.candidate?.content?.length || 0,
                candidate: task.turn?.candidate?.content || ''
              },
              consistency: {
                status: finalProjection.consistency.status,
                readyForProse: finalProjection.consistency.readyForProse,
                items: finalProjection.consistency.items.map((item) => ({ id: item.id, status: item.status, summary: item.summary }))
              }
            }
          } catch (error) {
            return { ok: false, step: 'exception', trace, error: error?.message || JSON.stringify(error), details: error?.details || null }
          }
        })()`)
}
