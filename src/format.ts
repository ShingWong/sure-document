/**
 * The closed expression vocabulary (design §5), the declared print formatters
 * (design §6), and the injected measurement contract (design §9 / A32).
 *
 * Pure and dependency-free: no clock, host locale, `Intl`, DOM or dynamic code
 * execution. Every value and every pattern is supplied by the caller, so the
 * same inputs always produce the same paper (A8, A9, A17). Typography values
 * come from a checked-in resolution of sure-ui's `SURE_TYPOGRAPHY`, never from
 * a second, hand-maintained token dictionary.
 */

import { fail } from './errors.js'
import { SURE_DOCUMENT_TYPOGRAPHY } from './typography.generated.js'
import type { SureDocumentTypographyKind } from './typography.generated.js'

export { SURE_DOCUMENT_TYPOGRAPHY } from './typography.generated.js'
export type { SureDocumentTypographyKind, SureDocumentTypographyStyle } from './typography.generated.js'

/** The caller-supplied values an expression may read (`design §5`). */
export interface EvalContext {
  params?: Record<string, unknown>
  row?: Record<string, unknown>
}

/** The only value types an expression can produce. */
export type Scalar = string | number | null

// ---------------------------------------------------------------------------
// Expressions — a fixed micro-parser, never an evaluator (design §5, A3).
// ---------------------------------------------------------------------------

type Scope = 'param' | 'row' | 'totals' | 'rows'
type Aggregate = 'sum' | 'sub' | 'mul' | 'div' | 'avg'

interface Ref {
  scope: Scope
  name: string
}

const AGGREGATES: readonly Aggregate[] = ['sum', 'sub', 'mul', 'div', 'avg']
const NUMERIC_LITERAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

const SUPPORTED_FORMS = 'sum:, sub:, mul:, div:, avg:, ifpresent:'
const SCOPE_FORMS = '@name, root.name, .name, row.name, totals.name; numbers are literals'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function own(map: Record<string, unknown>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, name)
}

function refLabel(ref: Ref): string {
  switch (ref.scope) {
    case 'param': return `@${ref.name}`
    case 'row': return `.${ref.name}`
    case 'totals': return `totals.${ref.name}`
    case 'rows': return `rows.${ref.name}`
  }
}

function editDistance(a: string, b: string): number {
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr: number[] = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j] ?? 0
  }
  return prev[b.length] ?? 0
}

/** The nearest supplied name, only when it is close enough to be a typo. */
function nearestName(query: string, names: string[]): string | undefined {
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  const needle = query.toLowerCase()
  for (const name of names) {
    const distance = editDistance(needle, name.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      best = name
    }
  }
  if (best === undefined) return undefined
  const threshold = Math.max(1, Math.min(3, Math.floor(query.length / 2)))
  return bestDistance <= threshold ? best : undefined
}

function suggestion(ref: Ref, ctx: EvalContext): string | undefined {
  const totals = ctx.params?.totals
  const names = ref.scope === 'param'
    ? Object.keys(ctx.params ?? {})
    : ref.scope === 'row'
      ? Object.keys(ctx.row ?? {})
      : ref.scope === 'totals' && isRecord(totals)
        ? Object.keys(totals)
        : []
  const near = nearestName(ref.name, names)
  return near === undefined ? undefined : `did you mean ${refLabel({ scope: ref.scope, name: near })}?`
}

function toScalar(value: unknown, label: string, expr: string): Scalar {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fail(
    'E_EXPR',
    `${label} is not a string, finite number or null`,
    `supply a scalar value for ${label}`,
    { expr },
  )
}

/** `@`/`root.` are params, `.`/`row.` are the current row, `totals.` is explicit. */
function parseRef(raw: string): Ref | undefined {
  const text = raw.trim()
  if (text.startsWith('@')) return { scope: 'param', name: text.slice(1).trim() }
  if (text.startsWith('root.')) return { scope: 'param', name: text.slice(5).trim() }
  if (text.startsWith('row.')) return { scope: 'row', name: text.slice(4).trim() }
  if (text.startsWith('totals.')) return { scope: 'totals', name: text.slice(7).trim() }
  if (text.startsWith('.')) return { scope: 'row', name: text.slice(1).trim() }
  if (text.startsWith('rows.')) return { scope: 'rows', name: text.slice(5).trim() }
  return undefined
}

function lookup(ref: Ref, ctx: EvalContext, expr: string): Scalar {
  if (ref.name.length === 0) {
    return fail('E_SCOPE_INVALID', `empty ${ref.scope} name`, 'supply a name, e.g. @total or .amount', { expr })
  }
  if (ref.scope === 'param') {
    if (!ctx.params || !own(ctx.params, ref.name)) {
      return fail(
        'E_SCOPE_INVALID',
        `parameter ${refLabel(ref)} does not exist`,
        suggestion(ref, ctx) ?? 'declare it in params',
        { expr },
      )
    }
    return toScalar(ctx.params[ref.name], refLabel(ref), expr)
  }
  if (ref.scope === 'row') {
    if (!ctx.row) {
      return fail(
        'E_SCOPE_INVALID',
        `row field ${refLabel(ref)} has no active row`,
        'use @name for a parameter, or supply a row for .name / row.name',
        { expr },
      )
    }
    if (!own(ctx.row, ref.name)) {
      return fail(
        'E_SCOPE_INVALID',
        `row field ${refLabel(ref)} does not exist`,
        suggestion(ref, ctx) ?? 'declare it on the current row',
        { expr },
      )
    }
    return toScalar(ctx.row[ref.name], refLabel(ref), expr)
  }
  if (ref.scope === 'totals') {
    const totals = ctx.params?.totals
    if (!isRecord(totals) || !own(totals, ref.name)) {
      return fail(
        'E_SCOPE_INVALID',
        `total ${refLabel(ref)} does not exist`,
        suggestion(ref, ctx) ?? 'supply params.totals with that name',
        { expr },
      )
    }
    return toScalar(totals[ref.name], refLabel(ref), expr)
  }
  return fail(
    'E_SCOPE_INVALID',
    `${refLabel(ref)} is only valid as an aggregate operand`,
    'use sum: rows.amount or avg: rows.amount',
    { expr },
  )
}

function removedForm(token: string): 'P' | 'F' | undefined {
  const colon = token.indexOf(':')
  if (colon === -1) return undefined
  const form = token.slice(0, colon).trim()
  return form === 'P' || form === 'F' ? form : undefined
}

/** Bare names and removed forms never fall back to a guessed scope. */
function unscoped(token: string, expr: string, role: string): never {
  const removed = removedForm(token)
  if (removed) {
    return fail(
      'E_SCOPE_INVALID',
      `removed form "${removed}:"`,
      `use @name for parameters or .name for row fields, not ${removed}:`,
      { expr },
    )
  }
  return fail(
    'E_SCOPE_INVALID',
    `${role} "${token}" has no explicit scope`,
    `use ${SCOPE_FORMS}`,
    { expr },
  )
}

function numericLiteral(text: string): number | undefined {
  return NUMERIC_LITERAL.test(text) ? Number(text) : undefined
}

function isAggregate(text: string): text is `${Aggregate}:${string}` {
  const colon = text.indexOf(':')
  return colon > 0 && (AGGREGATES as readonly string[]).includes(text.slice(0, colon).trim())
}

/** Parentheses group one operand, so a nested aggregate may carry its own commas. */
function splitOperands(body: string, form: Aggregate, expr: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth < 0) {
        return fail('E_EXPR', `${form} has unbalanced parentheses`, 'use (sum: A, B) as one operand', { expr })
      }
    } else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  if (depth !== 0) {
    return fail('E_EXPR', `${form} has unbalanced parentheses`, 'use (sum: A, B) as one operand', { expr })
  }
  parts.push(body.slice(start))
  const cleaned = parts.map((part) => part.trim())
  if (cleaned.some((part) => part.length === 0)) {
    return fail('E_EXPR', `${form} has an empty operand`, `use ${form}:A,B`, { expr })
  }
  return cleaned.map((part) => part.startsWith('(') && part.endsWith(')') ? part.slice(1, -1).trim() : part)
}

/** `rows.amount` is an explicit range: every row in params.rows supplies one number. */
function rangeNumbers(ref: Ref, ctx: EvalContext, expr: string): number[] {
  const rows = ctx.params?.rows
  if (!Array.isArray(rows)) {
    return fail('E_SCOPE_INVALID', `${refLabel(ref)} has no rows parameter`, 'supply params.rows as an array of records', { expr })
  }
  if (ref.name.length === 0) {
    return fail('E_SCOPE_INVALID', 'empty rows range field', 'use rows.amount', { expr })
  }
  return rows.map((row, index) => {
    if (!isRecord(row) || !own(row, ref.name)) {
      return fail(
        'E_SCOPE_INVALID',
        `rows[${index}].${ref.name} does not exist`,
        `declare ${ref.name} on every row in params.rows`,
        { expr },
      )
    }
    const value = toScalar(row[ref.name], refLabel(ref), expr)
    if (typeof value !== 'number') {
      return fail('E_EXPR', `${refLabel(ref)} is not numeric`, 'supply numbers for an aggregate range', { expr })
    }
    return value
  })
}

function operandNumbers(raw: string, ctx: EvalContext, expr: string): number[] {
  const token = raw.trim()
  const literal = numericLiteral(token)
  if (literal !== undefined) return [literal]
  const ref = parseRef(token)
  if (ref?.scope === 'rows') return rangeNumbers(ref, ctx, expr)
  if (ref) {
    const value = lookup(ref, ctx, expr)
    if (typeof value !== 'number') {
      return fail('E_EXPR', `operand "${token}" is not a finite number`, 'supply a numeric value for this operand', { expr })
    }
    return [value]
  }
  if (isAggregate(token)) {
    const value = evaluate(token, ctx)
    if (typeof value !== 'number') {
      return fail('E_EXPR', `operand "${token}" is not a finite number`, 'supply a numeric value for this operand', { expr })
    }
    return [value]
  }
  return unscoped(token, expr, 'operand')
}

function evaluateAggregate(form: Aggregate, body: string, ctx: EvalContext, expr: string): Scalar {
  const operands = splitOperands(body, form, expr)
  if ((form === 'sub' || form === 'div') && operands.length < 2) {
    return fail('E_EXPR', `${form} needs at least two operands`, `use ${form}:A,B`, { expr })
  }
  const numbers = operands.flatMap((operand) => operandNumbers(operand, ctx, expr))
  if (numbers.length === 0) {
    return fail('E_EXPR', `${form} has no operands`, `use ${form}:A,B`, { expr })
  }
  switch (form) {
    case 'sum': return numbers.reduce((total, value) => total + value, 0)
    case 'mul': return numbers.reduce((total, value) => total * value, 1)
    case 'sub': return numbers.slice(1).reduce((total, value) => total - value, numbers[0]!)
    case 'div': {
      let total = numbers[0]!
      for (const value of numbers.slice(1)) {
        if (value === 0) return fail('E_EXPR', 'division by zero', 'supply a non-zero divisor', { expr })
        total /= value
      }
      return total
    }
    case 'avg': return numbers.reduce((total, value) => total + value, 0) / numbers.length
  }
}

/** `ifpresent` is the only conditional. Its guard must be a scoped reference. */
function evaluateGuard(body: string, ctx: EvalContext, expr: string): Scalar {
  const arrow = body.indexOf('->')
  if (arrow === -1) {
    return fail('E_EXPR', 'ifpresent is missing ->', 'use ifpresent:@discount -> @discount', { expr })
  }
  const guard = body.slice(0, arrow).trim()
  const then = body.slice(arrow + 2).trim()
  if (guard.length === 0 || then.length === 0) {
    return fail('E_EXPR', 'ifpresent needs both a guard and a value', 'use ifpresent:@discount -> @discount', { expr })
  }
  const ref = parseRef(guard)
  if (!ref) return unscoped(guard, expr, 'guard')
  const value = lookup(ref, ctx, expr)
  return value === null ? null : evaluate(then, ctx)
}

/**
 * Evaluate one form of the closed vocabulary in `design §5`: scoped references
 * (`@`/`root.`, `.`/`row.`, `totals.`), numeric literals, the five aggregates,
 * and `ifpresent`. A scope error throws `E_SCOPE_INVALID`; an unknown form or
 * a malformed expression throws `E_EXPR`. Nothing is ever guessed or blanked.
 */
export function evaluate(expr: string, ctx: EvalContext): Scalar {
  const text = expr.trim()
  if (text.length === 0) {
    return fail('E_EXPR', 'empty expression', `use ${SCOPE_FORMS} or ${SUPPORTED_FORMS}`, { expr })
  }
  if (text.startsWith('(') && text.endsWith(')')) return evaluate(text.slice(1, -1).trim(), ctx)

  const colon = text.indexOf(':')
  const form = colon === -1 ? '' : text.slice(0, colon).trim()
  const body = colon === -1 ? '' : text.slice(colon + 1).trim()

  if (form !== '') {
    if ((AGGREGATES as readonly string[]).includes(form)) {
      return evaluateAggregate(form as Aggregate, body, ctx, text)
    }
    if (form === 'ifpresent') return evaluateGuard(body, ctx, text)
    if (form === 'P' || form === 'F') return unscoped(text, text, 'form')
    return fail(
      'E_EXPR',
      `unknown expression form "${form}:"`,
      `supported forms: ${SUPPORTED_FORMS}; scopes: ${SCOPE_FORMS}`,
      { expr: text },
    )
  }

  const literal = numericLiteral(text)
  if (literal !== undefined) return literal
  const ref = parseRef(text)
  if (ref) return lookup(ref, ctx, text)
  return unscoped(text, text, 'name')
}

// ---------------------------------------------------------------------------
// Number formatters — declared patterns, explicit values, no locale.
// ---------------------------------------------------------------------------

function decimalCount(pattern: string): number {
  const dot = pattern.indexOf('.')
  if (dot === -1) return 0
  let count = 0
  for (let i = dot + 1; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === '0' || ch === '#') count += 1
  }
  return count
}

function hasIntegerDigit(pattern: string): boolean {
  const dot = pattern.indexOf('.')
  return (dot === -1 ? pattern : pattern.slice(0, dot)).includes('0')
}

function groupDigits(digits: string): string {
  let out = ''
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return out
}

function renderMagnitude(value: number, decimals: number, grouping: boolean): string {
  const factor = 10 ** decimals
  const scaled = Math.round((Math.abs(value) + Number.EPSILON) * factor)
  const whole = Math.floor(scaled / factor)
  const fraction = scaled - whole * factor
  const wholeText = grouping ? groupDigits(String(whole)) : String(whole)
  return decimals > 0 ? `${wholeText}.${String(fraction).padStart(decimals, '0')}` : wholeText
}

function signOf(value: number): string {
  return value < 0 || Object.is(value, -0) ? '-' : ''
}

function checkNumeric(value: number, pattern: string): void {
  if (!Number.isFinite(value)) {
    fail('E_FORMAT', 'value is not a finite number', 'supply a finite number', { value: String(value) })
  }
  if (!hasIntegerDigit(pattern.replace(/\s+/g, ''))) {
    fail('E_FORMAT', `pattern "${pattern}" has no integer digit`, 'use a pattern like #,##0.00', { pattern })
  }
}

/**
 * Format money from a declared pattern (`design §6`). `¤` is the currency
 * placeholder and prints as `$`; grouping and decimals come from the pattern,
 * never from the host locale. Negative values put the sign before the symbol.
 */
export function formatCurrency(value: number, pattern: string): string {
  checkNumeric(value, pattern)
  const compact = pattern.replace(/\s+/g, '')
  const decimals = decimalCount(compact)
  const symbol = compact.includes('¤') ? '$' : ''
  return `${signOf(value)}${symbol}${renderMagnitude(value, decimals, compact.includes(','))}`
}

/**
 * Format a plain number from a declared pattern (`design §6`), e.g. `###0.00`
 * → `1234.56`. `#` is an optional and `0` a mandatory digit; both count as a
 * decimal place after `.`, and a `,` in the pattern enables grouping.
 */
export function formatNumber(value: number, pattern: string): string {
  checkNumeric(value, pattern)
  const compact = pattern.replace(/\s+/g, '')
  return `${signOf(value)}${renderMagnitude(value, decimalCount(compact), compact.includes(','))}`
}

// ---------------------------------------------------------------------------
// Date formatter — parts only, no clock, no Intl, no host timezone.
// ---------------------------------------------------------------------------

interface DateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(?:Z|[+-]\d{2}:?\d{2})?$/
const DATE_TOKENS = ['yyyy', 'yy', 'MM', 'M', 'dd', 'd', 'HH', 'H', 'mm', 'm', 'ss', 's'] as const

function daysInMonth(year: number, month: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return lengths[month - 1]!
}

/** Proleptic-Gregorian day number (Howard Hinnant's civil-date algorithm). */
function daysFromCivil(year: number, month: number, day: number): number {
  const yy = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const mp = month + (month > 2 ? -3 : 9)
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
  const shifted = days + 719468
  const era = Math.floor(shifted / 146097)
  const doe = shifted - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  let year = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp + (mp < 10 ? 3 : -9)
  if (month <= 2) year += 1
  return { year, month, day }
}

function parseIsoParts(value: string): DateParts {
  const match = ISO_DATE.exec(value)
  if (!match) {
    return fail('E_FORMAT', `"${value}" is not an ISO date`, 'supply YYYY-MM-DD', { value })
  }
  const year = Number(match[1]!)
  const month = Number(match[2]!)
  const day = Number(match[3]!)
  const hour = match[4] ? Number(match[4]) : 0
  const minute = match[5] ? Number(match[5]) : 0
  const second = match[6] ? Number(match[6]) : 0
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) ||
      hour > 23 || minute > 59 || second > 59) {
    return fail('E_FORMAT', `"${value}" is not a calendar date`, 'supply a real YYYY-MM-DD date', { value })
  }
  return { year, month, day, hour, minute, second }
}

/**
 * Validate a timezone declaration. Only UTC and fixed offsets are resolvable
 * without a TZ database: consulting the host's zone would break A2.
 */
function parseTimezone(timezone: string | undefined): number {
  if (timezone === undefined || timezone === 'UTC' || timezone === 'Z') return 0
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(timezone)
  if (!match) {
    return fail(
      'E_FORMAT',
      `timezone "${timezone}" is not resolvable`,
      'use UTC or a fixed offset such as +05:30 (no host TZ database)',
      { timezone },
    )
  }
  const hours = Number(match[2]!)
  const minutes = Number(match[3]!)
  if (hours > 23 || minutes > 59) {
    return fail('E_FORMAT', `timezone "${timezone}" is out of range`, 'use an offset between -23:59 and +23:59', {
      timezone,
    })
  }
  return (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes)
}

/** Read UTC parts of a supplied instant, then apply a fixed offset if any. */
function partsFromDate(value: Date, offsetMinutes: number): DateParts {
  if (Number.isNaN(value.getTime())) {
    return fail('E_FORMAT', 'date value is invalid', 'supply a valid Date', {})
  }
  const minutes = value.getUTCHours() * 60 + value.getUTCMinutes() + offsetMinutes
  const dayShift = Math.floor(minutes / 1440)
  const minuteOfDay = ((minutes % 1440) + 1440) % 1440
  const civil = civilFromDays(daysFromCivil(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()) + dayShift)
  return {
    year: civil.year,
    month: civil.month,
    day: civil.day,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    second: value.getUTCSeconds(),
  }
}

function emitToken(token: string, parts: DateParts): string {
  switch (token) {
    case 'yyyy': return String(parts.year).padStart(4, '0')
    case 'yy': return String(parts.year % 100).padStart(2, '0')
    case 'MM': return String(parts.month).padStart(2, '0')
    case 'M': return String(parts.month)
    case 'dd': return String(parts.day).padStart(2, '0')
    case 'd': return String(parts.day)
    case 'HH': return String(parts.hour).padStart(2, '0')
    case 'H': return String(parts.hour)
    case 'mm': return String(parts.minute).padStart(2, '0')
    case 'm': return String(parts.minute)
    case 'ss': return String(parts.second).padStart(2, '0')
    case 's': return String(parts.second)
    default: return ''
  }
}

function formatParts(parts: DateParts, pattern: string): string {
  let out = ''
  let index = 0
  while (index < pattern.length) {
    const rest = pattern.slice(index)
    const token = DATE_TOKENS.find((candidate) => rest.startsWith(candidate))
    if (token) {
      out += emitToken(token, parts)
      index += token.length
      continue
    }
    const ch = pattern[index]!
    if (/[A-Za-z]/.test(ch)) {
      return fail('E_FORMAT', `unsupported date token "${ch}"`, 'use yyyy, yy, MM, M, dd, d, HH, mm, ss', {
        pattern,
      })
    }
    out += ch
    index += 1
  }
  return out
}

/**
 * Format a date from a declared pattern (`design §6`). A string is parsed as
 * wall-clock parts (`2008-07-07`), so no timezone can shift it; a supplied
 * `Date` is read with UTC getters and an optional fixed offset. The clock and
 * `Intl` are never consulted, and the default timezone is UTC (`§10`, A2/A17).
 */
export function formatDate(value: string | Date, pattern: string, timezone?: string): string {
  const offset = parseTimezone(timezone)
  let parts: DateParts
  if (typeof value === 'string') {
    parts = parseIsoParts(value)
  } else if (value instanceof Date) {
    parts = partsFromDate(value, offset)
  } else {
    return fail('E_FORMAT', 'date value must be a string or a Date', 'supply YYYY-MM-DD or a Date', {})
  }
  return formatParts(parts, pattern)
}

// ---------------------------------------------------------------------------
// Measurement oracle — injected, deterministic, fail-closed (design §9 / A32).
// ---------------------------------------------------------------------------

/** Input to the injected measurement oracle. `fontFamily` is a declared token. */
export interface MeasurementInput {
  text: string
  fontFamily: string
  fontSize: number
  lineHeight: number
  maxWidth: number
}

/** The dimensions the pagination pass needs before it can cut a sheet. */
export interface Measurement {
  width: number
  height: number
}

/**
 * The measurement contract (`design §9`, A32). The host injects one; this
 * package ships no DOM, browser or font-metric implementation of its own.
 */
export type MeasurementOracle = (input: MeasurementInput) => Measurement

/** Derived from the sure-ui map: the kept compatibility names, no local list. */
export const FONT_TOKENS = Object.keys(SURE_DOCUMENT_TYPOGRAPHY) as [
  SureDocumentTypographyKind,
  ...SureDocumentTypographyKind[],
]

/** A declared typography token name (compatibility alias). */
export type FontToken = SureDocumentTypographyKind

/** True when a font family token is one this renderer may declare. */
export function isFontToken(token: string): token is FontToken {
  return Object.prototype.hasOwnProperty.call(SURE_DOCUMENT_TYPOGRAPHY, token)
}

/**
 * Wrap a host-supplied measurer so an unresolvable font token fails with
 * `E_FONT` at call time rather than silently substituting a host font (A32).
 * The measurer receives the sure-ui point metrics for the declared token, so
 * measurement cannot drift from the CSS variable the markup uses (design §9).
 */
export function createMeasurementOracle(measure: (input: MeasurementInput) => Measurement): MeasurementOracle {
  return (input) => {
    const style = isFontToken(input.fontFamily) ? SURE_DOCUMENT_TYPOGRAPHY[input.fontFamily] : undefined
    if (!style) {
      return fail(
        'E_FONT',
        `font token "${input.fontFamily}" is not resolvable`,
        `declare one of: ${FONT_TOKENS.join(', ')}`,
        { fontFamily: input.fontFamily },
      )
    }
    return measure({ ...input, fontSize: style.ptSize, lineHeight: style.linePt })
  }
}
