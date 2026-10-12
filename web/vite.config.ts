import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
const desktopPublic = fileURLToPath(new URL('../desktop/public', import.meta.url))
const pixiModules = Object.keys(JSON.parse(readFileSync(new URL('./node_modules/pixi.js/package.json', import.meta.url), 'utf8')).dependencies)
const webRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(webRoot, '..')
const imageMap = JSON.parse(readFileSync(resolve(webRoot, 'media/image-map.json'), 'utf8')) as Record<string, string>
export default defineConfig({
  base: process.env.LANJIAN_WEB_BASE || '/',
  plugins: [{ name: 'hosted-image-derivatives', enforce: 'pre', transformIndexHtml: { order: 'pre', handler(html) {
    for (const [source, target] of Object.entries(imageMap)) if (source.startsWith('web/')) html = html.replaceAll('/' + source.slice(4), '/' + target)
    return html
  } }, resolveId(source, importer) {
    if (!importer || !/\.(png|webp)$/.test(source)) return
    const absolute = source.startsWith('/') ? resolve(webRoot, '.' + source) : resolve(importer.split('?')[0]!, '..', source)
    const replacement = imageMap[relative(repoRoot, absolute).replaceAll('\\', '/')]
    if (replacement) return resolve(webRoot, replacement)
  } }, { name: 'object-inspect-browser-export', enforce: 'pre', resolveId(source, importer) {
    // object-inspect explicitly maps this optional Node hook to false in its
    // published browser field. Resolve only that declared browser replacement.
    if (source === './util.inspect' && importer?.replaceAll('\\', '/').endsWith('/object-inspect/index.js')) return '\0object-inspect-browser-empty'
  }, load(id) { if (id === '\0object-inspect-browser-empty') return 'export default {}' } }, vue(), { name: 'desktop-public-assets', generateBundle() {
    const visit = (directory: string, base = desktopPublic) => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, item.name)
        if (item.isSymbolicLink()) this.error('Linked desktop assets are unsupported')
        if (item.isDirectory()) visit(path, base)
        else if (item.isFile() && !path.endsWith('.cmo3') && !path.endsWith('.wav')) this.emitFile({ type: 'asset', fileName: relative(base, path).replaceAll('\\', '/'), source: readFileSync(path) })
      }
    }
    visit(desktopPublic)
    visit(resolve(webRoot, 'media/public'), resolve(webRoot, 'media/public'))
    for (const name of ['threeui', 'animatedlogin-react', 'soybean-admin']) this.emitFile({ type: 'asset', fileName: `third-party/${name}-LICENSE.txt`, source: readFileSync(resolve(`src/vendor/${name}/LICENSE`)) })
    for (const name of ['pixi.js', '@pixi/unsafe-eval']) this.emitFile({ type: 'asset', fileName: `third-party/${name.replace('@', '').replace('/', '-')}-LICENSE.txt`, source: readFileSync(resolve(`node_modules/${name}/LICENSE`)) })
    this.emitFile({ type: 'asset', fileName: 'third-party/NOTICES.txt', source: readFileSync(resolve('THIRD-PARTY-NOTICES.md')) })
    this.emitFile({ type: 'asset', fileName: 'third-party/group-chat-NOTICES.txt', source: readFileSync(resolve('../desktop/licenses/group-chat-NOTICES.txt')) })
    for (const name of ['inspiration-NOTICES.txt', 'inspiration-BiliNote-MIT.txt', 'inspiration-LightRAG-MIT.txt',
      'inspiration-yt-dlp-Unlicense.txt', 'inspiration-faster-whisper-MIT.txt']) {
      this.emitFile({ type: 'asset', fileName: `third-party/${name}`, source: readFileSync(resolve('../desktop/licenses', name)) })
    }
  } }, { name: 'browser-only-graph', generateBundle() {
    const parents = (id: string, depth: number): string => depth ? (this.getModuleInfo(id)?.importers ?? []).map(p => `${p} <- ${parents(p, depth - 1)}`).join('; ') : ''
    for (const id of this.getModuleIds()) if (/[/\\]desktop[/\\]src[/\\](main|preload)[/\\]|^(node:|electron$)|__vite-browser-external/.test(id)) this.error(`Forbidden browser dependency: ${id}; imported by ${parents(id, 4)}`)
  } }],
  resolve: { dedupe: ['vue', '@codemirror/state', '@codemirror/view', 'pixi.js', ...pixiModules], alias: { '@shared-ui': fileURLToPath(new URL('../desktop/src/renderer/ui', import.meta.url)) } },
  server: { port: 5175, strictPort: true, proxy: { '/api': 'http://127.0.0.1:43130' }, fs: { allow: ['..'] } },
  build: { sourcemap: false, target: 'es2022', manifest: true, rollupOptions: { input: Object.fromEntries(['index','login','studio','admin','reference'].map(name => [name, resolve(`${name}.html`)])) } }
})
