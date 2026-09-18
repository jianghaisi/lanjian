/** Book workspaces the assistant may reveal; this grants no save or approval action. */
export const assistantWorkspaces = [
  { id: 'profile', label: '作品定义' }, { id: 'ideas', label: '灵感便签' },
  { id: 'manual-sources', label: '自备资料' }, { id: 'web-research', label: '联网采风' },
  { id: 'event-extraction', label: '事件提炼' }, { id: 'characters', label: '人物与关系' },
  { id: 'world', label: '世界观' }, { id: 'realms', label: '境界与力量' },
  { id: 'system-template', label: '金手指与系统模板' }, { id: 'preparation', label: '创作筹备' },
  { id: 'total-outline', label: '全局总纲' }, { id: 'event-timeline', label: '事件' },
  { id: 'world-map', label: '地图' }, { id: 'foreshadows', label: '伏笔备忘' },
  { id: 'character-lines', label: '人物状态' }, { id: 'volume-outline', label: '卷纲' },
  { id: 'volume-lines', label: '卷概览' }, { id: 'chapter-skeleton', label: '全书章节骨架' },
  { id: 'chapter-outline', label: '章纲' }, { id: 'chapters', label: '章节目录与正文' },
  { id: 'review', label: '审校' }
] as const
export type AssistantWorkspaceId = typeof assistantWorkspaces[number]['id']
export function isAssistantWorkspaceId(value: unknown): value is AssistantWorkspaceId {
  return typeof value === 'string' && assistantWorkspaces.some(item => item.id === value)
}
/** Static destinations are discoverable before their draft adapters mount. */
export function assistantFieldWorkspace(fieldId:string):AssistantWorkspaceId|undefined {
  if(fieldId.startsWith('definition.bookProfile.'))return 'profile'
  if(fieldId==='AppShell.foundation.worldView')return 'world'
  if(fieldId.startsWith('Realm.'))return 'realms'
}
