import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import { decodeGroupProfile, type MemberAssignment } from '../../../../contracts/group-chat/group-chat'
import type { CreativeMember, CreativeTeam } from '@lanjian/writing-plugin-contracts'
import type { ModelProfile } from '../../../../contracts/models/types'
import type { ModelCatalogEntry } from '../../../../contracts/models/model-catalog-metadata'
import type { ModelSettingsResolver, LocalTextProvider } from '../domain/model-provider'
import type { ModelConnectionsService } from './model-connections-service'
import type { NewBookModelDefaults } from './new-book-model-defaults'
import { AiClient } from './ai-client'
import { withModelExecution } from './model-execution-context'
import { isLocalConnection } from '../../../../contracts/models/local-model-contracts'
import { compileRemoteConfig } from '../domain/generation-config'
import type { GroupModelCapability } from '../../group-chat/application/group-chat-service'
/** Uses the same global credential capability and provider adapters as model management. */
export function groupModelPorts(globals: ModelConnectionsService, defaults: NewBookModelDefaults, local: LocalTextProvider, catalog?: (id: string, revision: number) => ModelCatalogEntry[] | undefined) {
  return {
    async modelCatalog() {
      const connections = await globals.list()
      const { template } = await defaults.get()
      const configured = template ? template.routingMode === 'shared' ? [template.shared] : Object.values(template.tasks) : []
      return { connections, models: Object.fromEntries(connections.connections.map(connection => [connection.id, [...new Set([
        ...(catalog?.(connection.id, connection.revision) ?? []).map(entry => entry.id),
        ...configured.filter(profile => template?.references.find(ref => ref.id === profile.connectionId)?.globalConnectionId === connection.id).map(profile => profile.model)
      ])]])) }
    },
    async defaults(team: CreativeTeam): Promise<MemberAssignment[]> {
      const { template } = await defaults.get()
      return team.members.map(member => {
        if (!template) return { memberId: member.id, profile: null }
        const profile = template.routingMode === 'shared' ? template.shared : template.tasks[member.task]
        const ref = template.references.find(r => r.id === profile.connectionId)
        return { memberId: member.id, profile: decodeGroupProfile({ ...profile, connectionId: isLocalConnection(profile.connectionId) ? profile.connectionId : ref?.globalConnectionId }) }
      })
    },
    async capture(profile: ModelProfile, task: CreativeMember['task'] = 'outline'): Promise<GroupModelCapability> {
      profile = decodeGroupProfile(profile)
      let resolved: Awaited<ReturnType<ModelSettingsResolver['resolve']>>
      let revision = 0
      if (isLocalConnection(profile.connectionId)) {
        if (!await local.ready(profile.model)) throw new AppError('FEATURE_UNAVAILABLE', '所选本地模型尚未就绪。', { recoverable: true })
        resolved = { kind: 'local', connectionId: profile.connectionId, connectionName: '本地推理', profile: structuredClone(profile) }
      } else {
        const view = await globals.list(), connection = view.connections.find(c => c.id === profile.connectionId)
        if (!connection || !connection.enabled) throw new AppError('FEATURE_UNAVAILABLE', '成员选择的接口不可用，请重新选择。', { recoverable: true })
        revision = connection.revision
        const credential = await globals.prepareCredential(connection.id, revision)
        resolved = await credential.use(async apiKey => ({ kind: credential.protocol, connectionId: connection.id, connectionName: connection.name, baseUrl: credential.baseUrl, apiKey, profile: structuredClone(profile), catalogEntries: catalog?.(connection.id, revision), requestGuard: { assertActive: () => {}, recheck: () => credential.assertCurrent() } }))
        compileRemoteConfig(resolved, task)
      }
      const ai = new AiClient({ resolve: async () => resolved, resolveConnection: async () => resolved }, local)
      const identity = createHash('sha256').update(JSON.stringify({ profile, revision, kind: resolved.kind, task })).digest('hex')
      const frozen = await ai.captureRun(['outline', 'chapterOutline', 'prose', 'review'])
      return { identity, model: await frozen.prepareToolConversation(task), completion: () => frozen.prepareCompletion(task), run: operation => Promise.resolve(withModelExecution(resolved, operation)) }
    }
  }
}
