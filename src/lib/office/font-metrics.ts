import './engine-polyfills'
/**
 * Browser font metrics for the pptx engine.
 *
 * Strategy (design D5): document-embedded fonts first (extracted from the
 * archive as sfnt bytes, parsed with opentype.js for exact metrics and exposed
 * as FontFace descriptors for drawing), then a bundled font subset, then the
 * engine's deterministic HeuristicMetrics. Missing families are tracked so the
 * UI can badge "字体缺失".
 *
 * Bundled subset: `src/assets/office-fonts/*.ttf|otf` are picked up via glob.
 * The directory starts empty (budget <=15MB); add files without code changes.
 */
import { parse as parseFont } from 'opentype.js'
import {
  OpentypeMetrics,
  type FontMetricsProvider,
  type OpentypeFontLike,
  type RunStyle,
} from '@/vendor/genoffice/pptx-render'
import {
  listEmbeddedFonts,
  type EmbeddedFontFace,
} from '@/vendor/genoffice/pptx-engine/embedded-fonts'
import type { PackageArchive } from '@/vendor/genoffice/pptx-engine/zip'

type Style = 'regular' | 'bold' | 'italic' | 'boldItalic'

const fontKey = (family: string, style: Style): string => `${family.toLowerCase()}|${style}`

const styleOf = (bold: boolean, italic: boolean): Style =>
  bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular'

/** A font ready for drawing (main thread registers it via document.fonts.add). */
export interface DrawableFontFace {
  family: string
  style: Style
  /** sfnt bytes for `new FontFace(family, bytes)` + opentype.js metrics. */
  sfnt: Uint8Array
}

export class BrowserFontRegistry {
  private readonly fonts = new Map<string, OpentypeFontLike>()
  /** Families requested but not backed by any registered face (drives UI badge). */
  readonly missing = new Set<string>()

  addFace(family: string, style: Style, font: OpentypeFontLike): void {
    this.fonts.set(fontKey(family, style), font)
  }

  /** Parse + register one sfnt; returns false when the bytes are not a usable font. */
  addSfnt(family: string, style: Style, sfnt: Uint8Array): boolean {
    try {
      // opentype.parse needs an ArrayBuffer at offset 0.
      const copy = sfnt.slice()
      const font = parseFont(copy.buffer as ArrayBuffer)
      this.addFace(family, style, font as unknown as OpentypeFontLike)
      return true
    } catch {
      return false
    }
  }

  /** Register a deck's embedded faces (exact metrics + FontFace sources). */
  registerEmbedded(archive: PackageArchive): DrawableFontFace[] {
    const drawable: DrawableFontFace[] = []
    const faces = listEmbeddedFonts(archive) as EmbeddedFontFace[]
    for (const face of faces) {
      if (this.addSfnt(face.typeface, face.style, face.sfnt)) {
        drawable.push({ family: face.typeface, style: face.style, sfnt: face.sfnt })
      }
    }
    return drawable
  }

  private resolve(style: RunStyle): OpentypeFontLike | undefined {
    const family = style.fontFamily
    const exact = this.fonts.get(fontKey(family, styleOf(style.bold, style.italic)))
    const regular = this.fonts.get(fontKey(family, 'regular'))
    const font = exact ?? regular
    if (!font) {
      this.missing.add(family)
      return undefined
    }
    return font
  }

  metrics(): FontMetricsProvider {
    return new OpentypeMetrics((style) => this.resolve(style))
  }
}

// ── Bundled font subset ─────────────────────────────────────────────────

const BUNDLED_FONT_URLS = import.meta.glob<string>('../../assets/office-fonts/*.{ttf,otf}', {
  query: '?url',
  import: 'default',
  eager: true,
})

/** File name convention: `FamilyName-regular.ttf` / `FamilyName-boldItalic.otf`. */
function bundledStyle(fileName: string): Style {
  const stem = fileName.replace(/\.(ttf|otf)$/i, '')
  if (stem.endsWith('-boldItalic')) return 'boldItalic'
  if (stem.endsWith('-bold')) return 'bold'
  if (stem.endsWith('-italic')) return 'italic'
  return 'regular'
}

/** Load the bundled subset into a registry; no-op while the directory is empty. */
export async function loadBundledFonts(registry: BrowserFontRegistry): Promise<void> {
  await Promise.all(
    Object.entries(BUNDLED_FONT_URLS).map(async ([path, url]) => {
      try {
        const res = await fetch(url)
        if (!res.ok) return
        const bytes = new Uint8Array(await res.arrayBuffer())
        const fileName = path.split('/').pop() ?? ''
        const family = fileName
          .replace(/\.(ttf|otf)$/i, '')
          .replace(/-(regular|bold|italic|boldItalic)$/, '')
        registry.addSfnt(family, bundledStyle(fileName), bytes)
      } catch {
        // A broken bundled font must never block parsing.
      }
    }),
  )
}
