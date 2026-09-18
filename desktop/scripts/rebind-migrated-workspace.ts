import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite'

type JsonObject = Record<string, unknown>
type PathMapping = { from: string; to: string }
type Finding = { kind: 'rebind' | 'historical-preserve' | 'external-validate' | 'unmatched' | 'conflict'; source: string; target?: string; reason: string }
type FileMutation = { path: string; content?: Buffer; originalHash: string | null; kind: string }
type ProtectedMirrorMutation = {
  sourceType: 'prompt_profile_json' | 'character_state_json'
  sourceId: string
  relativePath: string
  originalContentHash: string
  originalSourceVersionId: string
  updatedContentHash: string
  characterDocument?: { originalContentHash: string; updatedContent: string; updatedContentHash: string }
}
type DatabaseMutation = { path: string; mapping: PathMapping; originalHash: string; sidecarHashes: Record<string, string | null>; projectId: string; chapterCount: number; promptRows: number; checkpointRows: number; protectedMirrors: ProtectedMirrorMutation[] }

export type MigrationPlan = {
  appData: string
  worksRoot: string
  mappings: PathMapping[]
  findings: Finding[]
  fileMutations: FileMutation[]
  databaseMutations: DatabaseMutation[]
}

export type MigrationReceipt = {
  mode: 'applied'
  createdAt: string
  backupRoot: string
  backups: Array<{ path: string; backupPath: string | null; originalHash: string | null }>
  mappings: PathMapping[]
  changedFiles: Array<{ path: string; kind: string }>
  databases: Array<{ path: string; projectId: string; chapterCount: number; promptRows: number; checkpointRows: number }>
}

const projectJsonFields = [
  { relativePath: '.webnovel/config/prompt-profile.json', path: ['workItemId'], sourceType: 'prompt_profile_json' },
  { relativePath: '.webnovel/planning/automatic-planning-draft.json', path: ['proposal', 'workItemId'] },
  { relativePath: '.webnovel/story-state/characters.json', path: ['workItemId'], sourceType: 'character_state_json' },
] as const

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const jsonBuffer = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
const identity = (value: string) => resolve(value).replace(/[\\/]+$/, '').toLowerCase()
const samePath = (left: string, right: string) => identity(left) === identity(right)

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function containsText(value: unknown, needle: string): boolean {
  if (typeof value === 'string') return value.includes(needle)
  if (Array.isArray(value)) return value.some(item => containsText(item, needle))
  return isObject(value) && Object.values(value).some(item => containsText(item, needle))
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

async function canonicalDirectory(path: string): Promise<string> {
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isDirectory()) throw new Error(`Not a directory: ${path}`)
  return canonical
}

function assertContained(root: string, candidate: string): void {
  const rel = relative(root, candidate)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path escapes declared root: ${candidate}`)
}

async function readJsonObject(path: string): Promise<JsonObject> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isObject(parsed)) throw new Error(`Expected JSON object: ${path}`)
  return parsed
}

async function recognizedProjects(worksRoot: string): Promise<Map<string, string[]>> {
  const byName = new Map<string, string[]>()
  for (const entry of await readdir(worksRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = await realpath(join(worksRoot, entry.name))
    assertContained(worksRoot, path)
    const recognized = await Promise.all(['.webnovel', '正文', '大纲'].map(name => exists(join(path, name))))
    if (!recognized.some(Boolean)) continue
    const key = entry.name.toLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), path])
  }
  return byName
}

function collectSettingsPaths(settings: JsonObject): string[] {
  const result = new Set<string>()
  if (Array.isArray(settings.recentProjects)) for (const path of settings.recentProjects) if (typeof path === 'string') result.add(path)
  if (typeof settings.currentProject === 'string') result.add(settings.currentProject)
  if (isObject(settings.projectApiKeys)) for (const path of Object.keys(settings.projectApiKeys)) result.add(path)
  if (isObject(settings.autoBackups)) for (const path of Object.keys(settings.autoBackups)) result.add(path)
  return [...result]
}

function mappingFor(path: string, mappings: PathMapping[]): PathMapping | undefined {
  return mappings.find(mapping => samePath(mapping.from, path))
}

function remapDictionaryKeys(value: unknown, mappings: PathMapping[], lowercaseTarget: boolean): { value: unknown; changed: boolean } {
  if (!isObject(value)) return { value, changed: false }
  const next: JsonObject = {}
  let changed = false
  for (const [key, item] of Object.entries(value)) {
    const mapping = mappingFor(key, mappings)
    const target = mapping ? (lowercaseTarget ? identity(mapping.to) : mapping.to) : key
    if (Object.hasOwn(next, target) && JSON.stringify(next[target]) !== JSON.stringify(item)) throw new Error(`Conflicting settings key: ${target}`)
    next[target] = item
    changed ||= target !== key
  }
  return { value: next, changed }
}

function mutateKnownJsonField(root: JsonObject, segments: readonly string[], mapping: PathMapping): boolean {
  let owner: JsonObject = root
  for (const segment of segments.slice(0, -1)) {
    const child = owner[segment]
    if (!isObject(child)) return false
    owner = child
  }
  const field = segments.at(-1)!
  if (typeof owner[field] !== 'string' || !samePath(owner[field], mapping.from)) return false
  owner[field] = mapping.to
  return true
}

async function fileMutation(path: string, content: Buffer | undefined, kind: string): Promise<FileMutation> {
  const original = await readFile(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (original && content && original.equals(content)) throw new Error(`Internal error: unchanged mutation ${path}`)
  return { path, content, originalHash: original ? sha256(original) : null, kind }
}

async function planFieldAssistant(appData: string, mappings: PathMapping[], findings: Finding[]): Promise<FileMutation[]> {
  const root = join(appData, 'field-assistant')
  if (!await exists(root)) return []
  const mutations: FileMutation[] = []
  for (const mapping of mappings) {
    const source = join(root, `${sha256(mapping.from)}.json`)
    if (!await exists(source)) continue
    const target = join(root, `${sha256(mapping.to)}.json`)
    const parsed: unknown = JSON.parse(await readFile(source, 'utf8'))
    if (!Array.isArray(parsed)) { findings.push({ kind: 'conflict', source, reason: 'field-assistant history is not an array' }); continue }
    let changed = false
    for (const task of parsed) {
      if (!isObject(task)) continue
      changed = mutateKnownJsonField(task, ['target', 'workItemId'], mapping) || changed
      changed = mutateKnownJsonField(task, ['candidate', 'target', 'workItemId'], mapping) || changed
    }
    if (!changed) { findings.push({ kind: 'conflict', source, reason: 'field-assistant scope file did not contain the expected workItemId' }); continue }
    const content = jsonBuffer(parsed)
    if (!samePath(source, target) && await exists(target)) {
      const current = await readFile(target)
      if (!current.equals(content)) { findings.push({ kind: 'conflict', source, target, reason: 'destination field-assistant history already exists with different content' }); continue }
    } else if (!samePath(source, target)) mutations.push(await fileMutation(target, content, 'field-assistant destination'))
    else mutations.push(await fileMutation(source, content, 'field-assistant scope'))
    if (!samePath(source, target)) mutations.push(await fileMutation(source, undefined, 'field-assistant old scope removal'))
  }
  return mutations
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
}

function normalizedRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

function protectedMirrorPaths(databasePath: string): Set<string> {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    if (!tableExists(db, 'mirror_entries')) return new Set()
    const rows = db.prepare('SELECT relative_path FROM mirror_entries').all() as Array<{ relative_path: string }>
    return new Set(rows.map(row => normalizedRelativePath(String(row.relative_path))))
  } finally {
    db.close()
  }
}

function planProtectedMirror(
  databasePath: string,
  projectId: string,
  mapping: PathMapping,
  field: Extract<(typeof projectJsonFields)[number], { sourceType: string }>,
  originalFileHash: string,
  updatedContent: Buffer
): ProtectedMirrorMutation {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const row = db.prepare(`
      SELECT source_id, source_version_id, relative_path, content_hash
      FROM mirror_entries WHERE project_id = ? AND source_type = ?
    `).get(projectId, field.sourceType) as { source_id: string; source_version_id: string; relative_path: string; content_hash: string } | undefined
    if (!row || normalizedRelativePath(row.relative_path) !== normalizedRelativePath(field.relativePath)) {
      throw new Error(`Registered mirror metadata is missing or ambiguous: ${field.relativePath}`)
    }
    if (row.content_hash !== originalFileHash) throw new Error(`Registered mirror hash does not match the file: ${field.relativePath}`)
    const mutation: ProtectedMirrorMutation = {
      sourceType: field.sourceType,
      sourceId: String(row.source_id),
      relativePath: field.relativePath,
      originalContentHash: String(row.content_hash),
      originalSourceVersionId: String(row.source_version_id),
      updatedContentHash: sha256(updatedContent)
    }
    if (field.sourceType === 'character_state_json') {
      if (!tableExists(db, 'character_state_documents')) throw new Error('Formal character state is missing')
      const document = db.prepare('SELECT content_json, content_hash FROM character_state_documents WHERE project_id = ?').get(projectId) as { content_json: string; content_hash: string } | undefined
      if (!document || sha256(document.content_json) !== document.content_hash) throw new Error('Formal character state hash is invalid')
      const parsed = JSON.parse(document.content_json) as JsonObject
      if (!mutateKnownJsonField(parsed, ['workItemId'], mapping)) throw new Error('Formal character state does not contain the expected old workItemId')
      const nextDocument = JSON.stringify(parsed)
      if (!jsonBuffer(parsed).equals(updatedContent)) throw new Error('Character mirror does not match the migrated formal state')
      mutation.characterDocument = { originalContentHash: document.content_hash, updatedContent: nextDocument, updatedContentHash: sha256(nextDocument) }
    }
    return mutation
  } finally {
    db.close()
  }
}

function planDatabase(path: string, mapping: PathMapping, originalHash: string, sidecarHashes: Record<string, string | null>): { mutation?: DatabaseMutation; historical: Finding[] } {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    if (!tableExists(db, 'projects')) return { historical: [] }
    const historical: Finding[] = []
    for (const [table, column] of [
      ['canonical_event_evidence_refs', 'excerpt'],
      ['canonical_event_versions', 'payload_json'],
      ['context_packages', 'content_json'],
      ['material_sources', 'excerpt'],
    ] as const) {
      if (!tableExists(db, table)) continue
      const count = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE instr(${column}, ?) > 0`).get(mapping.from) as { count: number | bigint }).count)
      if (count) historical.push({ kind: 'historical-preserve', source: `${path}:${table}.${column}`, reason: `${count} historical evidence row(s) retain the old path as provenance` })
    }
    const projects = db.prepare('SELECT id, prompt_work_item_id FROM projects').all() as Array<{ id: string; prompt_work_item_id: string | null }>
    const matching = projects.filter(row => typeof row.prompt_work_item_id === 'string' && samePath(row.prompt_work_item_id, mapping.from))
    let checkpointRows = 0
    if (tableExists(db, 'task_runs')) {
      const rows = db.prepare('SELECT checkpoint_json FROM task_runs WHERE checkpoint_json IS NOT NULL').all() as Array<{ checkpoint_json: string }>
      checkpointRows = rows.filter(row => {
        try { const parsed: unknown = JSON.parse(row.checkpoint_json); return isObject(parsed) && typeof parsed.workItemId === 'string' && samePath(parsed.workItemId, mapping.from) }
        catch { return false }
      }).length
    }
    if (!matching.length && !checkpointRows) return { historical }
    if (matching.length !== 1) throw new Error(`Expected one matching project row in ${path}`)
    const projectId = matching[0]!.id
    const chapterCount = tableExists(db, 'chapters') ? Number((db.prepare('SELECT COUNT(*) AS count FROM chapters WHERE project_id=?').get(projectId) as { count: number | bigint }).count) : 0
    return { mutation: { path, mapping, originalHash, sidecarHashes, projectId, chapterCount, promptRows: matching.length, checkpointRows, protectedMirrors: [] }, historical }
  } finally { db.close() }
}

export async function planMigration(input: { appData: string; worksRoot: string }): Promise<MigrationPlan> {
  const appData = await canonicalDirectory(input.appData)
  const worksRoot = await canonicalDirectory(input.worksRoot)
  const settingsPath = join(appData, 'settings.json')
  const settings = await readJsonObject(settingsPath)
  const projects = await recognizedProjects(worksRoot)
  const findings: Finding[] = []
  const mappings: PathMapping[] = []

  for (const source of collectSettingsPaths(settings)) {
    if (await exists(source)) continue
    const candidates = projects.get(basename(source).toLowerCase()) ?? []
    if (candidates.length === 0) { findings.push({ kind: 'unmatched', source, reason: 'no uniquely named recognized project under works root' }); continue }
    if (candidates.length > 1) { findings.push({ kind: 'conflict', source, reason: 'multiple recognized projects have the same name' }); continue }
    const target = candidates[0]!
    if (!mappings.some(item => samePath(item.from, source))) mappings.push({ from: source, to: target })
    findings.push({ kind: 'rebind', source, target, reason: 'unique recognized project name' })
  }
  if (isObject(settings.autoBackups)) for (const value of Object.values(settings.autoBackups)) {
    if (!isObject(value) || typeof value.targetParentPath !== 'string' || !value.targetParentPath.trim()) continue
    findings.push({ kind: 'external-validate', source: value.targetParentPath, reason: await exists(value.targetParentPath) ? 'external backup target exists and is not rebound' : 'external backup target is unavailable and is not rebound' })
  }

  const targetOwners = new Map<string, string>()
  for (const mapping of mappings) {
    const key = identity(mapping.to), owner = targetOwners.get(key)
    if (owner && !samePath(owner, mapping.from)) findings.push({ kind: 'conflict', source: mapping.from, target: mapping.to, reason: 'multiple old paths map to one destination' })
    else targetOwners.set(key, mapping.from)
  }

  const fileMutations: FileMutation[] = []
  const nextSettings = structuredClone(settings)
  let settingsChanged = false
  if (typeof nextSettings.libraryRoot !== 'string' || !samePath(nextSettings.libraryRoot, worksRoot)) {
    nextSettings.libraryRoot = worksRoot
    settingsChanged = true
  }
  if (!Array.isArray(nextSettings.excludedProjects)) {
    nextSettings.excludedProjects = []
    settingsChanged = true
  }
  if (Array.isArray(nextSettings.recentProjects)) nextSettings.recentProjects = nextSettings.recentProjects.map(value => {
    if (typeof value !== 'string') return value
    const mapping = mappingFor(value, mappings); settingsChanged ||= Boolean(mapping); return mapping?.to ?? value
  })
  if (typeof nextSettings.currentProject === 'string') {
    const mapping = mappingFor(nextSettings.currentProject, mappings); if (mapping) { nextSettings.currentProject = mapping.to; settingsChanged = true }
  }
  for (const [field, lowercase] of [['projectApiKeys', false], ['autoBackups', true]] as const) {
    const result = remapDictionaryKeys(nextSettings[field], mappings, lowercase)
    nextSettings[field] = result.value; settingsChanged ||= result.changed
  }
  if (settingsChanged) fileMutations.push(await fileMutation(settingsPath, jsonBuffer(nextSettings), 'settings operational paths'))
  fileMutations.push(...await planFieldAssistant(appData, mappings, findings))

  const databaseMutations: DatabaseMutation[] = []
  for (const mapping of mappings) {
    const database = join(mapping.to, '.webnovel', 'workspace.sqlite')
    const hasDatabase = await exists(database)
    const protectedMirrors = hasDatabase ? protectedMirrorPaths(database) : new Set<string>()
    let databaseResult: ReturnType<typeof planDatabase> = { historical: [] }
    if (hasDatabase) {
      const original = await readFile(database)
      const sidecarHashes = Object.fromEntries(await Promise.all(['-wal', '-shm'].map(async suffix => [`${database}${suffix}`, await currentHash(`${database}${suffix}`)])))
      databaseResult = planDatabase(database, mapping, sha256(original), sidecarHashes)
      findings.push(...databaseResult.historical)
    }
    for (const field of projectJsonFields) {
      const path = join(mapping.to, field.relativePath)
      if (!await exists(path)) continue
      const parsed = await readJsonObject(path)
      if (mutateKnownJsonField(parsed, field.path, mapping)) {
        if (protectedMirrors.has(normalizedRelativePath(field.relativePath))) {
          if (!('sourceType' in field) || !databaseResult.mutation) throw new Error(`Protected mirror cannot be rebound without its SQLite authority: ${path}`)
          const mutation = await fileMutation(path, jsonBuffer(parsed), `registered ${field.sourceType} readable mirror`)
          databaseResult.mutation.protectedMirrors.push(planProtectedMirror(database, databaseResult.mutation.projectId, mapping, field, mutation.originalHash!, mutation.content!))
          fileMutations.push(mutation)
          continue
        }
        if (containsText(parsed, mapping.from)) findings.push({ kind: 'historical-preserve', source: path, reason: 'non-operational JSON evidence retains the old path' })
        fileMutations.push(await fileMutation(path, jsonBuffer(parsed), `project ${field.path.join('.')}`))
      }
    }
    if (databaseResult.mutation) databaseMutations.push(databaseResult.mutation)
  }
  return { appData, worksRoot, mappings, findings, fileMutations, databaseMutations }
}

async function currentHash(path: string): Promise<string | null> {
  try { return sha256(await readFile(path)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

async function atomicReplace(path: string, content: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.migration.tmp`
  await writeFile(temporary, content)
  try { await rename(temporary, path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
      try { await copyFile(temporary, path); await rm(temporary, { force: true }); return }
      catch (copyError) { await rm(temporary, { force: true }); throw copyError }
    }
    await rm(temporary, { force: true }); throw error
  }
}

function applyDatabaseToCopy(path: string, mutation: DatabaseMutation): void {
  const db = new DatabaseSync(path)
  try {
    db.exec('BEGIN IMMEDIATE')
    const prompt = db.prepare('UPDATE projects SET prompt_work_item_id=? WHERE id=? AND lower(prompt_work_item_id)=lower(?)').run(mutation.mapping.to, mutation.projectId, mutation.mapping.from)
    let checkpoints = 0
    if (tableExists(db, 'task_runs')) {
      const rows = db.prepare('SELECT id, checkpoint_json FROM task_runs WHERE checkpoint_json IS NOT NULL').all() as Array<{ id: string; checkpoint_json: string }>
      const update = db.prepare('UPDATE task_runs SET checkpoint_json=? WHERE id=?')
      for (const row of rows) {
        let parsed: unknown
        try { parsed = JSON.parse(row.checkpoint_json) } catch { continue }
        if (!isObject(parsed) || typeof parsed.workItemId !== 'string' || !samePath(parsed.workItemId, mutation.mapping.from)) continue
        parsed.workItemId = mutation.mapping.to
        update.run(JSON.stringify(parsed), row.id); checkpoints += 1
      }
    }
    const timestamp = new Date().toISOString()
    for (const mirror of mutation.protectedMirrors) {
      if (mirror.characterDocument) {
        const changed = db.prepare(`
          UPDATE character_state_documents
          SET revision = revision + 1, content_json = ?, content_hash = ?, updated_at = ?
          WHERE project_id = ? AND content_hash = ?
        `).run(mirror.characterDocument.updatedContent, mirror.characterDocument.updatedContentHash, timestamp, mutation.projectId, mirror.characterDocument.originalContentHash)
        if (Number(changed.changes) !== 1) throw new Error(`Character state precondition changed: ${mutation.path}`)
      }
      const changed = db.prepare(`
        UPDATE mirror_entries
        SET source_version_id = ?, content_hash = ?, observed_hash = ?, status = 'synced', last_error_code = NULL,
          previous_relative_path = NULL, previous_observed_hash = NULL, updated_at = ?
        WHERE project_id = ? AND source_type = ? AND source_id = ? AND source_version_id = ? AND content_hash = ?
      `).run(mirror.updatedContentHash, mirror.updatedContentHash, mirror.updatedContentHash, timestamp,
        mutation.projectId, mirror.sourceType, mirror.sourceId, mirror.originalSourceVersionId, mirror.originalContentHash)
      if (Number(changed.changes) !== 1) throw new Error(`Mirror metadata precondition changed: ${mirror.relativePath}`)
    }
    if (Number(prompt.changes) !== mutation.promptRows || checkpoints !== mutation.checkpointRows) throw new Error(`SQLite precondition changed: ${mutation.path}`)
    const chapterCount = tableExists(db, 'chapters') ? Number((db.prepare('SELECT COUNT(*) AS count FROM chapters WHERE project_id=?').get(mutation.projectId) as { count: number | bigint }).count) : 0
    if (chapterCount !== mutation.chapterCount) throw new Error(`SQLite chapter invariant changed: ${mutation.path}`)
    db.exec('COMMIT')
  } catch (error) { try { db.exec('ROLLBACK') } catch {} throw error }
  finally { db.close() }
}

export async function applyMigration(plan: MigrationPlan, backupParent?: string): Promise<MigrationReceipt> {
  const conflicts = plan.findings.filter(item => item.kind === 'conflict')
  if (conflicts.length) throw new Error(`Migration has ${conflicts.length} conflict(s)`)
  for (const mutation of plan.fileMutations) if (await currentHash(mutation.path) !== mutation.originalHash) throw new Error(`File changed after planning: ${mutation.path}`)
  for (const mutation of plan.databaseMutations) {
    if (await currentHash(mutation.path) !== mutation.originalHash) throw new Error(`Database changed after planning: ${mutation.path}`)
    for (const [path, hash] of Object.entries(mutation.sidecarHashes)) if (await currentHash(path) !== hash) throw new Error(`SQLite sidecar changed after planning: ${path}`)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupRoot = resolve(backupParent ?? join(dirname(plan.appData), `${basename(plan.appData)}.migration-backups`), stamp)
  await mkdir(dirname(backupRoot), { recursive: true })
  await mkdir(backupRoot, { recursive: false })
  const originals = new Map<string, Buffer | undefined>()
  const backups: MigrationReceipt['backups'] = []
  const allPaths = [...plan.fileMutations.map(item => item.path), ...plan.databaseMutations.flatMap(item => [item.path, ...Object.keys(item.sidecarHashes)])]
  for (const path of new Set(allPaths)) {
    const original = await readFile(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error })
    originals.set(path, original)
    const backupPath = original ? join(backupRoot, `${sha256(path)}-${basename(path)}.bak`) : null
    if (original && backupPath) await writeFile(backupPath, original)
    backups.push({ path, backupPath, originalHash: original ? sha256(original) : null })
  }

  const receipt: MigrationReceipt = {
    mode: 'applied', createdAt: new Date().toISOString(), backupRoot, backups, mappings: plan.mappings,
    changedFiles: plan.fileMutations.map(item => ({ path: item.path, kind: item.kind })),
    databases: plan.databaseMutations.map(item => ({ path: item.path, projectId: item.projectId, chapterCount: item.chapterCount, promptRows: item.promptRows, checkpointRows: item.checkpointRows })),
  }
  await writeFile(join(backupRoot, 'manifest.prepared.json'), jsonBuffer({ ...receipt, mode: 'prepared' }))
  try {
    for (const mutation of plan.databaseMutations) {
      const staged = join(backupRoot, `${sha256(mutation.path)}-staged.sqlite`)
      const source = new DatabaseSync(mutation.path, { readOnly: true })
      try { await sqliteBackup(source, staged) } finally { source.close() }
      applyDatabaseToCopy(staged, mutation)
      await atomicReplace(mutation.path, await readFile(staged))
      for (const sidecar of Object.keys(mutation.sidecarHashes)) await rm(sidecar, { force: true })
    }
    for (const mutation of plan.fileMutations) {
      if (mutation.content) await atomicReplace(mutation.path, mutation.content)
      else await rm(mutation.path)
    }
    await writeFile(join(backupRoot, 'manifest.json'), jsonBuffer(receipt))
    return receipt
  } catch (error) {
    for (const [path, original] of [...originals.entries()].reverse()) {
      if (original) await atomicReplace(path, original).catch(() => undefined)
      else await rm(path, { force: true }).catch(() => undefined)
    }
    await writeFile(join(backupRoot, 'FAILED.txt'), String(error)).catch(() => undefined)
    throw error
  }
}

function publicPlan(plan: MigrationPlan) {
  return {
    mode: 'dry-run', appData: plan.appData, worksRoot: plan.worksRoot, mappings: plan.mappings, findings: plan.findings,
    changes: plan.fileMutations.map(item => ({ path: item.path, kind: item.kind })),
    databases: plan.databaseMutations.map(item => ({ path: item.path, projectId: item.projectId, chapterCount: item.chapterCount, promptRows: item.promptRows, checkpointRows: item.checkpointRows })),
  }
}

async function main(args: string[]): Promise<void> {
  const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
  const appData = value('--app-data'), worksRoot = value('--works-root')
  if (!appData || !worksRoot) throw new Error('Usage: --app-data <directory> --works-root <directory> [--apply --confirm-app-stopped] [--backup-parent <directory>]')
  const plan = await planMigration({ appData, worksRoot })
  if (!args.includes('--apply')) { process.stdout.write(`${JSON.stringify(publicPlan(plan), null, 2)}\n`); return }
  if (!args.includes('--confirm-app-stopped')) throw new Error('--apply requires --confirm-app-stopped')
  process.stdout.write(`${JSON.stringify(await applyMigration(plan, value('--backup-parent')), null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
