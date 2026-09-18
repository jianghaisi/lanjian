import { realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AutoBackupPreferences, WorkspaceBackupResult } from '../../modules/library/domain/workspace-backup'
import { readJson, writeJson } from '../storage/json-store'
import { readModelConnectionFile } from '../../modules/models/adapters/model-connection-file'
import { modelBookIdentity } from '../../modules/models/adapters/ai-settings-read-snapshot'
import { atomicWriteText } from '../storage/atomic-file'
import { selectedLegacyCredentials, legacyConnectionId } from '../../modules/models/domain/legacy-connection-reuse'
import { AppError } from '../../core/errors/app-error'
import type { ModelRequestGuard } from '../../modules/models/domain/model-provider'
import { encryptModelConnectionKey } from '../../modules/models/application/model-connection-secrets'

type LegacyAiSettings = { baseUrl: string; model: string; apiKeyConfigured: boolean }
type LegacyAiSettingsUpdate = { baseUrl?: string; model?: string; apiKey?: string; clearApiKey?: boolean }

export type StoredAutoBackup = AutoBackupPreferences & {
  lastCheckedAt?: string
  lastSuccessAt?: string
  lastFingerprint?: string
  lastError?: string
  lastResult?: WorkspaceBackupResult
}

type StoredSettings = {
  recentProjects: string[]
  currentProject: string | null
  libraryRoot: string | null
  excludedProjects: string[]
  ai: { baseUrl: string; model: string; encryptedApiKey?: string }
  projectApiKeys: Record<string, string | Record<string, string>>
  autoBackups: Record<string, StoredAutoBackup>
  research: { baseUrl: string; model: string; encryptedApiKey?: string }
}

const defaults: StoredSettings = {
  recentProjects: [],
  currentProject: null,
  libraryRoot: null,
  excludedProjects: [],
  ai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  projectApiKeys: {},
  autoBackups: {},
  research: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-0-lite-260428' }
}

const defaultAutoBackup = (): AutoBackupPreferences => ({ enabled: false, targetParentPath: '', backupOnFirstOpen: true, intervalMinutes: 30, retentionCount: 10 })

export type SecretCodec = {
  available: () => boolean
  encrypt: (value: string) => string
  decrypt: (value: string) => string
}

export class SettingsStore {
  private readonly file: string
  private operations: Promise<void> = Promise.resolve()

  constructor(userDataPath: string, private readonly secrets: SecretCodec) {
    this.file = join(userDataPath, 'settings.json')
  }

  async load(): Promise<StoredSettings> {
    return this.exclusive(() => this.loadNow())
  }

  private async loadNow(): Promise<StoredSettings> {
    const value = await readJson(this.file, defaults)
    return {
      ...defaults,
      ...value,
      libraryRoot: typeof value.libraryRoot === 'string' && value.libraryRoot.trim() ? value.libraryRoot : null,
      excludedProjects: Array.isArray(value.excludedProjects) ? value.excludedProjects.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [],
      ai: { ...defaults.ai, ...value.ai },
      projectApiKeys: { ...defaults.projectApiKeys, ...value.projectApiKeys },
      autoBackups: { ...defaults.autoBackups, ...value.autoBackups },
      research: { ...defaults.research, ...value.research }
    }
  }

  async save(value: StoredSettings): Promise<void> {
    const snapshot = structuredClone(value)
    await this.exclusive(() => this.saveNow(snapshot))
  }

  private async saveNow(value: StoredSettings): Promise<void> {
    await writeJson(this.file, value)
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation, operation)
    this.operations = result.then(() => undefined, () => undefined)
    return result
  }

  async setCurrentProject(path: string): Promise<void> {
    await this.exclusive(async () => {
      const value = await this.loadNow()
      value.currentProject = path
      // The shelf is a work-item ledger, not a "recently opened" list. Register a
      // project once and keep that creation/import order stable when it is opened.
      const targetIdentity = await localPathIdentity(path)
      let alreadyRegistered = false
      for (const recent of value.recentProjects) {
        if (await localPathIdentity(recent) === targetIdentity) {
          alreadyRegistered = true
          break
        }
      }
      if (!alreadyRegistered) value.recentProjects = [path, ...value.recentProjects].slice(0, 30)
      value.excludedProjects = value.excludedProjects.filter((item) => !sameLocalPath(item, path))
      await this.saveNow(value)
    })
  }

  async removeRecent(path: string): Promise<void> {
    await this.exclusive(async () => {
      const value = await this.loadNow()
      value.recentProjects = value.recentProjects.filter((item) => item !== path)
      if (!value.excludedProjects.some((item) => sameLocalPath(item, path))) value.excludedProjects.push(path)
      if (value.currentProject === path) value.currentProject = null
      await this.saveNow(value)
    })
  }

  async removeProjectData(path: string): Promise<void> {
    await this.exclusive(async () => {
      const value = await this.loadNow()
      value.recentProjects = value.recentProjects.filter((item) => item !== path)
      value.excludedProjects = value.excludedProjects.filter((item) => !sameLocalPath(item, path))
      if (value.currentProject === path) value.currentProject = null
      delete value.projectApiKeys[path]
      delete value.autoBackups[await localPathIdentity(path)]
      await this.saveNow(value)
    })
  }

  async autoBackup(projectPath: string): Promise<StoredAutoBackup> {
    return this.exclusive(async () => {
      const value = await this.loadNow()
      return { ...defaultAutoBackup(), ...value.autoBackups[await localPathIdentity(projectPath)] }
    })
  }

  async updateAutoBackup(projectPath: string, input: AutoBackupPreferences): Promise<StoredAutoBackup> {
    return this.exclusive(async () => {
      const value = await this.loadNow()
      const key = await localPathIdentity(projectPath)
      const previous = value.autoBackups[key] ?? defaultAutoBackup()
      value.autoBackups[key] = previous.targetParentPath === input.targetParentPath
        ? { ...previous, ...input, lastError: '' }
        : { ...input }
      await this.saveNow(value)
      return { ...value.autoBackups[key] }
    })
  }

  async recordAutoBackup(projectPath: string, update: Partial<Pick<StoredAutoBackup, 'lastCheckedAt' | 'lastSuccessAt' | 'lastFingerprint' | 'lastError' | 'lastResult'>>): Promise<StoredAutoBackup> {
    return this.exclusive(async () => {
      const value = await this.loadNow()
      const key = await localPathIdentity(projectPath)
      const previous = value.autoBackups[key] ?? defaultAutoBackup()
      value.autoBackups[key] = { ...previous, ...update }
      await this.saveNow(value)
      return { ...value.autoBackups[key] }
    })
  }

  async aiSettings(): Promise<LegacyAiSettings> {
    return this.exclusive(async () => {
      const { ai } = await this.loadNow()
      return publicAiSettings(ai)
    })
  }

  async updateAiSettings(input: LegacyAiSettingsUpdate): Promise<LegacyAiSettings> {
    return this.exclusive(async () => {
      const value = await this.loadNow()
      if (input.baseUrl !== undefined) value.ai.baseUrl = input.baseUrl.trim().replace(/\/$/, '')
      if (input.model !== undefined) value.ai.model = input.model.trim()
      if (input.clearApiKey) delete value.ai.encryptedApiKey
      if (input.apiKey?.trim()) {
        if (!this.secrets.available()) throw new Error('系统安全存储暂不可用，未保存 API 密钥')
        value.ai.encryptedApiKey = this.secrets.encrypt(input.apiKey.trim())
      }
      await this.saveNow(value)
      return publicAiSettings(value.ai)
    })
  }

  async apiKey(): Promise<string> {
    return this.exclusive(async () => {
      const { ai } = await this.loadNow()
      if (!ai.encryptedApiKey) throw new Error('尚未配置 AI API 密钥')
      return this.secrets.decrypt(ai.encryptedApiKey)
    })
  }

  async projectApiKeyConfigured(projectPath: string, connectionId = 'primary'): Promise<boolean> {
    return this.exclusive(async () => {
      const stored = (await this.loadNow()).projectApiKeys[projectPath]
      const encrypted = typeof stored === 'string' ? (connectionId === 'primary' ? stored : undefined) : stored?.[connectionId]
      if (!encrypted || !this.secrets.available()) return false
      try { return Boolean(this.secrets.decrypt(encrypted)) } catch { return false }
    })
  }

  /** Retained, exact-file private key edit. Shares the existing settings write lane. */
  async preparePrivateModelKeys(projectPath: string, ids: string[]) {
    const appRoot = await realpath(resolve(this.file, '..')), identity = await modelBookIdentity(appRoot)
    const read = async () => {
      const snapshot = await readModelConnectionFile(appRoot, 'settings.json')
      const value = snapshot?.value ?? {}
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('STORAGE_ERROR', '本机设置无法安全读取，原文件已保留。', { recoverable: true })
      selectedLegacyCredentials(value, projectPath, ids)
      return { snapshot, value: value as Record<string, unknown> }
    }
    const captured = await read()
    const recheck = async () => {
      const next = await read()
      if (await modelBookIdentity(appRoot) !== identity || next.snapshot?.fingerprint !== captured.snapshot?.fingerprint) throw new AppError('CONFLICT', '本机设置已变化，请重新读取后保存私有密钥。', { recoverable: true })
    }
    return { save: async (idValue: string, input: { apiKey?: string; clearApiKey?: boolean }, guard: ModelRequestGuard) => this.exclusive(async () => {
      const id = legacyConnectionId(idValue)
      if (!ids.includes(id)) throw new AppError('CONFLICT', '接口不属于本次私有设置。', { recoverable: true })
      await guard.recheck(); await recheck(); guard.assertActive()
      const value = structuredClone(captured.value), existing = value.projectApiKeys as Record<string, string | Record<string, string>> | undefined
      const projectApiKeys = { ...existing }, old = projectApiKeys[projectPath]
      const keys: Record<string, string> = typeof old === 'string' ? { primary: old } : { ...old }
      if (input.clearApiKey) delete keys[id]
      else if (input.apiKey !== undefined) keys[id] = encryptModelConnectionKey(this.secrets, input.apiKey)
      else throw new AppError('VALIDATION_ERROR', '请输入新密钥，或明确清除原密钥。', { recoverable: true })
      if (Object.keys(keys).length) projectApiKeys[projectPath] = keys
      else delete projectApiKeys[projectPath]
      value.projectApiKeys = projectApiKeys
      const beforeReplace = async () => { await guard.recheck(); await recheck(); guard.assertActive() }
      await atomicWriteText(this.file, JSON.stringify(value, null, 2), beforeReplace, guard.assertActive)
      return Boolean(keys[id])
    }) }
  }

  async updateProjectApiKey(projectPath: string, apiKey?: string, clear = false, connectionId = 'primary'): Promise<boolean> {
    return this.exclusive(async () => {
      const value = await this.loadNow()
      const stored = value.projectApiKeys[projectPath]
      const keys: Record<string, string> = typeof stored === 'string' ? { primary: stored } : { ...(stored || {}) }
      if (clear) delete keys[connectionId]
      if (apiKey?.trim()) {
        if (!this.secrets.available()) throw new Error('系统安全存储暂不可用，未保存接口密钥')
        keys[connectionId] = this.secrets.encrypt(apiKey.trim())
      }
      if (Object.keys(keys).length) value.projectApiKeys[projectPath] = keys
      else delete value.projectApiKeys[projectPath]
      await this.saveNow(value)
      return Boolean(keys[connectionId])
    })
  }

  async removeProjectApiKeys(projectPath: string, connectionIds: string[]): Promise<void> {
    await this.exclusive(async () => {
      const value = await this.loadNow()
      const stored = value.projectApiKeys[projectPath]
      const keys: Record<string, string> = typeof stored === 'string' ? { primary: stored } : { ...(stored || {}) }
      for (const connectionId of connectionIds) delete keys[connectionId]
      if (Object.keys(keys).length) value.projectApiKeys[projectPath] = keys
      else delete value.projectApiKeys[projectPath]
      await this.saveNow(value)
    })
  }

  async projectApiKey(projectPath: string, connectionId = 'primary'): Promise<string> {
    return this.exclusive(async () => {
      const stored = (await this.loadNow()).projectApiKeys[projectPath]
      const encrypted = typeof stored === 'string' ? (connectionId === 'primary' ? stored : undefined) : stored?.[connectionId]
      if (!encrypted) throw new Error('当前书稿尚未配置模型接口密钥')
      return this.secrets.decrypt(encrypted)
    })
  }

  async researchSettings(): Promise<{ baseUrl: string; model: string; apiKeyConfigured: boolean }> {
    return this.exclusive(async () => {
      const { research } = await this.loadNow()
      return publicAiSettings(research)
    })
  }

  async updateResearchSettings(input: { baseUrl?: string; model?: string; apiKey?: string; clearApiKey?: boolean }): Promise<{ baseUrl: string; model: string; apiKeyConfigured: boolean }> {
    return this.exclusive(async () => {
      const value = await this.loadNow()
      if (input.baseUrl !== undefined) value.research.baseUrl = input.baseUrl.trim().replace(/\/$/, '')
      if (input.model !== undefined) value.research.model = input.model.trim()
      if (input.clearApiKey) delete value.research.encryptedApiKey
      if (input.apiKey?.trim()) {
        if (!this.secrets.available()) throw new Error('系统安全存储暂不可用，未保存联网采风密钥')
        value.research.encryptedApiKey = this.secrets.encrypt(input.apiKey.trim())
      }
      if (!/^https?:\/\//i.test(value.research.baseUrl)) throw new Error('联网接口地址必须以 http:// 或 https:// 开头')
      if (!value.research.model) throw new Error('联网搜索模型不能为空')
      await this.saveNow(value)
      return publicAiSettings(value.research)
    })
  }

  async researchApiKey(): Promise<string> {
    return this.exclusive(async () => {
      const { research } = await this.loadNow()
      if (!research.encryptedApiKey) throw new Error('尚未配置联网采风密钥')
      return this.secrets.decrypt(research.encryptedApiKey)
    })
  }
}

function sameLocalPath(left: string, right: string): boolean {
  const a = resolve(left), b = resolve(right)
  return process.platform === 'win32' ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US') : a === b
}

function publicAiSettings(value: { baseUrl: string; model: string; encryptedApiKey?: string }): LegacyAiSettings {
  return { baseUrl: value.baseUrl, model: value.model, apiKeyConfigured: Boolean(value.encryptedApiKey) }
}

async function localPathIdentity(path: string): Promise<string> {
  let absolute = resolve(path)
  try { absolute = await realpath(absolute) } catch { /* new paths use their resolved lexical identity */ }
  return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute
}
