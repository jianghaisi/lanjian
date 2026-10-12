import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, link, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { canonicalDirectory, projectExistingPath, projectTargetPath } from '../../../platform/storage/project-path'
import {
  canonicalJson, decodeBlindPacket, decodeIdentityMap, decodeQualityReport,
  type BlindPacketV1, type GenerationAttemptEventV1, type IdentityMapV1, type QualityReportV1, type TrialManifestV1
} from '../domain/writing-quality-protocol'

const runIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/
const fileIdPattern = /^[a-z0-9][a-z0-9-]{0,95}$/

export class WritingQualityRunStore {
  readonly outputParent: string
  readonly collectionRoot: string
  readonly runRoot: string
  readonly runId: string
  private appendLane: Promise<void> = Promise.resolve()

  private constructor(outputParent: string, collectionRoot: string, runRoot: string, runId: string) {
    this.outputParent = outputParent
    this.collectionRoot = collectionRoot
    this.runRoot = runRoot
    this.runId = runId
  }

  static async open(outputParent: string, runId: string): Promise<WritingQualityRunStore> {
    if (!runIdPattern.test(runId)) throw new AppError('VALIDATION_ERROR', '离线质量实验 run-id 无效')
    const parent = await canonicalDirectory(outputParent)
    const collectionTarget = await projectTargetPath(parent, join(parent, 'writing-quality'))
    await mkdir(collectionTarget, { recursive: true })
    const collection = await canonicalDirectory(collectionTarget)
    assertInside(parent, collection)
    const runTarget = await projectTargetPath(collection, join(collection, runId))
    await mkdir(runTarget, { recursive: true })
    const runRoot = await canonicalDirectory(runTarget)
    assertInside(collection, runRoot)
    return new WritingQualityRunStore(parent, collection, runRoot, runId)
  }

  async readManifest(): Promise<TrialManifestV1 | null> { return this.readOptionalJson('manifest.json') }
  async writeManifest(value: TrialManifestV1): Promise<void> { await this.writeImmutableJson('manifest.json', value) }
  async readIdentityMap(): Promise<IdentityMapV1 | null> {
    const value = await this.readOptionalJson('identity-map.json')
    return value === null ? null : decodeIdentityMap(value)
  }
  async writeIdentityMap(value: IdentityMapV1): Promise<void> { await this.writeImmutableJson('identity-map.json', value) }
  async readReport(): Promise<QualityReportV1 | null> {
    const value = await this.readOptionalJson('report.json')
    return value === null ? null : decodeQualityReport(value)
  }
  async writeReport(value: QualityReportV1): Promise<void> { await this.atomicWrite('report.json', `${canonicalJson(value)}\n`, true) }

  async readAttemptValues(): Promise<unknown[]> {
    await this.verifyRoot()
    const path = join(this.runRoot, 'attempts.jsonl')
    let content: string
    try { content = await readFile(await projectExistingPath(this.runRoot, path), 'utf8') }
    catch (error) { if (missing(error)) return []; throw storageError('无法读取实验事件账本', error) }
    if (content === '') return []
    if (!content.endsWith('\n')) throw new AppError('VALIDATION_ERROR', '实验事件账本存在未完成的尾行')
    const lines = content.slice(0, -1).split('\n')
    if (lines.some(line => line.trim() === '')) throw new AppError('VALIDATION_ERROR', '实验事件账本包含空行')
    return lines.map((line, index) => {
      try { return JSON.parse(line) as unknown }
      catch (error) { throw new AppError('VALIDATION_ERROR', `实验事件账本第 ${index + 1} 行不是有效 JSON`, { cause: error }) }
    })
  }

  appendAttempt(event: GenerationAttemptEventV1): Promise<void> {
    const operation = this.appendLane.then(() => this.appendLine('attempts.jsonl', canonicalJson(event)))
    this.appendLane = operation.then(() => undefined, () => undefined)
    return operation
  }

  async writeOutput(outputId: string, content: string): Promise<void> {
    assertFileId(outputId)
    await this.writeImmutableText(join('outputs', `${outputId}.txt`), content)
  }

  async readOutput(outputId: string): Promise<string> {
    assertFileId(outputId)
    return this.readRequiredText(join('outputs', `${outputId}.txt`))
  }

  async writePacket(packet: BlindPacketV1): Promise<void> {
    assertFileId(packet.packetId)
    await this.writeImmutableJson(join('packets', `${packet.packetId}.json`), packet)
  }

  async readPacket(packetId: string): Promise<BlindPacketV1> {
    assertFileId(packetId)
    const value = await this.readOptionalJson<BlindPacketV1>(join('packets', `${packetId}.json`))
    if (!value) throw new AppError('NOT_FOUND', '盲评包不存在')
    return decodeBlindPacket(value)
  }

  private async appendLine(relativePath: string, line: string): Promise<void> {
    await this.verifyRoot()
    const path = await projectTargetPath(this.runRoot, join(this.runRoot, relativePath))
    await mkdir(dirname(path), { recursive: true })
    await this.verifyRoot()
    const handle = await open(path, 'a')
    try { await handle.writeFile(`${line}\n`, 'utf8'); await handle.sync() }
    catch (error) { throw storageError('无法追加实验事件账本', error) }
    finally { await handle.close() }
  }

  private async writeImmutableJson(relativePath: string, value: unknown): Promise<void> {
    await this.atomicWrite(relativePath, `${canonicalJson(value)}\n`, false)
  }

  private async writeImmutableText(relativePath: string, value: string): Promise<void> {
    await this.atomicWrite(relativePath, value, false)
  }

  private async atomicWrite(relativePath: string, content: string, overwrite: boolean): Promise<void> {
    await this.verifyRoot()
    const target = await projectTargetPath(this.runRoot, join(this.runRoot, relativePath))
    await mkdir(dirname(target), { recursive: true })
    await this.verifyRoot()
    if (!overwrite && await exists(target)) throw new AppError('CONFLICT', '实验产物已存在，拒绝覆盖')
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx')
    try { await handle.writeFile(content, 'utf8'); await handle.sync() }
    catch (error) { await handle.close(); await rm(temporary, { force: true }); throw storageError('无法写入实验临时文件', error) }
    await handle.close()
    try {
      await this.verifyRoot()
      await projectTargetPath(this.runRoot, target)
      if (overwrite) await rename(temporary, target)
      else {
        await link(temporary, target)
        await rm(temporary)
      }
    } catch (error) {
      await rm(temporary, { force: true })
      if (error instanceof AppError) throw error
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError('CONFLICT', '实验产物已存在，拒绝覆盖')
      throw storageError('无法提交实验产物', error)
    }
  }

  private async readOptionalJson<T>(relativePath: string): Promise<T | null> {
    let content: string
    try { content = await this.readRequiredText(relativePath) }
    catch (error) { if (missing(error)) return null; throw error }
    try { return JSON.parse(content) as T }
    catch (error) { throw new AppError('VALIDATION_ERROR', '实验 JSON 产物无效', { cause: error }) }
  }

  private async readRequiredText(relativePath: string): Promise<string> {
    await this.verifyRoot()
    const path = await projectExistingPath(this.runRoot, join(this.runRoot, relativePath))
    try { return await readFile(path, 'utf8') }
    catch (error) { if (missing(error)) throw error; throw storageError('无法读取实验产物', error) }
  }

  private async verifyRoot(): Promise<void> {
    let current: string
    try { current = await realpath(this.runRoot) }
    catch (error) { throw storageError('实验运行目录不可用', error) }
    if (!samePath(current, this.runRoot)) throw new AppError('PATH_ESCAPE', '实验运行目录已被替换')
    assertInside(this.collectionRoot, current)
  }
}

function assertFileId(value: string): void {
  if (!fileIdPattern.test(value)) throw new AppError('VALIDATION_ERROR', '实验文件标识无效')
}

function assertInside(root: string, candidate: string): void {
  const normalizedRoot = normalize(root)
  const normalizedCandidate = normalize(candidate)
  const value = relative(normalizedRoot, normalizedCandidate)
  if (value === '' || (!isAbsolute(value) && !value.startsWith(`..${sep}`) && value !== '..')) return
  throw new AppError('PATH_ESCAPE', '实验路径超出了输出目录')
}

function normalize(value: string): string { return process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value }
function samePath(left: string, right: string): boolean { return normalize(resolve(left)) === normalize(resolve(right)) }
async function exists(path: string): Promise<boolean> { try { await access(path, constants.F_OK); return true } catch (error) { if (missing(error)) return false; throw error } }
function missing(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') }
function storageError(message: string, cause: unknown): AppError { return new AppError('STORAGE_ERROR', message, { cause }) }
