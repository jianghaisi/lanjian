import { createHash } from 'node:crypto'

export type WorkspaceTaskContractSnapshot = {
  templateId: string
  templateVersion: number
  templateHash: string
  inputSchemaJson: string
  outputSchemaJson: string
  allowedOperationsJson: string
  forbiddenOperationsJson: string
  contractHash: string
}

type TaskContractDefinition = {
  templateId: string
  templateVersion: number
  templateSource: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  allowedOperations: string[]
  forbiddenOperations: string[]
}

const neverFormalWrites = [
  'write:body-version',
  'write:approved-fact',
  'write:outline-node',
  'write:project-config'
] as const

/**
 * Built-in task contracts are deliberately small and stable. They describe the
 * model-facing run, not the later author Approval Gate that may adopt an
 * Artifact. A template variant (for example a writing skill) is part of the
 * immutable template identity.
 */
export function createTaskContractSnapshot(taskType: string, variant = 'default'): WorkspaceTaskContractSnapshot {
  const definition = definitionFor(taskType, variant)
  const snapshot = {
    templateId: definition.templateId,
    templateVersion: definition.templateVersion,
    templateHash: digest(definition.templateSource),
    inputSchemaJson: canonicalJson(definition.inputSchema),
    outputSchemaJson: canonicalJson(definition.outputSchema),
    allowedOperationsJson: canonicalJson([...new Set(definition.allowedOperations)].sort()),
    forbiddenOperationsJson: canonicalJson([...new Set(definition.forbiddenOperations)].sort())
  }
  return { ...snapshot, contractHash: taskContractHash(snapshot) }
}

export function taskContractHash(contract: Omit<WorkspaceTaskContractSnapshot, 'contractHash'>): string {
  return digest(canonicalJson({
    templateId: contract.templateId,
    templateVersion: contract.templateVersion,
    templateHash: contract.templateHash,
    inputSchemaJson: contract.inputSchemaJson,
    outputSchemaJson: contract.outputSchemaJson,
    allowedOperationsJson: contract.allowedOperationsJson,
    forbiddenOperationsJson: contract.forbiddenOperationsJson
  }))
}

export function isLegacyTaskContract(contract: WorkspaceTaskContractSnapshot): boolean {
  return contract.templateVersion === 0
}

function definitionFor(taskType: string, variant: string): TaskContractDefinition {
  const commonInput = {
    type: 'object', additionalProperties: true,
    required: ['operationId'], properties: { operationId: { type: 'string', minLength: 1 } }
  }
  const proposalEnvelope = {
    type: 'object', additionalProperties: true,
    description: 'A candidate Artifact only; it cannot directly mutate formal project data.'
  }
  if (taskType === 'writing_agent') return {
    templateId: `builtin:writing-agent:${variant}`,
    templateVersion: 1,
    templateSource: `writing-agent/${variant}/v1: frozen context -> text proposal and semantic diff`,
    inputSchema: {
      type: 'object', additionalProperties: true,
      required: ['chapterId', 'message', 'currentDraft'],
      properties: {
        chapterId: { type: 'integer', minimum: 1 }, message: { type: 'string' }, currentDraft: { type: 'string' },
        selection: { type: 'string' }, insertionAnchor: { type: 'string' }
      }
    },
    outputSchema: proposalEnvelope,
    allowedOperations: ['derive:diff', 'generate:artifact', 'read:chapter', 'read:context-package', 'read:project'],
    forbiddenOperations: [...neverFormalWrites]
  }
  if (taskType === 'idea_generation') return {
    templateId: 'builtin:idea-generation', templateVersion: 1,
    templateSource: 'idea-generation/v1: frozen idea and project context -> 1-3 candidate options',
    inputSchema: commonInput,
    outputSchema: {
      type: 'object', additionalProperties: false, required: ['options'],
      properties: { options: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object' } } }
    },
    allowedOperations: ['generate:artifact', 'read:context-package', 'read:project'],
    forbiddenOperations: [...neverFormalWrites]
  }
  if (taskType === 'outline_expansion') return {
    templateId: 'builtin:outline-expansion', templateVersion: 1,
    templateSource: 'outline-expansion/v1: frozen parent outline -> structured child-node candidates',
    inputSchema: commonInput,
    outputSchema: {
      type: 'object', additionalProperties: true, required: ['source', 'children'],
      properties: { source: { type: 'object' }, children: { type: 'array', minItems: 1 } }
    },
    allowedOperations: ['generate:artifact', 'read:context-package', 'read:project'],
    forbiddenOperations: [...neverFormalWrites]
  }
  if (taskType === 'annotation_revision') return {
    templateId: 'builtin:annotation-revision', templateVersion: 1,
    templateSource: 'annotation-revision/v1: frozen author annotations, selected document and formal constraints -> exact-quote changes or ask_author',
    inputSchema: commonInput, outputSchema: proposalEnvelope,
    allowedOperations: ['generate:artifact', 'derive:diff', 'read:context-package', 'read:project', 'ask:author'],
    forbiddenOperations: [...neverFormalWrites]
  }
  if (taskType === 'prose_event_extraction') return {
    templateId:'builtin:prose-event-extraction',templateVersion:1,
    templateSource:'prose-event-extraction/v1: saved chapter with exact UTF-16 quotes -> non-canon event candidates; explicit author settlement only',
    inputSchema:commonInput,
    outputSchema:{type:'array',maxItems:30,items:{type:'object',required:['fields','quotes','supplements'],additionalProperties:false,
      properties:{fields:{type:'object'},quotes:{type:'array',minItems:1,maxItems:5},supplements:{type:'array',maxItems:0}}}},
    allowedOperations:['generate:artifact','create:event-candidates','read:chapter'],
    forbiddenOperations:[...neverFormalWrites,'write:canonical-event','confirm:settlement']
  }
  if (taskType === 'fact_extraction') return {
    templateId: 'builtin:fact-extraction', templateVersion: 1,
    templateSource: 'fact-extraction/v1: frozen confirmed body -> structured fact-change candidates',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['workItemId', 'chapterId', 'bodyVersionId'],
      properties: {
        workItemId: { type: 'string', minLength: 1 }, chapterId: { type: 'integer', minimum: 1 },
        bodyVersionId: { type: 'string', minLength: 1 }
      }
    },
    outputSchema: {
      type: 'object', additionalProperties: true, required: ['changes'],
      properties: { changes: { type: 'array', items: { type: 'object' } } }
    },
    allowedOperations: ['create:fact-candidates', 'generate:artifact', 'read:chapter', 'read:context-package', 'read:project'],
    forbiddenOperations: [...neverFormalWrites]
  }
  return {
    templateId: `builtin:${taskType}:${variant}`, templateVersion: 1,
    templateSource: `${taskType}/${variant}/v1: generic candidate Artifact contract`,
    inputSchema: commonInput, outputSchema: proposalEnvelope,
    allowedOperations: ['generate:artifact'], forbiddenOperations: [...neverFormalWrites]
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
