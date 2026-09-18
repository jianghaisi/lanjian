import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { evaluateFixedConsistencySamples, type SemanticPredictions } from '../src/main/modules/review/domain/consistency-evaluation'

const outputPath = argument('--output')
const predictionPath = argument('--semantic-predictions')
const semanticModelVersion = argument('--semantic-version')
const semanticPredictions = predictionPath ? await readPredictions(predictionPath) : undefined
const report = evaluateFixedConsistencySamples({ semanticPredictions, semanticModelVersion })
const serialized = `${JSON.stringify(report, null, 2)}\n`

if (outputPath) {
  const absoluteOutput = resolve(outputPath)
  await mkdir(dirname(absoluteOutput), { recursive: true })
  await writeFile(absoluteOutput, serialized, 'utf8')
  process.stdout.write(`固定一致性评测已写入 ${absoluteOutput}\n`)
}
process.stdout.write(serialized)

function argument(name: string): string | undefined {
  const prefix = `${name}=`
  const inline = process.argv.find((value) => value.startsWith(prefix))
  if (inline) return inline.slice(prefix.length).trim() || undefined
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1]?.trim() || undefined : undefined
}

async function readPredictions(path: string): Promise<SemanticPredictions> {
  const parsed: unknown = JSON.parse(await readFile(resolve(path), 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('语义预测必须是“样本 ID → Finding code 数组”的 JSON 对象。')
  const output: Record<string, string[]> = {}
  for (const [id, codes] of Object.entries(parsed)) {
    if (!id.trim() || !Array.isArray(codes) || codes.some((code) => typeof code !== 'string' || !code.trim())) {
      throw new Error(`语义预测 ${id || '(空 ID)'} 的格式无效。`)
    }
    output[id] = [...new Set(codes.map((code) => code.trim()))]
  }
  return output
}
