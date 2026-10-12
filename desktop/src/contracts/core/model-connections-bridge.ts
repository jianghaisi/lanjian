import type { ModelConnectionsApi } from '../models/model-connections-contracts'

export function createModelConnectionsBridge(invokeValidated: <T>(channel: string, ...args: unknown[]) => Promise<T>): ModelConnectionsApi {
  const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  return {
    list: () => invokeValidated('model-connections:list'), create: input => invokeValidated('model-connections:create', plain(input)), update: input => invokeValidated('model-connections:update', plain(input)),
    remove: input => invokeValidated('model-connections:remove', plain(input)),
    defaults: () => invokeValidated('model-connections:defaults'), saveDefaults: input => invokeValidated('model-connections:saveDefaults', plain(input)),
    book: () => invokeValidated('model-connections:book'), saveBook: input => invokeValidated('model-connections:saveBook', plain(input)),
    renamePrivate: input => invokeValidated('model-connections:renamePrivate', plain(input)), savePrivateKey: input => invokeValidated('model-connections:savePrivateKey', plain(input)),
    previewApply: input => invokeValidated('model-connections:previewApply', plain(input)), confirmApply: token => invokeValidated('model-connections:confirmApply', token),
    previewReuse: input => invokeValidated('model-connections:previewReuse', plain(input)), confirmReuse: token => invokeValidated('model-connections:confirmReuse', token), reuseReceipt: token => invokeValidated('model-connections:reuseReceipt', token),
    cancelPreviews: () => invokeValidated('model-connections:cancelPreviews'), leaveBook: () => invokeValidated('model-connections:leaveBook'), test: input => invokeValidated('model-connections:test', plain(input)), catalog: input => invokeValidated('model-connections:catalog', plain(input)), cancelTest: () => invokeValidated('model-connections:cancelTest'),
    previewCreation: withoutDefaults => invokeValidated('model-connections:previewCreation', withoutDefaults), createProject: input => invokeValidated('model-connections:createProject', plain(input)), retryCreation: input => invokeValidated('model-connections:retryCreation', plain(input))
  }
}
