import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cwd = fileURLToPath(new URL('../', import.meta.url))
// Test creates its own source, closes it consistently, copies it into a new root,
// verifies recovery and exact package bytes, and never receives a production path.
const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-name-pattern=restart reconciles', 'tests/release-flow.test.ts'], { cwd, stdio: 'inherit' })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
