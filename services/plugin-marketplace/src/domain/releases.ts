export type Publisher = { id: string }
export type IdentityPort = (authorization: string | undefined) => Promise<Publisher>
export class MarketError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}
export const deny = (status: number, code: string): never => { throw new MarketError(status, code) }
