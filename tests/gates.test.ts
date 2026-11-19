import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { checkExports } from '../scripts/check-exports.mjs'
import { checkErrorCodes } from '../scripts/check-errors.mjs'
import { checkDocs, slug } from '../scripts/check-docs.mjs'
import { checkExamples } from '../scripts/check-examples.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempRoots: string[] = []

function tempRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'sure-document-gate-'))
  tempRoots.push(root)
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  return root
}

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})

describe('checkExports', () => {
  it('fails when an exports-map target is not in the build output', () => {
    const root = tempRoot({
      'package.json': JSON.stringify({
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
        main: './dist/index.js',
        files: ['dist'],
      }),
    })
    expect(checkExports(root).join('\n')).toMatch(/missing from the build output/)
  })

  it('passes once every target exists', () => {
    const root = tempRoot({
      'package.json': JSON.stringify({
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
        main: './dist/index.js',
        files: ['dist'],
      }),
      'dist/index.js': 'export {}',
      'dist/index.d.ts': 'export {}',
    })
    expect(checkExports(root)).toEqual([])
  })
})

describe('checkErrorCodes', () => {
  it('is clean for the repository (src ↔ docs/errors.md)', () => {
    expect(checkErrorCodes(ROOT)).toEqual([])
  })

  it('fails in both directions on a deliberately broken input', () => {
    const root = tempRoot({
      'docs/errors.md': '| Code | Exit |\n| --- | --- |\n| `E_GUARD` | 3 |\n',
      'src/render.ts': "throw { code: 'E_NO_SUCH_CODE' }\n",
    })
    const problems = checkErrorCodes(root).join('\n')
    expect(problems).toMatch(/E_NO_SUCH_CODE, but docs\/errors.md has no row/)
    expect(problems).toMatch(/E_GUARD.*but no code in src\/ declares it/)
  })

  it('ignores codes mentioned only in comments', () => {
    const root = tempRoot({
      'docs/errors.md': '| Code | Exit |\n| --- | --- |\n| `E_GUARD` | 3 |\n',
      'src/render.ts': "// historically threw 'E_COMMENT_ONLY'\nthrow { code: 'E_GUARD' }\n",
    })
    expect(checkErrorCodes(root)).toEqual([])
  })
})

describe('checkDocs', () => {
  it('is clean for the repository (targets, anchors, no orphans)', () => {
    expect(checkDocs(ROOT)).toEqual([])
  })

  it('generates GitHub-style heading slugs', () => {
    expect(slug('Reading order — an agent')).toBe('reading-order-an-agent')
    expect(slug('When to update what')).toBe('when-to-update-what')
  })

  it('fails on a missing link target and a stale anchor', () => {
    const root = tempRoot({
      'docs/index.md': '# Index\n\n[gone](missing.md) [bad](page.md#old-heading)\n',
      'docs/page.md': '# Page\n\n## New heading\n',
      'docs/orphan.md': '# Orphan\n',
    })
    const problems = checkDocs(root).join('\n')
    expect(problems).toMatch(/link target is missing/)
    expect(problems).toMatch(/anchor #old-heading not found/)
    expect(problems).toMatch(/orphan doc: docs\/orphan.md/)
  })
})

describe('checkExamples', () => {
  it('is clean for the generated examples', () => {
    expect(checkExamples(ROOT)).toEqual([])
  })

  it('fails on stale provenance, a missing declaration and no assertions', () => {
    const root = tempRoot({
      'examples/README.md': '| Name | Shows |\n| --- | --- |\n| `missing.json` | absent |\n| `bad.json` | broken |\n',
      'examples/bad.json': JSON.stringify({
        name: 'bad', mode: 'fixed', shape: 'rows', synthetic: false, seed: 20261119,
        generatedAt: '2031-04-15', layout: { mode: 'fixed' }, data: { rows: [] }, expect: {},
      }),
    })
    const problems = checkExamples(root).join('\n')
    expect(problems).toMatch(/declares missing.json, but the file is missing/)
    expect(problems).toMatch(/missing "synthetic": true/)
    expect(problems).toMatch(/generatedAt is not derived from the seed/)
    expect(problems).toMatch(/no expectations/)
  })
})

describe('security gate patterns', () => {
  // The gate fails closed, so its own patterns need tests: two of them were
  // wrong in the first release and nothing noticed, because the only consumer
  // of the gate is the hook and CI — both of which were green.
  it('finds the commonest internal range, at four octets', async () => {
    const { scanText } = await import('../scripts/security-check.mjs')
    for (const host of ['192.168.4.53', '10.0.0.19', '172.16.0.1']) {
      expect(scanText(`host ${host}`, 'docs/x.md').map((f) => f.label)).toContain('Private IP address')
    }
    // A public address is not a finding.
    expect(scanText('host 69.45.229.53', 'docs/x.md')).toEqual([])
  })

  it('does not report a long decimal as a card number', async () => {
    const { scanText } = await import('../scripts/security-check.mjs')
    // A money figure such as 1480.8000000000002 contains a 13-digit run that
    // passes Luhn; reporting floats as cards buries the real findings.
    expect(scanText('{"totalDP": 1480.8000000000002}', 'examples/x.json')).toEqual([])
    // A real card still fires.
    expect(scanText('card 4111111111111111', 'docs/x.md').map((f) => f.label)).toContain('Card number')
  })

  it('treats a licence header as a declaration and prose as a leak', async () => {
    const { scanText } = await import('../scripts/security-check.mjs')
    const header = scanText('// Copyright (c) 2026 Someone <owner@real-company.com>.', 'src/x.ts')
    expect(header).toEqual([])
    const prose = scanText('Write to owner@real-company.com for access.', 'docs/x.md')
    expect(prose.map((f) => f.label)).toContain('Email address')
  })
})
