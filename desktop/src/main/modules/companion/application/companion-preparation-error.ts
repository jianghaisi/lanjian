import { AppError, isAppError } from '../../../core/errors/app-error'

/** Fixed messages only. Never expose third-party errors, paths, traces or input text. */
export function companionPreparationError(error: unknown): AppError {
  if (isAppError(error)) return error
  const code = error instanceof Error ? error.message : ''
  const stages: Record<string, string> = { startup: '启动语音进程', verify: '校验语音文件', runtime: '初始化语音环境', weights: '载入语音模型', warmup: '准备首次发声' }
  const stage = code.startsWith('VOICE_PREPARATION_STALLED:') ? stages[code.slice('VOICE_PREPARATION_STALLED:'.length)] : undefined
  let message = '语音初始化未完成。请重试；如持续失败，可关闭语音继续使用作品库。'
  if (stage) message = `${stage}长时间没有完成，已停止本次准备。可重试或跳过语音等待。`
  else if (code === 'VOICE_PREPARATION_TIMEOUT' || code === 'VOICE_TIMEOUT') message = '本次模型准备超时，已停止加载。可重试或跳过语音等待。'
  else if (code === 'VOICE_WORKER_EXIT') message = '本地语音进程意外退出。请释放部分内存后重试。'
  else if (code === 'VOICE_MEMORY') message = '语音准备时内存或显存不足。请关闭其他高占用程序后重试。'
  else if (code === 'VOICE_CUDA_UNAVAILABLE') message = '语音模型未能使用显卡，请检查显卡驱动后重试。'
  else if (code === 'VOICE_ASSETS_INVALID') message = '语音模型或运行文件缺失、校验未通过。请检查本地安装，不必反复重新加载。'
  else if (code === 'VOICE_CANCELLED') return new AppError('CONFLICT', '模型准备已取消。', { recoverable: true })
  return new AppError('FEATURE_UNAVAILABLE', message, { recoverable: true })
}
