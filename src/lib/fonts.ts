import { create } from 'zustand'

/**
 * Font registry for 3D text.
 *
 * Two sources feed the picker:
 *   - `FONTS` — the bundled faces, with hand-written metadata (`cjk`, `note`),
 *   - the fonts directory (`public/fonts/`) — auto-listed at startup through the
 *     dev server's `/__fonts` endpoint, so a local deployment can add a face by
 *     dropping the file in and reloading. No code edit required.
 *
 * The files live in `public/fonts/` so the editor never reaches for a CDN —
 * troika (drei's text renderer) parses whatever TTF/OTF/WOFF URL it is given,
 * and a missing network would otherwise leave empty glyphs on the stage.
 */

export interface FontOption {
  id: string
  name: string
  url: string
  note: string
  /** Whether the face carries CJK glyphs. */
  cjk: boolean
}

export const FONTS: FontOption[] = [
  {
    id: 'wenkai',
    name: '霞鹜文楷',
    url: '/fonts/LXGWWenKai-Regular.ttf',
    note: '中英文',
    cjk: true,
  },
  {
    id: 'dejavu',
    name: 'DejaVu Sans',
    url: '/fonts/DejaVuSans.ttf',
    note: '拉丁字母',
    cjk: false,
  },
  {
    id: 'dejavu-bold',
    name: 'DejaVu Sans Bold',
    url: '/fonts/DejaVuSans-Bold.ttf',
    note: '拉丁字母 · 粗体',
    cjk: false,
  },
]

export const DEFAULT_FONT_ID = 'wenkai'

export function findFont(fontId: string): FontOption {
  return FONTS.find((font) => font.id === fontId) ?? FONTS[0]
}

/** A face that can actually draw `content`; falls back to the CJK face. */
export function fontSupports(fontId: string, content: string): boolean {
  const font = findFont(fontId)
  if (font.cjk) return true
  return !/[\u3000-\u9fff\uff00-\uffef]/.test(content)
}

/* ------------------------------------------------------- discovered ---- */

/** Family names, mapped to a Chinese display name where the raw export is ugly. */
const FAMILY_NAMES: Array<[RegExp, string]> = [
  [/alibaba[_\s-]*puhuiti/i, '阿里巴巴普惠体'],
  [/alimama[_\s-]*dongfangdakai/i, '阿里妈妈东方大楷'],
  [/alimama[_\s-]*shuheiti/i, '阿里妈妈数黑体'],
  [/alimama[_\s-]*fangyuantivf/i, '阿里妈妈方圆体'],
  [/alimama[_\s-]*agilevf/i, '阿里妈妈灵动体'],
  [/dingtalk/i, '钉钉进步体'],
  [/gaoduanhei/i, '站酷高端黑'],
  [/zhankukuhei/i, '站酷酷黑'],
  [/pangmenzhengdao/i, '庞门正道标题体'],
  [/smileysans/i, '得意黑'],
  [/source[_\s-]*han[_\s-]*sans[_\s-]*sc/i, '思源黑体'],
  [/source[_\s-]*han[_\s-]*serif[_\s-]*sc/i, '思源宋体'],
]

const WEIGHT_NAMES: Array<[RegExp, string]> = [
  [/extrablack/i, '黑'],
  [/black/i, '黑'],
  [/heavy/i, '特粗'],
  [/extrabold/i, '特粗'],
  [/semibold|demibold/i, '半粗'],
  [/bold/i, '粗'],
  [/medium/i, '中'],
  [/regular|normal/i, '常规'],
  [/extralight/i, '特细'],
  [/light/i, '细'],
  [/thin/i, '细'],
]

/** A readable display name from a raw font file name. */
export function prettifyFontName(file: string): string {
  const stem = file.replace(/\.[^.]+$/, '')
  const flat = stem.replace(/[_\s-]+/g, '')
  const family = FAMILY_NAMES.find(([re]) => re.test(flat))?.[1]
  const weight = WEIGHT_NAMES.find(([re]) => re.test(flat))?.[1]
  if (family) return weight && weight !== '常规' ? `${family} ${weight}` : family
  return stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || file
}

interface FontCatalogState {
  discovered: FontOption[]
  setDiscovered: (fonts: FontOption[]) => void
}

/** Fonts auto-listed from `public/fonts/`, kept outside the store's undo history. */
export const useFontCatalog = create<FontCatalogState>((set) => ({
  discovered: [],
  setDiscovered: (discovered) => set({ discovered }),
}))

/** Fetch `/__fonts` and fold the result into the catalog. No-op without it. */
export function loadDiscoveredFonts(): void {
  fetch('/__fonts')
    .then((response) =>
      response.ok
        ? (response.json() as Promise<Array<{ file: string; name: string; url: string; size: number }>>)
        : [],
    )
    .then((list) => {
      const bundled = new Set(FONTS.map((font) => font.url))
      const discovered: FontOption[] = list
        .filter((entry) => !bundled.has(entry.url))
        .map((entry) => ({
          id: entry.file,
          name: prettifyFontName(entry.file),
          url: entry.url,
          // No size clutter in the picker — the name alone identifies the face.
          note: '',
          // The directory is where CJK faces live; assume yes unless a bundled
          // face says otherwise. A Latin-only face still works — this only
          // drives the advisory CJK hint.
          cjk: true,
        }))
      useFontCatalog.getState().setDiscovered(discovered)
    })
    .catch(() => {
      /* No endpoint (static deployment): the bundled fonts still work. */
    })
}
