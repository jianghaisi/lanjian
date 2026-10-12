<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
const props = defineProps<{ paused: boolean; scene: number }>()
const canvas = ref<HTMLCanvasElement>(), active = ref(false)
let dispose = () => {}
// Static seeds drive the sea, filaments, orbital trails and sparse foreground gold facets.
const vertex = `precision highp float;
attribute vec4 a_seed;
uniform float u_time, u_aspect, u_dpr, u_scene;
uniform vec2 u_pointer;
varying vec4 v_colour;
varying float v_angle, v_kind;
void main(){
 float u=a_seed.x,v=a_seed.y,kind=a_seed.z,seed=a_seed.w;
 float t=u_time, x,y,z,glow;
 v_kind=kind; v_angle=1.5708;
 if(kind<0.5){
   x=(u-.5)*5.8; z=v*3.9;
   y=-.9+sin(x*2.7+z*2.3-t*.8)*.12+sin(x*5.1-z*3.2+t*.45)*.045;
   x+=sin(z*3.0+t*.3)*.08;
   float perspective=1.0/(1.0+z*.48);
   x*=perspective; y=y*perspective-.12;
   glow=.24+.58*pow(.5+.5*sin(x*4.0+z*2.6-t*1.5),3.0);
   gl_PointSize=(1.8+2.9*perspective)*u_dpr;
 }else if(kind<1.5){
   float rise=fract(v+t*.046);
   float angle=u*6.28318+rise*7.0+t*.24;
   float radius=.18+.14*sin(rise*3.14);
   x=cos(angle)*radius; z=sin(angle);
   y=rise*1.65-.75;
   x+=sin(rise*12.0-t*.5+u*5.0)*.035;
   glow=(.2+.7*pow(.5+.5*sin(v*12.0-t*2.0),4.0))*sin(rise*3.14159);
   gl_PointSize=(4.5+seed*5.5)*u_dpr;
 }else if(kind<2.5){
   float angle=u*6.28318+t*(.10+v*.06);
   float radius=.42+v*.22;
   x=cos(angle)*radius;
   y=sin(angle)*.17+sin(angle*2.0+t*.25)*.045-.24+v*.05;
   z=sin(angle);
   glow=.25+.55*pow(.5+.5*sin(angle*3.0-t),5.0);
   v_angle=atan(cos(angle)*.17,-sin(angle)*radius);
   gl_PointSize=(4.0+seed*4.0)*u_dpr;
 }else{
   float rise=fract(v+t*(.032+seed*.018));
   float angle=u*6.28318+rise*4.0+t*.12;
   float radius=.24+seed*.47;
   x=cos(angle)*radius+sin(rise*9.0+seed*6.0)*.055;
   y=rise*1.8-.88; z=sin(angle);
   float envelope=smoothstep(0.0,.15,rise)*(1.0-smoothstep(.8,1.0,rise));
   glow=(.3+.65*pow(.5+.5*sin(t*1.8+seed*30.0),4.0))*envelope;
   v_angle=seed*6.28318+t*(.18+seed*.42);
   gl_PointSize=(12.0+seed*15.0)*(.78+.22*z)*u_dpr;
 }
 x+=u_pointer.x*.025*(.5+seed); y+=u_pointer.y*.02;
 x/=max(.8,u_aspect*.80);
 gl_Position=vec4(x,y,0.0,1.0);
 vec3 warm=vec3(1.0,.52,.21),cold=vec3(.52,.7,.76);
 vec3 colour=mix(warm,cold,step(.65,seed)*.68);
 if(kind>2.5)colour=mix(vec3(1.0,.49,.12),vec3(1.0,.85,.51),seed);
 colour=mix(colour,vec3(1.0,.67,.38),u_scene*.035);
 v_colour=vec4(colour,min(1.0,glow*1.35));
}`
const fragment = `precision mediump float;
varying vec4 v_colour;
varying float v_angle, v_kind;
void main(){
 vec2 p=gl_PointCoord-.5;
 float c=cos(v_angle),s=sin(v_angle);
 p=mat2(c,-s,s,c)*p;
 if(v_kind>2.5){
   // An asymmetric cut with two faces, narrowing as the fragment turns edge-on.
   p.x/=0.4+0.6*abs(sin(v_angle*1.7));
   float edge=abs(p.x)*1.55+abs(p.y)*.82+p.y*.18;
   float shard=1.0-smoothstep(.26,.34,edge);
   float facet=mix(.48,1.0,smoothstep(-.025,.025,p.x+p.y*.35));
   float halo=(1.0-smoothstep(.05,.48,length(p)))*.09;
   gl_FragColor=vec4(v_colour.rgb,(shard*facet+halo)*v_colour.a);
 }else{
   if(v_kind>.5)p.y*=2.7;
   float r=length(p),alpha=(1.0-smoothstep(.04,.5,r))*v_colour.a;
   gl_FragColor=vec4(v_colour.rgb,alpha);
 }
}`
onMounted(() => {
  const el = canvas.value!, gl = el.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power', premultipliedAlpha: false })
  if (!gl) return
  const shaders: WebGLShader[] = []
  function compile(type: number, source: string) { const shader = gl!.createShader(type); if (!shader) return null; shaders.push(shader); gl!.shaderSource(shader, source); gl!.compileShader(shader); return gl!.getShaderParameter(shader, gl!.COMPILE_STATUS) ? shader : null }
  const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment), program = gl.createProgram()
  const release = () => { shaders.forEach(s => gl.deleteShader(s)); if (program) gl.deleteProgram(program) }
  if (!vs || !fs || !program) { release(); return }
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { release(); return }
  gl.useProgram(program)
  const seeds: number[] = [], mobile = innerWidth < 701, columns = mobile ? 88 : 180, rows = mobile ? 54 : 100
  const random = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s) }
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) seeds.push(i / columns, j / rows, 0, random(i + j * columns))
  for (let i = 0; i < (mobile ? 1800 : 3400); i++) seeds.push(random(i * 3), random(i * 3 + 1), 1, random(i * 3 + 2))
  for (let i = 0; i < 2200; i++) seeds.push(i / 2200, random(i + 700), 2, random(i + 300))
  for (let i = 0; i < (mobile ? 112 : 220); i++) seeds.push(random(i * 5 + 9000), random(i * 5 + 9001), 3, random(i * 5 + 9002))
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(seeds), gl.STATIC_DRAW)
  const location = gl.getAttribLocation(program, 'a_seed'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 0, 0)
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
  const timeUniform = gl.getUniformLocation(program, 'u_time'), sceneUniform = gl.getUniformLocation(program, 'u_scene'), pointerUniform = gl.getUniformLocation(program, 'u_pointer')
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let frame = 0, time = 0, last = performance.now(), visible = true, lost = false, pointerX = 0, pointerY = 0
  const draw = (now: number) => {
    frame = 0; if (lost || !visible || document.hidden) return
    if (!props.paused && !motion.matches) time += Math.min(now - last, 70) / 1000
    last = now; gl.uniform1f(timeUniform, time); gl.uniform1f(sceneUniform, props.scene); gl.uniform2f(pointerUniform, pointerX, pointerY)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.POINTS, 0, seeds.length / 4); active.value = true
    if (!props.paused && !motion.matches) frame = requestAnimationFrame(draw)
  }
  const resume = () => { if (!frame && visible && !document.hidden && !lost) { last = performance.now(); frame = requestAnimationFrame(draw) } }
  const resize = new ResizeObserver(() => { const ratio = Math.min(devicePixelRatio, 1.5); el.width = Math.round(el.clientWidth * ratio); el.height = Math.round(el.clientHeight * ratio); gl.viewport(0, 0, el.width, el.height); gl.uniform1f(gl.getUniformLocation(program, 'u_aspect'), el.clientWidth / el.clientHeight); gl.uniform1f(gl.getUniformLocation(program, 'u_dpr'), ratio); resume() })
  const observer = new IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; if (!visible && frame) { cancelAnimationFrame(frame); frame = 0 }; resume() })
  const pointer = (event: PointerEvent) => { if (props.paused || motion.matches || event.pointerType !== 'mouse') return; pointerX = event.clientX / innerWidth - .5; pointerY = .5 - event.clientY / innerHeight }
  const visibility = () => { if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0 }; resume() }
  const contextLost = (event: Event) => { event.preventDefault(); lost = true; active.value = false; if (frame) cancelAnimationFrame(frame); frame = 0 }
  const stopWatch = watch(() => [props.paused, props.scene], resume)
  resize.observe(el); observer.observe(el); window.addEventListener('pointermove', pointer, { passive: true }); document.addEventListener('visibilitychange', visibility); motion.addEventListener('change', resume); el.addEventListener('webglcontextlost', contextLost)
  dispose = () => { stopWatch(); if (frame) cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect(); window.removeEventListener('pointermove', pointer); document.removeEventListener('visibilitychange', visibility); motion.removeEventListener('change', resume); el.removeEventListener('webglcontextlost', contextLost); gl.deleteBuffer(buffer); release() }
})
onBeforeUnmount(() => dispose())
</script>
<template><canvas ref="canvas" class="particle-field" :data-renderer="active ? 'webgl' : 'none'" aria-hidden="true"></canvas></template>
<style scoped>.particle-field{position:absolute;inset:0;z-index:1;width:100%;height:100%;pointer-events:none;mask-image:linear-gradient(transparent,#000 15% 78%,transparent 98%)}</style>
