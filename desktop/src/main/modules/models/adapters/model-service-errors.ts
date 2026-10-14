import { AppError, isAppError } from '../../../core/errors/app-error'

/** Provider text is used only for classification; it must never become a public message. */
export function modelHttpError(status: number, detail = '', provider = '模型服务'): string {
  const lower = detail.slice(0, 8192).toLowerCase()
  if (status === 401) return '接口密钥无效或已失效，请到模型设置检查并更新密钥后再试。'
  if (status === 403) return /网站防火墙|web application firewall|cloudflare|\bwaf\b/.test(lower)
    ? '请求被服务商防火墙拦截（403）。请联系服务商核对拦截规则；反复重试或修改模型参数通常无效。'
    : '接口拒绝访问（403），可能是型号权限、令牌分组或访问限制。请到服务商控制台核对；确认可访问后再试。'
  if (status === 404) return '接口路径或型号不存在（404）。请到模型设置核对型号、协议和服务商提供的完整地址；不要盲目增删 /v1 或 /v1beta。'
  if (status === 402 || status === 429 && /insufficient_quota|quota.exceeded|insufficient.balance|credit.balance|余额不足|配额.{0,8}(耗尽|用完|不足)/.test(lower)) {
    return '接口余额不足或配额已用完，请到服务商账户补充额度或等待配额恢复后再试；立即重试不会解决。'
  }
  if (status === 429) return '接口请求受限（429）。请稍后重试；如持续出现，请到服务商账户检查限流、余额不足或配额用尽情况。'
  if (status === 400 || status === 422) return '请求被服务拒绝，可能是型号、参数、上下文或工具协议不兼容。请到模型设置核对型号及思考强度；自定义参数可手动恢复自动后再试。若仅在工具调用后失败，请检查接口工具兼容性或联系服务商。本次未自动降级或重试。'
  if (status === 408 || status === 504) return `${provider}响应超时（${status}），请稍后重试；如持续出现，请检查服务状态或选择其他可用型号。`
  if (status >= 500) return `${provider}返回 ${status}，服务暂时不可用。请稍后重试；如持续出现，请联系服务商或选择其他可用型号。`
  return `${provider}返回 ${status}，请求未完成。请核对接口配置并联系服务商确认原因后再试。`
}

export function rethrowModelTransport(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted && signal.reason?.name !== 'TimeoutError') throw signal.reason
  if (isAppError(error)) throw error
  const name = error instanceof Error ? error.name : undefined
  if (name === 'TimeoutError' || signal?.reason?.name === 'TimeoutError') {
    throw new AppError('FEATURE_UNAVAILABLE', '模型请求等待超时，已停止等待。请稍后重试；如反复出现，请检查服务状态或缩小本次请求范围。', { recoverable: true, cause: error })
  }
  if (error instanceof TypeError || name === 'AbortError') {
    throw new AppError('FEATURE_UNAVAILABLE', '无法连接模型服务或接收已中断，已显示的内容保留。请检查接口地址、网络和本机代理后重试；反复出现时联系服务商检查流式回复兼容性。', { recoverable: true, cause: error })
  }
  throw error
}

/** Error bodies are bounded and disposable, including HTML and a stalled error stream. */
export async function readModelError(response: Response, signal?: AbortSignal): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  const bound = signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000)
  const abort = () => { void reader.cancel().catch(() => {}) }
  bound.addEventListener('abort', abort, { once: true })
  let bytes = 0
  try {
    while (bytes < 8192 && !bound.aborted) {
      const { value, done } = await reader.read()
      if (done) break
      const part = value.subarray(0, 8192 - bytes); chunks.push(part); bytes += part.length
    }
    const result = new Uint8Array(bytes); let offset = 0
    for (const part of chunks) { result.set(part, offset); offset += part.length }
    return new TextDecoder().decode(result)
  } catch { return '' }
  finally { bound.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock() }
}
