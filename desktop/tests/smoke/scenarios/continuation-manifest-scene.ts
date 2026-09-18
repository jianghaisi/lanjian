import type { BrowserWindow } from 'electron'

export function runContinuationManifestSceneScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
            try {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const setValue = (element, value) => {
                element.value = value
                element.dispatchEvent(new Event('input', { bubbles: true }))
                element.dispatchEvent(new Event('change', { bubbles: true }))
              }
              for (let index = 0; index < 60 && !document.querySelector('.library-home'); index += 1) await wait(100)
              const entry = document.querySelector('[data-testid="create-from-txt"]')
              if (!entry) return { ok: false, step: 'continuation-library-entry', library: Boolean(document.querySelector('.library-home')), body: document.body.textContent?.slice(0, 400) || '' }
              entry.click()
              for (let index = 0; index < 50 && !document.querySelector('[data-testid="continuation-file-queue-empty"]'); index += 1) await wait(100)
              const addInitial = document.querySelector('[data-testid="add-continuation-documents"]')
              if (!addInitial) return { ok: false, step: 'continuation-empty-queue', modal: Boolean(document.querySelector('.txt-import-modal')), body: document.body.textContent?.slice(0, 400) || '' }
              addInitial.click()
              for (let index = 0; index < 50 && document.querySelectorAll('.manifest-file').length !== 2; index += 1) await wait(100)
              const initialFiles = Array.from(document.querySelectorAll('.manifest-file'))
              const initialRoles = Array.from(document.querySelectorAll('.manifest-file select'))
              if (initialFiles.length !== 2 || initialRoles.length !== 2) return { ok: false, step: 'initial-file-batch', count: initialFiles.length, roleCount: initialRoles.length }
              setValue(initialRoles[0], 'manuscript')
              setValue(initialRoles[1], 'material')
              const title = document.querySelector('.import-fields input')
              setValue(title, '多文件接续烟测')
              document.querySelector('.import-path button')?.click()
              for (let index = 0; index < 30 && !document.querySelector('.import-path input')?.value; index += 1) await wait(50)
              document.querySelector('[data-testid="add-continuation-documents"]')?.click()
              for (let index = 0; index < 50 && document.querySelectorAll('.manifest-file').length !== 3; index += 1) await wait(100)
              const files = Array.from(document.querySelectorAll('.manifest-file'))
              const roles = Array.from(document.querySelectorAll('.manifest-file select'))
              if (files.length !== 3 || roles.length !== 3) return { ok: false, step: 'append-file-batch', count: files.length, roleCount: roles.length }
              setValue(roles[2], 'material')
              await wait(80)
              const submit = document.querySelector('.import-footer .seal-action')
              if (!submit || submit.disabled) return { ok: false, step: 'manifest-not-ready', title: title?.value, path: document.querySelector('.import-path input')?.value, roles: roles.map((item) => item.value) }
              submit.click()
              for (let index = 0; index < 100 && !document.querySelector('[data-testid="continuation-analysis"]') && !document.querySelector('[data-testid="continuation-analysis-ready"]'); index += 1) await wait(100)
              let generatedCandidate = null
              const analysisReady = Boolean(document.querySelector('[data-testid="continuation-analysis-ready"]'))
              if (analysisReady) {
                const settings = await window.novelDesktop.ai.getSettings()
                await window.novelDesktop.ai.updateSettings({
                  baseUrl: ${JSON.stringify(process.env.LANJIAN_SMOKE_MODEL_URL || '')},
                  apiKey: 'continuation-smoke-key',
                  routingMode: 'shared',
                  shared: { ...settings.shared, model: 'gemini-smoke-model' }
                })
                const continuationState = await window.novelDesktop.imports.continuationAnalysis()
                if (!continuationState.availableManifestId) return { ok: false, step: 'continuation-analysis-manifest-missing', continuationState }
                generatedCandidate = await window.novelDesktop.imports.generateContinuationAnalysis(continuationState.availableManifestId)
              }
              for (let index = 0; index < 100 && !document.querySelector('[data-testid="continuation-analysis"]'); index += 1) await wait(100)
              const chapters = await window.novelDesktop.chapters.list()
              const analysis = document.querySelector('[data-testid="continuation-analysis"]')
              return {
                ok: Boolean(!document.querySelector('.txt-import-modal')
                  && chapters.length > 0
                  && ((analysis && analysis.textContent?.includes('已有剧情'))
                    || (analysisReady && generatedCandidate?.sections?.some((section) => section.area === 'existingPlot' && section.status === 'found')))),
                step: 'multi-file-continuation',
                fileNames: files.map((file) => file.querySelector('b')?.textContent),
                roles: roles.map((item) => item.value),
                chapterCount: chapters.length,
                analysis: analysis?.textContent?.slice(0, 120) || '',
                generatedExistingPlot: generatedCandidate?.sections?.find((section) => section.area === 'existingPlot')?.content || ''
              }
            } catch (error) {
              return { ok: false, step: 'multi-file-continuation-exception', error: error instanceof Error ? error.message : JSON.stringify(error) }
            }
          })()`)
}
