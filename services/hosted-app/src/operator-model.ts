import { configFromEnv } from './config.ts'
import { HostedDatabase } from './storage/database.ts'
import { ModelStore } from './models/model-store.ts'
import { CreditLedger } from './credits/ledger.ts'
import { modelId, record, decodePriceUpdate } from '@lanjian/hosted-contracts'

// Local operator command only. Secrets arrive on stdin, never argv or logs.
async function main() {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk); size += bytes.length
    if (size > 32768) throw new Error('Input exceeds limit')
    chunks.push(bytes)
  }
  const input = record(JSON.parse(Buffer.concat(chunks).toString('utf8')), ['id', 'model', 'price'])
  const id = modelId(input.id), config = configFromEnv(), db = new HostedDatabase(config.dataDir)
  try {
    const models = new ModelStore(db, config), credits = new CreditLedger(db), selection = models.selection()
    const price = decodePriceUpdate(input.price), model = record(input.model)
    if (price.policy.mode === 'unconfigured') throw new Error('Configure a price first')
    // Failure leaves this connection disabled, never billable at an old rate.
    const saved = models.update('operator', id, { ...model, enabled: false })
    credits.updatePrice('operator', id, price)
    models.update('operator', id, { ...model, enabled: true, expectedRevision: saved.revision })
    if (models.get(id).keyConfigured) models.select('operator', { modelId: id, expectedRevision: selection.revision })
    process.stdout.write(JSON.stringify({ modelId: id, model: models.get(id).model, priceVersion: credits.price(id).version, selected: models.selected()?.id === id, keyRequired: !models.get(id).keyConfigured }) + '\n')
  } finally { db.close() }
}
main().catch(() => { process.stderr.write('Model configuration failed. Check the input and current revisions; no secret is logged.\n'); process.exitCode = 1 })
