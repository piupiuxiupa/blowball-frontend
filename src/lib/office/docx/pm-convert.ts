/**
 * Lean docx Block ↔ TipTap/ProseMirror conversion (proposal decision: lean editor).
 *
 * Mapping (subset):
 *   paragraph/heading/listItem → paragraph|heading + bullet/ordered list nesting
 *   table                      → TipTap table (cell text editable)
 *   image                      → inline image node (display attrs)
 *   passthrough                → read-only docxPassthrough leaf, byte-preserved on save
 *
 * Dirty rule (byte-preservation): a PM node with docxIndex whose text+marks
 * signature is unchanged maps to SaveBlock {kind:'original'} (bytes untouched);
 * anything changed/new is regenerated via engine generateParagraphXml /
 * generateTableModelXml, reusing the original rawPPr so unmodeled pPr survives.
 */
import type {
  Block,
  GenerateContext,
  ParsedDoc,
  Run,
  SaveBlock,
  TableCell,
  TableParagraph,
} from '@/vendor/genoffice/docx-engine'
import { generateParagraphXml, generateTableModelXml } from '@/vendor/genoffice/docx-engine'

// ProseMirror JSON node types (kept structural-clone friendly for worker use).
export interface PmInline {
  type: 'text'
  text: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

export interface PmNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PmNode[]
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  text?: string
}

const ALIGN_MAP: Record<string, string | undefined> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justify',
  distribute: 'justify',
  start: undefined,
  end: 'right',
}

const alignAttr = (block: Block): Record<string, unknown> | undefined => {
  const align = block.format?.align ? ALIGN_MAP[block.format.align] : undefined
  return align ? { textAlign: align } : undefined
}

function runsToInline(runs: Run[] | undefined): PmInline[] {
  const out: PmInline[] = []
  for (const run of runs ?? []) {
    if (!run.text) continue
    const marks: Array<{ type: string }> = []
    if (run.bold) marks.push({ type: 'bold' })
    if (run.italic) marks.push({ type: 'italic' })
    if (run.underline) marks.push({ type: 'underline' })
    out.push({ type: 'text', text: run.text, ...(marks.length ? { marks } : {}) })
  }
  return out
}

function paraNode(block: Block): PmNode {
  const attrs: Record<string, unknown> = {
    docxIndex: block.docxIndex,
    ...(alignAttr(block) ?? {}),
  }
  if (block.type === 'heading') {
    return {
      type: 'heading',
      attrs: { ...attrs, level: Math.min(block.level ?? 1, 6) },
      content: runsToInline(block.runs),
    }
  }
  return { type: 'paragraph', attrs, content: runsToInline(block.runs) }
}

/** Group consecutive listItems with the same numId into (nested) list nodes. */
function listNodes(blocks: Block[], start: number, end: number): { nodes: PmNode[]; next: number } {
  const first = blocks[start]!
  const kind = first.list?.kind === 'ordered' ? 'orderedList' : 'bulletList'
  const items: PmNode[] = []
  let i = start
  while (i < end) {
    const b = blocks[i]!
    if (b.type !== 'listItem' || b.list?.numId !== first.list?.numId) break
    const level = b.list?.ilvl ?? 0
    if (level === (first.list?.ilvl ?? 0)) {
      // Collect nested items (deeper level) as a nested list inside this item.
      const para: PmNode = {
        type: 'paragraph',
        attrs: { docxIndex: b.docxIndex, ...(alignAttr(b) ?? {}) },
        content: runsToInline(b.runs),
      }
      const nested = listNodes(blocks, i + 1, end)
      items.push({
        type: 'listItem',
        content: nested.nodes.length ? [para, ...nested.nodes] : [para],
      })
      i = nested.next
    } else if (level > (first.list?.ilvl ?? 0)) {
      // Shouldn't happen (deeper handled above); consume defensively.
      i++
    } else {
      break
    }
  }
  return { nodes: items.length ? [{ type: kind, content: items }] : [], next: i }
}

function cellNode(cell: TableCell): PmNode {
  const source = cell.richParas?.length
    ? cell.richParas
    : (cell.paras ?? []).map((text) => ({ runs: [{ text }] }) as TableParagraph)
  const paras: PmNode[] = source.map((p) => ({
    type: 'paragraph',
    attrs: { docxIndex: null },
    content: runsToInline(p.runs),
  }))
  return {
    type: 'tableCell',
    attrs: { colspan: cell.colSpan ?? 1, rowspan: 1 },
    content: paras.length ? paras : [{ type: 'paragraph' }],
  }
}

function tableNode(block: Block): PmNode {
  const model = block.table
  const rows: PmNode[] = (model?.rows ?? []).map(
    (row) =>
      ({
        type: 'tableRow',
        content: row.map(cellNode),
      }) as PmNode,
  )
  return {
    type: 'table',
    attrs: { docxIndex: block.docxIndex },
    content: rows.length
      ? rows
 : [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }],
  }
}

/** Convert the parsed Block tree to a TipTap document body. */
export function blocksToPmDoc(doc: Omit<ParsedDoc, 'internal'>): PmNode[] {
  const blocks = doc.blocks
  const nodes: PmNode[] = []
  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]!
    if (block.type === 'listItem') {
      const { nodes: list, next } = listNodes(blocks, i, blocks.length)
      nodes.push(...list)
      i = next
      continue
    }
    if (block.type === 'table' && block.table) {
      nodes.push(tableNode(block))
    } else if (block.type === 'image' && block.imageDataUrl) {
      nodes.push({
        type: 'paragraph',
        attrs: { docxIndex: block.docxIndex, textAlign: block.imageAlign ?? 'center' },
        content: [
          {
            type: 'image',
            attrs: {
              src: block.imageDataUrl,
              alt: block.label ?? 'image',
              width: block.imageWidthPx,
              height: block.imageHeightPx,
            },
          },
        ],
      })
    } else if (block.type === 'passthrough') {
      nodes.push({
        type: 'docxPassthrough',
        attrs: {
          docxIndex: block.docxIndex,
          label: block.label ?? '受保护内容',
          preview: block.previewText ?? '',
        },
      })
    } else {
      nodes.push(paraNode(block))
    }
    i++
  }
  // TipTap requires at least one node.
  return nodes.length ? nodes : [{ type: 'paragraph' }]
}

// ── Save direction ──────────────────────────────────────────────────────

function inlineToRuns(content: PmNode[] | undefined): Run[] {
  const runs: Run[] = []
  for (const node of content ?? []) {
    if (node.type !== 'text' || !node.text) continue
    const markTypes = new Set((node.marks ?? []).map((m) => m.type))
    runs.push({
      text: node.text,
      ...(markTypes.has('bold') ? { bold: true } : {}),
      ...(markTypes.has('italic') ? { italic: true } : {}),
      ...(markTypes.has('underline') ? { underline: true } : {}),
    })
  }
  return runs
}

export const plainTextOfRuns = (runs: Run[] | undefined): string =>
  (runs ?? []).map((r) => r.text).join('')

/** Structural signature: text + bold/italic/underline positions. */
function signatureOfRuns(runs: Run[] | undefined): string {
  return (runs ?? [])
    .map((r) => `${r.bold ? 'b' : ''}${r.italic ? 'i' : ''}${r.underline ? 'u' : ''}:${r.text}`)
    .join('|')
}

function signatureOfNode(node: PmNode): string {
  const parts: string[] = []
  const walk = (n: PmNode) => {
    if (n.type === 'text') {
      const marks = (n.marks ?? []).map((m) => m.type).sort().join('')
      parts.push(`${marks}:${n.text}`)
    } else {
      for (const child of n.content ?? []) walk(child)
    }
  }
  walk(node)
  return parts.join('|')
}

function nodeAlign(node: PmNode): Block['format'] | undefined {
  const align = node.attrs?.textAlign
  if (align === 'center') return { align: 'center' }
  if (align === 'right') return { align: 'right' }
  if (align === 'justify') return { align: 'justify' }
  return undefined
}

function generateContext(doc: Omit<ParsedDoc, 'internal'>): GenerateContext {
  const headingStyleIds = new Map<number, string>()
  for (const style of doc.styles.values()) {
    if (style.headingLevel && !headingStyleIds.has(style.headingLevel)) {
      headingStyleIds.set(style.headingLevel, style.styleId)
    }
  }
  return {
    headingStyleIds,
    allocateHyperlinkRel: () => {
      throw new Error('超链接编辑暂不支持')
    },
  }
}

/**
 * Convert the editor body back to SaveBlocks. Unchanged blocks (docxIndex set +
 * signature match) pass through byte-for-byte; changed/new blocks regenerate
 * OOXML, reusing rawPPr/bookmarks from the source block when it still exists.
 */
export function pmDocToSaveBlocks(
  body: PmNode[],
  doc: Omit<ParsedDoc, 'internal'>,
): SaveBlock[] {
  const ctx = generateContext(doc)
  const byIndex = new Map<number, Block>()
  for (const block of doc.blocks) {
    if (block.docxIndex != null) byIndex.set(block.docxIndex, block)
  }

  const flattenList = (node: PmNode, kind: 'bullet' | 'ordered', ilvl: number): SaveBlock[] => {
    const out: SaveBlock[] = []
    for (const item of node.content ?? []) {
      let first = true
      for (const child of item.content ?? []) {
        if (child.type === 'bulletList' || child.type === 'orderedList') {
          out.push(
            ...flattenList(child, child.type === 'orderedList' ? 'ordered' : 'bullet', ilvl + 1),
          )
        } else {
          const docxIndex = first ? (child.attrs?.docxIndex as number | null) : null
          const original = docxIndex != null ? byIndex.get(docxIndex) : undefined
          const listMeta = { kind, numId: original?.list?.numId ?? '1', ilvl }
          const runs = inlineToRuns(child.content)
          const unchanged =
            original &&
            original.type === 'listItem' &&
            signatureOfRuns(original.runs) === signatureOfNode(child)
          if (unchanged && original?.docxIndex != null) {
            out.push({ kind: 'original', docxIndex: original.docxIndex })
          } else {
            const gen = {
              type: 'listItem' as const,
              list: listMeta,
              ...(original ? { rawPPr: original.rawPPr } : {}),
              runs,
            }
            out.push({
              kind: 'xml',
              xml: generateParagraphXml(gen, ctx),
              ...(docxIndex != null ? { docxIndex } : {}),
            })
          }
          first = false
        }
      }
    }
    return out
  }

  const convertNode = (node: PmNode): SaveBlock[] => {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      return flattenList(node, node.type === 'orderedList' ? 'ordered' : 'bullet', 0)
    }
    if (node.type === 'docxPassthrough') {
      const idx = node.attrs?.docxIndex as number | null
      return idx != null ? [{ kind: 'original', docxIndex: idx }] : []
    }
    if (node.type === 'table') {
      const idx = node.attrs?.docxIndex as number | null
      const original = idx != null ? byIndex.get(idx) : undefined
      // Lean editor: table text edits regenerate the model XML from the PM grid.
      const model = original?.table
      if (!model) return idx != null ? [{ kind: 'original', docxIndex: idx }] : []
      const nextModel = {
        ...model,
        rows: (node.content ?? []).map((row) =>
          (row.content ?? []).map((cell) => ({
            paras: (cell.content ?? []).map((p) => plainTextOfRuns(inlineToRuns(p.content))),
            richParas: (cell.content ?? []).map((p) => ({ runs: inlineToRuns(p.content) })),
          })),
        ),
      }
      const changed =
        JSON.stringify(signatureOfTable(nextModel)) !==
        JSON.stringify(signatureOfTableModel(model))
      if (!changed) return [{ kind: 'original', docxIndex: idx! }]
      return [
        {
          kind: 'xml',
          xml: generateTableModelXml(nextModel, original?.originalXml ?? undefined),
          ...(idx != null ? { docxIndex: idx } : {}),
        },
      ]
    }

    // paragraph / heading (including image-only paragraphs).
    const docxIndex = node.attrs?.docxIndex as number | null
    const original = docxIndex != null ? byIndex.get(docxIndex) : undefined
    const runs = inlineToRuns(node.content)
    const isImage = (node.content ?? []).some((c) => c.type === 'image')
    const unchanged =
      original &&
      (original.type === 'paragraph' || original.type === 'heading') &&
      !isImage &&
      signatureOfRuns(original.runs) === signatureOfNode(node) &&
      JSON.stringify(alignAttr(original) ?? {}) === JSON.stringify(nodeAlign(node) ?? {})
    if (unchanged && original?.docxIndex != null) {
      return [{ kind: 'original', docxIndex: original.docxIndex }]
    }
    const hasImage = (node.content ?? []).some((c) => c.type === 'image')
    if (hasImage && original?.docxIndex != null) {
      // Image blocks: preserve unless the image itself is replaced (lean v1 keeps original).
      return [{ kind: 'original', docxIndex: original.docxIndex }]
    }
    const gen = {
      ...(node.type === 'heading'
        ? { type: 'heading' as const, level: (node.attrs?.level as number) ?? 1 }
        : { type: 'paragraph' as const }),
      ...(original ? { rawPPr: original.rawPPr } : {}),
      ...(nodeAlign(node) ?? {}),
      runs,
    }
    return [
      {
        kind: 'xml',
        xml: generateParagraphXml(gen, ctx),
        ...(docxIndex != null ? { docxIndex } : {}),
      },
    ]
  }

  return body.flatMap(convertNode)
}

function signatureOfTable(model: {
  rows: Array<Array<{ richParas?: Array<{ runs?: Run[] }>; paras?: string[] }>>
}): string {
  return JSON.stringify(
    model.rows.map((cells) =>
      cells.map((cell) =>
        cell.richParas
          ? cell.richParas.map((p) => plainTextOfRuns(p.runs))
          : (cell.paras ?? []),
      ),
    ),
  )
}

const signatureOfTableModel = signatureOfTable
