import { createHash } from 'node:crypto'
import { mkdir, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import {
  decodeGlobalConnectionDocument,
  type GlobalConnectionDocument,
  type ModelConnectionSecrets
} from '../domain/model-connections'
import { decryptModelConnectionKey, encryptModelConnectionKey } from '../application/model-connection-secrets'
import { GLOBAL_CONNECTIONS_FILE } from './model-connections-store'
import { readModelConnectionFile } from './model-connection-file'

export const GLOBAL_MODEL_DATA_DIRECTORY = join('Lanjian', 'model-connections', 'v1')
export const GLOBAL_MODEL_MIGRATION_RECEIPT = 'migration-receipt.json'

export function resolveGlobalModelDataRoot(input: {
  appData: string
  isolatedRoot?: string
}): string {
  const candidate = input.isolatedRoot ?? join(input.appData, GLOBAL_MODEL_DATA_DIRECTORY)
  if (!isAbsolute(candidate)) throw storageError()
  return resolve(candidate)
}

export async function initializeGlobalModelDataRoot(input: {
  targetRoot: string
  legacyRoot: string
  /** Profile-scoped codec used only to read the retained legacy source. */
  secrets: ModelConnectionSecrets
  /** Stable global codec; defaults to the source codec for compatibility and tests. */
  targetSecrets?: ModelConnectionSecrets
}): Promise<{ root: string; status: 'ready' | 'migrated' | 'recovery-required'; recoveryConnectionIds: string[] }> {
  if (!isAbsolute(input.targetRoot) || !isAbsolute(input.legacyRoot)) throw storageError()
  await mkdir(input.targetRoot, { recursive: true, mode: 0o700 })
  const targetRoot = await exactDirectory(input.targetRoot)
  const legacyRoot = await exactDirectory(input.legacyRoot)
  const existing = await readModelConnectionFile(targetRoot, GLOBAL_CONNECTIONS_FILE)
  if (existing) {
    decodeGlobalConnectionDocument(existing.value)
    return { root: targetRoot, status: 'ready', recoveryConnectionIds: [] }
  }
  if ((await readdir(targetRoot)).length) throw storageError()
  if (targetRoot === legacyRoot) return { root: targetRoot, status: 'ready', recoveryConnectionIds: [] }
  const source = await readModelConnectionFile(legacyRoot, GLOBAL_CONNECTIONS_FILE)
  if (!source) return { root: targetRoot, status: 'ready', recoveryConnectionIds: [] }

  const original = decodeGlobalConnectionDocument(source.value)
  if (original.connections.some(connection => connection.encryptedApiKey)) {
    try {
      if (!input.secrets.available()) throw storageError()
    } catch (error) {
      if (error instanceof AppError) throw error
      throw storageError()
    }
  }
  const recoveryConnectionIds: string[] = []
  const migrated: GlobalConnectionDocument = {
    ...original,
    connections: original.connections.map(connection => {
      if (!connection.encryptedApiKey) return { ...connection }
      let apiKey = ''
      try {
        apiKey = decryptModelConnectionKey(input.secrets, connection.encryptedApiKey)
      } catch {
        recoveryConnectionIds.push(connection.id)
        const safe = { ...connection }
        delete safe.encryptedApiKey
        return safe
      }
      try {
        return { ...connection, encryptedApiKey: encryptModelConnectionKey(input.targetSecrets ?? input.secrets, apiKey) }
      } finally {
        apiKey = ''
      }
    })
  }
  const content = `${JSON.stringify(migrated, null, 2)}\n`
  const targetFingerprint = digest(content)
  await atomicWriteText(join(targetRoot, GLOBAL_CONNECTIONS_FILE), content, async () => {
    if (await readModelConnectionFile(targetRoot, GLOBAL_CONNECTIONS_FILE)) throw conflict()
    const latest = await readModelConnectionFile(legacyRoot, GLOBAL_CONNECTIONS_FILE)
    if (!latest || latest.fingerprint !== source.fingerprint) throw conflict()
  })
  const receipt: {
    version: 1
    sourceFingerprint: string
    targetFingerprint: string
    status: 'migrated' | 'recovery-required'
    recoveryConnectionIds: string[]
  } = {
    version: 1,
    sourceFingerprint: source.fingerprint,
    targetFingerprint,
    status: recoveryConnectionIds.length ? 'recovery-required' : 'migrated',
    recoveryConnectionIds
  }
  await atomicWriteText(join(targetRoot, GLOBAL_MODEL_MIGRATION_RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`)
  return { root: targetRoot, status: receipt.status, recoveryConnectionIds: [...recoveryConnectionIds] }
}

async function exactDirectory(path: string): Promise<string> {
  try {
    const lexical = resolve(path)
    const actual = await realpath(lexical)
    if (!samePath(actual, lexical)) throw storageError()
    return actual
  } catch (error) {
    if (error instanceof AppError) throw error
    throw storageError()
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function conflict(): AppError {
  return new AppError('CONFLICT', '全局模型接口迁移期间数据发生变化，请重新启动后重试。', { recoverable: true })
}

function storageError(): AppError {
  return new AppError('STORAGE_ERROR', '全局模型接口存储目录无法安全初始化。', { recoverable: true })
}
