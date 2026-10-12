import { groupId, groupRecord, groupText, groupRevision, decodeGroupView, type GroupCommand, type GroupSessionView } from './group-chat'
import { decodeModelCreationResult, type ModelCreationResult } from '../models/model-connections-contracts'
import { projectSummary } from '../app/ipc-project-result-contracts'
export type GroupBookCreation = GroupCommand & { creationId: string; token: string; project: { name: string; parentPath: string } }
export type GroupBookCreated = { session: GroupSessionView; result: ModelCreationResult }
export function decodeGroupBookCreation(value: unknown): GroupBookCreation {
  const r = groupRecord(value, ['sessionId', 'expectedRevision', 'creationId', 'token', 'project']), p = groupRecord(r.project, ['name', 'parentPath'])
  return { sessionId: groupId(r.sessionId), expectedRevision: groupRevision(r.expectedRevision), creationId: groupId(r.creationId), token: groupId(r.token), project: { name: groupText(p.name, 200), parentPath: groupText(p.parentPath, 32767) } }
}
export function decodeGroupBookCreated(value: unknown): GroupBookCreated { const r = groupRecord(value, ['session', 'result']); return { session: decodeGroupView(r.session), result: decodeModelCreationResult(r.result, v => projectSummary(v, 'project')) } }
