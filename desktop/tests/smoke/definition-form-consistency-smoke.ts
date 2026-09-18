import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { runWorkspaceGuidanceSmoke } from './workspace-guidance-smoke'
import { runGlobalFieldAssistantSmoke } from './global-field-assistant-smoke'

/** Invoked only by the isolated electron-smoke runner. */
export async function runDefinitionFormConsistencySmoke(window: BrowserWindow, capturePath: string) {
  window.webContents.setBackgroundThrottling(false)
  const captureLength = async () => {
    let failure: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      window.webContents.invalidate()
      await new Promise(resolve => setTimeout(resolve, 250))
      const expected = await window.webContents.executeJavaScript(`(()=>{
        const r=document.querySelector('[data-testid="book-length-plan"]').getBoundingClientRect();
        return {x:r.right-6,y:r.bottom-6,width:innerWidth,height:innerHeight,color:getComputedStyle(document.querySelector('.profile-editor')).backgroundColor.match(/\\d+/g).slice(0,3).map(Number)};
      })()`)
      const shot = await window.capturePage(undefined, { stayHidden: true, stayAwake: true })
      const size = shot.getSize(1), pixels = shot.toBitmap({scaleFactor:1})
      const offset = (Math.floor(expected.y * size.height / expected.height) * size.width + Math.floor(expected.x * size.width / expected.width)) * 4
      // NativeImage bitmap is BGRA on Windows. Reject blank or stale-theme frames.
      if ([0,1,2].every(index => Math.abs(pixels[offset + 2 - index] - expected.color[index]) <= 3)) return shot.toPNG()
      failure={expected,size,bytes:pixels.length,pixel:[...pixels.subarray(offset,offset+4)]}
      await writeFile(join(dirname(capturePath),'definition-paint-failure.png'),shot.toPNG())
    }
    throw new Error('Definition screenshot did not paint the current theme: '+JSON.stringify(failure))
  }
  await window.webContents.executeJavaScript(`(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    for(let i=0;i<160;i++){if(!document.querySelector('[data-testid="workspace-loading"]'))break;await wait(100)}
    const api=window.novelDesktop;
    const migration=await api.projects.migrationPreview();
    if(migration.required){if(!migration.canMigrate)throw new Error('Isolated project migration blocked');await api.projects.migrate()}
    let storage=await api.projects.sqliteStorageStatus();
    if(storage.storageMode==='files'){
      const p=await api.projects.previewSqliteShadowMigration();
      if(!p.canImport||!p.token)throw new Error('Isolated SQLite preview failed: '+JSON.stringify(p.blockers));
      await api.projects.importSqliteShadowMigration(p.token);
    }
    storage=await api.projects.sqliteStorageStatus();
    if(storage.storageMode!=='sqlite'){
      const p=await api.projects.previewSqliteActivation();
      if(!p.canActivate||!p.token)throw new Error('Isolated SQLite activation failed');
      await api.projects.activateSqliteStorage(p.token);
    }
    document.querySelector('.project-title-return')?.click();
    for(let i=0;i<160;i++){await wait(100);if(document.querySelector('.project-library')&&!document.querySelector('.workbench'))break}
    if(!document.querySelector('.project-library'))throw new Error('Isolated book did not return to library');
    [...document.querySelectorAll('.work-item-open')].find(button=>button.getAttribute('aria-label')?.includes('烟测书稿'))?.click();
    for(let i=0;i<160;i++){await wait(100);if(document.querySelector('.workbench')&&!document.querySelector('[data-testid="workspace-loading"]'))break}
    await wait(500);
    document.querySelector('[data-activity="world"]')?.click();await wait(200);
    document.querySelector('[data-activity="profile"]')?.click();
    for(let i=0;i<80&&!document.querySelector('.character-alias-form');i++)await wait(100);
    if(!document.querySelector('.character-alias-form'))throw new Error('Alias form missing');
    return true;
  })()`)
  if(process.env.LANJIAN_SMOKE_ASSISTANT_VISUAL_ONLY==='1')return runGlobalFieldAssistantSmoke(window,capturePath)
  const measurements: unknown[] = []
  for (const [width, height] of [[1440, 900], [1100, 760], [1920, 1080]]) {
    for (const zoom of [1, 1.25]) {
      if(window.isMinimized())window.restore()
      if(window.isMaximized())window.unmaximize()
      window.show()
      window.focus()
      window.setSize(width, height)
      window.webContents.setZoomFactor(zoom)
      let actualSize=window.getSize(),contentBounds=window.getContentBounds(),viewport={width:0,height:0},settled=false
      for(let attempt=0;attempt<30;attempt++){
        window.webContents.invalidate()
        await new Promise(resolve=>setTimeout(resolve,100))
        viewport=await window.webContents.executeJavaScript('({width:innerWidth,height:innerHeight})')
        actualSize=window.getSize();contentBounds=window.getContentBounds()
        // Native Windows frames can round a requested DIP by a couple of pixels.
        settled=Math.abs(actualSize[0]-width)<=3&&Math.abs(actualSize[1]-height)<=3&&Math.abs(viewport.width-contentBounds.width/zoom)<=2&&Math.abs(viewport.height-contentBounds.height/zoom)<=2
        if(settled)break
      }
      if(!settled)throw new Error('Window resize did not settle: '+JSON.stringify({width,height,zoom,actualZoom:window.webContents.getZoomFactor(),actualSize,contentBounds,viewport}))
      for (const theme of ['qingzhou', 'xuanzhi', 'moye']) {
        const geometry = await window.webContents.executeJavaScript(`(async()=>{
          const wait=ms=>new Promise(r=>setTimeout(r,ms));
          document.documentElement.dataset.theme=${JSON.stringify(theme)};
          document.documentElement.style.colorScheme=${JSON.stringify(theme === 'moye' ? 'dark' : 'light')};
          let form=document.querySelector('.character-alias-form');
          if(!form){document.querySelector('[data-activity="profile"]')?.click();for(let i=0;i<100&&!form;i++){await wait(100);form=document.querySelector('.character-alias-form')}}
          if(!form)throw new Error('Alias form disappeared: '+document.querySelector('[data-page]')?.getAttribute('data-page')+' '+document.body.innerText.slice(-1800));
          for(let i=0;i<180&&(document.querySelector('[data-testid="workspace-loading"]')||document.querySelector('.app-frame[inert]'));i++)await wait(100);
          for(let i=0;i<100;i++){
            form=document.querySelector('.character-alias-form');
            if(form?.isConnected&&form.getBoundingClientRect().width>0)break;
            document.querySelector('[data-nav-parent="definition"]')?.click();await wait(200);
          }
          form=document.querySelector('.character-alias-form');
          if(!form?.getBoundingClientRect().width)throw new Error('Definition navigation did not settle');
          form.scrollIntoView({block:'center'});
          await wait(400);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const inputs=[...form.querySelectorAll('input')]; const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
          const [a,b]=inputs.map(rect);const button=rect(form.querySelector('button'));
          const sameRow=Math.abs(a.y-b.y)<1;
          if(sameRow&&Math.abs(a.y-button.y)>1)throw new Error('Alias action is not aligned');
          if(!sameRow&&!(a.bottom<=b.y&&b.bottom<=button.y))throw new Error('Alias fields overlap');
          if(a.height!==b.height)throw new Error('Different input heights');
          if(inputs.some(el=>getComputedStyle(el).fontFamily!==getComputedStyle(inputs[0]).fontFamily))throw new Error('Different input font');
          if([a,b,button].some(r=>r.x<0||r.right>innerWidth+1))throw new Error('Alias input clipped');
          if(inputs.some(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)!==el}))throw new Error('Alias inputs are covered: '+JSON.stringify({viewport:[innerWidth,innerHeight],a,b,hits:inputs.map(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,350)})}));
          return {a,b,button,sameRow,font:getComputedStyle(inputs[0]).font,fontSize:getComputedStyle(inputs[0]).fontSize};
        })()`).catch(async error=>{await writeFile(join(dirname(capturePath),'definition-visibility-failure.png'),(await window.capturePage()).toPNG());throw error})
        await writeFile(join(dirname(capturePath), `definition-${width}-${zoom}-${theme}.png`), (await window.capturePage()).toPNG())
        const lengthGeometry = await window.webContents.executeJavaScript(`(async()=>{
          const wait=ms=>new Promise(r=>setTimeout(r,ms));
          const plan=document.querySelector('[data-testid="book-length-plan"]');
          const studio=document.querySelector('.studio'),columns=getComputedStyle(studio).gridTemplateColumns.split(/\\s+/).map(parseFloat),workbench=document.querySelector('.workbench').getBoundingClientRect();
          // The rail's hover label overlays the next column; compare its reserved track.
          if(document.querySelector('.explorer,.explorer-resizer')||columns[1]!==0||Math.abs(workbench.left-studio.getBoundingClientRect().left-columns[0])>2)throw new Error('Definition still reserves an empty sidebar');
          const fields=[...plan.querySelectorAll('input')];
          for(const [index,value] of [8,55,3500].entries()){fields[index].value=String(value);fields[index].dispatchEvent(new Event('input',{bubbles:true}))}
          await wait(100);plan.scrollIntoView({block:'center'});await wait(300);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const output=plan.querySelector('output');
          if(!output||!output.textContent.includes('1,540,000')||output.querySelector('input'))throw new Error('Length is not a derived output');
          const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
          const controls=fields.map(rect);
          if(controls.some(r=>r.width<90||r.width>128||r.x<0||r.right>innerWidth))throw new Error('Number input width/clipping: '+JSON.stringify(controls));
          if(fields.some(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)!==el}))throw new Error('Number input covered');
          const summary=rect(output);
          if(summary.right>innerWidth||plan.scrollWidth>plan.clientWidth+1)throw new Error('Length summary overflows');
          const durations=[...document.querySelectorAll('.profile-duration-input input')].map(rect);
          if(durations.some(r=>r.width>128))throw new Error('Duration inputs still stretched');
          return {controls,summary,durations,total:output.textContent};
        })()`)
        measurements.push({ width, height, zoom, actualSize, viewport, theme, geometry, lengthGeometry })
        await writeFile(join(dirname(capturePath), `definition-length-${width}-${zoom}-${theme}.png`), await captureLength())
      }
    }
  }
  await writeFile(join(dirname(capturePath), 'definition-form-measurements.json'), JSON.stringify(measurements, null, 2))
  window.setSize(1440, 900)
  window.webContents.setZoomFactor(1)
  const lengthInteraction = await window.webContents.executeJavaScript(`(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms)),api=window.novelDesktop;
    const before=await api.workspace.getBookProfile();
    const volume=document.querySelector('[data-testid="book-planned-volumes"]');
    const output=()=>document.querySelector('[data-testid="book-target-total-words"]').textContent;
    const set=async value=>{volume.value=String(value);volume.dispatchEvent(new Event('input',{bubbles:true}));await wait(100)};
    await set('');if(output().trim()!=='—')throw new Error('Empty factor shows an invalid total');
    await set(0);if(output().trim()!=='—')throw new Error('Invalid factor shows an invalid total');
    await set(9);if(!output().includes('1,732,500'))throw new Error('Total did not recalculate');
    if(JSON.stringify(await api.workspace.getBookProfile())!==JSON.stringify(before))throw new Error('Editing length wrote formal state implicitly');
    await set(8);
    document.querySelector('.profile-editor .save-action').click();
    for(let i=0;i<100;i++){await wait(100);if(document.querySelector('.statusbar [data-testid="workspace-storage-status"]')?.textContent.includes('已保存'))break}
    const saved=await api.workspace.getBookProfile();
    if(saved.plannedVolumes!==8||saved.chaptersPerVolume!==55||saved.targetWordsPerChapter!==3500||saved.targetWords!==1540000)throw new Error('Length save differs from the displayed plan');
    if((await api.workspace.bootstrap()).bookProfile.targetWords!==1540000)throw new Error('Reloaded length differs');
    document.documentElement.dataset.theme='qingzhou';
    document.documentElement.style.colorScheme='light';
    return {ok:true,empty:true,liveCalculation:true,explicitSave:true,reload:true,total:saved.targetWords};
  })()`)
  const sidebarInteraction=await window.webContents.executeJavaScript(`(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const until=async(check,message)=>{for(let i=0;i<100;i++){if(check())return;await wait(100)}throw new Error(message)};
    const studio=document.querySelector('.studio'),widthPreference=studio.style.getPropertyValue('--explorer-width');
    const assertDefinition=()=>{
      if(document.querySelector('.explorer,.explorer-resizer'))throw new Error('Definition sidebar still mounted');
      const columns=getComputedStyle(studio).gridTemplateColumns.split(/\\s+/).map(parseFloat),work=document.querySelector('.workbench').getBoundingClientRect();
      if(columns[1]!==0||Math.abs(work.left-studio.getBoundingClientRect().left-columns[0])>2||work.width<=0)throw new Error('Definition did not reclaim the sidebar width');
    };
    assertDefinition();
    const toggle=document.querySelector('.assistant-toggle');
    if(toggle.getAttribute('aria-expanded')!=='true')toggle.click();await wait(400);
    assertDefinition();
    if(!document.querySelector('[data-testid="field-assistant-instruction"]')?.getBoundingClientRect().width)throw new Error('Definition assistant cannot open');
    toggle.click();await wait(400);assertDefinition();
    const input=document.querySelector('.profile-premise textarea'),original=input.value;
    input.value=original+'：切页保留草稿';input.dispatchEvent(new Event('input',{bubbles:true}));await wait(100);
    for(const [parent,page] of [['settings','settings'],['manuscript','desk']]){
      document.querySelector('[data-nav-parent="'+parent+'"]').click();
      await until(()=>studio.dataset.page===page&&document.querySelector('.explorer')?.getBoundingClientRect().width>0,'Other page sidebar did not return: '+page);
      if(!document.querySelector('.explorer-resizer'))throw new Error('Other page sidebar cannot resize');
      if(studio.style.getPropertyValue('--explorer-width')!==widthPreference)throw new Error('Definition changed saved sidebar width');
      document.querySelector('[data-nav-parent="definition"]').click();
      await until(()=>studio.dataset.page==='profile'&&document.querySelector('.profile-premise textarea'),'Definition did not return');
      assertDefinition();
      if(document.querySelector('.profile-premise textarea').value!==original+'：切页保留草稿')throw new Error('Navigation lost definition draft');
    }
    const restored=document.querySelector('.profile-premise textarea');restored.value=original;restored.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-testid="book-length-plan"]').scrollIntoView({block:'center'});await wait(300);
    return {ok:true,noEmptySidebar:true,spaceReclaimed:true,assistant:true,otherSidebarsRestored:true,widthPreferencePreserved:true,draftPreserved:true};
  })()`)
  await writeFile(join(dirname(capturePath),'definition-without-sidebar.png'),await captureLength())
  if(process.env.LANJIAN_SMOKE_NUMBER_FORMS_ONLY==='1')return {ok:true,scenarios:measurements.length,measurements,lengthInteraction,sidebarInteraction}
  const guidance = await runWorkspaceGuidanceSmoke(window)
  const assistant = await runGlobalFieldAssistantSmoke(window,capturePath).catch(async error=>{
    await writeFile(join(dirname(capturePath),'field-assistant-failure.png'),(await window.capturePage()).toPNG())
    throw error
  })
  return { ok: true, scenarios: measurements.length, measurements, lengthInteraction, sidebarInteraction, guidance, assistant }
}
