#!/usr/bin/env node
// Link + anchor check and no-orphan check (AGENTS.md §Documentation duties,
// docs/index.md §Generated, never hand-written). A doc that points at a missing
// file or a stale heading, or a docs/ page nobody links to, fails the gate.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.positronic', 'graphify-out'])
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const HEADING_RE = /^#{1,6}\s+(.+?)\s*#*$/gm

function walkMarkdown(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walkMarkdown(full, acc)
    } else if (entry.endsWith('.md')) {
      acc.push(full)
    }
  }
  return acc
}

/** GitHub-style heading slug: lower, drop punctuation, spaces → hyphens. */
export function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function anchorsOf(markdown) {
  const anchors = new Set()
  for (const match of markdown.matchAll(HEADING_RE)) {
    const heading = match[1]
    if (heading) anchors.add(slug(heading))
  }
  return anchors
}

/** Remove fenced code blocks and inline code so snippets are not scanned. */
function stripCode(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '')
}

const cache = new Map()
function readMarkdown(file, problems) {
  if (!cache.has(file)) {
    if (!existsSync(file)) {
      problems.push(`link target is missing: ${file}`)
      cache.set(file, '')
      return { text: '', anchors: new Set() }
    }
    if (!statSync(file).isFile()) return { text: '', anchors: new Set() } // directory link
    const text = readFileSync(file, 'utf8')
    cache.set(file, { text, anchors: anchorsOf(text) })
  }
  const entry = cache.get(file)
  return typeof entry === 'string' ? { text: entry, anchors: new Set() } : entry
}

/** @param {string} root @returns {string[]} */
export function checkDocs(root = ROOT) {
  cache.clear()
  /** @type {string[]} */
  const problems = []
  const files = walkMarkdown(root)
  if (files.length === 0) return [`no markdown files found (root: ${root})`]
  const index = join(root, 'docs', 'index.md')
  if (!existsSync(index)) problems.push('docs/index.md is missing')

  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/')
    const text = stripCode(readFileSync(file, 'utf8'))
    for (const match of text.matchAll(LINK_RE)) {
      const target = match[1]
      if (!target) continue
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue
      const [pathPart, anchor] = target.split('#')
      const resolved = pathPart
        ? resolve(dirname(file), decodeURIComponent(pathPart))
        : file
      const info = readMarkdown(resolved, problems)
      if (!existsSync(resolved)) continue // already reported
      if (anchor && !info.anchors.has(decodeURIComponent(anchor))) {
        problems.push(`${rel}: anchor #${anchor} not found in ${relative(root, resolved).split(sep).join('/')}`)
      }
    }
  }

  // No orphan pages: every docs/*.md (except the index) is linked from it.
  if (existsSync(index)) {
    const indexText = stripCode(readFileSync(index, 'utf8'))
    for (const file of files) {
      const rel = relative(root, file).split(sep).join('/')
      if (!rel.startsWith('docs/') || rel === 'docs/index.md') continue
      const target = relative(dirname(index), file).split(sep).join('/')
      if (!indexText.includes(`](${target})`) && !indexText.includes(`](${target}#`)) {
        problems.push(`orphan doc: ${rel} is not linked from docs/index.md`)
      }
    }
  }
  return problems
}

function main() {
  const problems = checkDocs()
  if (problems.length > 0) {
    console.error('documentation links failed:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('documentation links OK (targets, anchors and no orphans)')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
