import { readFile, readdir, stat } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { dirname, extname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { babelParse, parse } from 'vue/compiler-sfc'

const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')))
const nativeImport = name => name === 'electron' || builtins.has(name.replace(/^node:/, ''))
function visit(node, callback) {
  if (!node || typeof node !== 'object') return
  if (node.type) callback(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'extra') continue
    if (Array.isArray(value)) value.forEach(item => visit(item, callback))
    else if (value && typeof value === 'object') visit(value, callback)
  }
}

export async function checkArchitecture(root) {
  const sourceRoot = resolve(root, 'src')
  const files = (await readdir(sourceRoot, { recursive: true }))
    .filter(name => /\.(?:[cm]?[jt]s|vue)$/.test(name) && !name.endsWith('.d.ts'))
    .map(name => resolve(sourceRoot, name))
  const known = new Set(files)
  const graph = new Map(files.map(file => [file, []]))
  const externals = new Map(files.map(file => [file, []]))
  const violations = []
  const normalized = path => relative(root, path).replaceAll('\\', '/')
  async function resolveImport(file, specifier) {
    const base = specifier.startsWith('@/') ? resolve(sourceRoot, 'renderer', specifier.slice(2)) : resolve(dirname(file), specifier)
    for (const candidate of [base, ...['.ts', '.js', '.mjs', '.cjs', '.cts', '.json', '/index.ts', '/index.js'].map(extension => base + extension)]) {
      if (known.has(candidate)) return candidate
      try { if ((await stat(candidate)).isFile()) return candidate } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error }
    }
    if (/\.[cm]?js$/.test(base) && known.has(base.replace(/\.[cm]?js$/, '.ts'))) return base.replace(/\.[cm]?js$/, '.ts')
    return null
  }
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    const script = extname(file) === '.vue' ? (() => { const { descriptor } = parse(text); return [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join('\n') })() : text
    const ast = babelParse(script, { sourceType: 'module', plugins: ['typescript', 'importAttributes'] })
    const imports = []
    visit(ast.program, node => {
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
        const typeOnly = node.importKind === 'type' || node.exportKind === 'type' || (node.specifiers?.length > 0 && node.specifiers.every(item => item.importKind === 'type' || item.exportKind === 'type'))
        imports.push({ specifier: node.source.value, typeOnly, dynamic: false })
      } else if (node.type === 'CallExpression' && (node.callee.type === 'Import' || (node.callee.type === 'Identifier' && node.callee.name === 'require'))) {
        const argument = node.arguments[0]
        if (argument?.type === 'StringLiteral') imports.push({ specifier: argument.value, typeOnly: false, dynamic: true })
        else if (argument?.type === 'TemplateLiteral' && argument.expressions.length === 0) imports.push({ specifier: argument.quasis[0].value.cooked, typeOnly: false, dynamic: true })
        else violations.push(`${normalized(file)}: computed module loading cannot be checked`)
      }
    })
    for (const { specifier, typeOnly, dynamic } of imports) {
      const from = normalized(file)
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
        if (!typeOnly && nativeImport(specifier)) externals.get(file).push(specifier)
        continue
      }
      const target = await resolveImport(file, specifier)
      if (!target) { violations.push(`${from}: unresolved import ${specifier}`); continue }
      const to = normalized(target)
      if ((from.startsWith('src/renderer/') || from.startsWith('src/contracts/')) && to.startsWith('src/main/')) violations.push(`${from}: crosses into main (${to})`)
      // Only the development window hook may lazily load the scenario driver.
      if (from.startsWith('src/main/') && to.startsWith('tests/') && !(dynamic && from === 'src/main/bootstrap/create-main-window.ts' && to === 'tests/smoke/desktop-scenario-driver.ts')) violations.push(`${from}: imports test implementation (${to})`)
      if (from.startsWith('src/main/modules/') && to.startsWith('src/main/bootstrap/')) violations.push(`${from}: feature imports composition root (${to})`)
      if (from.includes('/domain/') && /\/(adapters|runtime|bootstrap|renderer)\//.test(to)) violations.push(`${from}: domain imports outer implementation (${to})`)
      if (!typeOnly && known.has(target)) graph.get(file).push(target)
    }
  }
  // A barrel or lazy import must not hide a native dependency from either sandbox.
  for (const entry of files.filter(file => /^src\/(renderer|preload)\//.test(normalized(file)))) {
    const pending = [[entry]], seen = new Set()
    while (pending.length) {
      const chain = pending.pop(), file = chain.at(-1)
      if (seen.has(file)) continue
      seen.add(file)
      for (const specifier of externals.get(file)) {
        if (normalized(entry).startsWith('src/preload/') && normalized(file).startsWith('src/preload/') && specifier === 'electron') continue
        violations.push(`Native runtime dependency: ${chain.map(normalized).join(' -> ')} -> ${specifier}`)
      }
      for (const next of graph.get(file)) pending.push([...chain, next])
    }
  }
  // Type-only recursion cannot form a runtime initialization cycle.
  let nextIndex = 0
  const indices = new Map(), lows = new Map(), stack = [], active = new Set()
  function connect(file) {
    indices.set(file, nextIndex); lows.set(file, nextIndex++)
    stack.push(file); active.add(file)
    for (const target of graph.get(file)) {
      if (!indices.has(target)) { connect(target); lows.set(file, Math.min(lows.get(file), lows.get(target))) }
      else if (active.has(target)) lows.set(file, Math.min(lows.get(file), indices.get(target)))
    }
    if (lows.get(file) !== indices.get(file)) return
    const component = []; let item
    do { item = stack.pop(); active.delete(item); component.push(item) } while (item !== file)
    if (component.length > 1 || graph.get(file).includes(file)) violations.push('Runtime cycle: ' + component.map(normalized).sort().join(' -> '))
  }
  for (const file of files) if (!indices.has(file)) connect(file)
  return { files: files.length, runtimeEdges: [...graph.values()].reduce((sum, edges) => sum + edges.length, 0), violations: [...new Set(violations)] }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkArchitecture(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
  console.log(JSON.stringify(result, null, 2))
  if (result.violations.length) process.exitCode = 1
}
