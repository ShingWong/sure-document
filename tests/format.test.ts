import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentError } from '../src/errors.ts'
import {
  FONT_TOKENS,
  createMeasurementOracle,
  evaluate,
  formatCurrency,
  formatDate,
  formatNumber,
  isFontToken,
} from '../src/format.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

describe('evaluate — the closed vocabulary (design §5, A3)', () => {
  it('reads a parameter with P:', () => {
    expect(evaluate('P:Rate', { params: { Rate: 42 } })).toBe(42)
    expect(evaluate('P:Label', { params: { Label: 'ok' } })).toBe('ok')
    expect(evaluate('P:Empty', { params: { Empty: null } })).toBeNull()
  })

  it('reads a row field with F:', () => {
    expect(evaluate('F:amount', { row: { amount: 120 } })).toBe(120)
  })

  it('adds parameters with sum:', () => {
    expect(evaluate('sum:A,B,C', { params: { A: 1, B: 2, C: 3.5 } })).toBe(6.5)
    expect(evaluate('sum:P:A,F:B', { params: { A: 10 }, row: { B: 5 } })).toBe(15)
  })

  it('subtracts with sub:', () => {
    expect(evaluate('sub:A,B', { params: { A: 10, B: 3.25 } })).toBe(6.75)
    expect(evaluate('sub:P:Gross,F:Deduction', { params: { Gross: 100 }, row: { Deduction: 40 } })).toBe(60)
  })

  it('returns null when an ifpresent guard is absent or null', () => {
    expect(evaluate('ifpresent:P:Guard->P:Value', { params: { Guard: null, Value: 7 } })).toBeNull()
    expect(evaluate('ifpresent:P:Missing->P:Value', { params: { Value: 7 } })).toBeNull()
    expect(evaluate('ifpresent:F:Missing->F:Value', { row: { Value: 7 } })).toBeNull()
  })

  it('returns the value when the guard is present, including 0 and empty string', () => {
    expect(evaluate('ifpresent:P:Guard->P:Value', { params: { Guard: 0, Value: 7 } })).toBe(7)
    expect(evaluate('ifpresent:P:Guard->P:Value', { params: { Guard: '', Value: 'yes' } })).toBe('yes')
  })

  it('accepts any expression form as the Then of ifpresent', () => {
    expect(evaluate('ifpresent:P:Guard->sum:A,B', { params: { Guard: 1, A: 2, B: 3 } })).toBe(5)
    expect(evaluate('ifpresent:P:Guard->F:amount', { params: { Guard: 1 }, row: { amount: 9 } })).toBe(9)
    expect(evaluate('ifpresent:P:Guard->bare', { params: { Guard: 1, bare: 11 } })).toBe(11)
  })

  it('throws E_EXPR for an unknown form and lists the supported forms', () => {
    const error = expectCode(() => evaluate('upper:A', { params: { A: 1 } }), 'E_EXPR')
    expect(error.hint).toMatch(/P:, F:, sum:, sub:, ifpresent:/)
  })

  it('throws E_EXPR with the nearest supplied name for a misspelt parameter', () => {
    const error = expectCode(() => evaluate('P:TotlDP', { params: { TotalDP: 100 } }), 'E_EXPR')
    expect(error.hint).toMatch(/did you mean P:TotalDP\?/)
  })

  it('throws E_EXPR for a missing parameter or field', () => {
    expectCode(() => evaluate('P:Absent', { params: { Other: 1 } }), 'E_EXPR')
    expectCode(() => evaluate('F:absent', { row: { other: 1 } }), 'E_EXPR')
    expectCode(() => evaluate('ifpresent:P:Guard->P:Absent', { params: { Guard: 1 } }), 'E_EXPR')
  })

  it('throws E_EXPR for malformed forms and non-numeric operands', () => {
    expectCode(() => evaluate('', {}), 'E_EXPR')
    expectCode(() => evaluate('P:', {}), 'E_EXPR')
    expectCode(() => evaluate('sum:A,', { params: { A: 1 } }), 'E_EXPR')
    expectCode(() => evaluate('sub:A', { params: { A: 1 } }), 'E_EXPR')
    expectCode(() => evaluate('sub:A,B,C', { params: { A: 1, B: 2, C: 3 } }), 'E_EXPR')
    expectCode(() => evaluate('ifpresent:A', {}), 'E_EXPR')
    expectCode(() => evaluate('sum:A,B', { params: { A: 1, B: '1,500.00' } }), 'E_EXPR')
    expectCode(() => evaluate('P:Bad', { params: { Bad: { nested: true } } }), 'E_EXPR')
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

describe('measurement oracle — A32', () => {
  it('has a small closed set of declared font tokens', () => {
    expect(FONT_TOKENS).toEqual(['body', 'heading', 'caption', 'mono'])
    expect(isFontToken('body')).toBe(true)
    expect(isFontToken('Comic Sans MS')).toBe(false)
  })

  it('delegates to the injected measurer for a declared token', () => {
    const measure = vi.fn(() => ({ width: 72, height: 14 }))
    const oracle = createMeasurementOracle(measure)
    const input = { text: 'hello', fontFamily: 'body', fontSize: 10, lineHeight: 14, maxWidth: 200 }
    expect(oracle(input)).toEqual({ width: 72, height: 14 })
    expect(measure).toHaveBeenCalledWith(input)
  })

  it('throws E_FONT and never measures an unresolvable token', () => {
    const measure = vi.fn(() => ({ width: 0, height: 0 }))
    const oracle = createMeasurementOracle(measure)
    const input = { text: 'hello', fontFamily: 'Comic Sans MS', fontSize: 10, lineHeight: 14, maxWidth: 200 }
    const error = expectCode(() => oracle(input), 'E_FONT')
    expect(error.hint).toMatch(/body, heading, caption, mono/)
    expect(measure).not.toHaveBeenCalled()
  })
})
