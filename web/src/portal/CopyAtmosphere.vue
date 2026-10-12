<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
const props = defineProps<{ active: boolean; scene: number }>()
const canvas = ref<HTMLCanvasElement>()
let frame = 0, timer = 0, delayed = 0, started = 0, combo = -1
let points: Array<{x:number;y:number;dx:number;dy:number}> = []
let pointer = { x: 0, y: 0, targetX: 0, targetY: 0, linked: false }
function select() {
  if (!props.active || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const root = canvas.value?.closest('.intro-site') as HTMLElement | null
  if (!root || root.querySelector('.motion-stopped')) return
  combo = (combo + 1 + Math.floor(Math.random() * 2)) % 3
  root.dataset.copyEffect = ['particles', 'refraction', 'depth'][combo]
  points = []
  const heading = root.querySelector('.side-left h1,.side-left h2') as HTMLElement | null
  if (heading && combo === 0) {
    const box = heading.getBoundingClientRect(), style = getComputedStyle(heading)
    const mask = document.createElement('canvas'); mask.width = Math.ceil(box.width); mask.height = Math.ceil(box.height)
    const ctx = mask.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#fff'; ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`; ctx.textBaseline = 'top'
      const size = parseFloat(style.fontSize), line = parseFloat(style.lineHeight)
      let x = 0, y = 0
      for (const char of heading.innerText) { const width = ctx.measureText(char).width; if (char === '\n' || x + width > box.width) { x = 0; y += line; if (char === '\n') continue } ctx.fillText(char,x,y+(line-size)/2); x += width }
      const data = ctx.getImageData(0,0,mask.width,mask.height).data
      for (let y=0;y<mask.height;y+=4) for(let x=0;x<mask.width;x+=4) if(data[(y*mask.width+x)*4+3]!>100) points.push({x:box.left+x,y:box.top+y,dx:(Math.random()-.5)*110,dy:30+Math.random()*75})
    }
  }
  started = performance.now()
}
function move(event: PointerEvent) {
  pointer.x=event.clientX;pointer.y=event.clientY
  const link=(event.target as Element).closest('.side-right .text-control')
  const destination=document.querySelector('.archive-entry') || document.querySelector('.glass-person')
  pointer.linked=!!link && !!destination
  if(destination){const box=destination.getBoundingClientRect();pointer.targetX=box.left+box.width/2;pointer.targetY=box.top+box.height/2}
}
function draw(now:number) {
  frame=requestAnimationFrame(draw)
  const el=canvas.value, ctx=el?.getContext('2d');if(!el||!ctx)return
  if(el.width!==innerWidth||el.height!==innerHeight){el.width=innerWidth;el.height=innerHeight}
  ctx.clearRect(0,0,el.width,el.height)
  if(!props.active||document.hidden||matchMedia('(prefers-reduced-motion: reduce)').matches||document.querySelector('.archive-hero.motion-stopped'))return
  const progress=Math.min(1,(now-started)/1800), ease=1-Math.pow(1-progress,3)
  if(progress<1){ctx.fillStyle='#efba76';ctx.globalAlpha=Math.sin(progress*Math.PI)*.8;for(const p of points)ctx.fillRect(p.x+p.dx*(1-ease),p.y+p.dy*(1-ease),1.5,1.5);ctx.globalAlpha=1}
  if(pointer.linked){const gradient=ctx.createLinearGradient(pointer.x,pointer.y,pointer.targetX,pointer.targetY);gradient.addColorStop(0,'#ffd29c');gradient.addColorStop(1,'#d99a4a22');ctx.strokeStyle=gradient;ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(pointer.x,pointer.y);ctx.bezierCurveTo(pointer.x-80,pointer.y-35,pointer.targetX+100,pointer.targetY-50,pointer.targetX,pointer.targetY);ctx.stroke()}
}
watch(()=>[props.active,props.scene],()=>{clearTimeout(delayed);delayed=window.setTimeout(select,600)})
onMounted(()=>{frame=requestAnimationFrame(draw);timer=window.setInterval(select,18000);document.addEventListener('pointermove',move)})
onBeforeUnmount(()=>{cancelAnimationFrame(frame);clearInterval(timer);clearTimeout(delayed);document.removeEventListener('pointermove',move)})
</script>
<template><canvas ref="canvas" class="copy-atmosphere" aria-hidden="true" /></template>
<style scoped>.copy-atmosphere{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:7}</style>
