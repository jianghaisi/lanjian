// Reuse the real Electron fixture launcher: unique temporary userData, temporary
// smoke book, localhost-only provider, and no access to the author's open client.
process.env.LANJIAN_SMOKE_STORAGE_ONLY = '1'
process.env.LANJIAN_SMOKE_APPROVED_REFERENCE_ONLY = '1'
if (process.argv.includes('--library-only')) process.env.LANJIAN_SMOKE_LIBRARY_REFERENCE_ONLY = '1'
await import('./electron-smoke.mjs')
