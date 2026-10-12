export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
export type ToolEffect = 'read' | 'derive' | 'candidate' | 'interaction'
export type SourceRef = { kind: string; id: string; revision: string }

type SchemaBase = { description?: string }
export type ToolSchema = SchemaBase & (
  | { type: 'object'; additionalProperties: false; properties: Record<string, ToolSchema>; required?: string[] }
  | { type: 'array'; items: ToolSchema; minItems?: number; maxItems: number }
  | { type: 'string'; enum?: string[]; minLength?: number; maxLength: number }
  | { type: 'number' | 'integer'; enum?: number[]; minimum?: number; maximum?: number }
  | { type: 'boolean' }
)

export type ToolDescriptor = {
  pluginId: string
  id: string
  version: string
  description: string
  effect: ToolEffect
  capabilities: string[]
  inputSchema: ToolSchema
  outputSchema: ToolSchema
}
