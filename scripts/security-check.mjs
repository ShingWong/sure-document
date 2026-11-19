/**
 * Repository security gate: keys, credentials, PII, internal paths, and the
 * synthetic-fixture contract.
 *
 * Scans every tracked file plus the files npm always ships (README.md, LICENSE,
 * package.json). Binary files are skipped — and *reported*, because a committed
 * screenshot can carry PII the gate cannot read.
 *
 * With git available, content is read from the **index blob** — what the commit
 * will actually contain — not from the working tree, so a staged-then-deleted
 * file cannot slip past the hook, and an unstaged edit cannot block an unrelated
 * commit. Outside git (a tarball, `npm pack`) it falls back to the files on disk.
 *
 * Dependency-free on purpose: the hook and `prepublishOnly` must not fetch
 * anything, so this runs under plain `node` on a fresh clone.
 *
 * Usage:
 *   node scripts/security-check.mjs                # scan, exit 1 on findings
 *   SUN_DENYLIST=/path/to/words.txt node …         # also ban product literals
 *
 * `SUN_DENYLIST` names a file of one literal per line (blank lines and `#`
 * comments ignored) that must not appear in this repository at all. That is how
 * a *public* project proves no product names, addresses or identifiers were
 * copied into it: the words live in the consumer's CI, never in this repo.
 *
 * This repo deliberately does NOT hold the private product denylist (company
 * name, address, license, contract number, agent id): that scan runs in the
 * consumer's CI with SUN_DENYLIST. What lives here is the structural part —
 * secrets, PII, internal paths, and the "synthetic": true + seed rule from
 * docs/acceptance.md §1.
 *
 * Allow-list etiquette: patterns are never loosened to make the check pass. Add
 * an entry keyed by file + label + exact text, with a reason, when a hit is a
 * deliberate placeholder, a licence header, or a published contact address.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = join(import.meta.dirname, '..')

/** Files npm always includes regardless of the "files" allowlist. */
const ROOT_FILES = ['README.md', 'LICENSE', 'package.json']

/** Scan text-ish files only; binaries cannot be read, so they are reported. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.wasm', '.zip', '.gz', '.tgz', '.pdf', '.mp4', '.webm', '.mp3',
])
const MAX_BYTES = 1024 * 1024

/**
 * Test files carry synthetic fixtures (fake tokens, cards, SSNs) by design —
 * that is how the gate proves it fires. They are still covered by the
 * key-material/.env filename rule, but skipped for content patterns.
 */
const TEST_FILE = /\.(?:test|spec)\.\w+$/

/**
 * A licence/copyright header is a declared convention, not a leak: this project
 * requires one on every source file, and it names the owner's address. Matching
 * the line (not the address) keeps the exemption from widening to prose.
 */
const HEADER_LINE = /^(?:\/\/|#|\*|<!--)\s*Copyright \(c\)\s/i

/** Secret/credential patterns. `global` is added below for full-line scanning. */
const PATTERNS = [
  { label: 'Private key block', regex: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/ },
  { label: 'AWS access key id', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: 'GitHub token', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { label: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'OpenAI/Anthropic key', regex: /\b(?:sk-ant-|sk-)[A-Za-z0-9_-]{24,}\b/ },
  { label: 'Stripe live key', regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b/ },
  { label: 'JWT', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { label: 'Credentials in URL', regex: /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/i },
  { label: 'Hardcoded password', regex: /password\s*[:=]\s*['"][^'"]{3,}['"]/i },
  { label: 'SSN', regex: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/ },
  { label: 'Email address', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  // Four octets, not five: 192.168 and 172.16-31 already supply two, 10 supplies
  // one. Written the other way round the commonest internal range never fires.
  { label: 'Private IP address', regex: /\b(?:(?:192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}|10(?:\.\d{1,3}){3})\b/ },
  { label: 'Internal filesystem path', regex: /(?:\/Users\/|\/home\/[a-z0-9._-]+\/|C:\\Users\\)/i },
]
// Fresh global regexes per line scan; `lastIndex` state must not leak between lines.
for (const p of PATTERNS) p.global = new RegExp(p.regex.source, p.regex.flags + 'g')

/** Email domains that cannot belong to a real person (RFC 2606 / dev-only). */
const SAFE_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'test', 'localhost', 'invalid', 'example', 'domain.test'])
/** Non-contact addresses that look like emails. */
const SAFE_EMAIL_LITERALS = new Set(['git@github.com', 'npm@npmjs.com', 'support@npmjs.com'])

/**
 * Explicit allow-list: known-benign matches. Every entry MUST carry a reason.
 * Keyed by file + label + exact text so line edits cannot silently widen it.
 *
 *   { file: 'docs/deploy.md', label: 'Private IP address', match: '192.0.2.10',
 *     reason: 'the documented address of our own staging host' },
 *   { file: '*', label: 'Email address', match: 'owner@example.com',
 *     reason: "the licence holder's address, required in every source header" },
 *
 * (That example uses TEST-NET-1 on purpose: this file is scanned like any
 * other, so an allow-list example must not contain what it is allowing.)
 *
 * Copy this file into a project and fill this in — an empty list is correct for
 * a new repository, and the gate will tell you which entries it wants.
 */
const ALLOW = []

/** This file, whose allow-list necessarily contains what it allows. */
const SELF = 'scripts/security-check.mjs'

/** Product literals that must never appear here; see SUN_DENYLIST above. */
function denylist() {
  const path = process.env.SUN_DENYLIST
  if (!path) return []
  const text = readFileSync(path, 'utf-8')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((literal) => ({ label: 'Product denylist', regex: new RegExp(literal, 'i'), global: new RegExp(literal, 'gi') }))
}

/** Luhn check — a 13–19 digit run is only reported if it is a valid card number. */
function luhnValid(digits) {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

/** Show enough to locate a leak without printing the secret itself. */
function redact(match) {
  if (match.length <= 8) return `${match.slice(0, 2)}…`
  return `${match.slice(0, 4)}…${match.slice(-2)} (${match.length} chars)`
}

function isSafeEmail(match) {
  if (SAFE_EMAIL_LITERALS.has(match.toLowerCase())) return true
  const domain = match.slice(match.lastIndexOf('@') + 1).toLowerCase()
  return SAFE_EMAIL_DOMAINS.has(domain) || domain.endsWith('.example') || domain.endsWith('.test')
}

/**
 * Scan one text blob. Pure — this is what the unit tests exercise.
 * @returns {Array<{file: string, line: number, label: string, hint: string}>}
 */
export function scanText(text, file = '<memory>') {
  const findings = []
  const lines = text.split(/\r?\n/)
  const extra = denylist()
  // The allow-list block itself is the one place a benign literal has to be
  // written down. Skipped by exact line range — the rest of this file, including
  // its patterns, is scanned like any other. (An entry is not a global pass: a
  // literal allowed for one file still fires in every other file.)
  const allowStart = file === SELF ? lines.findIndex((line) => line.startsWith('const ALLOW = [')) : -1
  const allowEnd = allowStart < 0 ? -1 : lines.findIndex((line, i) => i > allowStart && line === ']')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i > allowStart && (allowEnd < 0 || i <= allowEnd) && allowStart >= 0) continue
    if (HEADER_LINE.test(line)) continue // licence header: declared, not a leak
    for (const pattern of [...PATTERNS, ...extra]) {
      const seen = new Set()
      for (const m of line.matchAll(pattern.global)) {
        const match = m[0]
        if (seen.has(match)) continue
        seen.add(match)
        if (pattern.label === 'Email address' && isSafeEmail(match)) continue
        const allowed = ALLOW.some(
          (a) => (a.file === '*' || a.file === file) && a.label === pattern.label && match.includes(a.match),
        )
        if (allowed) continue
        findings.push({ file, line: i + 1, label: pattern.label, hint: redact(match) })
      }
    }

    // Card numbers: regex-shaped, then Luhn-validated to avoid false positives.
    // The lookarounds keep a decimal *fraction* out: a money figure such as
    // 1480.8000000000002 contains a 13-digit run that happens to pass Luhn, and
    // reporting every long float as a card number buries the real findings.
    for (const m of line.matchAll(/(?<![\w.])(?:\d[ -]?){12,18}\d(?![\w.])/g)) {
      const digits = m[0].replace(/\D/g, '')
      if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) continue
      if (ALLOW.some((a) => (a.file === '*' || a.file === file) && a.label === 'Card number' && m[0].includes(a.match))) continue
      findings.push({ file, line: i + 1, label: 'Card number', hint: redact(m[0]) })
    }
  }
  return findings
}

/** Tracked files (git), or every file when git is unavailable (tarball context). */
function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.split('\0').filter(Boolean)
  } catch {
    return null
  }
}

/**
 * Read a path as it will be committed, not as it happens to sit on disk.
 * In git mode the index blob is authoritative: a file that was staged and then
 * deleted from the working tree is still in the commit the hook is guarding.
 * Outside git (tarball/npm context) there is no index, so read the file.
 */
function readContent(rel, gitMode) {
  if (gitMode) {
    try {
      return execFileSync('git', ['show', `:${rel}`], {
        cwd: ROOT,
        encoding: 'utf-8',
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      // Not in the index (e.g. a root file in a fresh clone) — fall through.
    }
  }
  return readFileSync(join(ROOT, rel), 'utf-8')
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`
    const stat = statSync(join(ROOT, rel))
    if (stat.isDirectory()) walk(rel, acc)
    else acc.push(rel)
  }
  return acc
}

/** Binary files the gate cannot read — reported so a person can check them. */
const notifications = []

function scanPath(rel, findings, gitMode) {
  const full = join(ROOT, rel)
  const ext = extname(full).toLowerCase()
  if (BINARY_EXTENSIONS.has(ext)) {
    // A screenshot of a filled form is PII in a format no scanner can read.
    // Not a finding (most images are fine) but never silent.
    notifications.push(`${rel} — binary, not scanned; confirm it carries no PII`)
    return
  }
  if (TEST_FILE.test(rel)) return // synthetic fixtures — see TEST_FILE above
  let text
  try {
    text = readContent(rel, gitMode)
  } catch {
    return
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return
  // A NUL byte means binary content with a text extension (.gitattributes edge).
  if (text.includes('\0')) return
  findings.push(...scanText(text, rel.split(sep).join('/')))
}

/**
 * Fixtures must be generated from a seed and marked synthetic
 * (docs/acceptance.md §1). Every fixture golden is a document of the data
 * contract, so an unmarked one is a hygiene failure, not a style nit.
 */
const FIXTURE_FILE = /(?:^|\/)(?:fixtures?|examples)\/.*\.json$/
function checkFixtures(files, findings, gitMode) {
  for (const raw of files) {
    const rel = raw.replace(/^\.\//, '')
    if (!FIXTURE_FILE.test(rel)) continue
    let data
    try {
      data = JSON.parse(readContent(rel, gitMode))
    } catch {
      continue // JSON validity is a test's job, not this gate's
    }
    // Allow-listed like any other finding: a fixture that is *anonymised real
    // data* rather than generated cannot honestly claim to be synthetic.
    const allowed = (label) => ALLOW.some((a) => a.file === rel && a.label === label)
    if (data.synthetic !== true && !allowed('Fixture missing "synthetic": true')) {
      findings.push({ file: rel, line: 1, label: 'Fixture missing "synthetic": true', hint: 'acceptance.md §1' })
    }
    if ((data.seed === undefined || data.seed === null || data.seed === '') && !allowed('Fixture missing seed')) {
      findings.push({ file: rel, line: 1, label: 'Fixture missing seed', hint: 'acceptance.md §1' })
    }
  }
}

/**
 * Scan the repository (tracked files + the files npm always ships).
 * @returns {Array<{file: string, line: number, label: string, hint: string}>}
 */
export function scanRepo() {
  notifications.length = 0
  const files = trackedFiles()
  const gitMode = files !== null
  const findings = []
  const list = files ?? walk('.')
  const seen = new Set()
  for (const rel of [...list, ...ROOT_FILES]) {
    const norm = rel.replace(/^\.\//, '')
    if (seen.has(norm)) continue
    seen.add(norm)
    // In git mode the index entry guarantees the path will be committed, even
    // if it no longer exists on disk. Without git, only scan what exists.
    if (!gitMode && !existsSync(join(ROOT, norm))) continue
    scanPath(norm, findings, gitMode)
  }
  // A tracked .env or key file is always a finding, regardless of contents.
  for (const rel of seen) {
    const name = rel.split('/').pop() ?? ''
    if (/^\.env(\.|$)/.test(name) && !name.endsWith('.example')) {
      findings.push({ file: rel, line: 1, label: 'Committed environment file', hint: name })
    }
    if (/\.(pem|key|p12|pfx|jks|keystore)$/i.test(name) || name === 'id_rsa' || name === 'id_ed25519') {
      findings.push({ file: rel, line: 1, label: 'Key material file', hint: name })
    }
  }
  checkFixtures(list, findings, gitMode)
  return findings
}

/** Binary files that were not scanned, for the final report. */
export function unscannedBinaries() {
  return [...notifications]
}

function main() {
  const findings = scanRepo()
  const binaries = unscannedBinaries()
  if (findings.length > 0) {
    console.error('\n❌ SECURITY CHECK FAILED — potential key/credential/PII/data leak:\n')
    for (const f of findings) console.error(`  ${f.file}:${f.line} — ${f.label} — ${f.hint}`)
    console.error(
      '\nRemove the value, or — for a deliberate placeholder/fixture/header — add an\n' +
        'ALLOW entry in scripts/security-check.mjs with file + label + match + reason.\n',
    )
    process.exit(1)
  }
  if (binaries.length > 0) {
    console.log(`ℹ️  ${binaries.length} binary file(s) not scanned — confirm by eye:\n`)
    for (const line of binaries) console.log(`  ${line}`)
    console.log('')
  }
  console.log('✅ Security check passed — no keys, credentials, PII, internal paths, or unmarked fixtures found.\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
