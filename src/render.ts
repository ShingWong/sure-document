/**
 * Phase 4 — the fixed-mode renderer.
 *
 * Layout + rows → one HTML string per physical sheet. The paint tree is flat
 * (`design §9.3`): every sheet is a top-level `<section>` sibling, never a
 * block nested in the previous sheet. Geometry is absolute, in points, in the
 * sheet frame; nothing is measured or reflowed here beyond the one fail-closed
 * check that a table row fits the printable body (A33).
 *
 * Pure and dependency-free: no DOM, clock, `Intl`, locale, network or dynamic
 * code. Every value comes from the caller and every pattern from the layout,
 * so a reprint is byte-identical (A8, A9, A17). The only classes emitted are
 * the ones the installed sure-ui 0.3.6 `document`/`figure` blocks and the
 * `table` block declare (`docs/catalog.md §2`) — this file never invents one.
 */
import {
  parseLayout,
  bodyBox,
  PAPER_SIZES,
  type Layout,
  type Sheet,
  type Element,
  type Band,
  type PaperSize,
  type TextElement,
} from './layout.js'
import {
  evaluate,
  formatCurrency,
  formatNumber,
  formatDate,
  createMeasurementOracle,
  type MeasurementOracle,
} from './format.js'
import { fail, DocumentError, type ErrorCode } from './errors.js'

// ---------------------------------------------------------------------------
// Public input/output shapes
// ---------------------------------------------------------------------------

/** The caller-supplied snapshot. Dates are values, never the clock (§10). */
export interface RenderData {
  params?: Record<string, unknown>
  rows?: Record<string, unknown>[]
  capturedAt?: string
}

export interface RenderInput {
  layout: unknown
  data?: RenderData
  oracle?: MeasurementOracle
}

export interface RenderResult {
  /** One HTML string per physical sheet, flat siblings (design §9.3). */
  sheets: string[]
  /** The whole document: one global `<style>` plus the sheet siblings. */
  html: string
  /** `sheets.length` — a fact of the design, not a guess. */
  sheetCount: number
}

interface RenderCtx {
  params: Record<string, unknown>
  row: Record<string, unknown> | undefined
  dataRows: Record<string, unknown>[]
  capturedAt: string | undefined
}

// ---------------------------------------------------------------------------
// Constants — all documented patterns/knobs, nothing invented
// ---------------------------------------------------------------------------

/** The three declared patterns from `design §6`. A layout may override with `pattern`. */
const DEFAULT_PATTERNS = {
  currency: '¤ #,##0.00',
  number: '###0.00',
  date: 'MM/dd/yyyy',
} as const

/** sure-ui's screen-only gap between sheets. */
const SHEET_GAP = '2rem'
const WATERMARK_MAX_OPACITY = 0.15

/** Sheet furniture is hoisted out of bands and repeated per sheet (§4). */
const FURNITURE_KINDS = ['header', 'footer', 'pageNumber', 'date', 'watermark'] as const
type FurnitureKind = (typeof FURNITURE_KINDS)[number]

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** One rounding point for every emitted coordinate, so output is stable. */
function num(value: number): string {
  return String(Math.round((value + Number.EPSILON) * 10000) / 10000)
}

function pt(value: number): string {
  return `${num(value)}pt`
}

function escapeHtml(value: string): string {
  let out = ''
  for (const ch of value) {
    switch (ch) {
      case '&': out += '&amp;'; break
      case '<': out += '&lt;'; break
      case '>': out += '&gt;'; break
      case '"': out += '&quot;'; break
      case "'": out += '&#39;'; break
      default: out += ch
    }
  }
  return out
}

/** Inline SVG is design data, but never a script or a javascript: URL. */
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
}

/**
 * Preserve a `DocumentError` raised by a verified dependency (e.g. `E_FONT`
 * from the wrapped oracle) and fail closed on anything else.
 */
function propagate<T>(code: ErrorCode, message: string, action: () => T): T {
  try {
    return action()
  } catch (error) {
    if (error instanceof DocumentError) throw error
    fail(code, message, 'the injected implementation failed', { detail: String(error) })
  }
}

function sheetDimensions(sheet: Sheet): { w: number; h: number } {
  const size: PaperSize = sheet.size
  if (typeof size === 'string') {
    const dims = PAPER_SIZES[size]
    if (!dims) fail('E_PAPER', `unknown paper size "${size}"`, 'the parser resolves the sheet to points.', { size })
    return dims
  }
  return { w: size.w, h: size.h }
}

function geometry(element: Element): { x: number; y: number; w: number; h: number } | undefined {
  const raw = element as unknown as Record<string, unknown>
  const { x, y, w, h } = raw
  if (![x, y, w, h].every(isFiniteNumber)) return undefined
  return { x: x as number, y: y as number, w: w as number, h: h as number }
}

function readPattern(element: Element): string | undefined {
  const raw = element as unknown as Record<string, unknown>
  return typeof raw.pattern === 'string' ? raw.pattern : undefined
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return fail('E_FORMAT', 'value is not printable text', 'supply a string, number or null', { type: typeof value })
}

function positionedStyle(element: Element, sheet: Sheet): string {
  const g = geometry(element)
  assertWithinSheet(element, sheet)
  if (!g) return 'position:relative;z-index:1;'
  return `position:absolute;left:${pt(g.x)};top:${pt(g.y)};width:${pt(g.w)};height:${pt(g.h)};z-index:1;`
}

/** An element outside the declared sheet is a design bug, not a printer's (E_PAGE). */
function assertWithinSheet(element: Element, sheet: Sheet): void {
  const g = geometry(element)
  if (!g) return
  const dims = sheetDimensions(sheet)
  const id = typeof element.id === 'string' ? element.id : element.kind
  if (g.x < 0 || g.y < 0 || g.x + g.w > dims.w || g.y + g.h > dims.h) {
    fail('E_PAGE', `element "${id}" falls outside the sheet`, 'move the box inside the declared page.', {
      id,
      ...g,
      sheet: dims,
    })
  }
}

// ---------------------------------------------------------------------------
// Text, values and formatters
// ---------------------------------------------------------------------------

function elementText(element: Element, ctx: RenderCtx): string {
  let value: unknown
  if (element.kind === 'text' && element.expr !== undefined) {
    value = evaluate(element.expr, { params: ctx.params, row: ctx.row })
  } else if ('text' in element && typeof element.text === 'string') {
    value = element.text
  } else if ('expr' in element && typeof element.expr === 'string') {
    value = evaluate(element.expr, { params: ctx.params, row: ctx.row })
  } else {
    return ''
  }
  if (value === null || value === undefined) return ''

  const format = 'format' in element ? element.format : undefined
  const pattern = readPattern(element)
  if (format === 'currency' || format === 'number') {
    if (typeof value !== 'number') {
      return fail('E_FORMAT', `${format} needs a numeric value`, 'supply a number for this text element.', {
        kind: element.kind,
      })
    }
    return format === 'currency'
      ? formatCurrency(value, pattern ?? DEFAULT_PATTERNS.currency)
      : formatNumber(value, pattern ?? DEFAULT_PATTERNS.number)
  }
  if (format === 'date') {
    if (typeof value !== 'string' && !(value instanceof Date)) {
      return fail('E_FORMAT', 'date needs an ISO string or a Date', 'supply YYYY-MM-DD.', { kind: element.kind })
    }
    return formatDate(value, pattern ?? DEFAULT_PATTERNS.date)
  }
  return scalarText(value)
}

function textStyle(element: TextElement): string {
  let style = ''
  if (element.align) style += `text-align:${element.align};`
  if (isFiniteNumber(element.size)) style += `font-size:${pt(element.size)};`
  if (element.bold) style += 'font-weight:bold;'
  if (element.italic) style += 'font-style:italic;'
  return style
}

// ---------------------------------------------------------------------------
// Furniture — header/footer zones, page number, date, watermark
// ---------------------------------------------------------------------------

function collectFurniture(elements: Element[]): Partial<Record<FurnitureKind, Element>> {
  const found: Partial<Record<FurnitureKind, Element>> = {}
  for (const element of elements) {
    const kind = element.kind as FurnitureKind
    if ((FURNITURE_KINDS as readonly string[]).includes(kind) && !found[kind]) found[kind] = element
  }
  return found
}

function repeats(element: Element | undefined, sheetIndex: number): boolean {
  if (!element) return false
  const raw = element as unknown as Record<string, unknown>
  const repeat = raw.repeat
  if (repeat === 'none' || repeat === false) return false
  if (repeat === 'notFirst') return sheetIndex > 0
  return true
}

type Zone = 'left' | 'center' | 'right'
const ZONES: readonly Zone[] = ['left', 'center', 'right']

function furnitureGrid(
  kind: 'header' | 'footer',
  element: Element | undefined,
  sheetIndex: number,
  overrides: Partial<Record<Zone, string>>,
  force = false,
): string {
  if (!force && !repeats(element, sheetIndex)) return ''
  const raw = (element ?? {}) as unknown as Record<string, unknown>
  const zones = isRecord(raw.zones) ? raw.zones : {}
  const noRule = raw.rule === false
  const className = `sure-document__${kind}${noRule ? ` sure-document__${kind}--no-rule` : ''}`
  const cells = ZONES.map((zone) => {
    const modifier = zone === 'center' ? ' sure-document__zone--center' : zone === 'right' ? ' sure-document__zone--right' : ''
    const literal = typeof zones[zone] === 'string' ? zones[zone] as string : ''
    const content = overrides[zone] ?? escapeHtml(literal)
    return `<div class="sure-document__zone${modifier}">${content}</div>`
  }).join('')
  return `<div class="${className}">${cells}</div>`
}

function roman(value: number, style: 'arabic' | 'roman-lower' | 'roman-upper'): string {
  if (style === 'arabic') return String(value)
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let rest = value
  let out = ''
  for (const [amount, glyph] of table) {
    while (rest >= amount) {
      out += glyph
      rest -= amount
    }
  }
  return style === 'roman-lower' ? out.toLowerCase() : out
}

/** "Page N of M" from the sheet count, never from a browser counter (§9). */
function pageNumberText(element: Element, sheetIndex: number, sheetCount: number): string {
  const raw = element as unknown as Record<string, unknown>
  const origin = raw.origin === 'content' ? 'content' : 'first'
  const hideFirst = raw.firstPage === 'hide'
  const startAt = isFiniteNumber(raw.startAt) && raw.startAt >= 1 ? Math.floor(raw.startAt) : 1
  const withTotal = raw.total !== false
  const style = raw.style === 'roman-lower' || raw.style === 'roman-upper' ? raw.style : 'arabic'

  const counted = origin === 'content' ? sheetCount - 1 : sheetCount
  if (counted <= 0) {
    fail('E_NUMBERING', 'origin: content needs a content page', 'add a content sheet or use origin: first.', {
      sheetCount,
    })
  }
  const logical = origin === 'content' ? sheetIndex : sheetIndex + 1
  if (origin === 'content' && logical === 0) return ''
  if (hideFirst && logical === 1) return ''

  const number = roman(startAt + logical - 1, style)
  if (!withTotal) return `Page ${number}`
  return `Page ${number} of ${roman(startAt + counted - 1, style)}`
}

/** `captured` comes from the caller, `issued` from a declared expr — never the clock (§10). */
function dateText(element: Element, ctx: RenderCtx): string {
  const raw = element as unknown as Record<string, unknown>
  const kind = raw.dateKind === 'captured' ? 'captured' : 'issued'
  const pattern = typeof raw.format === 'string' ? raw.format : DEFAULT_PATTERNS.date
  let value: string
  if (typeof raw.expr === 'string') {
    value = scalarText(evaluate(raw.expr, { params: ctx.params, row: ctx.row }))
  } else if (kind === 'captured' && typeof ctx.capturedAt === 'string') {
    value = ctx.capturedAt
  } else {
    return fail(
      'E_DATA',
      kind === 'captured' ? 'a captured date needs data.capturedAt' : 'an issued date needs an expr',
      kind === 'captured' ? 'supply capturedAt in the render data.' : 'declare expr: P:issuedOn on the date element.',
      { kind },
    )
  }
  return formatDate(value, pattern, typeof raw.timezone === 'string' ? raw.timezone : undefined)
}

interface WatermarkRender {
  html: string
  angle?: number
  opacity?: number
}

function watermark(element: Element, sheetIndex: number): WatermarkRender {
  const raw = element as unknown as Record<string, unknown>
  const pages = raw.pages === 'first' || raw.pages === 'body' ? raw.pages : 'all'
  if (pages === 'first' && sheetIndex !== 0) return { html: '' }
  if (pages === 'body' && sheetIndex === 0) return { html: '' }
  const mode = raw.mode === 'screen' || raw.mode === 'print' ? raw.mode : 'both'
  const modifier = mode === 'both' ? '' : ` sure-document__watermark--${mode}`
  const text = escapeHtml(typeof raw.text === 'string' ? raw.text : '')
  const angle = isFiniteNumber(raw.angle) ? raw.angle : -45
  const requested = isFiniteNumber(raw.opacity) ? raw.opacity : 0.1
  const opacity = Math.max(0, Math.min(WATERMARK_MAX_OPACITY, requested))
  return {
    html: `<div class="sure-document__watermark${modifier}" aria-hidden="true"><span>${text}</span></div>`,
    angle,
    opacity,
  }
}

// ---------------------------------------------------------------------------
// Body elements
// ---------------------------------------------------------------------------

/** A cell is a supplied value, never an expression — no sigil parsing here. */
function cellText(value: unknown): string {
  return scalarText(value)
}

interface Column {
  label: string
  field: string
}

function columnsOf(raw: unknown[], rows: unknown[]): Column[] {
  const columns = raw.map((entry): Column => {
    if (typeof entry === 'string') return { label: entry, field: entry }
    if (isRecord(entry)) {
      const label = typeof entry.label === 'string' ? entry.label : typeof entry.name === 'string' ? entry.name : ''
      const field = typeof entry.field === 'string' ? entry.field : typeof entry.name === 'string' ? entry.name : label
      return { label, field }
    }
    return { label: '', field: '' }
  })
  if (columns.length > 0) return columns
  const first = rows.find(isRecord)
  return first ? Object.keys(first).map((key) => ({ label: key, field: key })) : []
}

/** A row taller than the printable body fails E_LAYOUT — it is never split (A33, §9.3). */
function assertRowsFit(
  element: Element,
  rows: unknown[],
  columns: Column[],
  sheet: Sheet,
  body: { width: number; height: number },
  oracle: MeasurementOracle | undefined,
): void {
  const declared = geometry(element)?.h
  if (isFiniteNumber(declared) && declared > body.height) {
    fail('E_LAYOUT', 'table is taller than the printable body', 'split the table across panels; a row is never split.', {
      kind: element.kind,
      height: declared,
      bodyHeight: body.height,
    })
  }
  for (const row of rows) {
    const record = isRecord(row) ? row : {}
    let height = 0
    if (oracle) {
      const text = columns.map((column) => cellText(record[column.field])).join(' ')
      height = propagate('E_LAYOUT', 'row measurement failed', () => oracle({
        text,
        fontFamily: sheet.typography?.fontFamily ?? 'body',
        fontSize: sheet.typography?.fontSize ?? 12,
        lineHeight: sheet.typography?.lineHeight ?? 1.6,
        maxWidth: geometry(element)?.w ?? body.width,
      })).height
    }
    if (!Number.isFinite(height)) height = 0
    if (height > body.height) {
      fail('E_LAYOUT', 'a table row is taller than the printable body', 'split the row across rows; a row is never split.', {
        height,
        bodyHeight: body.height,
      })
    }
  }
}

function renderTable(
  element: Element,
  ctx: RenderCtx,
  sheet: Sheet,
  body: { width: number; height: number },
  oracle: MeasurementOracle | undefined,
): string {
  const raw = element as unknown as Record<string, unknown>
  const declaredRows = Array.isArray(raw.rows) ? raw.rows : []
  const rows: unknown[] = ctx.dataRows.length > 0 ? ctx.dataRows : declaredRows
  const columns = columnsOf(Array.isArray(raw.columns) ? raw.columns : [], rows)
  assertRowsFit(element, rows, columns, sheet, body, oracle)

  const thead = `<thead><tr>${columns.map((column) => `<th class="sure-table__header">${escapeHtml(column.label)}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${rows.map((row) => {
    const record = isRecord(row) ? row : {}
    const cells = columns.map((column) => `<td class="sure-table__cell">${escapeHtml(cellText(record[column.field]))}</td>`)
    return `<tr>${cells.join('')}</tr>`
  }).join('')}</tbody>`
  const keep = raw.keepTogether === true ? 'break-inside:avoid;page-break-inside:avoid;' : ''
  return `<table class="sure-table sure-table--print" style="${keep}">${thead}${tbody}</table>`
}

function renderFigure(element: Element, index: number, style: string): string {
  const raw = element as unknown as Record<string, unknown>
  const series: Array<{ label: string; value: number }> = []
  if (Array.isArray(raw.series)) {
    for (const entry of raw.series) {
      if (!isRecord(entry)) continue
      const label = typeof entry.label === 'string' ? entry.label : typeof entry.period === 'string' ? entry.period : ''
      const value = isFiniteNumber(entry.value) ? entry.value : 0
      series.push({ label, value })
    }
  }
  const g = geometry(element)
  const width = Math.max(1, g?.w ?? 200)
  const height = Math.max(1, g?.h ?? 120)
  const plotW = Math.max(1, width - 40)
  const plotH = Math.max(1, height - 40)
  const baseline = 20 + plotH
  const maximum = Math.max(0, ...series.map((point) => point.value))
  const uid = typeof element.id === 'string' ? element.id : `figure-${index}`
  const title = escapeHtml(typeof raw.title === 'string' ? raw.title : 'Figure')
  const desc = escapeHtml(typeof raw.desc === 'string' ? raw.desc : 'Data shown as a chart and a table.')

  const axis = `<line class="sure-figure__axis" x1="30" y1="${num(baseline)}" x2="${num(30 + plotW)}" y2="${num(baseline)}"/>` +
    `<line class="sure-figure__axis" x1="30" y1="20" x2="30" y2="${num(baseline)}"/>`
  const step = series.length > 0 ? plotW / series.length : 0
  let marks = ''
  if (raw.figureType === 'line' || raw.seriesType === 'line') {
    const points = series.map((point, i) => {
      const x = 30 + step * i + step / 2
      const y = baseline - (maximum > 0 ? (point.value / maximum) * plotH : 0)
      return `${num(x)},${num(y)}`
    }).join(' ')
    marks = `<polyline class="sure-figure__line" points="${points}"/>`
  } else {
    marks = series.map((point, i) => {
      const barH = maximum > 0 ? (point.value / maximum) * plotH : 0
      const x = 30 + step * i + 2
      const y = baseline - barH
      return `<rect class="sure-figure__bar" x="${num(x)}" y="${num(y)}" width="${num(Math.max(0, step - 4))}" height="${num(barH)}"/>`
    }).join('')
  }
  const svg = `<svg class="sure-figure__plot" viewBox="0 0 ${num(width)} ${num(height)}" role="img" aria-labelledby="${uid}-title ${uid}-desc">` +
    `<title id="${uid}-title">${title}</title><desc id="${uid}-desc">${desc}</desc>${axis}${marks}</svg>`
  const legend = `<ul class="sure-figure__legend">${series.map((point) => `<li>${escapeHtml(point.label)}</li>`).join('')}</ul>`
  const fallback = `<table><caption>${title}</caption><thead><tr><th>Category</th><th>Value</th></tr></thead><tbody>` +
    `${series.map((point) => `<tr><td>${escapeHtml(point.label)}</td><td>${num(point.value)}</td></tr>`).join('')}</tbody></table>`
  const showData = raw.fallback === true ? ' sure-figure--show-data' : ''
  return `<div class="sure-figure${showData}" style="${style}">${svg}${legend}${fallback}</div>`
}

function renderBodyElement(
  element: Element,
  ctx: RenderCtx,
  sheet: Sheet,
  body: { width: number; height: number },
  index: number,
  oracle: MeasurementOracle | undefined,
): string {
  // A table's row-fit check (E_LAYOUT) runs before the generic bounds check
  // (E_PAGE), so an oversized row is reported as a layout failure, never a clip.
  const tableHtml = element.kind === 'table' ? renderTable(element, ctx, sheet, body, oracle) : undefined
  const style = positionedStyle(element, sheet)
  switch (element.kind) {
    case 'text':
      return `<div style="${style}${textStyle(element)}">${escapeHtml(elementText(element, ctx))}</div>`
    case 'line': {
      const g = geometry(element)
      const horizontal = element.direction !== 'vertical' && element.direction !== 'diagonal'
      const rule = horizontal
        ? `border-top:${pt(Math.max(1, g?.h ?? 1))} solid currentColor;`
        : `border-left:${pt(Math.max(1, g?.w ?? 1))} solid currentColor;`
      const transform = element.direction === 'diagonal' ? 'transform:rotate(-45deg);' : ''
      return `<div style="${style}${rule}${transform}"></div>`
    }
    case 'rect':
      return `<div style="${style}border:1px solid currentColor;"></div>`
    case 'image': {
      const monochrome = element.monochrome ? ' sure-document__graphic--monochrome' : ''
      const maxHeight = isFiniteNumber(element.maxHeight) ? `--sure-graphic-max-height:${pt(element.maxHeight)};` : ''
      const inner = typeof element.svg === 'string'
        ? sanitizeSvg(element.svg)
        : typeof element.src === 'string'
          ? `<img src="${escapeHtml(element.src)}" alt="${escapeHtml(element.alt ?? '')}">`
          : `<span>${escapeHtml(element.alt ?? '')}</span>`
      return `<div class="sure-document__graphic${monochrome}" style="${style}${maxHeight}">${inner}</div>`
    }
    case 'table':
      return `<div style="${style}">${tableHtml}</div>`
    case 'figure':
      return renderFigure(element, index, style)
    case 'signature':
      return `<div class="sure-document__signature" style="${style}">${escapeHtml(elementText(element, ctx))}</div>`
    case 'section': {
      const breakBefore = element.breakBefore ? ' sure-document__section--break-before' : ''
      return `<div class="sure-document__section${breakBefore}" style="${style}">${escapeHtml(element.title ?? '')}</div>`
    }
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// Sheet assembly
// ---------------------------------------------------------------------------

/** A panel is one physical sheet; with no panel list the bands are the panel. */
function panelsOf(layout: Layout): Band[][] {
  const panels = layout.panels
  if (!Array.isArray(panels) || panels.length === 0) return [layout.bands]
  return panels.map((raw, index) => {
    let bands: unknown
    if (Array.isArray(raw)) bands = raw
    else if (isRecord(raw) && Array.isArray(raw.bands)) bands = raw.bands
    else if (isRecord(raw) && Array.isArray(raw.elements)) bands = [{ elements: raw.elements }]
    else {
      return fail('E_LAYOUT', `panels[${index}] is not a band list`, 'a panel is an array of bands or {bands: []}.', { index })
    }
    // Reuse the verified normalizer for panel bands rather than redefining it.
    return parseLayout({ sheet: layout.sheet, bands }).bands
  })
}

function renderSheet(
  sheet: Sheet,
  bands: Band[],
  furniture: Partial<Record<FurnitureKind, Element>>,
  ctx: RenderCtx,
  sheetIndex: number,
  sheetCount: number,
  oracle: MeasurementOracle | undefined,
): string {
  const dims = sheetDimensions(sheet)
  const mark = furniture.watermark && repeats(furniture.watermark, sheetIndex)
    ? watermark(furniture.watermark, sheetIndex)
    : { html: '' }
  const vars = [
    `--sure-sheet-w:${pt(dims.w)}`,
    `--sure-sheet-h:${pt(dims.h)}`,
    `--sure-sheet-margin:${pt(sheet.margins.left)}`,
    `--sure-sheet-gap:${SHEET_GAP}`,
    '--sure-sheet-scale:1',
  ]
  if (mark.angle !== undefined) vars.push(`--sure-watermark-angle:${num(mark.angle)}deg`)
  if (mark.opacity !== undefined) vars.push(`--sure-watermark-opacity:${num(mark.opacity)}`)

  const header = furnitureGrid('header', furniture.header, sheetIndex, {})

  let pageHtml = ''
  if (repeats(furniture.pageNumber, sheetIndex) && furniture.pageNumber) {
    const text = pageNumberText(furniture.pageNumber, sheetIndex, sheetCount)
    if (text) pageHtml = `<span class="sure-document__page">${escapeHtml(text)}</span>`
  }
  let dateHtml = ''
  if (repeats(furniture.date, sheetIndex) && furniture.date) {
    const text = dateText(furniture.date, ctx)
    if (text) dateHtml = `<span class="sure-document__date">${escapeHtml(text)}</span>`
  }
  const overrides: Partial<Record<Zone, string>> = {}
  if (dateHtml) overrides.left = dateHtml
  if (pageHtml) overrides.right = pageHtml
  const footer = furnitureGrid('footer', furniture.footer, sheetIndex, overrides, Boolean(dateHtml || pageHtml))

  const body = bodyBox(sheet)
  const elements = bands.flatMap((band) => band.elements)
  const bodyHtml = elements.map((element, index) => {
    if ((FURNITURE_KINDS as readonly string[]).includes(element.kind)) return ''
    return renderBodyElement(element, ctx, sheet, body, index, oracle)
  }).join('')

  return `<section class="sure-document__sheet" style="${vars.join(';')}">${mark.html}${header}${bodyHtml}${footer}</section>`
}

/**
 * Render a fixed layout to flat sheet siblings. The renderer owns `@page`
 * geometry (`design §11`); the sure-ui block owns everything on screen.
 */
export function renderDocument(input: RenderInput): RenderResult {
  const layout = parseLayout(input.layout)
  const data = input.data ?? {}
  const ctx: RenderCtx = {
    params: data.params ?? {},
    row: data.rows && data.rows.length > 0 ? data.rows[0] : undefined,
    dataRows: data.rows ?? [],
    capturedAt: data.capturedAt,
  }
  // Wrap the injected measurer so an unresolvable token fails E_FONT (A32).
  const oracle = input.oracle ? createMeasurementOracle(input.oracle) : undefined

  const panels = panelsOf(layout)
  // Furniture is sheet-level: top-level bands declare it once and it applies
  // to every panel; a panel may also carry its own copy (first one wins).
  const furniture = collectFurniture(
    [...layout.bands, ...panels.flatMap((panelBands) => panelBands)].flatMap((band) => band.elements),
  )
  const sheetCount = panels.length
  const sheets = panels.map((bands, index) => renderSheet(layout.sheet, bands, furniture, ctx, index, sheetCount, oracle))

  const dims = sheetDimensions(layout.sheet)
  const margins = layout.sheet.margins
  const pageRule = `@page { size: ${pt(dims.w)} ${pt(dims.h)}; ` +
    `margin: ${pt(margins.top)} ${pt(margins.right)} ${pt(margins.bottom)} ${pt(margins.left)}; }`
  const html = `<style>${pageRule}</style>\n<div class="sure-document">\n${sheets.join('\n')}\n</div>`
  return { sheets, html, sheetCount }
}

/** One panel is still a document result; a fragment is a panel, not a sheet (§9.3). */
export function renderPanel(input: Parameters<typeof renderDocument>[0]): ReturnType<typeof renderDocument> {
  return renderDocument(input)
}
