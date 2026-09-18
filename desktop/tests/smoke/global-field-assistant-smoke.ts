import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'

export async function runGlobalFieldAssistantSmoke(window:BrowserWindow,capturePath:string){
  window.webContents.on('page-title-updated',(_event,title)=>{if(title.startsWith('field-smoke:'))console.info(title);if(title==='field-smoke: capture-conversation')setTimeout(()=>{void window.capturePage().then(capture=>writeFile(join(dirname(capturePath),'assistant-conversation.png'),capture.toPNG()))},350)})
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));const assert=(ok,message)=>{if(!ok)throw new Error(message)};
    const until=async(read,message)=>{for(let i=0;i<150;i++){const result=read();if(result)return result;await wait(100)}throw new Error(message+' '+(document.querySelector('.field-assistant')?.textContent||'').slice(-1200))};
    const set=(el,value)=>{assert(el,'Input missing');el.value=value;el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))};
    const api=window.novelDesktop;
    await api.ai.updateSettings({baseUrl:${JSON.stringify(process.env.LANJIAN_SMOKE_MODEL_URL)},apiKey:'isolated-field-key',shared:{model:'gemini-smoke-model',temperature:.6,topP:1,maxTokens:8192}});
    const before=await api.workspace.getBookProfile();
    const other=document.querySelector('[data-testid="book-audience-rating"]');set(other,'作者尚未保存的受众说明');
    document.querySelector('[data-activity="world"]').click();await wait(350);
    document.querySelector('.titlebar .assistant-toggle').click();await wait(200);
    assert(document.querySelector('[data-testid="field-assistant-panel"]')?.getClientRects().length,'Global assistant missing on world page');
    assert(!document.querySelector('[data-testid="field-assistant-target"]')&&!document.querySelector('.assistant-edit-mode'),'Manual routing controls remain');
    assert(document.querySelectorAll('.field-assistant-composer>textarea').length===1,'More than one chat composer');
    set(document.querySelector('[data-testid="field-assistant-instruction"]'),'修改核心设想，主角能听见旧物记忆。');
    await wait(100);
    document.querySelector('[data-testid="send-field-assistant"]').click();
    await until(()=>document.querySelector('[data-testid="field-assistant-candidate"]'),'Candidate missing');
    assert((await api.workspace.getBookProfile()).coreIdea===before.coreIdea,'Generation wrote formal profile');
    document.title='field-smoke: capture-conversation';await wait(800);
    if(${JSON.stringify(process.env.LANJIAN_SMOKE_ASSISTANT_VISUAL_ONLY==='1')})return {ok:true,singleComposer:true,toolConversation:true};
    document.querySelector('[data-testid="apply-field-candidate"]').click();
    await until(()=>{const button=document.querySelector('[data-testid="undo-field-candidate"]');return button&&!button.disabled},'Application failed');
    assert(document.querySelector('[data-page="profile"]'),'Cross-page target did not reveal definition');
    assert(document.querySelector('.profile-premise textarea').value.includes('修复师'),'Wrong field updated');
    assert(document.querySelector('[data-testid="book-audience-rating"]').value==='作者尚未保存的受众说明','Other draft overwritten');
    assert((await api.workspace.getBookProfile()).coreIdea===before.coreIdea,'Draft apply performed implicit save');
    document.querySelector('[data-testid="undo-field-candidate"]').click();await wait(300);
    assert(document.querySelector('.profile-premise textarea').value===before.coreIdea,'Undo did not restore draft');
    set(document.querySelector('[data-testid="field-assistant-instruction"]'),'慢速修改核心设想，保留我的后续手写。');await wait(100);document.querySelector('[data-testid="send-field-assistant"]').click();await wait(250);
    set(document.querySelector('.profile-premise textarea'),'作者在等待期间继续写下的新设想');
    await until(()=>document.querySelector('[data-testid="field-assistant-candidate"]'),'Second candidate missing');
    assert(document.querySelector('[data-testid="apply-field-candidate"]').disabled,'Stale candidate allowed adoption');
    assert(document.querySelector('.profile-premise textarea').value==='作者在等待期间继续写下的新设想','Late result overwrote draft');
    const history=await api.fieldAssistant.recent((await api.projects.status()).project.id);
    assert(history.some(t=>t.candidate?.status==='undone'),'AI provenance history lost');
    set(document.querySelector('.profile-premise textarea'),before.coreIdea);
    const visible=el=>el&&el.getClientRects().length;
    const field=id=>document.querySelector('[data-assistant-field="'+id+'"]');
    const useField=async(id,request)=>{
      document.title='field-smoke: '+id;
      const el=await until(()=>field(id),'Missing field '+id);const previous=el.value??el.textContent;
      el.focus();el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',altKey:true,bubbles:true}));await wait(150);
      set(document.querySelector('[data-testid="field-assistant-instruction"]'),request||'请完善所选这一项。');await wait(100);
      document.querySelector('[data-testid="send-field-assistant"]').click();await wait(180);await until(()=>document.querySelector('[data-testid="apply-field-candidate"]'),'No candidate '+id);
      assert(!document.querySelector('[data-testid="apply-field-candidate"]').disabled,'Candidate invalid '+id);
      document.querySelector('[data-testid="apply-field-candidate"]').click();await until(()=>{const button=document.querySelector('[data-testid="undo-field-candidate"]');return button&&!button.disabled},'Apply failed '+id);
      const checkLength=()=>{
        if(id!=='definition.bookProfile.plannedVolumes')return;
        const number=testid=>Number(document.querySelector('[data-testid="'+testid+'"]').value);
        const expected=number('book-planned-volumes')*number('book-chapters-per-volume')*number('book-words-per-chapter');
        assert(document.querySelector('[data-testid="book-target-total-words"]').textContent.includes(expected.toLocaleString('zh-CN')),'AI factor edit left a stale total');
      };
      checkLength();
      document.querySelector('[data-testid="undo-field-candidate"]').click();await until(()=>!document.querySelector('[data-testid="undo-field-candidate"]'),'Undo did not finish '+id);await wait(100);
      checkLength();
      assert(!document.querySelector('[data-testid="undo-field-candidate"]'),'Undo failed '+id);
      assert((el.value??el.textContent)===previous,'Undo changed original '+id);
      return true;
    };
    await useField('definition.bookProfile.plannedVolumes');
    await useField('definition.bookProfile.subgenre');
    await useField('definition.bookProfile.autosaveEnabled');
    const visit=async(parent,leaf)=>{document.title='field-smoke: page '+parent+'/'+(leaf||'');document.querySelector('[data-nav-parent="'+parent+'"]')?.click();await wait(180);if(leaf)document.querySelector('[data-nav-leaf="'+leaf+'"]')?.click();await wait(250)};
    await visit('foundation','realms');if(!field('Realm.name'))document.querySelector('[data-testid="add-realm-level"]').click();await useField('Realm.name','请完善所选境界的名称。');
    await visit('foundation','system-template');await useField('AppShell.systemTemplate','请完善所选模板。');
    await visit('master-outline','total-outline');await useField('AppShell.totalOutline');
    await visit('chronicle','event-timeline');document.querySelector('[data-testid="add-timeline-event"]')?.click();await wait(250);
    await useField('ChronicleEvents.event');
    const testedPages=[];
    for(const parent of [...document.querySelectorAll('[data-nav-parent]')].map(el=>el.dataset.navParent)){
      await visit(parent);const leaves=[...document.querySelectorAll('[data-nav-leaf]')].filter(visible).map(el=>el.dataset.navLeaf);
      for(const leaf of leaves){await visit(parent,leaf);assert(visible(document.querySelector('.titlebar .assistant-toggle')),'Missing assistant entry '+leaf);testedPages.push(leaf)}
    }
    await visit('settings');
    for(const category of [...document.querySelectorAll('[data-testid^="settings-category-"]')]){category.click();await wait(120);assert(visible(document.querySelector('.titlebar .assistant-toggle')),'Missing assistant settings');testedPages.push(category.dataset.testid)}
    await visit('manuscript');
    assert(document.querySelector('[data-testid="writing-agent"]'),'Original prose assistant missing');
    document.querySelector('[data-testid="manuscript-focus"]')?.click();await wait(180);
    await until(()=>visible(document.querySelector('[data-testid="manuscript-focus-assistant"]')),'Focus assistant entry missing');
    document.querySelector('[data-testid="focus-workspace-guidance"]').click();await wait(220);assert(visible(document.querySelector('#workspace-guidance-panel')),'Focus guidance missing');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(200);if(document.querySelector('.writing-focus'))document.querySelector('[data-testid="manuscript-focus"]')?.click();
    // This process owns only the temporary smoke book. Empty it to exercise the zero-chapter flow.
    for(const chapter of await api.chapters.list())await api.chapters.delete(chapter.id);
    document.querySelector('.project-title-return').click();await until(()=>document.querySelector('.project-library')&&!document.querySelector('.workbench'),'Return to library failed');
    assert(!document.querySelector('.global-assistant-host')&&!document.querySelector('[data-testid="library-assistant"]'),'Library must not show assistant');
    [...document.querySelectorAll('.work-item-open')].find(el=>el.getAttribute('aria-label')?.includes('烟测书稿')).click();
    await until(()=>document.querySelector('.workbench')&&!document.querySelector('[data-testid="workspace-loading"]'),'Empty book failed to open');await wait(500);
    assert((await api.chapters.list()).length===0,'Empty book created a chapter implicitly');
    await visit('definition','profile');await useField('definition.bookProfile.coreIdea','修改核心设想，围绕旧物的记忆展开。');
    return {ok:true,crossPage:true,singleField:true,undo:true,concurrentTyping:true,provenance:true,typedFields:['number','enum','boolean','realm','template','CodeMirror','event'],pages:testedPages,zeroChapter:true,focus:true,libraryWithoutAssistant:true,prosePreserved:true,toolConversation:true,singleComposer:true};
  })()`)
  await window.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
  await writeFile(join(dirname(capturePath),'global-field-assistant.png'),(await window.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG())
  return result
}
