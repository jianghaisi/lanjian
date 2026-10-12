import { build } from 'esbuild'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const result = await build({ entryPoints: ['src/server.ts', 'src/operator-model.ts'], outdir: 'dist', bundle: true, platform: 'node',
  format: 'esm', target: 'node24', sourcemap: false, metafile: true,
  packages: 'bundle', external: ['better-auth', 'better-auth/*', 'fastify', '@lanjian/hosted-contracts', 'mammoth', 'jszip'],
  alias: {
    '@lanjian/writing-plugin-contracts': fileURLToPath(new URL('../../../packages/writing-plugin-contracts/src/index.ts', import.meta.url)),
    '@lanjian/writing-plugin-package/official': fileURLToPath(new URL('../../../packages/writing-plugin-package/src/official.ts', import.meta.url)),
    '@lanjian/writing-plugin-package': fileURLToPath(new URL('../src/writing/unavailable-plugin-package.ts', import.meta.url))
  },
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }
})
// The shared book-settings decoder uses catalog.ts as inert validation data.
// No downloader, model process, worker, weight or speech runtime may enter.
const forbidden = /(?:^|\/)(?:electron|companion-voice|quickjs-emscripten)(?:\/|$)|\/local-models\/(?!catalog\.ts$)/u
const unsupported = Object.keys(result.metafile.inputs).filter(path => forbidden.test(path.replaceAll('\\', '/')))
if (unsupported.length) throw new Error(`Hosted bundle includes an unsupported runtime: ${unsupported.join(', ')}`)
if (!Object.keys(result.metafile.inputs).some(path => path.replaceAll('\\', '/').endsWith('writing-plugin-package/src/official-catalog.generated.ts'))) {
  throw new Error('Hosted bundle is missing the released creative policy assets')
}
await mkdir('dist', { recursive: true })
await writeFile('dist/inputs.json', JSON.stringify(Object.keys(result.metafile.inputs).sort(), null, 2) + '\n')
await mkdir('dist/third-party', { recursive: true })
for (const name of ['inspiration-NOTICES.txt', 'inspiration-BiliNote-MIT.txt',
  'inspiration-LightRAG-MIT.txt', 'inspiration-yt-dlp-Unlicense.txt', 'inspiration-faster-whisper-MIT.txt']) {
  await copyFile(fileURLToPath(new URL(`../../../desktop/licenses/${name}`, import.meta.url)), `dist/third-party/${name}`)
}
