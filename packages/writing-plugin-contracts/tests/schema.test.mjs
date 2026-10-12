import test from 'node:test'
import assert from 'node:assert/strict'
import { assertJson, validateSchema, validateValue, objectSchema, textSchema } from '../src/index.ts'

test('nested schemas validate exact shape, enum, numeric and collection bounds', () => {
  const schema = validateSchema(objectSchema({ rows: { type: 'array', minItems: 1, maxItems: 2, items: objectSchema({ name: textSchema(5, 1), count: { type: 'integer', minimum: 1, maximum: 3 }, enabled: { type: 'boolean' } }) } }))
  validateValue(schema, { rows: [{ name: '人物', count: 2, enabled: true }] })
  for (const rows of [[], [{ name: 'x', count: 1.2, enabled: true }], [{ name: 'x', count: 1, enabled: 1 }], [{ name: 'x', count: 1, enabled: true, save: true }]]) assert.throws(() => validateValue(schema, { rows }))
  assert.throws(() => validateValue(validateSchema(objectSchema({ choice: { type: 'string', maxLength: 3, enum: ['a'] } })), { choice: 'b' }))
})

test('remote refs, unknown keywords, unbounded or deep schemas fail at registration', () => {
  for (const schema of [{ type: 'object' }, { ...objectSchema({}), $ref: 'https://example.org/schema' }, objectSchema({ a: { type: 'string' } }), objectSchema({ a: { type: 'array', items: textSchema(1) } }), objectSchema({ a: { type: 'number', minimum: 5, maximum: 1 } })]) assert.throws(() => validateSchema(schema))
  let schema = textSchema(1)
  for (let i = 0; i < 10; i++) schema = objectSchema({ child: schema })
  assert.throws(() => validateSchema(schema))
})

test('unsafe keys, cycles, non-JSON values and UTF-8 overflow fail without executing getters', () => {
  const cyclic = {}; cyclic.self = cyclic
  let accessed = false
  const getter = { get secret() { accessed = true; return 'x' } }
  for (const value of [JSON.parse('{"__proto__":{}}'), JSON.parse('{"constructor":{}}'), cyclic, getter, new Date(), { n: NaN }, { absent: undefined }, Array(2)]) assert.throws(() => assertJson(value))
  assert.equal(accessed, false)
  assert.throws(() => validateValue(textSchema(100), '中文中文', 10))
  assert.doesNotThrow(() => assertJson({ x: [null, true, 1, '小说'] }))
})
