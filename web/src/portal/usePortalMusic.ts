import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import welcome1 from '../../media/music/welcome-1.mp3'
import welcome2 from '../../media/music/welcome-2.mp3'
import reveal1 from '../../media/music/reveal-1.mp3'
import reveal2 from '../../media/music/reveal-2.mp3'

type Scene = 'welcome' | 'reveal'
const pick = (tracks: string[]) => tracks[Math.floor(Math.random() * tracks.length)]!

/** Two streaming elements only. Late play promises never revive a previous scene. */
export function usePortalMusic() {
  const state = ref<'idle' | 'loading' | 'playing' | 'muted' | 'retry'>('idle')
  const enabled = ref(true)
  const selected = { welcome: pick([welcome1, welcome2]), reveal: pick([reveal1, reveal2]) }
  let players: Record<Scene, HTMLAudioElement>, scene: Scene = 'welcome', epoch = 0, disposed = false
  let fade = 0, timeout = 0
  const label = computed(() => ({ idle: '声音已开启', loading: '声音加载中…', playing: '关闭声音', muted: '开启声音', retry: '重试声音' })[state.value])
  function cancelFade() { cancelAnimationFrame(fade); clearTimeout(timeout) }
  function stop() { ++epoch; cancelFade(); if (players) Object.values(players).forEach(player => player.pause()) }
  async function play() {
    if (!players || disposed || !enabled.value || document.hidden) return
    cancelFade()
    const generation = ++epoch, target = players[scene], previous = players[scene === 'welcome' ? 'reveal' : 'welcome']
    state.value = 'loading'; target.volume = .38
    timeout = window.setTimeout(() => { if (generation === epoch) { stop(); state.value = 'retry' } }, 12000)
    try {
      await target.play()
      if (generation !== epoch || disposed || !enabled.value || document.hidden) { if (target !== players[scene] || !enabled.value || document.hidden || disposed) target.pause(); return }
      clearTimeout(timeout); state.value = 'playing'
      const start = performance.now(), previousVolume = previous.volume
      const mix = (now: number) => {
        if (generation !== epoch) return
        const progress = Math.max(0, Math.min(1, (now - start) / 800))
        target.volume = .38 * progress; previous.volume = previousVolume * (1 - progress)
        if (progress < 1) fade = requestAnimationFrame(mix)
        else previous.pause()
      }
      fade = requestAnimationFrame(mix)
    } catch (error) {
      if (generation !== epoch || disposed) return
      clearTimeout(timeout)
      state.value = error instanceof DOMException && error.name === 'NotAllowedError' ? 'idle' : 'retry'
    }
  }
  function setScene(next: Scene, restart = false) {
    scene = next
    if (restart && players) players[next].currentTime = 0
    void play()
  }
  function toggle() {
    if (enabled.value && state.value !== 'retry') { enabled.value = false; stop(); state.value = 'muted' }
    else { enabled.value = true; void play() }
    try { localStorage.setItem('lanjian-portal-music', enabled.value ? 'on' : 'off') } catch { /* Session choice still works. */ }
  }
  const visibility = () => { if (document.hidden) stop(); else if (enabled.value) void play() }
  const gesture = (event: Event) => {
    if ((event.target as Element)?.closest?.('.welcome-button,.portal-sound,.product-sound,.skip-prologue')) return
    if (state.value === 'idle' && enabled.value) void play()
  }
  onMounted(() => {
    try { enabled.value = localStorage.getItem('lanjian-portal-music') !== 'off' } catch { /* Storage is optional. */ }
    players = Object.fromEntries(Object.entries(selected).map(([key, src]) => {
      const audio = new Audio(src); audio.preload = 'metadata'; audio.loop = true
      audio.dataset.portalScene = key; audio.hidden = true; document.body.append(audio)
      audio.addEventListener('error', () => { if (players?.[scene] === audio && !disposed) { stop(); state.value = 'retry' } })
      return [key, audio]
    })) as Record<Scene, HTMLAudioElement>
    document.addEventListener('visibilitychange', visibility)
    document.addEventListener('pointerdown', gesture); document.addEventListener('keydown', gesture)
    if (enabled.value) void play(); else state.value = 'muted'
  })
  onBeforeUnmount(() => {
    disposed = true; stop()
    document.removeEventListener('visibilitychange', visibility)
    document.removeEventListener('pointerdown', gesture); document.removeEventListener('keydown', gesture)
    if (players) Object.values(players).forEach(audio => { audio.removeAttribute('src'); audio.load(); audio.remove() })
  })
  return { label, state, enabled, toggle, setScene }
}
