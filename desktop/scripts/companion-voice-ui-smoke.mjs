// Uses the existing isolated library fixture, real local models and Electron playback.
process.env.LANJIAN_SMOKE_STORAGE_ONLY = '1'
process.env.LANJIAN_SMOKE_APPROVED_REFERENCE_ONLY = '1'
process.env.LANJIAN_SMOKE_LIBRARY_REFERENCE_ONLY = '1'
process.env.LANJIAN_SMOKE_COMPANION_VOICE = '1'
await import('./electron-smoke.mjs')
