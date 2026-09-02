/// <reference lib="webworker" />
/**
 * Office engine worker — all parse/serialize work happens here (design D3).
 * Heavy models (ParsedDocFull / OpenedPptx) live only in this thread, keyed by
 * handle; the main thread gets serializable views and sends edits back.
 */
import ExcelJS from 'exceljs'
import { parseDocx, saveDocx } from '@/vendor/genoffice/docx-engine'
import type { ParsedDocFull, SaveBlock } from '@/vendor/genoffice/docx-engine'
import {
  addElement,
  addImageMediaAndRel,
  addPicture,
  addTable,
  deleteElement,
  savePptx,
  type OpenedPptx,
  type PictureElement,
  type Slide,
  type SlideElement,
  type TableElement,
  type TextElement,
} from '@/vendor/genoffice/pptx-engine'
import { parsePptx } from '../pptx'
import {
  OFFICE_ENGINE_LIMITS,
  type OfficeEngineErrorCode,
  type OfficeWorkerRequest,
  type OfficeWorkerResponse,
  type PptxEditOp,
  type XlsxSheetData,
} from './messages'

let nextHandle = 1
const docxDocs = new Map<number, ParsedDocFull>()
const pptxDecks = new Map<number, OpenedPptx>()

function fail(id: number, code: OfficeEngineErrorCode, message: string): OfficeWorkerResponse {
  return { id, ok: false, error: { code, message } }
}

self.addEventListener('message', (event: MessageEvent<OfficeWorkerRequest>) => {
  const req = event.data
  void handle(req).then(
    (response) => self.postMessage(response),
    (e: unknown) =>
      self.postMessage(
        fail(req.id, 'PARSE_FAILED', e instanceof Error ? e.message : String(e)),
      ),
  )
})

async function handle(req: OfficeWorkerRequest): Promise<OfficeWorkerResponse> {
  switch (req.type) {
    case 'parse-docx':
      return parseDocxRequest(req.id, req.bytes)
    case 'parse-pptx':
      return parsePptxRequest(req.id, req.bytes, req.fitWidthPx)
    case 'save-docx':
      return saveDocxRequest(req.id, req.handle, req.blocks)
    case 'save-pptx':
      return savePptxRequest(req.id, req.handle, req.edits)
    case 'save-xlsx':
      return saveXlsxRequest(req.id, req.sheets)
    case 'dispose': {
      docxDocs.delete(req.handle)
      pptxDecks.delete(req.handle)
      return { id: req.id, ok: true, result: null }
    }
  }
}

// ── docx ────────────────────────────────────────────────────────────────

async function parseDocxRequest(id: number, bytes: Uint8Array): Promise<OfficeWorkerResponse> {
  if (bytes.byteLength > OFFICE_ENGINE_LIMITS.maxInputBytes) {
    return fail(id, 'FILE_TOO_LARGE', '文件过大，请下载后本地打开')
  }
  try {
    const parsed = await parseDocx(bytes)
    const handle = nextHandle++
    docxDocs.set(handle, parsed)
    // internal (original bytes + documentXml) and extras stay worker-side.
    const { internal: _internal, extras: _extras, ...doc } = parsed
    return { id, ok: true, result: { doc, handle } }
  } catch (e) {
    return fail(id, 'PARSE_FAILED', e instanceof Error ? e.message : String(e))
  }
}

async function saveDocxRequest(
  id: number,
  handle: number,
  blocks: SaveBlock[],
): Promise<OfficeWorkerResponse> {
  const parsed = docxDocs.get(handle)
  if (!parsed) return fail(id, 'NOT_FOUND', '文档已失效，请重新打开')
  try {
    const bytes = await saveDocx(parsed, blocks)
    return { id, ok: true, result: { bytes } }
  } catch (e) {
    return fail(id, 'SAVE_FAILED', e instanceof Error ? e.message : String(e))
  }
}

// ── pptx ────────────────────────────────────────────────────────────────

async function parsePptxRequest(
  id: number,
  bytes: Uint8Array,
  fitWidthPx: number,
): Promise<OfficeWorkerResponse> {
  if (bytes.byteLength > OFFICE_ENGINE_LIMITS.maxInputBytes) {
    return fail(id, 'FILE_TOO_LARGE', '文件过大，请下载后本地打开')
  }
  try {
    const parsed = await parsePptx(bytes, fitWidthPx)
    const handle = nextHandle++
    pptxDecks.set(handle, parsed.opened)
    return {
      id,
      ok: true,
      result: {
        slides: parsed.slides,
        size: parsed.size,
        fontFaces: parsed.fontFaces,
        missingFonts: parsed.missingFonts,
        handle,
      },
    }
  } catch (e) {
    return fail(id, 'PARSE_FAILED', e instanceof Error ? e.message : String(e))
  }
}

async function savePptxRequest(
  id: number,
  handle: number,
  edits: PptxEditOp[],
): Promise<OfficeWorkerResponse> {
  const opened = pptxDecks.get(handle)
  if (!opened) return fail(id, 'NOT_FOUND', '演示文稿已失效，请重新打开')
  try {
    for (const edit of edits) applyPptxEdit(opened, edit)
    const bytes = await savePptx(opened)
    return { id, ok: true, result: { bytes } }
  } catch (e) {
    return fail(id, 'SAVE_FAILED', e instanceof Error ? e.message : String(e))
  }
}

function findElement(slide: Slide, id: string): SlideElement | undefined {
  const walk = (els: SlideElement[]): SlideElement | undefined => {
    for (const el of els) {
      if (el.id === id) return el
      if (el.type === 'group') {
        const hit = walk((el as unknown as { children?: SlideElement[] }).children ?? [])
        if (hit) return hit
      }
    }
    return undefined
  }
  return walk(slide.elements)
}

function requireElement(slide: Slide, id: string): SlideElement {
  const el = findElement(slide, id)
  if (!el) throw new Error(`元素 ${id} 不存在`)
  return el
}

function requireSlide(opened: OpenedPptx, index: number): Slide {
  const slide = opened.deck.slides[index]
  if (!slide) throw new Error(`幻灯片 ${index + 1} 不存在`)
  return slide
}

/** Apply one closed-set edit; throws on invalid targets (surfaced as SAVE_FAILED). */
function applyPptxEdit(opened: OpenedPptx, edit: PptxEditOp): void {
  if (edit.op === 'addTable') {
    const ok = addTable(opened, edit.slideIndex, {
      rows: edit.rows,
      cols: edit.cols,
      offset: edit.offset,
    })
    if (!ok) throw new Error('表格插入失败')
    return
  }

  const slide = requireSlide(opened, edit.slideIndex)
  switch (edit.op) {
    case 'move': {
      const el = requireElement(slide, edit.id)
      el.transform.offset.x += edit.dxEmu
      el.transform.offset.y += edit.dyEmu
      el.dirtyTransform = true
      return
    }
    case 'resize': {
      const el = requireElement(slide, edit.id)
      el.transform.offset = { ...edit.offset }
      el.dirtyTransform = true
      return
    }
    case 'rotate': {
      const el = requireElement(slide, edit.id)
      el.transform.rot = Math.round(edit.deg * 60000)
      el.dirtyTransform = true
      return
    }
    case 'setText': {
      const el = requireElement(slide, edit.id) as TextElement
      if (!el.text) throw new Error('该形状不含文本')
      const template = el.text.paragraphs[0]?.runs?.[0] ?? { text: '' }
      el.text.paragraphs = edit.lines.map((line) => ({
        runs: line ? [{ ...template, text: line }] : [],
      }))
      el.dirty = true
      return
    }
    case 'delete': {
      const ok = deleteElement(opened, slide, edit.id)
      if (!ok) throw new Error('未找到要删除的元素')
      return // deleteElement sets structureDirty
    }
    case 'addShape': {
      addElement(slide, {
        kind: edit.kind === 'textbox' ? 'textbox' : edit.kind,
        offset: edit.offset,
        ...(edit.fillColor ? { fillColor: edit.fillColor } : {}),
        ...(edit.text ? { paragraphs: [{ runs: [{ text: edit.text }] }] } : {}),
      })
      return // addElement sets structureDirty
    }
    case 'addPicture': {
      const pic = addPicture(opened, slide, {
        bytes: edit.bytes,
        ext: edit.ext,
        offset: edit.offset,
      })
      if (!pic) throw new Error('图片插入失败')
      return
    }
    case 'replacePicture': {
      const el = requireElement(slide, edit.id) as PictureElement
      const added = addImageMediaAndRel(opened, slide, edit.bytes, edit.ext)
      if (!added) throw new Error('图片替换失败')
      el.mediaRef = added.mediaPath
      el.dirty = true
      slide.structureDirty = true
      return
    }
    case 'setTableCellText': {
      const el = requireElement(slide, edit.id) as TableElement
      const cell = el.rows[edit.row]?.[edit.col]
      if (!cell) throw new Error('表格单元格不存在')
      const template = cell.text?.paragraphs[0]?.runs?.[0] ?? { text: '' }
      cell.text = {
        paragraphs: edit.text ? [{ runs: [{ ...template, text: edit.text }] }] : [],
      }
      el.dirty = true
      return
    }
  }
}

// ── xlsx (exceljs write; task 4.3 maps the Univer export into sheets) ──

async function saveXlsxRequest(id: number, sheets: XlsxSheetData[]): Promise<OfficeWorkerResponse> {
  try {
    const wb = new ExcelJS.Workbook()
    for (const sheet of sheets) {
      const ws = wb.addWorksheet(sheet.name)
      sheet.rows.forEach((row, r) => {
        row.forEach((cell, c) => {
          const target = ws.getRow(r + 1).getCell(c + 1)
          if (cell.formula) target.value = { formula: cell.formula }
          else if (cell.value !== undefined && cell.value !== null) target.value = cell.value
          if (cell.bold || cell.italic) {
            target.font = {
              ...(cell.bold ? { bold: true } : {}),
              ...(cell.italic ? { italic: true } : {}),
            }
          }
        })
      })
    }
    const buffer = await wb.xlsx.writeBuffer()
    return { id, ok: true, result: { bytes: new Uint8Array(buffer as ArrayBuffer) } }
  } catch (e) {
    return fail(id, 'SAVE_FAILED', e instanceof Error ? e.message : String(e))
  }
}
