import type { LocalModelScheduler } from '../../../models/application/local-model-scheduler'
import type { CompanionVoiceId } from '../../../../../contracts/companion/companion-voice-contracts'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolvePortablePython } from '../../../../platform/processes/portable-python-runtime'
import { encodeFrame, VoiceFrameReader, type VoiceFrame } from './protocol'
import { PreparationDeadline, VOICE_REQUEST_TIMEOUT_MS } from './preparation-deadline'

export type LocalInferenceRequest =
  | { action: 'prepare-text' }
  | { action: 'chat'; text: string; context: string; history: Array<{ role: 'user' | 'assistant'; content: string }> }
  | { action: 'tts'; text: string; voice: CompanionVoiceId }
  | { action: 'prepare'; voice: CompanionVoiceId }
  | { action: 'asr'; sampleRate: 16000; pcm: Buffer }
export const COMPANION_IDLE_MS = 10 * 60_000
export class LocalVoiceRuntime {
  private worker?: ChildProcessWithoutNullStreams
  private pending?: { id: string; resolve: (value: VoiceFrame) => void; reject: (error: Error) => void; clearDeadline: () => void; release: () => void; discarded: boolean; preparation?: PreparationDeadline; delta?: (text: string) => void; audio?: (pcm: Buffer) => void; sequence: number; bytes: number }
  private idle?: NodeJS.Timeout
  private starting?: Promise<void>
  private epoch = 0
  constructor(private readonly root: string, private readonly workerScript: string, private readonly scheduler?: LocalModelScheduler,
    private readonly profile: 'text' | 'speech' = 'text', private readonly releaseResident: () => void = () => { if (this.profile === 'text') this.stop() },
    private readonly diagnostic?: (chunk: Buffer) => void) {}

  async available(capability: 'chat' | 'asr' = 'chat'): Promise<boolean> {
    try {
      if (this.profile === 'speech') {
        const assets = JSON.parse(await readFile(join(dirname(this.workerScript), 'gpt-sovits-assets.json'), 'utf8')) as {voices:Array<{key:string}>;models:Array<{key:string;files:Array<[string,number,string,string]>}>}
        await Promise.all(['gpt-sovits-audition/venv/Scripts/python.exe', 'gpt-sovits-audition/source/GPT_SoVITS/TTS_infer_pack/TTS.py',
          ...assets.models.filter(model => model.key === 'gpt-sovits' || model.key === 'gpt-sovits-g2pw' || assets.voices.some(voice => voice.key === model.key)).flatMap(model => model.files
            .filter(file => model.key !== 'gpt-sovits' || file[0].startsWith('chinese-hubert-base/') || file[0].startsWith('chinese-roberta-wwm-ext-large/'))
            .map(file => `models/${model.key}/${file[0]}`))].map(path => access(join(this.root, path))))
      } else await Promise.all(['venv/Scripts/python.exe', ...(capability === 'asr' ? ['models/asr/model.int8.onnx', 'models/asr/tokens.txt'] : ['models/llm/Qwen3-1.7B-Q8_0.gguf'])].map(path => access(join(this.root, path))))
      return true
    } catch { return false }
  }
  private async start(): Promise<void> {
    if (this.worker) return
    if (this.starting) return this.starting
    this.starting = this.spawnWorker().finally(() => { this.starting = undefined })
    return this.starting
  }
  private async spawnWorker(): Promise<void> {
    const epoch = this.epoch
    const environmentPath = join(this.root, this.profile === 'speech' ? 'gpt-sovits-audition/venv' : 'venv')
    const { root, environment, python: exe } = await resolvePortablePython(this.root, environmentPath)
    // The Windows venv redirector spawns another process. Launch the contained base
    // interpreter directly so cancel owns the real inference PID, not its launcher.
    if (epoch !== this.epoch) throw new Error('VOICE_CANCELLED')
    // Deliberate allowlist: provider keys/proxies/author config never enter the child.
    const env: NodeJS.ProcessEnv = {
      SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
      TEMP: join(root, 'temp'), TMP: join(root, 'temp'),
      PATH: `${join(environment, 'Scripts')};${join(process.env.SystemRoot || 'C:/Windows', 'System32')}`,
      HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1',
      HF_HOME: join(root, 'cache/hf'), NUMBA_CACHE_DIR: join(root, 'cache/numba'), NUMBA_DISABLE_INTEL_SVML: '1',
      PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2',
      TORCH_FORCE_WEIGHTS_ONLY_LOAD: '1', OPENBLAS_NUM_THREADS: '2',
      MPLCONFIGDIR: join(root, 'gpt-sovits-audition/mpl-cache'), TORCH_HOME: join(root, 'gpt-sovits-audition/torch-cache'),
    }
    const child = spawn(exe, ['-I', '-u', '-X', 'utf8', this.workerScript, root, this.profile], { cwd: root, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.worker = child
    const reader = new VoiceFrameReader()
    child.stdout.on('data', (chunk: Buffer) => {
      if (child !== this.worker) return
      try {
        for (const result of reader.push(chunk)) {
          const pending = this.pending
          if (!pending || result.header.id !== pending.id) throw new Error('VOICE_STALE_FRAME')
          if (result.header.kind === 'progress') {
            if (!pending.preparation || result.pcm.length) throw new Error('VOICE_PROTOCOL_FAILED')
            if (!pending.discarded) pending.preparation.advance(result.header.stage)
            continue
          }
          if (result.header.kind === 'audio') {
            pending.bytes += result.pcm.length
            if (result.header.seq !== pending.sequence++ || result.header.sampleRate !== 24000 || !result.pcm.length || pending.bytes > 1_440_000) throw new Error('VOICE_AUDIO_INVALID')
            pending.audio?.(result.pcm)
            continue
          }
          if (result.header.kind === 'delta') {
            if (typeof result.header.text !== 'string' || result.header.text.length > 600 || result.pcm.length) throw new Error('VOICE_DELTA_INVALID')
            pending.delta?.(result.header.text)
            continue
          }
          if (result.header.ok !== true && result.header.ok !== false) throw new Error('VOICE_RESULT_INVALID')
          pending.clearDeadline(); this.pending = undefined; pending.release()
          if (result.header.ok) pending.resolve(result)
          else {
            const code = ['VOICE_MEMORY', 'VOICE_CUDA_UNAVAILABLE', 'VOICE_ASSETS_INVALID'].includes(String(result.header.error)) ? String(result.header.error) : 'VOICE_INFERENCE_FAILED'
            pending.reject(new Error(code))
          }
          if (this.profile === 'text') {
            this.idle = setTimeout(() => this.stop(), COMPANION_IDLE_MS)
            this.idle.unref()
          }
        }
      } catch { this.stop('VOICE_PROTOCOL_FAILED') }
    })
    // Always drain stderr; never forward untrusted library diagnostics to the UI or logs.
    child.stderr.on('data', (chunk: Buffer) => { this.diagnostic?.(chunk) })
    child.stdin.on('error', () => { if (child === this.worker) this.stop('VOICE_WORKER_EXIT') })
    child.on('error', () => { if (child === this.worker) this.stop('VOICE_WORKER_EXIT') })
    child.on('exit', () => { if (child === this.worker) this.stop('VOICE_WORKER_EXIT') })
  }
  async run(input: LocalInferenceRequest, signal?: AbortSignal, delta?: (text: string) => void, audio?: (pcm: Buffer) => void): Promise<VoiceFrame> {
    if ((this.profile === 'speech') !== (input.action === 'tts' || input.action === 'prepare')) throw new Error('VOICE_PROFILE_ACTION')
    const release = await this.scheduler?.acquire('companion', this.releaseResident, signal)
    let released = false
    const releaseLease = () => { if (!released) { released = true; release?.() } }
    try { return await this.runOwned(input, signal, delta, audio, releaseLease) }
    finally {
      // A cancelled speech caller is done, but its worker may still be finishing.
      // Keep the GPU lease until the terminal frame, not merely until UI cancellation.
      if (this.pending?.release !== releaseLease) releaseLease()
    }
  }
  private async runOwned(input: LocalInferenceRequest, signal: AbortSignal | undefined, delta: ((text: string) => void) | undefined, audio: ((pcm: Buffer) => void) | undefined, release: () => void): Promise<VoiceFrame> {
    if (signal?.aborted) throw new Error('VOICE_CANCELLED')
    if (this.pending || this.starting) throw new Error('VOICE_BUSY')
    const epoch = this.epoch
    await this.start()
    if (signal?.aborted || epoch !== this.epoch) { this.cancel(); throw new Error('VOICE_CANCELLED') }
    clearTimeout(this.idle)
    const id = randomUUID(), { pcm = Buffer.alloc(0), ...header } = input as LocalInferenceRequest & { pcm?: Buffer }
    const abort = () => this.cancel()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      return await new Promise<VoiceFrame>((resolve, reject) => {
        const preparation = input.action === 'prepare' ? new PreparationDeadline(reason => this.cancel(reason)) : undefined
        const timer = preparation ? undefined : setTimeout(() => this.cancel('VOICE_TIMEOUT'), VOICE_REQUEST_TIMEOUT_MS)
        const clearDeadline = () => { clearTimeout(timer); preparation?.clear() }
        this.pending = { id, resolve, reject, clearDeadline, release, discarded: false, preparation, delta, audio, sequence: 0, bytes: 0 }
        try { this.worker!.stdin.write(encodeFrame({ v: 1, id, ...header }, pcm)) }
        catch { this.stop('VOICE_PROTOCOL_FAILED') }
      })
    } finally { signal?.removeEventListener('abort', abort) }
  }
  cancel(reason = 'VOICE_CANCELLED'): void {
    if (this.profile === 'text') { if (this.pending || this.starting) this.stop(reason); return }
    const pending = this.pending
    if (pending && !pending.discarded) {
      pending.discarded = true; pending.clearDeadline()
      pending.delta = undefined; pending.audio = undefined
      pending.reject(new Error(reason))
      // Drain this one bounded job without publishing its late output or unloading
      // the engine. No new job can take its execution lease until it really ends.
    } else if (!pending && this.starting) this.epoch++
  }
  stop(reason = 'VOICE_CANCELLED'): void {
    this.epoch += 1
    clearTimeout(this.idle)
    const pending = this.pending; this.pending = undefined
    if (pending) { pending.clearDeadline(); pending.reject(new Error(reason)); pending.release() }
    const child = this.worker; this.worker = undefined
    // No process tree or shell is created. Terminate only this owned inference process.
    if (child) { child.stdin.destroy(); child.kill() }
  }
}
