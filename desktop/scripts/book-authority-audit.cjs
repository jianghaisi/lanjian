// Internal, read-only audit. Reuse the project's verified snapshot/path boundary.
require('tsx/cjs')
const { DatabaseSync } = require('node:sqlite')
const { createHash } = require('node:crypto')
const { readFile, readdir } = require('node:fs/promises')
const { join } = require('node:path')
const { stableEventReadSnapshot } = require('../src/main/modules/timeline/adapters/event-read-snapshot.ts')
const { canonicalDirectory, projectExistingPath, projectTargetPath } = require('../src/main/platform/storage/project-path.ts')
const { WORKSPACE_DATABASE_SCHEMA_VERSION } = require('../src/main/core/ports/workspace-database.ts')
const { ManuscriptCommitJournal } = require('../src/main/modules/manuscript/adapters/manuscript-commit-journal.ts')
const { ManuscriptTextObjects } = require('../src/main/modules/manuscript/adapters/manuscript-text-objects.ts')
const hash = text => createHash('sha256').update(text).digest('hex')
const populated = text => typeof text === 'string' && Boolean(text.trim())

function fail(code, message) { const error = new Error(message); error.code = code; throw error }
async function readContained(root, relativePath) {
  const target = await projectTargetPath(root, join(root, relativePath))
  try { return await readFile(await projectExistingPath(root, target), 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function files(root, folder, pattern) {
  const directory = await projectTargetPath(root, join(root, folder))
  let names
  try { names = await readdir(await projectExistingPath(root, directory)) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
  const result = []
  for (const name of names) {
    const match = name.match(pattern)
    if (!match) continue
    const relativePath = `${folder}/${name}`
    const content = await readContained(root, relativePath)
    if (content === null) fail('CONFLICT', '文件在核对期间发生变化，请重新检查。')
    result.push({ chapterId: Number(match[1]), relativePath, content })
  }
  return result
}

async function auditBook(projectPath, options = {}) {
  if (options.expectedChapters !== undefined && (!Number.isSafeInteger(options.expectedChapters) || options.expectedChapters < 1 || options.expectedChapters > 100_000)) {
    fail('VALIDATION_ERROR', '预期章节数必须是1到100000的整数。')
  }
  const root = await canonicalDirectory(projectPath)
  const snapshot = await stableEventReadSnapshot(root)
  let database
  let authority = 'files', schemaVersion = null, chapters, outlines, archived = [], mirrorObservations = [], sourceFingerprint = null
  try {
    if (snapshot) {
      sourceFingerprint = snapshot.sourceFingerprint
      database = new DatabaseSync(snapshot.path, { readOnly: true, allowExtension: false })
      database.exec('PRAGMA query_only=ON; BEGIN')
      schemaVersion = Number(database.prepare('PRAGMA user_version').get().user_version)
      if (schemaVersion < 39 || schemaVersion > WORKSPACE_DATABASE_SCHEMA_VERSION) fail('UNSUPPORTED_PROJECT_VERSION', '数据库版本不支持当前审计；未执行升级。')
      if (database.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok') || database.prepare('PRAGMA foreign_key_check').all().length) {
        fail('DATABASE_INTEGRITY_FAILED', '数据库完整性检查失败，未将异常数据计为已完成。')
      }
      const projects = database.prepare('SELECT * FROM projects').all()
      if (projects.length !== 1 || !['sqlite','shadow'].includes(projects[0].storage_mode) || projects[0].current_schema_version !== schemaVersion) {
        fail('INVALID_PROJECT_STATE', '作品身份、存储模式或数据库版本不一致。')
      }
      if (projects[0].storage_mode === 'sqlite') {
        const fileText = projects[0].text_authority === 'files-v1'
        if (projects[0].text_authority !== undefined && !['legacy-sqlite','files-v1'].includes(projects[0].text_authority)) fail('INVALID_PROJECT_STATE', '作品文本权威类型无效。')
        authority = fileText ? 'files-v1' : 'sqlite'
        const currentFiles = new ManuscriptCommitJournal(root)
        const history = new ManuscriptTextObjects(root)
        const materialize = (row, kind, archived = false) => {
          if (!fileText) return row
          const indexedHash = row.contentHash
          let content
          if (archived) {
            const ref = database.prepare('SELECT * FROM manuscript_text_objects WHERE content_hash=?').get(indexedHash)
            if (!ref) fail('DATABASE_INTEGRITY_FAILED', '归档稿件的文件引用缺失。')
            content = history.read({hash:indexedHash,relativePath:ref.relative_path,rangeStart:ref.range_start,rangeEnd:ref.range_end})
          } else {
            const head = database.prepare('SELECT * FROM manuscript_file_heads WHERE document_id=? AND kind=?').get(row.id,kind)
            if (!head) fail('DATABASE_INTEGRITY_FAILED', '当前稿件的文件身份缺失。')
            const current = currentFiles.readCurrent(head.relative_path)
            if (!current) fail('INVALID_PROJECT_STATE', '当前稿件文件缺失，未从历史补写。')
            content = current.content
          }
          return {...row,content,contentHash:hash(content),matchesIndexed:hash(content)===indexedHash}
        }
        const rows = database.prepare(`SELECT c.id,c.legacy_chapter_id AS chapterId,c.status,c.current_body_version_id AS version,
          c.confirmed_body_version_id AS confirmedVersion,b.content,b.content_hash AS contentHash
          FROM chapters c LEFT JOIN body_versions b ON b.id=c.current_body_version_id AND b.chapter_id=c.id
          WHERE c.project_id=? ORDER BY c.seq`).all(projects[0].id).map(row => materialize(row,'body',row.status==='archived'))
        if (rows.some(row => typeof row.content !== 'string' || hash(row.content) !== row.contentHash)) fail('DATABASE_INTEGRITY_FAILED', '正文版本缺失或内容校验失败。')
        archived = rows.filter(row => row.status === 'archived')
        chapters = rows.filter(row => row.status !== 'archived')
        outlines = database.prepare(`SELECT id,legacy_key,content,content_hash AS contentHash FROM outline_nodes
          WHERE project_id=? AND node_type='chapter' AND status<>'archived' ORDER BY seq`).all(projects[0].id)
          .map(row => ({...materialize(row,'outline'), chapterId:Number(row.legacy_key.replace('chapter-',''))}))
        if (outlines.some(row => !Number.isSafeInteger(row.chapterId) || row.chapterId < 1 || hash(row.content) !== row.contentHash)) fail('DATABASE_INTEGRITY_FAILED', '章纲身份或内容校验失败。')
        const archivedIds = new Set(archived.map(row => row.id))
        for (const row of database.prepare('SELECT relative_path,source_type,source_id,status,content_hash FROM mirror_entries WHERE project_id=?').all(projects[0].id)) {
          const content = await readContained(root, row.relative_path)
          const observedHash = content === null ? null : hash(content)
          if (observedHash !== row.content_hash || row.status !== 'synced') mirrorObservations.push({
            path: row.relative_path, recordedStatus: row.status, observed: content === null ? 'missing' : observedHash === row.content_hash ? 'same' : 'different',
            expectedHash: row.content_hash, observedHash,
            archivedChapter: row.source_type === 'chapter_markdown' && archivedIds.has(row.source_id)
          })
        }
      }
    }
    if (authority === 'files') {
      const manifest = await readContained(root, '.webnovel/state.json')
      if (manifest === null) fail('INVALID_PROJECT_STATE', '找不到作品入口，未把普通文件夹当作完整作品。')
      try { const value=JSON.parse(manifest.replace(/^\uFEFF/,'')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error() }
      catch { fail('INVALID_PROJECT_STATE', '作品入口格式损坏。') }
      chapters = await files(root, '正文', /^第(\d+)章(?:-|－).+\.md$/)
      outlines = await files(root, '大纲/章纲', /^第(\d+)章\.md$/)
    }
    const errors = [], warnings = []
    const ids = new Set(chapters.map(row => row.chapterId)), outlineIds = new Set(outlines.map(row => row.chapterId))
    if (ids.size !== chapters.length) errors.push('正文包含重复章节编号')
    if (outlineIds.size !== outlines.length) errors.push('章纲包含重复章节编号')
    const expected = options.expectedChapters ?? Math.max(ids.size, outlineIds.size)
    const missingBodies = [...outlineIds].filter(id => !ids.has(id))
    const missingOutlines = [...ids].filter(id => !outlineIds.has(id))
    if (missingBodies.length) errors.push(`有${missingBodies.length}份章纲尚未建立正文`)
    if (missingOutlines.length) errors.push(`有${missingOutlines.length}章缺少章纲`)
    if (!expected || ids.size !== expected || outlineIds.size !== expected) errors.push('活动正文与章纲数量未达到预期')
    const nonempty = chapters.filter(row => populated(row.content))
    const empty = chapters.filter(row => !populated(row.content)).map(row => row.chapterId)
    const emptyOutlines = outlines.filter(row => !populated(row.content)).map(row => row.chapterId)
    if (emptyOutlines.length) errors.push(`有${emptyOutlines.length}份章纲为空`)
    const externalBodies = await files(root, '正文', /^第(\d+)章(?:-|－).+\.md$/)
    const externalUnadopted = authority === 'sqlite' ? externalBodies.filter(file => {
      const current = chapters.find(row => row.chapterId === file.chapterId)
      return current && populated(file.content) && hash(file.content) !== hash(current.content)
    }).map(file => ({chapterId:file.chapterId,path:file.relativePath,contentHash:hash(file.content)})) : []
    const relevantDifferences = mirrorObservations.filter(row => !row.archivedChapter)
    if (empty.length) warnings.push(`${empty.length}章正式当前正文为空，未算作完成`)
    if (externalUnadopted.length) warnings.push(`${externalUnadopted.length}份外部正文与正式版本不同，未计入正式进度`)
    if (relevantDifferences.length) warnings.push(`${relevantDifferences.length}项${authority === 'files-v1' ? '文件与索引' : '可读镜像'}需要核对`)
    const confirmed = authority !== 'files' ? nonempty.filter(row => row.status === 'confirmed' && row.version === row.confirmedVersion && row.matchesIndexed !== false).length : null
    return {
      authority,schemaVersion,sourceFingerprint,expectedChapters:expected,
      structureValid:errors.length===0, ok:errors.length===0 && relevantDifferences.length===0,
      // Necessary storage prerequisites only; semantic/canon review is never inferred from a byte count.
      readyForFinalReview:expected>0 && errors.length===0 && nonempty.length===expected && confirmed===expected && relevantDifferences.length===0,
      completeNovel:null, completionAssessment:'requires-content-and-author-review',
      activeChapters:chapters.length,archivedChapters:archived.length,bodyPopulated:nonempty.length,bodyConfirmedCurrent:confirmed,
      emptyChapters:empty,missingBodies,missingOutlines,emptyOutlines,
      outlineCoverage:{present:outlines.length,populated:outlines.length-emptyOutlines.length},
      externalUnadopted,mirrorObservations,errors,warnings,
      limitations:['非空正文不等于已完成审校；完整小说须另核对内容、事实链与作者采用。','数据库使用一致只读快照；外部文件可能随后变化，采用时必须重核版本和指纹。']
    }
  } catch (error) {
    if (error.code) throw error
    fail('DATABASE_INTEGRITY_FAILED', '无法安全审计作品结构；没有改写作品。')
  } finally { try { database?.close() } finally { snapshot?.dispose() } }
}
module.exports = { auditBook }
