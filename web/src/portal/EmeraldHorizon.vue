<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { LUMINA_VERTEX_SHADER, LUMINA_FRAGMENT_SHADER } from '../vendor/threeui/emeraldHorizonShaders'
// ThreeUI's MIT Community shader, with a bounded browser lifecycle. No remote assets.
const canvas = ref<HTMLCanvasElement>()
const props = defineProps<{ paused: boolean }>()
let dispose = () => {}
onMounted(() => {
  const el = canvas.value!
  const gl = el.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' })
  if (!gl) return
  const shaders: WebGLShader[] = []
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader)
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
  }
  const vertex = compile(gl.VERTEX_SHADER, 'attribute vec3 position; attribute vec2 uv;\n' + LUMINA_VERTEX_SHADER)
  const fragment = compile(gl.FRAGMENT_SHADER, 'precision mediump float;\n' + LUMINA_FRAGMENT_SHADER)
  if (!vertex || !fragment) { shaders.forEach(s => gl.deleteShader(s)); return }
  const program = gl.createProgram()!
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); shaders.forEach(s => gl.deleteShader(s)); return }
  gl.useProgram(program)
  const buffer = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,0,0,0, 1,-1,0,1,0, -1,1,0,0,1, -1,1,0,0,1, 1,-1,0,1,0, 1,1,0,1,1]), gl.STATIC_DRAW)
  for (const [name, size, offset] of [['position', 3, 0], ['uv', 2, 12]] as const) {
    const attribute = gl.getAttribLocation(program, name)
    if (attribute >= 0) { gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 20, offset) }
  }
  const uniform = (name: string) => gl.getUniformLocation(program, name)
  gl.uniform1f(uniform('u_wave_scale'), 1.1); gl.uniform1f(uniform('u_variation'), .65)
  gl.uniform1f(uniform('u_glow'), .42); gl.uniform1f(uniform('u_vignette'), 1)
  const clock = uniform('u_time'), resolution = uniform('u_resolution')
  let frame = 0, time = 0, last = performance.now(), visible = true, lost = false
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const render = (now: number) => {
    frame = 0
    if (lost || !visible || document.hidden) return
    if (!props.paused && !motion.matches) time += Math.min(now - last, 100) / 3000
    last = now; gl.uniform1f(clock, time); gl.drawArrays(gl.TRIANGLES, 0, 6)
    if (!props.paused && !motion.matches) frame = requestAnimationFrame(render)
  }
  const resume = () => { if (!frame && visible && !document.hidden && !lost) { last = performance.now(); frame = requestAnimationFrame(render) } }
  const resize = new ResizeObserver(() => {
    const box = el.getBoundingClientRect(), scale = Math.min(devicePixelRatio, 1.25)
    el.width = Math.max(1, Math.round(box.width * scale)); el.height = Math.max(1, Math.round(box.height * scale))
    gl.viewport(0, 0, el.width, el.height); gl.uniform2f(resolution, el.width, el.height); resume()
  })
  const intersection = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; resume() })
  const contextLost = (event: Event) => { event.preventDefault(); lost = true; if (frame) cancelAnimationFrame(frame); frame = 0 }
  resize.observe(el); intersection.observe(el)
  document.addEventListener('visibilitychange', resume); motion.addEventListener('change', resume)
  el.addEventListener('webglcontextlost', contextLost)
  // The button only changes a prop; schedule a frame when it resumes the illustration.
  const stop = watch(() => props.paused, resume)
  dispose = () => { stop(); if (frame) cancelAnimationFrame(frame); resize.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', resume); motion.removeEventListener('change', resume); el.removeEventListener('webglcontextlost', contextLost); gl.deleteBuffer(buffer); gl.deleteProgram(program); shaders.forEach(s => gl.deleteShader(s)) }
})
import { watch } from 'vue'
onBeforeUnmount(() => dispose())
</script>
<template><canvas ref="canvas" class="emerald-horizon" aria-hidden="true" /></template>
<style scoped>.emerald-horizon { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; opacity:.8; }</style>
