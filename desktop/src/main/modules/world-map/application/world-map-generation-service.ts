import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { atomicWriteBuffer } from '../../../platform/storage/atomic-file'
import { inspectImage, type GeneratedImage } from '../../models/adapters/openai-compatible-image-client'
import { canonicalDirectory, projectDirectory, projectExistingPath } from '../../../platform/storage/project-path'
import type { BookProfile, FoundationData, ProjectSummary } from '../../../../contracts/index'
import { decodeWorldMapImageAdoptInput, decodeWorldMapImageGenerateInput, decodeWorldMapOperationId, type WorldMapBackgroundView, type WorldMapImageAdoptInput, type WorldMapImageCandidate, type WorldMapImageGenerateInput, type WorldMapLayoutView, type WorldMapStylePreset, type WorldMapView } from '../../../../contracts/world-map/world-map'
import { buildWorldMapPrompt, worldMapStylePrompt } from './world-map-prompt'
import type { WorldMapPromptSummary } from '../../../../contracts/world-map/world-map'
import { creativePolicyRun, type CaptureCreativePolicy } from '../../writing-plugins/domain/creative-policy'

type Projects = { currentPath(): Promise<string>; currentSummary(): Promise<ProjectSummary> }
type Workspace = { read(): Promise<WorldMapView> }
type Context = { bookProfile(): Promise<BookProfile>; foundation(readOnly?: boolean): Promise<FoundationData> }
type MapStore = { read(): Promise<WorldMapLayoutView>; write(input: { workItemId: string; expectedRevision: string; document: WorldMapView['document'] }, beforeWrite?: () => Promise<void>): Promise<WorldMapLayoutView> }
type ImageGenerator = { generate(connectionId: string, model: string, prompt: string, signal?: AbortSignal, beforeSend?: () => Promise<void>): Promise<GeneratedImage & { connectionName: string }> }
type Source = { view: WorldMapView; project: ProjectSummary; prompt: string; sourceFingerprint: string; basisHash: string; promptSummary: WorldMapPromptSummary }
type Prepared = { root: string; methods: string; source: Source; assertActive(): Promise<Source> }
type CandidateRecord = { id: string; workItemId: string; expectedRevision: string; sourceFingerprint: string; style: WorldMapStylePreset; model: string; image: GeneratedImage; connectionName: string; expiresAt: number; prepared: Prepared }

const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const
const conflict = () => new AppError('CONFLICT', '作品或地图内容已经变化，请重新生成底图。', { recoverable: true })
const keyPath = (value: string) => process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value

export class WorldMapGenerationService {
  private candidate: CandidateRecord | null = null
  private readonly running = new Map<string, { workItemId: string; controller: AbortController }>()

  constructor(
    private readonly projects: Projects,
    private readonly workspace: Workspace,
    private readonly context: Context,
    private readonly map: MapStore,
    private readonly images: ImageGenerator,
    private readonly now: () => number = Date.now,
    private readonly capturePolicy: CaptureCreativePolicy = async () => creativePolicyRun()
  ) {}

  async generate(value: WorldMapImageGenerateInput): Promise<WorldMapImageCandidate> {
    const input = decodeWorldMapImageGenerateInput(value)
    const prepared = await this.prepare(input.stylePreset), source = prepared.source
    if (source.project.id !== input.workItemId || source.view.revision !== input.expectedRevision) throw conflict()
    await this.cancelRunningFor(input.workItemId)
    const controller = new AbortController()
    const owned = { workItemId: input.workItemId, controller }
    this.running.set(input.operationId, owned)
    const guard = async () => {
      controller.signal.throwIfAborted()
      if (this.running.get(input.operationId) !== owned) throw conflict()
      await prepared.assertActive()
      controller.signal.throwIfAborted()
      if (this.running.get(input.operationId) !== owned) throw conflict()
    }
    try {
      await guard()
      const generated = await this.images.generate(input.connectionId, input.model, source.prompt, controller.signal, guard)
      await guard()
      const image = { ...generated, bytes: Buffer.from(generated.bytes) }
      const id = createHash('sha256').update(randomUUID()).update(image.bytes).digest('hex')
      this.candidate = { id, workItemId: input.workItemId, expectedRevision: input.expectedRevision, sourceFingerprint: source.sourceFingerprint,
        style: input.stylePreset, model: input.model.trim(), image, connectionName: image.connectionName, expiresAt: this.now() + 30 * 60_000, prepared }
      return { candidateId: id, workItemId: input.workItemId, expectedRevision: input.expectedRevision, sourceFingerprint: source.sourceFingerprint,
        stylePreset: input.stylePreset, model: input.model.trim(), connectionName: image.connectionName, promptSummary: source.promptSummary,
        image: { dataUrl: `data:${mime[image.format]};base64,${image.bytes.toString('base64')}`, format: image.format, width: image.width, height: image.height } }
    } finally {
      if (this.running.get(input.operationId) === owned) this.running.delete(input.operationId)
    }
  }

  async cancel(value: string): Promise<{ cancelled: boolean }> {
    const operationId = decodeWorldMapOperationId(value)
    const running = this.running.get(operationId)
    if (!running) return { cancelled: false }
    const summary = await this.projects.currentSummary()
    if (summary.id !== running.workItemId) return { cancelled: false }
    running.controller.abort(); this.running.delete(operationId)
    return { cancelled: true }
  }

  async adopt(value: WorldMapImageAdoptInput): Promise<WorldMapLayoutView> {
    const input = decodeWorldMapImageAdoptInput(value)
    const candidate = this.liveCandidate(input.candidateId)
    if (candidate.workItemId !== input.workItemId || candidate.expectedRevision !== input.expectedRevision) throw conflict()
    const source = await candidate.prepared.assertActive()
    if (source.project.id !== input.workItemId || source.view.revision !== input.expectedRevision || source.sourceFingerprint !== candidate.sourceFingerprint) throw conflict()
    const root = await canonicalDirectory(await this.projects.currentPath())
    if (keyPath(root) !== keyPath(candidate.prepared.root) || keyPath(root) !== keyPath(await canonicalDirectory(source.project.path))) throw conflict()
    const guard = async () => { await candidate.prepared.assertActive() }
    const assetId = createHash('sha256').update(candidate.image.bytes).digest('hex')
    const target = await projectDirectory(root, join(root, '.webnovel', 'assets', 'world-map', `${assetId}.${candidate.image.format}`))
    await mkdir(dirname(target), { recursive: true })
    let exists = false
    try {
      const current = await readFile(await projectExistingPath(root, target)); exists = true
      if (createHash('sha256').update(current).digest('hex') !== assetId) throw new AppError('INVALID_PROJECT_STATE', '地图图片资产与记录不一致，原文件已保留。', { recoverable: true })
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
    }
    if (!exists) { await projectDirectory(root, target); await atomicWriteBuffer(target, candidate.image.bytes, guard) }
    const result = await this.map.write({ workItemId: input.workItemId, expectedRevision: input.expectedRevision, document: {
      version: 2, markers: source.view.document.markers.map(marker => ({ ...marker })), background: {
        assetId, format: candidate.image.format, width: candidate.image.width, height: candidate.image.height,
        stylePreset: candidate.style, model: candidate.model, generatedAt: new Date(this.now()).toISOString(), sourceFingerprint: candidate.sourceFingerprint
      }
    } }, guard)
    if (this.candidate === candidate) this.candidate = null
    return result
  }

  async background(): Promise<WorldMapBackgroundView> {
    const [layout, summary, root] = await Promise.all([this.map.read(), this.projects.currentSummary(), canonicalDirectory(await this.projects.currentPath())])
    if (layout.workItemId !== summary.id || keyPath(root) !== keyPath(await canonicalDirectory(summary.path))) throw conflict()
    const item = layout.document.version === 2 ? layout.document.background : null
    if (!item) return null
    const target = join(root, '.webnovel', 'assets', 'world-map', `${item.assetId}.${item.format}`)
    let bytes: Buffer
    try { bytes = await readFile(await projectExistingPath(root, target)) }
    catch (cause) { throw new AppError('INVALID_PROJECT_STATE', '地图底图文件不可用，地点和事件仍然保留。可以重新生成底图。', { recoverable: true, cause }) }
    if (createHash('sha256').update(bytes).digest('hex') !== item.assetId) throw new AppError('INVALID_PROJECT_STATE', '地图底图校验失败，地点和事件仍然保留。', { recoverable: true })
    const checked = inspectImage(bytes)
    if (checked.format !== item.format || checked.width !== item.width || checked.height !== item.height) throw new AppError('INVALID_PROJECT_STATE', '地图底图尺寸或格式与记录不一致，原文件已保留。', { recoverable: true })
    return { workItemId: summary.id, assetId: item.assetId, dataUrl: `data:${mime[item.format]};base64,${bytes.toString('base64')}`, width: item.width, height: item.height }
  }

  private async source(style: WorldMapStylePreset, methods: string): Promise<Source> {
    const read = async (): Promise<Source> => {
      const [view, profile, foundation, summary] = await Promise.all([this.workspace.read(), this.context.bookProfile(), this.context.foundation(true), this.projects.currentSummary()])
      if (view.workItemId !== summary.id) throw conflict()
      const built = buildWorldMapPrompt({ summary, profile, foundation, view }, style, methods)
      const basisHash = createHash('sha256').update(JSON.stringify({ workItemId: summary.id, title: summary.title,
        profile: { genre: profile.genre, subgenre: profile.subgenre, coreIdea: profile.coreIdea }, worldView: foundation.worldView, view })).digest('hex')
      return { view, project: summary, prompt: built.prompt, sourceFingerprint: built.sourceFingerprint, basisHash, promptSummary: built.summary }
    }
    const first = await read(), second = await read()
    if (first.basisHash !== second.basisHash || first.sourceFingerprint !== second.sourceFingerprint || first.project.id !== second.project.id) throw conflict()
    return second
  }

  private async prepare(style: WorldMapStylePreset): Promise<Prepared> {
    const root = await canonicalDirectory(await this.projects.currentPath()), identity = await this.physicalIdentity(root)
    const policy = await this.capturePolicy()
    await policy.assertAuthorized?.()
    const methods = worldMapStylePrompt(policy)
    if (keyPath(await canonicalDirectory(await this.projects.currentPath())) !== keyPath(root) || await this.physicalIdentity(root) !== identity) throw conflict()
    const source = await this.source(style, methods)
    const assertActive = async () => {
      await policy.assertAuthorized?.()
      if (keyPath(await canonicalDirectory(await this.projects.currentPath())) !== keyPath(root) || await this.physicalIdentity(root) !== identity) throw conflict()
      const latest = await this.source(style, methods)
      if (latest.project.id !== source.project.id || latest.basisHash !== source.basisHash || latest.sourceFingerprint !== source.sourceFingerprint
        || keyPath(await canonicalDirectory(latest.project.path)) !== keyPath(root)) throw conflict()
      if (keyPath(await canonicalDirectory(await this.projects.currentPath())) !== keyPath(root) || await this.physicalIdentity(root) !== identity) throw conflict()
      await policy.assertAuthorized?.()
      if (keyPath(await canonicalDirectory(await this.projects.currentPath())) !== keyPath(root) || await this.physicalIdentity(root) !== identity) throw conflict()
      return latest
    }
    await assertActive()
    return { root, methods, source, assertActive }
  }

  private async physicalIdentity(root: string): Promise<string> {
    const directory = await lstat(root)
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw conflict()
    let database: number[] | null = null
    try {
      const path = await projectExistingPath(root, join(root, '.webnovel', 'workspace.sqlite')), info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) throw conflict()
      database = [info.dev, info.ino, info.birthtimeMs]
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
    }
    return createHash('sha256').update(JSON.stringify([keyPath(root), directory.dev, directory.ino, directory.birthtimeMs, database])).digest('hex')
  }

  private liveCandidate(id: string): CandidateRecord {
    if (!this.candidate || this.candidate.id !== id || this.candidate.expiresAt <= this.now()) {
      this.candidate = null
      throw new AppError('FEATURE_UNAVAILABLE', '这张地图预览已经失效，请重新生成。', { recoverable: true })
    }
    return this.candidate
  }

  private async cancelRunningFor(workItemId: string): Promise<void> {
    for (const [id, running] of this.running) if (running.workItemId === workItemId) { running.controller.abort(); this.running.delete(id) }
    if (this.candidate?.workItemId === workItemId) this.candidate = null
  }
}
