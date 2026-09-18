import { _electron as electron } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import assert from 'node:assert/strict'
const evidence=resolve('artifacts/local-model-store')
const {root}=JSON.parse(await readFile(join(evidence,'ui-result.json'),'utf8'))
assert.ok(basename(root).startsWith('lanjian-local-ui-'))
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('LANJIAN_')&&key!=='ELECTRON_RUN_AS_NODE'))
const app=await electron.launch({args:[resolve('out/main/index.js')],env:{...env,LANJIAN_USER_DATA_PATH:join(root,'profile')},timeout:60000})
try{
  const page=await app.firstWindow();page.setDefaultTimeout(60000)
  await page.getByTestId('library-continue-writing').click()
  await page.getByTestId('workspace-loading').waitFor({state:'hidden'})
  await page.locator('.activitybar [data-activity="settings"]').focus();await page.keyboard.press('Enter')
  await page.getByTestId('settings-category-ai').click();await page.getByTestId('settings-nav-local-models').click()
  await page.locator('[data-state="ready"]').waitFor()
  const sizes=[]
  for(const [width,height,zoom,file] of [[1440,900,1,'store-ready.png'],[1100,800,1.25,'store-compact.png']]){
    const bounds=await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));w.unmaximize();w.setContentSize(width,height);w.webContents.setZoomFactor(zoom);return w.getContentBounds()},{width,height,zoom})
    await page.waitForTimeout(700)
    await page.getByTestId('assign-local-model').scrollIntoViewIfNeeded()
    const dimensions=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}))
    if(zoom>1)assert.ok(dimensions.width<1000)

    assert.ok(await page.getByTestId('local-model-store').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
    await writeFile(join(evidence,file),Buffer.from(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')).capturePage()).toPNG().toString('base64')),'base64'));sizes.push({requested:{width,height,zoom},bounds,dimensions})
  }
  await writeFile(join(evidence,'viewports.json'),JSON.stringify(sizes,null,2));console.log('PASS: responsive store screenshots and no horizontal overflow')
}finally{await app.close()}
