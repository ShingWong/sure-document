#!/usr/bin/env node
// Regenerate examples/*.json from their seeds (docs/index.md §Generated,
// never hand-written). Run with `npm run fixtures:examples`. The replay gate
// (check-examples.mjs) is the proof that each generated example still runs.

import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateFixture } from '../fixtures/generate.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEED = 20261119

function write(name, example) {
  writeFileSync(join(ROOT, 'examples', name), `${JSON.stringify(example, null, 2)}\n`)
}

const record = generateFixture({ shape: 'record', seed: SEED })
write('fixed-record.json', {
  name: 'fixed-record',
  mode: 'fixed',
  shape: record.shape,
  synthetic: record.synthetic,
  seed: record.seed,
  generatedAt: record.generatedAt,
  layout: {
    mode: 'fixed',
    sheet: { size: 'letter', orientation: 'portrait' },
    bands: [{
      id: 'body',
      height: 200,
      elements: [
        { kind: 'text', id: 'party-label', x: 36, y: 36, w: 180, h: 14, value: 'Party' },
        { kind: 'field', id: 'party', x: 36, y: 56, w: 240, h: 14, value: 'P:party' },
      ],
    }],
  },
  data: { record: record.record, totals: record.totals },
  expect: {
    elements: 2,
    recordFields: Object.keys(record.record).length,
    total: record.totals.grand_total,
    contains: [record.record.party, record.record.issued_on],
  },
})

const rows = generateFixture({ shape: 'rows', seed: SEED, rows: 40 })
write('flow-rows-40.json', {
  name: 'flow-rows-40',
  mode: 'flow',
  shape: rows.shape,
  synthetic: rows.synthetic,
  seed: rows.seed,
  generatedAt: rows.generatedAt,
  layout: {
    mode: 'flow',
    sheet: { size: 'letter', orientation: 'portrait' },
    sections: [
      { id: 'header', repeat: 'all', elements: [{ kind: 'text', id: 'title', value: 'Statement of account' }] },
      { id: 'rows', repeat: 'rows', elements: [{ kind: 'field', id: 'description', value: 'P:description' }] },
      { id: 'totals', elements: [{ kind: 'field', id: 'grand-total', value: 'F:currency:grand_total' }] },
    ],
  },
  data: { rows: rows.rows, totals: rows.totals },
  expect: {
    rows: rows.rows.length,
    total: rows.totals.grand_total,
    contains: [rows.rows[0].due_on, rows.rows[rows.rows.length - 1].due_on],
  },
})

const series = generateFixture({ shape: 'series', seed: SEED, seriesPoints: 3 })
write('series-bars.json', {
  name: 'series-bars',
  mode: 'figure',
  shape: series.shape,
  synthetic: series.synthetic,
  seed: series.seed,
  generatedAt: series.generatedAt,
  layout: {
    mode: 'fixed',
    sheet: { size: 'letter', orientation: 'portrait' },
    bands: [{
      id: 'figure',
      height: 240,
      elements: [{
        kind: 'image',
        id: 'bars',
        x: 36,
        y: 36,
        w: 540,
        h: 180,
        figure: { type: 'bar', series: 'points', tableFallback: true },
      }],
    }],
  },
  data: { series: series.series, totals: series.totals },
  expect: {
    elements: 1,
    seriesPoints: series.series.points.length,
    total: series.totals.grand_total,
    contains: series.series.points.map((point) => point.label),
  },
})

console.log('examples regenerated from seed', SEED)
