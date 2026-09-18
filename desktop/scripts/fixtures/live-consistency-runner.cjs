// Isolated routing/credential/report tests only; fixture responses are NOT
// evidence of real-model consistency accuracy.
const assert = require('node:assert/strict')
const { app, safeStorage } = require('electron')
const { mkdtemp, mkdir, writeFile, readFile, readdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { createHash } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { createServer } = require('node:http')
const { spawn } = require('node:child_process')

let fixtureStage = 'initialize'
void run().then(() => app.exit(0)).catch(() => {
  process.stderr.write(JSON.stringify({ ok: false, fixtureStage }) + '\n')
  app.exit(1)
})

async function run() {
  const profileRoot = app.getPath('userData')
  const root = await mkdtemp(join(tmpdir(), 'lanjian-live-runner-fixture-'))
  await app.whenReady()
  fixtureStage = 'local-encryption-available'
  assert.equal(safeStorage.isEncryptionAvailable(), true)
  const bookRoot = join(root, 'book')
  const outputRoot = join(root, 'reports')
  await mkdir(profileRoot, { recursive: true })
  await mkdir(join(bookRoot, '.webnovel'), { recursive: true })
  await mkdir(outputRoot, { recursive: true })
  let mode = 'success'
  let calls = 0
  const key = 'isolated-fixture-credential'
  const server = createServer(async (request, response) => {
    calls++
    assert.equal(request.headers.authorization, `Bearer ${key}`)
    assert.equal(request.url, '/v1/chat/completions')
    let text = ''
    for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    assert.equal(body.model, 'fixture-review')
    assert.equal(text.includes(key), false)
    assert.equal(text.includes('AUTHOR_BODY_MUST_NOT_BE_SENT'), false)
    if (mode === 'auth-failure') { response.writeHead(401).end('denied'); return }
    if (mode === 'invalid-format') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: 'invalid JSON' } }] }))
      return
    }
    const samples = JSON.parse(body.messages[1].content.split('\n样本：\n')[1])
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ results: samples.map(({ id }) => ({ id, codes: [] })) }) } }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
    const config = JSON.stringify({ version: 2, connections: [{ id: 'fixture-api', name: 'Fixture', baseUrl }], routingMode: 'shared', shared: { connectionId: 'fixture-api', model: 'fixture-review', temperature: 0.2, topP: 1, maxTokens: 2048 } })
    const databasePath = join(bookRoot, '.webnovel', 'workspace.sqlite')
    const database = new DatabaseSync(databasePath)
    database.exec('CREATE TABLE projects (storage_mode TEXT); INSERT INTO projects VALUES (\'sqlite\'); CREATE TABLE ai_settings_documents (content_json TEXT, content_hash TEXT); CREATE TABLE body_versions (content TEXT); INSERT INTO body_versions VALUES (\'AUTHOR_BODY_MUST_NOT_BE_SENT\');')
    database.prepare('INSERT INTO ai_settings_documents VALUES (?, ?)').run(config, createHash('sha256').update(config).digest('hex'))
    database.close()
    const settingsPath = join(profileRoot, 'settings.json')
    const encrypted = safeStorage.encryptString(key).toString('base64')
    await writeFile(settingsPath, JSON.stringify({ currentProject: bookRoot, projectApiKeys: { [bookRoot]: { 'fixture-api': encrypted } } }))
    const settingsBefore = await readFile(settingsPath)
    const databaseBefore = await readFile(databasePath)
    const { prepareEvaluationRuntime, removeEvaluationRuntime } = await import('../isolated-electron-profile.mjs')
    // Chromium writes its fresh Local State asynchronously. Wait for the source
    // encryption context to be persisted before testing a separate profile.
    if (process.platform === 'win32') {
      for (let n = 0; n < 100; n++) {
        const state = await readFile(join(profileRoot, 'Local State'), 'utf8').then(JSON.parse).catch(() => ({}))
        if (state.os_crypt?.encrypted_key) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    const protectedProfileKey = process.platform === 'win32'
      ? JSON.parse(await readFile(join(profileRoot, 'Local State'), 'utf8')).os_crypt.encrypted_key : undefined
    const protectedProfileEntries = await readdir(profileRoot)
    const execute = async (flag, outputParent = outputRoot, unrelatedProfile = false) => {
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const runtime = await prepareEvaluationRuntime(unrelatedProfile ? undefined : profileRoot)
      env.LANJIAN_EVALUATION_RUNTIME = runtime
      const child = spawn(process.execPath, [resolve(__dirname, '..', 'evaluate-live-consistency.cjs'), `--user-data-dir=${runtime}`, flag, '--profile', profileRoot, '--output-root', outputParent], { windowsHide: true, env })
      let output = ''
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.on('data', chunk => { output += chunk })
      let exitCode
      try { exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) }) }
      finally { await removeEvaluationRuntime(runtime) }
      assert.equal(output.includes(key), false)
      assert.equal(output.includes(encrypted), false)
      if (protectedProfileKey) assert.equal(output.includes(protectedProfileKey), false)
      const records = output.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line))
      const state = records.at(-1)
      assert.ok(state, 'runner must emit a sanitized terminal status')
      process.stdout.write(JSON.stringify({ flag, exitCode, status: state.status, phase: state.phase, code: state.code, encryptionAvailable: state.encryptionAvailable }) + '\n')
      return { exitCode, state }
    }
    if (process.platform === 'win32') {
      fixtureStage = 'unrelated-profile-must-not-decrypt'
      const unrelated = await execute('--check-credentials', outputRoot, true)
      assert.equal(unrelated.exitCode, 1)
      assert.equal(unrelated.state.code, 'CREDENTIALS_UNREADABLE')
      assert.equal(calls, 0)
    }
    const checked = await execute('--check-credentials')
    fixtureStage = 'credential-check-result'
    assert.equal(checked.exitCode, 0)
    assert.equal(checked.state.status, 'ready')
    assert.equal(calls, 0)
    const completed = await execute('--run-live')
    fixtureStage = 'evaluation-result'
    assert.equal(completed.exitCode, 0)
    assert.equal(completed.state.status, 'completed')
    assert.equal(completed.state.summary.semanticEvaluatedCount, 60)
    assert.equal(completed.state.requests, 5)
    assert.equal(calls, 5)
    mode = 'auth-failure'
    const refused = await execute('--run-live')
    fixtureStage = 'auth-failure-result'
    assert.equal(refused.exitCode, 1)
    assert.equal(refused.state.status, 'failed')
    assert.equal(refused.state.httpStatus, 401)
    assert.equal(refused.state.requests, 1)
    assert.equal(calls, 6)
    fixtureStage = 'incomplete-report-is-not-success'
    mode = 'invalid-format'
    const incomplete = await execute('--run-live')
    assert.equal(incomplete.exitCode, 1)
    assert.equal(incomplete.state.status, 'incomplete')
    assert.equal(incomplete.state.summary.semanticEvaluatedCount, 0)
    assert.equal(incomplete.state.summary.semanticUnableToJudge, 60)
    assert.equal(incomplete.state.requests, 10)
    assert.equal(calls, 16)
    fixtureStage = 'protected-output-rejected-before-write'
    const bookEntries = await readdir(bookRoot)
    const protectedOutput = await execute('--run-live', bookRoot)
    assert.equal(protectedOutput.exitCode, 1)
    assert.equal(protectedOutput.state.phase, 'check-output-boundary')
    assert.equal(protectedOutput.state.requests, 0)
    assert.deepEqual(await readdir(bookRoot), bookEntries)
    const protectedSettings = await execute('--run-live', profileRoot)
    assert.equal(protectedSettings.exitCode, 1)
    assert.equal(protectedSettings.state.phase, 'check-output-boundary')
    assert.deepEqual(await readdir(profileRoot), protectedProfileEntries)
    fixtureStage = 'unchanged-source-and-private-report'
    assert.deepEqual(await readFile(settingsPath), settingsBefore)
    assert.deepEqual(await readFile(databasePath), databaseBefore)
    if (protectedProfileKey) assert.equal(JSON.parse(await readFile(join(profileRoot, 'Local State'), 'utf8')).os_crypt.encrypted_key, protectedProfileKey)
    for (const directory of await readdir(outputRoot)) {
      const status = await readFile(join(outputRoot, directory, 'run-status.json'), 'utf8')
      assert.equal(status.includes(key), false)
      assert.equal(status.includes(encrypted), false)
      if (protectedProfileKey) assert.equal(status.includes(protectedProfileKey), false)
      if (JSON.parse(status).status === 'completed') {
        const report = await readFile(join(outputRoot, directory, '.webnovel/evaluations/consistency-fixed-v2.json'), 'utf8')
        assert.equal(report.includes(key), false)
        assert.equal(report.includes(encrypted), false)
        if (protectedProfileKey) assert.equal(report.includes(protectedProfileKey), false)
      }
    }
    process.stdout.write(JSON.stringify({ ok: true, cases: ['unrelated-profile-cannot-decrypt-on-windows', 'copied-protected-key-zero-http', 'five-synthetic-batches', 'auth-failure-stops-after-one-request', 'incomplete-report-fails-with-ten-request-bound', 'book-and-profile-output-rejected'], sourceDatabaseUnchanged: true, settingsUnchanged: true, realModelAccuracyEvaluated: false }) + '\n')
  } finally { await new Promise(resolve => server.close(resolve)) }
}
