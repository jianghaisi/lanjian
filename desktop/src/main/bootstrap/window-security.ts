/** URLs opened outside the app must be ordinary web links without embedded
 * credentials. File, shell, javascript and custom protocols stay denied. */
export function isAllowedExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}

/** Development pages may navigate within their HTTP(S) origin. A packaged
 * file page may only change query/hash on the exact renderer entry file. */
export function isAllowedAppNavigation(currentRaw: string, targetRaw: string): boolean {
  try {
    const current = new URL(currentRaw)
    const target = new URL(targetRaw)
    if (target.username || target.password) return false
    if (current.protocol === 'file:') {
      return target.protocol === 'file:' && target.host === current.host && target.pathname === current.pathname
    }
    return ['http:', 'https:'].includes(current.protocol)
      && target.protocol === current.protocol
      && target.origin === current.origin
  } catch { return false }
}
