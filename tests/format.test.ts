import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SURE_TYPOGRAPHY } from '@shing.wong/sure-ui'
import { DocumentError } from '../src/errors.ts'
import {
  FONT_TOKENS,
  SURE_DOCUMENT_TYPOGRAPHY,
  createMeasurementOracle,
  evaluate,
  formatCurrency,
  formatDate,
  formatNumber,
  isFontToken,
} from '../src/format.ts'
import { checkTypography } from '../scripts/check-typography.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempRoots: string[] = []

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})

/** Assert the stable code, not a message spelling. */
function expectCode(run: () => unknown, code: string): DocumentError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentError)
    const documentError = error as DocumentError
    expect(documentError.code).toBe(code)
    return documentError
  }
  throw new Error(`expected ${code}, but nothing was thrown`)
}

const rows = [{ amount: 10, principal: 20 }, { amount: 20, principal: 30 }, { amount: 30, principal: 50 }]
const context = {
  params: {
    rate: 42,
    label: 'ok',
    empty: null,
    initial: 100,
    price: 3,
    total: 100,
    count: 20,
    flag: 1,
    discount: 0,
    rows,
    totals: { grand: 60, tax: 5 },
    TotalDP: 100,
  },
  row: { amount: 120, note: '', qty: 10, deduction: 40, count: 4 },
}

describe('evaluate — the closed vocabulary (design §5, A3)', () => {
  it('reads parameters from @name and root.name', () => {
    expect(evaluate('@rate', context)).toBe(42)
    expect(evaluate('root.rate', context)).toBe(42)
    expect(evaluate('@label', context)).toBe('ok')
    expect(evaluate('@empty', context)).toBeNull()
  })

  it('reads row fields from .name and row.name', () => {
    expect(evaluate('.amount', context)).toBe(120)
    expect(evaluate('row.amount', context)).toBe(120)
    expect(evaluate('.note', context)).toBe('')
  })

  it('reads server totals from the explicit totals namespace', () => {
    expect(evaluate('totals.grand', context)).toBe(60)
    expect(evaluate('totals.tax', context)).toBe(5)
  })

  it('takes raw numeric literals as numbers, never as names', () => {
    expect(evaluate('100', {})).toBe(100)
    expect(evaluate('0.05', {})).toBe(0.05)
    expect(evaluate('-3', {})).toBe(-3)
  })

  it('evaluates all five aggregates over comma-separated operands', () => {
    expect(evaluate('sum: @initial, @price, 7', context)).toBe(110)
    expect(evaluate('sub: @initial, .deduction', context)).toBe(60)
    expect(evaluate('mul: .qty, @price', context)).toBe(30)
    expect(evaluate('div: @total, .count', context)).toBe(25)
    expect(evaluate('avg: @initial, @price, 8', context)).toBe(37)
  })

  it('accepts an explicit rows.field range as an aggregate operand', () => {
    expect(evaluate('sum: rows.amount', context)).toBe(60)
    expect(evaluate('avg: rows.amount', context)).toBe(20)
    expect(evaluate('sum: rows.amount, @price', context)).toBe(63)
    expect(evaluate('sub: @initial, sum: rows.principal', context)).toBe(0)
  })

  it('treats parentheses as one operand, so a nested aggregate may carry commas', () => {
    expect(evaluate('div: (sum: @initial, @price), @count', context)).toBe(5.15)
    expect(evaluate('sum: (sub: @initial, .deduction), @price', context)).toBe(63)
  })

  it('keeps ifpresent as the only conditional and any expression as its Then', () => {
    expect(evaluate('ifpresent: @discount -> @discount', context)).toBe(0)
    expect(evaluate('ifpresent: .note -> .note', context)).toBe('')
    expect(evaluate('ifpresent: @flag -> sum: @initial, @price', context)).toBe(103)
    expect(evaluate('ifpresent: @flag -> 100', context)).toBe(100)
    expect(evaluate('ifpresent: @flag -> totals.grand', context)).toBe(60)
  })

  it('returns null when an ifpresent guard is null', () => {
    expect(evaluate('ifpresent: @empty -> @rate', context)).toBeNull()
    expect(evaluate('ifpresent: .note -> @rate', { params: { rate: 42 }, row: { note: null } })).toBeNull()
  })

  it('throws E_SCOPE_INVALID for removed P: and F: forms', () => {
    for (const expr of ['P:rate', 'F:amount', 'sum:P:a,F:b', 'ifpresent:P:flag->@rate', '@rate -> F:amount']) {
      const error = expectCode(() => evaluate(expr, context), 'E_SCOPE_INVALID')
      expect(error.hint).toMatch(/use @name for parameters or \.name for row fields/)
    }
  })

  it('throws E_SCOPE_INVALID for bare identifiers and unknown namespaces', () => {
    for (const expr of ['rate', 'totals', '@rate -> amount', 'customer.name', 'sum: bare, @rate']) {
      expectCode(() => evaluate(expr, context), 'E_SCOPE_INVALID')
    }
    expectCode(() => evaluate('@rate -> amount', context), 'E_SCOPE_INVALID')
  })

  it('throws E_SCOPE_INVALID for a .field with no active row', () => {
    for (const expr of ['.amount', 'row.amount', 'avg: rows.amount']) {
      expectCode(() => evaluate(expr, { params: { rows } }), 'E_SCOPE_INVALID')
    }
    const noRows = expectCode(() => evaluate('.amount', { params: { rate: 1 } }), 'E_SCOPE_INVALID')
    expect(noRows.hint).toMatch(/supply a row/)
  })

  it('throws E_SCOPE_INVALID for a @field that does not exist, naming the near miss', () => {
    const error = expectCode(() => evaluate('@TotlDP', context.params ? context : {}), 'E_SCOPE_INVALID')
    expect(error.hint).toMatch(/did you mean @TotalDP\?/)
    expectCode(() => evaluate('root.absent', context), 'E_SCOPE_INVALID')
    expectCode(() => evaluate('totals.absent', context), 'E_SCOPE_INVALID')
    expectCode(() => evaluate('totals.grand', { params: {} }), 'E_SCOPE_INVALID')
    expectCode(() => evaluate('ifpresent: @absent -> @rate', context), 'E_SCOPE_INVALID')
  })

  it('throws E_SCOPE_INVALID for a row field, range member or guard outside scope', () => {
    expectCode(() => evaluate('.absent', context), 'E_SCOPE_INVALID')
    expectCode(() => evaluate('row.absent', context), 'E_SCOPE_INVALID')
    expectCode(() => evaluate('sum: rows.absent', context), 'E_SCOPE_INVALID')
    expectCode(() => evaluate('@rate', { ...context, params: { rows: 'not-rows' } }), 'E_SCOPE_INVALID')
    expectCode(() => evaluate('ifpresent: bare -> @rate', context), 'E_SCOPE_INVALID')
  })

  it('throws E_EXPR for an unknown form with the supported forms in the hint', () => {
    const error = expectCode(() => evaluate('upper:rate', context), 'E_EXPR')
    expect(error.hint).toMatch(/sum:, sub:, mul:, div:, avg:, ifpresent:/)
  })

  it('throws E_EXPR for malformed forms and non-numeric operands', () => {
    expectCode(() => evaluate('', {}), 'E_EXPR')
    expectCode(() => evaluate('sum:', {}), 'E_EXPR')
    expectCode(() => evaluate('sum:@initial,', context), 'E_EXPR')
    expectCode(() => evaluate('sub:@initial', context), 'E_EXPR')
    expectCode(() => evaluate('div:@total', context), 'E_EXPR')
    expectCode(() => evaluate('sum:@initial, @label', context), 'E_EXPR')
    expectCode(() => evaluate('div:@total, 0', context), 'E_EXPR')
    expectCode(() => evaluate('sum:@bad', { params: { bad: { nested: true } } }), 'E_EXPR')
    expectCode(() => evaluate('ifpresent:@flag', context), 'E_EXPR')
    expectCode(() => evaluate('ifpresent: -> @rate', context), 'E_EXPR')
    expectCode(() => evaluate('ifpresent:@flag -> ', context), 'E_EXPR')
    expectCode(() => evaluate('rows.amount', context), 'E_SCOPE_INVALID')
  })
})

describe('formatCurrency (design §6)', () => {
  it('renders the declared pattern exactly', () => {
    expect(formatCurrency(1234.56, '¤ #,##0.00')).toBe('$1,234.56')
    expect(formatCurrency(1234567.891, '¤ #,##0.00')).toBe('$1,234,567.89')
    expect(formatCurrency(-1234.5, '¤ #,##0.00')).toBe('-$1,234.50')
    expect(formatCurrency(0, '¤ #,##0.00')).toBe('$0.00')
  })

  it('rounds half up from the declared number of decimals', () => {
    expect(formatCurrency(1.005, '¤ #,##0.00')).toBe('$1.01')
  })

  it('throws E_FORMAT for an unrenderable value or pattern', () => {
    expectCode(() => formatCurrency(Number.NaN, '¤ #,##0.00'), 'E_FORMAT')
    expectCode(() => formatCurrency(1, '¤'), 'E_FORMAT')
  })
})

describe('formatNumber (design §6)', () => {
  it('renders the declared pattern without grouping', () => {
    expect(formatNumber(1234.56, '###0.00')).toBe('1234.56')
    expect(formatNumber(1.005, '###0.00')).toBe('1.01')
    expect(formatNumber(-42, '###0.00')).toBe('-42.00')
  })

  it('honours grouping and a single decimal place when declared', () => {
    expect(formatNumber(1234.56, '#,##0.0')).toBe('1,234.6')
  })

  it('throws E_FORMAT for an unrenderable value or pattern', () => {
    expectCode(() => formatNumber(Number.POSITIVE_INFINITY, '###0.00'), 'E_FORMAT')
    expectCode(() => formatNumber(1, '###'), 'E_FORMAT')
  })
})

describe('formatDate (design §6, §10)', () => {
  it('parses an ISO date as parts so no timezone can shift it', () => {
    expect(formatDate('2008-07-07', 'MM/dd/yyyy')).toBe('07/07/2008')
    expect(formatDate('2008-07-07', 'yyyy-MM-dd')).toBe('2008-07-07')
    expect(formatDate('2008-07-07', 'd/M/yy')).toBe('7/7/08')
  })

  it('formats declared time tokens from an instant with a fixed offset', () => {
    const instant = new Date('2008-07-07T23:30:00Z')
    expect(formatDate(instant, 'yyyy-MM-dd HH:mm')).toBe('2008-07-07 23:30')
    expect(formatDate(instant, 'yyyy-MM-dd HH:mm', '+05:30')).toBe('2008-07-08 05:00')
  })

  it('throws E_FORMAT for a non-date or a non-calendar value', () => {
    expectCode(() => formatDate('not-a-date', 'MM/dd/yyyy'), 'E_FORMAT')
    expectCode(() => formatDate('05/27/08', 'MM/dd/yyyy'), 'E_FORMAT')
    expectCode(() => formatDate('2008-02-30', 'MM/dd/yyyy'), 'E_FORMAT')
    expectCode(() => formatDate(42 as unknown as Date, 'MM/dd/yyyy'), 'E_FORMAT')
  })

  it('throws E_FORMAT for an unsupported timezone or pattern token', () => {
    expectCode(() => formatDate('2008-07-07', 'MM/dd/yyyy', 'America/New_York'), 'E_FORMAT')
    expectCode(() => formatDate('2008-07-07', 'MM/dd/QQQQ'), 'E_FORMAT')
  })
})

describe('purity — A2, A9, A17', () => {
  it('is identical under any TZ and locale with Intl and the clock stubbed to throw', () => {
    const originalTz = process.env.TZ
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => { throw new Error('Intl read') })
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock read') })
    try {
      const dates: string[] = []
      const money: string[] = []
      const numbers: string[] = []
      for (const tz of ['UTC', 'America/New_York', 'Asia/Kolkata']) {
        process.env.TZ = tz
        dates.push(formatDate('2008-07-07', 'MM/dd/yyyy'))
        money.push(formatCurrency(1234.56, '¤ #,##0.00'))
        numbers.push(formatNumber(1234.56, '###0.00'))
      }
      expect(new Set(dates)).toEqual(new Set(['07/07/2008']))
      expect(new Set(money)).toEqual(new Set(['$1,234.56']))
      expect(new Set(numbers)).toEqual(new Set(['1234.56']))
    } finally {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    }
  })

  it('produces byte-identical dates with the clock moved forward a year', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2027-01-01T00:00:00Z')
    const instant = new Date('2008-07-07T12:34:56Z')
    expect(formatDate(instant, 'MM/dd/yyyy HH:mm')).toBe('07/07/2008 12:34')
    expect(formatDate('2008-07-07', 'MM/dd/yyyy')).toBe('07/07/2008')
    expect(formatDate(instant, 'MM/dd/yyyy HH:mm', 'UTC')).toBe('07/07/2008 12:34')
  })
})

describe('typography — sure-ui is the sole source of truth (design §9, A32)', () => {
  it('re-exports a generated map identical to SURE_TYPOGRAPHY', () => {
    expect(SURE_DOCUMENT_TYPOGRAPHY).toEqual(SURE_TYPOGRAPHY)
    expect(Object.keys(SURE_DOCUMENT_TYPOGRAPHY)).toEqual([
      'heading1', 'heading2', 'body', 'caption', 'mono',
    ])
    for (const style of Object.values(SURE_DOCUMENT_TYPOGRAPHY)) {
      expect(style.css).toMatch(/^var\(--sure-font-/)
      expect(typeof style.css).toBe('string')
      expect(Number.isFinite(style.ptSize)).toBe(true)
      expect(Number.isFinite(style.linePt)).toBe(true)
      expect(Number.isFinite(style.weight)).toBe(true)
    }
    expect(SURE_DOCUMENT_TYPOGRAPHY.body).toEqual({
      css: 'var(--sure-font-body)', ptSize: 10, linePt: 14, weight: 400,
    })
  })

  it('derives token names from the map, with no ad-hoc list', () => {
    expect(FONT_TOKENS).toEqual(Object.keys(SURE_TYPOGRAPHY))
    expect(isFontToken('body')).toBe(true)
    expect(isFontToken('caption')).toBe(true)
    expect(isFontToken('heading')).toBe(false) // removed ad-hoc token
    expect(isFontToken('Comic Sans MS')).toBe(false)
  })

  it('passes the pt metrics from the map to the injected measurer', () => {
    const measure = vi.fn(() => ({ width: 72, height: 14 }))
    const oracle = createMeasurementOracle(measure)
    const input = { text: 'hello', fontFamily: 'body', fontSize: 999, lineHeight: 999, maxWidth: 200 }
    expect(oracle(input)).toEqual({ width: 72, height: 14 })
    expect(measure).toHaveBeenCalledWith({
      ...input,
      fontSize: SURE_DOCUMENT_TYPOGRAPHY.body.ptSize,
      lineHeight: SURE_DOCUMENT_TYPOGRAPHY.body.linePt,
    })
  })

  it('uses the metrics of whichever declared token the renderer passes', () => {
    const measure = vi.fn((input: { fontFamily: string }) => ({ width: input.fontFamily.length, height: 1 }))
    const oracle = createMeasurementOracle(measure)
    for (const key of FONT_TOKENS) {
      const style = SURE_DOCUMENT_TYPOGRAPHY[key]
      oracle({ text: 'x', fontFamily: key, fontSize: 1, lineHeight: 1, maxWidth: 100 })
      expect(measure).toHaveBeenLastCalledWith({
        text: 'x', fontFamily: key, fontSize: style.ptSize, lineHeight: style.linePt, maxWidth: 100,
      })
    }
  })

  it('throws E_FONT and never measures an unresolvable token', () => {
    const measure = vi.fn(() => ({ width: 0, height: 0 }))
    const oracle = createMeasurementOracle(measure)
    const input = { text: 'hello', fontFamily: 'Comic Sans MS', fontSize: 10, lineHeight: 14, maxWidth: 200 }
    const error = expectCode(() => oracle(input), 'E_FONT')
    expect(error.hint).toMatch(/heading1, heading2, body, caption, mono/)
    expect(measure).not.toHaveBeenCalled()
  })

  it('keeps the checked-in generated module in sync with installed sure-ui', () => {
    expect(checkTypography(ROOT)).toEqual([])
    expect(readFileSync(join(ROOT, 'src', 'typography.generated.ts'), 'utf8')).toContain('SURE_DOCUMENT_TYPOGRAPHY')
  })

  it('detects a stale generated module and leaves a regenerated copy to diff', () => {
    const root = mkdtempSync(join(tmpdir(), 'sure-document-typography-test-'))
    tempRoots.push(root)
    const write = (file: string, text: string) => writeFileSync(join(root, file), text, 'utf8')
    write('src/typography.generated.ts', 'export const SURE_DOCUMENT_TYPOGRAPHY = {}\n')
    const problems = checkTypography(root).join('\n')
    expect(problems).toMatch(/stale/)
    expect(problems).toMatch(/regenerated:/)
  })
})
