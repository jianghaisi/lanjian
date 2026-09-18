import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

/** Isolated UI driver for the V2 20–30 chapter experience ledger. */
export async function runRealTrialSmoke(window: BrowserWindow, capturePath?: string): Promise<unknown> {
  const setup = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    const until = async (predicate, timeout = 15000) => { const end = Date.now() + timeout; do { if (await predicate()) return true; await wait(100) } while (Date.now() < end); return false }
    const visible = element => Boolean(element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
    let opened = false
    if (!await until(() => {
      if (visible(document.querySelector('.workbench')) && visible(document.querySelector('[data-activity="settings"]'))) return true
      const book = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
      if (book && !opened) { opened = true; book.click() }
      return false
    })) return { ok: false, step: 'project-open' }

    let storage = await window.novelDesktop.projects.sqliteStorageStatus()
    if (!storage.databaseExists) {
      const shadow = await window.novelDesktop.projects.previewSqliteShadowMigration()
      if (!shadow.canImport || !shadow.token) return { ok: false, step: 'shadow-preview', shadow }
      await window.novelDesktop.projects.importSqliteShadowMigration(shadow.token)
      storage = await window.novelDesktop.projects.sqliteStorageStatus()
    }
    if (storage.storageMode !== 'sqlite') {
      const activation = await window.novelDesktop.projects.previewSqliteActivation()
      if (!activation.canActivate || !activation.token) return { ok: false, step: 'activation-preview', activation }
      await window.novelDesktop.projects.activateSqliteStorage(activation.token)
    }

    return { ok: true, step: 'sqlite-active' }
  })()`)
  if (!setup.ok) return setup
  await new Promise<void>((resolve, reject) => {
    const loaded = () => { clearTimeout(timeout); resolve() }
    const timeout = setTimeout(() => { window.webContents.removeListener('did-finish-load', loaded); reject(new Error('Real trial reload timed out')) }, 15_000)
    window.webContents.once('did-finish-load', loaded)
    window.webContents.reload()
  })
  const result = await window.webContents.executeJavaScript(`(async () => {
    try {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    const until = async (predicate, timeout = 15000) => { const end = Date.now() + timeout; do { if (await predicate()) return true; await wait(100) } while (Date.now() < end); return false }
    const visible = element => Boolean(element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
    let opened = false
    if (!await until(() => {
      if (visible(document.querySelector('.workbench')) && visible(document.querySelector('[data-activity="settings"]'))) return true
      const book = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
      if (book && !opened) { opened = true; book.click() }
      return false
    })) return { ok: false, step: 'project-reopen' }
    Array.from(document.querySelectorAll('[data-activity="settings"]')).find(visible)?.click()
    if (!await until(() => document.querySelector('[data-testid="settings-category-data"]'))) return { ok: false, step: 'settings-open' }
    document.querySelector('[data-testid="settings-category-data"]')?.click()
    if (!await until(() => document.querySelector('[data-testid="settings-nav-trial"]'))) return { ok: false, step: 'data-category' }
    document.querySelector('[data-testid="settings-nav-trial"]')?.click()
    if (!await until(() => {
      const save = document.querySelector('[data-testid="save-real-trial-chapter"]')
      return save && !save.disabled
    })) return { ok: false, step: 'trial-open', text: document.querySelector('main')?.textContent || '' }

    const section = document.querySelector('[data-testid="settings-page-real-trial"]')
    const writing = document.querySelector('[data-testid="real-trial-writing-minutes"]')
    const details = document.querySelector('[data-testid="real-trial-details"]')
    const satisfaction = document.querySelector('[data-testid="real-trial-satisfaction"]')
    const continueChoice = document.querySelector('[data-testid="real-trial-continue"]')
    const save = document.querySelector('[data-testid="save-real-trial-chapter"]')
    const quickState = { detailsClosed: Boolean(details && !details.open), satisfactionVisible: visible(satisfaction), continueVisible: visible(continueChoice), saveVisible: visible(save) }
    const quickRecord = Object.values(quickState).every(Boolean)
    const omittedTimeIsNotZero = Boolean(section?.textContent.includes('尚未记录') && section?.textContent.includes('未填写不会按 0 分钟计算'))
    const unknownAutosaveIsNotFailure = Boolean(section?.textContent.includes('本轮尚无自动保存记录') && section?.textContent.includes('不据此判断可靠或失败'))
    if (!section || !writing || !details || !save || !quickRecord || !omittedTimeIsNotZero || !unknownAutosaveIsNotFailure || !section.textContent.includes('已经完成的作者决定') || !section.textContent.includes('有意安排') || document.querySelector('[data-testid="real-trial-accepted-blocks"]') || section.querySelector('[aria-label="有用提示"]') || section.querySelector('[aria-label="误报提示"]')) {
      return { ok: false, step: 'automatic-diff-guidance', quickState, text: section?.textContent || '' }
    }
    details.open = true
    writing.value = '36'
    writing.dispatchEvent(new Event('input', { bubbles: true }))
    details.open = false
    save.click()
    if (!await until(async () => (await window.novelDesktop.projects.realTrialReport()).summary.chapterCount === 1)) return { ok: false, step: 'trial-save' }
    const report = await window.novelDesktop.projects.realTrialReport()
    const summaryVisible = await until(() => section.textContent.includes('1/20 章') && section.textContent.includes('再记录 19 章后开放') && section.textContent.includes('无需额外审阅决定') && section.textContent.includes('已填 1/1 章') && !section.textContent.includes('尚未记录'))
    const noManualDiff = report.chapters[0]?.diffAcceptedBlocks === report.chapters[0]?.automatic.diffAcceptedBlocks
      && report.chapters[0]?.diffRejectedBlocks === report.chapters[0]?.automatic.diffRejectedBlocks
    const noManualFindings = report.chapters[0]?.falsePositiveFindings === report.chapters[0]?.automatic.falsePositiveFindings
      && report.chapters[0]?.usefulFindings === report.chapters[0]?.automatic.usefulFindings
    const reviewBurdenRecorded = report.summary.reviewDecisions === 0 && report.summary.averageReviewDecisions === 0
    return { ok: quickRecord && omittedTimeIsNotZero && unknownAutosaveIsNotFailure && summaryVisible && noManualDiff && noManualFindings && reviewBurdenRecorded && report.summary.totalHumanMinutes === 36 && report.summary.averageHumanMinutes === 36 && report.summary.humanTimeRecordedChapters === 1 && report.summary.humanTimeCoverage === 1 && report.summary.autosaveCheckpoints === 0 && report.summary.autosaveConflictFreeRate === null, step: 'automatic-trial-ledger', quickRecord, omittedTimeIsNotZero, unknownAutosaveIsNotFailure, summaryVisible, noManualDiff, noManualFindings, reviewBurdenRecorded, summary: report.summary }
    } catch (error) {
      return { ok: false, step: 'trial-script-exception', error: error?.stack || error?.message || String(error) }
    }
  })()`)
  if (capturePath) {
    await window.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
      const end = Date.now() + 10000
      while (Date.now() < end) {
        const loading = document.querySelector('[data-testid="workspace-loading"]')
        const trial = document.querySelector('[data-testid="settings-page-real-trial"]')
        if (!loading && trial && trial.getBoundingClientRect().width > 0) return true
        await wait(100)
      }
      return false
    })()`)
    await writeFile(capturePath, (await window.capturePage()).toPNG())
  }
  return result
}
