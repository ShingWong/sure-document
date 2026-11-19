# sure-document

Print-ready, multi-sheet document layout engine for the sure stack. Feed it a
declarative layout and the data rows your application already holds; it projects
deterministic, point-accurate HTML that prints cleanly to physical stationery.

PDF compilation is strictly the host's responsibility at the product edge.
`sure-document` runs a pure forward projection with **zero runtime dependencies**
and **zero headless browser processes**.

The architecture is agent-first: a layout is declarative data an agent can
inspect, diff, generate and verify against mathematical invariants, not an opaque
binary design file locked to a desktop GUI.

```
layout (TS/JSON) + data (sure-state rows)
        │
        ▼
   renderDocument()  ──[ measurement oracle + physical pt math ]
        │
        ▼
     sheets[]  ──[ error codes + synthetic fixtures ]
        │
        ▼
    HTML string  ──▶  Native Viewport / Print Spooler / Edge PDF
```

---

## The Architectural Inversion

Traditional enterprise reporting (JasperReports, headless Chrome pools) treats
document printing as an expensive simulation of a browser viewport.
`sure-document` treats paper layout as a closed forward projection:

| Dimension | Enterprise simulation (Jasper / headless Chrome) | The sure stack (`sure-document`) |
|---|---|---|
| **Engine footprint** | JVM classpaths, Chromium binaries | **~228 KB built dist**, zero runtime dependencies, no browser process |
| **Execution model** | Cold starts, DOM cascades, reflow | Pure arithmetic: width − margins − gutter − furniture; sub-millisecond medians in the bundled benchmark |
| **Memory model** | A browser worker per render | No browser engine to allocate for; the renderer is a pure function |
| **Scoping & logic** | Embedded runtimes (Groovy, V8 JS) | **Closed grammar**: five aggregates + `ifpresent`, explicit `@`/`.` sigils, no ambient evaluation |
| **Verification gate** | Visual proofreading, screenshot diffs | Stable error codes, declared guards and fixture facts |

The built `dist/` is currently ~228 KB. See [Performance](#performance) for
measured render times and how to reproduce them.

---

## Performance

Performance is a design property here: the renderer is a pure forward projection
over arrays and numbers, with no browser, no DOM, no reflow and no cold start.
The bundled benchmark measures the **built package** with 20 warmup and 200
timed renders per case:

```bash
npm install
npm test          # Vitest: layout, format, renderer, generator and gate tests
npm run verify    # lint + build + test + all doc/exports/errors/typography gates
npm run bench     # build, then benchmark three synthetic workloads
```

### The performance test

The executable source is [`scripts/bench.mjs`](scripts/bench.mjs). It imports the
**built** package, warms up, times each render, and fails if a result lacks
`@page` rules or reports an inconsistent sheet count. The measurement loop is:

```js
import { performance } from 'node:perf_hooks'
import { renderDocument } from '../dist/index.js'

const WARMUP = 20
const ITERATIONS = 200

function measure(input) {
  for (let i = 0; i < WARMUP; i++) renderDocument(input)

  const times = []
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now()
    const result = renderDocument(input)
    times.push(performance.now() - start)
    if (!result.html.includes('@page')) throw new Error('no @page rules emitted')
    if (result.sheets.length !== result.sheetCount) throw new Error('sheet count disagrees')
  }

  const sorted = times.sort((a, b) => a - b)
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
  }
}
```

The `cases` array in the same file defines the three synthetic workloads below.
Acceptance assertions (A8, A16, A19, A30, A31, A33, …) live in
[`tests/render.test.ts`](tests/render.test.ts).

Measured on this machine (Linux x64, Intel Xeon E5-2698 v4 @ 2.20 GHz, Node
v22.23.4):

| Workload | Sheets | HTML | Median | p95 | Throughput |
|---|---:|---:|---:|---:|---:|
| 12 positioned text elements | 1 | 2.2 KB | 0.061 ms | 0.177 ms | ~16,300 renders/s |
| 40-row statement table | 1 | 6.1 KB | 0.084 ms | 0.268 ms | ~11,900 renders/s |
| ten flat sibling sheets | 10 | 11.5 KB | 0.180 ms | 0.434 ms | ~5,600 renders/s |

These are in-memory render numbers on one host, not a guarantee; rerun the
benchmark on your hardware. Browser print-to-PDF compilation happens in the host
and is deliberately not measured here — that is the work this package refuses to
do.

---

## Core Capabilities

- **Physical point precision ($pt$):** elements (`text`, `line`, `rect`, `image`,
  `table`, `figure`) are placed on a physical point grid. The renderer emits its
  own `@page` dimensions and margins, repeated three-zone headers/footers and a
  true `Page N of M`.
- **Closed expression grammar:** a strict micro-parser with explicit lexical
  scope — no `eval()`, no dynamic code execution, no implicit parent scopes.
  Out-of-scope bare access trips `E_SCOPE_INVALID`.
- **Deterministic measurement oracle:** point tables derived from
  `@shing.wong/sure-ui`'s `SURE_TYPOGRAPHY` export. Layouts evaluate identically
  regardless of host clock, locale, OS font lookup or network state.
- **Fail-closed diagnostics:** malformed geometry, unknown paper, scope errors
  and guard failures carry stable codes with actionable hints. Guard declarations
  are validated upstream by sure-factor; `E_GUARD` is reserved for server-side
  reconciliation, which is the next acceptance gate (A5).
- **Machine-native envelopes:** errors are emitted as structured envelopes and
  as journal events, so a supervising agent can diagnose a failed command it
  never ran.

---

## Stack Lineage & Contract Hierarchy

`sure-document` is the document projection engine of the sure stack:

```
@shing.wong/sure-state   ──▶ Tabular rows and immutable event journals
@shing.wong/sure-store   ──▶ Public component contract registry (npm)
@shing.wong/sure-factor  ──▶ Catalog schema validation (family, data, print, guards)
@shing.wong/sure-ui      ──▶ Design tokens & SURE_TYPOGRAPHY point metrics
         │
         ▼
@shing.wong/sure-document ──▶ Layout projection, micro-expressions, & HTML emission
```

| Package | Version | Architectural responsibility |
|---|---|---|
| `@shing.wong/sure-state` | — | Supplies tabular records and the event journal; the renderer never queries |
| `@shing.wong/sure-store` | `^0.4.1` | Public component definitions (`sure-store/components/`) with synthetic goldens |
| `@shing.wong/sure-factor` | `^0.6.2` | Catalog schema compiler: field metadata, print bindings, guard validation |
| `@shing.wong/sure-ui` | `^0.3.7` | Theme tokens and `SURE_TYPOGRAPHY`, mapping `--sure-font-*` to physical point metrics |
| **`@shing.wong/sure-document`** | `0.0.0` | Pure layout projection, expressions, band arithmetic and print emission |

---

## Installation

```bash
npm install @shing.wong/sure-document
```

This package is pre-1.0 and private until its first stable release; the command
above is the install path once it is published. Include sure-ui's compiled CSS in
the host (for example via `compose()` from `@shing.wong/sure-ui@0.3.7`) so the
emitted `.sure-document__*` classes are painted.

---

## Usage

### 1. Rendering a fixed multi-sheet document

```ts
import { renderDocument } from '@shing.wong/sure-document'

const { sheets, html, sheetCount } = renderDocument({
  layout: {
    sheet: { size: 'letter', orientation: 'portrait', margins: 36 },
    bands: [
      {
        height: 48,
        elements: [
          { kind: 'text', x: 36, y: 36, w: 300, h: 16, text: 'ACCOUNT STATEMENT' },
          { kind: 'text', x: 36, y: 56, w: 300, h: 14, expr: '@borrower_name' },
        ],
      },
      {
        height: 120,
        elements: [
          {
            kind: 'table',
            x: 36, y: 90, w: 540, h: 60,
            columns: [
              { label: 'Due date', field: 'dueDate' },
              { label: 'Amount', field: 'amount' },
            ],
            rows: [
              { dueDate: '2031-12-01', amount: 130.07 },
              { dueDate: '2032-01-01', amount: 130.07 },
            ],
          },
        ],
      },
    ],
  },
  data: { params: { borrower_name: 'Ada Example' } },
})

console.log(`Generated ${sheetCount} sheet(s)`)
// sheets[0] -> <section class="sure-document__sheet">...</section>
// html      -> complete markup, including @page dimensions
```

The table stands on declared synthetic rows; in an application the host supplies
the rows from sure-state instead. Fixed geometry needs all four numbers — `x`,
`y`, `w`, `h` — and a malformed element fails with `E_LAYOUT`.

### 2. Expression micro-grammar

Scopes are explicit; a bare name is refused with `E_SCOPE_INVALID`.

```text
# Parameters — document root scope
@customer_name
root.account_id

# Row fields — active iterator scope
.installment_amount
row.principal_balance

# Existence guard
ifpresent: @discount -> @discount

# Five aggregates; rows.amount is an explicit array range
sum: rows.amount
mul: .hours, @hourly_rate
sub: @total_cost, @down_payment
avg: rows.amount
```

---

## What It Is Not

| Not this | Architectural reason |
|---|---|
| **Not an ORM or query layer** | Data ingestion belongs to `@shing.wong/sure-state`. A document engine that runs queries is an ORM with an accidental ruler |
| **Not a headless browser pool** | No Chromium, WebKit, Playwright or Puppeteer. Point geometry is solved in memory |
| **Not a dynamic DOM visual editor** | Layouts are reviewable data in git diffs, with no proprietary design binary |
| **Not a PDF generator** | The browser prints the emitted HTML; no PDF engine lives here |
| **Not an ad-hoc component registry** | Components live in `@shing.wong/sure-store` and are validated by `@shing.wong/sure-factor` |

---

## Diagnostic Error Catalogue

Failures are explicit and machine-actionable, in the stack envelope shape:

```json
{
  "ok": false,
  "error": {
    "code": "E_GUARD",
    "message": "a guard failed: the document printed figures that do not reconcile",
    "hint": "do not print. Recompute server-side and re-render",
    "details": { "rule": "totals.total == sum(rows.amount)" },
    "retryable": false,
    "exitCode": 3
  },
  "trace": "op_8f2c",
  "events": [{ "seq": 99, "type": "error", "payload": { "code": "E_GUARD" } }]
}
```

Detailed codes and recovery directives are catalogued in
[docs/errors.md](docs/errors.md).

---

## Documentation Index

| Document | Audience | Primary focus |
|---|---|---|
| [AGENTS.md](AGENTS.md) | Agent sandboxes | Hard boundaries, refusal criteria, verification gates |
| [docs/index.md](docs/index.md) | All readers | Reading orders and doc-update duties |
| [docs/design.md](docs/design.md) | System architects | Frozen, append-only architectural decisions |
| [docs/catalog.md](docs/catalog.md) | Template authors | Component schemas and sure-ui blocks |
| [docs/acceptance.md](docs/acceptance.md) | Verification runners | Synthetic test policy and A1–A33 gates |
| [docs/errors.md](docs/errors.md) | Diagnostics | Stable codes and machine-actionable hints |
| [docs/plan.md](docs/plan.md) | Project leads | Phases, acceptance criteria and milestones |

---

## License

MIT. Copyright (c) 2026 ShingWong. Part of the sure stack — see
[LICENSE](LICENSE).
