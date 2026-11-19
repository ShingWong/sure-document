#!/usr/bin/env node
// Resolve sure-ui's typography into a checked-in, import-free module.
// sure-ui owns the values (design §9 / A32); this script is the only bridge and
// makes the resolution deterministic, inspectable and diffable. No runtime
// dependency is added to the renderer by the generated module.

import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SURE_TYPOGRAPHY } from '@shing.wong/sure-ui'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const GENERATED_PATH = join(ROOT, 'src', 'typography.generated.ts')

const FIELDS = ['css', 'ptSize', 'linePt', 'weight']

function quote(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** Fail loudly if upstream changes shape: a partial map is worse than a stale one. */
function validate(typography) {
  if (typography === null || typeof typography !== 'object' || Array.isArray(typography)) {
    throw new Error('SURE_TYPOGRAPHY is not an object')
  }
  for (const [kind, style] of Object.entries(typography)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(kind)) throw new Error(`invalid typography key: ${kind}`)
    if (style === null || typeof style !== 'object' || Array.isArray(style)) {
      throw new Error(`SURE_TYPOGRAPHY.${kind} is not an object`)
    }
    for (const field of FIELDS) {
      const value = style[field]
      if (field === 'css' ? typeof value !== 'string' : typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`SURE_TYPOGRAPHY.${kind}.${field} is not a ${field === 'css' ? 'string' : 'finite number'}`)
      }
    }
  }
  if (Object.keys(typography).length === 0) throw new Error('SURE_TYPOGRAPHY is empty')
}

/** The exact bytes `typography:generate` writes; shared with check:typography. */
export function renderTypographyModule(typography = SURE_TYPOGRAPHY) {
  validate(typography)
  const lines = [
    '/**',
    ' * GENERATED — do not edit. Run `npm run typography:generate`.',
    ' * Resolved from SURE_TYPOGRAPHY in @shing.wong/sure-ui, the sole source of',
    ' * truth for document typography (design §9, A32). No imports, no functions.',
    ' */',
    '',
    'export interface SureDocumentTypographyStyle {',
    '  readonly css: string',
    '  readonly ptSize: number',
    '  readonly linePt: number',
    '  readonly weight: number',
    '}',
    '',
    'export const SURE_DOCUMENT_TYPOGRAPHY = {',
  ]
  for (const [kind, style] of Object.entries(typography)) {
    lines.push(`  ${kind}: {`)
    lines.push(`    css: ${quote(style.css)},`)
    lines.push(`    ptSize: ${style.ptSize},`)
    lines.push(`    linePt: ${style.linePt},`)
    lines.push(`    weight: ${style.weight},`)
    lines.push('  },')
  }
  lines.push('} as const satisfies Record<string, SureDocumentTypographyStyle>')
  lines.push('')
  lines.push('export type SureDocumentTypographyKind = keyof typeof SURE_DOCUMENT_TYPOGRAPHY')
  lines.push('')
  return lines.join('\n')
}

export function generate(root = ROOT) {
  writeFileSync(join(root, 'src', 'typography.generated.ts'), renderTypographyModule(), 'utf8')
}

function main() {
  generate()
  console.log(`wrote src/typography.generated.ts (${Object.keys(SURE_TYPOGRAPHY).length} styles from sure-ui)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
