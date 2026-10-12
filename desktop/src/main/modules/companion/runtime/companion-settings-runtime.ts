import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { AppError } from '../../../core/errors/app-error'
import { toAppErrorDto } from '../../../../contracts/ipc'
import { CompanionSettingsStore } from '../adapters/companion-settings-store'
import { decodeCompanionSettingsPatch, decodeVoicePreferences, type CompanionSettings, type CompanionVoicePreferences } from '../../../../contracts/companion/companion-settings'

export function registerCompanionSettings(directory: string, authorize: (event: IpcMainInvokeEvent, ownerOnly?: boolean) => void, changed: (value: CompanionSettings) => void) {
  const store = new CompanionSettingsStore(directory)
  for (const action of ['get', 'import', 'update', 'recover'] as const) {
    ipcMain.handle(`companion-settings:${action}`, async (event, input: unknown) => {
      try {
        authorize(event, action === 'import' || action === 'recover')
        if ((action === 'get' || action === 'recover') && input !== undefined) throw new Error('SETTINGS_ARGUMENTS')
        const result = action === 'get' ? await store.read() : action === 'import' ? await store.importVoice(decodeVoicePreferences(input) as CompanionVoicePreferences) : action === 'recover' ? await store.recover() : await store.update(decodeCompanionSettingsPatch(input))
        if (action !== 'get') changed(result)
        return { ok: true, value: result }
      } catch (reason) {
        const error = reason instanceof AppError ? reason : new AppError('VALIDATION_ERROR', '伙伴设置格式无效，请重新设置。', { recoverable: true })
        return { ok: false, error: toAppErrorDto(error) }
      }
    })
  }
  return store
}
