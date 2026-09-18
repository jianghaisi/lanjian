// Explicit developer diagnostic. Run with Electron, never against the author's
// writable workspace factory. Only synthetic fixed samples leave this process.
const { app, safeStorage } = require('electron')
const { readFile, mkdtemp, realpath, writeFile } = require('node:fs/promises')
const { join, resolve, relative, isAbsolute } = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const { createHash } = require('node:crypto')
const { tsImport } = require('tsx/esm/api')

if (!app?.whenReady) {
  process.stderr.write('Run this entry with Electron through evaluate-live-consistency.mjs.\n')
  process.exit(2)
}

const args = process.argv.slice(2)
const live = args.includes('--run-live')
const checkOnly = args.includes('--check-credentials')
const listOnly = args.includes('--list-models')
const profileIndex = args.indexOf('--profile')
const outputIndex = args.indexOf('--output-root')
const connectionIndex = args.indexOf('--connection')
const modelIndex = args.indexOf('--model')
if ([live, checkOnly, listOnly].filter(Boolean).length !== 1 || profileIndex < 0 || !args[profileIndex + 1]) {
  process.stderr.write('Choose --check-credentials, --list-models or --run-live and provide --profile <user-data-directory>.\n')
  app.exit(2)
} else {
  void run().then(code => app.exit(code)).catch(() => app.exit(1))
}

async function run() {
  const state = { version: 1, status: 'running', phase: 'prepare', providerAttempted: false, requests: 0 }
  let outputRoot
  let database
  let controller
  let timeout
  const originalFetch = globalThis.fetch
  const publish = async () => {
    if (outputRoot) await writeFile(join(outputRoot, 'run-status.json'), JSON.stringify(state, null, 2) + '\n', 'utf8')
    process.stdout.write(JSON.stringify(state) + '\n')
  }
  try {
    // The launcher prepares an isolated profile and its OS-protected key before
    // Electron initializes OSCrypt. Changing userData asynchronously is too late.
    state.phase = 'verify-private-runtime'
    const runtimeProfile = process.env.LANJIAN_EVALUATION_RUNTIME
    if (!runtimeProfile || await realpath(app.getPath('userData')) !== await realpath(runtimeProfile)) throw new Error('Private runtime required')
    state.phase = 'wait-electron-ready'
    await app.whenReady()
    state.phase = 'read-profile'
    const profileRoot = await realpath(resolve(args[profileIndex + 1]))
    const settingsFile = join(profileRoot, 'settings.json')
    const settingsBytes = await readFile(settingsFile)
    const settings = JSON.parse(settingsBytes.toString('utf8'))
    if (typeof settings.currentProject !== 'string') throw new Error('No current book')
    const bookRoot = await realpath(settings.currentProject)
    state.phase = 'prepare-report-directory'
    const artifacts = outputIndex >= 0 && args[outputIndex + 1]
      ? resolve(args[outputIndex + 1]) : resolve(__dirname, '..', 'artifacts', 'evaluations')
    // Require an existing output parent so containment is checked before any
    // directory could be created inside an author book or settings directory.
    const artifactRoot = await realpath(artifacts)
    state.phase = 'check-output-boundary'
    for (const protectedRoot of [bookRoot, profileRoot]) {
      const rel = relative(protectedRoot, artifactRoot)
      if (!rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'))) throw new Error('Output overlaps protected data')
    }
    outputRoot = await mkdtemp(join(artifactRoot, 'live-'))
    state.phase = 'read-formal-settings'
    database = new DatabaseSync(join(bookRoot, '.webnovel', 'workspace.sqlite'), { readOnly: true, allowExtension: false })
    const project = database.prepare('SELECT storage_mode FROM projects LIMIT 1').get()
    if (project?.storage_mode !== 'sqlite') throw new Error('Formal SQLite settings required')
    const row = database.prepare('SELECT content_json, content_hash FROM ai_settings_documents LIMIT 1').get()
    if (!row || createHash('sha256').update(row.content_json).digest('hex') !== row.content_hash) throw new Error('Invalid formal settings')
    const config = JSON.parse(row.content_json)
    const configuredProfile = config.routingMode === 'perTask' ? config.tasks.review : config.shared
    const selectedConnectionId = connectionIndex >= 0 ? args[connectionIndex + 1] : configuredProfile.connectionId
    const selectedModel = modelIndex >= 0 ? args[modelIndex + 1] : configuredProfile.model
    const connection = config.connections.find(item => item.id === selectedConnectionId)
    if (!connection || typeof selectedModel !== 'string' || !selectedModel.trim()) throw new Error('No review route')
    const profile = { ...configuredProfile, connectionId: connection.id, model: selectedModel.trim() }
    state.model = profile.model
    state.connectionId = connection.id
    state.temporaryRoute = connection.id !== configuredProfile.connectionId || profile.model !== configuredProfile.model
    const secrets = settings.projectApiKeys[bookRoot] ?? settings.projectApiKeys[settings.currentProject]
    const encrypted = typeof secrets === 'string' ? (connection.id === 'primary' ? secrets : undefined) : secrets?.[connection.id]
    state.phase = 'decrypt-credentials'
    state.credentialPresent = Boolean(encrypted)
    state.encryptionAvailable = safeStorage.isEncryptionAvailable()
    if (!encrypted || !state.encryptionAvailable) throw new Error('Credentials unavailable')
    const apiKey = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    if (!apiKey.trim()) throw new Error('Empty credential')
    if (checkOnly) {
      state.status = 'ready'
      state.phase = 'credentials-readable'
      await publish()
      return 0
    }

    const assertBookUnchanged = async () => {
      const current = JSON.parse(await readFile(settingsFile, 'utf8'))
      if (await realpath(current.currentProject) !== bookRoot) {
        controller.abort()
        throw new DOMException('Evaluation book changed', 'AbortError')
      }
    }
    const importedFrom = pathToFileURL(__filename).href
    const { AiClient } = await tsImport('../src/main/modules/models/application/ai-client.ts', importedFrom)
    const { ConsistencyEvaluationService } = await tsImport('../src/main/modules/review/application/consistency-evaluation-service.ts', importedFrom)
    const resolved = { connectionId: connection.id, connectionName: connection.name, baseUrl: connection.baseUrl, apiKey, profile: { ...profile } }
    const ai = new AiClient({
      resolve: async () => resolved,
      resolveConnection: async () => { throw new Error('No alternate route permitted') }
    })
    controller = new AbortController()
    timeout = setTimeout(() => controller.abort(), 12 * 60 * 1000)
    process.once('SIGINT', () => controller.abort())
    process.once('SIGTERM', () => controller.abort())
    globalThis.fetch = async (...request) => {
      await assertBookUnchanged()
      if (controller.signal.aborted) throw new DOMException('Evaluation cancelled', 'AbortError')
      if (state.requests >= 10) {
        controller.abort()
        throw new DOMException('Evaluation request limit reached', 'AbortError')
      }
      state.providerAttempted = true
      state.requests++
      const response = await originalFetch(...request)
      if ([401, 403, 429].includes(response.status)) {
        state.httpStatus = response.status
        await response.body?.cancel()
        controller.abort()
        throw new DOMException('Review API unavailable', 'AbortError')
      }
      return response
    }
    if (listOnly) {
      state.phase = 'list-models'
      state.models = (await ai.listModels()).models
      state.status = 'ready'
      state.phase = 'models-listed'
      await publish()
      return 0
    }
    // This runner's report root is an isolated artifact folder. The real book
    // remains read-only; guard its identity at every request and report commit.
    const reportProjects = { currentPath: async () => { await assertBookUnchanged(); return outputRoot } }
    const runner = new ConsistencyEvaluationService(ai, reportProjects, undefined, async () => 1)
    state.phase = 'evaluate-fixed-samples'
    const summary = await runner.run(controller.signal, (completed, total) => {
      state.completedBatches = completed
      state.totalBatches = total
      process.stdout.write(JSON.stringify({ phase: state.phase, completed, total, requests: state.requests }) + '\n')
    })
    state.status = summary.semanticEvaluatedCount === summary.semanticSampleCount ? 'completed' : 'incomplete'
    state.phase = 'report-written'
    state.summary = summary
    state.settingsUnchanged = Buffer.compare(await readFile(settingsFile), settingsBytes) === 0
    state.formalSettingsUnchanged = database.prepare('SELECT content_hash FROM ai_settings_documents LIMIT 1').get().content_hash === row.content_hash
    await publish()
    return state.status === 'completed' ? 0 : 1
  } catch {
    state.status = 'failed'
    state.code = state.phase === 'decrypt-credentials' ? 'CREDENTIALS_UNREADABLE' : 'LIVE_EVALUATION_UNAVAILABLE'
    await publish()
    throw new Error(state.code)
  } finally {
    clearTimeout(timeout)
    globalThis.fetch = originalFetch
    database?.close()
  }
}
