import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentError } from '../src/errors.ts'
import { PAPER_SIZES, bodyBox, parseLayout, type PaperSize } from '../src/layout.ts'

/** A minimal valid fixed layout; the caller overrides sheet fields. */
function input(sheet: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { sheet: { size: 'letter', orientation: 'portrait', margins: 36, ...sheet }, bands: [], ...extra }
}

function failure(fn: () => unknown): DocumentError {
  try {
    fn()
  } catch (error) {
    if (error instanceof DocumentError) return error
    throw error
  }
  throw new Error('expected parseLayout to throw a DocumentError')
}

afterEach(() => vi.restoreAllMocks())

describe('PAPER_SIZES', () => {
  it('ships the ten named sizes, in points, portrait', () => {
    expect(Object.keys(PAPER_SIZES)).toEqual([
      'letter', 'legal', 'tabloid', 'executive', 'statement',
      'a3', 'a4', 'a5', 'a6', 'b5',
    ])
    expect(PAPER_SIZES.letter).toEqual({ w: 612, h: 792 })
    expect(PAPER_SIZES.legal).toEqual({ w: 612, h: 1008 })
    expect(PAPER_SIZES.a4).toEqual({ w: 595.28, h: 841.89 })
    expect(PAPER_SIZES.statement).toEqual({ w: 396, h: 612 })
    for (const dims of Object.values(PAPER_SIZES)) {
      expect(dims.h).toBeGreaterThan(dims.w)
      expect(dims.w).toBeGreaterThanOrEqual(72)
      expect(dims.h).toBeLessThanOrEqual(14400)
    }
  })
})

describe('parseLayout — paper normalization (A19, A19b)', () => {
  it('defaults to letter and normalizes a named size to canonical points', () => {
    const parsed = parseLayout({ sheet: {}, bands: [] })
    expect(parsed.sheet.size).toEqual({ unit: 'pt', w: 612, h: 792 })
    expect(parsed.sheet.orientation).toBe('portrait')
    expect(parsed.sheet.margins).toEqual({ top: 36, right: 36, bottom: 36, left: 36 })
    expect(parsed.sheet.scale).toBe(1)
    expect(parsed.bands).toEqual([])
  })

  it('makes in, mm and pt inputs for the same page byte-identical', () => {
    const sizes: PaperSize[] = [
      { unit: 'in', w: 5.5, h: 8.5 },
      { unit: 'mm', w: 139.7, h: 215.9 },
      { unit: 'pt', w: 396, h: 612 },
    ]
    const rendered = sizes.map((size) => parseLayout(input({ size })).sheet)
    expect(rendered[0]!.size).toEqual({ unit: 'pt', w: 396, h: 612 })
    expect(rendered[1]).toEqual(rendered[0])
    expect(rendered[2]).toEqual(rendered[0])
    expect(new Set(rendered.map((s) => JSON.stringify(s))).size).toBe(1)
  })

  it('rounds every converted value to four decimal places once, at parse', () => {
    const parsed = parseLayout(input({ size: { unit: 'mm', w: 100, h: 150 } }))
    expect(parsed.sheet.size).toEqual({ unit: 'pt', w: 283.4646, h: 425.1969 })
    // A second parse of the canonical value is stable (rounding is idempotent).
    const again = parseLayout(input({ size: parsed.sheet.size }))
    expect(again.sheet.size).toEqual(parsed.sheet.size)
  })

  it('swaps dimensions for landscape after lookup and conversion', () => {
    expect(parseLayout(input({ size: 'letter', orientation: 'landscape' })).sheet.size)
      .toEqual({ unit: 'pt', w: 792, h: 612 })
    expect(parseLayout(input({ size: { unit: 'mm', w: 139.7, h: 215.9 }, orientation: 'landscape' })).sheet.size)
      .toEqual({ unit: 'pt', w: 612, h: 396 })
  })

  it('rejects an unknown name and lists the valid names in the hint', () => {
    const error = failure(() => parseLayout(input({ size: 'lette' })))
    expect(error.code).toBe('E_PAPER')
    expect(error.hint).toMatch(/valid names/)
    for (const name of Object.keys(PAPER_SIZES)) expect(error.hint).toContain(name)
  })

  it('rejects a custom size outside 72–14400 pt', () => {
    for (const size of [
      { unit: 'pt' as const, w: 60, h: 792 },
      { unit: 'pt' as const, w: 612, h: 20000 },
    ]) {
      const error = failure(() => parseLayout(input({ size })))
      expect(error.code).toBe('E_PAPER')
      expect(error.hint).toMatch(/72|14400|in/)
    }
  })

  it('detects a unit slip and names the likely unit in the hint', () => {
    const millimetres = failure(() => parseLayout(input({ size: { unit: 'mm', w: 612, h: 792 } })))
    expect(millimetres.code).toBe('E_PAPER')
    expect(millimetres.hint).toMatch(/pt/)

    const points = failure(() => parseLayout(input({ size: { unit: 'pt', w: 8.5, h: 11 } })))
    expect(points.code).toBe('E_PAPER')
    expect(points.hint).toMatch(/in/)
  })

  it('rejects a bad unit or a non-numeric dimension with E_PAPER', () => {
    expect(failure(() => parseLayout(input({ size: { unit: 'cm', w: 100, h: 100 } }))).code).toBe('E_PAPER')
    expect(failure(() => parseLayout(input({ size: { unit: 'pt', w: '612', h: 792 } }))).code).toBe('E_PAPER')
  })
})

describe('parseLayout — binding and body box (A20)', () => {
  it('subtracts the gutter from the body, not the page', () => {
    const parsed = parseLayout(input({ binding: { edge: 'left', gutter: 36, mirror: false } }))
    expect(bodyBox(parsed.sheet)).toEqual({ width: 504, height: 720, x: 72, y: 36 })
  })

  it('fails E_BINDING when a gutter or furniture leaves a body under 72 pt', () => {
    const small = { size: { unit: 'pt' as const, w: 200, h: 200 }, margins: 36 }
    const gutter = failure(() => parseLayout(input({ ...small, binding: { edge: 'right', gutter: 100, mirror: false } })))
    expect(gutter.code).toBe('E_BINDING')

    const furniture = failure(() => parseLayout(input({ ...small, header: 60, footer: 40 })))
    expect(furniture.code).toBe('E_BINDING')
  })

  it('fails E_BINDING when a gutter has no binding edge', () => {
    const error = failure(() => parseLayout(input({ binding: { gutter: 12, mirror: false } })))
    expect(error.code).toBe('E_BINDING')
    expect(error.hint).toMatch(/edge/)
  })

  it('reserves header and footer height and offsets the body origin', () => {
    const parsed = parseLayout(input({ header: 24, footer: 18 }))
    expect(bodyBox(parsed.sheet)).toEqual({ width: 540, height: 678, x: 36, y: 60 })
  })

  it('takes a top gutter out of height and shifts y', () => {
    const parsed = parseLayout(input({ binding: { edge: 'top', gutter: 12, mirror: false } }))
    expect(bodyBox(parsed.sheet)).toEqual({ width: 540, height: 708, x: 36, y: 48 })
  })
})

describe('parseLayout — malformed layout (E_LAYOUT)', () => {
  it('rejects a non-object input and a missing sheet', () => {
    expect(failure(() => parseLayout(null)).code).toBe('E_LAYOUT')
    expect(failure(() => parseLayout({ bands: [] })).code).toBe('E_LAYOUT')
  })

  it('rejects a band without an elements array', () => {
    const error = failure(() => parseLayout(input({}, { bands: [{ height: 20 }] })))
    expect(error.code).toBe('E_LAYOUT')
    expect(error.hint).toMatch(/elements/)
  })

  it('rejects element geometry that is missing, non-numeric or negative', () => {
    const cases = [
      { kind: 'text', x: 0, y: 0, w: 10 },                 // missing h
      { kind: 'rect', x: '0', y: 0, w: 10, h: 10 },       // non-numeric
      { kind: 'image', x: 0, y: 0, w: -5, h: 10 },        // negative extent
      { kind: 'line', x: 0, y: 0, w: 10, h: Number.NaN },  // NaN
    ]
    for (const element of cases) {
      expect(failure(() => parseLayout(input({}, { bands: [{ elements: [element] }] }))).code).toBe('E_LAYOUT')
    }
  })

  it('rejects a negative band height', () => {
    expect(failure(() => parseLayout(input({}, { bands: [{ height: -1, elements: [] }] }))).code).toBe('E_LAYOUT')
  })

  it('keeps valid element fields intact while normalizing geometry', () => {
    const parsed = parseLayout(input({}, {
      bands: [{ id: 'b1', height: 30, repeat: true, elements: [
        { kind: 'text', x: 1, y: 2, w: 3, h: 4, text: 'Example' },
        { kind: 'header', zones: { left: 'Example' }, repeat: 'notFirst' },
      ] }],
    }))
    expect(parsed.bands[0]).toEqual({
      id: 'b1',
      height: 30,
      repeat: true,
      elements: [
        { kind: 'text', x: 1, y: 2, w: 3, h: 4, text: 'Example' },
        { kind: 'header', zones: { left: 'Example' }, repeat: 'notFirst' },
      ],
    })
  })
})

describe('parseLayout — scale (A21)', () => {
  it('refuses a fixed layout scaled away from 1', () => {
    const error = failure(() => parseLayout(input({ scale: 0.97 })))
    expect(error.code).toBe('E_SCALE')
    expect(error.hint).toMatch(/1/)
  })

  it('allows a flow layout to declare a scale', () => {
    const parsed = parseLayout(input({ scale: 0.97 }, { mode: 'flow' }))
    expect(parsed.sheet.scale).toBe(0.97)
  })

  it('rejects a non-finite scale as malformed', () => {
    expect(failure(() => parseLayout(input({ scale: 0 }))).code).toBe('E_LAYOUT')
  })
})

describe('bodyBox — exact arithmetic (catalog §3)', () => {
  it('is sheet minus margins for an unbound sheet', () => {
    expect(bodyBox(parseLayout(input()).sheet)).toEqual({ width: 540, height: 720, x: 36, y: 36 })
  })

  it('applies landscape dimensions in the sheet frame', () => {
    const parsed = parseLayout(input({ size: 'letter', orientation: 'landscape' }))
    expect(bodyBox(parsed.sheet)).toEqual({ width: 720, height: 540, x: 36, y: 36 })
  })

  it('accepts a raw named sheet directly', () => {
    expect(bodyBox({
      size: 'a4', orientation: 'portrait',
      margins: { top: 20, right: 15, bottom: 20, left: 15 },
    })).toEqual({ width: 565.28, height: 801.89, x: 15, y: 20 })
  })
})

describe('purity (A9)', () => {
  it('does not read the clock, locale, random source or network', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock read') })
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('random read') })
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => { throw new Error('locale read') })
    vi.stubGlobal('fetch', () => { throw new Error('network read') })
    expect(() => parseLayout(input({ size: 'letter' }))).not.toThrow()
    expect(bodyBox(parseLayout(input()).sheet).width).toBe(540)
  })
})
