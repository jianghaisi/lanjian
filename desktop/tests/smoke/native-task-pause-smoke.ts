import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { BrowserWindow } from 'electron'
import type { WorkspaceTaskRunRecord } from '../../src/main/core/ports/workspace-database'
import type { Chapter, WritingAgentTask } from '../../src/contracts/index'

type Seams = {
  workItemPath: string
  readTask: (id: string) => Promise<WorkspaceTaskRunRecord | null | undefined>
  restorePaused: (id: string) => Promise<WritingAgentTask>
}
const parentPartial = '这是原生暂停前已经生成并保存的未完成回答。'
const childPartial = '这是继续任务的新一轮回答，旧片段仍保留在父任务中。'

/** No external provider: each SSE response is released by the driver, not a timer. */
async function localProvider(port = 0, continuing = false) {
  const requests: Array<{ model: string; stream: boolean; hasInstruction: boolean }> = []
  let parentAborted = false
  let childResponse: ServerResponse | undefined
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response.setHeader('content-type', 'application/json')
      return response.end(JSON.stringify({ data: [{ id: 'native-pause-model' }] }))
    }
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST' || request.headers.authorization !== 'Bearer isolated-native-pause-key') {
      response.writeHead(400).end('isolated fixture request rejected')
      return
    }
    try {
      let body = ''
      for await (const chunk of request) { body += chunk; if (body.length > 2_000_000) throw new Error('oversized fixture request') }
      const payload = JSON.parse(body)
      requests.push({ model: payload.model, stream: payload.stream === true, hasInstruction: payload.messages?.some((message: { content?: string }) => message.content?.includes('原生暂停验收')) === true })
      if (payload.model !== 'native-pause-model' || payload.stream !== true || requests.length > (continuing ? 1 : 2)) throw new Error('unexpected fixture generation')
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
      response.flushHeaders()
      const first = !continuing && requests.length === 1
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: first ? parentPartial : childPartial } }] })}\n\n`)
      if (first) response.on('close', () => { parentAborted = true })
      else childResponse = response
    } catch { if (!response.headersSent) response.writeHead(400); response.end('invalid isolated fixture request') }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return {
    url: `http://127.0.0.1:${address.port}/v1`, port: address.port, requests,
    get parentAborted() { return parentAborted },
    finishChild() { assert.ok(childResponse && !childResponse.destroyed); childResponse.end('data: [DONE]\n\n') },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  }
}

/** Isolated native-input proof. Audit triggers exist only in this disposable fixture database. */
export async function runNativeTaskPauseSmoke(window: BrowserWindow, capturePath: string, seams: Seams) {
  const cold = process.env.LANJIAN_SMOKE_NATIVE_PAUSE_COLD === '1'
  const verifyingCold = cold && process.env.LANJIAN_SMOKE_NATIVE_PAUSE_COLD_PHASE === 'verify'
  const checks: string[] = [], captures: string[] = []
  const refreshChecks: unknown[] = []
  let stage = 'isolation'
  let audit: DatabaseSync | undefined
  let provider: Awaited<ReturnType<typeof localProvider>> | undefined
  let configured = false
  const throttling = window.webContents.getBackgroundThrottling()
  const evaluate = (source: string) => window.webContents.executeJavaScript(source)
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const bounded = async <T>(promise: Promise<T>, label: string, ms = 2000): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms) })]) }
    finally { clearTimeout(timer) }
  }
  const wait = async (condition: () => Promise<unknown> | unknown, label: string) => {
    for (let n = 0; n < 200; n++) { if (await condition()) return; await pause(50) }
    throw new Error(`native-pause-timeout:${label}`)
  }
  const waitDom = (source: string, label: string) => wait(() => evaluate(`Boolean(${source})`), label)
  const paint = () => bounded(evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'), 'native-pause-not-painted')
  const click = async (selector: string) => {
    await waitDom(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&!e.disabled&&!e.closest('[inert]')})()`, selector)
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:r.width>0&&r.height>0&&x>0&&y>0&&x<innerWidth&&y<innerHeight&&e.contains(document.elementFromPoint(x,y))}})()`)
    assert.ok(point.hit, `native-pause-obscured:${selector}`)
    const zoom = window.webContents.getZoomFactor()
    for (const type of ['mouseDown', 'mouseUp'] as const) window.webContents.sendInputEvent({ type, x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 })
    await paint()
  }
  const tasks = (): Promise<WritingAgentTask[]> => evaluate('window.novelDesktop.ai.listWritingAgentTasks(1)')
  const chapter = (): Promise<Chapter> => evaluate('window.novelDesktop.chapters.get(1)')
  const capture = async (name: string) => {
    await pause(250); await paint()
    assert.ok(window.isVisible() && !window.isMinimized())
    assert.equal(await evaluate('document.visibilityState'), 'visible')
    // AppShell retains inactive assistant tabs with v-show. Only task-center
    // captures may inspect its refresh button; DOM presence is not visibility.
    if (name === 'child-streaming' || name === 'completed') {
      const point = await evaluate(`(()=>{const r=document.querySelector('[data-testid="refresh-task-center"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      const zoom = window.webContents.getZoomFactor()
      window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) })
      await pause(250); await paint()
      const appearance = await evaluate(`(()=>{
        const e=document.querySelector('[data-testid="refresh-task-center"]'),s=getComputedStyle(e),r=e.getBoundingClientRect();
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
        const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data).map(v=>v/255)};
        const over=(a,b)=>{const alpha=a[3]+b[3]*(1-a[3]);return alpha?[...a.slice(0,3).map((v,i)=>(v*a[3]+b[i]*b[3]*(1-a[3]))/alpha),alpha]:[0,0,0,0]};
        let bg=[0,0,0,0],opacity=1;for(let n=e;n;n=n.parentElement){const ns=getComputedStyle(n);bg=over(bg,rgba(ns.backgroundColor));opacity*=Number(ns.opacity)}
        const ink=over(rgba(s.color),bg),luma=c=>c.slice(0,3).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const a=luma(ink),b=luma(bg);return {color:s.color,background:s.backgroundColor,resolvedBackground:bg,opacity,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),hover:e.matches(':hover'),hit:r.width>0&&r.height>0&&r.x>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
      })()`)
      refreshChecks.push({ capture: name, ...appearance })
      assert.ok(appearance.hover && appearance.hit && appearance.opacity >= .99 && appearance.resolvedBackground[3] >= .99 && appearance.ratio >= 4.5, 'native-task-refresh-hover-unreadable:' + JSON.stringify(appearance))
    }
    const file = `native-task-${cold ? 'cold-' : ''}${name}.png`
    await writeFile(join(dirname(capturePath), file), (await bounded(window.capturePage(), 'native-pause-capture-timeout', 5000)).toPNG())
    captures.push(file)
  }
  const openAssistant = async () => {
    await click('.activitybar [data-activity="desk"]')
    await waitDom(`document.querySelector('[data-testid="manuscript-input"]')`, 'editor')
    if (!await evaluate(`Boolean(document.querySelector('.assistant-panel'))`)) await click('.title-actions .assistant-toggle')
    await click('[data-testid="assistant-mode-agent"]')
  }
  const reopenRenderer = async () => {
    const loaded = new Promise<void>(resolve => window.webContents.once('did-finish-load', () => resolve()))
    window.webContents.reload()
    await bounded(loaded, 'native-pause-reload', 15000)
    await waitDom(`document.querySelector('.project-library')`, 'reloaded-library')
    if (await evaluate(`Boolean(document.querySelector('[data-testid="app-boot-skip"]'))`)) await click('[data-testid="app-boot-skip"]')
    await waitDom(`!document.querySelector('[data-testid="app-boot-skip"]')`, 'boot-dismissed')
    await click('.work-item-open[aria-label*="烟测书稿"]')
    await waitDom(`document.querySelector('.activitybar')&&!document.querySelector('.app-frame[inert]')&&!document.querySelector('[data-testid="workspace-loading"]')`, 'reopened-workspace')
    await openAssistant()
  }
  const assertLayout = async () => {
    const geometry = await evaluate(`(()=>{const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}};return {tree:rect('.explorer'),editor:rect('.workbench'),assistant:rect('.assistant-panel'),panels:document.querySelectorAll('.assistant-panel').length,width:innerWidth}})()`)
    assert.ok(geometry.tree && geometry.editor && geometry.assistant)
    assert.equal(geometry.panels, 1)
    assert.ok(geometry.tree.right <= geometry.editor.left + 1 && geometry.editor.right <= geometry.assistant.left + 1 && geometry.assistant.right <= geometry.width + 1 && geometry.editor.width >= 420, 'native-pause-panels-overlap')
    return geometry
  }
  try {
    assert.equal((await evaluate('window.novelDesktop.projects.status()'))?.project?.title, '烟测书稿')
    assert.ok(process.env.LANJIAN_USER_DATA_PATH && process.env.LANJIAN_SMOKE_CREATE_PARENT === process.env.LANJIAN_USER_DATA_PATH)
    const profile = await realpath(process.env.LANJIAN_USER_DATA_PATH!)
    const fixtureRoot = await realpath(seams.workItemPath)
    const inside = relative(profile, fixtureRoot)
    assert.ok(inside && !isAbsolute(inside) && inside !== '..' && !inside.startsWith('..\\') && !inside.startsWith('../../src/main/bootstrap/index/'))
    const databasePath = await realpath(join(fixtureRoot, '.webnovel', 'workspace.sqlite'))
    const databaseInside = relative(fixtureRoot, databasePath)
    assert.ok(databaseInside && !isAbsolute(databaseInside) && !databaseInside.startsWith('..'))
    audit = new DatabaseSync(databasePath)
    const checkpointPath = join(profile, 'native-pause-cold.json')
    const checkpoint: { pid: number; port: number; parent: WritingAgentTask; baseline: Chapter; mirror: string } | undefined = verifyingCold
      ? JSON.parse(await readFile(checkpointPath, 'utf8')) : undefined
    if (verifyingCold) {
      assert.ok(checkpoint && checkpoint.pid !== process.pid && Number.isInteger(checkpoint.port) && checkpoint.port > 0 && checkpoint.port < 65536)
      assert.equal(audit.prepare('SELECT storage_mode FROM projects').get()?.storage_mode, 'sqlite')
      assert.equal((await seams.readTask(checkpoint.parent.id))?.status, 'paused')
      assert.ok(audit.prepare('SELECT COUNT(*) AS count FROM smoke_native_task_audit').get()?.count)
    } else audit.exec(`CREATE TABLE smoke_native_task_audit(seq INTEGER PRIMARY KEY,task_id TEXT NOT NULL,status TEXT NOT NULL,parent_id TEXT);
      CREATE TRIGGER smoke_native_task_insert AFTER INSERT ON task_runs BEGIN INSERT INTO smoke_native_task_audit(task_id,status,parent_id) VALUES(NEW.id,NEW.status,NEW.parent_task_run_id); END;
      CREATE TRIGGER smoke_native_task_update AFTER UPDATE OF status ON task_runs BEGIN INSERT INTO smoke_native_task_audit(task_id,status,parent_id) VALUES(NEW.id,NEW.status,NEW.parent_task_run_id); END;`)
    window.webContents.setBackgroundThrottling(false); configured = true
    window.setSize(1440, 940); window.webContents.setZoomFactor(1)
    provider = await localProvider(checkpoint?.port, verifyingCold)
    if (!verifyingCold) await evaluate(`(async()=>{const s=await window.novelDesktop.ai.getSettings();await window.novelDesktop.ai.updateSettings({baseUrl:${JSON.stringify(provider.url)},apiKey:'isolated-native-pause-key',routingMode:'shared',shared:{...s.shared,model:'native-pause-model'}})})()`)
    const body = '　　沈砚把铜铃放回衣袋，坐在窗边听雨。\n\n　　这是独立暂停验收的正式稿，任务不能自行改动。'
    if (!verifyingCold) {
      const beforeSeed = await chapter()
      await evaluate(`window.novelDesktop.chapters.update(1,${JSON.stringify({ content: body, expectedRevision: beforeSeed.revision })})`)
    }
    await reopenRenderer()
    const baseline = checkpoint?.baseline ?? await chapter()
    assert.equal(baseline.content, body)
    assert.ok(baseline.bodyVersionId)
    const assertBodyUnchanged = async () => {
      const current = await chapter()
      assert.equal(current.content, body); assert.equal(current.bodyVersionId, baseline.bodyVersionId); assert.equal(current.revision, baseline.revision)
      assert.equal(await readFile(join(fixtureRoot, '正文', '第1章-雨夜追迹.md'), 'utf8'), checkpoint?.mirror ?? body)
    }
    let parent: WritingAgentTask | undefined = checkpoint?.parent
    if (!verifyingCold) {
      stage = 'native-start-and-pause'
      await click('[data-testid="writing-agent-input"]')
      await window.webContents.insertText('原生暂停验收：请讨论当前章节，不要生成正文。')
      await click('[data-testid="run-writing-agent"]')
      await waitDom(`document.querySelector('[data-testid="writing-agent-stream-preview"]')?.textContent.includes(${JSON.stringify(parentPartial)})`, 'visible-parent-stream')
      await click('[data-testid="pause-writing-agent-task"]')
      await waitDom(`document.querySelector('[data-testid="writing-agent-task-paused"]')`, 'paused-renderer')
      await wait(() => provider!.parentAborted, 'provider-transport-stopped')
      parent = (await tasks()).find(task => task.status === 'paused')
      assert.ok(parent)
      assert.equal((await seams.readTask(parent.id))?.status, 'paused')
      assert.equal(parent.partial?.content, parentPartial)
      assert.equal(parent.partial.status, 'partial')
      await assertBodyUnchanged(); await assertLayout(); await capture('paused')
      checks.push('trusted renderer Pause stops the fixture transport and persists native paused plus exact partial without manuscript writes')

      if (cold) {
        assert.equal(provider.requests.length, 1)
        await writeFile(checkpointPath, JSON.stringify({ pid: process.pid, port: provider.port, parent, baseline, mirror: body }))
        const result = { ok: true, exitForColdRestart: true, pid: process.pid, parentId: parent.id, checks, captures, providerCalls: provider.requests.length }
        await writeFile(join(dirname(capturePath), 'native-task-pause-cold-seed.json'), JSON.stringify(result, null, 2))
        return result
      }

      stage = 'service-reconstruction-and-reopen'
      const reconstructed = await seams.restorePaused(parent.id)
      assert.equal(reconstructed.status, 'paused')
      assert.equal(reconstructed.partial?.content, parentPartial)
      assert.equal((await seams.readTask(parent.id))?.status, 'paused')
      await reopenRenderer()
    }
    assert.ok(parent)
    await waitDom(`document.querySelector('[data-testid="writing-agent-task-paused"]')`, 'restored-pause')
    await click('[data-testid="writing-agent-task-paused"] .agent-partial-details > summary')
    await waitDom(`document.querySelector('[data-testid="writing-agent-task-paused"] .agent-partial-details[open]')?.textContent.includes(${JSON.stringify(parentPartial)})`, 'restored-partial-visible')
    await assertBodyUnchanged(); await capture('reopened-paused')
    checks.push(verifyingCold
      ? 'independent Electron process recovers native paused and exact partial from unchanged SQLite without reseeding body/settings/tasks or automatic provider calls'
      : 'fresh service reconstruction and renderer project reopen retain paused history and visible original partial; no process-restart claim')
    if (verifyingCold) assert.equal(provider.requests.length, 0)

    stage = 'native-resume-child'
    await click('[data-testid="assistant-mode-tasks"]')
    await click(`[data-testid="task-center-resume-${parent.id}"]`)
    await wait(async () => (await tasks()).some(task => task.parentTaskRunId === parent.id && task.status === 'streaming'), 'streaming-child')
    const child = (await tasks()).find(task => task.parentTaskRunId === parent.id)
    assert.ok(child)
    assert.equal(child.attempt, parent.attempt + 1)
    await click('[data-testid="assistant-mode-tasks"]')
    await click('[data-testid="task-filter-all"]')
    await click('[data-testid="refresh-task-center"]')
    await waitDom(`document.querySelector('[data-testid="task-center-item-${child.id}"]')?.textContent.includes('生成中')`, 'child-status-visible')
    const transitions = audit.prepare('SELECT seq,task_id,status,parent_id FROM smoke_native_task_audit ORDER BY seq').all()
    const childStatuses = transitions.filter(row => row.task_id === child.id).map(row => row.status)
    assert.equal(childStatuses[0], 'resuming')
    assert.ok(childStatuses.includes('preparing') && childStatuses.includes('streaming'))
    assert.equal((await seams.readTask(parent.id))?.status, 'paused')
    await assertBodyUnchanged(); const layout = await assertLayout(); await capture('child-streaming')
    checks.push('real Continue creates a child whose audited native SQL lifecycle starts resuming then preparing/streaming; parent remains paused')

    stage = 'child-completion'
    provider.finishChild()
    await wait(async () => (await tasks()).some(task => task.id === child.id && task.status === 'succeeded'), 'child-succeeded')
    await click('[data-testid="refresh-task-center"]')
    await waitDom(`document.querySelector('[data-testid="task-center-item-${child.id}"]')?.textContent.includes('已完成')`, 'completion-visible')
    await waitDom(`document.querySelector('[data-testid="task-center-item-${parent.id}"]')?.textContent.includes('已续接')`, 'parent-continued-visible')
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="task-center-resume-${parent.id}"]'))`), false)
    const completed = (await tasks()).find(task => task.id === child.id)
    assert.equal(completed?.artifact?.status, 'complete')
    assert.equal(completed?.turn?.answer, childPartial)
    assert.equal((await tasks()).find(task => task.id === parent.id)?.partial?.content, parentPartial)
    assert.equal((await seams.readTask(child.id))?.status, 'succeeded')
    await assertBodyUnchanged(); await capture('completed')
    assert.equal(provider.requests.length, verifyingCold ? 1 : 2)
    assert.ok(provider.requests.every(request => request.stream && request.hasInstruction && request.model === 'native-pause-model'))
    checks.push('completed child is visible with parent continued/no duplicate resume; both artifacts retained and formal prose/version/revision unchanged')
    const result = { ok: true, checks, captures, refreshChecks, reconstruction: verifyingCold ? 'independent-electron-process' : 'fresh-service-and-renderer-reopen-not-process-restart', previousPid: checkpoint?.pid, pid: process.pid, parentId: parent.id, childId: child.id, parentStatus: 'paused', childStatus: 'succeeded', childStatuses, layout, providerCalls: provider.requests.length, transitions: audit.prepare('SELECT seq,task_id,status,parent_id FROM smoke_native_task_audit ORDER BY seq').all() }
    await writeFile(join(dirname(capturePath), `native-task-pause-${cold ? 'cold-' : ''}verification.json`), JSON.stringify(result, null, 2))
    return result
  } catch (error) {
    await capture('failure').catch(() => undefined)
    const result = { ok: false, stage, error: error instanceof Error ? error.message : String(error), checks, captures, refreshChecks, transitions: audit?.prepare('SELECT seq,task_id,status,parent_id FROM smoke_native_task_audit ORDER BY seq').all() ?? [] }
    await writeFile(join(dirname(capturePath), `native-task-pause-${cold ? 'cold-' : ''}verification.json`), JSON.stringify(result, null, 2))
    return result
  } finally {
    audit?.close()
    await provider?.close()
    if (configured && !window.isDestroyed()) window.webContents.setBackgroundThrottling(throttling)
  }
}
