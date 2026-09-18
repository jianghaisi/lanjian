import { AppError } from '../../../core/errors/app-error'
import type { BookModelSettings } from './book-model-settings'
import type { GlobalConnectionsView, RemoteModelProtocol } from './model-connections'

/** Private credential capability only; never serialize this port's result into IPC. */
export interface GlobalModelCredentialReader {
  list(): Promise<GlobalConnectionsView>
  prepareCredential(id: string, expectedConnectionRevision: number): Promise<{
    connectionId: string
    connectionName: string
    baseUrl: string
    protocol: RemoteModelProtocol
    assertCurrent(): Promise<void>
    use<T>(send: (apiKey: string) => Promise<T>): Promise<T>
  }>
}

/** Main-supplied lifecycle state, not renderer input. Generation must advance even on A → B → A. */
export type BookModelRequestScope = { windowId: string; generation: number; bookRoot: string }
export type BookModelStorage = {
  mode: 'files' | 'sqlite'; schemaVersion: number | null; projectId: string | null
  ready: boolean; contentHash: string | null; revision: number | null
}
export type BookModelSnapshot = {
  bookRoot: string
  sourceIdentity: string
  documentFingerprint: string
  settings: BookModelSettings
  storage: BookModelStorage
  fileHash: string | null
  assertCurrent(): Promise<void>
}
export interface BookModelSourceReader { capture(bookRoot: string): Promise<BookModelSnapshot> }
export type PrivateModelCredential = { encryptedApiKey: string; assertCurrent(): Promise<void> }
export interface PrivateModelCredentialReader { capture(bookRoot: string, originalConnectionId: string): Promise<PrivateModelCredential> }

export function bookModelRequestConflict(): AppError {
  return new AppError('CONFLICT', '作品、模型分配或接口凭据已变化，请重新发起请求；尚未发送的请求已停止。', { recoverable: true })
}
export function bookModelSourceUnavailable(): AppError {
  return new AppError('STORAGE_ERROR', '无法安全读取作品模型配置，请检查配置后重试；原文件未改动。', { recoverable: true })
}
