import { AppError } from '../../../core/errors/app-error'
import { modelConnectionCiphertext, modelConnectionKey, type ModelConnectionSecrets } from '../domain/model-connections'

export function encryptModelConnectionKey(secrets: ModelConnectionSecrets, value: string): string {
  try {
    if (!secrets.available()) throw credentialUnavailable()
    const encrypted = modelConnectionCiphertext(secrets.encrypt(modelConnectionKey(value)))
    if (encrypted === value) throw credentialUnavailable()
    return encrypted
  } catch { throw credentialUnavailable() }
}

export function decryptModelConnectionKey(secrets: ModelConnectionSecrets, encrypted: string): string {
  try {
    if (!secrets.available()) throw credentialUnavailable()
    return modelConnectionKey(secrets.decrypt(modelConnectionCiphertext(encrypted)))
  } catch { throw credentialUnavailable() }
}

export function credentialUnavailable(): AppError {
  return new AppError('FEATURE_UNAVAILABLE', '模型接口已停用、未配置密钥或系统安全存储不可用。', { recoverable: true })
}
