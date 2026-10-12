import { ContractError, integer, record, text } from './validation.js'
export type SiteLinks = { project: string; download: string; guide: string }
export type SiteLimits = { concurrentJobs: number; dailyAttempts: number; booksPerUser: number; bookMiB: number; userMiB: number }
export type SiteSettings = { revision: number; links: SiteLinks; limits: SiteLimits }
export const defaultLimits: SiteLimits = { concurrentJobs: 4, dailyAttempts: 2000, booksPerUser: 20, bookMiB: 64, userMiB: 256 }
export function siteLinks(value: unknown): SiteLinks {
  const p = record(value, ['project', 'download', 'guide'])
  const link = (v: unknown) => {
    const s = text(v, 2000, 0)
    if (!s) return ''
    let u: URL
    try { u = new URL(s) } catch { throw new ContractError() }
    if (u.protocol !== 'https:' || u.username || u.password) throw new ContractError()
    return u.href
  }
  return { project: link(p.project), download: link(p.download), guide: link(p.guide) }
}
export function siteLimits(value: unknown): SiteLimits {
  const p = record(value, ['concurrentJobs', 'dailyAttempts', 'booksPerUser', 'bookMiB', 'userMiB'])
  const bookMiB = integer(p.bookMiB, 16, 4096), userMiB = integer(p.userMiB, bookMiB, 16384)
  return { concurrentJobs: integer(p.concurrentJobs, 1, 16), dailyAttempts: integer(p.dailyAttempts, 1, 100000), booksPerUser: integer(p.booksPerUser, 1, 200), bookMiB, userMiB }
}
export function siteSettings(value: unknown): SiteSettings {
  const p = record(value, ['revision', 'links', 'limits'])
  return { revision: integer(p.revision, 0, 1e9), links: siteLinks(p.links), limits: siteLimits(p.limits) }
}
