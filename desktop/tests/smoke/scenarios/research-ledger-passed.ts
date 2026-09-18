import type { BrowserWindow } from 'electron'

export function runResearchLedgerPassedScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            let unified = null
            let tabs = []
            for (let index = 0; index < 20; index += 1) {
              unified = document.querySelector('.source-editor')
              tabs = ['material-tab-notes', 'material-tab-manual', 'material-tab-research', 'material-tab-events'].map((id) => document.querySelector('[data-testid="' + id + '"]'))
              if (unified && tabs.every(Boolean)) break
              await wait(100)
            }
            if (!unified || tabs.some((item) => !item)) return {
              ok: false,
              step: 'split-material-view',
              active: document.querySelector('.creation-activity.selected')?.getAttribute('data-activity'),
              pane: document.querySelector('.pane-title span')?.textContent || '',
              source: unified?.textContent?.slice(0, 120) || '',
              tabs: tabs.map((item) => Boolean(item))
            }
            const duplicateTabs = ['material-tab-notes', 'material-tab-manual', 'material-tab-research', 'material-tab-events'].map((id) => document.querySelectorAll('[data-testid="' + id + '"]').length)
            if (duplicateTabs.some((count) => count !== 1)) return { ok: false, step: 'duplicate-material-navigation', duplicateTabs }

            tabs[2].click()
            await wait(120)
            const preloadedWeb = Array.from(document.querySelectorAll('.material-source-list button')).find((item) => item.textContent?.includes('联网采风：旧式录音棚'))
            if (!preloadedWeb) return { ok: false, step: 'web-catalog' }
            preloadedWeb.click()
            await wait(80)
            const webDetail = document.querySelector('.web-source-detail')
            const webExcerpt = webDetail?.querySelector('textarea[readonly]')
            const webNotes = webDetail?.querySelectorAll('textarea')?.[1]
            if (!webDetail || !webExcerpt || !webNotes || !webDetail.textContent?.includes('原始摘录与来源只读')) return { ok: false, step: 'web-provenance-readonly' }
            const originalWebExcerpt = webExcerpt.value
            webNotes.value = '烟测修改：只采用舞台压力，不改来源证据。'
            webNotes.dispatchEvent(new Event('input', { bubbles: true }))
            Array.from(webDetail.querySelectorAll('button')).find((item) => item.textContent?.includes('保存作者整理'))?.click()
            await wait(320)
            if (webExcerpt.value !== originalWebExcerpt) return { ok: false, step: 'web-evidence-mutated' }

            tabs[1].click()
            await wait(80)
            document.querySelector('[data-testid="new-manual-source"]')?.click()
            await wait(60)
            const capture = document.querySelector('[data-testid="source-detail-editor"]')
            const sourceInputs = capture?.querySelectorAll('input')
            const sourceTextareas = capture?.querySelectorAll('textarea')
            if (!capture || !sourceInputs || sourceInputs.length < 3 || !sourceTextareas || sourceTextareas.length < 2) return { ok: false, step: 'source-form' }
            sourceInputs[0].value = '烟测人物资料'
            sourceInputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            sourceTextareas[0].value = '一位落魄歌手在平行世界遇见成名后的自己。'
            sourceTextareas[0].dispatchEvent(new Event('input', { bubbles: true }))
            sourceTextareas[1].value = '用于验证资料不会自动成为作品事实。'
            sourceTextareas[1].dispatchEvent(new Event('input', { bubbles: true }))
            await wait(80)
            Array.from(capture.querySelectorAll('button')).find((item) => item.textContent?.includes('建立资料卡'))?.click()
            await wait(450)
            const source = Array.from(document.querySelectorAll('.material-source-list button')).find((item) => item.textContent?.includes('烟测人物资料'))
            const detail = document.querySelector('[data-testid="source-detail-editor"]')
            if (!source || !detail?.textContent?.includes('修改自备资料')) return { ok: false, step: 'source-save' }
            const editableNotes = detail.querySelectorAll('textarea')[1]
            editableNotes.value = '烟测修改已保存；资料仍不是作品事实。'
            editableNotes.dispatchEvent(new Event('input', { bubbles: true }))
            Array.from(detail.querySelectorAll('button')).find((item) => item.textContent?.includes('保存修改'))?.click()
            await wait(320)
            Array.from(detail.querySelectorAll('button')).find((item) => item.textContent?.includes('提炼为事件候选'))?.click()
            await wait(120)
            const candidate = document.querySelector('.event-candidate-form')
            const eventInputs = candidate?.querySelectorAll('.event-fields input')
            const eventTextareas = candidate?.querySelectorAll('.event-fields textarea')
            if (!candidate || !eventInputs || eventInputs.length < 3 || !eventTextareas || eventTextareas.length < 2) return { ok: false, step: 'event-form' }
            ;['成名前夜', '落魄歌手、平行世界的自己', '旧录音棚'].forEach((value, index) => {
              eventInputs[index].value = value
              eventInputs[index].dispatchEvent(new Event('input', { bubbles: true }))
            })
            eventTextareas[0].value = '两人在停电时透过旧录音设备短暂对话。'
            eventTextareas[0].dispatchEvent(new Event('input', { bubbles: true }))
            eventTextareas[1].value = '落魄歌手决定重新登台。'
            eventTextareas[1].dispatchEvent(new Event('input', { bubbles: true }))
            await wait(80)
            Array.from(candidate.querySelectorAll('button')).find((item) => item.textContent?.includes('保存为候选事件'))?.click()
            await wait(450)
            const event = Array.from(document.querySelectorAll('.candidate-events article')).find((item) => item.textContent?.includes('旧录音设备'))
            const approve = event?.querySelector('button')
            if (!event || !approve) return { ok: false, step: 'event-candidate' }
            approve.click()
            await wait(450)
            const approved = Array.from(document.querySelectorAll('.candidate-events article.approved')).some((item) => item.textContent?.includes('已确认'))
            if (!approved) return { ok: false, step: 'event-approval' }
            document.querySelector('[data-testid="material-tab-manual"]')?.click()
            await wait(80)
            const reopened = Array.from(document.querySelectorAll('.material-source-list button')).find((item) => item.textContent?.includes('烟测人物资料'))
            reopened?.click()
            await wait(80)
            const persistedEdit = document.querySelector('[data-testid="source-detail-editor"]')?.textContent?.includes('修改自备资料')
              && document.querySelector('[data-testid="source-detail-editor"]')?.querySelectorAll('textarea')?.[1]?.value === '烟测修改已保存；资料仍不是作品事实。'
            return { ok: Boolean(persistedEdit), step: persistedEdit ? 'edited-and-reopened' : 'source-edit-persistence' }
          })()`)
}
