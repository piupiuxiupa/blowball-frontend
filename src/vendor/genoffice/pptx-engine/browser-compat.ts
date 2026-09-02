/**
 * Browser replacements for the three Node APIs the upstream engine used
 * (node:zlib, node:crypto). Kept in one boundary module so vendored files only
 * change their imports — engine internals stay upstream.
 */
import { deflate } from 'pako'

/** node:zlib.deflateSync equivalent (zlib format, sync in main/worker thread). */
export function deflateSync(data: Uint8Array): Uint8Array {
  return deflate(data)
}

/** node:crypto.randomUUID equivalent with a non-crypto fallback for older contexts. */
export function randomUUID(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * node:crypto.createHash('sha256') equivalent. WebCrypto when available
 * (secure contexts + localhost); otherwise a deterministic non-crypto digest —
 * the hash is only used for archive identity, not security.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const g = globalThis as { crypto?: { subtle?: { digest?: (a: string, b: Uint8Array) => Promise<ArrayBuffer> } } }
  if (g.crypto?.subtle?.digest) {
    const buf = await g.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  // FNV-1a 32-bit, hex-padded — deterministic, non-crypto.
  let hash = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0').repeat(4)
}
