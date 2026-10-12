import type { AssistantConversationPorts } from '../../../assistant/application/assistant-conversation-service'
import type { AssistantConversationRequest } from '../../../../../contracts/assistant/assistant-conversation-contracts'
import { WritingPluginRegistry } from '../../application/registry'
import { fieldTools } from './fields'
import { bookContextTools } from './book-context'
import { planningTools } from './planning'
import { manuscriptTools, type ManuscriptReads } from './manuscript'
import { reviewTools } from './review'
import type { WritingDomainPorts } from './domain-ports'
import { authorInteractionTools } from './author-interaction'

export function createBuiltinRegistry(ports: AssistantConversationPorts, input: AssistantConversationRequest, domains?: WritingDomainPorts): WritingPluginRegistry {
  const registry = new WritingPluginRegistry()
  for (const tool of fieldTools(ports, input)) registry.register(tool, 'builtin')
  for (const tool of authorInteractionTools()) registry.register(tool, 'builtin')
  if (domains) {
    const reads: ManuscriptReads = new Map()
    for (const tool of [...bookContextTools(domains), ...planningTools(domains, input), ...manuscriptTools(domains, input, reads), ...reviewTools(domains, input, reads)]) registry.register(tool, 'builtin')
  }
  return registry
}
