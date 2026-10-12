import { createHash } from 'node:crypto'
import type { SourceCard } from '../../../../contracts/worldbuilding/types'
/** Bind excerpt, title, notes and links as well as the legacy URL/content identity. */
export const referenceRevision = (source: SourceCard) => createHash('sha256').update(JSON.stringify(source)).digest('hex')
