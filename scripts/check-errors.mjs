#!/usr/bin/env node
// Bidirectional error-code coverage (docs/index.md §Generated, never hand-written).
// A code declared in src/ with no row in docs/errors.md is a lie in the agent
// envelope; a row with no code is a promise the renderer never keeps. Both fail.
// Quoted code literals are found anywhere in src/, so a new throw site is
// caught without maintaining a second hand-written list.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CODE_RE = /['"`](E[A-Z_][A-Z0-9_]*)['"`]/g
const DOC_ROW_RE = /^\|\s*`([^`]+)`\s*\|/

/** Blank out comments while preserving quoted strings (which carry codes). */
function stripComments(text) {
  let out = ''
  let state = 'code'
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; out += '  '; i += 1; continue }
      if (ch === '/' && next === '*') { state = 'block'; out += '  '; i += 1; continue }
      if (ch === "'" || ch === '"' || ch === '`') state = ch
      out += ch
      continue
    }
    if (state === 'line') {
      if (ch === '\n') { state = 'code'; out += ch } else out += ' '
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; out += '  '; i += 1; continue }
      out += ch === '\n' ? '\n' : ' '
      continue
    }
    // Inside a string: keep the literal, honour escapes, return on its closer.
    out += ch
    if (ch === '\\') { out += text[i + 1] ?? ''; i += 1; continue }
    if (ch === state) state = 'code'
  }
  return out
}

function walkCode(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      walkCode(full, acc)
    } else if (/\.(?:ts|mts|cts|tsx)$/.test(entry)) {
      acc.push(full)
    }
  }
  return acc
}

/** @param {string} root @returns {string[]} */
export function checkErrorCodes(root = ROOT) {
  /** @type {string[]} */
  const problems = []
  const docPath = join(root, 'docs', 'errors.md')
  if (!existsSync(docPath)) return [`docs/errors.md is missing (root: ${root})`]

  /** @type {Map<string, number>} */
  const documented = new Map()
  const lines = readFileSync(docPath, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    const match = DOC_ROW_RE.exec(line)
    if (!match) return
    const code = match[1]
    if (documented.has(code)) {
      problems.push(`docs/errors.md:${i + 1} duplicates code ${code}`)
    }
    documented.set(code, i + 1)
  })
  if (documented.size === 0) {
    problems.push('docs/errors.md has no error-code table rows')
  }

  /** @type {Map<string, string>} */
  const inSource = new Map()
  for (const file of walkCode(join(root, 'src'))) {
    const clean = stripComments(readFileSync(file, 'utf8'))
    for (const match of clean.matchAll(CODE_RE)) {
      const code = match[1]
      if (!code) continue
      const rel = relative(root, file).split(sep).join('/')
      if (!inSource.has(code)) inSource.set(code, rel)
    }
  }

  for (const [code, file] of inSource) {
    if (!documented.has(code)) {
      problems.push(`${file} declares ${code}, but docs/errors.md has no row for it`)
    }
  }
  for (const [code, line] of documented) {
    if (!inSource.has(code)) {
      problems.push(`docs/errors.md:${line} documents ${code}, but no code in src/ declares it`)
    }
  }
  return problems
}

function main() {
  const problems = checkErrorCodes()
  if (problems.length > 0) {
    console.error('error-code coverage failed:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('error-code coverage OK (src ↔ docs in sync)')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
