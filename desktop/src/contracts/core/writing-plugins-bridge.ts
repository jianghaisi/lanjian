import type { WritingPluginsApi } from '../writing-plugins/management-contracts'

export function createWritingPluginsBridge(invokeValidated: <T>(channel: string, ...args: unknown[]) => Promise<T>): WritingPluginsApi {
  const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  return {
    bundledPlugins: () => invokeValidated('writing-plugins:bundled-list'),
    previewBundledPlugin: ref => invokeValidated('writing-plugins:bundled-preview', plain(ref)),
    deriveBundledPlugin: ref => invokeValidated('writing-plugins:bundled-derive', plain(ref)),
    marketStatus: () => invokeValidated('writing-plugins:market-status'),
    marketLogin: () => invokeValidated('writing-plugins:market-login'),
    marketLogout: () => invokeValidated('writing-plugins:market-logout'),
    marketCatalog: query => invokeValidated('writing-plugins:market-catalog', plain(query)),
    marketVersions: (id, query) => invokeValidated('writing-plugins:market-versions', id, plain(query)),
    previewPublish: ref => invokeValidated('writing-plugins:preview-publish', plain(ref)),
    publish: planId => invokeValidated('writing-plugins:publish', planId),
    refreshPublication: operation => invokeValidated('writing-plugins:refresh-publication', operation),
    retryPublication: operation => invokeValidated('writing-plugins:retry-publication', operation),
    withdrawPublication: operation => invokeValidated('writing-plugins:withdraw-publication', operation),
    previewDownload: release => invokeValidated('writing-plugins:preview-download', plain(release)),
    listDrafts: () => invokeValidated('writing-plugins:list-drafts'),
    createDraft: template => invokeValidated('writing-plugins:create-draft', template),
    saveDraft: input => invokeValidated('writing-plugins:save-draft', plain(input)),
    validateDraft: input => invokeValidated('writing-plugins:validate-draft', plain(input)),
    buildDraft: input => invokeValidated('writing-plugins:build-draft', plain(input)),
    exportDraft: input => invokeValidated('writing-plugins:export-draft', plain(input)),
    previewDraft: input => invokeValidated('writing-plugins:preview-draft', plain(input)),
    importDraftSource: input => invokeValidated('writing-plugins:import-draft-source', plain(input)),
    importDraftPackage: () => invokeValidated('writing-plugins:import-draft-package'),
    deriveDraft: input => invokeValidated('writing-plugins:derive-draft', plain(input)),
    list: withBook => invokeValidated('writing-plugins:list', withBook),
    choosePackage: () => invokeValidated('writing-plugins:choose-package'),
    previewInstall: token => invokeValidated('writing-plugins:preview-install', token),
    install: planId => invokeValidated('writing-plugins:install', planId),
    setEnabled: input => invokeValidated('writing-plugins:set-enabled', plain(input)),
    setBookEnabled: input => invokeValidated('writing-plugins:set-book-enabled', plain(input)),
    selectVersion: input => invokeValidated('writing-plugins:select-version', plain(input)),
    uninstall: input => invokeValidated('writing-plugins:uninstall', plain(input)),
    previewComposition: input => invokeValidated('writing-plugins:preview-composition', plain(input)),
    previewLibraryComposition: input => invokeValidated('writing-plugins:preview-library-composition', plain(input)),
    applyComposition: token => invokeValidated('writing-plugins:apply-composition', token)
  }
}
