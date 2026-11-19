import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  generateFixture,
  makePrng,
  parseArgs,
  seedToGeneratedAt,
  type GenerateOptions,
} from '../fixtures/generate.ts'

const SEED = 20261119
const opts: GenerateOptions = { shape: 'rows', seed: SEED, rows: 40 }

afterEach(() => vi.restoreAllMocks())

describe('seed → generatedAt', () => {
  it('derives the date from the seed digits, not the clock', () => {
    expect(seedToGeneratedAt(SEED)).toBe('2026-11-19')
  })

  it('rejects non-dates and non-8-digit seeds', () => {
    expect(() => seedToGeneratedAt(42)).toThrow(/8-digit/)
    expect(() => seedToGeneratedAt(20260230)).toThrow(/calendar date/)
  })

  it('does not call Date.now or Math.random', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock read') })
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random read') })
    expect(generateFixture(opts).generatedAt).toBe('2026-11-19')
  })
})

describe('PRNG', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = makePrng(SEED)
    const b = makePrng(SEED)
    const c = makePrng(SEED + 1)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(a()).not.toBe(c())
  })
})

describe('fixture shapes', () => {
  it('is byte-identical on regeneration', () => {
    expect(JSON.stringify(generateFixture(opts))).toBe(JSON.stringify(generateFixture(opts)))
  })

  it('records provenance on every shape', () => {
    for (const shape of ['record', 'rows', 'series'] as const) {
      const fixture = generateFixture({ shape, seed: SEED })
      expect(fixture.synthetic).toBe(true)
      expect(fixture.seed).toBe(SEED)
      expect(fixture.generatedAt).toBe('2026-11-19')
      expect(fixture.shape).toBe(shape)
    }
  })

  it('emits future, monotonic dates and two-decimal amounts for rows', () => {
    const fixture = generateFixture(opts)
    const dates = fixture.rows!.map((row) => row.due_on)
    expect(dates).toHaveLength(40)
    expect(dates[0]).toBe('2031-04-15')
    expect([...dates].sort()).toEqual(dates)
    expect(new Set(dates).size).toBe(40)
    for (const row of fixture.rows!) {
      expect(Number.isInteger(row.amount * 100)).toBe(true)
      expect(row.description).toMatch(/^(Test Person A|Example Holdings LLC|Sample Party C|Placeholder Group)$/)
    }
    expect(fixture.totals.grand_total).toBe(40 * 120)
  })

  it('rejects invalid options with an actionable hint', () => {
    expect(() => generateFixture({ shape: 'bad' as never, seed: SEED })).toThrow(/unknown shape/)
    expect(() => generateFixture({ shape: 'rows', seed: SEED, rows: 0 })).toThrow(/between 1 and 1000/)
    expect(() => generateFixture({ shape: 'series', seed: SEED, seriesPoints: 9 })).toThrow(/between 2 and 6/)
  })

  it('parses the documented CLI form', () => {
    expect(parseArgs(['--shape', 'rows', '--rows', '40', '--seed', '20261119'])).toEqual(opts)
    expect(() => parseArgs(['--shape', 'rows'])).toThrow(/--seed is required/)
    expect(() => parseArgs(['--shape', 'rows', '--seed', '20261119', '--bogus', '1'])).toThrow(/unknown flag/)
  })
})
