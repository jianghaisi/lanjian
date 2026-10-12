import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import type { ModelConnectionSecrets } from '../domain/model-connections'

type Run = (executable: string, args: string[], input: string) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'error'>

const ENTROPY = '[Text.Encoding]::UTF8.GetBytes("Lanjian:model-connections:v1")'
const ENCRYPT = encoded(`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$plain=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
try {
  $cipher=[System.Security.Cryptography.ProtectedData]::Protect($plain,${ENTROPY},[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($cipher))
} finally { if($plain){[Array]::Clear($plain,0,$plain.Length)} }
`)
const DECRYPT = encoded(`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$cipher=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$plain=$null
try {
  $plain=[System.Security.Cryptography.ProtectedData]::Unprotect($cipher,${ENTROPY},[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($plain))
} finally {
  if($plain){[Array]::Clear($plain,0,$plain.Length)}
  if($cipher){[Array]::Clear($cipher,0,$cipher.Length)}
}
`)

/** Windows CurrentUser DPAPI authority; plaintext only crosses a bounded anonymous stdin/stdout pipe. */
export class WindowsDpapiModelSecrets implements ModelConnectionSecrets {
  constructor(
    private readonly executable = defaultExecutable(),
    private readonly run: Run = runProtected,
    private readonly canUse = () => process.platform === 'win32' && existsSync(this.executable)
  ) {}

  available(): boolean {
    return this.canUse()
  }

  encrypt(value: string): string {
    return this.invoke(ENCRYPT, Buffer.from(value, 'utf8').toString('base64'))
  }

  decrypt(value: string): string {
    const encodedPlaintext = this.invoke(DECRYPT, value)
    return Buffer.from(encodedPlaintext, 'base64').toString('utf8')
  }

  private invoke(script: string, input: string): string {
    if (!this.available()) throw new Error('DPAPI unavailable')
    const result = this.run(this.executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', script], input)
    if (result.error || result.status !== 0 || typeof result.stdout !== 'string') throw new Error('DPAPI operation failed')
    const output = result.stdout.trim()
    if (!output || output.length > 16_384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output)) throw new Error('DPAPI output invalid')
    return output
  }
}

function defaultExecutable(): string {
  const systemRoot = process.env.SystemRoot
  return systemRoot ? join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : ''
}

function runProtected(executable: string, args: string[], input: string): SpawnSyncReturns<string> {
  return spawnSync(executable, args, {
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 32 * 1024,
    shell: false
  })
}

function encoded(script: string): string {
  return Buffer.from(script.trim(), 'utf16le').toString('base64')
}
