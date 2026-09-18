// Shared pinned asset authority for setup, audition and the bounded product worker.
import { readFileSync } from 'node:fs'
export const gptSovitsAssets = JSON.parse(readFileSync(new URL('../../src/main/modules/companion/adapters/companion-voice/gpt-sovits-assets.json', import.meta.url), 'utf8'))
export const gptSovitsModels = gptSovitsAssets.models.filter(model => !gptSovitsAssets.voices.some(voice => voice.key === model.key))
export const gptSovitsVoiceModels = gptSovitsAssets.models.filter(model => gptSovitsAssets.voices.some(voice => voice.key === model.key))
