export type WorkspaceLocation = {
  active: string
  materialSection?: string
  timelineMode?: string
  outlineMode?: string
  preparationMode?: string
  settingsSection?: string
}

export type WorkspaceTarget = {
  active: string
  materialSection?: string
  timelineMode?: string
  outlineMode?: string
  preparationMode?: string
  settingsSection?: string
}

export type WorkspaceNavigationLeaf = {
  id: string
  label: string
  description: string
  icon: string
  target: WorkspaceTarget
  auxiliary?: boolean
}

export type WorkspaceNavigationGroup = {
  id: string
  sequence: string
  label: string
  description: string
  icon: string
  utility?: boolean
  children: readonly WorkspaceNavigationLeaf[]
}

export const workspaceNavigationTree: readonly WorkspaceNavigationGroup[] = [
  {
    id: 'definition', sequence: '01', label: '定义', icon: 'definition',
    description: '先定下作品方向、篇幅与写作约束',
    children: [
      { id: 'profile', label: '作品定义', icon: 'definition', description: '题材、篇幅与本书写作约束', target: { active: 'profile' } }
    ]
  },
  {
    id: 'materials', sequence: '02', label: '素材', icon: 'research',
    description: '收集灵感与资料，再提炼为候选事实',
    children: [
      { id: 'ideas', label: '灵感便签', icon: 'spark', description: '随手记录尚未确认的想法', target: { active: 'research', materialSection: 'notes' } },
      { id: 'manual-sources', label: '自备资料', icon: 'folder', description: '整理手工录入或导入的资料', target: { active: 'research', materialSection: 'manual' } },
      { id: 'web-research', label: '联网采风', icon: 'search', description: '保留来源的公开资料检索', target: { active: 'research', materialSection: 'research' } },
      { id: 'event-extraction', label: '事件提炼', icon: 'events', description: '把素材整理为四要素候选事件', target: { active: 'research', materialSection: 'events' } }
    ]
  },
  {
    id: 'foundation', sequence: '03', label: '设定', icon: 'world',
    description: '维护人物、世界与力量规则',
    children: [
      { id: 'characters', label: '人物与关系', icon: 'folder', description: '正式人物、地点、物品、组织与关系', target: { active: 'settings', settingsSection: 'story' } },
      { id: 'world', label: '世界观', icon: 'world', description: '时代、秩序、规则与核心矛盾', target: { active: 'world' } },
      { id: 'realms', label: '境界与力量', icon: 'events', description: '力量来源、等级与能力边界', target: { active: 'realms' } },
      { id: 'system-template', label: '金手指与系统模板', icon: 'panel', description: '特殊优势与固定呈现模板', target: { active: 'system' } }
    ]
  },
  {
    id: 'chronicle', sequence: '04', label: '纪事', icon: 'events',
    description: '记录故事发生的事，找到它们发生的地方',
    children: [
      { id: 'event-timeline', label: '事件', icon: 'events', description: '按顺序维护正式事件与直接纪事', target: { active: 'timeline', timelineMode: 'events' } },
      { id: 'world-map', label: '地图', icon: 'world', description: '按地点查看人物与事件', target: { active: 'timeline', timelineMode: 'map' } },
      { id: 'foreshadows', label: '伏笔备忘', icon: 'spark', auxiliary: true, description: '记住埋下的线索，核对何时回收', target: { active: 'timeline', timelineMode: 'foreshadows' } },
      { id: 'character-lines', label: '人物状态', icon: 'definition', auxiliary: true, description: '查看某章时人物已记录的位置、目标与知识', target: { active: 'timeline', timelineMode: 'characters' } }
    ]
  },
  {
    id: 'planning', sequence: '05', label: '谋篇', icon: 'outline',
    description: '整理总纲、卷纲和章纲，安排故事如何展开',
    children: [
      { id: 'total-outline', label: '全书总纲', icon: 'outline', description: '全书主线、关键转折与最终结局', target: { active: 'outline', outlineMode: 'total' } },
      { id: 'volume-outline', label: '卷纲', icon: 'outline', description: '维护当前篇卷的阶段目标和落点', target: { active: 'outline', outlineMode: 'volume' } },
      { id: 'volume-lines', label: '卷概览', icon: 'outline', description: '汇总篇卷章节与关键事件，回到卷纲编辑', target: { active: 'timeline', timelineMode: 'volumes' } },
      { id: 'chapter-skeleton', label: '章节安排', icon: 'events', description: '按卷安排每章发生什么、在哪里结束；生成结果为候选', target: { active: 'preparation', preparationMode: 'skeleton' } },
      { id: 'chapter-outline', label: '章纲', icon: 'manuscript', description: '维护阶段纲和每章详细大纲', target: { active: 'outline', outlineMode: 'chapter' } },
      { id: 'preparation', label: '创作筹备', icon: 'spark', auxiliary: true, description: '从素材整理可修改的创作候选，再由作者采用', target: { active: 'preparation', preparationMode: 'automatic' } }
    ]
  },
  {
    id: 'manuscript', sequence: '06', label: '书稿', icon: 'manuscript',
    description: '撰写章节正文并完成审校',
    children: [
      { id: 'chapters', label: '章节目录与正文', icon: 'manuscript', description: '管理章节并撰写正文', target: { active: 'desk' } },
      { id: 'review', label: '审校', icon: 'search', description: '核对连续性、事实与表达问题', target: { active: 'review' } }
    ]
  },
  {
    id: 'settings', sequence: 'SYS', label: '设置', icon: 'settings', utility: true,
    description: '模型、外观、存储、备份与应用选项',
    children: []
  }
] as const

export const workspaceCreationNavigation = workspaceNavigationTree.filter((group) => !group.utility)
export const workspaceUtilityNavigation = workspaceNavigationTree.filter((group) => group.utility)
export const workspaceNavigationLeaves = workspaceNavigationTree.flatMap((group) => group.children)

export function childrenForParent(parentId: string): readonly WorkspaceNavigationLeaf[] {
  return workspaceNavigationTree.find((group) => group.id === parentId)?.children || []
}

export function parentForLeaf(leafId: string): WorkspaceNavigationGroup | undefined {
  return workspaceNavigationTree.find((group) => group.children.some((leaf) => leaf.id === leafId))
}

export function targetForLeaf(leafId: string): WorkspaceTarget | undefined {
  return workspaceNavigationLeaves.find((leaf) => leaf.id === leafId)?.target
}

function targetMatchesLocation(target: WorkspaceTarget, location: WorkspaceLocation): boolean {
  return Object.entries(target).every(([key, value]) => location[key as keyof WorkspaceLocation] === value)
}

export function leafForLocation(location: WorkspaceLocation): WorkspaceNavigationLeaf | undefined {
  if (location.active === 'settings' && location.settingsSection !== 'story') return undefined
  const exact = workspaceNavigationLeaves.find((leaf) => targetMatchesLocation(leaf.target, location))
  if (exact) return exact

  if (location.active === 'outline' && ['stage', 'plannedChapter', 'recovery'].includes(location.outlineMode || '')) {
    return workspaceNavigationLeaves.find((leaf) => leaf.id === 'chapter-outline')
  }
  if (location.active === 'preparation' && location.preparationMode === 'continuation') {
    return workspaceNavigationLeaves.find((leaf) => leaf.id === 'preparation')
  }
  return workspaceNavigationLeaves.find((leaf) => leaf.target.active === location.active)
}

export function groupForLocation(location: WorkspaceLocation): WorkspaceNavigationGroup {
  if (location.active === 'settings' && location.settingsSection !== 'story') {
    return workspaceNavigationTree.find((group) => group.id === 'settings')!
  }
  return parentForLeaf(leafForLocation(location)?.id || '') || workspaceNavigationTree[0]
}
