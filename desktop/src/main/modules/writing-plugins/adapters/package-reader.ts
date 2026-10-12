import { readPluginPackage as readPackage } from '@lanjian/writing-plugin-package'
import { AppError } from '../../../core/errors/app-error'
import type { ValidatedPluginPackage } from '../domain/installed'

/** Desktop translates the shared Node package validator's internal failure. */
export async function readPluginPackage(bytes: Uint8Array): Promise<ValidatedPluginPackage> {
  try { return await readPackage(bytes) }
  catch (cause) { throw new AppError('VALIDATION_ERROR', '插件包无效、不兼容或超过容量限制，请检查清单与 ZIP 文件。', { recoverable: true, cause }) }
}
