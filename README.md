# sure-document

Print-ready documents for the sure stack. Give it a layout and the rows your
application already holds; it returns deterministic HTML that prints, with page
geometry, furniture and guards handled for you. PDF compilation is the host's
job, at the product edge — this package emits no binary artefact and has **zero
runtime dependencies**.

The stack is agent-first: a layout is data an agent can read, diff, generate and
verify, not a binary design only a designer can open.

```
layout (TS/JSON) + data (sure-state rows)
        → renderDocument() → sheets[] → HTML → print | PDF (host)
                 │
          guards + fixtures
```

## What it is

`sure-document` owns the document layer:

- an element/sheet model (`text`, `line`, `rect`, `image`, `table`, `figure`,
  plus sheet-level furniture), in points;
- a **closed expression grammar** — `@`/`root.` for parameters, `.`/`row.` for
  the current row, five aggregates, `ifpresent` — with no implicit scoping and
  no dynamic code execution;
- deterministic formatters and an injected measurement oracle: no clock, locale,
  DOM, network or `Intl` call can change the output;
- fixed-mode rendering: one flat `sheets[]` tree, renderer-owned `@page` size and
  margins, repeated headers/footers, true `Page N of M`, watermark, table rules;
- fail-closed verification: guards reconcile printed totals against the server's
  recomputation, and fixtures state what the output must contain.

Flow mode (bands whose length comes from the data) and the table of contents are
the next phase; the element model and formatter vocabulary already include them.

## How it relates to the sure stack

| Package | Version | Role in a document |
|---|---|---|
| `@shing.wong/sure-state` | — | supplies the rows and the event journal; the renderer never queries |
| `@shing.wong/sure-factor` | 0.6.2 | field metadata and the catalog schema (`family`, `data`, `print`, `guards`, `fixture`); validates report entries |
| `@shing.wong/sure-ui` | 0.3.7 | the ink: theme tokens, the `document` and `figure` blocks, and `SURE_TYPOGRAPHY`, the single typography source |
| `@shing.wong/sure-store` | 0.4.1 | catalog definitions (`document-table`, `document-totals`, …) with synthetic fixture goldens |
| **`@shing.wong/sure-document`** | 0.0.0 | this package: layout, expressions, formatters, pagination and rendering |

Definitions live in sure-store and are consumed through sure-factor — there is
no second registry here. Print CSS lives in sure-ui; this package emits only the
class names and the `@page` geometry.

## Why use sure-document

- **Reviewable layouts.** A design is JSON/TS in a diff, not a compiled
  `.jasper` binary only one tool can open.
- **Verifiable paper.** Guards and fixture facts replace reading a PDF to check
  that a total is right or a page number is true.
- **Deterministic reprints.** The same layout and data produce byte-identical
  HTML anywhere, regardless of timezone, host font lookup or locale.
- **Pure and cheap to test.** A renderer function with no browser, clock or
  network dependency can run in any test harness.
- **Agent-native.** Errors are stable codes with actionable hints, emitted both
  in a JSON envelope and as events, so a supervising agent can diagnose a failed
  command it never ran.
- **One vocabulary.** It reuses sure-ui tokens and sure-factor's catalog; it
  does not invent a parallel styling or component system.

## Install

```bash
npm install @shing.wong/sure-document
```

The package is pre-1.0 and private until its first stable release; the command
above is the install path once it is published. Include sure-ui's compiled CSS
in the host (for example via `compose()` from `@shing.wong/sure-ui@0.3.7`) so the
emitted `sure-document__*` classes are painted.

## Usage

### Render a fixed document

```ts
import { renderDocument } from '@shing.wong/sure-document'

const { sheets, html, sheetCount } = renderDocument({
  layout: {
    sheet: { size: 'letter', orientation: 'portrait', margins: 36 },
    bands: [
      {
        height: 24,
        elements: [
          { kind: 'text', x: 36, y: 36, w: 300, h: 16, text: 'Account summary' },
        ],
      },
      {
        height: 24,
        elements: [
          { kind: 'text', x: 36, y: 72, w: 300, h: 16, expr: '@customer_name' },
        ],
      },
    ],
  },
  data: { params: { customer_name: 'Test Person A' } },
})

console.log(sheetCount)      // sheets.length
console.log(sheets[0])       // one top-level <section class="sure-document__sheet">
console.log(html)            // the whole document, including @page rules
```

`renderPanel` is the one-panel convenience with the same input and output shape.
The subpaths `./layout` and `./format` export the model types and the
expression/formatting API directly.

### Expressions

Scopes are explicit; a bare name is refused with `E_SCOPE_INVALID`.

| Form | Means |
|---|---|
| `@name`, `root.name` | a document parameter |
| `.name`, `row.name` | a field of the current row |
| `totals.name` | a server-recomputed total |
| `100`, `0.05` | numeric literals |
| `sum:`, `sub:`, `mul:`, `div:`, `avg:` | aggregates over comma-separated operands (e.g. `sum: rows.amount`) |
| `ifpresent: @x -> @x` | existence guard |

### Failure is explicit

Invalid layouts, unknown paper sizes, scope errors and failed guards throw a
`DocumentError` with a stable code (`E_LAYOUT`, `E_PAPER`, `E_SCOPE_INVALID`,
`E_GUARD`, …), a message and an actionable hint. See
[docs/errors.md](docs/errors.md) for the full catalogue and exit codes.

## What it is not

| Not this | Because |
|---|---|
| a data layer (no SQL, no fetch, no joins) | data comes from **sure-state**; the server recomputes totals. A document that can query is an ORM with a ruler |
| a report designer | layouts are code/data, reviewable in a diff |
| a PDF generator | the host compiles the emitted HTML to PDF; no browser engine lives here |
| a charting library | figures are SVG built from scales; no canvas, no animation, no dependency |
| a second catalog registry | component definitions live in **sure-store/components** (MIT), consumed through sure-factor |
| a human-first CLI | `sure-document` commands support `--agent`, the complete machine contract; human output is the default view of the same data |

## Status

Fixed mode is implemented and `npm run verify` is green (lint, build, tests,
exports, error-code coverage, typography drift, docs and examples). Flow mode,
the TOC, and the browser/PDF acceptance rows are outstanding; see
[docs/plan.md](docs/plan.md). The first consumer replaced its own print system
with this renderer and found one line-metrics defect, now fixed with a
regression test.

Start at **[docs/index.md](docs/index.md)** for the reading order.

| Doc | Audience |
|---|---|
| [AGENTS.md](AGENTS.md) | an agent working in this repo: boundaries, refusals, gates, doc duties |
| [docs/design.md](docs/design.md) | the architecture, as numbered dated decisions |
| [docs/catalog.md](docs/catalog.md) | the report component catalog and the two sure-ui blocks |
| [docs/acceptance.md](docs/acceptance.md) | synthetic data policy and the A1–A33 test criteria |
| [docs/legacy-report-engine.md](docs/legacy-report-engine.md) | what is being replaced, distilled from the 2007 designs |
| [docs/glossary.md](docs/glossary.md) | one word per concept, so nothing gets two names |
| [docs/errors.md](docs/errors.md) | the stable error codes and what each one means |
| [docs/plan.md](docs/plan.md) | phases, acceptance criteria, the documentation workstream |
| [docs/index.md](docs/index.md) | the entry point: a reading order for a human and for an agent |

## Name

`sure-document`, not `sure-doc`: the family uses no abbreviations
(`sure-factor`, `sure-state`, `sure-web-testing`), and `doc` already means
"documentation" in every repository's `docs/`.

| Surface | Name |
|---|---|
| package | `@shing.wong/sure-document` |
| sure-ui block | `document` (`sure-document__sheet`, …) |
| catalog entries | `document-table`, `document-totals`, `document-sheet`, … |
| CLI verb | `sure-document render …` |
| TypeScript | `renderDocument`, `renderPanel` |

A few more bytes cost nothing; three spellings of one concept cost an agent a
wrong guess.

## License

MIT, like the rest of the shared stack. See [LICENSE](LICENSE).
