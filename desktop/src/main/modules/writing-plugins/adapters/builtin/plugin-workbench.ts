import { objectSchema, textSchema } from '../../domain/schema'
import { pluginDraftTools, draftSummary } from './plugin-workbench-drafts'
import { pluginManagementTools } from './plugin-workbench-management'
import { pluginMarketTools } from './plugin-workbench-market'
import { idSchema, pluginTool, result, type PluginWorkbenchServices, type PluginToolFactory } from './plugin-workbench-shared'
export { pluginWorkbenchCapabilities, type PluginToolFactory } from './plugin-workbench-shared'

/** UI and model tools share application services; never dispatch arbitrary IPC,
 * renderer events, paths or plugin-supplied callbacks as application authority. */
export function createPluginWorkbenchTools(ports: PluginWorkbenchServices): PluginToolFactory {
  return journal => [
    pluginTool('list_plugins', '读取真实插件状态。area=bundled 浏览随软件提供的官方本地插件库，不需要市场服务器；installed 返回安装版本、权限、本书使用情况和 revision；drafts 返回个人草稿；market 返回市场可用性和本人发布记录。按 query/pluginId 筛选并分页；不读取其他书的记录。', 'read', 'plugins.read',
      objectSchema({ area: { type: 'string', enum: ['bundled', 'installed', 'drafts', 'market'], maxLength: 10 }, query: textSchema(200), pluginId: idSchema, offset: { type: 'integer', minimum: 0, maximum: 1000000 }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, ['area']), async (args, host) => {
        const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 10), query = String(args.query ?? '').toLocaleLowerCase()
        const page = <T>(entries: T[]) => ({ entries: entries.slice(offset, offset + limit), total: entries.length, nextOffset: offset + limit < entries.length ? offset + limit : -1 })
        if (args.area === 'bundled') return result(page((await host.hostCall(() => ports.bundled.list())).filter(p => (!args.pluginId || p.manifest.id === args.pluginId) && `${p.manifest.name} ${p.manifest.description} ${(p.manifest.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(query))))
        if (args.area === 'drafts') return result(page((await host.hostCall(() => ports.authoring.list())).map(draftSummary).filter(d => (!args.pluginId || d.pluginId === args.pluginId) && d.name.toLocaleLowerCase().includes(query))))
        if (args.area === 'market') {
          const status = await host.hostCall(() => ports.market.status())
          const records = status.publications.map(r => ({ operationId: r.operationId, pluginId: r.manifest.id, name: r.manifest.name, version: r.manifest.version, digest: r.digest, state: r.state }))
          return result({ available: status.available, loginState: status.auth.state, pending: status.pending, ...page(records.filter(r => (!args.pluginId || r.pluginId === args.pluginId) && r.name.toLocaleLowerCase().includes(query))) })
        }
        const index = await host.hostCall(() => ports.manager.list()), book = index.books.find(b => b.id === host.workItemId)
        const entries = index.plugins.filter(p => (!args.pluginId || p.id === args.pluginId) && p.versions.some(v => `${v.manifest.name} ${v.manifest.description}`.toLocaleLowerCase().includes(query))).map(p => ({
          pluginId: p.id, current: p.current, enabled: p.enabled, bookEnabled: Boolean(book?.plugins.includes(p.id)), versions: p.versions.map(v => ({ digest: v.digest, manifest: v.manifest, grants: v.grants, installedAt: v.installedAt }))
        }))
        return result({ revision: index.revision, composition: book?.composition ?? { revision: 0, entries: [] }, ...page(entries) })
      }),
    ...pluginDraftTools(ports, journal), ...pluginManagementTools(ports, journal), ...pluginMarketTools(ports, journal)
  ]
}
