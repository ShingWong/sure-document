#!/usr/bin/env node
// Verify every entry in package.json "exports" points at a file the build
// actually produced. The exports map is the public surface; a stale path there
// fails only for consumers, at install time, rather than in the source tree.
// Same shape as sure-factor's script, with an injectable root so the gate can
// be tested against a deliberately broken package.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** @param {string} root @returns {string[]} */
export function checkExports(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  /** @type {string[]} */
  const problems = []

  for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
    const label = subpath === '.' ? '. (root)' : subpath
    for (const [field, value] of Object.entries(entry)) {
      if (typeof value !== 'string') continue
      if (!existsSync(join(root, value))) {
        problems.push(`${label}: exports.${field} -> ${value} (missing from the build output)`)
      }
    }
  }

  for (const field of ['main', 'module', 'types']) {
    const value = pkg[field]
    if (typeof value === 'string' && !existsSync(join(root, value))) {
      problems.push(`${field} -> ${value} (missing from the build output)`)
    }
  }

  if (pkg.files && !pkg.files.includes('dist')) {
    problems.push('files does not include dist, so the exports map cannot resolve for consumers')
  }
  return problems
}

function main() {
  const problems = checkExports()
  if (problems.length > 0) {
    console.error('package exports are inconsistent with the build output:')
    for (const p of problems) console.error(`  - ${p}`)
    console.error('\nRun `npm run build` first.')
    process.exit(1)
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  console.log(`package exports OK (${Object.keys(pkg.exports ?? {}).length} subpaths resolved)`)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
