import { LOCAL_CONNECTION_ID, isLocalConnection } from '../../../../contracts/models/local-model-contracts'
import { AppError } from '../../../core/errors/app-error'
import { BOOK_MODEL_TASKS, decodeBookModelSettings, defaultLegacyBookModelSettings, parseBookModelSettings, type LegacyBookModelSettings } from '../domain/book-model-settings'
import type { LocalTextProvider, ResolvedModelConnection } from '../domain/model-provider'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectDirectory } from '../../../platform/storage/project-path'
import type { AiProviderConnection, AiSettings, AiSettingsUpdate, AiTask, ModelProfile } from '../../../../contracts/index'
import { writeJson } from '../../../platform/storage/json-store'
import { ProjectService } from '../../library/application/project-service'
import { SettingsStore } from '../../../platform/settings/settings-store'

type StoredProjectAiSettings = LegacyBookModelSettings
type ResolvedConnection = ResolvedModelConnection
type StoredSettingsSource = { root: string; file: string; stored: StoredProjectAiSettings; contentHash?: string; formal: boolean }

export interface ProjectAiSettingsAuthority {
  active(workItemId: string): Promise<boolean>
  aiSettingsReady(workItemId: string): Promise<boolean>
  readAiSettings?(workItemId: string): Promise<{ content: string; contentHash: string }>
  aiSettings(workItemId: string): Promise<{ content: string; contentHash: string }>
  importAiSettings(workItemId: string, content: string, settings: AiSettings, observedMirrorHash?: string): Promise<{ content: string; contentHash: string }>
  replaceAiSettings(workItemId: string, expectedContentHash: string, content: string, settings: AiSettings): Promise<{ content: string; contentHash: string }>
}

const taskNames = BOOK_MODEL_TASKS

export class ProjectAiService {
  private updates: Promise<void> = Promise.resolve()

  constructor(
    private readonly projects: ProjectService,
    private readonly settings: SettingsStore,
    private readonly authority?: ProjectAiSettingsAuthority,
    private readonly local?: Pick<LocalTextProvider, 'listModels' | 'ready' | 'limits'>
  ) {}

  private async paths(): Promise<{ root: string; file: string }> {
    const root = await this.projects.currentPath()
    return { root, file: await projectDirectory(root, join(root, '.webnovel', 'ai-settings.json')) }
  }

  private merge(value: unknown): StoredProjectAiSettings {
    const decoded = decodeBookModelSettings(value)
    // The existing public DTO/provider path does not yet support v4. Never strip its references.
    if (decoded.version === 4) throw new AppError('FEATURE_UNAVAILABLE', '本书使用全局模型引用，请等待新版模型分配入口；原配置已保留。', { recoverable: true })
    return decoded
  }

  private asPublic(stored: StoredProjectAiSettings, connections: AiProviderConnection[], apiKeyConfigured: boolean): AiSettings {
    return { ...stored, version: this.local ? 3 : stored.version, connections: this.local || stored.version === 3 ? [...connections, {kind:'local',id:LOCAL_CONNECTION_ID,name:'本地推理',runtimeId:'llama-cpp-python'}] : connections, apiKeyConfigured }
  }

  private withoutCredentials(stored: StoredProjectAiSettings): AiSettings {
    return this.asPublic(stored, stored.connections.map((connection) => ({ ...connection, apiKeyConfigured: false })), false)
  }

  private async loadStored(readOnly = false): Promise<StoredSettingsSource> {
    const { root, file } = await this.paths()
    if (this.authority && await this.authority.active(root)) {
      if (!await this.authority.aiSettingsReady(root)) {
        const legacy = this.merge(await readModelSettings(file))
        this.validate(legacy)
        const observedMirrorHash = await existingFileHash(file)
        if (readOnly) return { root, file, stored: legacy, formal: false }
        await this.authority.importAiSettings(root, JSON.stringify(legacy), this.withoutCredentials(legacy), observedMirrorHash)
      }
      const document = await (readOnly && this.authority.readAiSettings ? this.authority.readAiSettings(root) : this.authority.aiSettings(root))
      const stored = this.merge(parseBookModelSettings(document.content))
      this.validate(stored)
      return { root, file, stored, contentHash: document.contentHash, formal: true }
    }
    const stored = this.merge(await readModelSettings(file))
    this.validate(stored)
    return { root, file, stored, formal: false }
  }

  async get(): Promise<AiSettings> {
    const { root, stored } = await this.loadStored(true)
    const connections = await Promise.all(stored.connections.map(async (connection) => ({
      ...connection,
      apiKeyConfigured: await this.settings.projectApiKeyConfigured(root, connection.id)
    })))
    const activeProfiles = stored.routingMode === 'shared' ? [stored.shared] : taskNames.map((task) => stored.tasks[task])
    const apiKeyConfigured = activeProfiles.every((profile) => connections.some((connection) => connection.id === profile.connectionId && connection.apiKeyConfigured))
    const result = this.asPublic(stored, connections, apiKeyConfigured)
    if (this.local) result.modelConfigured = (await Promise.all(activeProfiles.map(profile => isLocalConnection(profile.connectionId) ? this.local!.ready(profile.model) : Promise.resolve(connections.some(c => c.id === profile.connectionId && c.apiKeyConfigured))))).every(Boolean)
    return result
  }

  update(input: AiSettingsUpdate): Promise<AiSettings> {
    const result = this.updates.then(() => this.updateNow(input), () => this.updateNow(input))
    this.updates = result.then(() => undefined, () => undefined)
    return result
  }

  private async updateNow(input: AiSettingsUpdate): Promise<AiSettings> {
    const source = await this.loadStored()
    const { root, file } = source
    const current = source.stored
    const replacesConnections = Boolean(input.connections)
    let connectionUpdates = input.connections
    if (!connectionUpdates && (input.baseUrl !== undefined || input.apiKey !== undefined || input.clearApiKey !== undefined)) {
      const first = current.connections[0]
      if (!first) throw new Error('请先添加在线接口')
      connectionUpdates = [{
        ...first,
        baseUrl: input.baseUrl === undefined ? first.baseUrl : input.baseUrl,
        apiKey: input.apiKey,
        clearApiKey: input.clearApiKey
      }]
    }
    const updatedMetadata = connectionUpdates?.map(({ id, name, baseUrl }) => ({
      id: id.trim(), name: name.trim(), baseUrl
    })) || []
    const storedConnections = replacesConnections
      ? updatedMetadata
      : current.connections.map((connection) => updatedMetadata.find((item) => item.id === connection.id) || connection)
    // Preserve the v2 explicit connection-list replacement behavior only. Reads,
    // explicit invalid selections and v3/local routes must never fall back.
    const mergeUpdatedProfile = (previous: ModelProfile, update?: Partial<ModelProfile>): ModelProfile => {
      const next = { ...previous, ...update }
      if (replacesConnections && current.version === 2 && update?.connectionId === undefined
        && !isLocalConnection(next.connectionId) && !storedConnections.some(c => c.id === next.connectionId)
        && storedConnections[0]) next.connectionId = storedConnections[0].id
      return next
    }
    const next = this.merge({
      ...current,
      version: current.version === 3 || isLocalConnection(input.shared?.connectionId) || Object.values(input.tasks || {}).some(p => isLocalConnection(p.connectionId)) ? 3 : 2,
      connections: storedConnections,
      routingMode: input.routingMode ?? current.routingMode,
      shared: mergeUpdatedProfile(current.shared, input.shared),
      tasks: Object.fromEntries(taskNames.map((task) => [task, mergeUpdatedProfile(current.tasks[task], input.tasks?.[task])])) as Record<AiTask, ModelProfile>
    })
    this.validate(next, true)
    const retainedConnectionIds = new Set(next.connections.map((connection) => connection.id))
    if (input.removeConnectionIds?.some((connectionId) => retainedConnectionIds.has(connectionId))) {
      throw new Error('仍在使用的模型接口不能同时删除密钥')
    }
    const removedConnectionIds = new Set([
      ...current.connections.filter((connection) => !retainedConnectionIds.has(connection.id)).map((connection) => connection.id),
      ...(input.removeConnectionIds || [])
    ])
    // New credentials must be accepted by the OS-backed secret store before
    // the readable project routing changes. A failed secret write therefore
    // cannot leave the book pointing at an unusable new provider.
    for (const connection of connectionUpdates || []) {
      if (connection.apiKey?.trim()) await this.settings.updateProjectApiKey(root, connection.apiKey, false, connection.id)
    }
    if (source.formal) {
      if (!source.contentHash || !this.authority) throw new Error('SQLite 中的 AI 模型配置版本缺失')
      await this.authority.replaceAiSettings(root, source.contentHash, JSON.stringify(next), this.withoutCredentials(next))
    } else {
      await writeJson(file, next)
    }
    for (const connection of connectionUpdates || []) {
      if (connection.clearApiKey && !connection.apiKey?.trim()) await this.settings.updateProjectApiKey(root, undefined, true, connection.id)
    }
    if (removedConnectionIds.size) await this.settings.removeProjectApiKeys(root, [...removedConnectionIds])
    return this.get()
  }

  async apiKey(connectionId = 'primary'): Promise<string> {
    return this.settings.projectApiKey(await this.projects.currentPath(), connectionId)
  }

  async resolve(task: AiTask, connectionIdOverride?: string): Promise<ResolvedConnection & { profile: ModelProfile }> {
    const { root, stored: settings } = await this.loadStored(true)
    const profile = settings.routingMode === 'shared' ? settings.shared : settings.tasks[task]
    if (isLocalConnection(connectionIdOverride || profile.connectionId)) return {kind:'local',connectionId:LOCAL_CONNECTION_ID,connectionName:'本地推理',profile:{...profile,connectionId:LOCAL_CONNECTION_ID}}
    // Resolve task sampling and the chosen endpoint from one book snapshot.
    // An explicit route must never need credentials for the unused default API.
    const connection = settings.connections.find((item) => item.id === (connectionIdOverride || profile.connectionId))
    if (!connection) throw new Error(connectionIdOverride
      ? '选择的模型接口已经不存在，请重新选择'
      : `模型“${profile.model}”绑定的接口已经不存在，请重新分配`)
    const apiKey = await this.settings.projectApiKey(root, connection.id)
    return { kind: 'openai-compatible', connectionId: connection.id, connectionName: connection.name, baseUrl: connection.baseUrl, apiKey,
      profile: { ...profile, connectionId: connection.id } }
  }

  async resolveConnection(connectionId: string): Promise<ResolvedConnection> {
    const { root, stored: settings } = await this.loadStored(true)
    if (isLocalConnection(connectionId)) return {kind:'local',connectionId:LOCAL_CONNECTION_ID,connectionName:'本地推理'}
    const connection = settings.connections.find((item) => item.id === connectionId)
    if (!connection) throw new Error('选择的模型接口已经不存在，请重新选择')
    const apiKey = await this.settings.projectApiKey(root, connection.id)
    return { kind: 'openai-compatible', connectionId: connection.id, connectionName: connection.name, baseUrl: connection.baseUrl, apiKey }
  }

  private validate(value: StoredProjectAiSettings, validateLocal = false): void {
    decodeBookModelSettings(value)
    if (!validateLocal || !this.local) return
    for (const profile of [value.shared, ...taskNames.map(task => value.tasks[task])]) {
      if (isLocalConnection(profile.connectionId) && profile.maxTokens > this.local.limits(profile.model).maxOutputTokens) {
        throw new Error('本地模型最大输出为 ' + this.local.limits(profile.model).maxOutputTokens + ' tokens')
      }
    }
  }
}

async function existingFileHash(path: string): Promise<string | undefined> {
  try { return createHash('sha256').update(await readFile(path)).digest('hex') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function readModelSettings(file: string): Promise<unknown> {
  let content: string
  try { content = await readFile(file, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultLegacyBookModelSettings()
    throw new AppError('STORAGE_ERROR', '模型配置无法读取，原文件已保留，请修复后重试。', { recoverable: true })
  }
  try { return parseBookModelSettings(content) }
  catch (error) {
    if (error instanceof AppError && error.code === 'FEATURE_UNAVAILABLE') throw error
    throw new AppError('VALIDATION_ERROR', '模型配置无法读取，原文件已保留，请修复后重试。', { recoverable: true })
  }
}
