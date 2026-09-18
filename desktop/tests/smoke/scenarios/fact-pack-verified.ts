import type { BrowserWindow } from 'electron'

export function runFactPackVerifiedScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            await window.novelDesktop.outlines.placeChapter(2, 1)
            await window.novelDesktop.chapterOutlines.update(2, '进入状态：复查临江酒馆与半枚铜符的来历\\n退出状态：确认前文证据后再推进')
            const target = Array.from(document.querySelectorAll('.tree-item')).find((item) => item.textContent?.includes('待删旧章'))
            if (!target) return { ok: false, reason: 'target-chapter-missing' }
            target.click()
            for (let attempt = 0; attempt < 40; attempt += 1) {
              const pack = document.querySelector('[data-testid="context-fact-pack"]')
              if (pack) {
                const summary = pack.querySelector('summary')
                if (!pack.open) summary?.click()
                await wait(120)
                const prior = pack.querySelector('[data-evidence-chapter="1"]')
                const current = pack.querySelector('[data-evidence-chapter="2"]')
                const eventSources = pack.querySelector('[data-context-source="events"]')
                const characterSource = pack.querySelector('[data-character-source-id]')
                const manuscriptSources = pack.querySelector('[data-context-source="manuscript"]')
                const factPack = await window.novelDesktop.workspace.getContextFactPack(2)
                const eventStateMatches = eventSources?.textContent?.includes('正式事件')
                  && eventSources.querySelectorAll('[data-event-source-id]').length === factPack.structured.canonicalEvents.length
                  && summary?.textContent?.includes('事件 ' + factPack.structured.canonicalEvents.length)
                const ok = Boolean(summary?.textContent?.includes('事实与前文')
                  && eventStateMatches
                  && characterSource?.textContent?.includes('沈砚')
                  && characterSource.textContent.includes('截至第 1 章')
                  && manuscriptSources?.textContent?.includes('预算')
                  && prior?.textContent?.includes('临江酒馆')
                  && !current)
                if (ok) {
                  const pinButton = pack.querySelector('[data-evidence-key]')
                  const evidenceKey = pinButton?.getAttribute('data-evidence-key') || ''
                  if (!pinButton || evidenceKey.split(':').length < 4) {
                    return { ok: false, reason: 'evidence-preference-key-missing:' + evidenceKey }
                  }
                  pinButton.click()
                  for (let preferenceAttempt = 0; preferenceAttempt < 20; preferenceAttempt += 1) {
                    await wait(80)
                    const preferences = await window.novelDesktop.workspace.getContextBudgetPreferences()
                    if (preferences.pinnedEvidenceKeys.includes(evidenceKey)) {
                      await window.novelDesktop.workspace.saveContextBudgetPreferences({
                        ...preferences,
                        pinnedEvidenceKeys: [],
                        excludedEvidenceKeys: []
                      })
                      return { ok: true, reason: 'visible-isolated-and-preference-persisted' }
                    }
                  }
                  return { ok: false, reason: 'evidence-preference-not-persisted:' + evidenceKey }
                }
              }
              await wait(100)
            }
            const pack = document.querySelector('[data-testid="context-fact-pack"]')
            return { ok: false, reason: 'evidence-or-budget-missing:' + JSON.stringify({
              summary: pack?.querySelector('summary')?.textContent,
              character: pack?.querySelector('[data-character-source-id]')?.textContent,
              prior: pack?.querySelector('[data-evidence-chapter="1"]')?.textContent,
              current: pack?.querySelector('[data-evidence-chapter="2"]')?.textContent,
              api: await window.novelDesktop.workspace.getContextFactPack(2),
              characterState: await window.novelDesktop.workspace.getCharacterState(),
              factBatches: await window.novelDesktop.workspace.listFactBatches(1).catch((error) => ({ unavailable: error })),
              firstChapter: await window.novelDesktop.chapters.get(1)
            }) }
          })()`)
}
