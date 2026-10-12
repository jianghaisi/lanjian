import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// Full real-browser/real-service test, not a fabricated-token substitute.
const cwd = fileURLToPath(new URL('../../../desktop/', import.meta.url))
const child = spawn(process.execPath, ['scripts/plugin-marketplace-smoke.mjs', process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-plugin-marketplace-check'], { cwd, env: process.env, stdio: 'inherit' })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
