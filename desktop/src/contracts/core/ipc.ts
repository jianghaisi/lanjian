import { isAppError } from './app-error'
import type { AppErrorDto } from '../index'
import type { ArgsDecoder } from './validation'
import { exactArgs, uuid } from './validation'

export const decodeNoArgs: ArgsDecoder<[]> = (args) => {
  exactArgs(args, 0)
  return []
}

export const decodeJobIdArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  return [uuid(args[0], 'jobId')]
}

export function toAppErrorDto(error: unknown): AppErrorDto {
  if (isAppError(error)) {
    return { code: error.code, message: error.message, recoverable: error.recoverable, details: error.details }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: '本次操作未完成，请重试；若问题持续，请保留当前书稿并重新启动应用。',
    recoverable: true
  }
}
