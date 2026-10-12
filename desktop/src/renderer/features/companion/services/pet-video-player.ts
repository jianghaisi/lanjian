export interface PetVideoClip { id: string; url: string; frames: number; fps: number; loop: boolean }
export interface PetVideoState { ready: boolean; failed: boolean; clip: string; frames: number }

/** Own at most the displayed decoder and one pending decoder. Never publish a stale load. */
export function createPetVideoPlayer(host: HTMLElement, callbacks: {
  state(value: PetVideoState): void
  started(intent: string, action: number): void
}, makeVideo: () => HTMLVideoElement = () => document.createElement('video')) {
  type Entry = { video: HTMLVideoElement; clip: PetVideoClip; intent: string; action: number; token: number; notified: boolean; cleanup(): void }
  let current: Entry | undefined, pending: Entry | undefined, generation = 0, disposed = false
  let hidden = false, reduced = false
  function release(entry: Entry | undefined) {
    if (!entry) return
    entry.cleanup(); entry.video.pause(); entry.video.removeAttribute('src'); entry.video.load(); entry.video.remove()
  }
  function state(failed = false) {
    callbacks.state({ ready: Boolean(current), failed, clip: current?.clip.id ?? 'idle', frames: current?.clip.frames ?? 0 })
  }
  function notify(entry: Entry) {
    if (entry !== current || entry.token !== generation || entry.notified || disposed) return
    entry.notified = true; callbacks.started(entry.intent, entry.action)
  }
  function failed(entry: Entry) {
    if (disposed || entry.token !== generation) return
    if (pending === entry) { pending = undefined; release(entry) }
    else if (current === entry) { current = undefined; release(entry) }
    state(true)
  }
  function play(entry: Entry) {
    if (disposed || hidden || reduced || entry !== current) return
    void entry.video.play().then(() => notify(entry)).catch(() => {
      if (!hidden && !reduced) failed(entry)
    })
  }
  function select(clip: PetVideoClip, intent: string, action: number) {
    if (disposed) return
    const token = ++generation
    release(pending); pending = undefined
    current?.video.pause()
    const video = makeVideo()
    video.muted = true; video.defaultMuted = true; video.playsInline = true
    video.preload = 'auto'; video.loop = clip.loop; video.style.visibility = 'hidden'
    video.setAttribute('aria-hidden', 'true'); video.dataset.petClip = clip.id
    let timeout: ReturnType<typeof setTimeout>
    const entry: Entry = { video, clip, intent, action, token, notified: false, cleanup() {
      clearTimeout(timeout); video.removeEventListener('loadeddata', loaded); video.removeEventListener('error', error)
    } }
    function error() { failed(entry) }
    function loaded() {
      if (disposed || token !== generation || pending !== entry) return
      clearTimeout(timeout); video.removeEventListener('loadeddata', loaded)
      const previous = current; current = entry; pending = undefined
      video.style.visibility = 'visible'; release(previous); state()
      if (hidden || reduced) { video.pause(); notify(entry) }
      else play(entry)
    }
    pending = entry; state()
    video.addEventListener('loadeddata', loaded); video.addEventListener('error', error)
    timeout = setTimeout(error, 12_000)
    host.appendChild(video); video.src = clip.url; video.load()
  }
  function activity(value: { hidden: boolean; reduced: boolean }) {
    hidden = value.hidden; reduced = value.reduced
    if (!current) return
    if (hidden || reduced) {
      current.video.pause()
      if (reduced && current.video.readyState >= 2) current.video.currentTime = 0
    } else if (!pending) play(current)
  }
  function dispose() {
    disposed = true; generation++; release(pending); release(current); pending = current = undefined
  }
  return { select, activity, dispose }
}
