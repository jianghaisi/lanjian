/** The hosted runtime is installed before AppShell; desktop behavior is unchanged. */
export function hostedModelMode(): boolean {
  return typeof window !== 'undefined' && window.novelDesktop?.app.platform === 'browser'
}
