import type { DocumentImportManifestRequest, TxtImportRequest } from '../index'
import type { ArgsDecoder } from '../core/validation'
import { boundedInteger, exactArgs, exactRecord, invalid, record, requiredString } from '../core/validation'

export const decodeImportCommitArgs: ArgsDecoder<[TxtImportRequest]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'import')
  const allowed = new Set(['token', 'ownership', 'creationMethod', 'title', 'selectedChapterIndexes'])
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid('import', '包含未允许的字段')
  const token = requiredString(value.token, 'token', 64)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))
    invalid('token', '格式无效')
  if (value.ownership !== 'owned' && value.ownership !== 'material' && value.ownership !== 'external')
    invalid('ownership', '不是受支持的书籍归属')
  const creationMethod = value.creationMethod
  if (creationMethod !== undefined && !['human', 'ai', 'mixed'].includes(String(creationMethod)))
    invalid('creationMethod', '不是受支持的创作来源')
  if (value.ownership === 'owned' && creationMethod === undefined) invalid('creationMethod', '不能为空')
  if (value.ownership !== 'owned' && creationMethod !== undefined)
    invalid('creationMethod', '资料文件不应标记为正文创作来源')
  const title = requiredString(value.title, 'title', 80)
  let selectedChapterIndexes: number[] | undefined
  if (value.selectedChapterIndexes !== undefined) {
    if (
      value.ownership !== 'owned' ||
      !Array.isArray(value.selectedChapterIndexes) ||
      value.selectedChapterIndexes.length > 5_000
    ) {
      invalid('selectedChapterIndexes', '只允许为本书正文选择不超过 5000 个章节')
    }
    selectedChapterIndexes = value.selectedChapterIndexes.map((item, index) =>
      boundedInteger(item, `selectedChapterIndexes[${index}]`, 0, 4_999)
    )
    if (!selectedChapterIndexes.length || new Set(selectedChapterIndexes).size !== selectedChapterIndexes.length)
      invalid('selectedChapterIndexes', '不能为空或包含重复章节')
  }
  return [
    {
      token,
      ownership: value.ownership,
      ...(creationMethod === undefined ? {} : { creationMethod: creationMethod as TxtImportRequest['creationMethod'] }),
      title,
      ...(selectedChapterIndexes === undefined ? {} : { selectedChapterIndexes })
    }
  ]
}

export const decodeImportManifestCommitArgs: ArgsDecoder<[DocumentImportManifestRequest]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'manifest', ['id', 'files'])
  const id = requiredString(value.id, 'id', 64)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) invalid('id', '格式无效')
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 20)
    invalid('files', '必须包含 1 到 20 个文件')
  const files = value.files.map((file, index) => {
    const item = record(file, `files[${index}]`)
    if (item.ownership === 'skip') {
      const allowed = new Set(['token', 'ownership', 'title'])
      if (Object.keys(item).some((key) => !allowed.has(key))) invalid(`files[${index}]`, '暂不采用的文件包含多余字段')
      const token = requiredString(item.token, `files[${index}].token`, 64)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))
        invalid(`files[${index}].token`, '格式无效')
      return { token, ownership: 'skip' as const, title: requiredString(item.title, `files[${index}].title`, 80) }
    }
    return decodeImportCommitArgs([item])[0]
  })
  if (new Set(files.map((file) => file.token)).size !== files.length) invalid('files', '包含重复文件令牌')
  return [{ id, files }]
}

export const decodeImportManifestIdArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  const id = requiredString(args[0], 'id', 64)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) invalid('id', '格式无效')
  return [id]
}
