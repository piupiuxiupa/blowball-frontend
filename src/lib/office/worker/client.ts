/**
 * Main-thread RPC client for the office engine worker.
 * Bytes are transferred (not copied); promises resolve with serializable views.
 */
import type { SaveBlock } from '@/vendor/genoffice/docx-engine'
import {
  OFFICE_ENGINE_LIMITS,
  type DocxParseResult,
  type OfficeWorkerRequest,
  type OfficeWorkerResponse,
  type PptxEditOp,
  type PptxParseResult,
  type SaveResult,
  type XlsxSheetData,
} from './messages'

export class OfficeEngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

interface Pending {
  resolve: (r: OfficeWorkerResponse) => void
  reject: (e: OfficeEngineError) => void
  timer?: ReturnType<typeof setTimeout>
}

class OfficeEngineWorkerClient {
  private worker: Worker | null = null
  private seq = 1
  private readonly pending = new Map<number, Pending>()

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./office-engine.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.addEventListener('message', (event: MessageEvent<OfficeWorkerResponse>) => {
      const res = event.data
      const pending = this.pending.get(res.id)
      if (!pending) return
      this.pending.delete(res.id)
      if (pending.timer) clearTimeout(pending.timer)
      if (res.ok) pending.resolve(res)
      else pending.reject(new OfficeEngineError(res.error.code, res.error.message))
    })
    worker.addEventListener('error', (event) => {
      const err = new OfficeEngineError('PARSE_FAILED', event.message || '引擎线程崩溃')
      for (const pending of this.pending.values()) {
        if (pending.timer) clearTimeout(pending.timer)
        pending.reject(err)
      }
      this.pending.clear()
      this.worker?.terminate()
      this.worker = null
    })
    this.worker = worker
    return worker
  }

  private call<T>(
    build: (id: number) => OfficeWorkerRequest,
    extract: (r: OfficeWorkerResponse) => T,
    timeoutMs?: number,
  ): Promise<T> {
    const worker = this.ensureWorker()
    const id = this.seq++
    const req = build(id)
    const transfer: Transferable[] =
      req.type === 'parse-docx' || req.type === 'parse-pptx' ? [req.bytes.buffer] : []
    return new Promise<T>((resolve, reject) => {
      const pending: Pending = { resolve: (r) => resolve(extract(r)), reject }
      if (timeoutMs) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new OfficeEngineError('TIMEOUT', `解析超过 ${timeoutMs / 1000}s`))
        }, timeoutMs)
      }
      this.pending.set(id, pending)
      worker.postMessage(req, transfer)
    })
  }

  parseDocx(bytes: Uint8Array): Promise<DocxParseResult> {
    if (bytes.byteLength > OFFICE_ENGINE_LIMITS.maxInputBytes) {
      return Promise.reject(new OfficeEngineError('FILE_TOO_LARGE', '文件过大，请下载后本地打开'))
    }
    return this.call(
      (id) => ({ id, type: 'parse-docx', bytes }),
      (r) => (r as { result: DocxParseResult }).result,
      OFFICE_ENGINE_LIMITS.parseTimeoutMs,
    )
  }

  parsePptx(bytes: Uint8Array, fitWidthPx: number): Promise<PptxParseResult> {
    if (bytes.byteLength > OFFICE_ENGINE_LIMITS.maxInputBytes) {
      return Promise.reject(new OfficeEngineError('FILE_TOO_LARGE', '文件过大，请下载后本地打开'))
    }
    return this.call(
      (id) => ({ id, type: 'parse-pptx', bytes, fitWidthPx }),
      (r) => (r as { result: PptxParseResult }).result,
      OFFICE_ENGINE_LIMITS.parseTimeoutMs,
    )
  }

  saveDocx(handle: number, blocks: SaveBlock[]): Promise<Uint8Array> {
    return this.call(
      (id) => ({ id, type: 'save-docx', handle, blocks }),
      (r) => (r as { result: SaveResult }).result.bytes,
    )
  }

  savePptx(handle: number, edits: PptxEditOp[]): Promise<Uint8Array> {
    return this.call(
      (id) => ({ id, type: 'save-pptx', handle, edits }),
      (r) => (r as { result: SaveResult }).result.bytes,
    )
  }

  saveXlsx(sheets: XlsxSheetData[]): Promise<Uint8Array> {
    return this.call(
      (id) => ({ id, type: 'save-xlsx', sheets }),
      (r) => (r as { result: SaveResult }).result.bytes,
    )
  }

  dispose(handle: number): void {
    if (!this.worker) return
    const req: OfficeWorkerRequest = { id: this.seq++, type: 'dispose', handle }
    this.worker.postMessage(req)
  }
}

export const officeEngine = new OfficeEngineWorkerClient()
