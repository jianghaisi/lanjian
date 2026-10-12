import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function checkPetAnimation(pet, output) {
  await pet.getByTestId('pet-artwork').filter({ visible: true }).waitFor()
  await pet.waitForFunction(() => document.querySelector('[data-testid="pet-artwork"]')?.dataset.ready === 'true')
  const data = await pet.evaluate(async () => {
    const canvas = document.querySelector('[data-testid="pet-artwork"] canvas')
    const stream = canvas.captureStream(60), chunks = []
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
    recorder.ondataavailable = event => chunks.push(event.data)
    const done = new Promise(resolve => { recorder.onstop = resolve })
    recorder.start()
    const times = [], start = performance.now()
    await new Promise(resolve => {
      let previous = start
      function frame(now) { times.push(now - previous); previous = now; if (now - start < 2600) requestAnimationFrame(frame); else resolve() }
      requestAnimationFrame(frame)
    })
    recorder.stop(); await done; stream.getTracks().forEach(track => track.stop())
    return { bytes: Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())), times }
  })
  assert.ok(data.bytes.length > 1000, 'native canvas recording must contain frames')
  await writeFile(join(output, 'continuous-idle.webm'), Buffer.from(data.bytes))
  const times = data.times.slice(5).sort((a,b)=>a-b)
  return { samples: times.length, medianRafMs: times[Math.floor(times.length/2)], p95RafMs: times[Math.floor(times.length*.95)] }
}

export async function checkPetPanel(pet, kind) {
  await pet.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="pet-artwork"] canvas')?.getBoundingClientRect()
    return canvas && canvas.right <= innerWidth + 1 && canvas.bottom <= innerHeight + 1
  })
  const selector = kind === 'care' ? '.care-panel' : '.pet-chat'
  const result = await pet.locator(selector).evaluate((panel, kind) => {
    const rect = panel.getBoundingClientRect()
    const header = panel.querySelector('header'), close = header.querySelector('button')
    const body = panel.querySelector(kind === 'care' ? '.care-scroll' : '.pet-chat-reply')
    const before = close.getBoundingClientRect().top
    body.scrollTop = body.scrollHeight
    const fontSizes = [...panel.querySelectorAll('p,small,button,textarea,nav,em')].filter(e=>e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize))
    const composer = panel.querySelector('.pet-chat-composer')?.getBoundingClientRect()
    return { headerFixed: before === close.getBoundingClientRect().top, horizontalOverflow: panel.scrollWidth > panel.clientWidth + 1,
      outerScroll: panel.scrollHeight > panel.clientHeight + 1, minimumFont: Math.min(...fontSizes),
      composerInside: !composer || composer.bottom <= rect.bottom && composer.top >= header.getBoundingClientRect().bottom,
      viewport: { width: innerWidth, height: innerHeight }, panel: { width: rect.width, height: rect.height } }
  },kind)
  assert.equal(result.headerFixed, true); assert.equal(result.horizontalOverflow, false)
  assert.equal(result.outerScroll, false); assert.equal(result.composerInside, true)
  assert.ok(result.minimumFont >= 12, 'pet panel text must not be reduced to 9–11px')
  return result
}

export async function checkPetSizes(pet, owner, output) {
  const results = []
  for (const scale of [.6, 1, 1.8]) {
    await owner.evaluate(async scale => {
      const current = await window.desktopPet.get()
      await window.desktopPet.command({ type: 'configure', preferences: { ...current.preferences, scale } })
    },scale)
    await pet.waitForFunction(scale => window.desktopPet.get().then(s=>s.preferences.scale === scale),scale)
    results.push({ scale, ...await checkPetPanel(pet,'chat') })
    await pet.screenshot({ path: join(output, `chat-scale-${scale}.png`) })
  }
  await owner.evaluate(async () => { const s = await window.desktopPet.get(); await window.desktopPet.command({type:'configure',preferences:{...s.preferences,scale:1}}) })
  return results
}
