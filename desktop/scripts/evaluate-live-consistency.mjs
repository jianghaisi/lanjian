import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { prepareEvaluationRuntime, removeEvaluationRuntime } from './isolated-electron-profile.mjs'

const args = process.argv.slice(2)
const testing = args.length === 1 && args[0] === '--test-runner'
const entry = fileURLToPath(new URL(testing ? './fixtures/live-consistency-runner.cjs' : './evaluate-live-consistency.cjs', import.meta.url))
const env = { ...process.env }
// Merely setting this variable to an empty string still changes Electron's
// runtime on Windows. Remove it so safeStorage and app lifecycle are available.
delete env.ELECTRON_RUN_AS_NODE
let runtime
try {
  const profileIndex = args.indexOf('--profile')
  runtime = await prepareEvaluationRuntime(!testing && profileIndex >= 0 ? args[profileIndex + 1] : undefined)
  env.LANJIAN_EVALUATION_RUNTIME = runtime
  const child = spawn(electron, [entry, `--user-data-dir=${runtime}`, ...(testing ? [] : args)], { env, windowsHide: true, stdio: 'inherit' })
  const interrupt = () => child.kill('SIGTERM')
  process.once('SIGINT', interrupt)
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve(code ?? 1))
  })
  process.removeListener('SIGINT', interrupt)
} catch {
  process.stderr.write('Could not prepare or start the isolated evaluation runtime. No provider request was initiated by the launcher.\n')
  process.exitCode = 1
} finally {
  if (runtime) {
    try { await removeEvaluationRuntime(runtime) }
    catch { process.stderr.write('Temporary evaluation runtime cleanup failed.\n'); process.exitCode = 1 }
  }
}
