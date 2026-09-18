export type ManuscriptSaveTarget = {
  workItemId?: string | number | null
  workItemPath?: string | null
  chapterId?: number | null
}

export type ManuscriptDraftSnapshot = {
  title: string
  content: string
}

export function isSameManuscriptSaveTarget(attempt: ManuscriptSaveTarget, current: ManuscriptSaveTarget): boolean {
  return Boolean(
    attempt.workItemId != null
    && attempt.chapterId != null
    && attempt.workItemId === current.workItemId
    && attempt.workItemPath === current.workItemPath
    && attempt.chapterId === current.chapterId
  )
}

export function isSameManuscriptDraft(attempt: ManuscriptDraftSnapshot, current: ManuscriptDraftSnapshot): boolean {
  return attempt.title === current.title && attempt.content === current.content
}
