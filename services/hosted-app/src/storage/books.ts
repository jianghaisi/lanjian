import { readSite } from '../admin/site-store.ts'
import { randomUUID } from 'node:crypto'
import { decodeBook, decodeBookCreate, uuid, type BookView } from '@lanjian/hosted-contracts'
import { HostedDatabase, dbNumber } from './database.ts'
import { fail } from '../http/errors.ts'

export class BookRegistry {
  constructor(readonly db: HostedDatabase) {}
  private view(row: Record<string, unknown>): BookView {
    return decodeBook({ id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at })
  }
  list(owner: string): BookView[] {
    return this.db.all("SELECT * FROM books WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM settings WHERE key='reference-pending:' || books.id) ORDER BY updated_at DESC", owner).map(row => this.view(row))
  }
  get(owner: string, id: string): BookView {
    const row = this.db.get('SELECT * FROM books WHERE owner_id=? AND id=?', owner, uuid(id))
    if (!row) fail('not-found')
    return this.view(row)
  }
  create(owner: string, input: unknown): BookView {
    const { title, operation } = decodeBookCreate(input)
    return this.db.operation(`book:${owner}`, operation, { title }, () => {
      if (dbNumber(this.db.get('SELECT COUNT(*) AS count FROM books WHERE owner_id=?', owner)?.count) >= readSite(this.db).limits.booksPerUser) fail('quota-exceeded')
      const id = randomUUID(), now = this.db.now()
      this.db.run('INSERT INTO books VALUES(?,?,?,?,?)', id, owner, title, now, now)
      return this.get(owner, id)
    })
  }
}
