import { AsyncLocalStorage } from 'node:async_hooks'
import type { CreativePolicyRun } from '../domain/creative-policy'

/** Main execution scope only; this reference is never an IPC capability. */
const execution = new AsyncLocalStorage<CreativePolicyRun>()
export const currentCreativePolicyRun = () => execution.getStore()
export function withCreativePolicyRun<T>(policy: CreativePolicyRun, operation: () => Promise<T>): Promise<T> {
  return execution.run(policy, operation)
}
