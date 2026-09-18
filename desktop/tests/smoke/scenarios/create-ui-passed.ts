import type { BrowserWindow } from 'electron'

export function runCreateUiPassedScenario({ window, expectedLibraryWords, createParent }: { window: BrowserWindow; expectedLibraryWords: "40 字" | "28 字" | "10 字"; createParent: string | undefined }) {
  return window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            let smokeWorkItem = Array.from(document.querySelectorAll('.work-item-open')).find((button) => button.getAttribute('aria-label')?.includes('烟测书稿'))
            if (!smokeWorkItem) return { ok: false, step: 'restart-import-project-visible' }
            const smokeWorkCard = smokeWorkItem.closest('.work-item-card')
            if (!smokeWorkCard?.textContent?.includes('2 章') || !smokeWorkCard.textContent.includes(${JSON.stringify(expectedLibraryWords)})) return { ok: false, step: 'library-manuscript-count', text: smokeWorkCard?.textContent }
            if (smokeWorkCard.querySelector('.work-cover-title')?.textContent?.trim() !== '烟测书稿') return { ok: false, step: 'library-cover-title', text: smokeWorkCard.querySelector('.work-cover-title')?.textContent }
            const coverRect = smokeWorkCard.querySelector('.work-cover-open')?.getBoundingClientRect()
            const continueRect = smokeWorkItem.getBoundingClientRect()
            if (!coverRect || coverRect.width / coverRect.height > 0.56) return { ok: false, step: 'library-cover-ratio', rect: coverRect && { width: coverRect.width, height: coverRect.height } }
            if (Math.abs(coverRect.bottom - continueRect.bottom) > 3) return { ok: false, step: 'library-cover-action-alignment', coverBottom: coverRect.bottom, continueBottom: continueRect.bottom }
            if (smokeWorkCard.getBoundingClientRect().width > 248) return { ok: false, step: 'library-card-width-density', width: smokeWorkCard.getBoundingClientRect().width }
            if (smokeWorkCard.getBoundingClientRect().height > 200) return { ok: false, step: 'library-card-density', height: smokeWorkCard.getBoundingClientRect().height }
            const titleRect = smokeWorkCard.querySelector('.work-title-line b')?.getBoundingClientRect()
            const genreRect = smokeWorkCard.querySelector('.work-title-line small')?.getBoundingClientRect()
            if (!titleRect || !genreRect || genreRect.top < titleRect.bottom + 3) return { ok: false, step: 'library-genre-new-line', titleRect, genreRect }
            const shelfCards = Array.from(document.querySelectorAll('.work-item-grid > .work-item-card'))
            const firstShelfRect = shelfCards[0]?.getBoundingClientRect()
            const secondShelfRect = shelfCards[1]?.getBoundingClientRect()
            if (firstShelfRect && secondShelfRect && Math.abs(firstShelfRect.top - secondShelfRect.top) < 3 && firstShelfRect.right >= secondShelfRect.left) return { ok: false, step: 'library-card-overlap', firstShelfRect, secondShelfRect }
            const menuRect = smokeWorkCard.querySelector('.work-item-menu-trigger')?.getBoundingClientRect()
            const menuDotsRect = smokeWorkCard.querySelector('.work-item-menu-trigger span')?.getBoundingClientRect()
            if (!menuRect || !menuDotsRect
              || Math.abs((menuRect.top + menuRect.height / 2) - (menuDotsRect.top + menuDotsRect.height / 2)) > 1
              || Math.abs((menuRect.left + menuRect.width / 2) - (menuDotsRect.left + menuDotsRect.width / 2)) > 1) return { ok: false, step: 'library-menu-alignment' }
            if (!getComputedStyle(smokeWorkCard.querySelector('.work-cover-title')).fontFamily.match(/LanjianSerif|Songti|SimSun/i)) return { ok: false, step: 'library-cover-typeface', font: getComputedStyle(smokeWorkCard.querySelector('.work-cover-title')).fontFamily }
            const initialShelfOrder = Array.from(document.querySelectorAll('.work-item-open')).map((button) => button.getAttribute('aria-label'))
            const damagedSourcesWorkItem = Array.from(document.querySelectorAll('.work-item-open')).find((button) => button.getAttribute('aria-label')?.includes('损坏素材账本烟测'))
            if (!damagedSourcesWorkItem) return { ok: false, step: 'damaged-source-project-visible' }
            damagedSourcesWorkItem.click()
            for (let index = 0; index < 40 && !document.querySelector('[data-issue-id="researchSourcesUnreadable"]'); index += 1) await wait(100)
            const sourceIssue = document.querySelector('[data-issue-id="researchSourcesUnreadable"]')
            if (!sourceIssue?.textContent?.includes('素材来源账本需要人工核对') || !sourceIssue.textContent.includes('没有覆盖原文件') || !document.body.textContent.includes('仍可打开')) {
              return { ok: false, step: 'damaged-source-ledger-visible-with-manuscript', issue: sourceIssue?.textContent || '', body: document.body.textContent.slice(0, 600) }
            }
            document.querySelector('[data-activity="research"]')?.click()
            await wait(180)
            document.querySelector('[data-testid="material-tab-manual"]')?.click()
            await wait(120)
            const sourceLock = document.querySelector('[data-testid="material-source-ledger-locked"]')
            if (!sourceLock?.textContent?.includes('没有把损坏账本当作空素材库') || document.querySelector('[data-testid="new-manual-source"]')) {
              return { ok: false, step: 'damaged-source-ledger-material-lock', lock: sourceLock?.textContent || '', newButtonVisible: Boolean(document.querySelector('[data-testid="new-manual-source"]')) }
            }
            let damagedWriteRejected = false
            try { await window.novelDesktop.research.createSource({ title: '不得写入', excerpt: '损坏账本期间不得新增', userNotes: '' }) } catch { damagedWriteRejected = true }
            if (!damagedWriteRejected) return { ok: false, step: 'damaged-source-ledger-main-write-gate' }
            document.querySelector('.project-switch')?.click()
            await wait(250)
            const damagedEventsWorkItem = Array.from(document.querySelectorAll('.work-item-open')).find((button) => button.getAttribute('aria-label')?.includes('损坏正式事件账本烟测'))
            if (!damagedEventsWorkItem) return { ok: false, step: 'damaged-event-project-visible' }
            damagedEventsWorkItem.click()
            for (let index = 0; index < 40 && !document.querySelector('[data-issue-id="researchEventsUnreadable"]'); index += 1) await wait(100)
            const eventIssue = document.querySelector('[data-issue-id="researchEventsUnreadable"]')
            document.querySelector('[data-activity="desk"]')?.click()
            await wait(120)
            if (!eventIssue?.textContent?.includes('正式事件账本需要人工核对') || !document.body.textContent.includes('事件账本损坏仍可手写')) {
              return { ok: false, step: 'damaged-event-ledger-visible-with-manuscript', issue: eventIssue?.textContent || '', body: document.body.textContent.slice(0, 700) }
            }
            document.querySelector('[data-activity="research"]')?.click()
            await wait(180)
            document.querySelector('[data-testid="material-tab-events"]')?.click()
            await wait(120)
            const eventLock = document.querySelector('[data-testid="material-event-ledger-locked"]')
            if (!eventLock?.textContent?.includes('没有把损坏账本当作零条事件') || document.querySelector('[data-testid="material-events-view"]')) {
              return { ok: false, step: 'damaged-event-ledger-material-lock', lock: eventLock?.textContent || '', eventEditorVisible: Boolean(document.querySelector('[data-testid="material-events-view"]')) }
            }
            let damagedEventWriteRejected = false
            try {
              await window.novelDesktop.research.createEventCandidate({ sourceId: '3196f6f7-2fe9-4ff0-982e-1860e283ed72', time: '第二日', characters: ['作者'], location: '书房', event: '不得写入候选' })
            } catch { damagedEventWriteRejected = true }
            if (!damagedEventWriteRejected) return { ok: false, step: 'damaged-event-ledger-main-write-gate' }
            document.querySelector('[data-activity="timeline"]')?.click()
            await wait(180)
            const timelineEventLock = document.querySelector('[data-testid="timeline-event-ledger-locked"]')
            if (!timelineEventLock?.textContent?.includes('不会显示虚假的“零条事件”') || !document.body.textContent.includes('作者直接纪事仍可读取')) {
              return { ok: false, step: 'damaged-event-ledger-timeline-isolation', lock: timelineEventLock?.textContent || '', body: document.body.textContent.slice(0, 800) }
            }
            document.querySelector('.project-switch')?.click()
            // Closing a work item flushes pending state before the shelf becomes
            // stable. Do not click a shelf action while that cleanup can remount
            // the library underneath it.
            await wait(3_000)
            const damagedOutlineWorkItem = Array.from(document.querySelectorAll('.work-item-open')).find((button) => button.getAttribute('aria-label')?.includes('损坏大纲版本账本烟测'))
            if (!damagedOutlineWorkItem) return { ok: false, step: 'damaged-outline-project-visible' }
            damagedOutlineWorkItem.click()
            for (let index = 0; index < 40 && !document.querySelector('[data-issue-id="outlinePlanningUnreadable"]'); index += 1) await wait(100)
            const outlineIssue = document.querySelector('[data-issue-id="outlinePlanningUnreadable"]')
            document.querySelector('[data-activity="desk"]')?.click()
            await wait(140)
            const damagedOutlineEditor = document.querySelector('[data-testid="manuscript-input"]')
            if (!outlineIssue?.textContent?.includes('大纲版本账本需要人工核对') || !damagedOutlineEditor?.textContent?.includes('正文仍应可读')) {
              return { ok: false, step: 'damaged-outline-ledger-visible-with-manuscript', issue: outlineIssue?.textContent || '', manuscript: damagedOutlineEditor?.textContent || '' }
            }
            damagedOutlineEditor.focus()
            document.execCommand('selectAll')
            document.execCommand('insertText', false, '损坏谋篇账本期间，正文点击保存仍然有效。')
            await wait(140)
            document.querySelector('[data-testid="save-manuscript"]')?.click()
            for (let index = 0; index < 30 && !document.querySelector('.editor-save-state')?.textContent?.includes('已存于本地'); index += 1) await wait(100)
            if (!document.querySelector('.editor-save-state')?.textContent?.includes('已存于本地')) return { ok: false, step: 'damaged-outline-ledger-manuscript-save' }
            for (let index = 0; index < 40 && (await window.novelDesktop.chapters.get(1)).content !== '　　损坏谋篇账本期间，正文点击保存仍然有效。'; index++) await wait(100)
            if ((await window.novelDesktop.chapters.get(1)).content !== '　　损坏谋篇账本期间，正文点击保存仍然有效。') return { ok: false, step: 'damaged-outline-ledger-manuscript-persisted-content', editor: damagedOutlineEditor.textContent, saved: (await window.novelDesktop.chapters.get(1)).content }
            document.querySelector('[data-activity="outline"]')?.click()
            for (let index = 0; index < 30 && !document.querySelector('[data-testid="outline-planning-ledger-locked"]'); index += 1) await wait(100)
            const outlineLock = document.querySelector('[data-testid="outline-planning-ledger-locked"]')
            const outlineText = document.querySelector('[aria-label="全局总纲正文"]')
            const outlineSave = document.querySelector('[data-testid="save-outline-document"]')
            const outlineAi = document.querySelector('[data-testid="generate-total-outline-ai"]')
            if (!outlineLock?.textContent?.includes('谋篇版本与确认暂时锁定') || !outlineText?.textContent?.includes('总纲原文仍应可读') || outlineText.contentEditable !== 'false' || !outlineSave?.disabled || !outlineAi?.disabled) {
              const conflict = document.querySelector('[data-testid="manuscript-conflict"]')
              return { ok: false, step: 'damaged-outline-ledger-planning-lock', active: document.querySelector('.creation-activity.selected')?.getAttribute('data-activity'), saveState: document.querySelector('[data-testid="manuscript-save-state"]')?.textContent || '', expected: conflict?.dataset.expectedRevision, actual: conflict?.dataset.externalRevision, lock: outlineLock?.textContent || '', outline: outlineText?.value || '', readOnly: outlineText?.readOnly, saveDisabled: outlineSave?.disabled, aiDisabled: outlineAi?.disabled }
            }
            const revealOutline = document.querySelector('[data-testid="reveal-bootstrap-issue-outlinePlanningUnreadable"]')
            if (!revealOutline) return { ok: false, step: 'damaged-outline-ledger-reveal-visible' }
            revealOutline.click()
            await wait(180)
            let damagedOutlineWriteRejected = false
            try { await window.novelDesktop.outlines.update('total', '不得覆盖现有总纲') } catch { damagedOutlineWriteRejected = true }
            if (!damagedOutlineWriteRejected) return { ok: false, step: 'damaged-outline-ledger-main-write-gate' }
            document.querySelector('.project-switch')?.click()
            await wait(250)
            const damagedCharacterWorkItem = Array.from(document.querySelectorAll('.work-item-open')).find((button) => button.getAttribute('aria-label')?.includes('损坏人物状态账本烟测'))
            if (!damagedCharacterWorkItem) return { ok: false, step: 'damaged-character-project-visible' }
            damagedCharacterWorkItem.click()
            for (let index = 0; index < 40 && !document.querySelector('[data-issue-id="characterStateUnreadable"]'); index += 1) await wait(100)
            const characterIssue = document.querySelector('[data-issue-id="characterStateUnreadable"]')
            document.querySelector('[data-activity="desk"]')?.click()
            await wait(140)
            const damagedCharacterEditor = document.querySelector('[data-testid="manuscript-input"]')
            if (!characterIssue?.textContent?.includes('人物状态账本需要人工核对') || !damagedCharacterEditor?.textContent?.includes('正文仍应可读')) {
              return { ok: false, step: 'damaged-character-ledger-visible-with-manuscript', issue: characterIssue?.textContent || '', manuscript: damagedCharacterEditor?.textContent || '' }
            }
            damagedCharacterEditor.focus()
            document.execCommand('selectAll')
            document.execCommand('insertText', false, '损坏人物账本期间，正文点击保存仍然有效。')
            await wait(140)
            document.querySelector('[data-testid="save-manuscript"]')?.click()
            for (let index = 0; index < 30 && !document.querySelector('.editor-save-state')?.textContent?.includes('已存于本地'); index += 1) await wait(100)
            if (!document.querySelector('.editor-save-state')?.textContent?.includes('已存于本地')) return { ok: false, step: 'damaged-character-ledger-manuscript-save' }
            for (let index = 0; index < 40 && (await window.novelDesktop.chapters.get(1)).content !== '　　损坏人物账本期间，正文点击保存仍然有效。'; index++) await wait(100)
            if ((await window.novelDesktop.chapters.get(1)).content !== '　　损坏人物账本期间，正文点击保存仍然有效。') return { ok: false, step: 'damaged-character-ledger-manuscript-persisted-content', editor: damagedCharacterEditor.textContent, saved: (await window.novelDesktop.chapters.get(1)).content }
            if (!document.querySelector('.assistant-panel')) {
              document.querySelector('[aria-controls="assistant-drawer"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('.assistant-panel'); index += 1) await wait(100)
            }
            const characterLock = document.querySelector('[data-testid="character-state-ledger-locked"]')
            const proseButton = document.querySelector('[data-testid="run-writing-agent"]')
            if (!characterLock?.textContent?.includes('不会把损坏状态当作无人或无记忆') || !proseButton?.disabled) return { ok: false, step: 'damaged-character-ledger-ai-lock-visible', lock: characterLock?.textContent || '', proseDisabled: proseButton?.disabled }
            let characterReadRejected = false
            let factPackRejected = false
            try { await window.novelDesktop.workspace.getCharacterState() } catch { characterReadRejected = true }
            try { await window.novelDesktop.workspace.getContextFactPack(1) } catch { factPackRejected = true }
            if (!characterReadRejected || !factPackRejected) return { ok: false, step: 'damaged-character-ledger-main-read-gates', characterReadRejected, factPackRejected }
            const revealCharacter = document.querySelector('[data-testid="reveal-bootstrap-issue-characterStateUnreadable"]')
            if (!revealCharacter) return { ok: false, step: 'damaged-character-ledger-reveal-visible' }
            revealCharacter.click()
            await wait(180)
            document.querySelector('.project-switch')?.click()
            await wait(250)
            const damagedChapterOrderWorkItem = Array.from(document.querySelectorAll('.work-item-open')).find((button) => button.getAttribute('aria-label')?.includes('损坏章节顺序账本烟测'))
            if (!damagedChapterOrderWorkItem) return { ok: false, step: 'damaged-chapter-order-project-visible' }
            damagedChapterOrderWorkItem.click()
            for (let index = 0; index < 40 && !document.querySelector('[data-issue-id="chapterOrderUnreadable"]'); index += 1) await wait(100)
            document.querySelector('[data-activity="desk"]')?.click()
            await wait(160)
            const orderIssue = document.querySelector('[data-issue-id="chapterOrderUnreadable"]')
            const orderReadOnly = document.querySelector('[data-testid="manuscript-order-read-only"]')
            const orderEditor = document.querySelector('[data-testid="manuscript-input"]')
            const orderTitle = document.querySelector('[data-testid="manuscript-title-input"]')
            const createChapterButton = document.querySelector('[aria-label="新建章节"]')
            const importChapterButton = document.querySelector('[aria-label="导入文稿文件"]')
            const saveOrderManuscript = document.querySelector('[data-testid="save-manuscript"]')
            if (!orderIssue?.textContent?.includes('章节顺序账本需要人工核对') || !orderReadOnly?.textContent?.includes('叙事顺序未知') || !orderEditor?.textContent?.includes('第一份独立正文必须可读') || orderEditor.contentEditable !== 'false' || !orderTitle?.readOnly || !createChapterButton?.disabled || !importChapterButton?.disabled || !saveOrderManuscript?.disabled) {
              return { ok: false, step: 'damaged-chapter-order-read-only-inventory', issue: orderIssue?.textContent || '', notice: orderReadOnly?.textContent || '', manuscript: orderEditor?.textContent || '', editorReadOnly: orderEditor?.contentEditable === 'false', titleReadOnly: orderTitle?.readOnly, createDisabled: createChapterButton?.disabled, importDisabled: importChapterButton?.disabled, saveDisabled: saveOrderManuscript?.disabled }
            }
            const secondUnsequenced = Array.from(document.querySelectorAll('.chapter-tree-row')).find((button) => button.textContent?.includes('独立正文乙'))
            secondUnsequenced?.click()
            for (let index = 0; index < 20 && !document.querySelector('[data-testid="manuscript-input"]')?.textContent?.includes('第二份独立正文必须可读'); index += 1) await wait(100)
            if (!document.querySelector('[data-testid="manuscript-input"]')?.textContent?.includes('第二份独立正文必须可读')) return { ok: false, step: 'damaged-chapter-order-second-file-readable' }
            let orderUpdateRejected = false
            let orderReorderRejected = false
            try { await window.novelDesktop.chapters.update(7, { title: '不得改写', content: '不得改写正文' }) } catch { orderUpdateRejected = true }
            try { await window.novelDesktop.chapters.reorder(12, 1) } catch { orderReorderRejected = true }
            if (!orderUpdateRejected || !orderReorderRejected) return { ok: false, step: 'damaged-chapter-order-main-write-gates', orderUpdateRejected, orderReorderRejected }
            const revealOrder = document.querySelector('[data-testid="reveal-bootstrap-issue-chapterOrderUnreadable"]')
            if (!revealOrder) return { ok: false, step: 'damaged-chapter-order-reveal-visible' }
            revealOrder.click()
            await wait(180)
            document.querySelector('.project-switch')?.click()
            await wait(250)
            smokeWorkItem = Array.from(document.querySelectorAll('.work-item-open')).find((button) => button.getAttribute('aria-label')?.includes('烟测书稿'))
            if (!smokeWorkItem) return { ok: false, step: 'restart-import-project-visible-after-damaged-ledger-checks' }
            smokeWorkItem.click()
            for (let index = 0; index < 30 && (!document.querySelector('[data-testid="import-recovery"]') || document.querySelectorAll('[data-testid="workspace-bootstrap-issue"]').length < 2); index += 1) await wait(100)
            document.querySelector('[data-activity="desk"]')?.click()
            await wait(100)
            const planningIssue = document.querySelector('[data-issue-id="planningDraftUnreadable"]')
            const promptIssue = document.querySelector('[data-issue-id="promptProfileUnreadable"]')
            const recoverPlanning = planningIssue?.querySelector('[data-testid="recover-damaged-planning-draft"]')
            const recoverPrompt = promptIssue?.querySelector('[data-testid="recover-damaged-prompt-profile"]')
            if (!planningIssue?.textContent?.includes('自动谋篇候选需要修复') || !promptIssue?.textContent?.includes('本书自定义提示词需要修复') || !planningIssue.textContent.includes('正式设定、大纲与正文仍可正常读取') || !document.body.textContent.includes('雨夜追迹') || !recoverPlanning || !recoverPrompt) {
              return { ok: false, step: 'damaged-auxiliary-files-visible-with-formal-manuscript', planningIssue: planningIssue?.textContent || '', promptIssue: promptIssue?.textContent || '', body: document.body.textContent.slice(0, 500) }
            }
            const originalConfirm = window.confirm
            window.confirm = () => true
            recoverPlanning.click()
            for (let index = 0; index < 40 && document.querySelector('[data-issue-id="planningDraftUnreadable"]'); index += 1) await wait(100)
            if (document.querySelector('[data-issue-id="planningDraftUnreadable"]') || !document.querySelector('[data-issue-id="promptProfileUnreadable"]') || !document.querySelector('.toast')?.textContent?.includes('损坏候选已原样保留')) {
              window.confirm = originalConfirm
              return { ok: false, step: 'damaged-planning-recovery', planningVisible: Boolean(document.querySelector('[data-issue-id="planningDraftUnreadable"]')), promptVisible: Boolean(document.querySelector('[data-issue-id="promptProfileUnreadable"]')), toast: document.querySelector('.toast')?.textContent || '' }
            }
            document.querySelector('[data-testid="recover-damaged-prompt-profile"]')?.click()
            for (let index = 0; index < 40 && document.querySelector('[data-issue-id="promptProfileUnreadable"]'); index += 1) await wait(100)
            window.confirm = originalConfirm
            const promptProfileAfter = await window.novelDesktop.workspace.getPromptProfile()
            if (document.querySelector('[data-testid="workspace-bootstrap-issue"]') || !document.querySelector('.toast')?.textContent?.includes('当前已恢复内置提示词') || promptProfileAfter.entries.some((entry) => entry.customized || entry.effective !== entry.builtIn)) {
              return { ok: false, step: 'damaged-prompt-profile-recovery', issueVisible: Boolean(document.querySelector('[data-testid="workspace-bootstrap-issue"]')), toast: document.querySelector('.toast')?.textContent || '', customized: promptProfileAfter.entries.filter((entry) => entry.customized).length }
            }
            const recovery = document.querySelector('[data-testid="import-recovery"]')
            const resumeRecovery = recovery?.querySelector('[data-testid="resume-import-manifest"]')
            if (!recovery?.textContent?.includes('文稿接续待继续') || !recovery.textContent.includes('1/2') || !resumeRecovery) return { ok: false, step: 'restart-import-recovery-visible' }
            resumeRecovery.click()
            for (let index = 0; index < 50; index += 1) {
              if (!document.querySelector('[data-testid="import-recovery"]') && document.body.textContent.includes('文稿接续已恢复完成')) break
              await wait(100)
            }
            const recoveriesAfter = await window.novelDesktop.imports.recoverableManifests()
            if (document.querySelector('[data-testid="import-recovery"]') || recoveriesAfter.length || !document.body.textContent.includes('文稿接续已恢复完成')) return {
              ok: false,
              step: 'restart-import-recovery-complete',
              recoveryVisible: Boolean(document.querySelector('[data-testid="import-recovery"]')),
              recoveriesAfter: recoveriesAfter.length,
              visibleError: document.querySelector('.toast')?.textContent || ''
            }
            document.querySelector('.project-switch')?.click()
            await wait(250)
            const shelfOrderAfterOpen = Array.from(document.querySelectorAll('.work-item-open')).map((button) => button.getAttribute('aria-label'))
            if (JSON.stringify(shelfOrderAfterOpen) !== JSON.stringify(initialShelfOrder)) return { ok: false, step: 'shelf-order-changed-after-open', initialShelfOrder, shelfOrderAfterOpen }
            await wait(700)
            const libraryText = document.querySelector('.library-heading')?.textContent || ''
            const txtEntry = document.querySelector('[data-testid="create-from-txt"]')
            if (!libraryText.includes('打开岚笺作品') || !libraryText.includes('新建空白作品') || !txtEntry) return { ok: false, step: 'library-entry-semantics' }
            document.querySelector('[data-testid="create-work-item"]')?.click()
            await wait(120)
            const modal = document.querySelector('.modal')
            const name = modal?.querySelector('input:not([readonly])')
            const parent = modal?.querySelector('.path-row input')
            if (!modal || !name || !parent || modal.querySelector('textarea, select')) return { ok: false, step: 'create-modal' }
            name.value = '点击链路新书'
            name.dispatchEvent(new Event('input', { bubbles: true }))
            parent.value = ${JSON.stringify(createParent)}
            parent.dispatchEvent(new Event('input', { bubbles: true }))
            modal.requestSubmit()
            await wait(900)
            const created = document.querySelector('.project-switch span')?.textContent?.includes('点击链路新书')
            const cloneError = document.body.textContent?.includes('An object could not be cloned')
            if (!created || cloneError) return { ok: false, step: cloneError ? 'clone-error' : 'project-not-created' }
            document.querySelector('.project-switch')?.click()
            await wait(250)
            const createdCard = Array.from(document.querySelectorAll('.work-item-card')).find((item) => item.textContent?.includes('点击链路新书'))
            const manageCreated = createdCard?.querySelector('.work-item-menu-trigger')
            if (!createdCard || !manageCreated) return { ok: false, step: 'project-manage-entry' }
            manageCreated.click()
            await wait(100)
            const trashCreated = createdCard.querySelector('[data-testid="trash-work-item"]')
            if (!trashCreated) return { ok: false, step: 'project-trash-action' }
            trashCreated.click()
            await wait(100)
            const trashSheet = document.querySelector('[data-testid="project-trash-confirmation"]')
            const trashName = trashSheet?.querySelector('[data-testid="project-trash-name"]')
            const trashConfirm = trashSheet?.querySelector('[data-testid="confirm-trash-work-item"]')
            if (!trashSheet || !trashName || !trashConfirm || !trashConfirm.disabled) return { ok: false, step: 'project-trash-confirmation' }
            trashName.value = '点击链路新书'
            trashName.dispatchEvent(new Event('input', { bubbles: true }))
            await wait(50)
            if (trashConfirm.disabled) return { ok: false, step: 'project-trash-verification' }
            trashConfirm.click()
            for (let index = 0; index < 20 && !document.querySelector('[data-testid="project-trash-success"]'); index += 1) await wait(100)
            const deletedFromShelf = !Array.from(document.querySelectorAll('.work-item-card')).some((item) => item.textContent?.includes('点击链路新书'))
            const persistedList = await window.novelDesktop.projects.list()
            if (!deletedFromShelf || persistedList.projects.some((item) => item.title === '点击链路新书')) return { ok: false, step: 'project-trash-persistence' }
            const original = Array.from(document.querySelectorAll('.work-item-card')).find((item) => item.textContent?.includes('烟测书稿'))
            original?.querySelector('.work-item-open')?.click()
            await wait(650)
            if (!document.querySelector('.project-switch span')?.textContent?.includes('烟测书稿')) return { ok: false, step: 'return-original' }
            const creationActivities = Array.from(document.querySelectorAll('.activitybar .creation-activity'))
            const activityOrder = creationActivities.map((item) => item.getAttribute('data-activity'))
            const activityLabels = creationActivities.map((item) => item.getAttribute('aria-label'))
            if (JSON.stringify(activityOrder) !== JSON.stringify(['profile', 'research', 'preparation', 'world', 'timeline', 'outline', 'desk'])
              || JSON.stringify(activityLabels) !== JSON.stringify(['定书', '素材', '筹备', '设定', '纪事', '谋篇', '书稿'])) return { ok: false, step: 'creation-activity-order', activityOrder, activityLabels }
            const settingsActivity = document.querySelector('.activitybar .utility-activity[data-activity="settings"]')
            if (!settingsActivity || settingsActivity.getAttribute('aria-label') !== '设置') return { ok: false, step: 'settings-activity-separated' }
            const workbench = document.querySelector('.workbench')
            const redundantEditorTab = document.querySelector('.editor-tabs, .editor-tab')
            const workbenchRows = workbench ? getComputedStyle(workbench).gridTemplateRows : ''
            if (!workbench || redundantEditorTab || workbenchRows.split(' ').length !== 1) return { ok: false, step: 'redundant-editor-tab-removed', workbenchRows }
            creationActivities.find((item) => item.getAttribute('data-activity') === 'world')?.click()
            await wait(100)
            if (!document.querySelector('.pane-title span')?.textContent?.includes('世界观')
              || !document.querySelector('.creation-activity[data-activity="world"]')?.classList.contains('selected')
              || !document.querySelector('.document-editor header .control-button.primary')?.textContent?.includes('保存世界观')) return { ok: false, step: 'foundation-activity-route' }
            Array.from(document.querySelectorAll('.explorer .tree-item')).find((item) => item.textContent?.includes('境界系统'))?.click()
            await wait(100)
            if (!document.querySelector('.pane-title span')?.textContent?.includes('境界')
              || !document.querySelector('.creation-activity[data-activity="world"]')?.classList.contains('selected')
              || !document.querySelector('.structured-editor header .control-button.primary')?.textContent?.includes('保存设定')
              || !document.querySelector('.structured-editor header .control-button.secondary')?.textContent?.includes('添加境界')) return { ok: false, step: 'foundation-group-selection' }
            settingsActivity.click()
            await wait(100)
            if (!document.querySelector('.pane-title span')?.textContent?.includes('接口连接')
              || !settingsActivity.classList.contains('selected')
              || document.querySelector('.creation-activity.selected')
              || document.querySelector('.assistant-panel')) return { ok: false, step: 'settings-utility-route' }
            const settingsWorkbench = document.querySelector('.workbench')
            const settingsStudio = document.querySelector('.studio')
            const settingsWorkbenchRect = settingsWorkbench?.getBoundingClientRect()
            const settingsColumns = settingsStudio ? getComputedStyle(settingsStudio).gridTemplateColumns : ''
            if (!settingsWorkbenchRect
              || Math.abs(settingsWorkbenchRect.right - window.innerWidth) > 1
              || settingsColumns.split(' ').length !== 3
              || document.querySelector('[aria-label="切换智能助笔侧栏"]')) return {
                ok: false,
                step: 'settings-dedicated-layout',
                settingsColumns,
                workbenchRight: settingsWorkbenchRect?.right,
                viewportRight: window.innerWidth
            }
            const settingsNavigation = Array.from(document.querySelectorAll('[data-testid^="settings-nav-"]'))
            const expectedSettings = ['connection', 'routing', 'context', 'writing', 'story', 'prompts', 'research', 'appearance', 'project']
            if (!expectedSettings.every((id) => document.querySelector('[data-testid="settings-nav-' + id + '"]')) || !document.querySelector('[data-testid="settings-page-connection"]')) return { ok: false, step: 'settings-navigation-stable-ids', count: settingsNavigation.length }
            document.querySelector('[data-testid="settings-nav-writing"]')?.click()
            await wait(100)
            const writingPreferences = document.querySelector('[data-testid="settings-page-writing-preferences"]')
            if (!writingPreferences
              || !writingPreferences.textContent?.includes('网文展开')
              || !writingPreferences.textContent.includes('平衡审校')
              || !writingPreferences.querySelector('[data-testid="save-writing-preferences"]')) return { ok: false, step: 'writing-preferences-route' }
            if (!writingPreferences.querySelector('[data-testid="chapter-generation-reviewed"]')) return { ok: false, step: 'reviewed-generation-control' }
            document.querySelector('[data-testid="settings-nav-connection"]')?.click()
            await wait(100)
            const connectionTestAction = document.querySelector('[data-testid="test-ai-connection"]')
            const connectionSaveAction = document.querySelector('[data-testid="settings-page-connection"] .connection-command-actions .save-action')
            const connectionTestStyle = connectionTestAction ? getComputedStyle(connectionTestAction) : null
            const settingsTitle = document.querySelector('.settings-page-header h2')
            const bodyTypography = getComputedStyle(document.body)
            const titleTypography = settingsTitle ? getComputedStyle(settingsTitle) : null
            if (!titleTypography
              || !bodyTypography.fontFamily.includes('LanjianSans')
              || !titleTypography.fontFamily.includes('LanjianSerif')
              || Number.parseFloat(bodyTypography.fontSize) < 14
              || Number.parseFloat(titleTypography.fontSize) < 24) return {
                ok: false,
                step: 'editorial-typography-roles',
                bodyFamily: bodyTypography.fontFamily,
                bodySize: bodyTypography.fontSize,
                titleFamily: titleTypography?.fontFamily,
                titleSize: titleTypography?.fontSize
              }
            if (!connectionTestAction?.textContent?.includes('验证已分配模型')
              || !connectionTestStyle
              || connectionTestAction.getBoundingClientRect().height < 40
              || connectionTestStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
              || connectionTestStyle.borderTopWidth === '0px'
              || !connectionSaveAction?.classList.contains('control-button')
              || !connectionSaveAction.classList.contains('primary')
              || !connectionSaveAction.classList.contains('save-action')
              || connectionSaveAction.querySelectorAll('svg').length !== 1
              || document.querySelector('.settings-editor .seal-action')) return { ok: false, step: 'settings-connection-test-action' }
            for (const [id, title, page, saveLabel] of [
              ['routing', '任务模型', 'settings-page-routing', '保存任务模型'],
              ['prompts', '题材提示词', 'prompt-workshop', '保存本书提示词'],
              ['research', '联网采风', 'settings-page-research', '保存联网采风'],
              ['appearance', '界面偏好', 'settings-page-appearance', ''],
              ['project', '项目数据', 'settings-page-project', ''],
              ['about', '关于岚笺', 'settings-page-about', '']
            ]) {
              document.querySelector('[data-testid="settings-nav-' + id + '"]')?.click()
              await wait(80)
              if (!document.querySelector('.pane-title span')?.textContent?.includes(title)
                || !document.querySelector('[data-testid="' + page + '"]')) return { ok: false, step: 'settings-page-' + id }
              if (id === 'routing') {
                const modelSelect = document.querySelector('[data-testid="shared-model-select"]')
                if (modelSelect?.tagName !== 'BUTTON'
                  || modelSelect.getAttribute('aria-haspopup') !== 'dialog'
                  || !modelSelect.getAttribute('data-model')
                  || !modelSelect.getAttribute('data-connection-id')) return { ok: false, step: 'settings-model-select' }
              }
              if (id === 'about') {
                const about = document.querySelector('[data-testid="settings-page-about"]')
                if (!about?.textContent?.includes('版本 0.0.0')
                  || !about.textContent.includes('SQLite 保存正式数据')
                  || !about.textContent.includes('不保证小说好看、商业成功、零冲突或没有“AI 味”')
                  || !about.textContent.includes('AI 或网络不可用时仍可手写、保存和恢复版本')) return { ok: false, step: 'settings-about-boundary', text: about?.textContent || '' }
              }
              if (saveLabel) {
                const saveAction = Array.from(document.querySelectorAll('.settings-editor button')).find((item) => item.textContent?.includes(saveLabel))
                const saveStyle = saveAction ? getComputedStyle(saveAction) : null
                if (!saveAction?.classList.contains('control-button')
                  || !saveAction.classList.contains('primary')
                  || !saveStyle
                  || saveAction.getBoundingClientRect().height < 40
                  || saveStyle.borderRadius !== '4px'
                  || saveStyle.fontFamily !== getComputedStyle(document.documentElement).fontFamily
                  || saveStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
                  || document.querySelector('.settings-editor .seal-action')) return { ok: false, step: 'settings-action-hierarchy-' + id }
              }
            }
            creationActivities.find((item) => item.getAttribute('data-activity') === 'desk')?.click()
            // The manuscript sidebar is deliberately reserved for chapter navigation.
            // Verify workflow state through the authoritative workspace bridge, then
            // use the dedicated activity rail to reach the current preparation step.
            const workflow = await window.novelDesktop.workspace.getWorkflowStatus()
            const ideaBootstrap = ${JSON.stringify(process.env.LANJIAN_SMOKE_IDEA_PROMOTION_ONLY === '1')}
            const workflowReady = ideaBootstrap
              ? workflow.currentStep === 'materials' && workflow.completed === 3 && workflow.total === 6
              : workflow.currentStep === 'chapterPlan' && workflow.completed === 5 && workflow.total === 6
            if (!workflowReady
              || !workflow.steps.some((step) => step.id === 'chapterPlan' && step.label === '章纲')) return { ok: false, step: 'workflow-status', workflow }
            creationActivities.find((item) => item.getAttribute('data-activity') === 'outline')?.click()
            await wait(100)
            if (!document.querySelector('.pane-title span')?.textContent?.includes('谋篇')) return { ok: false, step: 'workflow-current-step-route' }
            const consistency = document.querySelector('[data-testid="consistency-overview"]')
            const consistencyItems = Array.from(consistency?.querySelectorAll('.consistency-layers button') || [])
            if (consistencyItems.length !== 8
              || !consistency?.textContent?.includes('尚无已采用正文的人物状态')) return { ok: false, step: 'consistency-overview' }
            const consistencyCapturePath = ${JSON.stringify(process.env.LANJIAN_CONSISTENCY_CAPTURE_PATH || '')}
            if (consistencyCapturePath) await wait(80)
            consistencyItems.find((item) => item.textContent?.includes('全书总纲'))?.click()
            await wait(100)
            if (!document.querySelector('.pane-title span')?.textContent?.includes('谋篇')) return { ok: false, step: 'consistency-route' }
            creationActivities.find((item) => item.getAttribute('data-activity') === 'profile')?.click()
            await wait(120)
            if (!document.querySelector('.pane-title span')?.textContent?.includes('作品定义')) return { ok: false, step: 'profile-route' }
            const definition = document.querySelector('[data-testid="book-definition-fields"]')
            const definitionText = document.querySelector('.profile-editor')?.textContent || ''
            const nextStepAction = document.querySelector('[data-testid="profile-next-step"] .control-button')
            const nextStepActionStyle = nextStepAction ? getComputedStyle(nextStepAction) : null
            if (!definition
              || document.querySelector('[data-testid="planning-run"]')
              || document.querySelector('[data-testid="continuation-analysis"]')
              || document.querySelector('.assistant-panel')
              || definitionText.includes('人物种子')
              || definitionText.includes('总纲候选')
              || !document.querySelector('[data-testid="profile-next-step"]')?.textContent?.includes('下一步 · 准备素材')
              || !nextStepActionStyle
              || nextStepAction.getBoundingClientRect().height < 40
              || nextStepActionStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
              || nextStepActionStyle.borderTopWidth === '0px') return { ok: false, step: 'profile-information-architecture', definitionText }
            const rootStyle = getComputedStyle(document.documentElement)
            const requiredTokens = ['--font-sans', '--font-serif', '--ink-strong', '--ink-soft', '--ink-muted', '--line-soft', '--paper', '--seal', '--archive-gold', '--motion-standard']
            const missingTokens = requiredTokens.filter((token) => !rootStyle.getPropertyValue(token).trim())
            if (missingTokens.length) return { ok: false, step: 'typography-design-tokens', missingTokens }
            const controlTypography = [
              document.querySelector('.activitybar .creation-activity span'),
              document.querySelector('.profile-grid input'),
              document.querySelector('.profile-grid select'),
              document.querySelector('.profile-editor .control-button.primary')
            ].filter(Boolean).map((item) => ({ node: item.tagName, font: getComputedStyle(item).fontFamily, lineHeight: getComputedStyle(item).lineHeight }))
            if (controlTypography.length !== 4 || controlTypography.some((item) => !item.font.includes('LanjianSans') || (item.node !== 'SELECT' && item.lineHeight === 'normal'))) return { ok: false, step: 'control-typography-role', controlTypography }
            const profileAction = document.querySelector('.profile-editor .control-button.primary')
            const profileActionStyle = profileAction ? getComputedStyle(profileAction) : null
            const profileInputStyle = getComputedStyle(document.querySelector('.profile-grid input'))
            const profileSelectStyle = getComputedStyle(document.querySelector('.profile-grid select'))
            if (!profileActionStyle
              || profileActionStyle.display !== 'flex'
              || profileActionStyle.alignItems !== 'center'
              || profileActionStyle.justifyContent !== 'center'
              || profileInputStyle.paddingTop !== profileInputStyle.paddingBottom
              || profileSelectStyle.paddingTop !== profileSelectStyle.paddingBottom) return { ok: false, step: 'control-vertical-alignment', actionAlignment: profileActionStyle ? [profileActionStyle.display, profileActionStyle.alignItems, profileActionStyle.justifyContent] : [], inputPadding: [profileInputStyle.paddingTop, profileInputStyle.paddingBottom], selectPadding: [profileSelectStyle.paddingTop, profileSelectStyle.paddingBottom] }
            const profileCapturePath = ${JSON.stringify(process.env.LANJIAN_PROFILE_CAPTURE_PATH || '')}
            if (profileCapturePath) await wait(80)
            const subgenre = document.querySelector('[data-testid="book-subgenre"]')
            if (!subgenre) return { ok: false, step: 'profile-form' }
            subgenre.value = '东方玄幻'
            subgenre.dispatchEvent(new Event('change', { bubbles: true }))
            document.querySelector('.profile-editor > header .control-button.primary')?.click()
            await wait(300)
            const savedProfile = await window.novelDesktop.workspace.getBookProfile()
            if (savedProfile.subgenre !== '东方玄幻') return { ok: false, step: 'profile-save' }
            return { ok: true, step: 'profile-save' }
          })()`)
}
