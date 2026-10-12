const errors = {
  'invalid-request': [400, '请求格式无效。'],
  'login-required': [401, '请先登录。'],
  'account-disabled': [403, '此账户已停用。'],
  'admin-required': [403, '此操作需要管理员权限。'],
  'csrf-invalid': [403, '请求已失效，请刷新后重试。'],
  'not-found': [404, '内容不存在或不可访问。'],
  'conflict': [409, '内容或操作已改变，请刷新后重试。'],
  'insufficient-credits': [402, '积分不足，请联系站长。'],
  'pricing-required': [409, '站长尚未配置此模型的计费方式。'],
  'configuration-required': [503, '站点尚未完成此功能的配置。'],
  'oauth-failed': [502, '登录服务暂时不可用，请稍后重试。'],
  'oauth-state-invalid': [400, '登录请求已失效，请重新登录。'],
  'request-limit': [429, '请求过于频繁，请稍后重试。'],
  'quota-exceeded': [409, '已达到配置的容量限制。'],
  'request-too-large': [413, '提交内容过大。'],
  'model-failed': [502, '模型请求未完成，已保留现有内容。请查看任务与积分状态。'],
  'usage-unconfirmed': [409, '上游用量暂时无法确认，相关积分已预留，等待站长核对。'],
  'internal-error': [500, '操作未完成，现有内容已保留。']
} as const
export type ErrorCode = keyof typeof errors
export class HostedError extends Error {
  readonly status: number
  readonly publicMessage: string
  constructor(readonly code: ErrorCode) {
    super(code); this.status = errors[code][0]; this.publicMessage = errors[code][1]
  }
}
export function fail(code: ErrorCode): never { throw new HostedError(code) }
