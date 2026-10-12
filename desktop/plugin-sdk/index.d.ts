/**岚笺 code-plugin API v1. Types only; this file provides no host runtime. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
export type AuthorQuestion = {
  id: string
  prompt: string
  detail?: string
  mode: 'single' | 'multiple' | 'text'
  required: boolean
  options: { id: string; label: string; description?: string; recommended?: boolean }[]
}
export type AuthorAnswers = { answers: { id: string; chosenOptionIds: string[]; customText: string; skipped: boolean }[] }
export type TaskReceipt = { taskId: string; status: string; notice: string; workspaceId: string }
export type CandidateRequest = { key: string } & (
  | { kind: 'planning'; input: Record<string, never> }
  | { kind: 'expand'; input: { parentKey: string; expectedRevision: string; count: number; instruction: string } }
  | { kind: 'manuscript'; input: { chapterId: number; expectedRevision: string; instruction: string } }
)
export interface WritingContext {
  readonly book: {
    /** book.read: saved definition, world, dynamic realms and fixed system template. */
    read(input: { kind: 'context' }): Promise<{ context: string }>
    /** book.read: eight source excerpts/notes per page; nextOffset=-1 ends pagination. */
    read(input: { kind: 'materials'; offset?: number }): Promise<{ sources: { id: string; title: string; excerpt: string; notes: string }[]; total: number; nextOffset: number }>
    /** planning.read: key is total, volume-N or stage-N. */
    read(input: { kind: 'outline'; key: string }): Promise<{ key: string; kind: string; content: string; revision: string }>
    /** manuscript.read: saved manuscript only, including its revision. */
    read(input: { kind: 'manuscript'; chapterId: number }): Promise<{ chapterId: number; title: string; content: string; revision: string }>
  }
  readonly model: {
    /** model.generate: original book's frozen model route. Suggestion only. */
    generate(input: { instruction: string; draft?: string }): Promise<{ text: string; notice: string }>
  }
  readonly candidate: {
    /** Candidate-effect tools only. A stable key reuses the saved task receipt. */
    prepare(input: CandidateRequest): Promise<TaskReceipt>
  }
  readonly interaction: {
    /** author.ask: await this, then return. resume runs in a new VM after the author answers. */
    request(input: { question: { questions: AuthorQuestion[] }; checkpoint: JsonObject }): Promise<{ waiting: true }>
  }
  readonly assets: {
    /** assets.read: an exact path listed in this immutable package's manifest.assets. */
    readText(input: { path: string }): Promise<{ text: string }>
  }
}
export type Execute = (toolId: string, input: JsonObject, ctx: WritingContext) => JsonObject | Promise<JsonObject>
export type Resume = (toolId: string, checkpoint: JsonObject, answer: AuthorAnswers, ctx: WritingContext) => JsonObject | Promise<JsonObject>
