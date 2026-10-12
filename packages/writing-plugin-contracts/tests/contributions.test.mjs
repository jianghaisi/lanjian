import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validatePluginManifest, validateCompositionEntries, categoryLabel } from '../dist/index.js'
const fixture = () => JSON.parse(readFileSync(new URL('../../../desktop/examples/writing-plugins/writing-composition/lanjian-plugin.json', import.meta.url), 'utf8'))
test('five executable contribution shapes, extensible multi-category metadata and detached configuration', () => {
  const m = fixture(); m.categoryIds.push('future.category'); const result = validatePluginManifest(m)
  assert.equal(result.contributions.length, 5); assert.equal(categoryLabel('future.category'), '扩展分类 · future.category')
  assert.deepEqual(result.categoryIds, m.categoryIds); m.contributions[0].stages.length = 0; assert.equal(result.contributions[0].stages.length, 4)
  const contextOnly = fixture(); contextOnly.tools = []; contextOnly.contributions = [contextOnly.contributions[0]]; assert.equal(validatePluginManifest(contextOnly).tools.length, 0)
})
test('reject contradictory variants, protocol drift, category injection, loops and checker writes', () => {
  for (const mutate of [
    m => { m.apiVersion = 2 }, m => { m.categoryIds = ['../official'] }, m => { m.official = true },
    m => { m.contributions[0].toolId = 'reminder' }, m => { m.contributions[0].text = '{{undeclared}}' },
    m => { m.contributions[0].kind = 'adopt' }, m => { m.contributions[0].stages = ['unknown'] },
    m => { m.contributions[2].recipe.tools[0].steps[0].args.question = { $ref: 'steps.review.text' } },
    m => { m.contributions[2].recipe.tools[0].steps[0].loop = 2 },
    m => { m.contributions[3].kind = 'checker' }, m => { m.contributions[1].kind = 'setting-template' },
    m => { m.contributions[2].recipe.tools[0].steps.push(...Array(33).fill(m.contributions[2].recipe.tools[0].steps[0])) }
  ]) { const m = fixture(); mutate(m); assert.throws(() => validatePluginManifest(m)) }
})
test('composition boundaries reject host paths, duplicate selections and oversized parameters', () => {
  const e = { pluginId: 'personal.writing-composition', digest: 'a'.repeat(64), contributionId: 'style', params: { tone: '克制' } }
  assert.deepEqual(validateCompositionEntries([e]), [e])
  for (const input of [[e,e], [{...e,path:'/private'}], [{...e,digest:'../x'}], [{...e,params:{tone:'x'.repeat(9000)}}]]) assert.throws(() => validateCompositionEntries(input))
})
