import { createHash } from 'node:crypto'
import { assertJson, pluginLimits, type JsonValue } from '@lanjian/writing-plugin-contracts'
import { AppError } from '../../../core/errors/app-error'
import type { PluginEffectJournal, PluginEffectReceipt } from '../domain/plugin-run'

/** The surrounding run record owns persistence, lifetime and storage limits. */
export class DurablePluginEffects implements PluginEffectJournal {
  private lane: Promise<unknown> = Promise.resolve()
  constructor(private readonly records: PluginEffectReceipt[], private readonly save: () => Promise<void>) {}
  once(key: string, request: JsonValue, operation: () => Promise<JsonValue>): Promise<JsonValue> {
    const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    const execute = async () => {
      const old = this.records.find(r => r.key === key)
      if (old) {
        if (old.requestHash !== requestHash || old.status !== 'completed') throw new AppError('CONFLICT', '这个插件步骤的参数已变化或上次结果尚未确认，不能重复创建候选。请查看原候选任务。', { recoverable: true })
        return structuredClone(old.value!)
      }
      if (!/^[a-f0-9]{64}$/.test(key) || this.records.length >= pluginLimits.calls) throw new AppError('FEATURE_UNAVAILABLE', '插件候选步骤已达到本次任务上限。', { recoverable: true })
      const record: PluginEffectReceipt = { key, requestHash, status: 'intent' }
      this.records.push(record)
      try { await this.save() } catch (error) { this.records.splice(this.records.indexOf(record), 1); throw error }
      const value = await operation(); assertJson(value, 16 * 1024)
      record.status = 'completed'; record.value = structuredClone(value)
      try { await this.save() } catch (error) { record.status = 'intent'; delete record.value; throw error }
      return structuredClone(value)
    }
    const result = this.lane.then(execute, execute); this.lane = result.catch(() => {}); return result
  }
}
