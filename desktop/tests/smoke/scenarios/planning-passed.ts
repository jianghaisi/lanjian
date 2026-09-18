import type { BrowserWindow } from 'electron'

export function runPlanningPassedScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            const before = await window.novelDesktop.outlines.list()
            const beforeChapterOutlines = await window.novelDesktop.chapterOutlines.list()
            document.querySelector('[data-activity="preparation"]')?.click()
            await wait(220)
            document.querySelector('[data-testid="preparation-automatic"]')?.click()
            await wait(100)
            const start = document.querySelector('[data-testid="start-planning"]')
            if (!start || start.disabled) return { ok: false, step: 'planning-start-disabled' }
            start.click()
            for (let index = 0; index < 30 && !document.querySelector('[data-testid="planning-proposal"]'); index += 1) await wait(250)
            const proposal = document.querySelector('[data-testid="planning-proposal"]')
            const volumeTitle = proposal?.querySelector('.planning-volume-list input')
            if (!proposal?.textContent?.includes('旧声入梦') || volumeTitle?.value !== '城门旧雨') return { ok: false, step: 'planning-proposal' }
            const candidateVolumeTitles = Array.from(proposal.querySelectorAll('.planning-volume-list article')).map((item) => item.querySelector('label input')?.value).filter(Boolean)
            const titleInput = proposal.querySelector('.planning-outline-candidate input')
            if (!titleInput) return { ok: false, step: 'planning-edit-field' }
            titleInput.value = '烟测改写总纲'
            titleInput.dispatchEvent(new Event('input', { bubbles: true }))
            await wait(900)
            if ((await window.novelDesktop.planning.draft())?.totalOutline.title !== '烟测改写总纲') return { ok: false, step: 'planning-autosave' }
            document.querySelector('.project-switch')?.click()
            for (let index = 0; index < 20 && !document.querySelector('.work-item-grid'); index += 1) await wait(100)
            const card = Array.from(document.querySelectorAll('.work-item-card')).find((item) => item.textContent?.includes('烟测书稿'))
            if (!card) return { ok: false, step: 'planning-library-return' }
            card.querySelector('.work-item-open')?.click()
            for (let index = 0; index < 20 && !document.querySelector('.workflow-track'); index += 1) await wait(100)
            document.querySelector('[data-activity="preparation"]')?.click()
            await wait(300)
            document.querySelector('[data-testid="preparation-automatic"]')?.click()
            await wait(100)
            const restored = document.querySelector('[data-testid="planning-proposal"]')
            if (!restored?.textContent?.includes('烟测改写总纲')) return { ok: false, step: 'planning-reopen' }
            if (document.querySelector('[data-testid="preview-total-adoption"]')) return { ok: false, step: 'planning-total-visible-before-foundation' }
            if (!restored.textContent.includes('前置设定 0/4') || !document.querySelector('[data-testid="preview-character-seed-adoption"]')) return { ok: false, step: 'planning-foundation-first-action' }
            const beforeCharacters = await window.novelDesktop.workspace.getCharacterState()
            const beforeFoundation = await window.novelDesktop.workspace.getFoundation()
            const beforePower = await window.novelDesktop.workspace.getPowerSystem()
            const beforeRealms = await window.novelDesktop.workspace.getRealms()
            const beforeCheat = await window.novelDesktop.workspace.getCheatSystem()
            const beforeSystemTemplate = await window.novelDesktop.workspace.getSystemTemplate()
            const adoptFoundationStep = async (buttonId, previewId, confirmId, noticeText) => {
              const button = document.querySelector('[data-testid="' + buttonId + '"]')
              if (!button || button.disabled) return false
              button.click()
              for (let index = 0; index < 20 && !document.querySelector('[data-testid="' + previewId + '"]'); index += 1) await wait(100)
              const preview = document.querySelector('[data-testid="' + previewId + '"]')
              const confirm = preview?.querySelector('[data-testid="' + confirmId + '"]')
              if (!preview || !confirm || confirm.disabled) return false
              confirm.click()
              for (let index = 0; index < 50; index += 1) {
                const previewClosed = !document.querySelector('[data-testid="' + previewId + '"]')
                const successVisible = document.querySelector('.toast')?.textContent?.includes(noticeText)
                if (previewClosed && successVisible) return true
                await wait(100)
              }
              return false
            }
            if (!await adoptFoundationStep('preview-character-seed-adoption', 'character-seed-adoption-preview', 'confirm-character-seed-adoption', '人物种子已建立')) return { ok: false, step: 'planning-foundation-character-click' }
            if (!await adoptFoundationStep('preview-world-seed-adoption', 'world-seed-adoption-preview', 'confirm-world-seed-adoption', '世界种子已采用')) return { ok: false, step: 'planning-foundation-world-click' }
            if (!await adoptFoundationStep('preview-power-system-adoption', 'power-system-adoption-preview', 'confirm-power-system-adoption', '力量体系候选已采用')) return { ok: false, step: 'planning-foundation-power-click' }
            if (!await adoptFoundationStep('preview-cheat-system-adoption', 'cheat-system-adoption-preview', 'confirm-cheat-system-adoption', '特殊优势候选已采用')) return { ok: false, step: 'planning-foundation-cheat-click' }
            const adoptedFoundationDraft = await window.novelDesktop.planning.draft()
            const adoptedCharacters = await window.novelDesktop.workspace.getCharacterState()
            const adoptedFoundation = await window.novelDesktop.workspace.getFoundation()
            if (!adoptedFoundationDraft?.adoption?.characterSeeds || !adoptedFoundationDraft.adoption.worldSeed || !adoptedFoundationDraft.adoption.powerSystem || !adoptedFoundationDraft.adoption.cheatSystem) return { ok: false, step: 'planning-foundation-metadata' }
            if (adoptedCharacters.anchors.length !== adoptedFoundationDraft.blueprint.characters.length || adoptedCharacters.events.length !== beforeCharacters.events.length) return { ok: false, step: 'planning-foundation-character-scope' }
            if (adoptedFoundation.worldView !== adoptedFoundationDraft.blueprint.worldView || adoptedFoundation.sourceNotes !== beforeFoundation.sourceNotes || adoptedFoundation.creationPath !== beforeFoundation.creationPath || adoptedFoundation.useRealms !== beforeFoundation.useRealms || adoptedFoundation.useSystem !== beforeFoundation.useSystem) return { ok: false, step: 'planning-foundation-world-scope' }
            if ((await window.novelDesktop.workspace.getPowerSystem()).overview !== adoptedFoundationDraft.blueprint.powerSystem || JSON.stringify(await window.novelDesktop.workspace.getRealms()) !== JSON.stringify(beforeRealms)) return { ok: false, step: 'planning-foundation-power-scope' }
            if ((await window.novelDesktop.workspace.getCheatSystem()).overview !== adoptedFoundationDraft.blueprint.cheatSystem || JSON.stringify(await window.novelDesktop.workspace.getSystemTemplate()) !== JSON.stringify(beforeSystemTemplate)) return { ok: false, step: 'planning-foundation-cheat-scope' }
            if (beforePower.overview !== '作品、舞台与公众信任构成成长路径；没有可量化境界。' || beforeCheat.overview !== '沈砚只能听见有限的异世录音，不能直接复制未来成果。' || !restored.textContent.includes('前置设定 4/4')) return { ok: false, step: 'planning-foundation-progress' }
            const previewButton = document.querySelector('[data-testid="preview-total-adoption"]')
            if (!previewButton || previewButton.disabled) return { ok: false, step: 'planning-adoption-button' }
            previewButton.click()
            for (let index = 0; index < 20 && !document.querySelector('[data-testid="planning-adoption-preview"]'); index += 1) await wait(100)
            const preview = document.querySelector('[data-testid="planning-adoption-preview"]')
            if (!preview?.textContent?.includes('采用《烟测改写总纲》') || !preview.textContent.includes('本次只更新总纲')) return { ok: false, step: 'planning-adoption-preview' }
            if (JSON.stringify(before) !== JSON.stringify(await window.novelDesktop.outlines.list())) return { ok: false, step: 'planning-preview-mutated-official' }
            const confirm = preview.querySelector('[data-testid="confirm-total-adoption"]')
            if (!confirm || confirm.disabled) return { ok: false, step: 'planning-adoption-confirm' }
            confirm.click()
            for (let index = 0; index < 30 && document.querySelector('[data-testid="planning-adoption-preview"]'); index += 1) await wait(100)
            const after = await window.novelDesktop.outlines.list()
            const adopted = await window.novelDesktop.planning.draft()
            if (!after.total?.content?.startsWith('# 烟测改写总纲') || !adopted?.adoption?.totalOutline) return { ok: false, step: 'planning-adoption-result' }
            const adoptedTotal = after.total.content
            for (let index = 0; index < 30; index += 1) {
              const ready = document.querySelector('[data-testid="preview-volume-structure"]')
              if (ready && !ready.disabled) break
              await wait(100)
            }
            const structureButton = document.querySelector('[data-testid="preview-volume-structure"]')
            if (!structureButton || structureButton.disabled) return { ok: false, step: 'volume-structure-button' }
            structureButton.click()
            for (let index = 0; index < 20 && !document.querySelector('[data-testid="volume-structure-preview"]'); index += 1) await wait(100)
            const structurePreview = document.querySelector('[data-testid="volume-structure-preview"]')
            if (!structurePreview?.textContent?.includes('只同步卷号和卷名') || !structurePreview.textContent.includes('本次不写任何卷纲正文')) return { ok: false, step: 'volume-structure-preview' }
            if (JSON.stringify(after) !== JSON.stringify(await window.novelDesktop.outlines.list())) return { ok: false, step: 'volume-structure-preview-mutated-official' }
            const confirmStructure = structurePreview.querySelector('[data-testid="confirm-volume-structure"]')
            if (!confirmStructure || confirmStructure.disabled) return { ok: false, step: 'volume-structure-confirm' }
            confirmStructure.click()
            for (let index = 0; index < 30 && document.querySelector('[data-testid="volume-structure-preview"]'); index += 1) await wait(100)
            const initializedDocuments = await window.novelDesktop.outlines.list()
            const initializedStatus = await window.novelDesktop.outlines.planningStatus()
            const initializedDraft = await window.novelDesktop.planning.draft()
            if (JSON.stringify(initializedDocuments) !== JSON.stringify(after) || initializedDocuments.total?.content !== adoptedTotal) return { ok: false, step: 'volume-structure-overwrote-documents' }
            if (!candidateVolumeTitles.every((title, index) => initializedStatus.volumes.find((item) => item.volume === index + 1)?.title === title)) return { ok: false, step: 'volume-structure-titles' }
            if (initializedStatus.totalApproval.status === 'confirmed' || !initializedDraft?.adoption?.volumeStructure) return { ok: false, step: 'volume-structure-result' }
            const reviewTotal = document.querySelector('[data-testid="review-total-after-volume-init"]')
            if (!reviewTotal) return { ok: false, step: 'volume-outline-review-total-button' }
            reviewTotal.click()
            for (let index = 0; index < 40 && !document.querySelector('.planning-review'); index += 1) await wait(100)
            const acknowledge = document.querySelector('.planning-review .review-acknowledge')
            if (acknowledge && !acknowledge.disabled) {
              acknowledge.click()
            }
            for (let index = 0; index < 40; index += 1) {
              const currentConfirm = document.querySelector('.planning-review .planning-confirm')
              if (currentConfirm && !currentConfirm.disabled) break
              await wait(100)
            }
            const confirmTotal = document.querySelector('.planning-review .planning-confirm')
            if (!confirmTotal || confirmTotal.disabled) return { ok: false, step: 'volume-outline-parent-confirm-ready', review: document.querySelector('.planning-review')?.textContent || '', planning: await window.novelDesktop.outlines.planningStatus() }
            confirmTotal.click()
            let confirmedTotalStatus = null
            for (let index = 0; index < 40; index += 1) {
              confirmedTotalStatus = await window.novelDesktop.outlines.planningStatus()
              if (confirmedTotalStatus.totalApproval.status === 'confirmed' && document.querySelector('.review-copy header .approval-confirmed')) break
              await wait(100)
            }
            if (confirmedTotalStatus?.totalApproval?.status !== 'confirmed' || !document.querySelector('.review-copy header .approval-confirmed')) {
              return { ok: false, step: 'volume-outline-parent-confirmed', status: confirmedTotalStatus?.totalApproval?.status, review: document.querySelector('.planning-review')?.textContent || '' }
            }
            document.querySelector('[data-activity="preparation"]')?.click()
            await wait(180)
            document.querySelector('[data-testid="preparation-automatic"]')?.click()
            for (let index = 0; index < 20 && !document.querySelector('[data-testid="planning-proposal"]'); index += 1) await wait(100)
            for (let index = 0; index < 30; index += 1) {
              const ready = document.querySelector('[data-testid="preview-volume-outline-adoption"]')
              if (ready && !ready.disabled) break
              await wait(100)
            }
            const volumeAdoptionButton = document.querySelector('[data-testid="preview-volume-outline-adoption"]')
            if (!volumeAdoptionButton || volumeAdoptionButton.disabled || !volumeAdoptionButton.textContent?.includes('第 1 卷')) return { ok: false, step: 'volume-outline-adoption-button' }
            const beforeVolumeAdoption = await window.novelDesktop.outlines.list()
            volumeAdoptionButton.click()
            for (let index = 0; index < 20 && !document.querySelector('[data-testid="volume-outline-adoption-preview"]'); index += 1) await wait(100)
            const volumeAdoptionPreview = document.querySelector('[data-testid="volume-outline-adoption-preview"]')
            if (!volumeAdoptionPreview?.textContent?.includes('父级已锁定') || !volumeAdoptionPreview.textContent.includes('本次只更新这一卷')) return { ok: false, step: 'volume-outline-adoption-preview' }
            if (JSON.stringify(beforeVolumeAdoption) !== JSON.stringify(await window.novelDesktop.outlines.list())) return { ok: false, step: 'volume-outline-preview-mutated-official' }
            const confirmVolumeOutline = volumeAdoptionPreview.querySelector('[data-testid="confirm-volume-outline-adoption"]')
            if (!confirmVolumeOutline || confirmVolumeOutline.disabled) return { ok: false, step: 'volume-outline-adoption-confirm' }
            confirmVolumeOutline.click()
            for (let index = 0; index < 30 && document.querySelector('[data-testid="volume-outline-adoption-preview"]'); index += 1) await wait(100)
            const adoptedVolumeDocuments = await window.novelDesktop.outlines.list()
            const adoptedVolumeStatus = await window.novelDesktop.outlines.planningStatus()
            const adoptedVolumeDraft = await window.novelDesktop.planning.draft()
            const firstVolumeDocument = adoptedVolumeDocuments.volumes.find((item) => item.volume === 1)
            if (!firstVolumeDocument?.content?.startsWith('# 第 1 卷 · 城门旧雨') || adoptedVolumeDocuments.volumes.some((item) => item.volume === 2)) return { ok: false, step: 'volume-outline-document-scope' }
            if (adoptedVolumeDocuments.total?.content !== adoptedTotal || adoptedVolumeStatus.totalApproval.status !== 'confirmed' || adoptedVolumeStatus.volumes.find((item) => item.volume === 1)?.approval.status === 'confirmed') return { ok: false, step: 'volume-outline-gate-result' }
            if (adoptedVolumeDraft?.adoption?.volumeOutlines?.[0]?.order !== 1) return { ok: false, step: 'volume-outline-adoption-metadata' }
            if (candidateVolumeTitles.length > 1) {
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="preview-volume-outline-adoption"]')?.textContent?.includes('第 2 卷'); index += 1) await wait(100)
              if (!document.querySelector('[data-testid="preview-volume-outline-adoption"]')?.textContent?.includes('第 2 卷')) return { ok: false, step: 'volume-outline-next-action' }
            } else if (!document.querySelector('[data-testid="review-adopted-volume-outlines"]')) {
              return { ok: false, step: 'volume-outline-review-action' }
            }
            if (candidateVolumeTitles.length !== 1) return { ok: false, step: 'skeleton-smoke-requires-one-volume' }
            document.querySelector('[data-testid="review-adopted-volume-outlines"]')?.click()
            for (let index = 0; index < 30 && !document.querySelector('.planning-review'); index += 1) await wait(100)
            const acknowledgeVolume = document.querySelector('.planning-review .review-acknowledge')
            if (acknowledgeVolume && !acknowledgeVolume.disabled) {
              acknowledgeVolume.click()
            }
            for (let index = 0; index < 50; index += 1) {
              const planning = await window.novelDesktop.outlines.planningStatus()
              const volumeReview = planning.volumes.find((item) => item.volume === 1)?.review
              if (volumeReview?.status === 'acknowledged' || volumeReview?.status === 'clear') break
              const liveAcknowledge = document.querySelector('.planning-review .review-acknowledge')
              if (liveAcknowledge && !liveAcknowledge.disabled && index % 5 === 4) liveAcknowledge.click()
              await wait(100)
            }
            for (let index = 0; index < 40; index += 1) {
              const currentConfirm = document.querySelector('.planning-review .planning-confirm')
              if (currentConfirm && !currentConfirm.disabled) break
              await wait(100)
            }
            const confirmVolume = document.querySelector('.planning-review .planning-confirm')
            if (!confirmVolume || confirmVolume.disabled) return { ok: false, step: 'skeleton-volume-confirm-ready', review: document.querySelector('.planning-review')?.textContent || '', planning: await window.novelDesktop.outlines.planningStatus() }
            confirmVolume.click()
            for (let index = 0; index < 40 && !document.querySelector('.review-copy header .approval-confirmed'); index++) await wait(100)
            if (!document.querySelector('.review-copy header .approval-confirmed')) return { ok: false, step: 'skeleton-volume-confirmed', review: document.querySelector('.planning-review')?.textContent, notice: document.querySelector('.toast')?.textContent }
            document.querySelector('[data-activity="preparation"]')?.click()
            await wait(180)
            document.querySelector('[data-testid="preparation-automatic"]')?.click()
            for (let index = 0; index < 30 && !document.querySelector('[data-testid="start-chapter-skeleton"]'); index += 1) await wait(100)
            const skeletonStart = document.querySelector('[data-testid="start-chapter-skeleton"]')
            if (!skeletonStart || skeletonStart.disabled) return { ok: false, step: 'skeleton-start-button' }
            skeletonStart.click()
            for (let index = 0; index < 120 && !document.querySelector('[data-testid="chapter-skeleton-candidate"]'); index += 1) await wait(100)
            const skeleton = document.querySelector('[data-testid="chapter-skeleton-candidate"]')
            const skeletonDraft = await window.novelDesktop.planning.draft()
            const skeletonProfile = await window.novelDesktop.workspace.getBookProfile()
            if (!skeleton || skeletonDraft?.chapterSkeleton?.chapters.length !== skeletonProfile.chaptersPerVolume) return { ok: false, step: 'skeleton-result' }
            if (skeletonDraft.chapterSkeleton.chapters[0]?.chapter !== 1 || skeletonDraft.chapterSkeleton.chapters.at(-1)?.volume !== 1) return { ok: false, step: 'skeleton-order' }
            if (JSON.stringify(await window.novelDesktop.chapterOutlines.list()) !== JSON.stringify(beforeChapterOutlines)) return { ok: false, step: 'skeleton-mutated-formal-chapters' }
            for (let index = 0; index < 30 && !document.querySelector('[data-testid="start-chapter-detail"]'); index += 1) await wait(100)
            const detailStart = document.querySelector('[data-testid="start-chapter-detail"]')
            if (!detailStart || detailStart.disabled || !detailStart.textContent?.includes('第 1 卷')) return { ok: false, step: 'chapter-detail-start-button' }
            detailStart.click()
            for (let index = 0; index < 180 && !document.querySelector('[data-testid="chapter-detail-candidate"]'); index += 1) await wait(100)
            const detailDraft = await window.novelDesktop.planning.draft()
            if (!document.querySelector('[data-testid="chapter-detail-candidate"]') || detailDraft?.chapterDetails?.[0]?.chapters.length !== skeletonProfile.chaptersPerVolume) return { ok: false, step: 'chapter-detail-result' }
            if (!detailDraft.chapterDetails[0].chapters.every((chapter) => chapter.beats.length >= 2 && chapter.forbiddenEvents.length >= 1)) return { ok: false, step: 'chapter-detail-contract-fields' }
            if (JSON.stringify(await window.novelDesktop.chapterOutlines.list()) !== JSON.stringify(beforeChapterOutlines)) return { ok: false, step: 'chapter-detail-mutated-formal-chapters' }
            for (let index = 0; index < 30 && !document.querySelector('[data-testid="preview-chapter-detail-adoption"]'); index += 1) await wait(100)
            const chapterAdoptionButton = document.querySelector('[data-testid="preview-chapter-detail-adoption"]')
            if (!chapterAdoptionButton || chapterAdoptionButton.disabled || !chapterAdoptionButton.textContent?.includes('第 1 章')) return { ok: false, step: 'chapter-detail-adoption-button' }
            const chaptersBeforeAdoption = await window.novelDesktop.chapters.list()
            chapterAdoptionButton.click()
            for (let index = 0; index < 30 && !document.querySelector('[data-testid="chapter-detail-adoption-preview"]'); index += 1) await wait(100)
            const chapterAdoptionPreview = document.querySelector('[data-testid="chapter-detail-adoption-preview"]')
            if (!chapterAdoptionPreview?.textContent?.includes('三重指纹复核') || !chapterAdoptionPreview.textContent.includes('不会覆盖其他章、自动确认、创建正文或启动模型')) return { ok: false, step: 'chapter-detail-adoption-preview' }
            if (JSON.stringify(await window.novelDesktop.chapterOutlines.list()) !== JSON.stringify(beforeChapterOutlines)) return { ok: false, step: 'chapter-detail-preview-mutated-formal' }
            const confirmChapterDetail = chapterAdoptionPreview.querySelector('[data-testid="confirm-chapter-detail-adoption"]')
            if (!confirmChapterDetail || confirmChapterDetail.disabled) return { ok: false, step: 'chapter-detail-adoption-confirm' }
            confirmChapterDetail.click()
            for (let index = 0; index < 30 && document.querySelector('[data-testid="chapter-detail-adoption-preview"]'); index += 1) await wait(100)
            const afterChapterOutlines = await window.novelDesktop.chapterOutlines.list()
            const changedChapterIds = afterChapterOutlines.filter((item) => item.content !== beforeChapterOutlines.find((before) => before.chapterId === item.chapterId)?.content).map((item) => item.chapterId)
            const adoptedChapterDraft = await window.novelDesktop.planning.draft()
            const adoptedChapterStatus = await window.novelDesktop.outlines.planningStatus(1)
            if (JSON.stringify(changedChapterIds) !== '[1]' || !afterChapterOutlines.find((item) => item.chapterId === 1)?.content.includes('进入状态：')) return { ok: false, step: 'chapter-detail-adoption-scope' }
            if (adoptedChapterDraft?.adoption?.chapterOutlines?.[0]?.chapter !== 1 || adoptedChapterStatus.chapter?.review.status === 'confirmed' || adoptedChapterStatus.chapterPlacements.find((item) => item.chapterId === 1)?.volume !== 1) return { ok: false, step: 'chapter-detail-adoption-gate' }
            if (JSON.stringify(await window.novelDesktop.chapters.list()) !== JSON.stringify(chaptersBeforeAdoption)) return { ok: false, step: 'chapter-detail-created-manuscript' }
            return { ok: true, step: 'chapter-detail-adoption-complete' }
          })()`)
}
