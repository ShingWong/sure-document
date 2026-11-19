/**
 * Seeded, deterministic, synthetic-only fixture generator
 * (docs/acceptance.md §2, AGENTS.md §Data hygiene).
 *
 * No clock, no `Math.random`, no network, no I/O except the CLI's stdout.
 * A regeneration with the same seed is a byte-for-byte no-op: `generatedAt`
 * is derived from the seed's digits, never from the machine's date.
 *
 *   npm run fixtures -- --shape rows --rows 40 --seed 20261119
 */

import { pathToFileURL } from 'node:url'

export type Shape = 'record' | 'rows' | 'series'

export interface GenerateOptions {
  shape: Shape
  seed: number
  rows?: number
  seriesPoints?: number
}

export interface Provenance {
  synthetic: true
  seed: number
  generatedAt: string
}

export interface GeneratedFixture extends Provenance {
  shape: Shape
  record?: Record<string, unknown>
  rows?: Row[]
  series?: Series
  totals: { grand_total: number }
}

interface Row {
  line_number: number
  due_on: string
  amount: number
  description: string
}

interface Series {
  tableFallback: true
  points: Array<{ label: string; value: number }>
}

const SHAPES: readonly Shape[] = ['record', 'rows', 'series']
const DEFAULT_ROWS = 10
const DEFAULT_SERIES_POINTS = 3
const MAX_SERIES_POINTS = 6

/** Invented names only — none of these belongs to a person or a client. */
const PARTIES = [
  'Test Person A',
  'Example Holdings LLC',
  'Sample Party C',
  'Placeholder Group',
] as const

const CATEGORIES = [
  'Alpha',
  'Beta',
  'Gamma',
  'Delta',
  'Epsilon',
  'Zeta',
] as const

const AMOUNT = 120
const BASE_MONTH = 4
const BASE_DAY = 15

/** Seed must be an 8-digit YYYYMMDD so `generatedAt` needs no clock. */
export function seedToGeneratedAt(seed: number): string {
  if (!Number.isInteger(seed) || seed < 10_000_000 || seed > 99_999_999) {
    throw new Error(`seed must be an 8-digit YYYYMMDD integer (got ${seed})`)
  }
  const digits = String(seed)
  const year = Number(digits.slice(0, 4))
  const month = Number(digits.slice(4, 6))
  const day = Number(digits.slice(6, 8))
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`seed is not a valid calendar date: ${digits}`)
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

/** mulberry32 — small, deterministic, and never `Math.random`. */
export function makePrng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return leap ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  let year = y
  let month = m
  let day = d + days
  while (day > daysInMonth(year, month)) {
    day -= daysInMonth(year, month)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/** The paper dates start five years after the seed year: 20261119 → 2031-04-15. */
function futureBase(seed: number): string {
  const year = Number(String(seed).slice(0, 4)) + 5
  return `${year}-${pad(BASE_MONTH, 2)}-${pad(BASE_DAY, 2)}`
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Produce generated fixture data. Pure: same options in, same object out. */
export function generateFixture(options: GenerateOptions): GeneratedFixture {
  const { shape, seed } = options
  if (!SHAPES.includes(shape)) {
    throw new Error(`unknown shape "${shape}"; expected one of ${SHAPES.join(', ')}`)
  }
  const generatedAt = seedToGeneratedAt(seed)
  const prng = makePrng(seed)
  const pick = <T,>(pool: readonly T[]): T => {
    const index = Math.floor(prng() * pool.length)
    return pool[index] as T
  }
  const provenance: Provenance = { synthetic: true, seed, generatedAt }

  if (shape === 'record') {
    return {
      ...provenance,
      shape,
      record: {
        line_number: 1,
        issued_on: futureBase(seed),
        party: pick(PARTIES),
        amount: AMOUNT,
      },
      totals: { grand_total: AMOUNT },
    }
  }

  if (shape === 'rows') {
    const count = options.rows ?? DEFAULT_ROWS
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      throw new Error(`rows must be an integer between 1 and 1000 (got ${count})`)
    }
    const base = futureBase(seed)
    const rows: Row[] = Array.from({ length: count }, (_, i) => ({
      line_number: i + 1,
      due_on: addDays(base, i * 30),
      amount: AMOUNT,
      description: pick(PARTIES),
    }))
    return {
      ...provenance,
      shape,
      rows,
      totals: { grand_total: round2(rows.reduce((sum, row) => sum + row.amount, 0)) },
    }
  }

  const count = options.seriesPoints ?? DEFAULT_SERIES_POINTS
  if (!Number.isInteger(count) || count < 2 || count > MAX_SERIES_POINTS) {
    throw new Error(`seriesPoints must be an integer between 2 and ${MAX_SERIES_POINTS} (got ${count})`)
  }
  const labels = [...CATEGORIES]
  const points: Array<{ label: string; value: number }> = []
  for (let i = 0; i < count; i += 1) {
    const at = Math.floor(prng() * labels.length)
    const [label] = labels.splice(at, 1)
    points.push({ label: label as string, value: AMOUNT * (i + 1) })
  }
  return {
    ...provenance,
    shape,
    series: {
      tableFallback: true,
      points,
    },
    totals: { grand_total: round2(points.reduce((sum, point) => sum + point.value, 0)) },
  }
}

export function parseArgs(argv: string[]): GenerateOptions {
  let shape: Shape | undefined
  let seed: number | undefined
  let rows: number | undefined
  let seriesPoints: number | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--help' || flag === '-h') {
      throw new Error('usage: fixtures [--shape record|rows|series] [--rows N] [--series-points N] [--seed YYYYMMDD]')
    }
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(`unexpected or incomplete argument: ${flag ?? ''}`)
    }
    if (flag === '--shape') {
      shape = value as Shape
    } else if (flag === '--seed') {
      seed = Number(value)
    } else if (flag === '--rows') {
      rows = Number(value)
    } else if (flag === '--series-points') {
      seriesPoints = Number(value)
    } else {
      throw new Error(`unknown flag "${flag}"; use --shape, --rows, --series-points or --seed`)
    }
    i += 1
  }

  if (shape === undefined) throw new Error('--shape is required (record, rows or series)')
  if (seed === undefined) throw new Error('--seed is required (8-digit YYYYMMDD)')
  return { shape, seed, rows, seriesPoints }
}

function main(): void {
  try {
    const fixture = generateFixture(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`fixtures: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
