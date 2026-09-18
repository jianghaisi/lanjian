import type { BrowserWindow } from 'electron'
import { holdCompanion } from './companion-presence-smoke'

/** Layout-only fixture text; not evidence of model inference or speech quality. */
export async function checkCompanionDialogueOverlay(window: BrowserWindow, capture: (name: string) => Promise<void>) {
  const evaluate = (js: string) => window.webContents.executeJavaScript(js)
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 350)); await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))') }
  const bounds = `['.library-heading','.archive-hero','.all-works-toolbar','.library-character-viewport'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,r.x,r.y,r.width,r.height]})`
  const before = await evaluate(bounds)
  const originalText = await evaluate(`document.querySelector('.companion-dialogue-content p').textContent`)
  const originalStyle = await evaluate(`document.querySelector('.archive-companion-puppet').getAttribute('style')`)
  const samples: unknown[] = []
  const composerBounds = await evaluate(`(()=>{const c=document.querySelector('[data-testid="companion-chat-composer"]'),d=document.querySelector('[data-testid="archive-character-dialogue"]');if(!c||d.contains(c)||d.querySelector('textarea,select,details,input'))throw Error('composer-not-separated');const r=c.getBoundingClientRect(),s=document.querySelector('.library-companion-stage').getBoundingClientRect();if(getComputedStyle(c).position!=='fixed'||Math.abs(r.bottom-(s.bottom-12))>2||r.left<0||r.right>s.right)throw Error('composer-not-bottom');return [r.x,r.y,r.width,r.height]})()`)
  try {
    await new Promise(resolve => setTimeout(resolve, 700)) // Ignore the separate click acknowledgment.
    for (const [label, text, scale] of [
      ['short', '欢迎回来。', 1.24],
      ['growing', '欢迎回来。故事还在等你继续。我们可以从刚才的章节聊起。', 1.24],
      ['long-right', '这是气泡流式排版的测试文字，不是模型回答。'.repeat(30), 1.85],
    ] as const) {
      await evaluate(`(()=>{document.querySelector('.companion-dialogue-content p').textContent=${JSON.stringify(text)};document.querySelector('.archive-companion-puppet').style.setProperty('--character-scale',${JSON.stringify(String(scale))})})()`)
      await settle()
      const sample = await evaluate(`(()=>{const d=document.querySelector('[data-testid="archive-character-dialogue"]');if(!d)return {missing:true};const r=d.getBoundingClientRect();return {label:${JSON.stringify(label)},placement:d.dataset.placement,height:r.height,width:r.width,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,liveReady:document.querySelector('.live2d-companion')?.dataset.ready==='true',scroll:document.querySelector('.companion-dialogue-content').scrollHeight>document.querySelector('.companion-dialogue-content').clientHeight,background:getComputedStyle(d).backgroundColor,position:getComputedStyle(d).position}})()`)
      // Production Vue intentionally omits component internals. Assert the built DOM
      // and inspect real screenshots; drawable collision math has separate unit tests.
      if (!sample.inside || !sample.liveReady || sample.position !== 'fixed') throw Error('companion-overlay-unsafe:'+JSON.stringify(sample))
      if (JSON.stringify(await evaluate(bounds)) !== JSON.stringify(before)) throw Error('companion-overlay-moved-modules')
      if (JSON.stringify(await evaluate(`(()=>{const r=document.querySelector('[data-testid="companion-chat-composer"]').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`)) !== JSON.stringify(composerBounds)) throw Error('reply-growth-moved-composer')
      if (label === 'short' && sample.height > 155 || label === 'long-right' && (!sample.scroll || sample.height > 261)) throw Error('companion-overlay-content-sizing:'+JSON.stringify(sample))
      samples.push(sample)
      await capture(`companion-overlay-${label}`)
    }
  } finally {
    await evaluate(`(()=>{document.querySelector('.companion-dialogue-content p').textContent=${JSON.stringify(originalText)};document.querySelector('.archive-companion-puppet').setAttribute('style',${JSON.stringify(originalStyle)})})()`)
    await settle()
  }
  // Actual input survives opening settings; only synthetic text and isolated preferences.
  await evaluate(`document.querySelector('#companion-message').focus()`)
  await evaluate(`(()=>{const input=document.querySelector('#companion-message');input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));for(const key of ['Enter','Escape']){const event=new KeyboardEvent('keydown',{key,ctrlKey:key==='Enter',isComposing:true,bubbles:true,cancelable:true});input.dispatchEvent(event);if(event.defaultPrevented)throw Error('composer-consumed-ime-key')}input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));const newline=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});input.dispatchEvent(newline);if(newline.defaultPrevented)throw Error('composer-consumed-newline');const send=new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true});input.dispatchEvent(send);if(!send.defaultPrevented)throw Error('composer-missing-send-shortcut')})()`)
  await settle()
  if (!await evaluate(`!!document.querySelector('#companion-message')`)) throw Error('composer-closed-during-ime')
  window.webContents.insertText('还没发送的灵感，设置后继续。')
  await settle()
  await evaluate(`document.querySelector('.project-library [data-activity="settings"]').click()`)
  await settle()
  if (await evaluate(`!!document.querySelector('[data-testid="companion-chat-composer"]')`)) throw Error('settings-left-composer-open')
  await evaluate(`(()=>{const host=document.querySelector('.local-appearance-dialog[open] [data-testid="companion-voice-settings"]');if(!host)throw Error('voice-settings-not-in-top-right-dialog');host.scrollIntoView({block:'center'});const v=host.querySelector('[data-testid="companion-sound-volume"]');v.value='0.35';v.dispatchEvent(new Event('input',{bubbles:true}));const s=host.querySelector('select');s.value='ganyu';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await settle()
  const settingsValue = await evaluate(`JSON.parse(localStorage.getItem('lanjian-companion-voice-v1'))`)
  if(settingsValue.volume!==.35||settingsValue.voice!=='ganyu')throw Error('voice-settings-not-persisted')
  await capture('companion-sound-settings-right-dialog')
  await evaluate(`document.querySelector('.local-appearance-dialog [aria-label="关闭外观设置"]').click()`)
  await settle()
  await holdCompanion(window)
  await settle()
  if (await evaluate(`document.querySelector('#companion-message')?.value`) !== '还没发送的灵感，设置后继续。') throw Error('settings-lost-unsent-chat')
  const originalTheme = await evaluate('document.documentElement.dataset.theme')
  for(const theme of ['qingzhou','xuanzhi','moye']) {
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
    await settle()
    await capture(`companion-separated-${theme}`)
  }
  await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(originalTheme)}`)
  // Closing must not move layout either.
  await evaluate(`document.querySelector('#companion-message').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`)
  await settle()
  if (JSON.stringify(await evaluate(bounds)) !== JSON.stringify(before)) throw Error('companion-overlay-close-moved-modules')
  if (await evaluate(`!!document.querySelector('[data-testid="companion-chat-composer"]')`)) throw Error('composer-survived-close')
  return { kind: 'companion-overlay', unchangedModules: true, separatedComposer: true, composerBounds, settingsValue, draftPreserved: true, imeKeysPreserved: true, samples }
}
