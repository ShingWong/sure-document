#!/usr/bin/env node
// Stale-generated-module gate. Regenerates from the installed sure-ui into a
// temp file and diffs against the committed module, so a typography change
// upstream cannot reach paper without a reviewed diff here.

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderTypographyModule } from './generate-typography.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_DIFF_LINES = 40

function lineDiff(committed, regenerated) {
  const before = committed.split('\n')
  const after = regenerated.split('\n')
  const out = []
  const end = Math.max(before.length, after.length)
  for (let i = 0; i < end && out.length < MAX_DIFF_LINES; i += 1) {
    if (before[i] === after[i]) continue
    if (before[i] !== undefined) out.push(`-${i + 1}: ${before[i]}`)
    if (after[i] !== undefined) out.push(`+${i + 1}: ${after[i]}`)
  }
  if (out.length === MAX_DIFF_LINES) out.push('… (diff truncated)')
  return out
}

/**
 * @param {string} root
 * @returns {string[]} problems; empty when the committed module is current
 */
export function checkTypography(root = ROOT) {
  const path = join(root, 'src', 'typography.generated.ts')
  if (!existsSync(path)) {
    return [`src/typography.generated.ts is missing (run npm run typography:generate)`]
  }
  const committed = readFileSync(path, 'utf8')
  const regenerated = renderTypographyModule()
  if (committed === regenerated) return []

  const tempDir = mkdtempSync(join(tmpdir(), 'sure-document-typography-'))
  const tempPath = join(tempDir, 'typography.generated.ts')
  writeFileSync(tempPath, regenerated, 'utf8') // kept so the mismatch can be inspected
  return [
    'src/typography.generated.ts is stale (run npm run typography:generate)',
    `  committed:  ${path}`,
    `  regenerated: ${tempPath}`,
    ...lineDiff(committed, regenerated),
  ]
}

function main() {
  const problems = checkTypography()
  if (problems.length > 0) {
    console.error('typography is out of sync with sure-ui:')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }
  console.log('typography OK (src/typography.generated.ts matches installed sure-ui)')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
