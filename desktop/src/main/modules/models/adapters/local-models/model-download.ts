import { mkdir, open, rename, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { atomicJson, fileMatches, installError, ownedPath, readSmallJson, type DownloadArtifact } from './install-files'

export type DownloadTransport = (url: string, headers: Record<string, string>, signal: AbortSignal) => Promise<Response>
const allowedHosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'files.pythonhosted.org', 'huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.hf.co', 'cdn-lfs.hf.co', 'cas-bridge.xethub.hf.co', 'us.aws.cdn.hf.co'])
export type ArtifactFetch = (url: string, options: { headers: Record<string,string>; signal: AbortSignal; redirect: 'manual'; credentials: 'omit' }) => Promise<Response>
export function artifactTransport(request: ArtifactFetch = fetch): DownloadTransport { return async (source, headers, signal) => {
  let url = new URL(source)
  for (let hop = 0; hop < 6; hop++) {
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowedHosts.has(url.hostname)) throw installError('模型下载来源不在已审核清单中。')
    let response:Response
    try { response = await request(url.toString(), { headers, signal, redirect: 'manual', credentials: 'omit' }) }
    catch { signal.throwIfAborted(); throw installError('无法连接模型下载源，请检查网络后重试。') }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location'); await response.body?.cancel()
    if (!location) break
    url = new URL(location, url)
  }
  throw installError('模型下载来源跳转异常，请稍后重试。')
} }
export const fetchModelArtifact = artifactTransport()
function strongETag(value: unknown): value is string { return typeof value === 'string' && /^"[^"\r\n]{1,250}"$/.test(value) }

/** Only explicitly invoked installation uses this adapter; inference never does. */
export class ModelDownloader {
  constructor(private root: string, private transport: DownloadTransport = fetchModelArtifact) {}
  async download(artifact: DownloadArtifact, signal: AbortSignal, progress: (bytes: number) => void): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1) throw installError('模型下载清单无效。')
    await mkdir(this.root, { recursive: true })
    const key = artifact.sha256, completed = await ownedPath(this.root, key + '.asset')
    if (await fileMatches(completed, artifact, signal)) { progress(artifact.bytes); return completed }
    try { await stat(completed); await rename(completed, await ownedPath(this.root, key + '.invalid-' + randomUUID())) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const part = await ownedPath(this.root, key + '.part'), metaName = key + '.resume.json'
    let offset = 0, etag: string | undefined
    try {
      const record = await readSmallJson(await ownedPath(this.root, metaName)) as Record<string, unknown>
      const size = (await stat(part)).size
      if (record.sha256 === key && record.bytes === artifact.bytes && typeof record.received === 'number' && Number.isSafeInteger(record.received) && record.received >= 0 && record.received <= size && size <= artifact.bytes && strongETag(record.etag)) { offset = record.received; etag = record.etag }
    } catch (error) { if (error instanceof Error && error.message.includes('安装目录')) throw error }
    if (offset === artifact.bytes && await fileMatches(part, artifact, signal)) {
      signal.throwIfAborted(); await rename(part, completed); progress(offset); return completed
    }
    const timeout = AbortSignal.timeout(30 * 60_000), requestSignal = AbortSignal.any([signal, timeout])
    const chunked = artifact.bytes > 64 * 1024 * 1024
    const end = chunked ? Math.min(offset + 8 * 1024 * 1024 - 1, artifact.bytes - 1) : artifact.bytes - 1
    const headers: Record<string, string> = { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' }
    if (chunked || (offset > 0 && etag)) headers.Range = chunked ? `bytes=${offset}-${end}` : `bytes=${offset}-`
    if (offset > 0 && etag) headers['If-Range'] = etag
    const response = await this.transport(artifact.url, headers, requestSignal)
    if (response.status === 416) { await response.body?.cancel(); await atomicJson(this.root, metaName, {}); throw installError('下载断点已失效，请重新尝试安装。') }
    if (response.status !== 200 && response.status !== 206) { await response.body?.cancel(); throw installError('模型下载未完成，请检查网络后重试。') }
    if (response.status === 200) offset = 0
    if (response.status === 206 && ((!chunked && offset === 0) || response.headers.get('content-range') !== `bytes ${offset}-${end}/${artifact.bytes}` || (etag !== undefined && response.headers.get('etag') !== etag))) {
      await response.body?.cancel(); await atomicJson(this.root, metaName, {}); throw installError('下载来源或断点发生变化，请重试。')
    }
    const length = response.headers.get('content-length')
    const expectedEnd = response.status === 206 ? end + 1 : artifact.bytes
    if ((length !== null && Number(length) !== expectedEnd - offset) || !response.body || (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity')) {
      await response.body?.cancel(); throw installError('模型下载长度与清单不一致。')
    }
    etag = strongETag(response.headers.get('etag')) ? response.headers.get('etag')! : undefined
    signal.throwIfAborted()
    const file = await open(await ownedPath(this.root, key + '.part'), offset ? 'r+' : 'w')
    let received = offset, checkpoint = offset
    const reader = response.body.getReader()
    let idleTimer:ReturnType<typeof setTimeout>|undefined
    try {
      // A crash may leave bytes after the last durable checkpoint. Keep them until
      // a valid response is available, then append only to the confirmed prefix.
      if (offset) await file.truncate(offset)
      progress(received)
      while (true) {
        requestSignal.throwIfAborted()
        const { done, value } = await Promise.race([reader.read(),new Promise<never>((_resolve,reject)=>{idleTimer=setTimeout(()=>reject(installError('模型下载长时间没有响应，请检查网络后重试。')),60000)})])
        clearTimeout(idleTimer)
        if (done) break
        if (received + value.byteLength > expectedEnd) throw installError('模型下载超出预期大小。')
        let written = 0
        while (written < value.byteLength) { const result = await file.write(value, written, value.byteLength - written, received + written); if (!result.bytesWritten) throw installError('无法写入模型下载文件。'); written += result.bytesWritten }
        received += value.byteLength
        if (received - checkpoint >= 4 * 1024 * 1024) {
          await file.sync(); await atomicJson(this.root, metaName, { sha256: key, bytes: artifact.bytes, received, etag }); checkpoint = received
        }
        progress(received)
      }
    } finally {
      clearTimeout(idleTimer);await reader.cancel().catch(() => {}); await file.sync().finally(() => file.close())
      await atomicJson(this.root, metaName, { sha256: key, bytes: artifact.bytes, received, etag })
    }
    signal.throwIfAborted()
    if (received !== expectedEnd) throw installError('模型下载未完整接收，请继续安装。')
    if (received < artifact.bytes) {
      if (!etag) throw installError('下载来源不支持可靠的分段续传。')
      return this.download(artifact, signal, progress)
    }
    if (!await fileMatches(part, artifact, signal)) { await atomicJson(this.root, metaName, {}); throw installError('模型文件校验未通过，请重试；已有资源保持原样。') }
    await ownedPath(this.root, key + '.part'); await ownedPath(this.root, key + '.asset')
    signal.throwIfAborted(); await rename(part, completed)
    return completed
  }
}
