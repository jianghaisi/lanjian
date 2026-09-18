import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BrowserWindow } from 'electron'

// The caller opens only the existing isolated smoke book, never an author's book.
export async function runWorkspaceDesignSmoke(window: BrowserWindow, capturePath: string) {
  const prefix = process.env.LANJIAN_SMOKE_DESIGN_BASELINE === '1' ? 'workspace-before' : 'workspace-after'
  if (process.env.LANJIAN_SMOKE_WORKSPACE_LOADING_ONLY === '1') {
    const openFromLibrary = async () => window.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      document.querySelector('[data-activity="library"]')?.click();
      for(let i=0;i<100&&!document.querySelector('.work-item-open');i++)await wait(50);
      await wait(600);
      const open=document.querySelector('.work-item-open');
      if(!open)throw new Error('Library project did not appear');
      open.click();
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const firstPaint=document.querySelector('[data-testid="workspace-loading"]');
      if(!firstPaint)throw new Error('Workspace loading screen was not mounted on the first paint after selection');
      const firstRect=firstPaint.getBoundingClientRect(),firstStyle=getComputedStyle(firstPaint);
      const firstHitElement=document.elementFromPoint(innerWidth/2,innerHeight/2),writingUiAbove=Boolean(firstHitElement?.closest('.app-frame'))&&!firstPaint.contains(firstHitElement);
      if(firstStyle.opacity!=='1'||firstStyle.visibility!=='visible'||firstRect.width<innerWidth-1||firstRect.height<innerHeight-1||writingUiAbove)throw new Error('Workspace loading screen did not cover the writing UI on first paint: '+JSON.stringify({opacity:firstStyle.opacity,visibility:firstStyle.visibility,width:firstRect.width,height:firstRect.height,innerWidth,innerHeight,hit:firstHitElement?.className||firstHitElement?.tagName,writingUiAbove}));
      const phaseStarted=performance.now(),phaseLog=[];
      const recordPhase=()=>{const phase=firstPaint.dataset.loadingPhase;if(phase&&phaseLog.at(-1)?.phase!==phase)phaseLog.push({phase,at:Math.round(performance.now()-phaseStarted)});};
      recordPhase();
      const phaseObserver=new MutationObserver(recordPhase);
      phaseObserver.observe(firstPaint,{attributes:true,attributeFilter:['data-loading-phase']});
      window.__workspaceLoadingPhaseLog=phaseLog;
      window.__workspaceLoadingPhaseObserver=phaseObserver;
      for(let i=0;i<100&&!document.querySelector('[data-testid="workspace-loading"]');i++)await wait(25);
      if(!document.querySelector('[data-testid="workspace-loading"]'))throw new Error('Workspace loading screen did not appear');
      return true;
    })()`)

    await openFromLibrary()
    await new Promise(resolve => setTimeout(resolve, 700))
    const initial = await window.webContents.executeJavaScript(`(()=>{
      const screen=document.querySelector('[data-testid="workspace-loading"]');
      const active=screen?.querySelector('li.active');
      return {visible:Boolean(screen),title:screen?.querySelector('h1')?.textContent?.trim(),active:active?.textContent?.replace(/\\s+/g,' ').trim(),slow:Boolean(screen?.querySelector('[data-testid="cancel-workspace-loading"]'))};
    })()`)
    if (!initial.visible || !initial.title || !initial.active) throw new Error('Initial loading state is not truthful: ' + JSON.stringify(initial))
    await writeFile(join(dirname(capturePath), 'workspace-loading-active.png'), (await window.capturePage()).toPNG())
    await new Promise(resolve => setTimeout(resolve, 3500))
    const slow = await window.webContents.executeJavaScript(`(()=>{const screen=document.querySelector('[data-testid="workspace-loading"]'),button=document.querySelector('[data-testid="cancel-workspace-loading"]');window.__workspaceLoadingPhaseObserver?.disconnect();return {visible:Boolean(screen),button:Boolean(button),message:button?.closest('section')?.textContent?.replace(/\\s+/g,' ').trim(),completed:!screen&&Boolean(document.querySelector('.workbench')),phases:window.__workspaceLoadingPhaseLog||[]};})()`)
    const phaseOrder = ['switch', 'database', 'workspace', 'chapter', 'recovery', 'ready']
    for (let index = 1; index < slow.phases.length; index += 1) {
      const previous = phaseOrder.indexOf(slow.phases[index - 1].phase)
      const current = phaseOrder.indexOf(slow.phases[index].phase)
      if (current - previous > 1) throw new Error('Workspace loading skipped a painted phase: ' + JSON.stringify(slow.phases))
    }
    const workspacePhase = slow.phases.find((entry: { phase: string }) => entry.phase === 'workspace')
    const chapterPhase = slow.phases.find((entry: { phase: string }) => entry.phase === 'chapter')
    if (workspacePhase && chapterPhase && chapterPhase.at - workspacePhase.at < 300) throw new Error('Workspace phase was not visibly held before chapter: ' + JSON.stringify(slow.phases))
    if (!slow.visible) {
      if (!slow.completed) throw new Error('Workspace loading disappeared without opening the workbench: ' + JSON.stringify(slow))
      return { ok: true, initial, completed: true }
    }
    if (!slow.button || !slow.message?.includes('载入时间比平时长')) throw new Error('Slow loading escape was not available: ' + JSON.stringify(slow))
    await writeFile(join(dirname(capturePath), 'workspace-loading-slow.png'), (await window.capturePage()).toPNG())
    await window.webContents.executeJavaScript(`document.querySelector('[data-testid="cancel-workspace-loading"]')?.click()`)
    await new Promise(resolve => setTimeout(resolve, 900))
    const cancelled = await window.webContents.executeJavaScript(`Boolean(document.querySelector('.project-library'))&&!document.querySelector('[data-testid="workspace-loading"]')&&!document.querySelector('.workbench')`)
    if (!cancelled) throw new Error('Cancelling workspace loading did not return to the library')
    return { ok: true, initial, slow, cancelled }
  }
  await window.webContents.executeJavaScript(`(async()=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    localStorage.setItem('lanjian-opening-enabled','false');
    sessionStorage.setItem('lanjian-opening-seen','true');
    document.querySelector('[data-testid="app-boot-skip"]')?.click();
    await wait(120);
    if(document.querySelector('.workbench'))return true;
    document.querySelector('[data-activity="library"]')?.click();
    for(let i=0;i<100&&!document.querySelector('.work-item-open');i++)await wait(50);
    const open=Array.from(document.querySelectorAll('.work-item-open')).find(button=>button.getAttribute('aria-label')?.includes('烟测书稿'))||document.querySelector('.work-item-open');
    if(!open)throw new Error('Workspace design fixture did not appear');
    open.click();
    for(let i=0;i<200;i++){
      const loading=document.querySelector('[data-testid="workspace-loading"]');
      const workbench=document.querySelector('.workbench');
      if(!loading&&workbench&&workbench.getBoundingClientRect().width>0)return true;
      await wait(50);
    }
    throw new Error('Workspace design fixture did not finish opening');
  })()`)
  if (process.env.LANJIAN_SMOKE_FIELD_WORKSPACE_ONLY === '1') {
    const { runDefinitionFormConsistencySmoke } = await import('./definition-form-consistency-smoke')
    return runDefinitionFormConsistencySmoke(window, capturePath)
  }
  const pages = [
    ['profile', '', 'profile', 'profile'],
    ['materials', '', 'research', 'ideas'],
    ['world', 'world', 'world', 'world'],
    ['preparation', 'preparation', 'preparation', 'preparation'],
    ['timeline', 'event-timeline', 'timeline', 'timeline'],
    ['planning', 'volume-outline', 'outline', 'outline'],
    ['desk', '', 'desk', 'desk'],
    ['settings', '', 'settings', 'settings']
  ]
  const measurements: unknown[] = []
  const capture = async (name: string) => {
    // A resize/zoom can have current DOM bounds while the compositor still holds
    // the preceding frame. Wait for paint before treating a capture as evidence.
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve(true), 700);
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); resolve(true); }));
    })`)
    await writeFile(join(dirname(capturePath), `${prefix}-${name}.png`), (await window.capturePage()).toPNG())
  }
  for (const compact of [false, true]) {
    window.setSize(compact ? 1100 : 1440, compact ? 760 : 900)
    window.webContents.setZoomFactor(compact ? 1.25 : 1)
    for (const [primary, leaf, page, captureName] of pages) {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const visible = e => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
        const click = async selector => {
          const el = Array.from(document.querySelectorAll(selector)).find(visible);
          if (!el) throw new Error('Missing navigation: ' + selector);
          el.click(); await wait(250);
        };
        await click(${JSON.stringify(`[data-activity="${primary}"]`)});
        if (${JSON.stringify(leaf)}) await click(${JSON.stringify(`.section-navigation [data-nav-leaf="${leaf}"]`)});
        for (let i = 0; i < 60 && !document.querySelector(${JSON.stringify(`.studio[data-page="${page}"]`)}); i++) await wait(100);
        if (!document.querySelector(${JSON.stringify(`.studio[data-page="${page}"]`)})) throw new Error('Page did not open: ${primary}/${leaf}/${page}; actual=' + document.querySelector('.studio')?.dataset.page + '; toast=' + document.querySelector('.toast')?.textContent);
        await wait(250);
        const panel = document.querySelector('.workbench');
        if (!visible(panel)) throw new Error('Workbench is hidden');
        const rect = el => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
        const overflow = Array.from(panel.querySelectorAll('*')).filter(e => visible(e) && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 4 && !['auto','scroll'].includes(getComputedStyle(e).overflowX)).slice(0,12).map(e=>({element:e.tagName+'.'+String(e.className).split(' ').slice(0,2).join('.'),width:e.clientWidth,scrollWidth:e.scrollWidth}));
        const toolbar = document.querySelector('.outline-writing-toolbar');
        const clippedActions = toolbar ? Array.from(toolbar.querySelectorAll('.outline-toolbar-actions button')).filter(e => visible(e) && e.getBoundingClientRect().bottom > toolbar.getBoundingClientRect().bottom + 1).length : 0;
        const collapsedLabels = Array.from(document.querySelectorAll('.activitybar > button span')).every(e => !e.checkVisibility() || Number.parseFloat(getComputedStyle(e).opacity) === 0);
        const railIcons = Array.from(document.querySelectorAll('.activitybar > button svg')).every(visible);
        const activitybar = document.querySelector('.activitybar');
        const activityButtons = Array.from(document.querySelectorAll('.activitybar > button'));
        const mainButtons = activityButtons.filter(e => !e.classList.contains('utility-activity'));
        const utilityButtons = activityButtons.filter(e => e.classList.contains('utility-activity'));
        const expectedSequences = mainButtons.map((_, index) => String(index + 1).padStart(2, '0'));
        const actualSequences = mainButtons.map(e => e.dataset.sequence);
        const selectedActivity = activityButtons.find(e => e.classList.contains('selected'));
        const railColor = getComputedStyle(activitybar).backgroundColor;
        const workbenchColor = getComputedStyle(panel).backgroundColor;
        const chromeDarkToken = getComputedStyle(activitybar).getPropertyValue('--chrome-dark').trim();
        const titleRect = document.querySelector('.project-title-return')?.getBoundingClientRect();
        const industrialChrome = {
          darkRail: Boolean(chromeDarkToken) && railColor !== 'transparent' && railColor !== workbenchColor,
          sequences: JSON.stringify(actualSequences) === JSON.stringify(expectedSequences),
          utilitySequence: utilityButtons.length > 0 && utilityButtons.every(e => e.dataset.sequence === 'SYS'),
          selectedState: Boolean(selectedActivity?.getAttribute('aria-current')),
          compactRail: collapsedLabels && railIcons,
          titleCentered: Math.abs((titleRect?.x || 0) + (titleRect?.width || 0) / 2 - innerWidth / 2) < 8,
          titleGeometry: JSON.stringify({ left:titleRect?.left, width:titleRect?.width, viewport:innerWidth })
        };
        const shell = document.querySelector('.studio');
        const issueGroup = document.querySelector('[data-testid="workspace-bootstrap-issues"]');
        const bootstrapIssuesCompact = Boolean(issueGroup && !issueGroup.open && issueGroup.getBoundingClientRect().height <= 70);
        return {page:${JSON.stringify(page)},compact:${compact},viewport:{width:innerWidth,height:innerHeight},workbench:rect(panel),explorer:rect(document.querySelector('.explorer')),assistant:visible(document.querySelector('.assistant-panel'))?rect(document.querySelector('.assistant-panel')):null,overflow,clippedActions,collapsedLabels,railIcons,industrialChrome,bootstrapIssuesCompact,activityWidth:getComputedStyle(shell).getPropertyValue('--activity-width').trim()};
      })()`)
      measurements.push(result)
      await capture(`${captureName}${compact ? '-compact' : ''}`)
      if (!compact && page === 'profile') {
        const logoRect = await window.webContents.executeJavaScript(`(()=>{const r=document.querySelector('.titlebar .brand-logo').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)};})()`)
        await writeFile(join(dirname(capturePath), 'workspace-brand-logo.png'), (await window.capturePage(logoRect)).toPNG())
      }
      if (prefix === 'workspace-after' && (result.clippedActions || !result.collapsedLabels || !result.railIcons)) throw new Error(`Clipped controls or invalid compact navigation: ${page}`)
      if (prefix === 'workspace-after' && Object.values(result.industrialChrome).some((value) => !value)) throw new Error(`Industrial authoring chrome regressed: ${page} ${JSON.stringify(result.industrialChrome)}`)
      if (prefix === 'workspace-after' && !result.bootstrapIssuesCompact) throw new Error(`Bootstrap issues displaced the page directory: ${page}`)
      if (page === 'desk') {
        window.webContents.sendInputEvent({ type:'mouseMove', x:500, y:100, movementX:1, movementY:1 })
        await new Promise(resolve => setTimeout(resolve, 160))
        const docked = await window.webContents.executeJavaScript(`(async () => {
          const wait = ms => new Promise(r=>setTimeout(r,ms));
          const toggle = document.querySelector('.title-actions .assistant-toggle');
          const studio = document.querySelector('.studio');
          const originalExplorerPreference = getComputedStyle(studio).getPropertyValue('--explorer-width').trim();
          let responsiveDirectoryWidth = null;
          if (${compact} && toggle?.getAttribute('aria-expanded') === 'true') { toggle.click(); await wait(250); }
          if (${compact} && studio) {
            studio.style.setProperty('--explorer-width', '420px');
            await wait(80);
            responsiveDirectoryWidth = document.querySelector('.explorer')?.getBoundingClientRect().width || 0;
            studio.style.setProperty('--explorer-width', originalExplorerPreference || '248px');
            await wait(80);
          }
          if (toggle?.getAttribute('aria-expanded') !== 'true') toggle?.click();
          await wait(400);
          const box = selector => document.querySelector(selector)?.getBoundingClientRect();
          const editor = box('.workbench'), assistant = box('.assistant-panel'), explorer = box('.explorer');
          const input = box('.agent-composer textarea'), paper = box('.manuscript-page .cm-scroller');
          const toolbar = box('.writing-toolbar');
          const controlsVisible = Array.from(document.querySelectorAll('.writing-toolbar button')).filter(e=>e.checkVisibility()).every(e=>{const r=e.getBoundingClientRect();return r.bottom<=toolbar.bottom+1&&r.left>=editor.left&&r.right<=editor.right+1;});
          const selectedPosition = Number(document.querySelector('.manuscript-chapter-label')?.textContent.match(/\\d+/)?.[0] || 1);
          const selectedChapter = (await window.novelDesktop.chapters.list()).find(chapter => chapter.position === selectedPosition);
          window.__designChapterId = selectedChapter?.id;
          const before = await window.novelDesktop.chapters.get(window.__designChapterId);
          window.__designBeforeBody = before;
          const hit = e => { if(!e)return false; const r=e.getBoundingClientRect(); const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return r.width>0&&r.height>0&&Boolean(target&&(target===e||e.contains(target))); };
          const titleLabels = Array.from(document.querySelectorAll('.title-actions .labeled-title-action')).every(e=>e.querySelector('span')?.textContent?.trim()&&hit(e));
          const composerControls = Array.from(document.querySelectorAll('.agent-composer-toolbar button'));
          const composerUsable = composerControls.length>=4&&composerControls.every(hit);
          const assistantHeaderUsable = Array.from(document.querySelectorAll('.assistant-panel > header button')).every(hit);
          const writingRoom = editor.width >= 419;
          const widths = { viewport: innerWidth, explorer: explorer.width, assistant: assistant.width, explorerPreference: localStorage.getItem('lanjian-explorer-width'), assistantPreference: localStorage.getItem('lanjian-assistant-width') };
          if (!${compact}) window.__designWidePaneWidths = widths;
          const resizerAligned = (selector, edge) => { const r=box(selector); return r && Math.abs(r.x+r.width/2-edge)<2; };
          const resizersAligned = resizerAligned('.explorer-resizer', explorer.right) && resizerAligned('.assistant-resizer', assistant.left);
          const explorerResizer = document.querySelector('.explorer-resizer');
          const resizerCueVisible = Boolean(explorerResizer && getComputedStyle(explorerResizer, '::before').backgroundColor !== 'rgba(0, 0, 0, 0)' && Number.parseFloat(getComputedStyle(explorerResizer, '::after').opacity) > 0);
          const responsiveDirectoryRespectsPreference = !${compact} || Boolean(responsiveDirectoryWidth && responsiveDirectoryWidth > 220);
          const chapterLabel = document.querySelector('.manuscript-chapter-label');
          const compactChapterLabel = Boolean(chapterLabel&&parseFloat(getComputedStyle(chapterLabel).fontSize)<=18);
          const currentChapterRow = document.querySelector('.chapter-tree-row[aria-current="page"]');
          const currentChapterUsesSelectionOnly = Boolean(currentChapterRow?.classList.contains('selected')&&!currentChapterRow.querySelector('.chapter-current-mark'));
          const save = document.querySelector('[data-testid="save-manuscript"]');
          const saveHit = hit(save);
          const history = document.querySelector('[data-testid="open-manuscript-history"]');
          const historyHit = hit(history);
          const leftAlignedTools = getComputedStyle(document.querySelector('.writing-tool-group')).justifyContent === 'flex-start';
          const actionPersistence = Boolean(saveHit&&historyHit&&document.querySelectorAll('[data-testid="save-manuscript"]').length===1);
          const status = document.querySelector('[data-testid="manuscript-save-state"]');
          const compactToolbar = !${compact} || toolbar.height <= 132;
          const saveStatusAvailable = Boolean(status?.textContent?.trim());
          const search = document.querySelector('[data-testid="chapter-tree-search"]');
          const firstChapter = document.querySelector('.chapter-tree-row');
          const newChapter = document.querySelector('[data-testid="archive-new-chapter"]');
          const searchFirst = Boolean(search&&document.querySelectorAll('[data-testid="chapter-tree-search"]').length===1&&(!firstChapter||search.getBoundingClientRect().bottom<=firstChapter.getBoundingClientRect().top+1)&&hit(search));
          const compactChapterAction = Boolean(newChapter&&hit(newChapter)&&newChapter.getBoundingClientRect().height<=44&&!document.querySelector('[data-testid="import-manuscript-files"]'));
          const projectTitle = document.querySelector('.project-title-return');
          const projectTitleRect = projectTitle?.getBoundingClientRect();
          const simplifiedChrome = Boolean(projectTitle&&hit(projectTitle)&&Math.abs(projectTitleRect.left+projectTitleRect.width/2-innerWidth/2)<8&&!document.querySelector('.workspace-parent-heading')&&!Array.from(document.querySelectorAll('.title-actions button')).some(button=>button.textContent.includes('写作任务')));
          const rail = document.querySelector('.activitybar');
          const railButton = rail?.querySelector('button');
          const railLabel = railButton?.querySelector('span');
          const railIcon = railButton?.querySelector('svg');
          const collapsedRailWidth = rail?.getBoundingClientRect().width||0;
          const collapsedRailClip = getComputedStyle(rail).clipPath;
          const collapsedIconRect = railIcon?.getBoundingClientRect();
          const collapsedExplorerLeft = explorer.left;
          railButton?.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));railButton?.focus(); await wait(220);
          const expandedRailWidth = rail?.getBoundingClientRect().width||0;
          const expandedRailClip = getComputedStyle(rail).clipPath;
          const expandedIconRect = railIcon?.getBoundingClientRect();
          const expandedExplorerLeft = document.querySelector('.explorer')?.getBoundingClientRect().left||0;
          const expandedLabelVisible = Boolean(railLabel?.checkVisibility()&&Number.parseFloat(getComputedStyle(railLabel).opacity)>.9);
          search?.focus(); await wait(220);
          const restoredRailWidth = rail?.getBoundingClientRect().width||0;
          const restoredRailClip = getComputedStyle(rail).clipPath;
          const restoredIconRect = railIcon?.getBoundingClientRect();
          const restoredExplorerLeft = document.querySelector('.explorer')?.getBoundingClientRect().left||0;
          const stableIcon = Boolean(collapsedIconRect&&expandedIconRect&&restoredIconRect&&Math.abs(collapsedIconRect.left-expandedIconRect.left)<.5&&Math.abs(collapsedIconRect.left-restoredIconRect.left)<.5&&Math.abs(collapsedIconRect.width-24)<.5&&Math.abs(expandedIconRect.width-24)<.5);
          const stableWorkspace = Math.abs(expandedRailWidth-collapsedRailWidth)<.5&&Math.abs(restoredRailWidth-collapsedRailWidth)<.5&&Math.abs(expandedExplorerLeft-collapsedExplorerLeft)<.5&&Math.abs(restoredExplorerLeft-collapsedExplorerLeft)<.5;
          const railFocusExpansion = stableIcon&&stableWorkspace&&expandedLabelVisible&&expandedRailClip!==collapsedRailClip&&restoredRailClip===collapsedRailClip;
          const savedSearch = search.value;
          search.value = '待删旧章'; search.dispatchEvent(new Event('input',{bubbles:true})); await wait(100);
          const filteredRows = [...document.querySelectorAll('.chapter-tree-row')];
          const fullCatalogSearch = filteredRows.length===1&&filteredRows[0].textContent.includes('待删旧章');
          search.value = savedSearch; search.dispatchEvent(new Event('input',{bubbles:true})); await wait(100);
          const trashButton=document.querySelector('[data-testid="open-chapter-trash"]');
          const rowDelete=document.querySelector('.chapter-row-delete');
          trashButton?.click();await wait(100);
          const trashSurface=document.querySelector('[data-testid="chapter-trash-list"]');
          const trashBack=document.querySelector('[data-testid="close-chapter-trash"]');
          const chapterTrashAvailable=Boolean(trashButton&&rowDelete&&trashSurface&&trashBack&&trashSurface.textContent.includes('回收站是空的'));
          trashBack?.click();await wait(100);
          document.querySelector('[data-testid="manuscript-layout"]')?.click(); await wait(100);
          const layoutTrigger=document.querySelector('[data-testid="manuscript-layout"]');
          const layoutPanel=document.querySelector('.writing-layout-popover');
          const layoutTriggerRect=layoutTrigger?.getBoundingClientRect();
          const layoutPanelRect=layoutPanel?.getBoundingClientRect();
          const layoutPanelAnchored=Boolean(layoutTriggerRect&&layoutPanelRect&&layoutPanelRect.top>=layoutTriggerRect.bottom&&layoutPanelRect.top-layoutTriggerRect.bottom<=12&&layoutTriggerRect.left<layoutPanelRect.right&&layoutTriggerRect.right>layoutPanelRect.left);
          const ranges=[...document.querySelectorAll('.writing-layout-popover input[type="range"]')];
          if(ranges.length>=2){ranges[0].value='1.15';ranges[0].dispatchEvent(new Event('input',{bubbles:true}));ranges[1].value='2.2';ranges[1].dispatchEvent(new Event('input',{bubbles:true}));}
          [...document.querySelectorAll('.line-choice button')].find(button=>button.textContent.includes('虚线'))?.click(); await wait(120);
          const renderedLine=getComputedStyle(document.querySelector('.manuscript .cm-line'));
          const renderedRules=getComputedStyle(document.querySelector('.manuscript .cm-content')).backgroundImage;
          const layoutControlsWork=Math.abs(parseFloat(renderedLine.fontSize)-18.4)<.2&&Math.abs(parseFloat(renderedLine.lineHeight)-40.48)<.3&&document.querySelector('.manuscript-editor')?.dataset.guideStyle==='dashed'&&renderedRules.split('repeating-linear-gradient').length>=3;
          document.querySelector('.writing-layout-popover > header button')?.click();
          const petTools=document.querySelector('[data-testid="external-companion"]');
          petTools?.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2})); await wait(80);
          const petMenu=document.querySelector('[data-testid="desktop-pet-tools-menu"]');
          const petButtons=[...document.querySelectorAll('[data-testid="desktop-pet-tools-menu"] button')];
          const petMenuRect=petMenu?.getBoundingClientRect();
          const petButtonMetrics=petButtons.map(button=>{const rect=button.getBoundingClientRect();const style=getComputedStyle(button);return {width:rect.width,height:rect.height,writingMode:style.writingMode,color:style.color,backgroundColor:style.backgroundColor,hit:hit(button)};});
          const petMenuUsable=Boolean(petMenu&&!document.querySelector('.archive-pet-menu-toggle')&&petMenu.getBoundingClientRect().width>=180&&petButtons.length===3&&petButtons.every(button=>{const rect=button.getBoundingClientRect();const style=getComputedStyle(button);return hit(button)&&rect.width>=180&&rect.height>=36&&rect.width>rect.height*3&&style.writingMode==='horizontal-tb'&&style.color!==style.backgroundColor;}));
          petTools?.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));
          return {page:'desk-docked',compact:${compact},ok:Boolean(editor&&assistant&&explorer&&input&&paper&&explorer.right<=editor.left+1&&editor.right<=assistant.left+1&&assistant.right<=innerWidth+1&&input.bottom<=innerHeight&&paper.height>=100&&controlsVisible&&titleLabels&&composerUsable&&assistantHeaderUsable&&writingRoom&&resizersAligned&&resizerCueVisible&&responsiveDirectoryRespectsPreference&&compactChapterLabel&&currentChapterUsesSelectionOnly&&actionPersistence&&leftAlignedTools&&searchFirst&&compactChapterAction&&simplifiedChrome&&railFocusExpansion&&fullCatalogSearch&&chapterTrashAvailable&&layoutControlsWork&&layoutPanelAnchored&&compactToolbar&&saveStatusAvailable&&petMenuUsable),editorWidth:editor?.width,paperHeight:paper?.height,toolbarHeight:toolbar?.height,controlsVisible,titleLabels,composerUsable,assistantHeaderUsable,writingRoom,resizersAligned,resizerCueVisible,responsiveDirectoryWidth,responsiveDirectoryRespectsPreference,compactChapterLabel,currentChapterUsesSelectionOnly,actionPersistence,leftAlignedTools,saveHit,historyHit,searchFirst,compactChapterAction,simplifiedChrome,collapsedRailWidth,expandedRailWidth,restoredRailWidth,collapsedRailClip,expandedRailClip,restoredRailClip,stableIcon,stableWorkspace,expandedLabelVisible,railFocusExpansion,fullCatalogSearch,chapterTrashAvailable,layoutControlsWork,layoutPanelAnchored,renderedFont:renderedLine.fontSize,renderedLineHeight:renderedLine.lineHeight,renderedRules,compactToolbar,saveStatusAvailable,petMenuUsable,petMenuRect:petMenuRect&&{width:petMenuRect.width,height:petMenuRect.height,left:petMenuRect.left,right:petMenuRect.right},petButtonMetrics};
        })()`)
        measurements.push(docked)
        await window.webContents.executeJavaScript(`(async()=>{const button=document.querySelector('.activitybar button');button?.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));button?.focus();await new Promise(r=>setTimeout(r,220));})()`)
        await capture(`desk-rail-expanded${compact ? '-compact' : ''}`)
        await window.webContents.executeJavaScript(`(async()=>{document.querySelector('[data-testid="chapter-tree-search"]')?.focus();await new Promise(r=>setTimeout(r,220));})()`)
        await capture(`desk-docked${compact ? '-compact' : ''}`)
        const railPointerTargets = await window.webContents.executeJavaScript(`(()=>{const button=document.querySelector('.activitybar button[aria-current]'),icon=button?.querySelector('svg'),workbench=document.querySelector('.workbench');const a=icon?.getBoundingClientRect(),b=workbench?.getBoundingClientRect();return a&&b?{inside:{x:a.x+a.width/2,y:a.y+a.height/2},outside:{x:b.x+Math.min(80,b.width/2),y:b.y+80}}:null})()`)
        if (!railPointerTargets) throw new Error('Rail pointer targets unavailable')
        const hoverPoint = (value: { x: number; y: number }) => ({ x: Math.round(value.x), y: Math.round(value.y) })
        const zoom = window.webContents.getZoomFactor()
        const clickPoint = (value: { x: number; y: number }) => ({ x: Math.round(value.x * zoom), y: Math.round(value.y * zoom) })
        window.webContents.sendInputEvent({ type:'mouseMove', ...hoverPoint(railPointerTargets.inside), movementX:1, movementY:1 })
        await new Promise(resolve => setTimeout(resolve, 220))
        const pointerExpandedClip = await window.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.activitybar')).clipPath`)
        window.webContents.sendInputEvent({ type:'mouseDown', ...clickPoint(railPointerTargets.inside), button:'left', clickCount:1 })
        window.webContents.sendInputEvent({ type:'mouseUp', ...clickPoint(railPointerTargets.inside), button:'left', clickCount:1 })
        window.webContents.sendInputEvent({ type:'mouseMove', ...hoverPoint(railPointerTargets.outside), movementX:1, movementY:1 })
        await new Promise(resolve => setTimeout(resolve, 180))
        const pointerRetraction = await window.webContents.executeJavaScript(`(()=>{const rail=document.querySelector('.activitybar'),button=rail.querySelector('button[aria-current]');return {clip:getComputedStyle(rail).clipPath,buttonFocused:document.activeElement===button,labelOpacity:getComputedStyle(button.querySelector('span')).opacity}})()`)
        const pointerRailRetracts = pointerExpandedClip === 'inset(0px)' && pointerRetraction.clip !== pointerExpandedClip && pointerRetraction.buttonFocused && Number.parseFloat(pointerRetraction.labelOpacity) < .1
        measurements.push({ page:'desk-pointer-retraction', compact, ok:pointerRailRetracts, pointerExpandedClip, ...pointerRetraction })
        if (!pointerRailRetracts) throw new Error('Pointer click pinned the rail open: ' + JSON.stringify({ pointerExpandedClip, pointerRetraction }))
        await window.webContents.executeJavaScript(`(async()=>{document.querySelector('[data-testid="manuscript-layout"]')?.click();await new Promise(r=>setTimeout(r,120));})()`)
        await capture(`desk-layout-anchored${compact ? '-compact' : ''}`)
        await window.webContents.executeJavaScript(`document.querySelector('.writing-layout-popover > header button')?.click()`)
        if (!docked.ok) throw new Error('Docked assistant/editor geometry failed: ' + JSON.stringify(docked))
        if (compact) {
          window.setSize(1440, 900)
          // Let the native resize settle before resetting Chromium zoom; on
          // Windows applying both in one tick can leave the capture scaled.
          await new Promise(resolve => setTimeout(resolve, 350))
          window.webContents.setZoomFactor(1)
          await new Promise(resolve => setTimeout(resolve, 350))
          const restored = await window.webContents.executeJavaScript(`(()=>{
            const before = window.__designWidePaneWidths;
            return {page:'desk-width-roundtrip',viewport:innerWidth,originalViewport:before?.viewport,ok:Boolean(before&&Math.abs(innerWidth-before.viewport)<1&&Math.abs(document.querySelector('.explorer').getBoundingClientRect().width-before.explorer)<1&&Math.abs(document.querySelector('.assistant-panel').getBoundingClientRect().width-before.assistant)<1&&localStorage.getItem('lanjian-explorer-width')===before.explorerPreference&&localStorage.getItem('lanjian-assistant-width')===before.assistantPreference)};
          })()`)
          measurements.push(restored)
          await capture('desk-width-restored')
          if (!restored.ok) throw new Error('Window resize did not restore viewport/sidebar widths: ' + JSON.stringify(restored))
          window.setSize(1100, 760)
          window.webContents.setZoomFactor(1.25)
          await new Promise(resolve => setTimeout(resolve, 350))
        }
        const focus = await window.webContents.executeJavaScript(`(async () => {
          const wait = ms => new Promise(r=>setTimeout(r,ms));
          document.querySelector('[data-testid="manuscript-focus"]')?.click();
          await wait(300);
          const r=document.querySelector('.manuscript-page .cm-scroller')?.getBoundingClientRect();
          const assistant=document.querySelector('.assistant-panel')?.getBoundingClientRect();
          const rail=document.querySelector('.activitybar');
          const explorer=document.querySelector('.explorer');
          const studio=document.querySelector('.studio');
          return {page:'desk-focus',compact:${compact},ok:Boolean(r&&r.height>100&&r.width>200&&studio?.classList.contains('writing-focus')&&(!assistant||assistant.width===0||r.right<=assistant.left+1)&&(!rail||!rail.checkVisibility())&&(!explorer||!explorer.checkVisibility())),editor:r&&{width:r.width,height:r.height,left:r.left,right:r.right},assistant:assistant&&{width:assistant.width,left:assistant.left,right:assistant.right},railVisible:Boolean(rail?.checkVisibility()),explorerVisible:Boolean(explorer?.checkVisibility()),studioClass:studio?.className};
        })()`)
        await capture(`desk-focus${compact ? '-compact' : ''}`)
        measurements.push(focus)
        if (!focus.ok) throw new Error('Focus mode/editor geometry failed: ' + JSON.stringify(focus))
        await window.webContents.executeJavaScript(`(async()=>{document.querySelector('[data-testid="manuscript-focus"]')?.click();await new Promise(r=>setTimeout(r,200));document.querySelector('.title-actions .assistant-toggle')?.click();const after=await window.novelDesktop.chapters.get(window.__designChapterId);if(after.content!==window.__designBeforeBody.content||after.title!==window.__designBeforeBody.title)throw new Error('Navigation changed manuscript');})()`)
      }
      if (page === 'settings') {
        const categoryState = await window.webContents.executeJavaScript(`(()=>{const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;return {labels:Array.from(document.querySelectorAll('.settings-category-navigation button span')).map(e=>e.textContent.trim()),visibleSections:Array.from(document.querySelectorAll('.settings-category-sections .tree-item')).filter(visible).length};})()`)
        if (categoryState.labels.join('|') !== '常用|AI 与模型|写作|数据与备份|高级' || categoryState.visibleSections > 3) throw new Error('Settings categories are missing or still expose too many choices: ' + JSON.stringify(categoryState))
        const searchState = await window.webContents.executeJavaScript(`(async()=>{const input=document.querySelector('.settings-search input');if(!input)return {ok:false};input.value='主题';input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,80));const labels=Array.from(document.querySelectorAll('.settings-category-sections .tree-item')).map(e=>e.textContent.replace(/\\s+/g,' ').trim());document.querySelector('.settings-search button')?.click();return {ok:labels.length===1&&labels[0].includes('外观与版式'),labels};})()`)
        if (!searchState.ok) throw new Error('Settings search did not find the interface theme setting: ' + JSON.stringify(searchState))
        const categoryBySection: Record<string, string> = { connection: 'ai', routing: 'ai', context: 'ai', writing: 'writing', prompts: 'writing', project: 'data', trial: 'data', research: 'advanced', about: 'advanced' }
        for (const section of ['connection', 'routing', 'context', 'writing', 'prompts', 'project', 'trial', 'research', 'about']) {
          const category = categoryBySection[section]
          await window.webContents.executeJavaScript(`(async()=>{
            document.querySelector('[data-testid="settings-category-${category}"]')?.click();
            await new Promise(r=>setTimeout(r,120));
            const e=document.querySelector('[data-testid="settings-nav-${section}"]');
            if(!e)throw new Error('Missing settings navigation: ${section}');
            e.scrollIntoView({block:'nearest'});e.click();
            await new Promise(r=>setTimeout(r,350));
            if(!document.querySelector('[data-testid="settings-nav-${section}"].selected'))throw new Error('Settings selection or navigation disappeared: ${section}');
            if(document.querySelector('.assistant-panel')?.getBoundingClientRect().width>0)throw new Error('Settings has assistant');
            if('${section}'==='routing'){
              const choices=Array.from(document.querySelectorAll('.routing-choice button'));
              if(choices.length!==2||choices.some(button=>getComputedStyle(button).whiteSpace!=='nowrap'||button.getBoundingClientRect().right>innerWidth))throw new Error('Routing choices wrap or leave viewport');
            }
          })()`)
          await capture(`settings-${section}${compact ? '-compact' : ''}`)
        }
      }
    }
  }
  await window.webContents.executeJavaScript(`(async()=>{document.querySelector('[data-testid="settings-category-common"]')?.click();await new Promise(r=>setTimeout(r,100));const e=document.querySelector('[data-testid="settings-nav-appearance"]');if(!e)throw new Error('Appearance navigation missing');e.click();for(let i=0;i<50&&!document.querySelector('[data-testid="theme-moye"]');i++)await new Promise(r=>setTimeout(r,100));if(document.querySelector('[data-testid="library-appearance-settings"]')||document.querySelector('[data-testid="loader-preferences"]')||document.querySelector('[data-testid="settings-page-appearance"]'))throw new Error('Duplicate appearance controls remain in project settings');})()`)
  // Theme ids are tested through the actual radio UI, not by patching root CSS.
  const dark = await window.webContents.executeJavaScript(`(async()=>{const radio=document.querySelector('[data-testid="theme-moye"]');if(!radio)throw new Error('Dark theme radio not found');radio.click();await new Promise(r=>setTimeout(r,250));return document.documentElement.dataset.theme;})()`)
  if (dark !== 'moye') throw new Error('Dark theme did not apply')
  await capture('settings-dark-compact')
  await writeFile(join(dirname(capturePath), `${prefix}-measurements.json`), JSON.stringify(measurements, null, 2))
  return { ok: true, pages: pages.length, viewports: 2, measurements }
}
