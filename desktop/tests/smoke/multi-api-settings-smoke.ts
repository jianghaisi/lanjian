import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

type SmokeResult = { ok: boolean; step: string; [key: string]: unknown }

/** Isolated UI proof for two provider connections, credentials and per-task routing. */
export async function runMultiApiSettingsSmoke(
  window: BrowserWindow,
  gptUrl: string,
  geminiUrl: string,
  capturePath?: string
): Promise<SmokeResult> {
  const originalBounds = window.getBounds()
  const wasMaximized = window.isMaximized()
  if (wasMaximized) window.unmaximize()
  window.setSize(1_100, 760)
  window.center()
  await new Promise((resolve) => setTimeout(resolve, 220))
  try {
    const result = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
    const until = async (read, attempts = 100) => {
      for (let index = 0; index < attempts; index += 1) {
        const value = await read()
        if (value) return value
        await wait()
      }
      return null
    }
    const setValue = (element, value) => {
      element.value = value
      element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    }
    const clickByText = (root, selector, text) => {
      const element = Array.from(root.querySelectorAll(selector)).find(item => item.textContent?.includes(text))
      element?.click()
      return element
    }
    const openSettingsSection = async (id) => {
      document.querySelector('[data-activity="settings"]')?.click()
      const nav = await until(() => document.querySelector('[data-testid="settings-nav-' + id + '"]'))
      nav?.click()
      return until(() => document.querySelector('[data-testid="settings-page-' + id + '"]'))
    }
    const fillConnection = (card, values) => {
      const fields = card.querySelectorAll('.ai-connection-fields input')
      if (fields.length !== 3) return false
      setValue(fields[0], values.name)
      setValue(fields[1], values.url)
      setValue(fields[2], values.key)
      return true
    }
    let currentStep = 'open-connections'
    try {
      const connectionPage = await openSettingsSection('connection')
      if (!connectionPage) return { ok: false, step: 'connection-page-missing' }

      currentStep = 'add-and-fill-connections'
      let cards = connectionPage.querySelectorAll('.ai-connection-card')
      if (cards.length !== 1) return { ok: false, step: 'unexpected-initial-connection-count', count: cards.length }
      if (!fillConnection(cards[0], { name: 'GPT 创作接口', url: ${JSON.stringify(gptUrl)}, key: 'smoke-gpt-key' })) {
        return { ok: false, step: 'gpt-fields-missing' }
      }
      document.querySelector('[data-testid="add-ai-connection"]')?.click()
      cards = await until(() => {
        const current = connectionPage.querySelectorAll('.ai-connection-card')
        return current.length === 2 ? current : null
      })
      if (!cards || !fillConnection(cards[1], { name: 'Gemini 正文接口', url: ${JSON.stringify(geminiUrl)}, key: 'smoke-gemini-key' })) {
        return { ok: false, step: 'gemini-fields-missing' }
      }
      const gptId = cards[0].getAttribute('data-connection-id')
      const geminiId = cards[1].getAttribute('data-connection-id')
      if (!gptId || !geminiId || gptId === geminiId) return { ok: false, step: 'connection-identities-invalid', gptId, geminiId }

      currentStep = 'save-connections'
      clickByText(connectionPage, '.connection-command-actions button', '保存全部接口')
      const savedConnections = await until(async () => {
        const settings = await window.novelDesktop.ai.getSettings()
        return settings.connections.length === 2
          && settings.connections.every(item => item.apiKeyConfigured)
          && settings.connections.some(item => item.id === gptId && item.name === 'GPT 创作接口' && item.baseUrl === ${JSON.stringify(gptUrl)})
          && settings.connections.some(item => item.id === geminiId && item.name === 'Gemini 正文接口' && item.baseUrl === ${JSON.stringify(geminiUrl)})
          ? settings : null
      })
      if (!savedConnections) return { ok: false, step: 'connections-not-persisted' }
      if (savedConnections.connections.some(item => Object.prototype.hasOwnProperty.call(item, 'apiKey') || Object.prototype.hasOwnProperty.call(item, 'encryptedApiKey'))) {
        return { ok: false, step: 'credential-echoed-over-bridge' }
      }
      cards = connectionPage.querySelectorAll('.ai-connection-card')
      const passwordInputs = Array.from(connectionPage.querySelectorAll('input[type="password"]'))
      if (cards.length !== 2 || passwordInputs.length !== 2 || passwordInputs.some(input => input.value !== '')) {
        return { ok: false, step: 'credential-visible-after-save', cardCount: cards.length, passwordValues: passwordInputs.map(input => input.value) }
      }
      const connectionRect = connectionPage.getBoundingClientRect()
      const connectionWidth = connectionPage.clientWidth
      const connectionScrollWidth = connectionPage.scrollWidth
      const connectionCardsInsidePage = Array.from(cards).every(card => {
        const rect = card.getBoundingClientRect()
        return rect.left >= connectionRect.left - 1 && rect.right <= connectionRect.right + 1
      })
      const connectionNoHorizontalOverflow = connectionWidth > 0
        && connectionScrollWidth <= connectionWidth + 1
        && connectionCardsInsidePage
      const connectionOverflowDetails = connectionNoHorizontalOverflow ? [] : Array.from(connectionPage.querySelectorAll('*')).map(element => {
          const rect = element.getBoundingClientRect()
          return {
            node: element.tagName,
            className: typeof element.className === 'string' ? element.className : '',
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            right: Math.round(rect.right),
            pageRight: Math.round(connectionRect.right)
          }
        }).filter(item => item.scrollWidth > item.clientWidth + 1 || item.right > item.pageRight + 1).slice(0, 12)

      currentStep = 'auto-load-model-catalog'
      document.querySelector('[data-testid="settings-nav-routing"]')?.click()
      const automaticRoutingPage = await until(() => document.querySelector('[data-testid="settings-page-routing"]'))
      const automaticCatalogLoaded = await until(() => {
        const trigger = automaticRoutingPage?.querySelector('[data-testid="shared-model-select"]')
        if (!trigger || automaticRoutingPage.querySelector('.model-catalog-status')?.textContent?.includes('正在')) return null
        trigger.click()
        const routes = Array.from(document.querySelector('.model-catalog-panel[data-picker="shared-model-select"]')?.querySelectorAll('.model-choice-list > button') || [])
        return routes.some(option => option.dataset.connectionId === gptId && option.dataset.model === 'gpt-4.1-mini')
          && routes.some(option => option.dataset.connectionId === geminiId && option.dataset.model === 'gemini-3.1-pro-preview')
          ? true : null
      })
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      if (!automaticCatalogLoaded) return { ok: false, step: 'model-catalog-not-loaded-after-save' }
      document.querySelector('[data-testid="settings-nav-connection"]')?.click()
      await until(() => document.querySelector('[data-testid="settings-page-connection"]'))
      cards = document.querySelectorAll('.ai-connection-card')

      currentStep = 'probe-gpt-with-own-key'
      cards[0].querySelector('[data-testid^="test-ai-connection-"]')?.click()
      const gptProbe = await until(() => {
        const probe = Array.from(document.querySelectorAll('.model-probe-list > div')).find(item => item.textContent?.includes('GPT 创作接口'))
        return probe?.classList.contains('passed') && probe.textContent?.includes('gpt-4.1-mini') ? probe : null
      })
      if (!gptProbe) return { ok: false, step: 'gpt-own-endpoint-probe-failed', result: document.querySelector('.connection-result')?.textContent || '' }

      currentStep = 'probe-gemini-with-own-key'
      cards[1].querySelector('[data-testid^="test-ai-connection-"]')?.click()
      const geminiProbe = await until(() => {
        const probe = Array.from(document.querySelectorAll('.model-probe-list > div')).find(item => item.textContent?.includes('Gemini 正文接口'))
        return probe?.classList.contains('passed') && probe.textContent?.includes('gemini-3.1-pro-preview') ? probe : null
      })
      if (!geminiProbe) return { ok: false, step: 'gemini-own-endpoint-probe-failed', result: document.querySelector('.connection-result')?.textContent || '' }

      currentStep = 'assign-models'
      document.querySelector('[data-testid="settings-nav-routing"]')?.click()
      const routingPage = await until(() => document.querySelector('[data-testid="settings-page-routing"]'))
      if (!routingPage) return { ok: false, step: 'routing-page-missing' }
      clickByText(routingPage, '.routing-choice button', '分别设置')
      await wait(100)
      const assignments = {
        outline: [gptId, 'gpt-4.1-mini'],
        chapterOutline: [gptId, 'gpt-4.1-mini'],
        prose: [geminiId, 'gemini-3.1-pro-preview'],
        review: [gptId, 'gpt-4.1-mini']
      }
      for (const [task, [connectionId, model]] of Object.entries(assignments)) {
        const picker = document.querySelector('[data-testid="task-model-select-' + task + '"]')
        if (!picker) return { ok: false, step: 'task-model-picker-missing', task }
        picker.click()
        await wait(40)
        const catalog = document.querySelector('.model-catalog-panel[data-picker="task-model-select-' + task + '"]')
        const modelChoice = Array.from(catalog?.querySelectorAll('.model-choice-list > button') || []).find(option => option.dataset.model === model && option.dataset.connectionId === connectionId)
        if (!modelChoice) {
          return { ok: false, step: 'task-model-route-missing', task, model, connectionId, options: Array.from(catalog?.querySelectorAll('.model-choice-list > button') || []).map(option => [option.dataset.connectionId, option.dataset.model]) }
        }
        modelChoice.click()
      }
      clickByText(routingPage, '.settings-actions button', '保存任务模型')
      const savedRouting = await until(async () => {
        const settings = await window.novelDesktop.ai.getSettings()
        return settings.routingMode === 'perTask'
          && settings.tasks.outline.connectionId === gptId && settings.tasks.outline.model === 'gpt-4.1-mini'
          && settings.tasks.chapterOutline.connectionId === gptId && settings.tasks.chapterOutline.model === 'gpt-4.1-mini'
          && settings.tasks.prose.connectionId === geminiId && settings.tasks.prose.model === 'gemini-3.1-pro-preview'
          && settings.tasks.review.connectionId === gptId && settings.tasks.review.model === 'gpt-4.1-mini'
          ? settings : null
      })
      if (!savedRouting) return { ok: false, step: 'routing-not-persisted' }

      currentStep = 'reload-settings-view'
      document.querySelector('[data-testid="settings-nav-connection"]')?.click()
      await until(() => document.querySelectorAll('.ai-connection-card').length === 2)
      const reloadedPasswords = Array.from(document.querySelectorAll('[data-testid="settings-page-connection"] input[type="password"]'))
      if (reloadedPasswords.length !== 2 || reloadedPasswords.some(input => input.value !== '')) {
        return { ok: false, step: 'credential-visible-after-navigation' }
      }
      document.querySelector('[data-testid="settings-nav-routing"]')?.click()
      await until(() => document.querySelector('[data-testid="task-model-select-prose"]'))
      const proseModel = document.querySelector('[data-testid="task-model-select-prose"]')
      const outlineModel = document.querySelector('[data-testid="task-model-select-outline"]')
      const currentRoutingPage = document.querySelector('[data-testid="settings-page-routing"]')
      if (!currentRoutingPage) return { ok: false, step: 'routing-page-lost-after-navigation' }
      const routingRect = currentRoutingPage.getBoundingClientRect()
      const routingNoHorizontalOverflow = currentRoutingPage.clientWidth > 0
        && currentRoutingPage.scrollWidth <= currentRoutingPage.clientWidth + 1
        && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      const explicitSelections = proseModel?.dataset.connectionId === geminiId
        && proseModel?.dataset.model === 'gemini-3.1-pro-preview'
        && proseModel?.textContent?.includes('Gemini 正文接口')
        && outlineModel?.dataset.connectionId === gptId
        && outlineModel?.dataset.model === 'gpt-4.1-mini'
        && outlineModel?.textContent?.includes('GPT 创作接口')
      proseModel?.closest('.task-route-row')?.scrollIntoView({ block: 'center' })
      proseModel?.click()
      await wait(250)
      const openCatalog = document.querySelector('.model-catalog-panel[data-picker="task-model-select-prose"]')
      const catalogFamilies = Array.from(openCatalog?.querySelectorAll('.model-family-tabs button') || []).map(item => item.textContent?.trim() || '')
      const catalogRoutes = Array.from(openCatalog?.querySelectorAll('.model-choice-list > button') || []).map(item => [item.dataset.connectionId, item.dataset.model, item.textContent?.trim() || ''])
      const duplicateGptRoutes = catalogRoutes.filter(([, model, text]) => model === 'gpt-4.1-mini' && text.includes('同名'))
      const categorizedCatalog = catalogFamilies.some(label => label.includes('GPT'))
        && catalogFamilies.some(label => label.includes('Gemini'))
        && catalogRoutes.some(([connectionId, model, text]) => connectionId === gptId && model === 'gpt-4.1-mini' && text.includes('GPT 创作接口'))
        && catalogRoutes.some(([connectionId, model, text]) => connectionId === geminiId && model === 'gemini-3.1-pro-preview' && text.includes('Gemini 正文接口'))
        && duplicateGptRoutes.length === 2
      const allLayoutChecksPassed = connectionNoHorizontalOverflow && routingNoHorizontalOverflow
      return {
        ok: Boolean(explicitSelections && categorizedCatalog && allLayoutChecksPassed),
        step: !explicitSelections
          ? 'multi-api-selection-not-restored'
          : !categorizedCatalog ? 'categorized-model-catalog-incomplete'
            : allLayoutChecksPassed ? 'multi-api-catalog-saved-routed-and-redacted' : 'compact-multi-api-horizontal-overflow',
        connectionCount: savedRouting.connections.length,
        configuredCount: savedRouting.connections.filter(item => item.apiKeyConfigured).length,
        gptId,
        geminiId,
        gptModel: outlineModel?.dataset.model || '',
        geminiModel: proseModel?.dataset.model || '',
        catalogFamilies,
        catalogRouteCount: catalogRoutes.length,
        duplicateGptRouteCount: duplicateGptRoutes.length,
        keysRedacted: reloadedPasswords.every(input => input.value === ''),
        automaticCatalogLoaded: Boolean(automaticCatalogLoaded),
        explicitSelections: Boolean(explicitSelections),
        compactWindowWidth: window.innerWidth,
        connectionWidth,
        connectionScrollWidth,
        connectionCardsInsidePage,
        connectionOverflowDetails,
        connectionNoHorizontalOverflow,
        routingNoHorizontalOverflow,
        routingWidth: routingRect.width,
        routingScrollWidth: currentRoutingPage.scrollWidth
      }
    } catch (error) {
      return { ok: false, step: 'multi-api-settings-exception', currentStep, error: error?.message || JSON.stringify(error) }
    }
  })()`)
    if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
    return result
  } finally {
    window.setBounds(originalBounds)
    if (wasMaximized) window.maximize()
  }
}
