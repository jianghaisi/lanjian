import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function checkPetFrames({ app, page, output, checks, observations }) {
  // Electron page zoom changes CDP screenshot clip coordinates. Restore 1:1
  // before comparing artwork pixels; the separate layout matrix covers zoom.
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(w => !/pet\.html/.test(w.webContents.getURL()))
    main.webContents.setZoomFactor(1); main.setSize(1280,980)
  })
  const preview = page.getByTestId('pet-action-preview'), art = preview.getByTestId('pet-artwork')
  await art.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => window.companionCare.get())
  const intents = ['idle','blink','greet','pat','handshake','drag','land','thinking','speaking','listening','writing','success','warning','stretch','playing','eating','drinking','sleeping']
  const fullGestures = ['handshake', 'pat', 'eating', 'drinking', 'greet', 'success', 'warning', 'stretch', 'playing']
  for (const intent of intents) {
    const count = intent === 'idle' || fullGestures.includes(intent) ? 16 : 8
    const duration = intent === 'idle' ? 7400 : fullGestures.includes(intent) ? 10500 : 4000
    // Arm observation before the real button click so short blink/landing frames
    // are not skipped while a screenshot is transferred to the test process.
    await art.evaluate((element, { intent, duration }) => {
      element.__petSequenceCapture = (async () => {
        const frames = [], frameCounts = [], intervals = [], timeline = [], chunks = []
        let last = performance.now(), start, previous = ''
        const canvas = element.querySelector('canvas'), armed = last, stream = canvas.captureStream(30)
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
        recorder.ondataavailable = event => chunks.push(event.data); recorder.start()
        try {
          while (performance.now() - (start ?? armed) < (start === undefined ? 15000 : duration)) {
            const now = await new Promise(resolve => requestAnimationFrame(resolve))
            const { clip, frame, transition, motion } = element.dataset
            if (start === undefined && clip === intent) start = now
            if (start === undefined) continue
            intervals.push(now-last); last=now
            if (clip === intent) {
              frames.push(frame); frameCounts.push(element.dataset.frameCount)
            }
            const key = `${clip}:${frame}:${transition}:${motion}:${document.hidden}`
            if (key !== previous) { timeline.push({ time: now - start, clip, frame, transition, motion, documentHidden: document.hidden }); previous = key }
          }
        } finally {
          await new Promise(resolve => { recorder.onstop = resolve; recorder.stop() })
          stream.getTracks().forEach(track => track.stop())
        }
        const blob = new Blob(chunks, { type: 'video/webm' }), videoOffsetMs = start - armed
        let firstPixels, laterPixels, snapshotError
        const visiblePixels = []
        const video = document.createElement('video'), url = URL.createObjectURL(blob)
        function event(name, action) {
          return new Promise((resolve, reject) => {
            const done = () => { cleanup(); resolve() }, failed = () => { cleanup(); reject(new Error('PET_VIDEO_DECODE_FAILED')) }
            const timer = setTimeout(failed, 10000)
            function cleanup() { clearTimeout(timer); video.removeEventListener(name, done); video.removeEventListener('error', failed) }
            video.addEventListener(name, done, { once: true }); video.addEventListener('error', failed, { once: true }); action()
          })
        }
        try {
          // Decode only after recording. Reading live WebGL pixels stalls some
          // drivers and can return a discarded, transparent back buffer.
          video.muted = true; video.preload = 'auto'
          await event('loadeddata', () => { video.src = url })
          const copy = document.createElement('canvas'); copy.width = video.videoWidth; copy.height = video.videoHeight
          const context = copy.getContext('2d', { willReadFrequently: true })
          const moments = [timeline.find(row => row.clip === intent && row.transition === 'false' && row.frame === '0'),
            timeline.find(row => row.clip === intent && row.transition === 'false' && Number(row.frame) >= Number(frameCounts[0]) / 2)]
          const images = []
          for (const moment of moments) {
            if (!moment) throw new Error('PET_VIDEO_POSE_MISSING')
            await event('seeked', () => { video.currentTime = (videoOffsetMs + moment.time + 25) / 1000 })
            context.clearRect(0, 0, copy.width, copy.height); context.drawImage(video, 0, 0)
            const pixels = context.getImageData(0, 0, copy.width, copy.height).data
            let visible = 0
            for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] >= 16 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 80) visible++
            visiblePixels.push(visible); images.push(copy.toDataURL('image/png').split(',')[1])
          }
          ;[firstPixels, laterPixels] = images
        } catch (error) { snapshotError = String(error) }
        finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url) }
        return { videoOffsetMs, frames: [...new Set(frames)], frameCounts: [...new Set(frameCounts)], firstPixels, laterPixels,
          visiblePixels, snapshotError, intervals, timeline, error: element.dataset.assetError,
          video: Array.from(new Uint8Array(await blob.arrayBuffer())) }

      })()
    }, { intent, duration })
    await page.getByTestId(`pet-preview-${intent}`).click()
    await page.waitForFunction(intent => document.querySelector('[data-testid="pet-action-preview"] [data-testid="pet-artwork"]')?.dataset.clip === intent, intent)
    const sample = await art.evaluate(async element => {
      try { return await element.__petSequenceCapture }
      finally { delete element.__petSequenceCapture }
    })
    if (sample.video) { await writeFile(join(output, `${intent}-native.webm`), Buffer.from(sample.video)); delete sample.video }
    const { firstPixels, laterPixels } = sample
    delete sample.firstPixels; delete sample.laterPixels
    // Keep the failing action's timeline too, before any assertion can throw.
    observations.push({ case:'sequence', intent, ...sample })
    assert.deepEqual(sample.frameCounts, [String(count)], `${intent} reported the wrong authored frame count`)
    assert.equal(sample.snapshotError, undefined, `${intent} recording must decode`)
    assert.ok(sample.visiblePixels.length === 2 && sample.visiblePixels.every(count => count > 1000), `${intent} recorded poses must contain the visible character`)
    assert.ok(firstPixels && laterPixels, `${intent} must capture two actual rendered poses`)
    const first = Buffer.from(firstPixels, 'base64'), last = Buffer.from(laterPixels, 'base64')
    await writeFile(join(output, `frames-${intent}-start.png`), first)
    await writeFile(join(output, `frames-${intent}-later.png`), last)
    assert.equal(sample.error, 'false', `${intent} asset failed`)
    assert.ok(sample.frames.length >= 2, `${intent} did not advance drawn frames`)
    if (intent === 'blink') assert.ok(['0', '3', '6'].every(frame => sample.frames.includes(frame)), 'short blink must close and reopen')
    else assert.equal(sample.frames.length, count, `${intent} must render every authored pose across its complete duration`)
    // All long gestures, including one-page 4x4 sheets, must reach the final
    // drawing, hold it, then resume idle without an overdue automatic blink.
    if (fullGestures.includes(intent)) {
      assert.ok(['7', '8', '15'].every(frame => sample.frames.includes(frame)), `${intent} must traverse its middle poses and visibly reach the resting final frame`)
      const terminal = sample.timeline.find(entry => entry.clip === intent && entry.frame === '15' && entry.transition === 'false')
      const returned = sample.timeline.find(entry => entry.clip === 'idle')
      const settled = sample.timeline.find(entry => entry.clip === 'idle' && entry.transition === 'false')
      const blink = sample.timeline.find(entry => entry.clip === 'blink')
      assert.ok(terminal && returned && returned.time - terminal.time >= 90, `${intent} terminal drawing must remain visible before returning`)
      assert.ok(settled && blink && blink.time - settled.time >= 3900, `${intent} must get a full quiet idle interval before automatic blink`)
      assert.ok(blink.time - settled.time <= 6300, 'automatic blink must still resume after the quiet interval')
      const blinkStarts = sample.timeline.filter((entry, index) => entry.clip === 'blink' && sample.timeline[index - 1]?.clip !== 'blink')
      assert.equal(blinkStarts.length, 1, 'one automatic closure/reopen, without duplicate selections')
      assert.ok(sample.timeline.some(entry => entry.time > blink.time && entry.clip === 'idle' && entry.transition === 'false'), 'automatic blink must return to settled idle')
      await art.locator(':scope[data-clip="idle"]').waitFor()
    }
    assert.notEqual(createHash('sha256').update(first).digest('hex'), createHash('sha256').update(last).digest('hex'), `${intent} canvas remained static`)
  }
  const after = await page.evaluate(() => window.companionCare.get())
  assert.deepEqual(after.inventory, before.inventory); assert.equal(after.coins, before.coins)
  await page.getByTestId('desktop-pet-settings').getByRole('button',{name:'动作与提醒',exact:true}).click()
  await page.getByTestId('desktop-pet-settings').getByLabel('减少动画').check()
  await page.getByTestId('pet-preview-writing').click()
  await art.locator(':scope[data-clip="writing"][data-motion="paused"]').waitFor()
  await pause(100)
  const still = await art.screenshot()
  await pause(350)
  assert.deepEqual(await art.screenshot(), still, 'reduced motion still pose changed')
  // Same native canvas size for every pose, with no entrance crossfade in the
  // captures. These images expose head/body drift hidden by equal box heights.
  for (const intent of intents) {
    await page.getByTestId(`pet-preview-${intent}`).click()
    await art.locator(`:scope[data-clip="${intent}"][data-motion="paused"][data-transition="false"]`).waitFor()
    await art.screenshot({ path: join(output, `proportion-${intent}.png`) })
  }
  checks.push('all 18 poses captured in the same native canvas at zoom 1 without crossfade for proportion review')
  await page.getByTestId('desktop-pet-settings').getByLabel('减少动画').uncheck()
  // Rapid replacement must not apply an earlier asynchronous texture load.
  await page.getByTestId('pet-preview-greet').click()
  await page.getByTestId('pet-preview-drinking').click()
  await art.locator(':scope[data-clip="drinking"]').waitFor()
  await pause(200)
  assert.equal(await art.getAttribute('data-clip'),'drinking')
  // Playwright's Electron loader disables native backgrounding. Exercise the
  // actual IntersectionObserver visibility path without faking document.hidden.
  await preview.evaluate(element => { element.hidden = true })
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="pet-action-preview"] [data-testid="pet-artwork"]')
    return element?.dataset.motion === 'paused' && element.dataset.clip === 'idle'
  })
  const hiddenFrame = await art.getAttribute('data-frame')
  await pause(350)
  assert.equal(await art.getAttribute('data-frame'),hiddenFrame,'hidden preview advanced')
  await preview.evaluate(element => { element.hidden = false })
  await art.scrollIntoViewIfNeeded()
  await page.getByTestId('pet-preview-pat').click()
  await art.locator(':scope[data-clip="pat"]').waitFor()
  checks.push('all 18 animations recorded through complete playback; rendered pixels change; preview inventory unchanged; reduced still pose, hidden pause and rapid replacement pass')
  checks.push('all nine long one-shot gestures visibly hold the terminal pose, return without overdue blinks, then perform one automatic blink after 4–6 seconds of idle')
}
