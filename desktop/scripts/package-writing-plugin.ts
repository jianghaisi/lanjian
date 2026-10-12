import { lstat, readFile, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import JSZip from 'jszip'
import { codePluginLimits, validatePluginManifest } from '@lanjian/writing-plugin-contracts'
import { readPluginPackage } from '../src/main/modules/writing-plugins/adapters/package-reader'

const [source, output] = process.argv.slice(2)
if (!source || !output) throw new Error('用法：npx tsx scripts/package-writing-plugin.ts <插件目录> <输出.zip>')
const root = resolve(source), target = resolve(output)
if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new Error('插件目录必须是实际目录')
async function file(relative: string, max: number) {
  const path = join(root, relative)
  for (let parent = dirname(path); parent !== root; parent = dirname(parent)) if ((await lstat(parent)).isSymbolicLink()) throw new Error('不接受链接目录')
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw new Error('插件文件无效或过大')
  return readFile(path)
}
const manifestBytes = await file('lanjian-plugin.json', codePluginLimits.manifestBytes)
const manifest = validatePluginManifest(JSON.parse(manifestBytes.toString('utf8')))
const zip = new JSZip().file('lanjian-plugin.json', manifestBytes)
for (const path of [manifest.entry, ...manifest.assets ?? []]) zip.file(path, await file(path, codePluginLimits.entryBytes))
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
await readPluginPackage(bytes)
await writeFile(target, bytes, { flag: 'wx' })
console.log(`已校验并打包 ${manifest.name} ${manifest.version}：${target}`)
