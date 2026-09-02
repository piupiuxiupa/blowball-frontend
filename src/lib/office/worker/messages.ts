/**
 * Office engine worker protocol.
 *
 * Heavy engine models (docx ParsedDocFull with original bytes, pptx OpenedPptx
 * with the whole archive) live ONLY in the worker, keyed by handle. The main
 * thread receives serializable views (Block tree / RenderSlide trees) and sends
 * edit payloads back; the worker patches and returns new file bytes.
 */
import type { ParsedDoc, SaveBlock } from '@/vendor/genoffice/docx-engine'
import type { RenderSlide } from '@/vendor/genoffice/pptx-render'
import type { DrawableFontFace } from '../font-metrics'

// ── Errors (task 2.2) ───────────────────────────────────────────────────

export type OfficeEngineErrorCode =
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_PARTS'
  | 'PARSE_FAILED'
  | 'SAVE_FAILED'
  | 'TIMEOUT'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'

export interface OfficeEngineError {
  code: OfficeEngineErrorCode
  message: string
}

/** Hard caps — keep in sync with the backend's 50 MiB upload limit. */
export const OFFICE_ENGINE_LIMITS = {
  maxInputBytes: 50 * 1024 * 1024,
  maxParts: 10_000,
  /** Client-side parse deadline; the worker itself cannot be interrupted. */
  parseTimeoutMs: 30_000,
} as const

// ── pptx edit ops (closed lean-editor set, spec office-client-editors) ──

export interface EmuOffset {
  x: number
  y: number
  cx: number
  cy: number
}

export type PptxEditOp =
  | { op: 'move'; slideIndex: number; id: string; dxEmu: number; dyEmu: number }
  | { op: 'resize'; slideIndex: number; id: string; offset: EmuOffset }
  | { op: 'rotate'; slideIndex: number; id: string; deg: number }
  /** Plain-text lines; the shape's first-run formatting is preserved. */
  | { op: 'setText'; slideIndex: number; id: string; lines: string[] }
  | { op: 'delete'; slideIndex: number; id: string }
  | {
      op: 'addShape'
      slideIndex: number
      kind: 'rect' | 'roundedRect' | 'ellipse' | 'textbox'
      offset: EmuOffset
      fillColor?: string
      text?: string
    }
  | { op: 'addTable'; slideIndex: number; rows: number; cols: number; offset: EmuOffset }
  | {
      op: 'addPicture'
      slideIndex: number
      offset: EmuOffset
      bytes: Uint8Array
      ext: string
    }
  | { op: 'replacePicture'; slideIndex: number; id: string; bytes: Uint8Array; ext: string }
  | {
      op: 'setTableCellText'
      slideIndex: number
      id: string
      row: number
      col: number
      text: string
    }

// ── xlsx save model (neutral sheet data; Univer export maps into this) ──

export interface XlsxCellData {
  value?: string | number | boolean | null
  /** Formula without the leading '=', if any. */
  formula?: string
  bold?: boolean
  italic?: boolean
}

export interface XlsxSheetData {
  name: string
  /** rows[r][c]; missing rows/cells are empty. */
  rows: XlsxCellData[][]
}

// ── Requests / responses ────────────────────────────────────────────────

export type OfficeWorkerRequest =
  | { id: number; type: 'parse-docx'; bytes: Uint8Array }
  | { id: number; type: 'parse-pptx'; bytes: Uint8Array; fitWidthPx: number }
  | { id: number; type: 'save-docx'; handle: number; blocks: SaveBlock[] }
  | { id: number; type: 'save-pptx'; handle: number; edits: PptxEditOp[] }
  | { id: number; type: 'save-xlsx'; sheets: XlsxSheetData[] }
  | { id: number; type: 'dispose'; handle: number }

export interface DocxParseResult {
  /** Public ParsedDoc view (internal patch state stays in the worker). */
  doc: Omit<ParsedDoc, 'internal'>
  handle: number
}

export interface PptxParseResult {
  slides: RenderSlide[]
  size: { cx: number; cy: number }
  fontFaces: DrawableFontFace[]
  missingFonts: string[]
  handle: number
}

export interface SaveResult {
  bytes: Uint8Array
}

export type OfficeWorkerResponse =
  | ({ id: number; ok: true } & (
      | { result: DocxParseResult }
      | { result: PptxParseResult }
      | { result: SaveResult }
      | { result: null }
    ))
  | { id: number; ok: false; error: OfficeEngineError }
