/**
 * The element/sheet model — pure data, no renderer, no I/O.
 *
 * Points are canonical. A layout arrives with paper in any of the three
 * declared units; `parseLayout` converts it exactly once, rounds converted
 * values to four decimal places and stores a portrait/landscape-resolved
 * `{ unit: "pt", w, h }`. Everything downstream (notably `bodyBox`) therefore
 * sees points only, so a millimetre input and its point equivalent are
 * indistinguishable (A8, A19b).
 *
 * Geometry lives in the sheet's frame: after orientation. Every validation
 * failure uses the stable error type from `./errors.js`.
 */
import { fail } from './errors.js'

const MM_TO_PT = 72 / 25.4
const MIN_PAPER_PT = 72
const MAX_PAPER_PT = 14400
const DEFAULT_MARGIN_PT = 36
const MIN_BODY_PT = 72

/** Ten named sizes, in points, portrait (docs/design.md §3.1, catalog §3). */
export const PAPER_SIZES: Record<string, { w: number; h: number }> = {
  letter: { w: 612, h: 792 },
  legal: { w: 612, h: 1008 },
  tabloid: { w: 792, h: 1224 },
  executive: { w: 522, h: 756 },
  statement: { w: 396, h: 612 },
  a3: { w: 841.89, h: 1190.55 },
  a4: { w: 595.28, h: 841.89 },
  a5: { w: 419.53, h: 595.28 },
  a6: { w: 297.64, h: 419.53 },
  b5: { w: 498.9, h: 708.66 },
}

/** A named paper, or a custom size whose unit is resolved at parse. */
export type PaperSize =
  | keyof typeof PAPER_SIZES
  | { unit: 'pt' | 'mm' | 'in'; w: number; h: number }

export interface Margins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface Binding {
  edge: 'left' | 'right' | 'top' | 'bottom'
  gutter: number
  mirror: boolean
}

export interface SheetTypography {
  fontFamily?: string
  fontSize?: number
  lineHeight?: number
}

export interface Sheet {
  /** Canonical points after `parseLayout`; a name is accepted on input. */
  size: PaperSize
  orientation: 'portrait' | 'landscape'
  margins: Margins
  binding?: Binding
  fullBleed?: boolean
  bleed?: number | Margins
  bleedFallback?: 'trim' | 'none'
  cropMarks?: boolean
  cutMarks?: { axis: 'vertical' | 'horizontal'; at: number[]; style: 'hairline' | 'dashed' }
  duplex?: 'simplex' | 'duplex-long-edge' | 'duplex-short-edge'
  imposition?: 'none' | 'n-up-2' | 'n-up-4' | 'booklet'
  scale?: number
  typography?: SheetTypography
  /** Height reserved from the body by running furniture (points). */
  header?: { height: number }
  footer?: { height: number }
}

export type ElementKind =
  | 'text'
  | 'line'
  | 'rect'
  | 'image'
  | 'table'
  | 'figure'
  | 'header'
  | 'footer'
  | 'pageNumber'
  | 'date'
  | 'watermark'
  | 'section'
  | 'signature'

/** Geometry shared by every placed thing (points, sheet frame). */
export interface ElementGeometry {
  x?: number
  y?: number
  w?: number
  h?: number
}

export interface TextElement extends ElementGeometry {
  kind: 'text'
  id?: string
  text?: string
  expr?: string
  format?: 'currency' | 'number' | 'date'
  align?: 'left' | 'center' | 'right' | 'justify'
  size?: number
  bold?: boolean
  italic?: boolean
}

export interface LineElement extends ElementGeometry {
  kind: 'line'
  id?: string
  direction?: 'horizontal' | 'vertical' | 'diagonal'
}

export interface RectElement extends ElementGeometry {
  kind: 'rect'
  id?: string
}

export interface ImageElement extends ElementGeometry {
  kind: 'image'
  id?: string
  src?: string
  svg?: string
  alt?: string
  maxHeight?: number
  monochrome?: boolean
}

export interface TableElement extends ElementGeometry {
  kind: 'table'
  id?: string
  columns?: unknown[]
  rows?: unknown[]
  repeatHeader?: boolean
  keepTogether?: boolean
}

export interface FigureElement extends ElementGeometry {
  kind: 'figure'
  id?: string
  series?: unknown[]
  title?: string
  desc?: string
  fallback?: boolean
}

export interface FurnitureElement extends ElementGeometry {
  kind: 'header' | 'footer' | 'pageNumber' | 'date' | 'watermark' | 'section' | 'signature'
  id?: string
  zones?: { left?: string; center?: string; right?: string }
  rule?: boolean
  repeat?: 'all' | 'notFirst' | 'none' | boolean
  origin?: 'first' | 'content'
  firstPage?: 'show' | 'hide'
  startAt?: number
  scope?: 'document' | 'section'
  restart?: boolean
  style?: 'arabic' | 'roman-lower' | 'roman-upper'
  total?: boolean
  format?: string
  dateKind?: 'issued' | 'captured'
  timezone?: string
  angle?: number
  opacity?: number
  pages?: 'all' | 'first' | 'body'
  mode?: 'screen' | 'print' | 'both'
  level?: 1 | 2 | 3
  title?: string
  breakBefore?: boolean
  startOn?: 'any' | 'recto'
}

export type Element =
  | TextElement
  | LineElement
  | RectElement
  | ImageElement
  | TableElement
  | FigureElement
  | FurnitureElement

export interface Band {
  id?: string
  height?: number
  elements: Element[]
  repeat?: boolean
}

export interface Layout {
  sheet: Sheet
  bands: Band[]
  panels?: unknown[]
}

const ELEMENT_KINDS: readonly ElementKind[] = [
  'text', 'line', 'rect', 'image', 'table', 'figure',
  'header', 'footer', 'pageNumber', 'date', 'watermark', 'section', 'signature',
]

/** Kinds whose placement is meaningless without all four coordinates. */
const FULL_GEOMETRY_KINDS: readonly ElementKind[] = [
  'text', 'line', 'rect', 'image', 'table', 'figure', 'signature',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** One rounding point, applied to every converted value before it is stored. */
function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

function toPoints(value: number, unit: 'pt' | 'mm' | 'in'): number {
  if (unit === 'in') return value * 72
  if (unit === 'mm') return value * MM_TO_PT
  return value
}

function paperNames(): string {
  return Object.keys(PAPER_SIZES).join(', ')
}

/**
 * Resolve a paper input to canonical portrait points. Named sizes are looked
 * up verbatim; custom sizes are converted, rounded and range-checked here and
 * nowhere else. A suspected unit slip is refused with the likely unit named.
 */
function resolvePaperSize(raw: unknown): { w: number; h: number } {
  if (typeof raw === 'string') {
    const dims = PAPER_SIZES[raw]
    if (!dims) {
      fail(
        'E_PAPER',
        `unknown paper size "${raw}"`,
        `valid names: ${paperNames()}. Or pass {unit, w, h} for a custom size.`,
        { size: raw, validNames: Object.keys(PAPER_SIZES) },
      )
    }
    return { w: round4(dims.w), h: round4(dims.h) }
  }

  if (!isRecord(raw)) {
    fail(
      'E_PAPER',
      'paper size must be a name or a {unit, w, h} object',
      `valid names: ${paperNames()}.`,
      { size: raw },
    )
  }

  const unit = raw.unit
  if (unit !== 'pt' && unit !== 'mm' && unit !== 'in') {
    fail(
      'E_PAPER',
      `unknown paper unit "${String(unit)}"`,
      'unit must be "pt", "mm" or "in".',
      { unit },
    )
  }

  const w = raw.w
  const h = raw.h
  if (!isFiniteNumber(w) || !isFiniteNumber(h) || w <= 0 || h <= 0) {
    fail(
      'E_PAPER',
      'custom paper needs positive numeric w and h',
      'pass {unit: "pt" | "mm" | "in", w, h} with numbers greater than zero.',
      { w, h },
    )
  }

  // A pt-sized page declared in millimetres prints ~24in wide. The bounds
  // alone would not catch it, so reject implausible millimetre inputs too.
  if (unit === 'mm' && (w > 500 || h > 500)) {
    fail(
      'E_PAPER',
      `custom size ${w} × ${h} mm looks like a point-size typo`,
      'did you mean unit: "pt"? Those numbers match a page size in points.',
      { unit, w, h },
    )
  }

  const wp = round4(toPoints(w, unit))
  const hp = round4(toPoints(h, unit))
  if (wp < MIN_PAPER_PT || wp > MAX_PAPER_PT || hp < MIN_PAPER_PT || hp > MAX_PAPER_PT) {
    const smallSide = unit === 'pt' && (wp < MIN_PAPER_PT || hp < MIN_PAPER_PT)
    fail(
      'E_PAPER',
      `custom paper ${wp} × ${hp} pt is outside ${MIN_PAPER_PT}–${MAX_PAPER_PT} pt`,
      smallSide
        ? 'did you mean unit: "in"? Inches are converted by × 72 at parse.'
        : `each side must be between ${MIN_PAPER_PT} and ${MAX_PAPER_PT} pt.`,
      { unit, w, h, wPt: wp, hPt: hp },
    )
  }

  return { w: wp, h: hp }
}

function normalizeMargins(raw: unknown): Margins {
  if (raw === undefined || raw === null) {
    return { top: DEFAULT_MARGIN_PT, right: DEFAULT_MARGIN_PT, bottom: DEFAULT_MARGIN_PT, left: DEFAULT_MARGIN_PT }
  }
  if (isFiniteNumber(raw)) {
    if (raw < 0) fail('E_LAYOUT', 'sheet.margins cannot be negative', 'use a number ≥ 0.', { margins: raw })
    return { top: raw, right: raw, bottom: raw, left: raw }
  }
  if (!isRecord(raw)) {
    fail('E_LAYOUT', 'sheet.margins must be a number or {top, right, bottom, left}', 'margins are points in the sheet frame.', { margins: raw })
  }
  const margin = (side: 'top' | 'right' | 'bottom' | 'left'): number => {
    const value = raw[side] === undefined ? DEFAULT_MARGIN_PT : raw[side]
    if (!isFiniteNumber(value) || value < 0) {
      fail('E_LAYOUT', `sheet.margins.${side} must be a finite number ≥ 0`, `got ${String(value)}.`, { side, value })
    }
    return value
  }
  return { top: margin('top'), right: margin('right'), bottom: margin('bottom'), left: margin('left') }
}

function normalizeBinding(raw: unknown): Binding | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isRecord(raw)) {
    fail('E_LAYOUT', 'sheet.binding must be {edge, gutter, mirror}', 'edge is left | right | top | bottom.', { binding: raw })
  }
  const edge = raw.edge
  const gutter = raw.gutter === undefined ? 0 : raw.gutter
  if (!isFiniteNumber(gutter) || gutter < 0) {
    fail('E_LAYOUT', 'binding.gutter must be a finite number ≥ 0', 'the gutter comes out of the body, in points.', { gutter })
  }
  if (edge !== 'left' && edge !== 'right' && edge !== 'top' && edge !== 'bottom') {
    fail(
      'E_BINDING',
      'a gutter needs a binding edge',
      'set binding.edge to left, right, top or bottom.',
      { edge, gutter },
    )
  }
  return { edge, gutter, mirror: raw.mirror === true }
}

function normalizeFurnitureHeight(raw: unknown, which: 'header' | 'footer'): { height: number } | undefined {
  if (raw === undefined || raw === null) return undefined
  const height = isFiniteNumber(raw) ? raw : isRecord(raw) ? (raw.height ?? 0) : undefined
  if (!isFiniteNumber(height) || height < 0) {
    fail('E_LAYOUT', `sheet.${which} height must be a finite number ≥ 0`, `got ${String(raw)}.`, { which, value: raw })
  }
  return { height }
}

function validateSheetExtras(raw: Record<string, unknown>): void {
  if (raw.fullBleed !== undefined && typeof raw.fullBleed !== 'boolean') {
    fail('E_LAYOUT', 'sheet.fullBleed must be a boolean', 'true asserts the design paints to the trim.', { value: raw.fullBleed })
  }
  if (raw.bleed !== undefined) {
    const bleed = raw.bleed
    const numberOk = isFiniteNumber(bleed) && bleed >= 0
    const sidesOk = isRecord(bleed) && ['top', 'right', 'bottom', 'left'].every((side) => {
      const value = bleed[side]
      return isFiniteNumber(value) && value >= 0
    })
    if (!numberOk && !sidesOk) {
      fail('E_LAYOUT', 'sheet.bleed must be a number ≥ 0 or {top, right, bottom, left}', 'bleed is measured past the trim, in points.', { bleed })
    }
  }
  if (raw.bleedFallback !== undefined && raw.bleedFallback !== 'trim' && raw.bleedFallback !== 'none') {
    fail('E_LAYOUT', 'sheet.bleedFallback must be "trim" or "none"', 'trim extends paint; none refuses.', { value: raw.bleedFallback })
  }
  if (raw.duplex !== undefined && !['simplex', 'duplex-long-edge', 'duplex-short-edge'].includes(String(raw.duplex))) {
    fail('E_LAYOUT', 'sheet.duplex is not a recognised value', 'use simplex, duplex-long-edge or duplex-short-edge.', { value: raw.duplex })
  }
  if (raw.imposition !== undefined && !['none', 'n-up-2', 'n-up-4', 'booklet'].includes(String(raw.imposition))) {
    fail('E_LAYOUT', 'sheet.imposition is not a recognised value', 'use none, n-up-2, n-up-4 or booklet.', { value: raw.imposition })
  }
  if (raw.scale !== undefined && (!isFiniteNumber(raw.scale) || raw.scale <= 0)) {
    fail('E_LAYOUT', 'sheet.scale must be a finite number > 0', 'a fixed layout must use 1.', { scale: raw.scale })
  }
  if (raw.typography !== undefined) {
    if (!isRecord(raw.typography)) {
      fail('E_LAYOUT', 'sheet.typography must be an object', 'use {fontFamily, fontSize, lineHeight}.', { value: raw.typography })
    }
    const t = raw.typography
    if (t.fontFamily !== undefined && typeof t.fontFamily !== 'string') {
      fail('E_LAYOUT', 'typography.fontFamily must be a string', 'name a declared type token.', { value: t.fontFamily })
    }
    for (const key of ['fontSize', 'lineHeight'] as const) {
      if (t[key] !== undefined && (!isFiniteNumber(t[key]) || (t[key] as number) <= 0)) {
        fail('E_LAYOUT', `typography.${key} must be a finite number > 0`, 'tokens are declared by sure-ui.', { key, value: t[key] })
      }
    }
  }
}

function normalizeElement(raw: unknown, path: string): Element {
  if (!isRecord(raw)) {
    fail('E_LAYOUT', `${path}: element must be an object`, 'every element needs at least a kind.', { path, value: raw })
  }
  const kind = raw.kind
  if (typeof kind !== 'string') {
    fail('E_LAYOUT', `${path}: element needs a kind`, 'use one of the declared element kinds.', { path })
  }
  if (!ELEMENT_KINDS.includes(kind as ElementKind)) {
    fail(
      'E_ELEMENT',
      `${path}: unsupported element kind "${kind}"`,
      `supported kinds: ${ELEMENT_KINDS.join(', ')}.`,
      { path, kind },
    )
  }

  const geometry: Record<string, number> = {}
  for (const field of ['x', 'y', 'w', 'h'] as const) {
    const value = raw[field]
    if (value === undefined) continue
    if (!isFiniteNumber(value)) {
      fail('E_LAYOUT', `${path}.${field} must be a finite number`, 'geometry is in points, in the sheet frame.', { path, field, value })
    }
    if ((field === 'w' || field === 'h') && value < 0) {
      fail('E_LAYOUT', `${path}.${field} must be non-negative`, 'a box cannot have a negative extent.', { path, field, value })
    }
    geometry[field] = value
  }
  if (FULL_GEOMETRY_KINDS.includes(kind as ElementKind)) {
    for (const field of ['x', 'y', 'w', 'h'] as const) {
      if (!(field in geometry)) {
        fail('E_LAYOUT', `${path}: a ${kind} element needs ${field}`, 'fixed geometry is four numbers: x, y, w, h.', { path, kind, field })
      }
    }
  }

  return { ...raw, ...geometry } as unknown as Element
}

function normalizeBands(raw: unknown): Band[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    fail('E_LAYOUT', 'layout.bands must be an array', 'a layout is {sheet, bands: []}.', { bands: raw })
  }
  return raw.map((band, index) => {
    const path = `bands[${index}]`
    if (!isRecord(band)) {
      fail('E_LAYOUT', `${path}: band must be an object`, 'a band is {height?, elements: []}.', { path, value: band })
    }
    if (!Array.isArray(band.elements)) {
      fail('E_LAYOUT', `${path}.elements must be an array`, 'provide elements: [] (an array of element objects).', { path, elements: band.elements })
    }
    const result: Band = {
      elements: band.elements.map((element, i) => normalizeElement(element, `${path}.elements[${i}]`)),
    }
    if (typeof band.id === 'string') result.id = band.id
    if (band.height !== undefined) {
      if (!isFiniteNumber(band.height) || band.height < 0) {
        fail('E_LAYOUT', `${path}.height must be a finite number ≥ 0`, 'band height is measured in points.', { path, height: band.height })
      }
      result.height = band.height
    }
    if (band.repeat !== undefined) {
      if (typeof band.repeat !== 'boolean') {
        fail('E_LAYOUT', `${path}.repeat must be a boolean`, 'repeat says whether the band lands on every sheet.', { path, repeat: band.repeat })
      }
      result.repeat = band.repeat
    }
    return result
  })
}

/**
 * Resolve the dimensions of a sheet in its own frame (after orientation).
 * A canonical `{unit: "pt"}` size produced by `parseLayout` is already
 * oriented; names and mm/in inputs are portrait and are rotated here.
 */
function sheetFrame(sheet: Sheet): { w: number; h: number } {
  const size = sheet.size
  if (typeof size === 'string') {
    const dims = PAPER_SIZES[size]
    if (!dims) fail('E_PAPER', `unknown paper size "${size}"`, `valid names: ${paperNames()}.`, { size })
    return sheet.orientation === 'landscape'
      ? { w: round4(dims.h), h: round4(dims.w) }
      : { w: round4(dims.w), h: round4(dims.h) }
  }
  const wp = round4(toPoints(size.w, size.unit))
  const hp = round4(toPoints(size.h, size.unit))
  if (sheet.orientation === 'landscape' && size.unit !== 'pt') return { w: hp, h: wp }
  return { w: wp, h: hp }
}

/** The printable body: sheet − margins − gutter − header − footer (catalog §3). */
export function bodyBox(sheet: Sheet): { width: number; height: number; x: number; y: number } {
  const frame = sheetFrame(sheet)
  const gutter = sheet.binding?.gutter ?? 0
  const edge = sheet.binding?.edge
  const headerH = sheet.header?.height ?? 0
  const footerH = sheet.footer?.height ?? 0
  const gutterX = edge === 'left' || edge === 'right' ? gutter : 0
  const gutterY = edge === 'top' || edge === 'bottom' ? gutter : 0
  const x = sheet.margins.left + (edge === 'left' ? gutter : 0)
  const y = sheet.margins.top + (edge === 'top' ? gutter : 0) + headerH
  return {
    width: round4(frame.w - sheet.margins.left - sheet.margins.right - gutterX),
    height: round4(frame.h - sheet.margins.top - sheet.margins.bottom - gutterY - headerH - footerH),
    x: round4(x),
    y: round4(y),
  }
}

/**
 * Normalize and validate a layout. Units are converted once, landscape is
 * applied to the stored dimensions, and malformed data fails closed with a
 * stable error code. The result is a fresh object: no caller state is mutated.
 */
export function parseLayout(input: unknown): Layout {
  if (!isRecord(input)) {
    fail('E_LAYOUT', 'layout must be an object', 'pass {sheet, bands: []}.', { value: input })
  }
  const rawSheet = input.sheet
  if (!isRecord(rawSheet)) {
    fail('E_LAYOUT', 'layout.sheet must be an object', 'a layout needs a sheet.', { value: rawSheet })
  }

  // Fixed is the default: a form's boxes must print at 1:1 unless the caller
  // explicitly declares a flow layout, which may scale after pagination.
  const mode = input.mode === 'flow' ? 'flow' : 'fixed'

  const dims = resolvePaperSize(rawSheet.size === undefined ? 'letter' : rawSheet.size)
  const orientation = rawSheet.orientation === 'landscape' ? 'landscape' : 'portrait'
  const size: PaperSize = orientation === 'landscape'
    ? { unit: 'pt', w: dims.h, h: dims.w }
    : { unit: 'pt', w: dims.w, h: dims.h }

  const sheet: Sheet = {
    size,
    orientation,
    margins: normalizeMargins(rawSheet.margins),
  }
  const binding = normalizeBinding(rawSheet.binding)
  if (binding) sheet.binding = binding
  if (rawSheet.fullBleed !== undefined) sheet.fullBleed = rawSheet.fullBleed === true
  if (rawSheet.bleed !== undefined) sheet.bleed = rawSheet.bleed as Sheet['bleed']
  if (rawSheet.bleedFallback !== undefined) sheet.bleedFallback = rawSheet.bleedFallback as Sheet['bleedFallback']
  if (rawSheet.duplex !== undefined) sheet.duplex = rawSheet.duplex as Sheet['duplex']
  if (rawSheet.imposition !== undefined) sheet.imposition = rawSheet.imposition as Sheet['imposition']
  sheet.scale = rawSheet.scale === undefined ? 1 : (rawSheet.scale as number)
  if (rawSheet.typography !== undefined) sheet.typography = rawSheet.typography as SheetTypography
  const header = normalizeFurnitureHeight(rawSheet.header, 'header')
  if (header) sheet.header = header
  const footer = normalizeFurnitureHeight(rawSheet.footer, 'footer')
  if (footer) sheet.footer = footer
  validateSheetExtras(rawSheet)

  const bands = normalizeBands(input.bands)
  const layout: Layout = { sheet, bands }
  if (Array.isArray(input.panels)) layout.panels = input.panels

  const body = bodyBox(sheet)
  if (body.width < MIN_BODY_PT || body.height < MIN_BODY_PT) {
    fail(
      'E_BINDING',
      `body box ${body.width} × ${body.height} pt is smaller than ${MIN_BODY_PT} pt`,
      'reduce the gutter, header or footer, or use a larger sheet.',
      { width: body.width, height: body.height },
    )
  }
  if (mode === 'fixed' && sheet.scale !== 1) {
    fail(
      'E_SCALE',
      `a fixed layout cannot use scale ${String(sheet.scale)}`,
      'print 1:1 with scale: 1; scaling moves boxes a customer signed.',
      { scale: sheet.scale },
    )
  }

  return layout
}
