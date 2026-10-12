import assert from 'node:assert/strict'
import { join } from 'node:path'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function checkPetBehaviorChat({ app, pet, output, checks, observations }) {
  async function click(control) {
    await control.waitFor(); await control.scrollIntoViewIfNeeded(); await pause(450)
    const rect = await control.boundingBox(); assert.ok(rect)
    await app.evaluate(({ BrowserWindow }, point) => {
      const contents = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())).webContents
      for (const type of ['mouseDown', 'mouseUp']) contents.sendInputEvent({ type, button: 'left', clickCount: 1, ...point })
    }, { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) })
  }
  async function openChat() {
    await click(pet.getByTestId('pet-window-menu-toggle'))
    await click(pet.getByTestId('pet-open-chat'))
    await pet.getByTestId('pet-chat-input').waitFor()
  }
  async function send(message) {
    const before = await pet.getByTestId('pet-chat-turn').count()
    const input = pet.getByTestId('pet-chat-input')
    await click(input); await input.fill(message); await input.press('Enter')
    await pet.waitForFunction(count => {
      const turns = document.querySelectorAll('[data-testid="pet-chat-turn"]')
      return turns.length === count + 1 && turns[turns.length-1]?.dataset.status === 'complete'
    }, before)
  }
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL()))
    w.show(); w.focus()
  })
  await pet.keyboard.press('Escape'); await pet.keyboard.press('Escape')
  await openChat()
  for (const message of ['你好，今天一起写故事。', '现在几点？', '我们正在写哪部作品？', '再给我一点鼓励。']) await send(message)
  assert.equal(await pet.getByTestId('pet-chat-turn').count(), 4)
  await pet.screenshot({ path: join(output, 'chat-history.png') })
  const transcript = pet.getByTestId('pet-chat-history')
  const layout = await transcript.evaluate(e => ({ client: e.clientHeight, scroll: e.scrollHeight, width: e.clientWidth, contentWidth: e.scrollWidth }))
  assert.ok(layout.client >= 110 && layout.scroll > layout.client, 'history must retain several readable lines above the composer')
  assert.ok(layout.contentWidth <= layout.width + 1)
  await click(pet.getByRole('button', { name: '关闭聊天', exact: true }))
  await openChat()
  assert.equal(await pet.getByTestId('pet-chat-turn').count(), 4, 'closing the panel retains the current-work transcript')
  // Exercise copy's exact payload and acknowledgement without overwriting the
  // author's system clipboard. Native clipboard permission remains a manual check.
  await pet.evaluate(() => {
    window.petCopiedText = ''
    window.petOriginalWriteText = navigator.clipboard.writeText
    window.petOriginalCopy = document.execCommand
    navigator.clipboard.writeText = async text => { window.petCopiedText = text }
  })
  try {
    const message = pet.locator('.assistant-message').last()
    const expected = await message.locator('p').innerText()
    await click(message.getByRole('button', { name: '复制伙伴回复' }))
    assert.equal(await pet.evaluate(() => window.petCopiedText), expected)
    await pet.getByText('已复制', { exact: true }).waitFor()
    await pet.evaluate(() => {
      navigator.clipboard.writeText = async () => { throw new Error('fixture permission denied') }
      document.execCommand = command => { if (command !== 'copy') throw new Error('Unexpected command'); window.petCopiedText = document.activeElement.value; return true }
      window.petCopiedText = ''
    })
    await click(message.getByRole('button', { name: '复制伙伴回复' }))
    assert.equal(await pet.evaluate(() => window.petCopiedText), expected)
    assert.equal(await pet.evaluate(() => document.querySelectorAll('textarea[aria-hidden="true"]').length), 0)
    await pet.evaluate(() => { document.execCommand = () => false })
    await click(message.getByRole('button', { name: '复制伙伴回复' }))
    await pet.getByText('复制未成功，可以选中文字复制', { exact: true }).waitFor()
  } finally {
    await pet.evaluate(() => { navigator.clipboard.writeText = window.petOriginalWriteText; document.execCommand = window.petOriginalCopy; delete window.petCopiedText; delete window.petOriginalWriteText; delete window.petOriginalCopy })
  }
  await transcript.evaluate(e => { e.scrollTop = 0 })
  await pause(150)
  await pet.getByRole('button', { name: '回到最新 ↓' }).waitFor()
  await click(pet.getByRole('button', { name: '回到最新 ↓' }))
  const nearBottom = await transcript.evaluate(e => e.scrollHeight - e.scrollTop - e.clientHeight < 48)
  assert.ok(nearBottom)
  await click(pet.getByTestId('pet-chat-clear'))
  assert.equal(await pet.getByTestId('pet-chat-turn').count(), 0)
  await send('清空后的一句。')
  assert.equal(await pet.getByTestId('pet-chat-turn').count(), 1)
  observations.push({ case: 'chat-history-layout', ...layout })
  checks.push('native multi-turn offline chat, panel reopen, scrolling and clear pass; copy payload/feedback checked with clipboard stub')

  await click(pet.getByRole('button', { name: '关闭聊天', exact: true }))
  await pet.evaluate(() => window.desktopPet.command({ type: 'hide' }))
  await pet.evaluate(() => window.desktopPet.command({ type: 'enable', enabled: true }))
  await openChat()
  assert.equal(await pet.getByTestId('pet-chat-turn').count(), 0, 'explicit pet close clears the transcript')
  await click(pet.getByRole('button', { name: '关闭聊天', exact: true }))
  const before = await pet.evaluate(() => window.companionCare.get())
  await pet.waitForFunction(() => ['greet', 'stretch', 'thinking'].includes(document.querySelector('[data-testid="pet-artwork"]')?.dataset.intent), undefined, { timeout: 48000 })
  const behavior = await pet.getByTestId('pet-artwork').getAttribute('data-intent')
  await pet.screenshot({ path: join(output, 'ambient-behavior.png') })
  const after = await pet.evaluate(() => window.companionCare.get())
  assert.deepEqual(after.inventory, before.inventory); assert.equal(after.coins, before.coins)
  await openChat()
  assert.equal(await pet.getByTestId('pet-artwork').getAttribute('data-intent'), 'idle', 'chat interrupts ambient motion')
  observations.push({ case: 'ambient-behavior', behavior, inventoryUnchanged: true })
  checks.push('explicit pet close clears chat; a real idle deadline triggers a no-cost ambient gesture and chat interrupts it')
  await click(pet.getByRole('button', { name: '关闭聊天', exact: true }))
}
