/** The protocol carries an authorization code only, never a token. Cold-start
 * callbacks are ignored because no in-memory PKCE session exists yet. */
let consume: ((url: string) => Promise<boolean>) | undefined
export function setMarketplaceCallback(handler: (url: string) => Promise<boolean>) { consume = handler }
export function receiveMarketplaceCallback(args: string[]) {
  for (const arg of args) if (arg.startsWith('cn.zuolan.novelwriter:')) { void consume?.(arg).catch(() => {}); break }
}
