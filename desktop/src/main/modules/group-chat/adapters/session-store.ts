import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { writeJson } from '../../../platform/storage/json-store'
import { groupId } from '../../../../contracts/group-chat/group-chat'
import { decodeGroupSession, type GroupSession, type GroupSessionStore } from '../domain/session'

/** Operational history, separate from canon. Corrupt/future files are never replaced on read. */
export class FileGroupSessionStore implements GroupSessionStore {
  private readonly root: string
  constructor(appRoot: string, private readonly owner: string) { this.root = join(appRoot, 'group-chat', createHash('sha256').update(owner).digest('hex')) }
  async list(): Promise<GroupSession[]> {
    let files: string[]
    try { files = await readdir(this.root) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
    return Promise.all(files.filter(n => /^[a-f\d-]{36}\.json$/i.test(n)).map(n => this.read(n.slice(0, -5))))
  }
  async read(id: string): Promise<GroupSession> {
    try {
      const bytes = await readFile(join(this.root, `${groupId(id)}.json`))
      if (bytes.length > 8 * 1024 * 1024) throw new Error('size')
      const session = decodeGroupSession(JSON.parse(bytes.toString('utf8')))
      if (session.view.id !== id || session.owner !== this.owner) throw new Error('identity')
      return session
    } catch (e) { throw new AppError('STORAGE_ERROR', '群聊记录无法读取，原记录保留，请修复后重试。', { recoverable: true, cause: e }) }
  }
  async write(session: GroupSession, beforeCommit?: () => Promise<void>): Promise<void> {
    const decoded = decodeGroupSession(session)
    if (decoded.owner !== this.owner) throw new AppError('CONFLICT', '会话归属不匹配。', { recoverable: true })
    await writeJson(join(this.root, `${decoded.view.id}.json`), decoded, beforeCommit)
  }
}
