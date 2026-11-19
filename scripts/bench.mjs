#!/usr/bin/env node
/**
 * Repeatable renderer benchmark. Measures the built package, not tsx sources.
 *
 *   npm run bench
 *
 * Reports wall-clock latency for three synthetic workloads. These are pure
 * renders: no browser, no PDF engine, no network, no clock in the renderer.
 * The script itself uses the clock only to measure the call.
 */
import { cpus, platform, arch } from 'node:os'
import { performance } from 'node:perf_hooks'
import { renderDocument } from '../dist/index.js'

const WARMUP = 20
const ITERATIONS = 200

const sheet = { size: 'letter', orientation: 'portrait', margins: 36 }

function text(x, y, w, h, value, expr) {
  return { kind: 'text', x, y, w, h, ...(expr ? { expr } : { text: value }) }
}

function formBands(count) {
  return [{
    height: 24 * count,
    elements: Array.from({ length: count }, (_, i) =>
      text(36, 36 + i * 24, 300, 16, `Test field ${i + 1}`)),
  }]
}

const rows = Array.from({ length: 40 }, (_, i) => ({
  dueDate: `203${1 + (i % 3)}-${String((i % 12) + 1).padStart(2, '0')}-15`,
  amount: 120.00 + i,
  description: `Test Person ${String.fromCharCode(65 + (i % 26))}`,
}))

const cases = [
  {
    name: 'fixed-form-12',
    describe: 'one letter sheet, 12 positioned text elements',
    input: {
      layout: { sheet, bands: formBands(12) },
      data: { params: {} },
    },
  },
  {
    name: 'statement-40',
    describe: 'one letter sheet, a 40-row table with two columns',
    input: {
      layout: {
        sheet,
        bands: [{
          height: 640,
          elements: [{
            kind: 'table', x: 36, y: 36, w: 540, h: 600,
            columns: [
              { label: 'Due date', field: 'dueDate' },
              { label: 'Description', field: 'description' },
              { label: 'Amount', field: 'amount' },
            ],
            rows,
          }],
        }],
      },
      data: { params: {} },
    },
  },
  {
    name: 'ten-sheets',
    describe: 'ten flat sibling sheets, six text elements each',
    input: {
      layout: {
        sheet,
        bands: formBands(6),
        panels: Array.from({ length: 10 }, () => formBands(6)),
      },
      data: { params: {} },
    },
  },
]

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
  return sorted[index]
}

function measure(name, describe, input) {
  for (let i = 0; i < WARMUP; i++) renderDocument(input)

  const times = new Array(ITERATIONS)
  let bytes = 0
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now()
    const result = renderDocument(input)
    times[i] = performance.now() - start
    if (!result.html.includes('@page')) throw new Error(`${name}: no @page rules emitted`)
    if (result.sheets.length !== result.sheetCount) throw new Error(`${name}: sheet count disagrees`)
    if (i === 0) bytes = Buffer.byteLength(result.html, 'utf8')
  }

  const sorted = [...times].sort((a, b) => a - b)
  const median = percentile(sorted, 0.5)
  return {
    name,
    describe,
    sheets: renderDocument(input).sheetCount,
    htmlBytes: bytes,
    minMs: sorted[0],
    medianMs: median,
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1],
    perSecond: 1000 / median,
  }
}

const results = cases.map((c) => measure(c.name, c.describe, c.input))

console.log(`sure-document benchmark — ${platform()} ${arch()}, ${cpus()[0]?.model ?? 'unknown CPU'}`)
console.log(`Node ${process.version}; ${WARMUP} warmup + ${ITERATIONS} measured renders per case\n`)
for (const r of results) {
  console.log(`${r.name} — ${r.describe}`)
  console.log(`  sheets=${r.sheets}  html=${r.htmlBytes} B  median=${r.medianMs.toFixed(3)} ms  p95=${r.p95Ms.toFixed(3)} ms  min=${r.minMs.toFixed(3)} ms  ~${Math.round(r.perSecond)} renders/s`)
}
console.log('\nPure in-memory renders. Browser print/PDF compilation happens in the host and is not measured here.')
