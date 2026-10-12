import { app, utilityProcess } from 'electron'
import { basename, dirname, join } from 'node:path'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WritingPluginRunHost, type GuestProcess } from './run-host'
import type { GuestPolicy } from '../domain/guest'

/** Explicit whitelist: no PATH, NODE_OPTIONS, proxy settings, tokens, home or book path. */
function environment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  if (process.platform === 'win32') {
    for (const key of ['SystemRoot', 'WINDIR']) if (process.env[key]) result[key] = process.env[key]
  }
  return result
}
export function createWritingPluginRunHost(policy?: GuestPolicy): WritingPluginRunHost {
  return new WritingPluginRunHost((): GuestProcess => {
    if (!app.isReady()) throw new Error('Plugin runtime requires Electron readiness')
    // Production may share this implementation between the main and probe entries.
    const ownDirectory = dirname(fileURLToPath(import.meta.url))
    const resourceDirectory = basename(ownDirectory) === 'chunks' ? join(ownDirectory, '..', 'writing-plugins') : ownDirectory
    const launcher = join(resourceDirectory, 'guest-worker.mjs')
      .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
    // Electron may never emit spawn/exit when cwd is absent. Fail before fork.
    if (!statSync(launcher).isFile() || !statSync(join(dirname(launcher), 'quickjs.wasm')).isFile()) throw new Error('Plugin resources unavailable')
    const child = utilityProcess.fork(launcher, [], {
      cwd: dirname(launcher), env: environment(), stdio: 'ignore',
      execArgv: ['--max-old-space-size=128'], serviceName: 'Writing plugin guest'
    })
    let killRequested = false
    child.once('spawn', () => { if (killRequested) child.kill() })
    return {
      send: wire => child.postMessage(wire), kill: () => { killRequested = true; child.kill() },
      onMessage: listener => { child.on('message', listener) },
      onExit: listener => { child.once('exit', listener) },
      residentBytes: () => {
        const metrics = child.pid && app.getAppMetrics().find(m => m.pid === child.pid)
        return metrics ? metrics.memory.workingSetSize * 1024 : 0
      }
    }
  }, policy)
}
