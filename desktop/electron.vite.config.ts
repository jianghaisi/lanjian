import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const resolveDependency = createRequire(import.meta.url).resolve

// electron-vite 5's isolated-entry progress reporter calls TTY methods even in
// piped CI builds. Suppress only that terminal cursor control when unavailable.
if (!process.stdout.isTTY) {
  process.stdout.clearLine ??= () => true
  process.stdout.cursorTo ??= () => true
  process.stdout.moveCursor ??= () => true
}

export default defineConfig(({ command, mode }) => ({
  main: {
    define: { __LANJIAN_DEV_SCENARIOS__: JSON.stringify(command === 'serve' || mode === 'smoke') },
    plugins: [externalizeDepsPlugin({ exclude: ['@lanjian/writing-plugin-contracts', '@lanjian/writing-plugin-package', 'quickjs-emscripten-core', '@jitl/quickjs-wasmfile-release-sync', '@jitl/quickjs-ffi-types'] }), { name: 'companion-fixed-worker', generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'writing-plugins/quickjs.wasm', source: readFileSync(resolveDependency('@jitl/quickjs-wasmfile-release-sync/wasm')) })
      for (const name of ['worker.py', 'requirements.lock', 'runtime-lock.json']) this.emitFile({ type:'asset', fileName:`inspiration/${name}`, source:readFileSync(resolve('src/main/modules/inspiration/adapters/video',name)) })
      this.emitFile({ type:'asset', fileName:'local-models/text-worker.py', source:readFileSync(resolve('src/main/modules/models/adapters/local-models/text-worker.py')) })
      this.emitFile({ type:'asset', fileName:'local-models/text_prompts.py', source:readFileSync(resolve('src/main/modules/models/adapters/local-models/text_prompts.py')) })
      for (const name of ['worker.py', 'gpt_sovits.py', 'gpt-sovits-assets.json']) this.emitFile({ type: 'asset', fileName: `companion-voice/${name}`, source: readFileSync(resolve('src/main/modules/companion/adapters/companion-voice', name)) })
    } }],
    build: { rollupOptions: {
      input: { index: resolve('src/main/bootstrap/index.ts'), 'writing-plugins/host': resolve('src/main/modules/writing-plugins/runtime/electron-guest-process.ts'), 'writing-plugins/guest-worker': resolve('src/main/modules/writing-plugins/runtime/guest-worker.ts') },
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: chunk => chunk.name.startsWith('writing-plugins/') ? '[name].mjs' : '[name].js' }
    } }
  },
  preload: {
    build: {
      isolatedEntries: true,
      externalizeDeps: false,
      // Sandboxed Electron preload scripts must be self-contained CommonJS.
      // The project itself is ESM, so pin both the format and extension here.
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts'), 'desktop-pet': resolve('src/preload/desktop-pet.ts') },
        // Each sandboxed entry must remain self-contained, without require('./shared-chunk').
        preserveEntrySignatures: 'strict',
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: '.',
    base: './',
    resolve: { alias: { '@': resolve('src/renderer') } },
    plugins: [vue()],
    build: { rollupOptions: { input: { index: resolve('index.html'), pet: resolve('pet.html') } } }
  }
}))
