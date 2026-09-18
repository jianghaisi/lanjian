import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { applyMigration, planMigration } from './rebind-migrated-workspace'

test('workspace migration updates only operational identities and preserves stable content', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const appData = join(root, 'app-data'), worksRoot = join(root, '作品'), project = join(worksRoot, '迁移作品')
  const old = 'E:\\旧目录\\作品\\迁移作品'
  await mkdir(join(appData, 'field-assistant'), { recursive: true })
  await mkdir(join(project, '.webnovel', 'config'), { recursive: true })
  await mkdir(join(project, '.webnovel', 'planning'), { recursive: true })
  await mkdir(join(project, '正文'), { recursive: true })
  const canonicalProject = await realpath(project)
  const externalBackup = join(root, 'external-backups')
  await mkdir(externalBackup)
  const settings = { recentProjects: [old, 'E:\\旧目录\\作品\\无法匹配'], currentProject: old, projectApiKeys: { [old]: { private: 'encrypted-value' } }, autoBackups: { [old.toLowerCase()]: { enabled: true, targetParentPath: externalBackup } } }
  await writeFile(join(appData, 'settings.json'), JSON.stringify(settings))
  const hash = (await import('node:crypto')).createHash('sha256').update(old).digest('hex')
  await writeFile(join(appData, 'field-assistant', `${hash}.json`), JSON.stringify([{ id: 'task', target: { workItemId: old }, candidate: { target: { workItemId: old } } }]))
  await writeFile(join(project, '.webnovel', 'config', 'prompt-profile.json'), JSON.stringify({ workItemId: old, historicalNote: `Imported from ${old}` }))
  await writeFile(join(project, '.webnovel', 'planning', 'automatic-planning-draft.json'), JSON.stringify({ proposal: { workItemId: old }, evidence: old }))
  const dbPath = join(project, '.webnovel', 'workspace.sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, prompt_work_item_id TEXT); CREATE TABLE chapters (id TEXT, project_id TEXT, content TEXT); CREATE TABLE task_runs (id TEXT PRIMARY KEY, checkpoint_json TEXT);')
  db.prepare('INSERT INTO projects VALUES (?, ?)').run('stable-project-id', old)
  db.prepare('INSERT INTO chapters VALUES (?, ?, ?)').run('chapter-1', 'stable-project-id', `正文保留 ${old}`)
  db.prepare('INSERT INTO task_runs VALUES (?, ?)').run('run-1', JSON.stringify({ workItemId: old, evidence: old }))
  db.close()

  const plan = await planMigration({ appData, worksRoot })
  assert.equal(plan.mappings.length, 1)
  assert.equal(plan.findings.filter(item => item.kind === 'unmatched').length, 1)
  assert.equal(plan.findings.filter(item => item.kind === 'external-validate').length, 1)
  assert.equal(plan.findings.filter(item => item.kind === 'historical-preserve').length, 2)
  assert.equal(plan.databaseMutations[0]?.projectId, 'stable-project-id')
  assert.equal(JSON.parse(await readFile(join(appData, 'settings.json'), 'utf8')).currentProject, old, 'dry-run must not write')

  const receipt = await applyMigration(plan, join(root, 'backups'))
  assert.equal(receipt.databases[0]?.chapterCount, 1)
  assert.ok(receipt.backups.some(item => item.path.endsWith('settings.json') && item.backupPath))
  assert.equal(JSON.parse(await readFile(join(receipt.backupRoot, 'manifest.json'), 'utf8')).mode, 'applied')
  const migratedSettings = JSON.parse(await readFile(join(appData, 'settings.json'), 'utf8'))
  assert.equal(migratedSettings.currentProject, canonicalProject)
  assert.equal(migratedSettings.libraryRoot, await realpath(worksRoot))
  assert.deepEqual(migratedSettings.excludedProjects, [])
  assert.deepEqual(migratedSettings.projectApiKeys[canonicalProject], { private: 'encrypted-value' })
  assert.equal(migratedSettings.recentProjects[1], 'E:\\旧目录\\作品\\无法匹配')
  const prompt = JSON.parse(await readFile(join(project, '.webnovel', 'config', 'prompt-profile.json'), 'utf8'))
  assert.equal(prompt.workItemId, canonicalProject)
  assert.equal(prompt.historicalNote, `Imported from ${old}`)
  const migratedDb = new DatabaseSync(dbPath, { readOnly: true })
  assert.equal((migratedDb.prepare('SELECT prompt_work_item_id FROM projects').get() as { prompt_work_item_id: string }).prompt_work_item_id, canonicalProject)
  assert.equal((migratedDb.prepare('SELECT content FROM chapters').get() as { content: string }).content, `正文保留 ${old}`)
  const checkpoint = JSON.parse((migratedDb.prepare('SELECT checkpoint_json FROM task_runs').get() as { checkpoint_json: string }).checkpoint_json)
  assert.equal(checkpoint.workItemId, canonicalProject)
  assert.equal(checkpoint.evidence, old)
  migratedDb.close()
})

test('workspace migration refuses ambiguous project names', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const appData = join(root, 'app-data'), worksRoot = join(root, '作品'), old = 'E:\\旧目录\\作品\\同名作品'
  await mkdir(appData, { recursive: true })
  await mkdir(join(worksRoot, '同名作品', '正文'), { recursive: true })
  await writeFile(join(appData, 'settings.json'), JSON.stringify({ recentProjects: [old] }))
  const plan = await planMigration({ appData, worksRoot })
  plan.findings.push({ kind: 'conflict', source: old, reason: 'synthetic duplicate candidate' })
  await assert.rejects(applyMigration(plan, join(root, 'backups')), /conflict/)
})

test('workspace migration updates registered mirrors together with SQLite authority', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const appData = join(root, 'app-data'), worksRoot = join(root, '作品'), project = join(worksRoot, '受保护作品')
  const old = 'E:\\旧目录\\作品\\受保护作品'
  await mkdir(appData, { recursive: true })
  await mkdir(join(project, '.webnovel', 'config'), { recursive: true })
  await mkdir(join(project, '.webnovel', 'planning'), { recursive: true })
  await mkdir(join(project, '.webnovel', 'story-state'), { recursive: true })
  await writeFile(join(appData, 'settings.json'), JSON.stringify({ recentProjects: [old], currentProject: old }))
  const promptPath = join(project, '.webnovel', 'config', 'prompt-profile.json')
  const characterPath = join(project, '.webnovel', 'story-state', 'characters.json')
  const draftPath = join(project, '.webnovel', 'planning', 'automatic-planning-draft.json')
  const prompt = `${JSON.stringify({ workItemId: old }, null, 2)}\n`
  const character = `${JSON.stringify({ workItemId: old, characters: [] }, null, 2)}\n`
  const characterDocument = JSON.stringify({ workItemId: old, characters: [] })
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  await writeFile(promptPath, prompt)
  await writeFile(characterPath, character)
  await writeFile(draftPath, JSON.stringify({ proposal: { workItemId: old } }))
  const dbPath = join(project, '.webnovel', 'workspace.sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, prompt_work_item_id TEXT);
    CREATE TABLE chapters (id TEXT, project_id TEXT);
    CREATE TABLE character_state_documents (project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, content_json TEXT NOT NULL, content_hash TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE mirror_entries (
      project_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, source_version_id TEXT NOT NULL,
      relative_path TEXT NOT NULL, content_hash TEXT NOT NULL, observed_hash TEXT, status TEXT NOT NULL,
      last_error_code TEXT, previous_relative_path TEXT, previous_observed_hash TEXT, updated_at TEXT NOT NULL
    );
  `)
  db.prepare('INSERT INTO projects VALUES (?, ?)').run('stable-project-id', old)
  db.prepare('INSERT INTO character_state_documents VALUES (?, 1, ?, ?, ?)').run('stable-project-id', characterDocument, hash(characterDocument), new Date(0).toISOString())
  const insertMirror = db.prepare('INSERT INTO mirror_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)')
  insertMirror.run('stable-project-id', 'prompt_profile_json', 'stable-project-id', hash(prompt), '.webnovel/config/prompt-profile.json', hash(prompt), hash(prompt), 'synced', new Date(0).toISOString())
  insertMirror.run('stable-project-id', 'character_state_json', 'stable-project-id', hash(character), '.webnovel/story-state/characters.json', hash(character), hash(character), 'synced', new Date(0).toISOString())
  db.close()

  const plan = await planMigration({ appData, worksRoot })
  assert.equal(plan.fileMutations.some(item => item.path.endsWith('prompt-profile.json')), true)
  assert.equal(plan.fileMutations.some(item => item.path.endsWith('characters.json')), true)
  assert.equal(plan.fileMutations.some(item => item.path.endsWith('automatic-planning-draft.json')), true)
  assert.equal(plan.databaseMutations[0]?.protectedMirrors.length, 2)

  await applyMigration(plan, join(root, 'backups'))
  const canonicalProject = await realpath(project)
  assert.equal(JSON.parse(await readFile(promptPath, 'utf8')).workItemId, canonicalProject)
  assert.equal(JSON.parse(await readFile(characterPath, 'utf8')).workItemId, canonicalProject)
  assert.equal(JSON.parse(await readFile(draftPath, 'utf8')).proposal.workItemId, canonicalProject)
  const migratedDb = new DatabaseSync(dbPath, { readOnly: true })
  const migratedCharacter = migratedDb.prepare('SELECT revision, content_json, content_hash FROM character_state_documents').get() as { revision: number; content_json: string; content_hash: string }
  assert.equal(migratedCharacter.revision, 2)
  assert.equal(JSON.parse(migratedCharacter.content_json).workItemId, canonicalProject)
  assert.equal(migratedCharacter.content_hash, hash(migratedCharacter.content_json))
  for (const mirror of migratedDb.prepare('SELECT relative_path, content_hash, observed_hash, status FROM mirror_entries').all() as Array<{ relative_path: string; content_hash: string; observed_hash: string; status: string }>) {
    const content = await readFile(join(project, mirror.relative_path))
    assert.equal(mirror.content_hash, createHash('sha256').update(content).digest('hex'))
    assert.equal(mirror.observed_hash, mirror.content_hash)
    assert.equal(mirror.status, 'synced')
  }
  migratedDb.close()
})

test('workspace migration stops before writes when a registered mirror already drifted', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const appData = join(root, 'app-data'), worksRoot = join(root, '作品'), project = join(worksRoot, '冲突作品')
  const old = 'E:\\旧目录\\作品\\冲突作品'
  await mkdir(appData, { recursive: true })
  await mkdir(join(project, '.webnovel', 'config'), { recursive: true })
  const settingsPath = join(appData, 'settings.json')
  const promptPath = join(project, '.webnovel', 'config', 'prompt-profile.json')
  const settings = JSON.stringify({ recentProjects: [old], currentProject: old })
  const prompt = `${JSON.stringify({ workItemId: old }, null, 2)}\n`
  await writeFile(settingsPath, settings)
  await writeFile(promptPath, prompt)
  const db = new DatabaseSync(join(project, '.webnovel', 'workspace.sqlite'))
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, prompt_work_item_id TEXT);
    CREATE TABLE chapters (id TEXT, project_id TEXT);
    CREATE TABLE mirror_entries (
      project_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, source_version_id TEXT NOT NULL,
      relative_path TEXT NOT NULL, content_hash TEXT NOT NULL, observed_hash TEXT, status TEXT NOT NULL,
      last_error_code TEXT, previous_relative_path TEXT, previous_observed_hash TEXT, updated_at TEXT NOT NULL
    );
  `)
  db.prepare('INSERT INTO projects VALUES (?, ?)').run('stable-project-id', old)
  db.prepare('INSERT INTO mirror_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)').run(
    'stable-project-id', 'prompt_profile_json', 'stable-project-id', 'a'.repeat(64), '.webnovel/config/prompt-profile.json',
    'a'.repeat(64), 'a'.repeat(64), 'synced', new Date(0).toISOString()
  )
  db.close()

  await assert.rejects(planMigration({ appData, worksRoot }), /Registered mirror hash does not match/)
  assert.equal(await readFile(settingsPath, 'utf8'), settings)
  assert.equal(await readFile(promptPath, 'utf8'), prompt)
})
