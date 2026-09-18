import type { ArgsDecoder } from '../../../contracts/ipc'
import { toAppErrorDto } from '../../../contracts/ipc'
import type { IpcResponse } from '../../../contracts/index'

export type IpcRegistrar = {
  handle: (channel: string, listener: (_event: unknown, ...args: unknown[]) => unknown) => void
}

export function registerValidatedIpc<TArgs extends unknown[], TResult>(
  ipc: IpcRegistrar,
  channel: string,
  decode: ArgsDecoder<TArgs>,
  listener: (...args: TArgs) => TResult | Promise<TResult>
): void {
  ipc.handle(channel, async (_event, ...rawArgs): Promise<IpcResponse<TResult>> => {
    try {
      const args = decode(rawArgs)
      return { ok: true, value: await listener(...args) }
    } catch (error) {
      const appError = toAppErrorDto(error)
      if (process.env.LANJIAN_SMOKE === '1') {
        console.error(`[desktop smoke] IPC ${channel} rejected: ${appError.code} ${appError.message}`)
      }
      return { ok: false, error: appError }
    }
  })
}
