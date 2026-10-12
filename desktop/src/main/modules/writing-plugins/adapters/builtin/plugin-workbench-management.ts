import { validateCompositionEntries } from '@lanjian/writing-plugin-contracts'
import { decodeDraftRef } from '../../../../../contracts/writing-plugins/authoring'
import { decodePluginEnableArgs, decodePluginVersionArgs, supportedPluginCapabilities } from '../../../../../contracts/writing-plugins/management-contracts'
import { objectSchema, textSchema } from '../../domain/schema'
import type { PluginEffectJournal } from '../../domain/plugin-run'
import { confirmedTool, conflict, digestSchema, idSchema, invalid, pretty, result, revisionSchema, type PluginWorkbenchServices } from './plugin-workbench-shared'

const labels = { enable: '启用插件并授权', disable: '停用插件', 'book-use': '为本书使用插件', 'book-remove': '取消本书使用', 'select-version': '切换插件版本与授权', uninstall: '卸载插件' }
export function pluginManagementTools(ports: PluginWorkbenchServices, journal: PluginEffectJournal) {
  return [
    confirmedTool('install_plugin', '预览并请求作者确认安装插件。source=bundled 使用本地库 pluginId/digest，无需市场服务器；market 使用 operationId/digest；draft 使用草稿 id/revision；file 打开原生 ZIP 选择器。确认后安装，默认关闭且无授权。不接受路径、planId 或批准参数。',
      objectSchema({ source: { type: 'string', enum: ['bundled', 'market', 'draft', 'file'], maxLength: 10 }, pluginId: idSchema, operationId: textSchema(36, 36), digest: digestSchema, id: textSchema(36, 36), revision: { ...revisionSchema, minimum: 1 } }, ['source']), journal,
      async args => {
        let preview
        if (args.source !== 'bundled' && args.pluginId !== undefined) return invalid()
        if (args.source === 'bundled') {
          if (typeof args.pluginId !== 'string' || typeof args.digest !== 'string' || args.id !== undefined || args.revision !== undefined || args.operationId !== undefined) return invalid()
          preview = await ports.bundled.preview({ pluginId: args.pluginId, digest: args.digest })
        } else if (args.source === 'market') {
          if (typeof args.operationId !== 'string' || typeof args.digest !== 'string' || args.id !== undefined || args.revision !== undefined) return invalid()
          const release = await ports.market.release(args.operationId)
          if (release.digest !== args.digest) return conflict()
          preview = await ports.market.previewDownload(release)
        } else if (args.source === 'draft') {
          if (args.operationId !== undefined || args.digest !== undefined) return invalid()
          preview = await ports.authoring.preview(decodeDraftRef({ id: args.id, revision: args.revision }))
        } else {
          if (Object.keys(args).length !== 1) return invalid()
          const token = await ports.choosePackage()
          if (!token) return result({ status: 'cancelled', notice: '未选择插件包。' })
          preview = await ports.manager.preview(token)
        }
        return { prepared: { planId: preview.planId, pluginId: preview.manifest.id, digest: preview.digest }, review: {
          title: `安装 ${preview.manifest.name} · ${preview.manifest.version}`,
          summary: `${preview.fileCount} 个文件，解包后 ${preview.unpackedBytes} 字节。安装不自动启用或授权；升级不自动切换旧版本。`,
          sections: [{ label: '插件清单与所需能力', content: pretty(preview.manifest) }, { label: '包摘要与版本变化', content: pretty({ digest: preview.digest, currentVersion: preview.existingVersion, newCapabilities: preview.addedCapabilities }) }]
        } }
      }, async (_args, prepared) => {
        await ports.market.beforeInstall(String(prepared.planId))
        await ports.manager.install(String(prepared.planId))
        return { status: 'installed', pluginId: prepared.pluginId!, digest: prepared.digest!, notice: '此版本已安装，未自动启用或授权；已有插件仍保留原来的当前版本。' }
      }),
    confirmedTool('manage_plugin', '请求作者确认启停、授权、版本切换、本书使用或卸载。先 list_plugins 读取 revision 与版本；enable/select-version 必须明确 grants，book-use/book-remove 只作用于原作品。停用/撤权/卸载会停止相关运行；新授权的工具在新任务中生效。',
      objectSchema({ action: { type: 'string', enum: Object.keys(labels), maxLength: 20 }, id: idSchema, revision: revisionSchema, digest: digestSchema, grants: { type: 'array', maxItems: 16, items: { type: 'string', enum: [...supportedPluginCapabilities], maxLength: 128 } } }, ['action', 'id', 'revision']), journal,
      async args => {
        const action = args.action as keyof typeof labels
        if (action === 'enable') decodePluginEnableArgs([{ id: args.id, revision: args.revision, enabled: true, grants: args.grants }])
        else if (action === 'select-version') decodePluginVersionArgs([{ id: args.id, revision: args.revision, digest: args.digest, grants: args.grants }])
        else if (args.grants !== undefined || args.digest !== undefined) return invalid()
        if (action === 'enable' && args.digest !== undefined) return invalid()
        const index = await ports.manager.list(), plugin = index.plugins.find(p => p.id === args.id)
        if (!plugin || index.revision !== args.revision) return conflict()
        const version = plugin.versions.find(v => v.digest === (action === 'select-version' ? args.digest : plugin.current))
        if (!version || Array.isArray(args.grants) && args.grants.some(cap => !version.manifest.capabilities.includes(String(cap)))) return conflict()
        return { prepared: { revision: index.revision, digest: version.digest }, review: {
          title: `${labels[action]}：${version.manifest.name}`,
          summary: action === 'uninstall' ? '移除本机所有已安装版本并停止相关任务；保留作品和已经采用的内容。' : ['disable', 'book-remove'].includes(action) ? '相关插件任务和待答问题将停止，已经保存的作品内容保留。' : '只按下列明确的版本、权限与作品范围执行。新增权限不会预先获准。',
          sections: [{ label: '版本、权限与作用范围', content: pretty({ action: labels[action], pluginId: plugin.id, version: version.manifest.version, digest: version.digest, currentVersionDigest: plugin.current, currentGrants: version.grants, requestedGrants: args.grants ?? [], declaredCapabilities: version.manifest.capabilities, scope: action.startsWith('book-') ? '本次对话所属作品' : '应用级插件管理', installedVersions: plugin.versions.map(v => ({ version: v.manifest.version, digest: v.digest })) }) }]
        } }
      }, async (args, prepared, host) => {
        const id = String(args.id), revision = Number(prepared.revision)
        switch (args.action) {
          case 'enable': await ports.manager.setEnabled(id, true, args.grants as string[], revision); break
          case 'disable': await ports.manager.setEnabled(id, false, [], revision); break
          case 'select-version': await ports.manager.selectVersion(id, String(prepared.digest), args.grants as string[], revision); break
          case 'book-use': case 'book-remove': await ports.manager.setBookEnabled(host.workItemId!, id, args.action === 'book-use', revision, async () => { host.signal.throwIfAborted(); await host.assertScope() }); break
          case 'uninstall': await ports.manager.uninstall(id, revision); break
          default: return invalid()
        }
        return { status: 'applied', pluginId: id, action: args.action!, notice: '插件设置已保存。新授权或版本供后续任务使用；停用或撤权会停止相关任务。' }
      }),
    confirmedTool('compose_plugins', '预览并请求作者确认本书插件贡献组合。revision 来自 list_plugins；entriesJson 是完整 CompositionEntry 数组（pluginId,digest,contributionId,params）。冲突返回原因且不应用。沿用原组合校验，不自动安装或授权。',
      objectSchema({ revision: revisionSchema, entriesJson: textSchema(24000, 2) }), journal,
      async (args, host) => {
        let entries
        try { entries = validateCompositionEntries(JSON.parse(String(args.entriesJson))) } catch { return invalid() }
        const preview = await ports.composition.preview(host.workItemId!, entries, Number(args.revision), async () => { host.signal.throwIfAborted(); await host.assertScope() })
        if (preview.conflicts.length) return result({ status: 'conflict', conflicts: preview.conflicts })
        return { prepared: { planId: preview.planId }, review: { title: '更新本书插件组合', summary: '核对完整贡献列表与参数；确认后仅影响这部作品后续的写作任务。', sections: [{ label: '完整组合与参数', content: pretty(preview.entries) }] } }
      }, async (_args, prepared) => { await ports.composition.apply(String(prepared.planId)); return { status: 'applied', notice: '本书插件组合已保存，后续任务使用新组合。' } })
  ]
}
