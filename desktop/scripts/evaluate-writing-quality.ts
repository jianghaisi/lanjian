import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { WritingQualityRunStore } from '../src/main/modules/review/adapters/writing-quality-run-store'
import { WritingQualityExperimentService } from '../src/main/modules/review/application/writing-quality-experiment-service'
import { createOfflineManifest, DeterministicOfflineWritingAdapter } from '../src/main/modules/review/domain/writing-quality-fixtures'

export type OfflineCliOptions = { outputRoot: string; runId: string; seed: number }

export function parseOfflineWritingQualityArgs(args: string[]): OfflineCliOptions {
  const values = new Map<string, string>()
  let offline = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--offline') { offline = true; continue }
    if (!['--output-root', '--run-id', '--seed'].includes(argument)) throw new Error(`Unsupported argument: ${argument}`)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
    if (values.has(argument)) throw new Error(`Duplicate argument: ${argument}`)
    values.set(argument, value); index += 1
  }
  if (!offline) throw new Error('The offline harness requires --offline')
  const outputRoot = values.get('--output-root')
  if (!outputRoot) throw new Error('Missing required --output-root')
  const seedText = values.get('--seed') ?? '20260920'
  if (!/^[0-9]+$/.test(seedText)) throw new Error('--seed must be a non-negative safe integer')
  const seed = Number(seedText)
  if (!Number.isSafeInteger(seed)) throw new Error('--seed must be a non-negative safe integer')
  return { outputRoot: resolve(outputRoot), runId: values.get('--run-id') ?? `offline-${seed}`, seed }
}

export async function runOfflineWritingQualityCli(args: string[]): Promise<Record<string, unknown>> {
  const options = parseOfflineWritingQualityArgs(args)
  const store = await WritingQualityRunStore.open(options.outputRoot, options.runId)
  const service = new WritingQualityExperimentService(store, new DeterministicOfflineWritingAdapter())
  const result = await service.run(createOfflineManifest(options.runId, options.seed))
  return {
    purpose: result.report.purpose,
    status: result.report.status,
    runId: result.report.runId,
    runRoot: result.runRoot,
    successfulSlots: result.report.successfulSlots,
    packetCount: result.report.packetCount,
    judgmentCoverage: result.report.judgmentCoverage,
    estimatedSyntheticCostCny: result.report.estimatedSyntheticCostCny
  }
}

async function main(): Promise<void> {
  try { process.stdout.write(`${JSON.stringify(await runOfflineWritingQualityCli(process.argv.slice(2)))}\n`) }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
