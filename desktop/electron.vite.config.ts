import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ command, mode }) => ({
  main: {
    define: { __LANJIAN_DEV_SCENARIOS__: JSON.stringify(command === 'serve' || mode === 'smoke') },
    plugins: [externalizeDepsPlugin(), { name: 'companion-fixed-worker', generateBundle() {
      this.emitFile({ type:'asset', fileName:'local-models/text-worker.py', source:readFileSync(resolve('src/main/modules/models/adapters/local-models/text-worker.py')) })
      for (const name of ['worker.py', 'gpt_sovits.py', 'gpt-sovits-assets.json']) this.emitFile({ type: 'asset', fileName: `companion-voice/${name}`, source: readFileSync(resolve('src/main/modules/companion/adapters/companion-voice', name)) })
    } }],
    build: { rollupOptions: { input: resolve('src/main/bootstrap/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
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
