/** Host-supported dispatch slots; methods and team definitions live in packages. */
export const creativeSlots = {
  foundation: 'worldbuilding', characters: 'worldbuilding', events: 'planning', 'field-edit': 'assistant',
  'world-map-style': 'worldbuilding',
  blueprint: 'planning', 'genre-guidance': 'planning', 'total-outline': 'planning', 'volume-outline': 'planning',
  'stage-outline': 'planning', 'chapter-skeleton': 'planning', 'chapter-outline': 'planning',
  'outline-review': 'review', prose: 'writing', revision: 'review', review: 'review',
  'selection-revision': 'writing', 'chapter-discussion': 'planning', 'work-query': 'review', 'annotation-revision': 'review',
  'assistant-conversation': 'assistant', 'assistant-sample': 'writing',
  'idea-divergence': 'planning', 'idea-synopsis': 'planning', 'timeline-events': 'planning',
  'continuation-analysis': 'planning',
  'fact-extraction': 'review',
  'prose-event-extraction': 'review',
  'inspiration-extract': 'assistant', 'inspiration-summary': 'assistant',
  'group-orchestration': 'assistant'
} as const
