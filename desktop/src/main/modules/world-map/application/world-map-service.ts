import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import { canonicalDirectory, projectDirectory, projectExistingPath } from '../../../platform/storage/project-path'
import { decodeWorldMapDocument, decodeWorldMapWriteInput, type WorldMapDocument, type WorldMapLayoutView, type WorldMapWriteInput } from '../../../../contracts/world-map/world-map'
import type { ProjectService } from '../../library/application/project-service'
import type { SqliteManuscriptService } from '../../manuscript/application/sqlite-manuscript-service'

type Context = { root: string; workItemId: string }
type RecordView = { view: WorldMapLayoutView; formal: boolean; databaseHash: string | null; fileHash?: string }
const empty = (): WorldMapDocument => ({ version: 1, markers: [] })
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const pathKey = (value: string) => process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value
const conflict = () => new AppError('CONFLICT', '作品或地图已变化，请重新读取地图后再保存。', { recoverable: true })

export class WorldMapService {
  // This is an outer service-operation lane, not SqliteManuscriptService's
  // shared database-write coordinator. Nesting the same coordinator deadlocks.
  private readonly operations = new WorkspaceWriteCoordinator()
  constructor(
    private readonly projects: Pick<ProjectService, 'currentPath' | 'currentSummary'>,
    private readonly authority: Pick<SqliteManuscriptService, 'active' | 'readWorldMapConfig' | 'saveWorldMapConfig'>
  ) {}

  async read(): Promise<WorldMapLayoutView> {
    const context = await this.context()
    const result = await this.readAt(context)
    await this.assertCurrent(context)
    return result.view
  }

  async write(value: WorldMapWriteInput): Promise<WorldMapLayoutView> {
    const input = decodeWorldMapWriteInput(value)
    const context = await this.context()
    if (input.workItemId !== context.workItemId) throw conflict()
    return this.operations.run(context.root, async () => {
      await this.assertCurrent(context)
      const current = await this.readAt(context)
      if (input.expectedRevision !== current.view.revision) throw conflict()
      const guard = async () => {
        await this.assertCurrent(context)
        const latest = await this.readAt(context)
        if (latest.view.revision !== input.expectedRevision || latest.formal !== current.formal) throw conflict()
        await this.assertCurrent(context)
      }
      if (current.formal) {
        const receipt = await this.authority.saveWorldMapConfig(context.root, {
          content: JSON.stringify(input.document), expectedContentHash: current.databaseHash, observedMirrorHash: current.fileHash
        }, guard)
        await this.assertCurrent(context)
        // Mirror failure is not a failed formal save. Return the committed DB
        // receipt rather than making success depend on reading that mirror again.
        return { workItemId: context.workItemId, document: this.decodeStored(receipt.content),
          revision: this.revision(context, 'sqlite', `${receipt.revision}:${receipt.contentHash}`), mirrorStatus: receipt.mirrorStatus }
      } else {
        const target = await projectDirectory(context.root, join(context.root, '.webnovel', 'config', 'world-map.json'))
        await guard()
        await mkdir(dirname(target), { recursive: true })
        // Recheck after directory setup; neither stale UI nor a changed file may
        // be overwritten just because the save waited behind another operation.
        await guard()
        await projectDirectory(context.root, target)
        await atomicWriteText(target, `${JSON.stringify(input.document, null, 2)}\n`)
      }
      const result = await this.readAt(context)
      await this.assertCurrent(context)
      return result.view
    })
  }

  private async context(): Promise<Context> {
    const root = await canonicalDirectory(await this.projects.currentPath())
    const summary = await this.projects.currentSummary()
    if (pathKey(root) !== pathKey(await canonicalDirectory(summary.path))) throw conflict()
    return { root, workItemId: summary.id }
  }

  private async assertCurrent(expected: Context): Promise<void> {
    const current = await this.context()
    if (pathKey(current.root) !== pathKey(expected.root) || current.workItemId !== expected.workItemId) throw conflict()
  }

  private revision(context: Context, source: string, identity: string): string {
    return hash(JSON.stringify([pathKey(context.root), context.workItemId, source, identity]))
  }

  private async readFileAt(context: Context): Promise<string | null> {
    const path = join(context.root, '.webnovel', 'config', 'world-map.json')
    try { return await readFile(await projectExistingPath(context.root, path), 'utf8') }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
      await projectDirectory(context.root, path)
      return null
    }
  }

  private decodeStored(content: string): WorldMapDocument {
    try { return decodeWorldMapDocument(JSON.parse(content)) }
    catch (cause) { throw new AppError('INVALID_PROJECT_STATE', '小说地图文件或记录已损坏，原数据保留，没有重置地图。', { recoverable: true, cause }) }
  }

  private async readAt(context: Context): Promise<RecordView> {
    const formal = await this.authority.active(context.root)
    const database = formal ? await this.authority.readWorldMapConfig(context.root) : null
    let file: string | null = null, mirrorFailed = false
    try { file = await this.readFileAt(context) }
    catch (error) {
      if (!database || !error || typeof error !== 'object' || !('code' in error)
        || !['EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'EIO', 'EBUSY', 'EMFILE', 'ENFILE'].includes(String(error.code))) throw error
      mirrorFailed = true
    }
    if (database) {
      const document = this.decodeStored(database.content)
      const expectedMirrorHash = hash(`${JSON.stringify(document, null, 2)}\n`)
      const mirrorStatus = mirrorFailed ? 'failed' : file === null ? (database.mirrorStatus === 'failed' ? 'failed' : 'pending')
        : hash(file) !== expectedMirrorHash ? 'conflict' : database.mirrorStatus
      return { formal, databaseHash: database.contentHash, view: {
        workItemId: context.workItemId, document,
        revision: this.revision(context, 'sqlite', `${database.revision}:${database.contentHash}`), mirrorStatus
      } }
    }
    const document = file === null ? empty() : this.decodeStored(file)
    const fileHash = file === null ? undefined : hash(file)
    return { formal, databaseHash: null, fileHash, view: {
      workItemId: context.workItemId, document, mirrorStatus: null,
      revision: this.revision(context, formal ? 'sqlite-uninitialized' : 'files', fileHash ?? 'missing')
    } }
  }
}
