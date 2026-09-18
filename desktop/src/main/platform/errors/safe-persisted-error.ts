import { isAppError } from '../../core/errors/app-error'

/** Persist only application-authored messages. Provider/runtime errors may
 * contain echoed credentials, request headers, manuscript text or local paths. */
export function safePersistedErrorMessage(error: unknown, fallback: string): string {
  return isAppError(error) ? error.message.slice(0, 1_000) : fallback
}
