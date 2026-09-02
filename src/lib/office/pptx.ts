import './engine-polyfills'
/**
 * Pure browser adapter over the vendored GenOffice pptx engines.
 *
 * openPptx(bytes) is already a pure function (Uint8Array -> OpenedPptx); the
 * Electron app wrapped it with a main-process media resolver (Buffer base64,
 * system fonts, TIFF decode). This adapter provides the browser equivalents so
 * the whole parse -> RenderSlide pipeline runs in a Web Worker with no Node APIs:
 * - media: sync Blob object URLs (createObjectURL is synchronous)
 * - metrics: engine HeuristicMetrics by default
 * - TIFF decode / themed-SVG retint / EXIF neutralize: not applied (degradation)
 */
import { openPptx, type OpenedPptx } from '@/vendor/genoffice/pptx-engine'
import { buildRenderSlide, type RenderSlide } from '@/vendor/genoffice/pptx-render'
import { BrowserFontRegistry, type DrawableFontFace } from './font-metrics'

export interface ParsedPptx {
  /** Mutable deck model - editing ops mutate it; save re-serializes changed parts. */
  opened: OpenedPptx
  /** Prebuilt render trees, one per slide, laid out for fitWidthPx. */
  slides: RenderSlide[]
  size: { cx: number; cy: number }
  /** Embedded font faces the main thread should register for drawing. */
  fontFaces: DrawableFontFace[]
  /** Families the metrics provider had to estimate (UI badge). */
  missingFonts: string[]
}

/** Browser media resolver: archive path -> sync Blob object URL (cached per parse). */
export function makeMediaResolver(opened: OpenedPptx): (ref: string) => string | undefined {
  const cache = new Map<string, string | undefined>()
  return (mediaRef: string): string | undefined => {
    if (cache.has(mediaRef)) return cache.get(mediaRef)
    const bytes = opened.archive.readBytes(mediaRef)
    let url: string | undefined
    if (bytes) {
      const mime = guessMime(mediaRef)
      if (mime) {
        try {
          url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
        } catch {
          url = undefined
        }
      }
    }
    cache.set(mediaRef, url)
    return url
  }
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

function guessMime(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext]
}

/** Parse a pptx into the deck model + render trees. Pure: no Electron, no IPC. */
export async function parsePptx(bytes: Uint8Array, fitWidthPx: number): Promise<ParsedPptx> {
  const opened = await openPptx(bytes)
  const media = makeMediaResolver(opened)
  const registry = new BrowserFontRegistry()
  const fontFaces = registry.registerEmbedded(opened.archive)
  const metrics = registry.metrics()
  const slides = opened.deck.slides.map((slide, i) => {
    return buildRenderSlide(slide, opened.deck.size, {
      fitWidthPx,
      media,
      metrics,
      slideNo: i + 1,
    })
  })
  return {
    opened,
    slides,
    size: { cx: opened.deck.size.cx, cy: opened.deck.size.cy },
    fontFaces,
    missingFonts: [...registry.missing],
  }
}
