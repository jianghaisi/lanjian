import { readFile, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative } from 'node:path'

export type PortablePythonRuntime = {
  root: string
  environment: string
  python: string
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function containedRealpath(root: string, candidate: string): Promise<string> {
  const resolved = await realpath(candidate)
  if (!isContained(root, resolved)) throw new Error('BUNDLED_PYTHON_PATH')
  return resolved
}

/** Resolve only the Python shipped inside a portable runtime; never consult PATH. */
export async function resolvePortablePython(runtimeRoot: string, environmentPath: string): Promise<PortablePythonRuntime> {
  const root = await realpath(runtimeRoot)
  const environment = await containedRealpath(root, environmentPath)
  const configPath = await containedRealpath(root, join(environment, 'pyvenv.cfg'))
  const config = await readFile(configPath, 'utf8')
  const configuredHome = /^home\s*=\s*(.+)$/mi.exec(config)?.[1]?.trim()
  const version = /^version_info\s*=\s*([0-9]+(?:\.[0-9]+){1,2})\s*$/mi.exec(config)?.[1]
  if (!configuredHome) throw new Error('BUNDLED_PYTHON_PATH')

  let python: string | undefined
  if (isAbsolute(configuredHome)) {
    try {
      const configured = await realpath(join(configuredHome, 'python.exe'))
      if (isContained(root, configured)) python = configured
    } catch {
      // A moved virtual environment normally points to a now-missing old root.
    }
  }

  if (!python) {
    if (!version) throw new Error('BUNDLED_PYTHON_PATH')
    const [major, minor] = version.split('.')
    const configuredDirectory = basename(configuredHome)
    const allowedDirectories = new Set([
      `cpython-${major}.${minor}-windows-x86_64-none`,
      `cpython-${version}-windows-x86_64-none`,
    ].map(value => value.toLowerCase()))
    if (!allowedDirectories.has(configuredDirectory.toLowerCase())) throw new Error('BUNDLED_PYTHON_PATH')
    python = await containedRealpath(root, join(root, 'python', configuredDirectory, 'python.exe'))
  }

  if (!isContained(root, python)) throw new Error('BUNDLED_PYTHON_PATH')
  return { root, environment, python }
}
