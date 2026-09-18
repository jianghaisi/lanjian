import type { BookModelsService } from '../../models/application/book-models-service'
import { createHash } from 'node:crypto'
import { AiClient } from '../../models/application/ai-client'
import { ProjectService } from '../../library/application/project-service'
import { registerModelConnections } from '../../models/runtime/model-connections-runtime'
import { resolveWritingAgentSkill, WritingAgentService } from '../application/writing-agent-service'
import { WritingAgentTaskService } from '../application/writing-agent-task-service'
import { SqliteManuscriptService } from '../../manuscript/application/sqlite-manuscript-service'
import { SqliteWorkspaceDatabaseFactory } from '../../../platform/storage/workspace-database'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { bookModelConfigInputs } from '../../models/adapters/book-model-configs'
import type { AiTask } from '../../../../contracts/index'

interface Dependencies {
  writingAgent: WritingAgentService
  projects: ProjectService
  databases: SqliteWorkspaceDatabaseFactory
  sqliteManuscripts: SqliteManuscriptService
  projectAi: BookModelsService
  modelConnectionsRuntime: ReturnType<typeof registerModelConnections> | undefined
  ai: AiClient
  workspaceWrites: WorkspaceWriteCoordinator
}

export function createWritingTaskRuntime(dependencies: Dependencies) {
  const {
    writingAgent,
    projects,
    databases,
    sqliteManuscripts,
    projectAi,
    modelConnectionsRuntime,
    ai,
    workspaceWrites
  } = dependencies
  const writingAgentTasks = new WritingAgentTaskService(
    writingAgent,
    projects,
    databases,
    undefined,
    undefined,
    async ({ workItemPath, request }) => {
      if (!(await sqliteManuscripts.active(workItemPath))) return request.model?.trim() || undefined
      const { settings, document, guard } = await projectAi.captureView(workItemPath)
      const skill = resolveWritingAgentSkill(request.message, request.preferredSkill)
      const task: AiTask =
        skill === 'plan' ? 'chapterOutline' : skill === 'review' || skill === 'query' ? 'review' : 'prose'
      const scope = settings.routingMode === 'shared' ? 'shared' : task
      const profile = settings.routingMode === 'shared' ? settings.shared : settings.tasks[task]
      const connectionId = request.modelConnectionId?.trim() || profile.connectionId
      const globalOverride = connectionId.startsWith('global:')
        ? (await modelConnectionsRuntime!.globals.list()).connections.find((c) => c.id === connectionId.slice(7))
        : undefined
      const connection = globalOverride
        ? {
            id: connectionId,
            name: globalOverride.name,
            baseUrl: globalOverride.baseUrl,
            scope: 'global' as const,
            globalConnectionId: globalOverride.id,
            kind: globalOverride.protocol
          }
        : settings.connections.find((item) => item.id === connectionId)
      if (!connection) return undefined
      const modelName = request.model?.trim() || profile.model
      const localLimits =
        connection.kind === 'local'
          ? await ai.contextLimits(task, modelName, connection.id, request.maxTokensOverride)
          : undefined
      const outputTokens = localLimits?.outputTokens ?? profile.maxTokens
      return workspaceWrites.run(workItemPath, async () => {
        await guard.recheck()
        const database = await databases.openExisting(workItemPath)
        if (!database) return undefined
        try {
          await guard.recheck()
          const source =
            connection.kind === 'local'
              ? connection.id
              : connection.scope === 'global'
                ? `global:${connection.globalConnectionId}`
                : document.version === 4
                  ? `legacy:${document.references.flatMap((r) => (r.kind === 'legacy-private' && r.id === connection.id ? [r.originalConnectionId] : []))[0]}`
                  : `${connection.id}:${connection.baseUrl}`
          const provider =
            request.modelConnectionId || request.model || request.maxTokensOverride !== undefined
              ? `${source}#writing-agent-${createHash('sha256')
                  .update(
                    JSON.stringify({ modelName, outputTokens, temperature: profile.temperature, topP: profile.topP })
                  )
                  .digest('hex')
                  .slice(0, 12)}`
              : bookModelConfigInputs(document).find((c) => JSON.parse(c.settingsJson).scope === scope)!.provider
          const configured = database
            .listModelConfigs()
            .find((item) => item.provider === provider && item.modelName === modelName)
          if (configured) return configured.id
          guard.assertActive()
          return database.upsertModelConfig({
            provider,
            modelName,
            displayName: `${modelName} · ${scope}`,
            settingsJson: JSON.stringify({
              routingMode: settings.routingMode,
              scope,
              connectionId: connection.id,
              connectionName: connection.name,
              temperature: profile.temperature,
              topP: profile.topP,
              maxTokens: outputTokens,
              source: 'writing-agent-override'
            }),
            inputTokenBudget: localLimits
              ? localLimits.contextTokens - outputTokens - localLimits.systemReserveTokens
              : profile.maxTokens,
            enabled: true,
            isDefault: false
          }).id
        } finally {
          database.close()
        }
      })
    },
    workspaceWrites
  )
  return { writingAgentTasks }
}
