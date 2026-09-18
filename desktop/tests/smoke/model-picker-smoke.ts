import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Uses only the isolated question fixture. Leaves a manual route selected for a real UI send. */
export async function runModelPickerSmoke(window: BrowserWindow): Promise<void> {
  const compact = process.env.LANJIAN_SMOKE_MODEL_PICKER_COMPACT === '1'
  if (compact) {
    window.setSize(1100, 800)
    window.webContents.setZoomFactor(1.25)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const js = (source: string) => window.webContents.executeJavaScript(source)
  const capture = async (name: string) => {
    await new Promise(resolve => setTimeout(resolve, 250))
    await writeFile(resolve('artifacts/ui', compact ? name.replace('.png', '-compact.png') : name), (await window.capturePage()).toPNG())
  }
  await js(`(async () => {
    const until = window.__questionUntil, click = window.__questionClick
    window.__modelPickerSettings = JSON.stringify(await window.novelDesktop.ai.getSettings())
    await click('[data-activity="settings"]')
    await click('[data-testid="settings-category-ai"]')
    await click('[data-testid="settings-nav-routing"]')
    await until(() => document.querySelector('.model-catalog-status.ready') && !document.querySelector('.model-catalog-status.loading'))
    await click('[data-activity="desk"]')
    await until(() => document.querySelector('[aria-controls="assistant-drawer"]')?.checkVisibility())
    if (document.querySelector('[aria-controls="assistant-drawer"]').getAttribute('aria-expanded') !== 'true') await click('[aria-controls="assistant-drawer"]')
    await click('[data-testid="writing-agent-model"]')
    await until(() => document.querySelector('.model-family-tabs [data-family="other"]'))
    await until(() => getComputedStyle(document.querySelector('.model-catalog-panel')).opacity === '1')
    const panel = document.querySelector('.model-catalog-panel'), tabs = panel.querySelector('.model-family-tabs')
    const buttons = Array.from(tabs.querySelectorAll('button'))
    const bounds = panel.getBoundingClientRect()
    const visible = element => {
      const r = element.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.left >= bounds.left && r.right <= bounds.right + 1 && r.top >= bounds.top && r.bottom <= bounds.bottom + 1
        && element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
    }
    if (buttons.length !== 10 || !buttons.every(visible) || tabs.scrollWidth > tabs.clientWidth + 1
      || bounds.left < 0 || bounds.right > innerWidth + 1 || bounds.top < 0 || bounds.bottom > innerHeight + 1) throw new Error('model families or picker clipped')
    panel.querySelector('[data-family="gpt"]').click()
    const search = panel.querySelector('input[type="search"]')
    search.value = 'deepseek-smoke'; search.dispatchEvent(new Event('input', { bubbles: true }))
    await until(() => panel.querySelector('[data-model="deepseek-smoke"]'))
    search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true }))
    await until(() => panel.querySelectorAll('.model-choice-list > button').length >= 18)
  })()`)
  await capture('model-picker-all-families.png')
  await js(`(async () => {
    const until = window.__questionUntil, click = window.__questionClick
    document.querySelector('.model-family-tabs [data-family="other"]').click()
    await until(() => document.querySelectorAll('.model-choice-list > button').length === 2)
    const choices = Array.from(document.querySelectorAll('.model-choice-list > button'))
    if (!choices.every(e => e.dataset.model === 'local-writing-model' && e.textContent.includes('同名'))
      || !choices.some(e => e.textContent.includes('目录接口甲')) || !choices.some(e => e.textContent.includes('写作接口乙'))) throw new Error('unknown duplicate routes lost their API labels')
    choices.find(e => e.dataset.connectionId === 'manual').click()
    await until(() => document.querySelector('[data-testid="writing-agent-model"]').dataset.connectionId === 'manual')
    await click('[data-testid="writing-agent-model"]')
    await click('.model-follow-choice')
    await until(() => document.querySelector('[data-testid="writing-agent-model"]').dataset.model === '')
    await click('[data-testid="writing-agent-model"]')
    await click('.model-manual-entry > button')
    await until(() => document.querySelector('[aria-label="手动模型 ID"]'))
    const model = document.querySelector('[aria-label="手动模型 ID"]')
    model.value = 'private-novel-2026'; model.dispatchEvent(new Event('input', { bubbles: true }))
    const api = document.querySelector('[aria-label="手动模型所属接口"]')
    api.value = 'manual'; api.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await capture('model-picker-manual-entry.png')
  await js(`(async () => {
    const until = window.__questionUntil, click = window.__questionClick
    const panel = document.querySelector('.model-catalog-panel'), r = panel.getBoundingClientRect()
    const controls = Array.from(panel.querySelectorAll('input, select, button'))
    if (!controls.every(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.left >= r.left && b.right <= r.right + 1 && b.top >= r.top && b.bottom <= r.bottom + 1 && e.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)) })) throw new Error('manual model fields clipped')
    await click('.model-manual-entry > div > button')
    await until(() => {
      const trigger = document.querySelector('[data-testid="writing-agent-model"]')
      return trigger.dataset.model === 'private-novel-2026' && trigger.dataset.connectionId === 'manual' && trigger.textContent.includes('写作接口乙')
    })
    await click('[data-testid="writing-agent-model"]')
    await until(() => document.querySelector('.model-choice-list [data-model="private-novel-2026"][data-connection-id="manual"]'))
    document.querySelector('.model-catalog-search input').focus()
  })()`)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await js(`window.__questionUntil(() => !document.querySelector('.model-catalog-panel') && document.activeElement === document.querySelector('[data-testid="writing-agent-model"]'))`)
}
