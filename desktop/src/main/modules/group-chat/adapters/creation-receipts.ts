import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { writeJson } from '../../../platform/storage/json-store'
import { groupId, groupRecord, groupText } from '../../../../contracts/group-chat/group-chat'
import { decodeModelCreationResult } from '../../../../contracts/models/model-connections-contracts'
import { projectSummary } from '../../../../contracts/app/ipc-project-result-contracts'
import type { GroupCreationReceipt } from '../application/group-creation-service'
export class GroupCreationReceipts {
  private readonly root: string
  constructor(appRoot: string, owner: string) { this.root = join(appRoot, 'group-chat', createHash('sha256').update(owner).digest('hex'), 'creation-receipts') }
  async read(id: string): Promise<GroupCreationReceipt | null> {
    let bytes: Buffer
    try { bytes = await readFile(join(this.root, `${groupId(id)}.json`)) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
    try {
      if (bytes.length > 100000) throw new Error()
      const r = groupRecord(JSON.parse(bytes.toString('utf8')), ['creationId', 'inputDigest', 'state', 'result'])
      if (!['creating', 'result', 'rejected'].includes(String(r.state))) throw new Error()
      return { creationId: groupId(r.creationId), inputDigest: groupText(r.inputDigest, 64), state: r.state as GroupCreationReceipt['state'], result: r.result === null ? null : decodeModelCreationResult(r.result, v => projectSummary(v, 'project')) }
    }
    catch (e) { throw new AppError('STORAGE_ERROR', '建书回执无法读取，原文件保留；不会重复建书。', { recoverable: true, cause: e }) }
  }
  write(id: string, receipt: GroupCreationReceipt): Promise<void> { return writeJson(join(this.root, `${groupId(id)}.json`), receipt) }
}
