import { defaultLimits, siteSettings, type SiteSettings } from '@lanjian/hosted-contracts'
import { HostedDatabase, dbString } from '../storage/database.ts'
import { fail } from '../http/errors.ts'
export function readSite(db: HostedDatabase): SiteSettings {
  const row = db.get("SELECT value FROM settings WHERE key='site'")
  return row ? siteSettings(JSON.parse(dbString(row.value))) : { revision: 0, links: { project: '', download: '', guide: '' }, limits: { ...defaultLimits } }
}
export function updateSite(db: HostedDatabase, actor: string, input: unknown): SiteSettings {
  const value = siteSettings(input)
  return db.transaction(() => {
    if (readSite(db).revision !== value.revision) fail('conflict')
    value.revision++
    db.run("INSERT INTO settings VALUES('site',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=excluded.revision", JSON.stringify(value), value.revision)
    db.audit(actor, 'site-update', 'site', { revision: value.revision, limits: value.limits })
    return value
  })
}
