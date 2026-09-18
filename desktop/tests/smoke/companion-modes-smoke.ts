import type { BrowserWindow } from 'electron'
import { holdCompanion } from './companion-presence-smoke'

/** Real settings and native gestures; synthetic fixture only. No invented model output. */
export async function checkCompanionModes(window: BrowserWindow, capture: (name: string) => Promise<void>, click: (selector: string) => Promise<void>) {
  const evaluate = (source: string) => window.webContents.executeJavaScript(source)
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const settings = '.project-library [data-activity="settings"]'
  const close = '.local-appearance-dialog [aria-label="关闭外观设置"]'
  const input = (name: string) => `[data-testid="companion-${name}-enabled"]`
  const set = async (name: string, checked: boolean) => {
    if (await evaluate(`document.querySelector(${JSON.stringify(input(name))}).checked`) !== checked) await click(input(name))
  }
  await click(settings)
  await set('preload', false)
  const modes = []
  for (const text of [true, false]) for (const speech of [true, false]) {
    await set('text-model', text); await set('sound', speech)
    const saved = await evaluate(`JSON.parse(localStorage.getItem('lanjian-companion-voice-v1'))`)
    if (saved.textModel !== text || saved.mute === speech || saved.preload !== false) throw Error('companion-mode-not-saved')
    modes.push({ text, speech, label: await evaluate(`document.querySelector('[data-testid="companion-mode-summary"] strong').textContent`) })
  }
  await set('proactive', false) // A deliberate tap must work even with passive reminders off.
  await capture('companion-optional-model-settings')
  await click(close)
  await holdCompanion(window, 250)
  for (let i = 0; i < 50 && !await evaluate(`!!document.querySelector('[data-testid="companion-notice"] p')`); i++) await wait(100)
  const tap = await evaluate(`({text:document.querySelector('[data-testid="companion-notice"] p')?.textContent,chat:!!document.querySelector('[data-testid="companion-chat-composer"]')})`)
  if (!tap.text || tap.chat || window.webContents.isCurrentlyAudible()) throw Error('companion-preset-tap-failed:' + JSON.stringify(tap))
  await capture('companion-preset-tap')
  await click('[aria-label="略过这条提醒"]')
  await holdCompanion(window)
  await wait(250)
  await click('#companion-message')
  window.webContents.insertText('现在几点？')
  await click('.voice-send')
  for (let i = 0; i < 50 && !await evaluate(`document.querySelector('[data-testid="companion-reply"]')?.textContent.includes('星期')`); i++) await wait(100)
  const reply = await evaluate(`document.querySelector('[data-testid="companion-reply"]')?.textContent`)
  if (!reply?.includes('星期') || window.webContents.isCurrentlyAudible()) throw Error('companion-preset-time-failed')
  await capture('companion-preset-text-only')
  await click('[aria-label="关闭人物对话"]')
  await click(settings); await set('proactive', true); await click(close)
  return { kind: 'companion-optional-models', modes, tap, reply, presetsWithoutAudio: true, tapIndependentOfProactive: true }
}
