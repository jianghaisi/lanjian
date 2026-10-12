import test from 'node:test'
import assert from 'node:assert/strict'
import { petRadialLayout } from '../../../src/renderer/features/companion/services/pet-radial-layout'
import { layoutDesktopPet } from '../../../src/main/modules/companion/application/desktop-pet-layout'
import { decodeDesktopPetLayout } from '../../../src/contracts/companion/desktop-pet'

test('full ring and short-screen columns fit the main projection with separate native hit rectangles', () => {
  for (const area of [{x:0,y:0,width:1920,height:1040},{x:-640,y:-400,width:640,height:400},{x:0,y:0,width:800,height:500}]) for (const scale of [.6,1,1.8]) {
    const home = {x:area.x,y:area.y,width:Math.min(area.width,320*Math.max(1,scale)),height:Math.min(area.height,460*Math.max(1,scale))}
    const {layout} = layoutDesktopPet(home,scale,'menu',area)
    const {width,height} = layout.panel!, {width:petWidth,height:petHeight} = layout.pet
    const pet = {...layout.pet,x:layout.pet.x-layout.panel!.x,y:layout.pet.y-layout.panel!.y}
    for (let parent = 0; parent < 6; parent++) {
      const positions = petRadialLayout(width,height,petWidth,petHeight,parent,5)
      const nodes = [...positions.primary,...positions.secondary]
      for (const p of nodes) {
        assert.ok(p.x >= 28 && p.x <= width-28 && p.y >= 28 && p.y <= height-28, JSON.stringify({width,height,p}))
        if (positions.compact) assert.ok(p.x+28<=pet.x || p.x-28>=pet.x+pet.width, 'compact menu covers the character')
      }
      if (!positions.compact) {
        assert.ok(Math.min(...positions.primary.map(p=>p.y+28))<pet.y, 'full ring needs a function above the character')
        assert.ok(Math.max(...positions.primary.map(p=>p.y-28))>pet.y+pet.height, 'full ring needs a function below the caption')
        assert.ok(Math.min(...positions.primary.map(p=>p.x-28))<pet.x && Math.max(...positions.primary.map(p=>p.x+28))>pet.x+pet.width, 'full ring needs functions on both sides')
        assert.ok(width-petWidth<300 && height-petHeight<300, 'full ring should remain tighter than the old envelope')
      }
      for (let i = 0; i < nodes.length; i++) for (let j = i+1; j < nodes.length; j++) {
        assert.ok(Math.abs(nodes[i]!.x-nodes[j]!.x)>=56 || Math.abs(nodes[i]!.y-nodes[j]!.y)>=56, `native click rectangles overlap: ${JSON.stringify({width,height,parent,i,j,a:nodes[i],b:nodes[j]})}`)
      }
    }
  }
})
test('native orbit preserves size and home across screen edges, with an exact collapse and valid projection', () => {
  for (const area of [{x:0,y:0,width:1920,height:1040},{x:-640,y:-400,width:640,height:400}]) for (const scale of [.6,1,1.8]) {
    const size = { width: Math.min(area.width,Math.round(320*Math.max(1,scale))), height: Math.min(area.height,Math.round(460*Math.max(1,scale))) }
    for (const edge of ['left','right']) {
      const home = {...size,x:edge==='left'?area.x:area.x+area.width-size.width,y:area.y+area.height-size.height}, original={...home}
      const idle=layoutDesktopPet(home,scale,null,area), expanded=layoutDesktopPet(home,scale,'menu',area)
      assert.deepEqual(decodeDesktopPetLayout(expanded.layout),expanded.layout)
      assert.equal(expanded.layout.pet.width,idle.layout.pet.width); assert.equal(expanded.layout.pet.height,idle.layout.pet.height)
      assert.ok(expanded.bounds.x>=area.x && expanded.bounds.y>=area.y && expanded.bounds.x+expanded.bounds.width<=area.x+area.width && expanded.bounds.y+expanded.bounds.height<=area.y+area.height)
      assert.deepEqual(home,original);assert.deepEqual(layoutDesktopPet(home,scale,null,area),idle)
    }
  }
})
