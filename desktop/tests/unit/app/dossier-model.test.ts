import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('exported Blender dossier has independent layers, a replaceable face and no external resources', () => {
  const bytes=readFileSync(new URL('../../../public/boot/lanjian-dossier.glb',import.meta.url))
  assert.equal(bytes.readUInt32LE(0),0x46546c67)
  assert.equal(bytes.readUInt32LE(4),2)
  assert.equal(bytes.readUInt32LE(8),bytes.length)
  const model=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'))
  for(const name of ['DossierBack','DossierCore','DossierCover']) {
    const layer=model.nodes.find((node:{name:string})=>node.name===name)
    assert.ok(layer?.children.length>0,`${name} must own geometry`)
  }
  for(const name of ['Chassis','BrushedMetal','Inset','Signal','ArchiveFace','OpticalGlass']) {
    assert.ok(model.materials.some((material:{name:string})=>material.name===name),name)
  }
  assert.equal(model.images?.length??0,0,'real work metadata is supplied only at runtime')
  assert.ok(model.buffers.every((buffer:{uri?:string})=>!buffer.uri),'GLB stays self-contained in file://')
})
