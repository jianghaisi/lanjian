import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { decodeMarketRelease, marketLimits, type MarketQuery, type MarketRelease, type PublishRequest } from '@lanjian/writing-plugin-contracts'
import { deny } from '../domain/releases.ts'

type Row = { record: string; ticket: string; expires: number; owner: string }
export class CatalogStore {
  private readonly db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version)
    if (version !== 0 && version !== 1) { this.db.close(); throw new Error('Unsupported marketplace catalog version') }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS publishers (id TEXT PRIMARY KEY, official INTEGER NOT NULL DEFAULT 0 CHECK(official IN (0,1)));
      CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES publishers(id));
      CREATE TABLE IF NOT EXISTS releases (operation TEXT PRIMARY KEY, plugin TEXT NOT NULL REFERENCES plugins(id), version TEXT NOT NULL, owner TEXT NOT NULL, state TEXT NOT NULL, record TEXT NOT NULL, ticket TEXT NOT NULL, expires INTEGER NOT NULL, UNIQUE(plugin,version));
      CREATE INDEX IF NOT EXISTS releases_owner ON releases(owner,state);
      CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY, operation TEXT NOT NULL, state TEXT NOT NULL, occurred_at TEXT NOT NULL);`)
    if (version === 0) this.db.exec('PRAGMA user_version=1')
  }
  close() { this.db.close() }
  private row(operation: string) { return this.db.prepare('SELECT record,ticket,expires,owner FROM releases WHERE operation=?').get(operation) as Row | undefined }
  get(operation: string, owner?: string): MarketRelease {
    const row = this.row(operation)
    if (!row || owner && row.owner !== owner) return deny(404, 'release-not-found')
    return decodeMarketRelease(JSON.parse(row.record))
  }
  prepare(owner: string, request: PublishRequest) {
    const found = this.row(request.operationId)
    if (found) {
      if (found.owner !== owner) return deny(403, 'wrong-owner')
      const existing = decodeMarketRelease(JSON.parse(found.record))
      for (const key of ['manifest', 'digest', 'bytes', 'upstream'] as const) if (JSON.stringify(existing[key]) !== JSON.stringify(request[key])) return deny(409, 'operation-conflict')
      return { release: existing, ticket: found.ticket, expires: found.expires }
    }
    const plugin = this.db.prepare('SELECT owner FROM plugins WHERE id=?').get(request.manifest.id)
    if (plugin && plugin.owner !== owner) return deny(403, 'wrong-owner')
    if (this.db.prepare('SELECT 1 FROM releases WHERE plugin=? AND version=?').get(request.manifest.id, request.manifest.version)) return deny(409, 'immutable-version')
    const pending = this.db.prepare("SELECT count(*) AS count FROM releases WHERE owner=? AND state IN ('uploading','validating') AND expires>?").get(owner, Date.now())!
    const quota = this.db.prepare('SELECT count(*) AS count, COALESCE(sum(json_extract(record,\'$.bytes\')),0) AS bytes FROM releases').get()!
    if (Number(pending.count) >= marketLimits.pendingUploads || Number(quota.count) >= 10000 || Number(quota.bytes) + request.bytes > 1024 * 1024 * 1024) return deny(429, 'upload-quota')
    const ticket = randomUUID(), expires = Date.now() + marketLimits.ticketMs
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT OR IGNORE INTO publishers(id) VALUES(?)').run(owner)
      this.db.prepare('INSERT OR IGNORE INTO plugins(id,owner) VALUES(?,?)').run(request.manifest.id, owner)
      const official = this.db.prepare('SELECT official FROM publishers WHERE id=?').get(owner)!.official === 1
      const release: MarketRelease = { ...request, state: 'uploading', distribution: official ? 'official' : 'community', publisherId: owner, createdAt: new Date().toISOString(), failure: null, manualReview: false }
      this.db.prepare('INSERT INTO releases VALUES(?,?,?,?,?,?,?,?)').run(request.operationId, request.manifest.id, request.manifest.version, owner, release.state, JSON.stringify(release), ticket, expires)
      this.event(release); this.db.exec('COMMIT'); return { release, ticket, expires }
    } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  checkTicket(operation: string, owner: string, ticket: string) {
    const row = this.row(operation), release = this.get(operation, owner)
    if (!row || row.ticket !== ticket || release.state === 'uploading' && row.expires <= Date.now()) return deny(409, 'upload-expired')
    return release
  }
  private event(release: MarketRelease) { this.db.prepare('INSERT INTO events(operation,state,occurred_at) VALUES(?,?,?)').run(release.operationId, release.state, new Date().toISOString()) }
  transition(operation: string, expected: MarketRelease['state'], state: MarketRelease['state'], failure: MarketRelease['failure'] = null) {
    const current = this.get(operation); if (current.state !== expected) return deny(409, 'release-state-conflict')
    const updated = decodeMarketRelease({ ...current, state, failure })
    this.db.exec('BEGIN IMMEDIATE')
    try { this.db.prepare('UPDATE releases SET state=?,record=? WHERE operation=? AND state=?').run(state, JSON.stringify(updated), operation, expected); this.event(updated); this.db.exec('COMMIT'); return updated }
    catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  pending() { return (this.db.prepare("SELECT record FROM releases WHERE state='validating' OR (state='uploading' AND expires<=?) LIMIT 10000").all(Date.now()) as { record: string }[]).map(r => decodeMarketRelease(JSON.parse(r.record))) }
  mine(owner: string, offset: number, limit: number) {
    const rows = this.db.prepare('SELECT record FROM releases WHERE owner=? ORDER BY rowid DESC LIMIT ? OFFSET ?').all(owner, limit + 1, offset) as { record: string }[]
    return { releases: rows.slice(0, limit).map(r => decodeMarketRelease(JSON.parse(r.record))), nextOffset: rows.length > limit ? offset + limit : null }
  }
  catalog(query: MarketQuery, pluginId?: string) {
    const clauses = ["state='published'"], args: (number | string)[] = []
    if (pluginId) { clauses.push('plugin=?'); args.push(pluginId) }
    else clauses.push("rowid=(SELECT MAX(newer.rowid) FROM releases newer WHERE newer.plugin=releases.plugin AND newer.state='published')")
    if (query.query) { clauses.push("instr(lower(json_extract(record,'$.manifest.name') || ' ' || json_extract(record,'$.manifest.description') || ' ' || COALESCE(json_extract(record,'$.manifest.tags'),'')),?)>0"); args.push(query.query.toLowerCase()) }
    for (const category of query.categories) { clauses.push("EXISTS(SELECT 1 FROM json_each(json_extract(record,'$.manifest.categoryIds')) WHERE value=?)"); args.push(category) }
    for (const tag of query.tags) { clauses.push("EXISTS(SELECT 1 FROM json_each(json_extract(record,'$.manifest.tags')) WHERE value=?)"); args.push(tag) }
    if (query.source !== 'all') { clauses.push("json_extract(record,'$.distribution')=?"); args.push(query.source) }
    const rows = this.db.prepare(`SELECT record FROM releases WHERE ${clauses.join(' AND ')} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(...args, query.limit + 1, query.offset) as { record: string }[]
    const releases: MarketRelease[] = []; let size = 128
    for (const row of rows.slice(0, query.limit)) { size += Buffer.byteLength(row.record); if (size > marketLimits.responseBytes - 1024) break; releases.push(decodeMarketRelease(JSON.parse(row.record))) }
    return { releases, nextOffset: releases.length < rows.length ? query.offset + releases.length : null }
  }
}
