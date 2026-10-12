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
    if (!secrets.available()) throw systemCredentialUnavailable()
  } catch (error) {
    if (error instanceof AppError) throw error
    throw systemCredentialUnavailable()
  }
  try {
    return modelConnectionKey(secrets.decrypt(modelConnectionCiphertext(encrypted)))
  } catch { throw storedCredentialUnreadable() }
}

export function credentialUnavailable(): AppError {
  return new AppError('FEATURE_UNAVAILABLE', '模型接口已停用、未配置密钥或系统安全存储不可用。', { recoverable: true })
}

function systemCredentialUnavailable(): AppError {
  return new AppError('FEATURE_UNAVAILABLE', 'Windows 安全存储当前不可用，请重新启动应用后再试。', { recoverable: true })
}

function storedCredentialUnreadable(): AppError {
  return new AppError('FEATURE_UNAVAILABLE', '已保存的模型密钥无法由当前 Windows 用户解密，请在全局接口中重新保存一次。', { recoverable: true })
}
