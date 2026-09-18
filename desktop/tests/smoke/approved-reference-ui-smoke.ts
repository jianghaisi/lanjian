import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BrowserWindow } from 'electron'
import { checkCompanionDialogueOverlay } from './companion-dialogue-overlay-smoke'
import { checkCompanionVoice } from './companion-voice-ui-smoke'
import { checkCompanionPresence, checkCompanionGesture } from './companion-presence-smoke'
import { checkCompanionModes } from './companion-modes-smoke'

/** Real application rendering and native controls, exclusively in the smoke fixture. */
export async function runApprovedReferenceUiSmoke(window: BrowserWindow, capturePath: string) {
  const output = join(dirname(capturePath), 'approved-reference')
  await mkdir(output, { recursive: true })
  const checks: string[] = [], screenshots: string[] = [], layouts: unknown[] = []
  let stage = 'isolation'
  const originalThrottle = window.webContents.getBackgroundThrottling()
  const originalZoom = window.webContents.getZoomFactor()
  const evaluate = (source: string) => window.webContents.executeJavaScript(source)
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const waitFor = async (expression: string, label: string) => {
    for (let i = 0; i < 160; i++) { if (await evaluate(expression)) return; await wait(100) }
    throw new Error(`approved-reference-timeout:${label}`)
  }
  const paint = async () => {
    // Native Windows occlusion and a replaced surface after reload can suspend
    // RAF even with renderer throttling off. Bring only this verified fixture
    // window to the front, then require real visible frames (never fake visibility).
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    if (!window.isFocused()) window.focus()
    await waitFor(`document.visibilityState==='visible'`, 'fixture-window-visible-before-paint')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const ready = await Promise.race([evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))'), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500) })])
      if (!ready) {
        const diagnostics = await Promise.race([evaluate(`({visibility:document.visibilityState,ready:document.readyState,hasFocus:document.hasFocus(),boot:!!document.querySelector('[data-testid="app-boot"]'),library:!!document.querySelector('.project-library')})`), wait(1000).then(()=>({rendererUnresponsive:true}))])
        throw new Error('approved-reference-not-painted:'+JSON.stringify({visible:window.isVisible(),minimized:window.isMinimized(),focused:window.isFocused(),throttled:window.webContents.getBackgroundThrottling(),diagnostics}))
      }
    } finally { clearTimeout(timer) }
  }
  const click = async (selector: string) => {
    await waitFor(`document.querySelector(${JSON.stringify(selector)})`, selector)
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`)
    await paint()
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:r.width>0&&r.height>0&&x>0&&y>0&&x<innerWidth&&y<innerHeight&&!e.disabled&&e.contains(document.elementFromPoint(x,y))}})()`)
    if (!point.hit) throw new Error(`approved-reference-control-obscured:${selector}:${JSON.stringify(point)}`)
    const zoom = window.webContents.getZoomFactor()
    window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 })
    await paint()
  }
  const capture = async (name: string) => {
    await wait(250); await paint()
    if (!window.isVisible() || window.isMinimized() || await evaluate('document.visibilityState') !== 'visible') throw new Error('approved-reference-window-not-visible:'+JSON.stringify({visible:window.isVisible(),minimized:window.isMinimized(),focused:window.isFocused(),document:await evaluate('document.visibilityState')}))
    const file = `${name}.png`
    const shot = await window.capturePage()
    const bitmap = shot.toBitmap()
    let hasVisualSignal = false
    for (let index = 0; index < bitmap.length; index += 1600) {
      if (bitmap[index] < 248 || bitmap[index + 1] < 248 || bitmap[index + 2] < 248) { hasVisualSignal = true; break }
    }
    await writeFile(join(output, file), shot.toPNG())
    if (!hasVisualSignal) throw new Error(`approved-reference-blank-screenshot:${file}`)
    screenshots.push(file)
  }
  const resize = async (width: number, height: number) => { window.setContentSize(width, height); await wait(250); await paint() }
  const toggleFocus = async () => {
    await click('[data-testid="manuscript-focus"]')
  }
  const assertPaperRules = async (label: string) => {
    const rules = await evaluate(`(()=>{const content=document.querySelector('.manuscript .cm-content'),scroller=document.querySelector('.manuscript .cm-scroller'),paper=document.querySelector('.manuscript'),s=getComputedStyle(content),r=content.getBoundingClientRect(),v=scroller.getBoundingClientRect();return {image:s.backgroundImage,x:s.backgroundPositionX,size:s.backgroundSize,scrollerImage:getComputedStyle(scroller).backgroundImage,paperImage:getComputedStyle(paper).backgroundImage,gutter:getComputedStyle(scroller).scrollbarGutter,left:r.left-v.left,right:v.right-r.right}})()`)
    layouts.push({ kind:'paper-rules', label, ...rules })
    if (!rules.image.includes('repeating-linear-gradient') || rules.scrollerImage!=='none' || rules.paperImage!=='none' || rules.x!=='50%' || rules.size.startsWith('100% ') || !rules.gutter.includes('both-edges') || Math.abs(rules.left-rules.right)>1.5) throw new Error('approved-reference-paper-not-centered:'+JSON.stringify(rules))
  }
  const assertLibraryFrame = async (label: string) => {
    const layout = await evaluate(`(()=>{const rect=s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();return r?{selector:s,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,visible:getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'}:null};const roots=['html','body','.project-library','.library-content'].map(s=>{const e=document.querySelector(s),style=getComputedStyle(e);return {selector:s,x:e.scrollWidth-e.clientWidth,y:e.scrollHeight-e.clientHeight,overflowX:style.overflowX,overflowY:style.overflowY}});const pieces=['.library-heading','.archive-hero','.all-works-toolbar','.all-works-surface'].map(rect);return {width:innerWidth,height:innerHeight,roots,pieces,art:!!document.querySelector('.works-watermark')?.naturalWidth,metadata:[...document.querySelectorAll('.work-card')].map(e=>({chapter:!!e.querySelector('.work-card-chapter')?.textContent.trim(),modified:!!e.querySelector('footer time')?.textContent.trim(),words:!!e.querySelector('.work-card-meta')?.textContent.trim(),more:!!e.querySelector('.work-card-menu-trigger')}))}})()`)
    layouts.push({ kind:'library-frame', label, ...layout })
    if (layout.roots.some((root:{x:number;y:number;overflowX:string;overflowY:string})=>(root.x>1&&!/clip|hidden/.test(root.overflowX))||(root.y>1&&!/clip|hidden/.test(root.overflowY))) || layout.pieces.some((piece:{visible:boolean;left:number;right:number;top:number;bottom:number;width:number;height:number}|null)=>!piece||!piece.visible||piece.width<=0||piece.height<=0||piece.left< -1||piece.top< -1||piece.right>layout.width+1||piece.bottom>layout.height+1)) throw new Error('approved-reference-library-not-single-screen:'+JSON.stringify(layout))
    if (!layout.art || !layout.metadata.length || layout.metadata.some((row:{chapter:boolean;modified:boolean;words:boolean;more:boolean})=>!row.chapter||!row.modified||!row.words||!row.more)) throw new Error('approved-reference-library-reference-details-missing:'+JSON.stringify(layout))
  }
  const assertLoaderFrame = async (theme: string, mode: string) => {
    const root = mode==='boot'?'app-boot':'workspace-loading'
    const action = mode==='boot'?'app-boot-skip':'cancel-workspace-loading'
    const layout = await evaluate(`(()=>{
      const dialog=document.querySelector('[data-testid="loader-preview-dialog"]'),root=document.querySelector('[data-testid="${root}"]'),button=document.querySelector('[data-testid="${action}"]');
      const measure=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,cls:String(e.className),left:r.left,top:r.top,right:r.right,bottom:r.bottom,x:e.scrollWidth-e.clientWidth,y:e.scrollHeight-e.clientHeight,overflowX:s.overflowX,overflowY:s.overflowY}};
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility==='visible'};
      const scrolling=[dialog,root,...root.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return visible(e)&&((/auto|scroll/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+1)||(/auto|scroll/.test(s.overflowX)&&e.scrollWidth>e.clientWidth+1))}).map(measure);
      const frameRoots=[dialog,root].map(e=>{const before={x:e.scrollLeft,y:e.scrollTop};e.scrollLeft=1;e.scrollTop=1;const canScroll=e.scrollLeft!==before.x||e.scrollTop!==before.y;e.scrollLeft=before.x;e.scrollTop=before.y;return {...measure(e),canScroll}});
      const content=[...root.querySelectorAll('.terminal-wordmark,.boot-current,.terminal-meter,.boot-steps li,.boot-note,.boot-error,.boot-actions button,.archive-progress h1,.archive-current,.archive-tree li,.archive-phase-meter,.archive-error,.archive-error button,.archive-slow,.archive-stage .archive-book,.archive-compact-title')].filter(visible).map(e=>{
        const r=e.getBoundingClientRect(),clippedBy=[];
        for(let parent=e.parentElement;parent;parent=parent.parentElement){const s=getComputedStyle(parent),p=parent.getBoundingClientRect();if((s.overflowX!=='visible'&&(r.left<p.left-1||r.right>p.right+1))||(s.overflowY!=='visible'&&(r.top<p.top-1||r.bottom>p.bottom+1)))clippedBy.push(String(parent.className));if(parent===root)break}
        return {...measure(e),clippedBy,hit:e.tagName==='BUTTON'?e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)):true}
      });
      const r=button.getBoundingClientRect();return {width:innerWidth,height:innerHeight,roots:frameRoots,scrolling,content,visiblePhases:[...root.querySelectorAll('.boot-steps li,.archive-tree li')].filter(visible).length,action:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,hit:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}}
    })()`)
    layouts.push({ kind:'loader-frame', theme, mode, ...layout })
    // Transformed aria-hidden orbit/slash artwork legitimately contributes to
    // scrollWidth even with overflow:clip. Require genuinely non-scrollable
    // roots, and independently prove semantic content is not merely clipped.
    if (layout.roots.some((r:{left:number;top:number;right:number;bottom:number;overflowX:string;overflowY:string;canScroll:boolean})=>Math.abs(r.left)>1||Math.abs(r.top)>1||Math.abs(r.right-layout.width)>1||Math.abs(r.bottom-layout.height)>1||r.overflowX!=='clip'||r.overflowY!=='clip'||r.canScroll) || layout.scrolling.length || !layout.content.length || layout.visiblePhases!==(mode==='boot'?4:6) || layout.content.some((r:{left:number;top:number;right:number;bottom:number;clippedBy:string[];hit:boolean})=>r.left<0||r.top<0||r.right>layout.width+1||r.bottom>layout.height+1||r.clippedBy.length||!r.hit) || !layout.action.hit || layout.action.left<0 || layout.action.top<0 || layout.action.right>layout.width+1 || layout.action.bottom>layout.height+1) throw new Error('approved-reference-loader-not-viewport-fitted:'+JSON.stringify(layout))
  }
  const settled = () => waitFor(`!document.querySelector('[data-testid="workspace-loading"]')&&!document.querySelector('[data-testid="app-boot-skip"]')&&!document.querySelector('.app-frame[inert]')`, 'overlays-settled')
  try {
    const status = await evaluate('window.novelDesktop.projects.status()')
    if (status?.project?.title !== '烟测书稿' || !process.env.LANJIAN_USER_DATA_PATH || process.env.LANJIAN_USER_DATA_PATH !== process.env.LANJIAN_SMOKE_CREATE_PARENT) throw new Error('approved-reference-requires-isolated-fixture')
    window.webContents.setBackgroundThrottling(false)
    window.webContents.setZoomFactor(1)
    await resize(1440, 900)
    if (await evaluate(`!!document.querySelector('[data-testid="app-boot-skip"]')`)) await click('[data-testid="app-boot-skip"]')
    await settled()
    if (process.env.LANJIAN_SMOKE_LIBRARY_REFERENCE_ONLY === '1') {
      stage = 'library-visual-reference'
      await waitFor(`document.querySelector('.project-library')||document.querySelector('.project-title-return')`, 'library-or-workspace-ready')
      if (!await evaluate(`!!document.querySelector('.project-library')`)) await click('.project-title-return')
      await waitFor(`document.querySelector('.project-library')`, 'library')
      if (process.env.LANJIAN_SMOKE_COMPANION_VOICE === '1') layouts.push(await checkCompanionPresence(window, capture))
      for (const view of [{ width: 1920, height: 1020, zoom: 1 }, { width: 1440, height: 900, zoom: 1 }, { width: 1100, height: 760, zoom: 1.25 }]) {
        window.webContents.setZoomFactor(view.zoom)
        await resize(view.width, view.height)
        await waitFor(`document.querySelector('.archive-companion-puppet .live2d-companion[data-ready="true"] canvas')&&[...document.querySelectorAll('.project-library img')].every(i=>i.complete&&i.naturalWidth>0)`, 'library-media')
        await assertLibraryFrame(`${view.width}x${view.height}-zoom${view.zoom}`)
        const visual = await evaluate(`(()=>{const css=(s,p)=>getComputedStyle(document.querySelector(s),p),rect=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r?{left:r.left,right:r.right,width:r.width,height:r.height,top:r.top,bottom:r.bottom}:null};const cards=[...document.querySelectorAll('.work-card')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),title=getComputedStyle(e.querySelector('strong'));return {width:r.width,height:r.height,background:s.backgroundColor,titleSize:parseFloat(title.fontSize),titleColor:title.color}});const surface=css('.all-works-surface'),grid=css('.works-grid'),art=css('.works-watermark'),heading=css('.project-library .library-heading h1'),hero=rect('.continue-dossier'),stage=rect('.library-companion-stage'),figure=rect('.archive-companion-puppet'),clock=document.querySelector('.heading-clock'),visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'},heroChildren=[...document.querySelectorAll('.continue-dossier h2,.continue-dossier h3,.continue-dossier p,.continue-dossier strong,.continue-dossier small')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}});return {headingSize:parseFloat(heading.fontSize),surfaceBackground:surface.backgroundColor,gridBackground:grid.backgroundColor,gridImage:css('.all-works-surface','::before').backgroundImage,artOpacity:parseFloat(art.opacity),artZ:parseFloat(art.zIndex),heading:rect('.library-heading'),hero,gallery:rect('.all-works'),stage,figure,figureProtrusion:figure&&stage?figure.right-stage.right:0,clock:{time:clock?.querySelector(':scope>span')?.textContent.trim()||'',date:clock?.querySelector('small')?.childNodes[0]?.textContent.trim()||'',weekday:clock?.querySelector('small b')?.textContent.trim()||'',size:parseFloat(getComputedStyle(clock?.querySelector(':scope>span')).fontSize),timeBounds:rect('.heading-clock>span'),dateBounds:rect('.heading-clock small')},assistantInLibrary:!!document.querySelector('[data-testid="library-assistant"],[data-testid="library-open-assistant"],.assistant-resizer,.assistant-panel'),petInLibrary:!!document.querySelector('[data-testid="external-companion"], [data-testid="companion-illustration"]'),live2dReady:document.querySelector('.archive-companion-puppet .live2d-companion')?.dataset.ready==='true',heroChildren,cards}})()`)
        const dossier = await evaluate(`(()=>{const rect=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}:null},card=rect('.continue-dossier'),header=rect('.continue-dossier>header'),body=rect('.dossier-book'),cover=rect('.dossier-book .library-book-cover'),meter=rect('.dossier-progress>i'),actions=rect('.archive-quick-actions'),button=document.querySelector('.continue-dossier'),fx=document.querySelector('.dossier-click-fx');button?.classList.add('is-previewing');const motion={card:getComputedStyle(button).animationName,fx:getComputedStyle(fx).animationName,border:getComputedStyle(fx,'::after').animationName};button?.classList.remove('is-previewing');return {card,header,body,cover,meter,actions,motion,dataCells:document.querySelectorAll('.dossier-data-row>span').length,actionRows:document.querySelectorAll('.archive-quick-actions>.archive-action,.archive-quick-actions>.archive-import').length,indexLabel:document.querySelector('.dossier-progress')?.textContent||'',textureLayers:document.querySelectorAll('.dossier-aging,.dossier-creases,.dossier-dot-field,.dossier-scratches').length,clickFx:!!fx,tech:!!document.querySelector('.dossier-tech-lines'),bolts:document.querySelectorAll('.dossier-bolt').length,corners:document.querySelectorAll('.dossier-corner').length}})()`)
        layouts.push({ kind: 'library-visual', label: `${view.width}x${view.height}-zoom${view.zoom}`, ...visual })
        layouts.push({ kind: 'library-dossier', label: `${view.width}x${view.height}-zoom${view.zoom}`, ...dossier })
        if (visual.headingSize < 40 || visual.gridBackground !== 'rgba(0, 0, 0, 0)' || !visual.gridImage.includes('linear-gradient') || visual.artOpacity < .12 || visual.artZ < 0 || visual.figureProtrusion < 24 || !visual.live2dReady || !/^\d{2}:\d{2}:\d{2}$/.test(visual.clock.time) || !/^\d{4}\.\d{2}\.\d{2}$/.test(visual.clock.date) || !visual.clock.weekday.includes('星期') || visual.clock.size < 36 || !visual.clock.timeBounds || !visual.clock.dateBounds || visual.clock.dateBounds.right > visual.clock.timeBounds.left || Math.abs(visual.clock.dateBounds.bottom - visual.clock.timeBounds.bottom) > 12 || visual.assistantInLibrary || visual.petInLibrary || visual.heroChildren.some((piece: { top: number; bottom: number; left: number; right: number }) => piece.top < visual.hero.top - 1 || piece.bottom > visual.hero.bottom + 1 || piece.left < visual.hero.left - 1 || piece.right > visual.hero.right + 1) || !visual.cards.length || visual.cards.some((card: { titleSize: number; width: number; height: number; background: string }) => card.titleSize < 15 || card.width < 180 || card.height < 100 || card.background !== 'rgba(0, 0, 0, 0)')) throw new Error('approved-reference-library-visual-regression:' + JSON.stringify(visual))
        if (!dossier.card || !dossier.header || !dossier.body || !dossier.cover || !dossier.meter || !dossier.actions || dossier.dataCells !== 2 || dossier.actionRows !== 4 || !dossier.indexLabel.includes('LOCAL MANUSCRIPT INDEX') || dossier.textureLayers !== 4 || !dossier.clickFx || !dossier.tech || dossier.bolts !== 4 || dossier.corners !== 2 || !dossier.motion.card.includes('dossier-hit') || !dossier.motion.fx.includes('dossier-flash') || !dossier.motion.border.includes('dossier-lock') || (view.width >= 1400 && (dossier.header.height / dossier.card.height < .2 || dossier.header.height / dossier.card.height > .36 || dossier.cover.height / dossier.body.height < .72 || dossier.cover.width / dossier.cover.height < .55 || dossier.cover.width / dossier.cover.height > .82 || dossier.card.width / dossier.card.height < 2.2 || dossier.actions.height < dossier.card.height - 2))) throw new Error('approved-reference-library-dossier-regression:'+JSON.stringify(dossier))
        await capture(`library-reference-${view.width}x${view.height}${view.zoom > 1 ? '-zoom125' : ''}`)
        if (view.width === 1440 && view.zoom === 1) {
          await evaluate(`(()=>{const grid=document.querySelector('.works-grid'),source=grid?.querySelector('.work-card');if(!grid||!source)return false;for(let i=2;i<=6;i++){const clone=source.cloneNode(true);clone.dataset.densityClone='true';clone.querySelector('.work-card-index').textContent='LJ / '+String(i).padStart(2,'0');clone.querySelector('footer>span').textContent='LOCAL / '+String(i).padStart(2,'0');grid.append(clone)}return true})()`)
          await capture('library-reference-1440x900-six-cards')
          await evaluate(`document.querySelectorAll('[data-density-clone="true"]').forEach(e=>e.remove())`)
        }
      }
      window.webContents.setZoomFactor(1)
      await resize(1440, 900)
      const originalTheme = await evaluate(`document.documentElement.dataset.theme||'qingzhou'`)
      const themeSamples: Array<{ theme: string; paper: string; surface: string; ink: string }> = []
      for (const theme of ['qingzhou', 'xuanzhi', 'moye']) {
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
        await paint()
        await wait(750)
        const sample = await evaluate(`(()=>{
          const css=selector=>getComputedStyle(document.querySelector(selector));
          const root=css('html'),library=css('.project-library'),art=css('.works-watermark');
          return {theme:document.documentElement.dataset.theme,paper:library.backgroundColor,surface:css('.all-works-toolbar').backgroundColor,ink:css('.work-card-copy>strong').color,
            rootOpacity:root.opacity,rootFilter:root.filter,rootBlend:root.mixBlendMode,
            artOpacity:art.opacity,artBlend:art.mixBlendMode,backgroundFilter:css('.archive-companion-background').filter,
            cardBackground:css('.work-card-main').backgroundColor}
        })()`)
        if (sample.rootOpacity !== '1' || sample.rootFilter !== 'none' || sample.rootBlend !== 'normal' || sample.cardBackground !== 'rgba(0, 0, 0, 0)' || (theme === 'moye' && (sample.artOpacity !== '0.14' || sample.artBlend !== 'screen' || !sample.backgroundFilter.includes('brightness(0.58)')))) throw new Error('approved-reference-library-theme-scope:'+JSON.stringify(sample))
        themeSamples.push(sample)
        await capture(`library-theme-${theme}`)
      }
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(originalTheme)}`)
      await paint()
      if (new Set(themeSamples.map(sample => `${sample.paper}|${sample.surface}|${sample.ink}`)).size !== themeSamples.length || themeSamples.some(sample => !sample.paper || !sample.surface || !sample.ink)) throw new Error('approved-reference-library-theme-not-adapted:'+JSON.stringify(themeSamples))
      layouts.push({ kind: 'library-theme-adaptation', samples: themeSamples })
      layouts.push(await checkCompanionModes(window, capture, click))
      const clockBefore = await evaluate(`document.querySelector('.heading-clock>span').textContent.trim()`)
      await waitFor(`document.querySelector('.heading-clock>span').textContent.trim()!==${JSON.stringify(clockBefore)}`, 'library-clock-seconds-advance')
      layouts.push({ kind: 'library-clock-ticking', before: clockBefore, after: await evaluate(`document.querySelector('.heading-clock>span').textContent.trim()`) })
      const firstWork = await evaluate(`(()=>{const e=document.querySelector('.work-card-main'),r=e?.getBoundingClientRect();return r?{x:r.x+r.width*.65,y:r.y+r.height*.5}:null})()`)
      if (!firstWork) throw new Error('approved-reference-library-card-hover-target-missing')
      window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(firstWork.x), y: Math.round(firstWork.y), movementX: 1, movementY: 1 })
      await paint()
      const tagContrast = await evaluate(`(()=>{const tag=document.querySelector('.work-card-tags i'),style=getComputedStyle(tag);return {color:style.color,background:style.backgroundColor,text:tag?.textContent.trim()||''}})()`)
      if (!tagContrast.text || tagContrast.color === 'rgb(255, 255, 255)' || tagContrast.background === 'rgba(0, 0, 0, 0)' || tagContrast.color === tagContrast.background) throw new Error('approved-reference-library-card-tag-hover-contrast:'+JSON.stringify(tagContrast))
      layouts.push({ kind: 'library-card-tag-hover', ...tagContrast })
      layouts.push(await checkCompanionGesture(window, capture))
      await waitFor(`document.querySelector('[data-testid="archive-character-dialogue"]')?.textContent.trim().length>20`, 'library-character-response')
      await wait(320) // Measure the settled portal, not a transient entry-animation frame.
      const characterResponse = await evaluate(`(()=>{const puppet=document.querySelector('[data-testid="interactive-archive-character"]'),dialogue=document.querySelector('[data-testid="archive-character-dialogue"]'),live=document.querySelector('.archive-companion-puppet .live2d-companion'),stage=document.querySelector('.library-companion-stage'),rect=dialogue?.getBoundingClientRect(),stageRect=stage?.getBoundingClientRect();return {action:Number(puppet?.dataset.action||0),responding:puppet?.classList.contains('responding'),dialogue:dialogue?.textContent.trim()||'',animation:getComputedStyle(puppet.querySelector('.character-live2d')).animationName,live2dReady:live?.dataset.ready==='true',anchor:dialogue?.dataset.anchor||'',teleported:!!dialogue&&!puppet.contains(dialogue),dialogueBounds:rect?{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom}:null,stageBounds:stageRect?{left:stageRect.left,top:stageRect.top,right:stageRect.right,bottom:stageRect.bottom,height:stageRect.height}:null,viewport:{width:innerWidth,height:innerHeight}}})()`)
      const dialogueIsVisible = characterResponse.dialogueBounds
        && characterResponse.dialogueBounds.left >= 0
        && characterResponse.dialogueBounds.top >= 0
        && characterResponse.dialogueBounds.right <= characterResponse.viewport.width
        && characterResponse.dialogueBounds.bottom <= characterResponse.viewport.height
      const dialogueUsesSafeStageBand = await evaluate(`(()=>{const d=document.querySelector('[data-testid="archive-character-dialogue"]'),v=document.querySelector('.library-character-viewport'),s=document.querySelector('.library-companion-stage');if(!d||!v||!s)return false;const b=d.getBoundingClientRect(),a=v.getBoundingClientRect(),r=s.getBoundingClientRect();return b.top>=r.top&&b.left>=0&&b.right<=innerWidth&&b.bottom<=r.bottom&&Math.abs(a.top-r.top)<2&&getComputedStyle(v).overflow==='visible'&&['above','right'].includes(d.dataset.placement)&&!document.querySelector('.library-dialogue-lane')})()`)
      if (characterResponse.responding || !characterResponse.dialogue || !characterResponse.live2dReady || characterResponse.anchor !== 'stage-safe' || !characterResponse.teleported || !dialogueIsVisible || !dialogueUsesSafeStageBand) throw new Error('approved-reference-library-character-response-missing:'+JSON.stringify({characterResponse,dialogueIsVisible,dialogueUsesSafeStageBand}))
      layouts.push({ kind: 'library-character-response', ...characterResponse })
      await capture('library-character-response')
      layouts.push(await checkCompanionDialogueOverlay(window, capture))
      if (process.env.LANJIAN_SMOKE_COMPANION_VOICE === '1') layouts.push(await checkCompanionVoice(window, capture, click))
      const galleryBeforeExpand = await evaluate(`document.querySelector('.all-works-anchor').getBoundingClientRect().top`)
      await click('[data-testid="library-all-works"]')
      await waitFor(`document.querySelector('.library-content.works-expanded [data-testid="library-all-works-back"]')`, 'all-works-expanded')
      await wait(700); await paint()
      const expandedWorks = await evaluate(`(()=>{const overview=document.querySelector('.library-overview-panel'),gallery=document.querySelector('.all-works-anchor'),back=document.querySelector('[data-testid="library-all-works-back"]'),o=overview.getBoundingClientRect(),g=gallery.getBoundingClientRect();return {overviewHeight:o.height,overviewVisible:getComputedStyle(overview).visibility,galleryTop:g.top,galleryHeight:g.height,backVisible:!!back&&getComputedStyle(back).visibility==='visible'}})()`)
      if (expandedWorks.overviewHeight > 1 || expandedWorks.overviewVisible !== 'hidden' || galleryBeforeExpand - expandedWorks.galleryTop < 150 || expandedWorks.galleryHeight < 450 || !expandedWorks.backVisible) throw new Error('approved-reference-all-works-did-not-expand:'+JSON.stringify({galleryBeforeExpand,expandedWorks}))
      layouts.push({ kind: 'library-all-works-expanded', galleryBeforeExpand, ...expandedWorks })
      await capture('library-all-works-expanded')
      await click('[data-testid="library-all-works-back"]')
      await waitFor(`!document.querySelector('.library-content')?.classList.contains('works-expanded')`, 'all-works-returned')
      await wait(700); await paint()
      const returned = await evaluate(`({height:document.querySelector('.library-overview-panel').getBoundingClientRect().height,focus:document.activeElement?.dataset.testid})`)
      layouts.push({ kind: 'library-all-works-returned', ...returned })
      if (returned.height <= 200 || returned.focus !== 'library-all-works') throw new Error('approved-reference-all-works-return-incomplete:'+JSON.stringify(returned))
      await capture('library-all-works-returned')
      await click('.project-library [data-activity="settings"]')
      await waitFor(`document.querySelector('.local-appearance-dialog[open] [data-testid="library-appearance-settings"]')`, 'library-appearance-settings')
      const settings = await evaluate(`(()=>({backgrounds:[...document.querySelectorAll('[data-testid^="library-background-"]')].map(e=>e.dataset.testid),scenes:[...document.querySelectorAll('[data-testid^="library-scene-"]')].map(e=>e.dataset.testid),composer:!!document.querySelector('[data-testid="library-character-composer"]'),controls:['scale','inline','block'].every(name=>document.querySelector('[data-testid="library-character-'+name+'"]')),companion:!!document.querySelector('.local-appearance-dialog [data-testid="companion-settings"]'),obsoleteMotion:!!document.querySelector('[data-testid="loader-reduced-motion"]')||document.querySelector('.local-appearance-dialog')?.textContent.includes('减少动态效果')}))()`)
      if (settings.backgrounds.length < 4 || settings.scenes.length < 3 || !settings.composer || !settings.controls || settings.companion || settings.obsoleteMotion) throw new Error('approved-reference-library-appearance-settings-incomplete:'+JSON.stringify(settings))
      await click('label:has([data-testid="library-background-red-moon"])')
      await waitFor(`localStorage.getItem('lanjian-library-appearance-v4')?.includes('red-moon')&&document.querySelector('.archive-companion-background')?.getAttribute('src')?.includes('recent-red-moon')`, 'library-background-choice-persisted')
      await click('label:has([data-testid="library-scene-observatory"])')
      await waitFor(`localStorage.getItem('lanjian-library-appearance-v4')?.includes('observatory')&&document.querySelector('.works-watermark')?.getAttribute('src')?.includes('archive-observatory')`, 'library-scene-choice-persisted')
      await evaluate(`(()=>{for(const [id,value] of [['library-character-scale','1.18'],['library-character-inline','10'],['library-character-block','-5']]){const input=document.querySelector('[data-testid="'+id+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}))}})()`)
      await waitFor(`(()=>{const saved=localStorage.getItem('lanjian-library-appearance-v4')||'';return saved.includes('"scale":1.18')&&saved.includes('"inlineOffset":10')&&saved.includes('"blockOffset":-5')})()`, 'library-character-composition-persisted')
      await capture('library-appearance-settings')
      await evaluate(`(()=>{for(const [id,value] of [['dialogue-opacity','45'],['dialogue-fontSize','18'],['dialogue-width','410'],['dialogue-maxHeight','300']]){const input=document.querySelector('[data-testid="'+id+'"]');if(!input)throw Error('missing-dialogue-setting:'+id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}))}})()`)
      await waitFor(`(()=>{const v=JSON.parse(localStorage.getItem('lanjian-companion-dialogue-v1')||'{}');return v.opacity===.45&&v.fontSize===18&&v.width===410&&v.maxHeight===300})()`, 'dialogue-settings-persisted')
      await evaluate(`document.querySelector('[data-testid="companion-dialogue-settings"]').scrollIntoView({block:'center'})`)
      await capture('companion-dialogue-settings')
      await click('[data-testid="companion-dialogue-settings"] legend button')
      await click('label:has([data-testid="library-background-industrial"])')
      await click('label:has([data-testid="library-scene-satellite"])')
      await click('[data-testid="library-character-reset"]')
      await waitFor(`(()=>{const saved=localStorage.getItem('lanjian-library-appearance-v4')||'';return saved.includes('"scale":1.24')&&saved.includes('"inlineOffset":0')&&saved.includes('"blockOffset":18')})()`, 'library-character-composition-reset')
      await click('.local-appearance-dialog[open] [aria-label="关闭外观设置"]')
      const hoverPoint = await evaluate(`(()=>{const r=document.querySelector('[data-testid="library-continue-writing"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      const zoom = window.webContents.getZoomFactor()
      window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(hoverPoint.x * zoom), y: Math.round(hoverPoint.y * zoom), movementX: 1, movementY: 1 })
      await wait(50); await paint()
      const hoverMotion = await evaluate(`(()=>{const card=document.querySelector('[data-testid="library-continue-writing"]'),fx=document.querySelector('.dossier-click-fx');return {stillInLibrary:!!document.querySelector('.project-library'),previewing:card?.classList.contains('is-previewing'),duration:getComputedStyle(card).animationDuration,cardAnimation:getComputedStyle(card).animationName,scanAnimation:getComputedStyle(fx,'::before').animationName,borderAnimation:getComputedStyle(fx,'::after').animationName}})()`)
      if (!hoverMotion.stillInLibrary || !hoverMotion.previewing || hoverMotion.duration !== '0.62s' || !hoverMotion.cardAnimation.includes('dossier-hit') || !hoverMotion.scanAnimation.includes('dossier-scan') || !hoverMotion.borderAnimation.includes('dossier-lock')) throw new Error('approved-reference-library-hover-motion-missing:'+JSON.stringify(hoverMotion))
      await capture('library-continue-hover-animation')
      await waitFor(`!document.querySelector('[data-testid="library-continue-writing"]')?.classList.contains('is-previewing')`, 'continue-writing-hover-animation-finished')
      await click('[data-testid="library-continue-writing"]')
      await waitFor(`!document.querySelector('.project-library')&&!!document.querySelector('[data-testid="manuscript-input"]')`, 'continue-writing-click-opens-manuscript')
      layouts.push({ kind: 'library-hover-motion', ...hoverMotion })
      checks.push('library reference verified at 1920×1020, 1440×900, and 1100×760/125%: readable local date clock, qingzhou/xuanzhi/moye-aware surfaces, stable tag contrast, reference-proportioned dossier with real counters and manuscript-index meter, narrow action stack, protruding adjustable character art, stage-safe dialogue, no library assistant or desktop pet, transparent project cards, visible lower-right scene, persistent artwork choices, and the supplied 620ms animation on hover while click opens the manuscript')
      stage = 'finished'
      const result = { ok: true, checks, screenshots, layouts, note: 'Focused real Electron library render in an isolated fixture.' }
      await writeFile(join(output, 'verification.json'), JSON.stringify(result, null, 2)); return result
    }
    stage = 'write-save-search'
    await click('.activitybar [data-activity="desk"]')
    await waitFor(`document.querySelector('[data-testid="manuscript-input"]')`, 'editor')
    if (!await evaluate(`!!document.querySelector('.assistant-panel')`)) await click('.title-actions .assistant-toggle')
    await click('[data-testid="assistant-mode-agent"]')
    const original = await evaluate('(async()=> (await window.novelDesktop.chapters.get(1)).content)()')
    const fixture = Array.from({length: 22}, (_, index) => `　　第${index + 1}段：风比昨晚更冷。沈砚合上笔记，听见窗外传来一声轻响。这是隔离界面测试，不属于作者作品。`).join('\n\n')
    await click('[data-testid="manuscript-input"]')
    window.webContents.focus()
    await window.webContents.insertText(fixture)
    await click('[data-testid="save-manuscript"]')
    await waitFor(`(async()=> (await window.novelDesktop.chapters.get(1)).content.includes(${JSON.stringify(fixture)}))()`, 'persisted-fixture')
    const saved = await evaluate('(async()=> (await window.novelDesktop.chapters.get(1)).content)()')
    if (!saved || saved === original) throw new Error('approved-reference-empty-save')
    await click('[aria-label="查找与替换"]')
    await click('[aria-label="查找正文"]')
    await window.webContents.insertText('窗外')
    await waitFor(`document.activeElement?.getAttribute('aria-label')==='查找正文'&&document.querySelector('.manuscript-find')?.textContent.includes('22')`, 'search-matches-and-focus')
    await click('[aria-label="关闭查找"]')
    if (await evaluate('(async()=> (await window.novelDesktop.chapters.get(1)).content)()') !== saved) throw new Error('approved-reference-search-changed-prose')
    await waitFor(`!document.querySelector('.toast')`, 'save-toast-settled')
    checks.push('native nonempty manuscript input saved through SQLite; search finds 22 matches without changing prose')
    stage = 'direct-layout'
    if (await evaluate(`!!document.querySelector('[data-testid="draft-current-chapter"], [data-testid="manuscript-view-menu"]')`)) throw new Error('approved-reference-obsolete-editor-menu-or-generate-action')
    await click('[data-testid="manuscript-layout"]')
    await waitFor(`document.querySelector('#manuscript-layout-panel')&&document.querySelector('[data-testid="manuscript-layout"]')?.getAttribute('aria-expanded')==='true'&&document.activeElement?.closest('#manuscript-layout-panel')`, 'one-click-layout-controls')
    // The isolated fixture explicitly enables rules through the real preference;
    // do not alter an author's stored appearance or infer a hidden rule is broken.
    if (!await evaluate(`(()=>{const labels=[...document.querySelectorAll('#manuscript-layout-panel label')];return labels.find(e=>e.textContent.includes('稿纸行线'))?.querySelector('input')?.checked})()`)) {
      const guideSelector = '#manuscript-layout-panel .layout-switches label:last-child input'
      await click(guideSelector)
    }
    await capture('manuscript-direct-layout')
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
    await waitFor(`!document.querySelector('#manuscript-layout-panel')&&document.activeElement?.dataset.testid==='manuscript-layout'`, 'layout-escape-restores-focus')
    if (await evaluate('(async()=> (await window.novelDesktop.chapters.get(1)).content)()') !== saved) throw new Error('approved-reference-layout-changed-prose')
    checks.push('one native layout click exposes actual controls; Escape closes and restores trigger; obsolete chapter generation action is absent; prose unchanged')
    stage = 'desktop-pet-separation'
    // This suite must retain its saved editor fixture and route. The dedicated
    // LANJIAN_SMOKE_DESKTOP_PET_ONLY driver owns OS dragging, menu interaction
    // and recovery; calling it here would reload and replace this live scene.
    const petBefore = await evaluate('window.desktopPet.get()')
    if (petBefore.context.mode === 'hidden' || petBefore.context.focusHidden) throw new Error('approved-reference-pet-fixture-not-enabled')
    const editorBeforePet = await evaluate(`document.querySelector('.manuscript-editor .cm-content')?.textContent`)
    const ownerPetGeometry = () => evaluate(`(()=>{const selectors=['.explorer','.workbench','.assistant-panel','[data-testid="archive-new-chapter"]'];return {page:document.querySelector('.activitybar [aria-current="page"]')?.getAttribute('data-activity'),inlinePet:!!document.querySelector('[data-testid="companion-pet"],[data-testid="companion-dock"]'),companionInside:!!document.querySelector('.assistant-panel [data-testid="companion-host"]'),explorerMargin:parseFloat(getComputedStyle(document.querySelector('.explorer')).marginBlockEnd),rects:selectors.map(selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect();return r?{selector,x:r.x,y:r.y,width:r.width,height:r.height}:null})}})()`)
    try {
      if (!petBefore.open) await click('[data-testid="external-companion"]')
      await waitFor(`document.querySelector('[data-testid="external-companion"]')?.getAttribute('aria-expanded')==='true'`, 'native-desktop-pet-open')
      let petWindow: BrowserWindow | undefined
      for (let attempt = 0; attempt < 100; attempt++) {
        petWindow = BrowserWindow.getAllWindows().find(candidate => candidate !== window && !candidate.isDestroyed() && candidate.getTitle() === '岚笺 · 桌面伙伴')
        if (petWindow?.isVisible() && await petWindow.webContents.executeJavaScript(`Boolean(document.querySelector('[data-testid="pet-window-handle"]'))`).catch(() => false)) break
        await wait(100)
      }
      if (!petWindow || !petWindow.isVisible() || petWindow.getParentWindow() !== null) throw new Error('approved-reference-pet-not-independent')
      const petLayout = await petWindow.webContents.executeJavaScript(`(()=>{const rect=selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect();return r?{selector,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,visible:getComputedStyle(e).visibility==='visible',hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}:null};return {width:innerWidth,height:innerHeight,mainApi:typeof window.novelDesktop,petApi:typeof window.desktopPet,roots:['html','body','#pet-app'].map(s=>({selector:s,color:getComputedStyle(document.querySelector(s)).backgroundColor})),handle:rect('[data-testid="pet-window-handle"]'),menu:rect('[data-testid="pet-window-menu-toggle"]')}})()`)
      const transparent = (color: string) => color === 'transparent' || /^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color)
      if (await petWindow.webContents.executeJavaScript('typeof require') !== 'undefined') throw new Error('approved-reference-pet-exposes-node-require')
      if (petLayout.mainApi !== 'undefined' || petLayout.petApi !== 'object' || petLayout.roots.some((root: { color: string }) => !transparent(root.color))
        || [petLayout.handle, petLayout.menu].some((control: { x: number; y: number; right: number; bottom: number; width: number; height: number; visible: boolean; hit: boolean } | null) => !control || !control.visible || !control.hit || control.width <= 0 || control.height <= 0 || control.x < 0 || control.y < 0 || control.right > petLayout.width + 1 || control.bottom > petLayout.height + 1)) throw new Error('approved-reference-pet-renderer-contract:' + JSON.stringify(petLayout))
      const expanded = await ownerPetGeometry()
      if (expanded.page !== 'desk' || expanded.inlinePet || expanded.companionInside || Math.abs(expanded.explorerMargin) > 1 || expanded.rects.some((rect: unknown) => !rect)) throw new Error('approved-reference-pet-reserves-editor-space:' + JSON.stringify(expanded))
      await capture('desktop-pet-owner-uncompressed')
      await click('[data-testid="external-companion"]')
      await waitFor(`document.querySelector('[data-testid="external-companion"]')?.getAttribute('aria-expanded')==='false'`, 'native-desktop-pet-hidden')
      for (let attempt = 0; attempt < 100 && petWindow.isVisible(); attempt++) await wait(50)
      if (petWindow.isVisible()) throw new Error('approved-reference-pet-hide-did-not-hide-native-window')
      const collapsed = await ownerPetGeometry()
      if (collapsed.page !== 'desk' || collapsed.inlinePet || collapsed.companionInside || Math.abs(collapsed.explorerMargin) > 1 || collapsed.rects.some((rect: { x: number; y: number; width: number; height: number } | null, index: number) => !rect || (['x', 'y', 'width', 'height'] as const).some(key => Math.abs(rect[key] - expanded.rects[index][key]) > 1))) throw new Error('approved-reference-pet-toggle-compresses-workspace:' + JSON.stringify({ expanded, collapsed }))
      layouts.push({ kind: 'native-desktop-pet', pet: petLayout, expanded, collapsed })
    } finally {
      const petAfter = await evaluate('window.desktopPet.get()')
      if (petAfter.open !== petBefore.open) {
        await click('[data-testid="external-companion"]')
        await waitFor(`document.querySelector('[data-testid="external-companion"]')?.getAttribute('aria-expanded')===${JSON.stringify(String(petBefore.open))}`, 'native-pet-original-visibility-restored')
      }
    }
    const petAfter = await evaluate('window.desktopPet.get()')
    if (JSON.stringify(petAfter.preferences) !== JSON.stringify(petBefore.preferences) || petAfter.context.mode !== petBefore.context.mode
      || await evaluate(`document.querySelector('.manuscript-editor .cm-content')?.textContent`) !== editorBeforePet
      || await evaluate('(async()=> (await window.novelDesktop.chapters.get(1)).content)()') !== saved
      || !await evaluate(`document.querySelector('.activitybar [data-activity="desk"]')?.getAttribute('aria-current')==='page'&&!!document.querySelector('[data-testid="writing-agent-input"]')`)) throw new Error('approved-reference-native-pet-changed-writing-scene')
    checks.push('Independent transparent pet window has restricted preload and visible controls; real top-bar show/hide never reserves directory/editor space; original visibility, preferences, editor/assistant route and saved prose preserved. Full OS drag/menu/recovery coverage uses LANJIAN_SMOKE_DESKTOP_PET_ONLY.')
    stage = 'responsive-workbench'
    // Persist through the real keyboard-accessible separator; resizing the window
    // or changing logical text scale must never overwrite the author's preference.
    await click('.explorer-resizer')
    await evaluate(`document.querySelector('.explorer-resizer').focus()`)
    const priorExplorerPreference = await evaluate(`Number(document.querySelector('.explorer-resizer').getAttribute('aria-valuenow'))`)
    window.webContents.sendInputEvent({ type:'keyDown', keyCode:'Right' })
    window.webContents.sendInputEvent({ type:'keyUp', keyCode:'Right' })
    await waitFor(`Number(document.querySelector('.explorer-resizer').getAttribute('aria-valuenow'))>${priorExplorerPreference}&&Number(localStorage.getItem('lanjian-explorer-width'))>${priorExplorerPreference}`, 'sidebar-preference-saved')
    const panePreferences = await evaluate(`JSON.stringify(['lanjian-explorer-width','lanjian-assistant-width'].map(k=>[k,localStorage.getItem(k)]))`)
    await click('[data-testid="writing-agent-input"]')
    window.webContents.sendInputEvent({ type:'mouseMove', x:20, y:20 })
    const rootStyle = await evaluate(`document.documentElement.style.fontSize`)
    const rootSize = await evaluate(`parseFloat(getComputedStyle(document.documentElement).fontSize)`)
    const controlSizeStyle = await evaluate(`document.querySelector('.studio').style.getPropertyValue('--type-control')`)
    let initialPaneWidths: number[] | undefined
    const views = [
      { width:1440, height:900, zoom:1, textScale:1, name:'1440x900' },
      { width:1920, height:1080, zoom:1, textScale:1, name:'1920x1080' },
      { width:1100, height:760, zoom:1, textScale:1, name:'1100x760' },
      { width:1440, height:900, zoom:1.25, textScale:1, name:'1440x900-zoom125' },
      { width:1100, height:760, zoom:1.25, textScale:1, name:'1100x760-zoom125' },
      { width:1440, height:900, zoom:1, textScale:1.125, name:'1440x900-text112' },
      { width:1440, height:900, zoom:1, textScale:1, controlSize:15, name:'1440x900-control15' },
      { width:1440, height:900, zoom:1, textScale:1, name:'1440x900-roundtrip' },
    ]
    for (const view of views) {
      window.webContents.setZoomFactor(view.zoom)
      await evaluate(`document.documentElement.style.fontSize=${JSON.stringify(view.textScale===1?rootStyle:`${rootSize*view.textScale}px`)}`)
      await evaluate(`document.querySelector('.studio').style.setProperty('--type-control',${JSON.stringify(view.controlSize?`${view.controlSize/16}rem`:controlSizeStyle)})`)
      await resize(view.width,view.height)
      await click('[data-testid="writing-agent-input"]')
      await waitFor(`document.activeElement?.dataset.testid==='writing-agent-input'`, 'scaled-composer-native-focus')
      window.webContents.sendInputEvent({ type:'mouseMove', x:20, y:20 })
      const layout = await evaluate(`(()=>{const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,width:r.width,height:r.height,bottom:r.bottom}};const hit=s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();return !!(r&&r.width>0&&r.height>0&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))};return {width:innerWidth,height:innerHeight,rootSize:parseFloat(getComputedStyle(document.documentElement).fontSize),body:rect('.workbench'),tree:rect('.explorer'),assistant:rect('.assistant-panel'),rail:rect('.activitybar'),composer:rect('.agent-composer'),input:rect('[data-testid="writing-agent-input"]'),send:rect('[data-testid="run-writing-agent"]'),newChapter:rect('[data-testid="archive-new-chapter"]'),overflow:document.documentElement.scrollWidth>innerWidth+1,companionInside:!!document.querySelector('.assistant-panel [data-testid="companion-host"]'),sendHit:hit('[data-testid="run-writing-agent"]'),inputHit:hit('[data-testid="writing-agent-input"]'),newChapterHit:hit('[data-testid="archive-new-chapter"]'),toolbar:[...document.querySelectorAll('.writing-toolbar .editor-icon-tool')].map(e=>{const icon=e.querySelector('svg')?.getBoundingClientRect(),label=e.querySelector('.tool-label')?.getBoundingClientRect(),r=e.getBoundingClientRect();return {text:e.textContent,visible:!!label&&label.width>0,width:r.width,labelRight:label?.right,buttonRight:r.right,inline:!!(icon&&label&&label.width>0&&Math.abs(icon.y+icon.height/2-label.y-label.height/2)<3&&label.left>=icon.right-1)}})}})()`)
      layout.view = view
      layout.chapterRows = await evaluate(`[...document.querySelectorAll('.chapter-tree-row')].map(e=>({text:e.textContent.trim(),height:e.getBoundingClientRect().height}))`)
      layout.controlFont = await evaluate(`parseFloat(getComputedStyle(document.querySelector('[data-testid="manuscript-format"]')).fontSize)`)
      layouts.push(layout)
      if (!layout.body || !layout.tree || !layout.assistant || !layout.rail || layout.body.width<420 || layout.tree.right>layout.body.left+1 || layout.body.right>layout.assistant.left+1 || layout.assistant.right>layout.width+1 || layout.overflow || layout.companionInside || !layout.sendHit) throw new Error('approved-reference-workbench-layout:'+JSON.stringify(layout))
      if (!layout.newChapter || !layout.newChapterHit || layout.newChapter.bottom>layout.height+1 || layout.newChapter.left<layout.tree.left-1 || layout.newChapter.right>layout.tree.right+1) throw new Error('approved-reference-new-chapter-unreachable:'+JSON.stringify(layout))
      if (!layout.composer || !layout.input || !layout.inputHit || layout.composer.left<layout.assistant.left-1 || layout.composer.right>layout.assistant.right+1 || layout.input.bottom>layout.composer.bottom+1 || layout.send.bottom>layout.height+1) throw new Error('approved-reference-composer-clipped:'+JSON.stringify(layout))
      if (layout.chapterRows.some((row:{height:number})=>row.height>layout.rootSize*7)) throw new Error('approved-reference-chapter-row-stretched:'+JSON.stringify(layout.chapterRows))
      if (view.controlSize && Math.abs(layout.controlFont-view.controlSize)>.1) throw new Error('approved-reference-control-token-not-inherited:'+JSON.stringify(layout))
      if (layout.toolbar.length!==3 || layout.toolbar.some((tool: {text:string;visible:boolean;width:number})=>tool.visible||tool.text.trim()||tool.width<=0)) throw new Error('approved-reference-toolbar-not-icon-only:'+JSON.stringify(layout.toolbar))
      if (!await evaluate(`[...document.querySelectorAll('.writing-toolbar .editor-icon-tool')].every(e=>e.getAttribute('aria-label')&&e.getAttribute('title')&&e.querySelector('svg'))`)) throw new Error('approved-reference-toolbar-missing-accessible-names')
      await assertPaperRules(view.name)
      if (await evaluate(`JSON.stringify(['lanjian-explorer-width','lanjian-assistant-width'].map(k=>[k,localStorage.getItem(k)]))`) !== panePreferences) throw new Error('approved-reference-responsive-overwrote-pane-preferences')
      const paneWidths = [layout.tree.width, layout.assistant.width]
      if (!initialPaneWidths) initialPaneWidths = paneWidths
      if (view.name.endsWith('roundtrip') && paneWidths.some((width:number,index:number)=>Math.abs(width-initialPaneWidths![index]!)>1)) throw new Error('approved-reference-pane-width-roundtrip:'+JSON.stringify({initialPaneWidths,paneWidths}))
      const avatar = await evaluate(`(()=>{const r=document.querySelector('.archive-companion-portrait')?.getBoundingClientRect();return r?{width:r.width,height:r.height}:null})()`)
      if (!avatar || avatar.width<32 || Math.abs(avatar.width-avatar.height)>2) throw new Error('approved-reference-avatar-crushed:'+JSON.stringify(avatar))
      await capture(`workbench-${view.name}`)
    }
    if (await evaluate('(async()=> (await window.novelDesktop.chapters.get(1)).content)()') !== saved) throw new Error('approved-reference-scale-changed-prose')
    checks.push('1440/1920/1100, native 125% application zoom, 112.5% root text scale and wide roundtrip: four nonoverlapping columns, visible composer/new-chapter targets, accessible icon-only history/find, single-layer centered rules; saved sidebar widths and prose unchanged')
    stage = 'focus'
    await toggleFocus()
    await waitFor(`document.querySelector('.manuscript-editor.is-focus-mode')`, 'focus-entered')
    const focus = await evaluate(`(()=>{const e=document.querySelector('[data-testid="manuscript-input"]'),r=e?.getBoundingClientRect();return {visible:!!r&&r.width>420&&r.height>100,body:e?.textContent}})()`)
    if (!focus.visible || !focus.body.includes('窗外')) throw new Error('approved-reference-focus-blank')
    await assertPaperRules('focus')
    await capture('focus')
    await toggleFocus()
    checks.push('focus displays real prose and exits through the actual control')
    stage = 'library'
    await click('.project-title-return'); await waitFor(`document.querySelector('.project-library')`, 'library')
    for (const view of [{width:1440,height:900,zoom:1},{width:1920,height:1080,zoom:1},{width:1100,height:760,zoom:1},{width:1440,height:900,zoom:1.25}]) {
      window.webContents.setZoomFactor(view.zoom)
      await resize(view.width,view.height)
      await waitFor(`document.querySelector('.archive-companion-puppet .live2d-companion[data-ready="true"] canvas')&&[...document.querySelectorAll('.project-library img')].every(i=>i.complete&&i.naturalWidth>0)`, 'library-media')
      await assertLibraryFrame(`${view.width}x${view.height}-zoom${view.zoom}`)
      if (!await evaluate(`(()=>{const heading=parseFloat(getComputedStyle(document.querySelector('.project-library h1')).fontSize),base=parseFloat(getComputedStyle(document.documentElement).fontSize);return heading>=base*2})()`)) throw new Error('approved-reference-library-heading-overridden')
      await capture(`library-${view.width}x${view.height}${view.zoom>1?'-zoom125':''}`)
      if (view.width!==1920) {
        await click('.work-card-menu-trigger')
        await waitFor(`document.querySelector('.library-card-menu')`, 'library-menu-open')
        const popup = await evaluate(`(()=>{const e=document.querySelector('.library-card-menu'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,actions:[...e.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})}})()`)
        if (popup.left<0 || popup.top<0 || popup.right>popup.width+1 || popup.bottom>popup.height+1 || popup.actions.length!==2 || popup.actions.some((action:{hit:boolean})=>!action.hit) || popup.actions.some((action:{text:string})=>/归档/.test(action.text))) throw new Error('approved-reference-library-menu-obscured:'+JSON.stringify(popup))
        await capture(`library-menu-${view.width}x${view.height}${view.zoom>1?'-zoom125':''}`)
        window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
        window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
        await waitFor(`!document.querySelector('.library-card-menu')&&document.activeElement?.classList.contains('work-card-menu-trigger')`, 'library-menu-dismiss-restores-focus')
      }
    }
    stage = 'library-direct-chapter-open'
    if (await evaluate(`!!document.querySelector('[data-testid="library-project-tree"],[data-testid="library-project-expand"]')`)) throw new Error('approved-reference-obsolete-library-tree-present')
    await click('[data-project-title="烟测书稿"] .work-card-main')
    await waitFor(`document.querySelector('.activitybar')&&document.querySelector('[data-testid="manuscript-editor"]')`, 'library-card-opens-latest-chapter')
    await click('.project-title-return'); await waitFor(`document.querySelector('.project-library')`, 'library-return-after-card-open')
    checks.push('library at 1440/1920/1100 and 125% application zoom fits heading, hero, sorting controls and all-work cards in one screen; the illustration remains below the toolbar; metadata and two-action menu remain reachable; a card opens its latest chapter directly with no archive state or directory expansion')
    stage = 'loading-themes'
    window.webContents.setZoomFactor(1)
    await resize(1440,900)
    await click('.project-library [data-activity="settings"]')
    await waitFor(`document.querySelector('.local-appearance-dialog[open] [data-testid="loader-preferences"]')`, 'loader-settings')
    for (const theme of ['standard','impact']) {
      await click(`[data-testid="loader-theme-${theme}"]`)
      await waitFor(`JSON.parse(localStorage.getItem('lanjian-loading-v1'))?.theme===${JSON.stringify(theme)}&&document.querySelector('[data-testid="loader-theme-${theme}"]')?.getAttribute('aria-pressed')==='true'`, 'theme-persisted')
      for (const mode of ['boot','work']) {
        await click(`[data-testid="loader-preview-${mode}"]`)
        await waitFor(`document.querySelector('[data-testid="loader-preview-dialog"][open] [data-loader-theme="${theme}"]')`, 'real-loader-preview')
        if (!await evaluate(`document.querySelector('[data-testid="loader-preview-dialog"]')?.textContent.includes('非真实载入')`)) throw new Error('approved-reference-unlabelled-preview')
        if (mode==='boot') {
          const visibleBrand = await evaluate(`(()=>{const rgb=s=>getComputedStyle(document.querySelector(s)).color.match(/[\\d.]+/g).slice(0,3).map(Number);return {mark:rgb('.app-boot .brand-archive-mark'),latin:rgb('.app-boot .brand-latin')}})()`)
          if (Math.max(...visibleBrand.mark)<160 || Math.max(...visibleBrand.latin)<160) throw new Error('approved-reference-boot-brand-invisible')
          if (!await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`)) {
            const moving = await evaluate(`(async()=>{const a=document.querySelector('[data-testid="app-boot"]').getAnimations({subtree:true}).filter(a=>a.playState==='running'),times=a.map(a=>Number(a.currentTime));await new Promise(r=>setTimeout(r,180));return a.some((v,i)=>Number(v.currentTime)>times[i]+50)})()`)
            if (!moving) throw new Error('approved-reference-boot-animation-not-running')
          }
        }
        for (const [width,height] of [[1440,900],[1100,760]]) {
          await resize(width!,height!)
          await assertLoaderFrame(theme,mode)
          await capture(`${theme}-${mode}-${width}x${height}`)
        }
        await click(`[data-testid="${mode==='boot'?'app-boot-skip':'cancel-workspace-loading'}"]`)
        await waitFor(`!document.querySelector('[data-testid="loader-preview-dialog"][open]')&&document.activeElement?.dataset.testid==='loader-preview-${mode}'`, 'preview-close-restores-focus')
      }
    }
    if (await evaluate(`!!document.querySelector('[data-testid="loader-reduced-motion"]')`)) throw new Error('approved-reference-obsolete-motion-setting-visible')
    await capture('loading-theme-settings')
    await click('.local-appearance-dialog [aria-label="关闭外观设置"]')
    checks.push('both saved loader themes render real boot/work previews wide/compact edge-to-edge with no root/internal scrollbars; native close stays in viewport and restores focus; the obsolete manual motion setting is absent')
    stage = 'reload-persistence'
    await new Promise<void>((resolve,reject)=>{
      const done=()=>{clearTimeout(timer);resolve()}
      const timer=setTimeout(()=>{window.webContents.removeListener('did-finish-load',done);reject(new Error('approved-reference-reload-timeout'))},20000)
      window.webContents.once('did-finish-load',done);window.webContents.reload()
    })
    // Reload may replace the native renderer surface. Reacquire the visible
    // isolated test window before requiring compositor frames; never touch an author window.
    window.show(); window.focus(); window.webContents.focus()
    window.webContents.setBackgroundThrottling(false)
    await waitFor(`document.visibilityState==='visible'`, 'reloaded-window-visible')
    await waitFor(`window.novelDesktop&&document.querySelector('.project-library')`, 'reloaded-library')
    if (await evaluate(`!!document.querySelector('[data-testid="app-boot-skip"]')`)) await click('[data-testid="app-boot-skip"]')
    await settled()
    await click('.project-library [data-activity="settings"]')
    await waitFor(`document.querySelector('[data-testid="loader-theme-impact"]')?.getAttribute('aria-pressed')==='true'&&!document.querySelector('[data-testid="loader-reduced-motion"]')`, 'reloaded-settings-acknowledged')
    await capture('loading-theme-reloaded')
    await click('.local-appearance-dialog [aria-label="关闭外观设置"]')
    await click('[data-testid="library-continue-writing"]')
    await waitFor(`document.querySelector('.activitybar')`, 'reopened-workspace')
    await settled()
    if (await evaluate('(async()=> (await window.novelDesktop.chapters.get(1)).content)()') !== saved) throw new Error('approved-reference-preview-reload-changed-prose')
    checks.push('impact theme survives renderer reload and normal book reopen preserves exact saved prose')
    stage = 'finished'
    const result = { ok:true, checks, screenshots, layouts, note:'Real Electron isolated fixture; no author data or configured API called.' }
    await writeFile(join(output,'verification.json'), JSON.stringify(result,null,2)); return result
  } catch (error) {
    await capture('failure').catch(()=>{})
    const result = { ok:false, stage, checks, screenshots, layouts, error:error instanceof Error?error.message:String(error) }
    await writeFile(join(output,'failure.json'), JSON.stringify(result,null,2)); return result
  } finally { window.webContents.setBackgroundThrottling(originalThrottle); window.webContents.setZoomFactor(originalZoom) }
}
