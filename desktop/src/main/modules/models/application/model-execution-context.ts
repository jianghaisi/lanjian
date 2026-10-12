import { AsyncLocalStorage } from 'node:async_hooks'
import type { ModelSettingsResolver } from '../domain/model-provider'

type CapturedModel = Awaited<ReturnType<ModelSettingsResolver['resolve']>>
// Process-private capability: the provider guard and credentials never cross IPC.
const execution = new AsyncLocalStorage<CapturedModel>()
export const currentModelExecution = () => execution.getStore()
export const withModelExecution = <T>(model: CapturedModel, operation: () => T | Promise<T>): T | Promise<T> => execution.run(model, operation)
