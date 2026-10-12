/** Stable source-organizing metadata; independent of original text and card tags. */
export const NOVEL_GENRES = [
  { id: 'urban', label: '都市' }, { id: 'xianxia', label: '仙侠' },
  { id: 'xuanhuan', label: '玄幻' }, { id: 'fantasy', label: '奇幻' },
  { id: 'scifi', label: '科幻' }, { id: 'mystery', label: '悬疑' },
  { id: 'history', label: '历史' }, { id: 'romance', label: '言情' },
  { id: 'game', label: '游戏' }, { id: 'wuxia', label: '武侠' },
  { id: 'other', label: '其他' }, { id: 'unclassified', label: '未分类' }
] as const
export type NovelGenreId = typeof NOVEL_GENRES[number]['id']
export const NOVEL_GENRE_IDS = NOVEL_GENRES.map(genre => genre.id)
export const novelGenreLabel = (id: NovelGenreId) => NOVEL_GENRES.find(genre => genre.id === id)!.label
