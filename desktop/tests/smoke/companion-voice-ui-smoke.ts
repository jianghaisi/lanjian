import type { BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { holdCompanion } from './companion-presence-smoke'

export async function checkCompanionVoice(window: BrowserWindow, capture: (name: string) => Promise<void>, click: (selector: string) => Promise<void>) {
  if (process.env.LANJIAN_SMOKE !== '1' || !process.env.LANJIAN_SMOKE_PROJECT_PATH) throw Error('voice-smoke-isolation')
  const evaluate = (js: string) => window.webContents.executeJavaScript(js)
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const waitFor = async (js: string, label: string, timeout = 90_000) => {
    const until = Date.now() + timeout
    while (Date.now() < until) { if (await evaluate(js)) return; await wait(100) }
    throw Error('voice-smoke-timeout:' + label + ':' + await evaluate(`document.querySelector('[data-testid="archive-character-dialogue"]')?.textContent`))
  }
  async function fingerprint(root: string): Promise<string> {
    const hash = createHash('sha256')
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw Error('voice-fixture-link')
      hash.update(entry.name)
      hash.update(entry.isDirectory() ? await fingerprint(join(root, entry.name)) : await readFile(join(root, entry.name)))
    }
    return hash.digest('hex')
  }
  const before = await fingerprint(process.env.LANJIAN_SMOKE_PROJECT_PATH)
  // Explicitly select both optional models, then measure chat after real preparation.
  await click('.project-library [data-activity="settings"]')
  for (const name of ['text-model', 'sound', 'preload']) {
    const selector = `[data-testid="companion-${name}-enabled"]`
    if (!await evaluate(`document.querySelector(${JSON.stringify(selector)}).checked`)) await click(selector)
  }
  await click('.local-appearance-dialog [aria-label="关闭外观设置"]')
  const prepareStarted = Date.now()
  if (!await evaluate(`window.novelDesktop.companionVoice.warmup()`)) throw Error('voice-model-preparation-failed')
  const preparationMs = Date.now() - prepareStarted
  await holdCompanion(window)
  await waitFor(`!document.querySelector('[aria-label="重播回复"]').disabled`, 'model-status')
  // Native input enters an isolated synthetic question, not author manuscript data.
  await click('#companion-message')
  await evaluate(`document.querySelector('#companion-message').select()`)
  window.webContents.insertText('请用一句话鼓励我继续写故事。')
  await waitFor(`!document.querySelector('.voice-send').disabled`, 'composer')
  const started = Date.now()
  await click('.voice-send')
  await waitFor(`document.querySelector('[data-testid="companion-conversation"]').dataset.playing==='true'`, 'real-model-first-audio')
  const firstPlaybackMs = Date.now() - started
  let audible = false
  for (let i = 0; i < 20; i++) { audible ||= window.webContents.isCurrentlyAudible(); if (audible) break; await wait(100) }
  if (!audible || window.webContents.isAudioMuted()) throw Error('voice-smoke-no-audible-output')
  const response = await evaluate(`document.querySelector('[data-testid="companion-reply"]').textContent`)
  if (!response.trim() || response.includes('欢迎回来。可以问我')) throw Error('voice-smoke-canned-response')
  await capture('companion-real-voice-playing')
  const stopStarted = Date.now()
  await evaluate(`document.querySelector('[data-testid="companion-stop"]').click()`)
  await waitFor(`document.querySelector('[data-testid="companion-conversation"]').dataset.playing==='false'`, 'immediate-stop', 1000)
  const stopMs = Date.now() - stopStarted
  if (stopMs > 250) throw Error('voice-stop-late:' + stopMs)
  await wait(2300)
  if (window.webContents.isCurrentlyAudible()) throw Error('voice-audio-after-stop')
  // Read real compiled rig capabilities without changing the displayed model/asset.
  const rig = await evaluate(`(async()=>{
    const bytes=await (await fetch(new URL('live2d/lanjian-rig/lanjian-rig.moc3',document.baseURI))).arrayBuffer();
    const core=window.Live2DCubismCore,moc=core.Moc.fromArrayBuffer(bytes),model=core.Model.fromMoc(moc),p=model.parameters;
    const output=[];
    for(const name of ['ParamBookVisible','ParamHairFront','ParamHairBack','ParamMouthForm','ParamEyeBallForm']){
      p.values.set(p.defaultValues);model.update();const index=p.ids.indexOf(name);
      if(index<0){output.push({name,present:false});continue}
      const opacity=Array.from(model.drawables.opacities),vertices=model.drawables.vertexPositions.map(v=>Array.from(v));
      p.values[index]=p.values[index]===p.minimumValues[index]?p.maximumValues[index]:p.minimumValues[index];model.update();
      output.push({name,present:true,min:p.minimumValues[index],max:p.maximumValues[index],default:p.defaultValues[index],opacityChanges:Array.from(model.drawables.opacities).filter((v,i)=>Math.abs(v-opacity[i])>.001).length,meshChanges:model.drawables.vertexPositions.filter((v,i)=>v.some((n,j)=>Math.abs(n-vertices[i][j])>.00001)).length});
    }model.release?.();moc._release?.();return output;
  })()`)
  await click('[aria-label="关闭人物对话"]')
  await wait(500)
  if (before !== await fingerprint(process.env.LANJIAN_SMOKE_PROJECT_PATH)) throw Error('voice-modified-fixture-book')
  return { kind: 'companion-voice', realQwenText: true, realGptSovitsAudio: true, audible, preparationMs, firstPlaybackMs, stopMs, unchangedBook: true, response, rig, microphoneTested: false }
}
