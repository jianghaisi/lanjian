import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile, lstat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { validatePluginManifest, validateCreativeAssets } from '@lanjian/writing-plugin-contracts'

const invalid = () => { throw new Error('Invalid official release source') }
const hash = value => createHash('sha256').update(value).digest('hex')
const key = ref => `${ref.pluginId}@${ref.version}:${ref.digest}`
const reference = pkg => ({ pluginId: pkg.manifest.id, version: pkg.manifest.version, digest: pkg.digest })
const setKey = refs => refs.map(key).sort().join('|')
const closed = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(field => !fields.includes(field))) invalid()
  return value
}
const releaseRef = value => {
  const ref = closed(value, ['pluginId', 'version', 'digest'])
  if (typeof ref.pluginId !== 'string' || !ref.pluginId.length || ref.pluginId.length > 100 || typeof ref.version !== 'string' || !ref.version.length || ref.version.length > 64 || typeof ref.digest !== 'string' || !/^[a-f0-9]{64}$/.test(ref.digest)) invalid()
  return ref
}
async function ordinary(path, directory = false) {
  const info = await lstat(path)
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) invalid()
}
async function text(path) {
  await ordinary(path)
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(path))
}
async function source(base, strict = false) {
  await ordinary(base, true)
  const manifest = validatePluginManifest(JSON.parse(await text(join(base, 'lanjian-plugin.json'))))
  const files = { 'lanjian-plugin.json': JSON.stringify(manifest, null, 2) + '\n' }
  for (const path of [manifest.entry, ...manifest.assets ?? []].sort()) {
    let cursor = base
    const segments = path.split('/')
    for (let i = 0; i < segments.length; i++) { cursor = join(cursor, segments[i]); await ordinary(cursor, i < segments.length - 1) }
    files[path] = await text(cursor)
  }
  if (strict) {
    const declared = new Set(Object.keys(files))
    async function visit(directory, prefix = '') {
      for (const name of await readdir(directory)) {
        const path = prefix + name, full = join(directory, name), info = await lstat(full)
        if (info.isSymbolicLink()) invalid()
        if (info.isDirectory()) {
          if (![...declared].some(file => file.startsWith(path + '/'))) invalid()
          await visit(full, path + '/')
        } else if (!info.isFile() || !declared.delete(path)) invalid()
      }
    }
    await visit(base)
    if (declared.size) invalid()
  }
  validateCreativeAssets(manifest, new Map(Object.entries(files)))
  return { manifest, files, digest: hash(JSON.stringify(files)) }
}
/** Trusted release sources only; importing this module never writes or executes guests. */
export async function buildOfficialCatalog({
  officialRoot = fileURLToPath(new URL('../official/', import.meta.url)),
  historyRoot = fileURLToPath(new URL('../official-history/', import.meta.url)),
  output = fileURLToPath(new URL('../src/official-catalog.generated.ts', import.meta.url)),
} = {}) {
  await ordinary(officialRoot, true); await ordinary(historyRoot, true)
  const current = []
  for (const directory of (await readdir(officialRoot)).sort()) {
    if (directory === '.gitattributes') { await ordinary(join(officialRoot, directory)); continue }
    if (!/^[a-z][a-z-]+$/.test(directory)) invalid()
    current.push(await source(join(officialRoot, directory)))
  }
  const ids = new Set(current.map(pkg => pkg.manifest.id))
  if (!current.length || ids.size !== current.length) invalid()
  const metadata = closed(JSON.parse(await text(join(historyRoot, 'releases.json'))), ['format', 'packages', 'sets'])
  if (metadata.format !== 1 || !Array.isArray(metadata.packages) || !metadata.packages.length || metadata.packages.length > 128 || !Array.isArray(metadata.sets) || !metadata.sets.length || metadata.sets.length > 64) invalid()
  const history = [], byVersion = new Map(), directories = new Set()
  for (const raw of metadata.packages) {
    const pin = closed(raw, ['directory', 'pluginId', 'version', 'digest'])
    releaseRef({ pluginId: pin.pluginId, version: pin.version, digest: pin.digest })
    if (typeof pin.directory !== 'string' || !/^[a-z][a-z-]+\/\d+\.\d+\.\d+$/.test(pin.directory) || directories.has(pin.directory) || !ids.has(pin.pluginId) || typeof pin.digest !== 'string' || !/^[a-f0-9]{64}$/.test(pin.digest)) invalid()
    directories.add(pin.directory)
    await ordinary(join(historyRoot, pin.directory.split('/')[0]), true)
    const pkg = await source(join(historyRoot, pin.directory), true), versionKey = `${pin.pluginId}@${pin.version}`
    if (pkg.manifest.id !== pin.pluginId || pkg.manifest.version !== pin.version || pkg.digest !== pin.digest || byVersion.has(versionKey)) invalid()
    if (pin.directory !== `${pkg.manifest.id.replace(/^lanjian\.official\./, '')}/${pkg.manifest.version}`) invalid()
    byVersion.set(versionKey, pkg); history.push(pkg)
  }
  for (const name of await readdir(historyRoot)) {
    if (['releases.json', '.gitattributes'].includes(name)) { await ordinary(join(historyRoot, name)); continue }
    await ordinary(join(historyRoot, name), true)
    if (![...directories].some(path => path.startsWith(name + '/'))) invalid()
    for (const version of await readdir(join(historyRoot, name))) if (!directories.has(`${name}/${version}`)) invalid()
  }
  for (const pkg of current) {
    const original = byVersion.get(`${pkg.manifest.id}@${pkg.manifest.version}`)
    if (!original || original.digest !== pkg.digest) invalid()
  }
  const sets = [], seenSets = new Set(), known = new Set(history.map(pkg => key(reference(pkg))))
  for (const raw of metadata.sets) {
    if (!Array.isArray(raw) || !raw.length || raw.length > 32) invalid()
    const refs = raw.map(item => {
      const ref = releaseRef(item)
      if (!ids.has(ref.pluginId) || !known.has(key(ref))) invalid()
      return { ...ref }
    })
    const signature = setKey(refs)
    if (new Set(refs.map(ref => ref.pluginId)).size !== refs.length || seenSets.has(signature)) invalid()
    seenSets.add(signature); sets.push(refs)
  }
  if (!seenSets.has(setKey(current.map(reference)))) invalid()
  const generated = '// Generated from official/** and official-history/**; edit release sources, then run npm run build.\n'
    + 'export const officialCatalogData = ' + JSON.stringify(current, null, 2) + ' as const\n'
    + 'export const officialReleaseCatalogData = ' + JSON.stringify(history, null, 2) + ' as const\n'
    + 'export const officialReleaseSetsData = ' + JSON.stringify(sets, null, 2) + ' as const\n'
  await writeFile(output, generated)
  return { current: current.length, versions: history.length, sets: sets.length }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildOfficialCatalog()
  console.log(`Validated ${result.current} current / ${result.versions} original packages / ${result.sets} release sets`)
}
