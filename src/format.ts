/**
 * The closed expression vocabulary (design §5), the declared print formatters
 * (design §6), and the injected measurement contract (design §9 / A32).
 *
 * Pure and dependency-free: no clock, host locale, `Intl`, DOM or dynamic code
 * execution. Every value and every pattern is supplied by the caller, so the
 * same inputs always produce the same paper (A8, A9, A17).
 */

import { fail } from './errors.js'

/** The caller-supplied values an expression may read (`design §5`). */
export interface EvalContext {
  params?: Record<string, unknown>
  row?: Record<string, unknown>
}

/** The only value types an expression can produce. */
export type Scalar = string | number | null

type Source = 'P' | 'F' | ''

// ---------------------------------------------------------------------------
// Expressions — a fixed micro-parser, never an evaluator.
// ---------------------------------------------------------------------------

function toScalar(value: unknown, source: Source, name: string): Scalar {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  return fail(
    'E_EXPR',
    `${source}${name} is not a string, number or null`,
    `supply a scalar value for ${source}${name}`,
    { expr: `${source}${name}` },
  )
}

function lookup(name: string, ctx: EvalContext, source: Source): { found: boolean; value: Scalar } {
  const maps: Array<Record<string, unknown> | undefined> =
    source === 'P' ? [ctx.params] : source === 'F' ? [ctx.row] : [ctx.params, ctx.row]
  for (const map of maps) {
    if (map && Object.prototype.hasOwnProperty.call(map, name)) {
      return { found: true, value: toScalar(map[name], source, name) }
    }
  }
  return { found: false, value: null }
}

function candidateNames(ctx: EvalContext, source: Source): string[] {
  if (source === 'P') return Object.keys(ctx.params ?? {})
  if (source === 'F') return Object.keys(ctx.row ?? {})
  return [...new Set([...Object.keys(ctx.params ?? {}), ...Object.keys(ctx.row ?? {})])]
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

function requireScalar(name: string, ctx: EvalContext, source: Source): Scalar {
  if (name.length === 0) {
    return fail('E_EXPR', 'empty name', `supply a name after ${source || 'the expression'}`, { expr: source })
  }
  const hit = lookup(name, ctx, source)
  if (hit.found) return hit.value
  const label = source ? `${source}:${name}` : name
  const near = nearestName(name, candidateNames(ctx, source))
  const nearLabel = near ? (source ? `${source}:${near}` : near) : undefined
  const hint = nearLabel ? `did you mean ${nearLabel}?` : `supply ${label}`
  return fail('E_EXPR', `missing ${label}`, hint, { expr: label })
}

/** Split the operand list of `sum:` / `sub:`; an empty slot is a hard error. */
function splitOperands(body: string, form: string): string[] {
  const parts = body.split(',').map((part) => part.trim())
  if (parts.some((part) => part.length === 0)) {
    return fail('E_EXPR', `${form} has an empty operand`, `use ${form}:A,B`, { expr: form })
  }
  return parts
}

/** A reference may carry its own `P:` / `F:` prefix, or inherit a default. */
function parseRef(raw: string): { source: Source; name: string } {
  if (raw.startsWith('P:')) return { source: 'P', name: raw.slice(2) }
  if (raw.startsWith('F:')) return { source: 'F', name: raw.slice(2) }
  return { source: '', name: raw }
}

function numericOperand(raw: string, ctx: EvalContext): number {
  const { source, name } = parseRef(raw)
  const value = requireScalar(name, ctx, source === '' ? 'P' : source)
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('E_EXPR', `operand "${raw}" is not a finite number`, `supply a numeric parameter for "${raw}"`, {
      expr: raw,
    })
  }
  return value
}

/** `guardPresent` is deliberately non-throwing: absence is the guard's point. */
function guardPresent(raw: string, ctx: EvalContext): boolean {
  const { source, name } = parseRef(raw)
  if (name.length === 0) return false
  const sources: Array<'P' | 'F'> = source === 'P' || source === 'F' ? [source] : ['P', 'F']
  for (const from of sources) {
    const map = from === 'P' ? ctx.params : ctx.row
    if (map && Object.prototype.hasOwnProperty.call(map, name)) {
      const value = map[name]
      if (value !== null && value !== undefined) return true
    }
  }
  return false
}

/** The `Then` of `ifpresent:` may be any expression form, or a bare name. */
function evalThen(raw: string, ctx: EvalContext): Scalar {
  const colon = raw.indexOf(':')
  const form = colon === -1 ? '' : raw.slice(0, colon)
  if (form === 'P' || form === 'F' || form === 'sum' || form === 'sub' || form === 'ifpresent') {
    return evaluate(raw, ctx)
  }
  return requireScalar(raw, ctx, '')
}

/**
 * Evaluate one of the five forms in `design §5`: `P:Name`, `F:Name`,
 * `sum:A,B,C`, `sub:A,B`, `ifpresent:Guard->Then`. An unknown form, a missing
 * name, or a non-numeric arithmetic operand throws `E_EXPR` with an actionable
 * hint; nothing is ever silently blank unless an `ifpresent` guard says so.
 */
export function evaluate(expr: string, ctx: EvalContext): Scalar {
  const text = expr.trim()
  if (text.length === 0) {
    return fail('E_EXPR', 'empty expression', 'use P:, F:, sum:, sub: or ifpresent:', { expr })
  }
  const colon = text.indexOf(':')
  const form = colon === -1 ? '' : text.slice(0, colon)
  const body = colon === -1 ? '' : text.slice(colon + 1)

  switch (form) {
    case 'P':
      return requireScalar(body.trim(), ctx, 'P')
    case 'F':
      return requireScalar(body.trim(), ctx, 'F')
    case 'sum': {
      const operands = splitOperands(body.trim(), 'sum')
      let total = 0
      for (const operand of operands) total += numericOperand(operand, ctx)
      return total
    }
    case 'sub': {
      const operands = splitOperands(body.trim(), 'sub')
      if (operands.length !== 2) {
        return fail('E_EXPR', `sub needs exactly two operands, got ${operands.length}`, 'use sub:A,B', {
          expr: text,
        })
      }
      return numericOperand(operands[0]!, ctx) - numericOperand(operands[1]!, ctx)
    }
    case 'ifpresent': {
      const arrow = body.indexOf('->')
      if (arrow === -1) {
        return fail('E_EXPR', 'ifpresent is missing ->', 'use ifpresent:Guard->Then', { expr: text })
      }
      const guard = body.slice(0, arrow).trim()
      const then = body.slice(arrow + 2).trim()
      if (guard.length === 0 || then.length === 0) {
        return fail('E_EXPR', 'ifpresent needs both a guard and a value', 'use ifpresent:Guard->Then', { expr: text })
      }
      return guardPresent(guard, ctx) ? evalThen(then, ctx) : null
    }
    default:
      return fail(
        'E_EXPR',
        `unknown expression form "${form.length > 0 ? `${form}:` : text}"`,
        'supported forms: P:, F:, sum:, sub:, ifpresent:',
        { expr: text },
      )
  }
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

/** The local alias set for declared typography tokens; the token itself lives in sure-ui. */
export const FONT_TOKENS = ['body', 'heading', 'caption', 'mono'] as const

/** A declared typography token name. */
export type FontToken = (typeof FONT_TOKENS)[number]

/** True when a font family token is one this renderer may declare. */
export function isFontToken(token: string): token is FontToken {
  return (FONT_TOKENS as readonly string[]).includes(token)
}

/**
 * Wrap a host-supplied measurer so an unresolvable font token fails with
 * `E_FONT` at call time rather than silently substituting a host font (A32).
 */
export function createMeasurementOracle(measure: (input: MeasurementInput) => Measurement): MeasurementOracle {
  return (input) => {
    if (!isFontToken(input.fontFamily)) {
      return fail(
        'E_FONT',
        `font token "${input.fontFamily}" is not resolvable`,
        `declare one of: ${FONT_TOKENS.join(', ')}`,
        { fontFamily: input.fontFamily },
      )
    }
    return measure(input)
  }
}
