import type { BrowserWindow } from 'electron'

export function runOutlineGatePassedScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            try {
            const settlePlanning = async () => {
              const selectedMode = document.querySelector('.outline-actions button.selected')?.textContent?.trim()
              const modeState = async () => {
                const status = await window.novelDesktop.outlines.planningStatus()
                if (selectedMode === '总纲') return { confirmed: status.totalApproval?.status === 'confirmed', status }
                if (selectedMode === '卷纲') return { confirmed: status.volumes.some((volume) => volume.approval?.status === 'confirmed'), status }
                return { confirmed: false, status }
              }
              let acknowledgeClicked = false
              let confirmClicked = false
              for (let index = 0; index < 60; index += 1) {
                const state = await modeState()
                if (state.confirmed) return true
                const currentMode = document.querySelector('.outline-actions button.selected')?.textContent?.trim()
                if (currentMode !== selectedMode) {
                  window.__outlineSettleDiagnostic = { selectedMode, currentMode, reason: 'mode-changed', status: state.status }
                  return false
                }
                const acknowledge = document.querySelector('.planning-review .review-acknowledge')
                if (!acknowledgeClicked && acknowledge && !acknowledge.disabled) {
                  acknowledgeClicked = true
                  acknowledge.click()
                  await wait(100)
                  continue
                }
                const confirm = document.querySelector('.planning-review .planning-confirm')
                if (!confirmClicked && confirm && !confirm.disabled) {
                  confirmClicked = true
                  confirm.click()
                  await wait(100)
                  continue
                }
                await wait(100)
              }
              const state = await modeState()
              window.__outlineSettleDiagnostic = {
                selectedMode,
                reason: 'timeout',
                acknowledgeClicked,
                confirmClicked,
                review: document.querySelector('.planning-review')?.textContent || '',
                status: state.status
              }
              return false
            }
            const selectOutlineMode = async (label) => {
              for (let index = 0; index < 50; index += 1) {
                const selected = document.querySelector('.outline-actions button.selected')?.textContent?.trim() || ''
                if (selected === label || selected.includes(label)) return true
                const target = Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.trim() === label || item.textContent?.includes(label))
                if (target && !target.disabled && index % 5 === 0) target.click()
                await wait(100)
              }
              return false
            }
            document.querySelector('[aria-label="谋篇"]')?.click()
            for (let index = 0; index < 30 && !document.querySelector('.outline-editor'); index += 1) await wait(100)
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.trim() === '总纲')?.click()
            await wait(120)
            const aiTotalButton = document.querySelector('[data-testid="generate-total-outline-ai"]')
            const inspectorToggle = document.querySelector('[data-testid="outline-inspector-toggle"]')
            if (!aiTotalButton || !aiTotalButton.textContent?.includes('AI') || !inspectorToggle) return { ok: false, step: 'outline-clean-toolbar' }
            if (getComputedStyle(aiTotalButton).display === 'none' || aiTotalButton.getBoundingClientRect().height < 34) return { ok: false, step: 'outline-ai-action-visible' }
            if (aiTotalButton.textContent?.includes('查看')) {
              aiTotalButton.click()
              for (let index = 0; index < 20 && !document.querySelector('.profile-editor'); index += 1) await wait(100)
              if (!document.querySelector('.profile-editor')) return { ok: false, step: 'outline-ai-candidate-open' }
              document.querySelector('[aria-label="谋篇"]')?.click()
              for (let index = 0; index < 20 && !document.querySelector('.outline-editor'); index += 1) await wait(100)
            }
            const alreadyOpenInspector = document.querySelector('[data-testid="outline-inspector"]')
            if (alreadyOpenInspector && getComputedStyle(alreadyOpenInspector).display !== 'none') {
              document.querySelector('[aria-label="关闭结构与检查"]')?.click()
              await wait(80)
            }
            document.querySelector('[data-testid="outline-inspector-toggle"]')?.click()
            await wait(100)
            const inspector = document.querySelector('[data-testid="outline-inspector"]')
            if (!inspector || getComputedStyle(inspector).display === 'none' || !inspector.textContent?.includes('篇卷、事件与总纲检查')) return { ok: false, step: 'outline-inspector-open' }
            document.querySelector('[aria-label="关闭结构与检查"]')?.click()
            await wait(80)
            if (getComputedStyle(inspector).display !== 'none') return { ok: false, step: 'outline-inspector-close' }
            for (let index = 0; index < 20 && !document.querySelector('.volume-strip article') && !document.querySelector('#volume-title'); index += 1) await wait(100)
            const existingFirstVolume = document.querySelector('.volume-strip article')
            if (existingFirstVolume) {
              const existingTitle = existingFirstVolume.querySelector('input')
              if (!existingTitle) return { ok: false, step: 'volume-existing-title' }
              existingTitle.value = '旧声入梦'
              existingTitle.dispatchEvent(new Event('change', { bubbles: true }))
              await wait(350)
              document.querySelector('.volume-strip article')?.click()
              await wait(160)
            } else {
              const volumeInput = document.querySelector('#volume-title')
              if (!volumeInput) return { ok: false, step: 'volume-form' }
              volumeInput.value = '旧声入梦'
              volumeInput.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(60)
              document.querySelector('.volume-planner form button')?.click()
              await wait(350)
            }
            for (let index = 0; index < 40; index++) {
              if (document.querySelector('[aria-label="当前卷纲正文"]') && document.querySelector('.outline-actions button.selected')?.textContent?.includes('卷纲')) break
              await wait(100)
            }
            const volumeOutline = document.querySelector('[aria-label="当前卷纲正文"]')
            if (!volumeOutline || !document.querySelector('.outline-actions button.selected')?.textContent?.includes('卷纲')) return { ok: false, step: 'volume-editor', selected: document.querySelector('.outline-actions button.selected')?.textContent, notice: document.querySelector('.toast')?.textContent, volume: document.querySelector('.volume-strip')?.textContent }
            volumeOutline.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, '本卷目标：沈砚确认异世录音的来历，并决定重新登台。')
            await wait(60)
            document.querySelector('[data-testid="save-outline-document"]')?.click()
            await wait(350)
            const volumeInspector = document.querySelector('[data-testid="outline-inspector"]')
            if (!volumeInspector || getComputedStyle(volumeInspector).display === 'none') {
              document.querySelector('[data-testid="outline-inspector-toggle"]')?.click()
              for (let index = 0; index < 20 && getComputedStyle(document.querySelector('[data-testid="outline-inspector"]')).display === 'none'; index += 1) await wait(100)
            }
            // A volume can be reviewed before its parent total outline is
            // confirmed. In that case it is valid to either acknowledge a
            // non-blocking notice or leave a clean review untouched; formal
            // confirmation happens only after the parent is confirmed below.
            const volumeReview = document.querySelector('.planning-review')
            if (!volumeReview) return { ok: false, step: 'volume-planning-review-ready', inspectorVisible: Boolean(document.querySelector('[data-testid="outline-inspector"]') && getComputedStyle(document.querySelector('[data-testid="outline-inspector"]')).display !== 'none') }
            // Saving and refreshing the outline can replace this review node and
            // keep the global action lock briefly active. Wait for the current
            // live button, then acknowledge a non-blocking notice through the UI.
            for (let index = 0; index < 150; index += 1) {
              const review = document.querySelector('.planning-review')
              if (review?.classList.contains('review-clear') || review?.classList.contains('review-acknowledged')) break
              const acknowledge = review?.querySelector('.review-acknowledge')
              if (acknowledge?.disabled && acknowledge.textContent?.includes('先保存') && index % 8 === 0) {
                const save = document.querySelector('[data-testid="save-outline-document"]')
                if (save && !save.disabled) save.click()
              } else if (acknowledge && !acknowledge.disabled && index % 5 === 0) {
                acknowledge.click()
              }
              await wait(100)
            }
            const settledVolumeReview = document.querySelector('.planning-review')
            const settledVolumeAcknowledge = settledVolumeReview?.querySelector('.review-acknowledge')
            if (!settledVolumeReview?.classList.contains('review-clear') && !settledVolumeReview?.classList.contains('review-acknowledged')) return { ok: false, step: 'volume-planning-review-ready', reviewClass: settledVolumeReview?.className, acknowledgementDisabled: settledVolumeAcknowledge?.disabled, review: settledVolumeReview?.textContent }
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.trim() === '总纲')?.click()
            await wait(120)
            const eventSelect = document.querySelector('.outline-event-strip article select')
            if (!eventSelect || !Array.from(eventSelect.options).some((item) => item.value === '1')) return { ok: false, step: 'approved-event' }
            const formalEvent = (await window.novelDesktop.research.listEvents()).events.find((item) => item.status === 'approved' && item.event.includes('旧录音设备'))
            if (!formalEvent) return { ok: false, step: 'approved-event-record' }
            await window.novelDesktop.outlines.placeEvent(formalEvent.id, 1)
            // The smoke invokes the IPC boundary directly here (native select
            // option picking is not available to webContents JavaScript). Reopen
            // the workspace so the renderer reads the resulting authoritative
            // planning snapshot just as it does after a real user action.
            document.querySelector('[data-activity="desk"]')?.click()
            await wait(120)
            document.querySelector('[data-activity="outline"]')?.click()
            await wait(260)
            let placementStatus = await window.novelDesktop.outlines.planningStatus()
            for (let index = 0; index < 30 && !placementStatus.volumes.some((item) => item.volume === 1 && item.eventIds.length === 1); index += 1) {
              await wait(100)
              placementStatus = await window.novelDesktop.outlines.planningStatus()
            }
            const volumeReady = document.querySelector('.volume-strip article input')?.value === '旧声入梦'
              && placementStatus.volumes.some((item) => item.volume === 1 && item.eventIds.length === 1)
              && placementStatus.unplacedEventIds.length === 0
            if (!volumeReady) return { ok: false, step: 'volume-placement', volumeTitle: document.querySelector('.volume-strip article input')?.value || '', eventText: document.querySelector('.outline-event-strip article')?.textContent || '', toast: document.querySelector('.toast')?.textContent || '', planning: placementStatus }
            if (!await settlePlanning()) return { ok: false, step: 'total-formal-confirm', settle: window.__outlineSettleDiagnostic }
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.trim() === '卷纲')?.click()
            await wait(120)
            if (!await settlePlanning()) return { ok: false, step: 'volume-formal-confirm', settle: window.__outlineSettleDiagnostic }
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.includes('当前章纲'))?.click()
            let chapterVolume = null
            for (let index = 0; index < 30; index += 1) {
              chapterVolume = document.querySelector('.chapter-volume-placement select')
              if (chapterVolume && Array.from(chapterVolume.options).some((item) => item.value === '1')) break
              await wait(100)
            }
            if (!chapterVolume || !Array.from(chapterVolume.options).some((item) => item.value === '1')) return { ok: false, step: 'chapter-volume-options' }
            chapterVolume.value = '1'
            chapterVolume.dispatchEvent(new Event('change', { bubbles: true }))
            let assignmentStatus = null
            for (let index = 0; index < 40; index += 1) {
              assignmentStatus = await window.novelDesktop.outlines.planningStatus(1)
              if (assignmentStatus.chapter?.stale && document.querySelector('.outline-version-bar.stale')) break
              await wait(100)
            }
            if (!assignmentStatus?.chapter?.stale || !document.querySelector('.outline-version-bar.stale')) return { ok: false, step: 'assignment-stale', planning: assignmentStatus, versionBar: document.querySelector('.outline-version-bar')?.textContent || '' }
            let chapterRebased = null
            for (let index = 0; index < 60; index += 1) {
              chapterRebased = await window.novelDesktop.outlines.planningStatus(1)
              if (!chapterRebased.chapter?.stale && !document.querySelector('.outline-version-bar.stale')) break
              if (index % 10 === 0) {
                const liveSave = document.querySelector('[data-testid="save-outline-document"]')
                if (liveSave && !liveSave.disabled) liveSave.click()
              }
              await wait(100)
            }
            if (chapterRebased?.chapter?.stale || document.querySelector('.outline-version-bar.stale')) return { ok: false, step: 'chapter-reconfirm', planning: chapterRebased, saveDisabled: document.querySelector('[data-testid="save-outline-document"]')?.disabled, toast: document.querySelector('.toast')?.textContent || '' }
            if (!await selectOutlineMode('总纲')) return { ok: false, step: 'chapter-placement-total-mode' }
            if (!await settlePlanning()) return { ok: false, step: 'chapter-placement-total-confirm', settle: window.__outlineSettleDiagnostic }
            let stableVolumeConfirmed = false
            for (let attempt = 0; attempt < 4 && !stableVolumeConfirmed; attempt += 1) {
              if (!await selectOutlineMode('卷纲')) return { ok: false, step: 'chapter-placement-volume-mode' }
              if (!await settlePlanning()) return { ok: false, step: 'chapter-placement-volume-confirm', settle: window.__outlineSettleDiagnostic }
              await wait(350)
              const planning = await window.novelDesktop.outlines.planningStatus(1)
              stableVolumeConfirmed = planning.volumes.some((volume) => volume.volume === 1 && volume.approval?.status === 'confirmed')
            }
            if (!stableVolumeConfirmed) return { ok: false, step: 'chapter-placement-volume-stable', planning: await window.novelDesktop.outlines.planningStatus(1) }
            if (!await selectOutlineMode('当前章纲')) return { ok: false, step: 'chapter-placement-chapter-mode' }
            for (let index = 0; index < 40; index += 1) {
              const button = document.querySelector('[aria-label="章纲结构审核"] .review-confirm')
              if (button && !button.disabled) break
              await wait(100)
            }
            const initialConfirm = document.querySelector('[aria-label="章纲结构审核"] .review-confirm')
            if (!initialConfirm || initialConfirm.disabled) return { ok: false, step: 'chapter-confirm-ready', selectedMode: document.querySelector('.outline-actions button.selected')?.textContent?.trim(), inspectorVisible: Boolean(document.querySelector('[data-testid="outline-inspector"]') && getComputedStyle(document.querySelector('[data-testid="outline-inspector"]')).display !== 'none'), review: document.querySelector('[aria-label="章纲结构审核"]')?.textContent || '', planning: await window.novelDesktop.outlines.planningStatus(1), toast: document.querySelector('.toast')?.textContent || '' }
            initialConfirm.click()
            for (let index = 0; index < 30 && !document.querySelector('[aria-label="章纲结构审核"].review-confirmed'); index += 1) await wait(100)
            if (!document.querySelector('[aria-label="章纲结构审核"].review-confirmed')) return { ok: false, step: 'chapter-confirmed', review: document.querySelector('[aria-label="章纲结构审核"]')?.textContent || '', planning: await window.novelDesktop.outlines.planningStatus(1) }
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.trim() === '总纲')?.click()
            await wait(120)
            const chapterEventSelect = document.querySelector('.outline-event-strip article select')
            if (!chapterEventSelect || !Array.from(chapterEventSelect.options).some((item) => item.value === 'chapter:1')) return { ok: false, step: 'chapter-event-option' }
            chapterEventSelect.value = 'chapter:1'
            chapterEventSelect.dispatchEvent(new Event('change', { bubbles: true }))
            for (let index = 0; index < 30; index += 1) {
              if (document.querySelector('.outline-event-strip article')?.textContent?.includes('已入第 1 章契约')) break
              await wait(100)
            }
            const chapterPlacementText = document.querySelector('.outline-event-strip article')?.textContent || ''
            if (!chapterPlacementText.includes('已入第 1 章契约')) return { ok: false, step: 'chapter-event-placement', text: chapterPlacementText }
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.includes('当前章纲'))?.click()
            await wait(120)
            if (!document.querySelector('.outline-version-bar.stale')) return { ok: false, step: 'chapter-event-stale' }
            document.querySelector('[data-testid="save-outline-document"]')?.click()
            await wait(350)
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.trim() === '总纲')?.click()
            await wait(120)
            if (!await settlePlanning()) return { ok: false, step: 'chapter-event-total-confirm', settle: window.__outlineSettleDiagnostic }
            await window.novelDesktop.outlines.confirmPlanning(1)
            document.querySelector('[data-activity="desk"]')?.click()
            await wait(120)
            document.querySelector('[data-activity="outline"]')?.click()
            await wait(220)
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.includes('当前章纲'))?.click()
            const chapterInspector = document.querySelector('[data-testid="outline-inspector"]')
            if (!chapterInspector || getComputedStyle(chapterInspector).display === 'none') {
              document.querySelector('[data-testid="outline-inspector-toggle"]')?.click()
              for (let index = 0; index < 20; index += 1) {
                const currentInspector = document.querySelector('[data-testid="outline-inspector"]')
                if (currentInspector && getComputedStyle(currentInspector).display !== 'none') break
                await wait(100)
              }
            }
            for (let index = 0; index < 40; index += 1) {
              const button = document.querySelector('[aria-label="章纲结构审核"] .review-confirm')
              if (button && !button.disabled) break
              await wait(100)
            }
            const eventConfirm = document.querySelector('[aria-label="章纲结构审核"] .review-confirm')
            const chapterStatusBeforeConfirm = await window.novelDesktop.outlines.planningStatus(1)
            if (!chapterStatusBeforeConfirm.chapter?.review.canConfirm) return { ok: false, step: 'chapter-event-confirm-ready', review: document.querySelector('[aria-label="章纲结构审核"]')?.textContent || '', planning: chapterStatusBeforeConfirm }
            await window.novelDesktop.outlines.confirmChapter(1)
            const chapterStatusAfterConfirm = await window.novelDesktop.outlines.planningStatus(1)
            if (chapterStatusAfterConfirm.chapter?.review.status !== 'confirmed') return { ok: false, step: 'chapter-event-confirmed', planning: chapterStatusAfterConfirm, inspectorButton: Boolean(eventConfirm) }
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.trim() === '卷纲')?.click()
            await wait(120)
            const changedVolume = document.querySelector('.outline-editor > .plain-text-editor .cm-content')
            if (!changedVolume) return { ok: false, step: 'volume-reopen' }
            changedVolume.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, '本卷目标第二版：沈砚先验证异世录音，再决定重新登台。')
            await wait(60)
            document.querySelector('[data-testid="save-outline-document"]')?.click()
            for (let index = 0; index < 30 && !document.querySelector('.planning-review.review-attention'); index += 1) await wait(100)
            if (!document.querySelector('.planning-review.review-attention')) return { ok: false, step: 'volume-planning-review-invalidated' }
            const changedPlanningReview = document.querySelector('.planning-review .review-confirm')
            if (!changedPlanningReview || changedPlanningReview.disabled) return { ok: false, step: 'volume-planning-review-reacknowledge-ready' }
            changedPlanningReview.click()
            for (let index = 0; index < 30 && !document.querySelector('.planning-review.review-acknowledged'); index += 1) await wait(100)
            if (!document.querySelector('.planning-review.review-acknowledged')) return { ok: false, step: 'volume-planning-review-reacknowledged' }
            const changedPlanningConfirm = document.querySelector('.planning-review .planning-confirm')
            if (!changedPlanningConfirm || changedPlanningConfirm.disabled) return { ok: false, step: 'volume-formal-reconfirm-ready' }
            changedPlanningConfirm.click()
            for (let index = 0; index < 30 && !document.querySelector('.review-copy header .approval-confirmed'); index += 1) await wait(100)
            if (!document.querySelector('.review-copy header .approval-confirmed')) return { ok: false, step: 'volume-formal-reconfirmed' }
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.includes('当前章纲'))?.click()
            for (let index = 0; index < 30 && !document.querySelector('.outline-version-bar.stale'); index += 1) await wait(100)
            if (!document.querySelector('.outline-version-bar.stale')) return { ok: false, step: 'volume-change-stale' }
            document.querySelector('[data-testid="save-outline-document"]')?.click()
            for (let index = 0; index < 30 && document.querySelector('.outline-version-bar.stale'); index += 1) await wait(100)
            if (document.querySelector('.outline-version-bar.stale')) return { ok: false, step: 'volume-change-reconfirm' }
            const volumeConfirm = document.querySelector('.review-confirm')
            if (!volumeConfirm || volumeConfirm.disabled) return { ok: false, step: 'volume-change-confirm-ready' }
            volumeConfirm.click()
            for (let index = 0; index < 30 && !document.querySelector('.outline-review-sheet.review-confirmed'); index += 1) await wait(100)
            if (!document.querySelector('.outline-review-sheet.review-confirmed')) return { ok: false, step: 'volume-change-confirmed' }
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.trim() === '总纲')?.click()
            await wait(120)
            const total = document.querySelector('.outline-editor > .plain-text-editor .cm-content')
            if (!total) return { ok: false, step: 'total-outline' }
            total.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, '沈砚追查未知来电，核对平行世界的证据后才决定重返舞台。')
            await wait(80)
            document.querySelector('[data-testid="save-outline-document"]')?.click()
            let stalePlanning = null
            for (let index = 0; index < 50; index += 1) {
              stalePlanning = await window.novelDesktop.outlines.planningStatus(1)
              if (stalePlanning.totalApproval.status === 'stale' && stalePlanning.chapter?.review.status !== 'confirmed') break
              await wait(100)
            }
            Array.from(document.querySelectorAll('.outline-actions button')).find((item) => item.textContent?.includes('当前章纲'))?.click()
            if (!document.querySelector('.assistant-panel')) {
              document.querySelector('[aria-controls="assistant-drawer"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('.assistant-panel'); index += 1) await wait(100)
            }
            let stale = false
            let reviewBlocked = false
            let proseButton = null
            for (let index = 0; index < 50; index += 1) {
              stale = Boolean(document.querySelector('.outline-version-bar.stale'))
              reviewBlocked = !document.querySelector('.outline-review-sheet.review-confirmed')
              proseButton = document.querySelector('[data-testid="run-writing-agent"]')
              if (stale && reviewBlocked && proseButton?.disabled) break
              await wait(100)
            }
            if (!stale || !reviewBlocked || !proseButton?.disabled) return { ok: false, step: 'stale-gate', stale, reviewBlocked, proseDisabled: proseButton?.disabled, planning: stalePlanning, versionBar: document.querySelector('.outline-version-bar')?.textContent || '', review: document.querySelector('.outline-review-sheet')?.textContent || '' }
            return { ok: true, step: 'stale-gate' }
            } catch (error) {
              return { ok: false, step: 'outline-gate-exception', errorName: error?.name || typeof error, errorMessage: error?.message || String(error) }
            }
          })()`)
}
