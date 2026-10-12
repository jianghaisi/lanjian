import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { boolean, integer, modelId, record, text } from '@lanjian/hosted-contracts'
import type { HostedConfig } from '../config.ts'
import { HostedDatabase, dbNumber, dbString } from '../storage/database.ts'
import { fail } from '../http/errors.ts'

export type ModelConfiguration = {
  id: string; name: string; protocol: 'openai-compatible' | 'gemini-native'; baseUrl: string; model: string
  enabled: boolean; maxInputTokens: number; maxOutputTokens: number; revision: number; keyConfigured: boolean
}
type StoredModel = Omit<ModelConfiguration, 'keyConfigured'> & { secret: string }
export class ModelStore {
  constructor(readonly db: HostedDatabase, readonly config: HostedConfig) {}
  private seal(value: string): string {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.config.masterKey, nonce)
    cipher.setAAD(Buffer.from('lanjian-hosted-model-key-v1'))
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64')
  }
  private open(value: string): string {
    const data = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', this.config.masterKey, data.subarray(0, 12))
    cipher.setAAD(Buffer.from('lanjian-hosted-model-key-v1')); cipher.setAuthTag(data.subarray(12, 28))
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')
  }
  private stored(id: string): StoredModel {
    const row = this.db.get('SELECT value FROM settings WHERE key=?', `model:${modelId(id)}`)
    if (!row) fail('configuration-required')
    return JSON.parse(dbString(row.value)) as StoredModel
  }
  get(id: string): ModelConfiguration {
    const { secret, ...model } = this.stored(id)
    return { ...model, keyConfigured: Boolean(secret) }
  }
  list(): ModelConfiguration[] {
    return this.db.all("SELECT value FROM settings WHERE key LIKE 'model:%' ORDER BY key").map(row => {
      const { secret, ...model } = JSON.parse(dbString(row.value)) as StoredModel
      return { ...model, keyConfigured: Boolean(secret) }
    })
  }
  selection(): { revision: number; modelId: string | null } {
    const row = this.db.get("SELECT value,revision FROM settings WHERE key='hosted-model'")
    if (row) return { revision: dbNumber(row.revision), modelId: JSON.parse(dbString(row.value)) as string | null }
    // Existing single-model installations retain their only enabled connection.
    const enabled = this.list().filter(model => model.enabled && model.keyConfigured)
    return { revision: 0, modelId: enabled.length === 1 ? enabled[0]!.id : null }
  }
  selected(): ModelConfiguration | null {
    const id = this.selection().modelId
    if (!id) return null
    const model = this.get(id)
    return model.enabled && model.keyConfigured ? model : null
  }
  select(actor: string, input: unknown) {
    const p = record(input, ['modelId', 'expectedRevision'])
    const id = p.modelId === null ? null : modelId(p.modelId), expected = integer(p.expectedRevision, 0, 1e9)
    return this.db.transaction(() => {
      if (this.selection().revision !== expected) fail('conflict')
      if (id) { const model = this.get(id); if (!model.enabled || !model.keyConfigured) fail('configuration-required') }
      this.db.run("INSERT INTO settings VALUES('hosted-model',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=excluded.revision", JSON.stringify(id), expected + 1)
      this.db.audit(actor, 'active-model-update', id ?? 'none', { revision: expected + 1 })
      return this.selection()
    })
  }
  privateConfiguration(id: string): ModelConfiguration & { apiKey: string } {
    const model = this.get(id)
    if (!model.enabled || !model.keyConfigured) fail('configuration-required')
    return { ...model, apiKey: this.open(this.stored(id).secret) }
  }
  update(actor: string, id: string, input: unknown): ModelConfiguration {
    modelId(id)
    const p = record(input, ['name', 'protocol', 'baseUrl', 'model', 'enabled', 'maxInputTokens', 'maxOutputTokens', 'expectedRevision', 'apiKey'])
    if (p.protocol !== 'openai-compatible' && p.protocol !== 'gemini-native') fail('invalid-request')
    let endpoint: URL
    try { endpoint = new URL(text(p.baseUrl, 1000)) } catch { fail('invalid-request') }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.protocol !== 'https:') fail('invalid-request')
    const value = { id, name: text(p.name, 80), protocol: p.protocol, baseUrl: endpoint.href.replace(/\/$/u, ''), model: text(p.model, 150),
      enabled: boolean(p.enabled), maxInputTokens: integer(p.maxInputTokens, 1000, 200000), maxOutputTokens: integer(p.maxOutputTokens, 256, 32768) }
    const expected = integer(p.expectedRevision, 0, 1e9), apiKey = p.apiKey === undefined ? undefined : text(p.apiKey, 8192)
    return this.db.transaction(() => {
      const row = this.db.get('SELECT value,revision FROM settings WHERE key=?', `model:${id}`)
      if ((row ? dbNumber(row.revision) : 0) !== expected) fail('conflict')
      const old = row ? JSON.parse(dbString(row.value)) as StoredModel : null
      // A retained key may not be redirected to a different service/protocol.
      if (old && (old.baseUrl !== value.baseUrl || old.protocol !== value.protocol) && apiKey === undefined) fail('conflict')
      if (!row && dbNumber(this.db.get("SELECT COUNT(*) AS count FROM settings WHERE key LIKE 'model:%'")?.count) >= 20) fail('quota-exceeded')
      const secret = apiKey === undefined ? old?.secret ?? '' : this.seal(apiKey), revision = expected + 1
      this.db.run('INSERT INTO settings VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=excluded.revision', `model:${id}`, JSON.stringify({ ...value, secret, revision }), revision)
      this.db.audit(actor, 'model-update', id, { revision, enabled: value.enabled, keyChanged: apiKey !== undefined })
      return this.get(id)
    })
  }
}
