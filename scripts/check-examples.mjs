#!/usr/bin/env node
// Example-replay gate (examples/README.md rule 4, docs/index.md §Generated).
// There is no renderer yet (Phase 4), so "replay" here means: execute the
// fixture's declared expectations against the fixture's layout and data. A
// stale example, a missing assertion or an undeclared file fails the gate —
// the same check the renderer-backed replay will extend in Phase 4.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHAPES = new Set(['record', 'rows', 'series'])
const MODES = new Set(['fixed', 'flow', 'figure'])
const EXPECT_KEYS = new Set(['elements', 'rows', 'recordFields', 'seriesPoints', 'total', 'contains'])

function declaredExamples(root) {
  const readme = join(root, 'examples', 'README.md')
  if (!existsSync(readme)) return null
  const names = new Set()
  for (const match of readFileSync(readme, 'utf8').matchAll(/`([a-z0-9-]+\.json)`/g)) {
    names.add(match[1])
  }
  return names
}

function countElements(layout) {
  let count = 0
  for (const el of layout.elements ?? []) count += 1
  for (const band of layout.bands ?? []) {
    for (const el of band.elements ?? []) count += 1
  }
  return count
}

function replay(example, problems, label) {
  const expect = example.expect
  for (const key of Object.keys(expect)) {
    if (!EXPECT_KEYS.has(key)) {
      problems.push(`${label}: unknown expectation "${key}" (typo or stale assertion)`)
    }
  }
  const layoutData = JSON.stringify({ layout: example.layout, data: example.data })
  const rows = example.data?.rows ?? []
  const record = example.data?.record ?? {}
  const points = example.data?.series?.points ?? []

  if ('elements' in expect && countElements(example.layout) !== expect.elements) {
    problems.push(`${label}: expect.elements ${expect.elements} != ${countElements(example.layout)}`)
  }
  if ('rows' in expect && rows.length !== expect.rows) {
    problems.push(`${label}: expect.rows ${expect.rows} != ${rows.length}`)
  }
  if ('recordFields' in expect && Object.keys(record).length !== expect.recordFields) {
    problems.push(`${label}: expect.recordFields ${expect.recordFields} != ${Object.keys(record).length}`)
  }
  if ('seriesPoints' in expect && points.length !== expect.seriesPoints) {
    problems.push(`${label}: expect.seriesPoints ${expect.seriesPoints} != ${points.length}`)
  }
  if ('total' in expect && example.data?.totals?.grand_total !== expect.total) {
    problems.push(`${label}: expect.total ${expect.total} != ${example.data?.totals?.grand_total}`)
  }
  for (const needle of expect.contains ?? []) {
    if (!layoutData.includes(needle)) problems.push(`${label}: expect.contains "${needle}" not present in layout/data`)
  }
}

/** @param {string} root @returns {string[]} */
export function checkExamples(root = ROOT) {
  /** @type {string[]} */
  const problems = []
  const dir = join(root, 'examples')
  if (!existsSync(dir)) return [`examples/ is missing (root: ${root})`]
  const declared = declaredExamples(root)
  if (declared === null) return ['examples/README.md is missing']

  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  for (const name of declared) {
    if (!files.includes(name)) problems.push(`examples/README.md declares ${name}, but the file is missing`)
  }
  for (const name of files) {
    if (!declared.has(name)) problems.push(`${name} is not declared in examples/README.md`)
  }

  for (const name of files) {
    const label = `examples/${name}`
    let example
    try {
      example = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    } catch (error) {
      problems.push(`${label}: invalid JSON (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    if (example.synthetic !== true) problems.push(`${label}: missing "synthetic": true`)
    if (!Number.isInteger(example.seed)) problems.push(`${label}: missing integer seed`)
    const digits = String(example.seed ?? '').replace(/-/g, '')
    if (typeof example.generatedAt !== 'string' || example.generatedAt.replace(/-/g, '') !== digits) {
      problems.push(`${label}: generatedAt is not derived from the seed (expected ${digits})`)
    }
    if (example.name !== name.replace(/\.json$/, '')) problems.push(`${label}: name field does not match the filename`)
    if (!MODES.has(example.mode)) problems.push(`${label}: unknown mode "${example.mode}"`)
    if (!SHAPES.has(example.shape)) problems.push(`${label}: unknown shape "${example.shape}"`)
    if (!['fixed', 'flow'].includes(example.layout?.mode)) {
      problems.push(`${label}: layout.mode must be fixed or flow (got "${example.layout?.mode}")`)
    }
    if (['fixed', 'flow'].includes(example.mode) && example.layout?.mode !== example.mode) {
      problems.push(`${label}: layout.mode disagrees with mode`)
    }
    if (example.layout === undefined || example.data === undefined) problems.push(`${label}: layout or data is missing`)
    if (example.expect === undefined || Object.keys(example.expect).length === 0) {
      problems.push(`${label}: no expectations — an example without an assertion is just a file`)
    } else {
      replay(example, problems, label)
    }
  }
  return problems
}

function main() {
  const problems = checkExamples()
  if (problems.length > 0) {
    console.error('example replay failed:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log(`example replay OK (${readdirSync(join(ROOT, 'examples')).filter((f) => f.endsWith('.json')).length} examples)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
