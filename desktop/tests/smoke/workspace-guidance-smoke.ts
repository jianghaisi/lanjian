import type { BrowserWindow } from 'electron'

export async function runWorkspaceGuidanceSmoke(window: BrowserWindow) {
  return window.webContents.executeJavaScript(`(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const assert=(v,m)=>{if(!v)throw new Error(m)};
    const closed=async()=>{for(let i=0;i<30&&document.querySelector('#workspace-guidance-panel');i++)await wait(50)};
    const trigger=document.querySelector('[data-testid="open-workspace-guidance"]');
    assert(trigger,'Guidance trigger missing');
    assert(!document.querySelector('.activitybar .local-dot'),'Local status still in navigation');
    assert(!document.querySelector('.workspace-guidance'),'Repeated guidance remains');
    trigger.click();await wait(280);
    let panel=document.querySelector('#workspace-guidance-panel');
    assert(panel&&panel.contains(document.activeElement),'Guidance did not receive focus');
    const p=panel.getBoundingClientRect(),t=trigger.getBoundingClientRect();
    assert(p.top>=t.bottom&&p.left>=0&&p.right<=innerWidth&&p.bottom<=innerHeight,'Guidance clipped');
    assert(getComputedStyle(trigger).getPropertyValue('-webkit-app-region')==='no-drag','Guidance cannot be clicked');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(250);
    for(let i=0;i<20&&document.querySelector('#workspace-guidance-panel');i++)await wait(50);
    assert(!document.querySelector('#workspace-guidance-panel')&&document.activeElement===trigger,'Escape focus return failed: '+JSON.stringify({panel:document.querySelector('#workspace-guidance-panel')?.className,focus:document.activeElement?.outerHTML?.slice(0,180)}));
    trigger.click();await wait(280);trigger.click();await wait(250);
    await closed();
    assert(!document.querySelector('#workspace-guidance-panel'),'Toggle close failed');
    trigger.click();await wait(280);
    document.querySelector('#workspace-guidance-panel [aria-label="关闭写作指引"]').click();await wait(250);
    await closed();
    assert(document.activeElement===trigger&&!document.querySelector('#workspace-guidance-panel'),'Close button failed: '+JSON.stringify({focus:document.activeElement?.outerHTML?.slice(0,180),panel:document.querySelector('#workspace-guidance-panel')?.className}));
    trigger.click();await wait(280);
    document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await wait(250);
    await closed();
    assert(!document.querySelector('#workspace-guidance-panel'),'Outside close failed');
    const input=document.querySelector('[data-testid="book-definition-fields"] .profile-premise textarea');
    input.value='隔离验收：一位记录雨声的少年。';input.dispatchEvent(new Event('input',{bubbles:true}));await wait(100);
    assert(document.querySelector('.statusbar [data-testid="workspace-storage-status"]')?.textContent.includes('待保存'),'Definition dirty state missing');
    const save=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存作品定义');
    assert(save&&!save.disabled,'Definition save unavailable');save.click();
    for(let i=0;i<100;i++){await wait(100);if(document.querySelector('.statusbar [data-testid="workspace-storage-status"]')?.textContent.includes('已保存'))break}
    assert(document.querySelector('.statusbar [data-testid="workspace-storage-status"]')?.textContent.includes('已保存'),'Definition save state missing');
    const formal=await window.novelDesktop.workspace.bootstrap();
    assert(formal.bookProfile.coreIdea===input.value,'Definition did not persist');
    return {ok:true,anchor:{left:p.left,top:p.top,width:p.width},keyboard:true,toggle:true,outside:true,save:true};
  })()`)
}
