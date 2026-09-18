export type AppErrorDto = {
  code: string
  message: string
  recoverable: boolean
  details?: Record<string, unknown>
}

export type IpcResponse<T> = { ok: true; value: T } | { ok: false; error: AppErrorDto }
