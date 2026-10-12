import { AppError } from '../../../core/errors/app-error'
import type { ModelRequestGuard } from '../domain/model-provider'
import type { WorldMapBackground } from '../../../../contracts/world-map/world-map'

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_BASE64_CHARACTERS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8

export type GeneratedImage = { bytes: Buffer; format: WorldMapBackground['format']; width: number; height: number }
type ConnectionResolver = { resolveConnection(connectionId: string): Promise<{ connectionName: string; baseUrl: string; apiKey: string; requestGuard?: ModelRequestGuard }> }
type Fetch = typeof fetch

export class OpenAiCompatibleImageClient {
  constructor(private readonly settings: ConnectionResolver, private readonly request: Fetch = fetch) {}

  async generate(connectionId: string, model: string, prompt: string, signal?: AbortSignal, beforeSend?: () => Promise<void>): Promise<GeneratedImage & { connectionName: string }> {
    const connection = await this.settings.resolveConnection(connectionId)
    await beforeSend?.()
    signal?.throwIfAborted()
    if (connection.requestGuard) await connection.requestGuard.recheck()
    signal?.throwIfAborted()
    connection.requestGuard?.assertActive()
    let response: Response
    try {
      response = await this.request(`${connection.baseUrl.replace(/\/+$/, '')}/images/generations`, {
        method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
        headers: { Authorization: `Bearer ${connection.apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.trim(), prompt, n: 1, size: '1536x1024', quality: 'medium', output_format: 'png' })
      })
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new AppError('FEATURE_UNAVAILABLE', error.name === 'AbortError' ? '地图生成已取消。' : '图像服务长时间没有返回结果，请稍后重试。', { recoverable: true, cause: error })
      }
      throw new AppError('FEATURE_UNAVAILABLE', '无法连接图像服务，请检查接口地址、网络和本机代理。', { recoverable: true, cause: error })
    }
    if (!response.ok) throw new AppError('FEATURE_UNAVAILABLE', providerMessage(response.status), { recoverable: true })
    let payload: unknown
    try { payload = await response.json() } catch (cause) {
      throw new AppError('AI_RESPONSE_INVALID', '图像服务返回了无法解析的数据。', { recoverable: true, cause })
    }
    const encoded = imageBase64(payload)
    const bytes = decodeBase64(encoded)
    const image = inspectImage(bytes)
    signal?.throwIfAborted()
    if (connection.requestGuard) await connection.requestGuard.recheck()
    signal?.throwIfAborted()
    connection.requestGuard?.assertActive()
    return { ...image, bytes, connectionName: connection.connectionName }
  }
}

function imageBase64(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalidResponse()
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object' || Array.isArray(data[0])) return invalidResponse()
  const item = data[0] as { b64_json?: unknown; url?: unknown }
  if (typeof item.b64_json !== 'string') {
    if (typeof item.url === 'string') throw new AppError('FEATURE_UNAVAILABLE', '该图像接口只返回远程链接，地图 Beta 暂不下载外部图片。请改用支持 base64 返回的图像模型。', { recoverable: true })
    return invalidResponse()
  }
  if (!item.b64_json || item.b64_json.length > MAX_BASE64_CHARACTERS) throw new AppError('AI_RESPONSE_INVALID', '图像服务返回的图片为空或超过 12 MB 限制。', { recoverable: true })
  return item.b64_json
}

function invalidResponse(): never { throw new AppError('AI_RESPONSE_INVALID', '图像服务没有返回可用图片。', { recoverable: true }) }

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/\s/g, '')
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) invalidResponse()
  const bytes = Buffer.from(normalized, 'base64')
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new AppError('AI_RESPONSE_INVALID', '图像服务返回的图片为空或超过 12 MB 限制。', { recoverable: true })
  return bytes
}

export function inspectImage(bytes: Buffer): GeneratedImage {
  let format: WorldMapBackground['format'], width = 0, height = 0
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    format = 'png'; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20)
  } else if (bytes.length >= 30 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    format = 'jpeg'; ({ width, height } = jpegSize(bytes))
  } else if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    format = 'webp'; ({ width, height } = webpSize(bytes))
  } else return invalidImage()
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || height < 256 || width > 8192 || height > 8192 || width * height > 20_000_000) invalidImage()
  const ratio = width / height
  if (ratio < .75 || ratio > 3) invalidImage()
  return { bytes, format, width, height }
}

function jpegSize(bytes: Buffer): { width: number; height: number } {
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    const marker = bytes[offset + 1]
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
    const length = bytes.readUInt16BE(offset + 2)
    if (length < 2 || offset + 2 + length > bytes.length) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  return { width: 0, height: 0 }
}

function webpSize(bytes: Buffer): { width: number; height: number } {
  const kind = bytes.toString('ascii', 12, 16)
  if (kind === 'VP8X' && bytes.length >= 30) return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
  if (kind === 'VP8 ' && bytes.length >= 30) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    return { width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8), height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10) }
  }
  return { width: 0, height: 0 }
}

function invalidImage(): never { throw new AppError('AI_RESPONSE_INVALID', '图像服务返回的文件不是可用的 PNG、JPEG 或 WebP 地图。', { recoverable: true }) }
function providerMessage(status: number): string {
  if (status === 401) return '图像接口密钥无效或已经失效。'
  if (status === 403) return '当前密钥没有图像模型调用权限。'
  if (status === 404) return '接口不支持 /images/generations，请检查兼容地址或图像模型。'
  if (status === 429) return '图像接口当前限流、余额不足或配额已用完。'
  if (status === 400) return '图像请求被服务拒绝，请检查模型名称或接口兼容性。'
  return `图像服务返回 ${status}，请稍后重试。`
}
