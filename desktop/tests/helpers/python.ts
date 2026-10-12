import { spawnSync } from 'node:child_process'
import { isAbsolute } from 'node:path'

let executable: string | undefined

// These process fixtures need only Python's standard library, not a developer's
// downloaded voice runtime. CI supplies an explicit interpreter; local runs use PATH.
export function testPython(): string {
  if (executable) return executable
  const command = process.env.LANJIAN_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const result = spawnSync(command, ['-I', '-c', 'import sys; assert sys.version_info >= (3, 10); print(sys.executable)'], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 15_000,
  })
  const resolved = result.stdout?.trim()
  if (result.error || result.status !== 0 || !resolved || !isAbsolute(resolved)) {
    throw new Error('Process tests require Python 3.10+ on PATH or LANJIAN_TEST_PYTHON set to its executable.')
  }
  return executable = resolved
}
