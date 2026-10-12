import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { executeGuest } from './guest-engine'
import { decodeGuestCommand, encodeGuestWire } from '../domain/guest-protocol'
import type { JsonValue } from '@lanjian/writing-plugin-contracts'

// This is bundled trusted code. Never fork/import/evaluate a package entry in Node.
const port = process.parentPort
if (!port) throw new Error('Plugin worker requires its parent port')
const controller = new AbortController()
const pending = new Map<number, { resolve(value: JsonValue): void; reject(error: Error): void }>()
let started = false, ended = false, sequence = 0
function finish(result: Parameters<typeof encodeGuestWire>[0]): void {
  if (ended) return
  ended = true; controller.abort()
  for (const call of pending.values()) call.reject(new Error('Plugin worker ended'))
  pending.clear()
  port.postMessage(encodeGuestWire({ kind: 'result', result }))
  // Parent owns kill + exit acknowledgement; this timer also prevents an orphan.
  setTimeout(() => process.exit(0), 250)
}
port.on('message', event => {
  if (ended) return
  try {
    const command = decodeGuestCommand(event.data)
    if (command.kind === 'reply') {
      const call = pending.get(command.id)
      if (!call) throw new Error('Unexpected RPC reply')
      pending.delete(command.id)
      if (command.ok) call.resolve(command.value)
      else call.reject(new Error('Host capability unavailable'))
      return
    }
    if (started) throw new Error('Duplicate start')
    started = true
    void (async () => {
      // Rollup may move this implementation into a shared chunk. argv[1] remains
      // the fixed launcher supplied by main; guest code cannot change it.
      const bytes = await readFile(join(dirname(process.argv[1]), 'quickjs.wasm'))
      const result = await executeGuest(command.invocation, new Uint8Array(bytes).buffer, (method, input) => new Promise((resolve, reject) => {
        const id = ++sequence
        pending.set(id, { resolve, reject })
        port.postMessage(encodeGuestWire({ kind: 'rpc', id, method, input }))
      }), controller.signal, command.policy)
      finish(result)
    })().catch(() => finish({ ok: false, code: 'unavailable' }))
  } catch { finish({ ok: false, code: 'protocol-error' }) }
})
// Covers a parent that forks but never supplies a valid start message.
setTimeout(() => { if (!started) finish({ ok: false, code: 'timeout' }) }, 10_000).unref()
