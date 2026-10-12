import { fail } from '../http/errors.ts'

/** Bound DOCX inflation before handing a ZIP to the original document reader. */
export function assertDocumentUpload(name: string, bytes: Buffer) {
  if (!name.toLowerCase().endsWith('.docx')) return
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break }
  }
  if (end < 0) fail('invalid-request')
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16)
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || count > 1000 || start + size !== end) fail('invalid-request')
  let cursor = start, inflated = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail('invalid-request')
    inflated += bytes.readUInt32LE(cursor + 24)
    if (inflated > 16 * 1024 * 1024) fail('request-too-large')
    if (bytes.readUInt16LE(cursor + 8) & 1 || bytes.readUInt32LE(cursor + 42) >= start) fail('invalid-request')
    cursor += 46 + bytes.readUInt16LE(cursor + 28) + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32)
  }
  if (cursor !== end) fail('invalid-request')
}
