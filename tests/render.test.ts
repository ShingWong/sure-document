import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMeasurementOracle, DocumentError } from '../src/index.js'
import { renderDocument, renderPanel } from '../src/index.js'

// Synthetic fixtures only: invented parties, round amounts, future dates.
const SEED = 20261119
const synthetic = { synthetic: true, seed: SEED }

function text(id: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  return { kind: 'text', id, x, y, w: 240, h: 14, ...extra }
}

function fixedLayout(elements: Record<string, unknown>[] = [text('party', 36, 36, { text: 'Test Person A' })]) {
  return {
    mode: 'fixed',
    sheet: { size: 'letter', orientation: 'portrait' },
    bands: [{ id: 'body', elements }],
  }
}

function expectCode(action: () => unknown, code: string): DocumentError {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentError)
    const documentError = error as DocumentError
    expect(documentError.code).toBe(code)
    return documentError
  }
  throw new Error(`expected ${code} to be thrown`)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('renderDocument — fixed mode', () => {
  it('resolves expressions and declared formats, escaping every text value', () => {
    const result = renderDocument({
      layout: fixedLayout([
        text('party', 36, 36, { expr: 'P:party' }),
        text('amount', 36, 56, { expr: 'P:amount', format: 'currency' }),
        text('issued', 36, 76, { expr: 'P:issuedOn', format: 'date' }),
      ]),
      data: {
        ...synthetic,
        params: { party: '<script>alert(1)</script>', amount: 120, issuedOn: '2031-04-15' },
      },
    })
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('$120.00')
    expect(result.html).toContain('04/15/2031')
    expect(result.sheetCount).toBe(1)
  })

  it('is byte-identical on a reprint (A8) and never touches clock, Intl or fetch (A9, A17)', () => {
    const layout = fixedLayout([text('issued', 36, 36, { expr: 'P:issuedOn', format: 'date' })])
    const data = { ...synthetic, params: { issuedOn: '2031-04-15' }, capturedAt: '2031-04-15T00:00:00Z' }
    const first = renderDocument({ layout, data })

    vi.stubGlobal('fetch', () => { throw new Error('fetch is not allowed') })
    vi.stubGlobal('Intl', {
      DateTimeFormat() { throw new Error('Intl is not allowed') },
      NumberFormat() { throw new Error('Intl is not allowed') },
    })
    const now = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock is not allowed') })
    try {
      const second = renderDocument({ layout, data })
      expect(second).toEqual(first)
      expect(second.html).toBe(first.html)
    } finally {
      now.mockRestore()
    }
  })

  it('owns @page geometry and draws each sheet as paper (A19, A22, A31)', () => {
    const result = renderDocument({
      layout: {
        mode: 'fixed',
        sheet: {
          size: 'letter',
          orientation: 'landscape',
          margins: { top: 10, right: 20, bottom: 30, left: 40 },
        },
        bands: [{ elements: [] }],
      },
    })
    expect(result.html).toContain('@page { size: 792pt 612pt; margin: 10pt 20pt 30pt 40pt; }')
    expect(result.sheets[0]).toContain('--sure-sheet-w:792pt')
    expect(result.sheets[0]).toContain('--sure-sheet-h:612pt')
    expect(result.sheets[0]).toContain('--sure-sheet-margin:40pt')
    expect(result.sheets[0]).toContain('--sure-sheet-gap:2rem')
  })

  it('emits one flat sheet sibling per panel (A30, A31)', () => {
    const result = renderDocument({
      layout: {
        mode: 'fixed',
        sheet: { size: 'letter' },
        bands: [{ elements: [] }],
        panels: [
          { bands: [{ elements: [text('first', 36, 36, { text: 'Panel One' })] }] },
          { bands: [{ elements: [text('second', 36, 36, { text: 'Panel Two' })] }] },
          { bands: [{ elements: [text('third', 36, 36, { text: 'Panel Three' })] }] },
        ],
      },
    })
    expect(result.sheetCount).toBe(3)
    expect(result.sheets).toHaveLength(3)
    for (const sheet of result.sheets) {
      expect(sheet.startsWith('<section class="sure-document__sheet"')).toBe(true)
      expect(sheet.endsWith('</section>')).toBe(true)
    }
    expect(result.html).toContain('Panel One')
    expect(result.html).toContain('Panel Three')
  })

  it('prints a true "Page N of M" and honours firstPage and origin (A16, A26)', () => {
    const panels = [1, 2, 3].map((n) => ({
      bands: [{ elements: [text(`t${n}`, 36, 36, { text: `Panel ${n}` })] }],
    }))
    const pageNumber = { kind: 'pageNumber' }
    const base = { mode: 'fixed', sheet: { size: 'letter' }, bands: [{ elements: [] }], panels }

    const plain = renderDocument({ layout: { ...base, panels: [{ bands: [{ elements: [pageNumber] }] }, ...panels] } })
    expect(plain.sheetCount).toBe(4)
    expect(plain.sheets[0]).toContain('Page 1 of 4')
    expect(plain.sheets[3]).toContain('Page 4 of 4')

    const hidden = renderDocument({
      layout: { ...base, panels: [{ bands: [{ elements: [{ ...pageNumber, firstPage: 'hide' }] }] }, ...panels] },
    })
    expect(hidden.sheets[0]).not.toContain('sure-document__page')
    expect(hidden.sheets[1]).toContain('Page 2 of 4')
    expect(hidden.sheets[3]).toContain('Page 4 of 4')

    const content = renderDocument({
      layout: { ...base, panels: [{ bands: [{ elements: [{ ...pageNumber, origin: 'content' }] }] }, ...panels] },
    })
    expect(content.sheets[0]).not.toContain('sure-document__page')
    expect(content.sheets[1]).toContain('Page 1 of 3')
    expect(content.sheets[3]).toContain('Page 3 of 3')
  })

  it('takes dates from data, never the clock (A17)', () => {
    const result = renderDocument({
      layout: {
        mode: 'fixed',
        sheet: { size: 'letter' },
        bands: [{ elements: [{ kind: 'date', dateKind: 'captured', format: 'yyyy-MM-dd' }] }],
      },
      data: { ...synthetic, capturedAt: '2031-04-15T12:30:00Z' },
    })
    expect(result.html).toContain('<span class="sure-document__date">2031-04-15</span>')
    expectCode(() => renderDocument({
      layout: {
        mode: 'fixed',
        sheet: { size: 'letter' },
        bands: [{ elements: [{ kind: 'date', dateKind: 'captured' }] }],
      },
    }), 'E_DATA')
  })

  it('repeats three-zone header and footer furniture per sheet (A15)', () => {
    const header = { kind: 'header', zones: { left: 'Alpha', center: 'Beta', right: 'Gamma' }, rule: false, repeat: 'all' }
    const footer = { kind: 'footer', zones: { left: 'L', center: 'C', right: 'R' }, repeat: 'notFirst' }
    const result = renderDocument({
      layout: {
        mode: 'fixed',
        sheet: { size: 'letter' },
        bands: [{ elements: [header, footer] }],
        panels: [
          { bands: [{ elements: [] }] },
          { bands: [{ elements: [] }] },
        ],
      },
    })
    for (const sheet of result.sheets) {
      expect(sheet).toContain('class="sure-document__header sure-document__header--no-rule"')
      expect(sheet).toContain('Alpha')
      expect(sheet).toContain('Gamma')
    }
    expect(result.sheets[0]?.match(/class="sure-document__zone/g)).toHaveLength(3) // header only
    expect(result.sheets[0]).not.toContain('sure-document__footer')
    expect(result.sheets[1]?.match(/class="sure-document__zone/g)).toHaveLength(6) // header + footer
    expect(result.sheets[1]).toContain('sure-document__footer')
  })

  it('paints a capped, inert watermark behind the requested sheets (A14)', () => {
    const result = renderDocument({
      layout: {
        mode: 'fixed',
        sheet: { size: 'letter' },
        bands: [{ elements: [{ kind: 'watermark', text: 'Example Only', angle: -45, opacity: 0.4, pages: 'body' }] }],
        panels: [{ bands: [{ elements: [] }] }, { bands: [{ elements: [] }] }],
      },
    })
    expect(result.sheets[0]).not.toContain('sure-document__watermark')
    expect(result.sheets[1]).toContain('sure-document__watermark')
    expect(result.sheets[1]).toContain('aria-hidden="true"')
    expect(result.sheets[1]).toContain('--sure-watermark-angle:-45deg')
    expect(result.sheets[1]).toContain('--sure-watermark-opacity:0.15')
  })

  it('renders tables with a repeated head and a print class, refusing an oversized row (A33)', () => {
    const table = {
      kind: 'table',
      x: 36, y: 36, w: 540, h: 100,
      columns: ['Item', 'Amount'],
      rows: [{ Item: 'Test Item', Amount: 120 }],
    }
    const result = renderDocument({ layout: fixedLayout([table]) })
    expect(result.html).toContain('class="sure-table sure-table--print"')
    expect(result.html).toContain('<thead>')
    expect(result.html).toContain('<tbody>')
    expect(result.html).toContain('sure-table__header')
    expect(result.html).toContain('sure-table__cell')
    expect(result.html).toContain('Test Item')

    const oversized = { ...table, h: 900 }
    expectCode(() => renderDocument({ layout: fixedLayout([oversized]) }), 'E_LAYOUT')

    const oracle = createMeasurementOracle(() => ({ width: 500, height: 800 }))
    expectCode(() => renderDocument({ layout: fixedLayout([table]), oracle }), 'E_LAYOUT')
  })

  it('fails closed on an unresolvable font token (A32)', () => {
    const oracle = createMeasurementOracle(() => ({ width: 100, height: 12 }))
    const layout = {
      mode: 'fixed',
      sheet: { size: 'letter', typography: { fontFamily: 'Unregistered Face' } },
      bands: [{ elements: [{ kind: 'table', x: 36, y: 36, w: 540, h: 100, columns: ['Item'], rows: [{ Item: 'X' }] }] }],
    }
    expectCode(() => renderDocument({ layout, oracle }), 'E_FONT')
  })

  it('reports geometry outside the sheet and bad expressions with stable codes', () => {
    expectCode(() => renderDocument({ layout: fixedLayout([text('wide', 600, 36, { w: 20, text: 'X' })]) }), 'E_PAGE')
    expectCode(() => renderDocument({ layout: fixedLayout([text('missing', 36, 36, { expr: 'P:absent' })]) }), 'E_EXPR')
  })

  it('builds accessible figures from a scale with a data fallback', () => {
    const figure = {
      kind: 'figure',
      id: 'bars', x: 36, y: 36, w: 400, h: 200,
      title: 'Points by label',
      desc: 'Three synthetic values.',
      fallback: true,
      series: [{ label: 'Delta', value: 120 }, { label: 'Beta', value: 240 }],
    }
    const result = renderDocument({ layout: fixedLayout([figure]) })
    expect(result.html).toContain('sure-figure__plot')
    expect(result.html).toContain('<title id="bars-title">Points by label</title>')
    expect(result.html).toContain('<desc id="bars-desc">Three synthetic values.</desc>')
    expect(result.html).toContain('class="sure-figure__bar"')
    expect(result.html).toContain('sure-figure__axis')
    expect(result.html).toContain('sure-figure__legend')
    expect(result.html).toContain('sure-figure--show-data')
    expect(result.html).toContain('<table>')
  })

  it('emits only sure-ui 0.3.6 classes — never an invented one', () => {
    const elements = [
      text('t', 36, 36, { text: 'Plain' }),
      { kind: 'header', zones: { left: 'L', center: 'C', right: 'R' }, rule: false },
      { kind: 'footer', zones: { left: 'L' } },
      { kind: 'pageNumber' },
      { kind: 'date', expr: 'P:issuedOn' },
      { kind: 'watermark', text: 'Example Only' },
      { kind: 'line', x: 36, y: 60, w: 100, h: 1, direction: 'horizontal' },
      { kind: 'rect', x: 36, y: 70, w: 100, h: 20 },
      { kind: 'image', x: 36, y: 100, w: 50, h: 50, svg: '<svg><circle r="4"/></svg>', monochrome: true },
      { kind: 'table', x: 36, y: 160, w: 300, h: 40, columns: ['Item'], rows: [{ Item: 'X' }], keepTogether: true },
      { kind: 'figure', x: 36, y: 210, w: 200, h: 100, series: [{ label: 'Delta', value: 1 }] },
      { kind: 'section', title: 'Part One', breakBefore: true },
      { kind: 'signature', x: 36, y: 320, w: 200, h: 20, text: 'Signature' },
    ]
    const result = renderDocument({
      layout: fixedLayout(elements),
      data: { ...synthetic, params: { issuedOn: '2031-04-15' } },
    })
    const allowed = new Set([
      'sure-document', 'sure-document__sheet', 'sure-document__header', 'sure-document__footer',
      'sure-document__header--no-rule', 'sure-document__footer--no-rule',
      'sure-document__zone', 'sure-document__zone--center', 'sure-document__zone--right',
      'sure-document__page', 'sure-document__date', 'sure-document__section',
      'sure-document__section--break-before', 'sure-document__signature',
      'sure-document__graphic', 'sure-document__graphic--monochrome',
      'sure-document__watermark', 'sure-document__watermark--print', 'sure-document__watermark--screen',
      'sure-table', 'sure-table__header', 'sure-table__cell', 'sure-table--print',
      'sure-figure', 'sure-figure__plot', 'sure-figure__axis', 'sure-figure__bar',
      'sure-figure__line', 'sure-figure__legend', 'sure-figure--show-data',
    ])
    const emitted = new Set<string>()
    for (const match of result.html.matchAll(/class="([^"]*)"/g)) {
      for (const token of (match[1] ?? '').split(/\s+/)) {
        if (token.startsWith('sure-')) emitted.add(token)
      }
    }
    for (const token of emitted) expect(allowed.has(token), `unexpected class ${token}`).toBe(true)
  })

  it('binds only to real sure-ui 0.3.6 custom properties, never invented typography vars', () => {
    const result = renderDocument({
      layout: {
        mode: 'fixed',
        sheet: { size: 'letter', typography: { fontFamily: 'body', fontSize: 11, lineHeight: 1.5 } },
        bands: [{
          elements: [
            text('t', 36, 36, { text: 'X' }),
            { kind: 'watermark', text: 'Example Only' },
            { kind: 'image', x: 36, y: 50, w: 20, h: 20, svg: '<svg/>', maxHeight: 12 },
          ],
        }],
      },
    })
    expect(result.html).not.toMatch(/--sure-font|--sure-type|var\(--sure-/)
    expect(result.sheets[0]).toContain('--sure-sheet-w:612pt')
    expect(result.sheets[0]).toContain('--sure-watermark-angle:-45deg')
    expect(result.sheets[0]).toContain('--sure-graphic-max-height:12pt')
  })

  it('leaves expression scoping to evaluate — new sigils stay literal unless declared as expr', () => {
    const result = renderDocument({
      layout: fixedLayout([
        { kind: 'header', zones: { left: '@name', center: 'row.amount', right: 'root.total' } },
        text('literal', 36, 36, { text: '.field' }),
        text('expr', 36, 56, { expr: 'P:party' }),
        { kind: 'table', x: 36, y: 76, w: 300, h: 40, columns: ['Value'], rows: [{ Value: '@name' }] },
      ]),
      data: { ...synthetic, params: { party: 'Test Person A' } },
    })
    expect(result.html).toContain('@name')
    expect(result.html).toContain('row.amount')
    expect(result.html).toContain('root.total')
    expect(result.html).toContain('.field')
    expect(result.html).toContain('Test Person A')
  })

  it('offers renderPanel as a one-panel convenience', () => {
    const input = { layout: fixedLayout([text('party', 36, 36, { text: 'Test Person A' })]) }
    expect(renderPanel(input)).toEqual(renderDocument(input))
  })
})
