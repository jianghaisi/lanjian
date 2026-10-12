/** IPC errors are plain validated DTOs, not necessarily Error instances. */
export function pluginError(cause: unknown, fallback: string): string {
  return cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' && cause.message.length <= 600 ? cause.message : fallback
}
