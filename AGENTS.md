# sure-document — Agent Development Guide

**MIT** — see [LICENSE](LICENSE). No per-file license header is required
(matching `sure-factor` and `sure-state`); the package is shared infrastructure,
not a product.

## Project overview

Documents for the sure stack: a layout in TS/JSON, rendered from rows the
application already holds, to print-ready HTML (compiled to PDF by the host at the
product edge).

The stack is **agent-first**: the primary consumer of this package is a coding
agent, then the program it writes. That has consequences a human-first library
would not have — see "The agent surface" below.

## Stack position — what belongs here

| Here | Not here |
|---|---|
| the element model (`text`, `field`, `line`, `box`, `image`, `table`) | SQL, fetch, joins, caching — that is **sure-state** |
| expressions and formatters (`P:`, `F:`, `sum:`, `ifpresent:`) | field labels, validation, limits — that is **sure-factor** |
| pagination, bands, keep-together, page numbers | colors, fonts, class vocabulary — that is **sure-ui** |
| `fixed` (absolute) and `flow` (banded) layout modes | component *definitions* (catalog YAML) — that is **sure-store/components** |
| print-ready HTML/CSS; PDF compiled by the host at the product edge (`design §11`) | business wording and legal prose — that is each product's content |

If a change makes this package query data, know a column name, or invent a CSS
class, it is in the wrong repository.

## Non-goals (refuse these)

- **No designer.** Layouts are data, authored and reviewed in a diff.
- **No proprietary format.** A layout must be readable by an agent without
  running code. The Jasper lesson is that a binary design becomes uninspectable.
- **No charting dependency.** Figures are SVG built from a scale; `<title>`/
  `<desc>` and a data-table fallback are part of every figure.
- **No second catalog registry.** Definitions live in `sure-store/components/`;
  this package consumes them through sure-factor's loader.
- **No query builder.** See table above.
- **No PDF engine.** No headless-browser or PDF dependency of any kind — this
  package emits HTML/CSS; the host compiles it (`design §11`).

## The agent surface

Every command of this package's CLI is expected to support `--agent`
(the stack convention — the flag turns the mode on; the default is for humans):

- stdout: one JSON envelope per command; stable key order; no color, tables,
  progress or prompts.
- errors: **always** an envelope — `{ok:false, error:{code,message,hint,details,retryable,exitCode}, trace, events}`
  — and **also emitted as an `error` event** so a supervising agent that never
  ran the command still sees the failure.
- interactive steps never wait: they fail with `EINTERACTIVE` and name the flag
  that supplies the value.
- complete visibility: `vars` (every resolved value, with provenance), `state`
  (every registered store's **full** state, not counts), `events` (the journal,
  by monotonic sequence).
- destructive operations require `--yes`; without it the answer is `ECONFIRM`.

A document command must be verifiable the same way. This example is the
**`sure-document` CLI** — it resolves `--entity`/`--id` through sure-state and
hands plain rows to this package; the renderer itself never fetches them:

```
sure-document render --entity invoices --id INV-1042 --format pdf --verify-totals --agent
```

At the package boundary the call is pure and takes local inputs:

```ts
renderDocument({ layout, data })   // layout + data → HTML string
```

`--verify-totals` recomputes server-side and fails if the paper disagrees.

## Agent tools and MCP

This package ships **no MCP server and no tool definitions**. `sure-state` owns
`createAgentTools`/`createMcpServer`; the `sure-document` CLI exposes the document
commands, and MCP serving stays a host concern (the umbrella `sure mcp serve`).
A renderer is a function, not a service: exposing it as a tool is the host's job,
so the same function cannot behave differently depending on who called it.

## Documentation duties

Docs are part of the interface, not a commentary on it. A change is incomplete
without the doc surface it touches, in the same commit:

| If you change | Update |
|---|---|
| an element kind or attribute | `docs/design.md §4`, `docs/glossary.md` |
| an expression form | `docs/design.md §5`, `docs/errors.md` (`E_EXPR`) |
| a formatter | `docs/design.md §6` |
| a catalog entry or its data shape | `docs/catalog.md`, the entry's fixture, `examples/` |
| a CLI command or flag | this file, the generated `docs/schema.json`, `README.md` |
| an error code | `docs/errors.md` + a test that raises it |
| a phase completed | `docs/plan.md`, `CHANGELOG.md` |

Rules that keep both audiences served:

- **One source.** The catalog reference is generated from YAML; the API
  reference from TSDoc; examples are fixtures the suite runs. Never hand-copy a
  signature or an output into prose.
- **Agent-first prose.** Stable headings, one concept per file, a glossary that
  settles synonyms, and a machine contract (`sure-document schema --agent`)
  for anything with arguments.
- **No orphan pages.** Every document is linked from `docs/index.md`, which
  carries the reading order for each audience.
- **Dated decisions.** `docs/design.md` is numbered and dated so a later reader
  can tell what was settled from what was merely tried.
- **ADR discipline.** `docs/design.md` is append-only: decisions through Phase 4
  are accepted and frozen. Never edit one — append a dated section that names
  what it supersedes and why.

## Data hygiene

This package is MIT and public. **No production data**, in any form — not a
fixture, not an example, not a doc snippet:

- fixtures are **generated** from a recorded seed and carry `"synthetic": true`
  (`docs/acceptance.md §1`);
- names are invented, amounts are round, dates are in the future;
- no company name, address, phone, license, contract number or agent id;
- a public repository must not hold the private denylist it is scanned against —
  that scan runs in the consumer's CI (`SUN_DENYLIST`), and this repo keeps only
  the structural checks (synthetic flag, seed, identifier patterns).

A product's own paper — wording, geometry, parameter names — stays in that
product's repository. If you need it here to write an example, the example is
wrong.

## Security gate

`scripts/security-check.mjs` enforces the structural half of the data-hygiene
rule above: keys, credentials, PII, internal paths, committed `.env`/key files,
and the `"synthetic": true` + seed fixture contract. It is dependency-free and
runs at two points:

- **commit** — the `githooks/pre-commit` hook. Enable it once per clone with
  `git config core.hooksPath githooks`. It scans the **index**, not the working
  tree, so staged content is what is checked even if the file was later deleted
  from disk.
- **push / PR** — `.github/workflows/security.yml`, which runs the same scanner
  in CI so the gate holds even for a clone that skipped the hook.

It will also run in `prepublishOnly` once there is a package to publish. The
private product denylist stays out of this repository by design; only the
consumer's CI holds it. When the scanner flags something, fix the value — do
not loosen a pattern. A deliberate placeholder goes in the `ALLOW` list in the
script, keyed by file + label + exact match, with a reason.

## Release mechanics

1. Upstream first: sure-ui → sure-factor → sure-store entries → this package.
   The registry test validates against the *installed* sure-ui, so never declare
   a block before it has shipped.
2. PR → CI green (`lint, build, test`) → squash merge to `master`.
3. Merging stages the npm release. A human with 2FA must approve it **the same
   day**: staged publishes expire after seven days and simply vanish. CI uses
   OIDC trusted publishing — configure it on npm with owner `ShingWong`, repo
   `sure-document`, workflow `publish.yml`, no environment. No npm token lives
   in this repository.
4. The repository went public at the first stable release (0.1.0) under the
   same MIT license, and `master` is PR-protected. Branch protection was not
   available on this account's free plan while the repo was private.
5. Never weaken a test to make a phase pass. If an acceptance row is wrong, say
   so and change the row with a reason. The product's paper, wording and
   geometry stay in the product's repository; never copy them here.

## Build & test

Same shape as `sure-factor`, so a contributor moves between the two without
relearning the gates:

```bash
npm install
npm run lint        # tsc --noEmit
npm run build       # tsc -p tsconfig.build.json → dist/
npm test            # vitest: unit + fixture goldens
npm run check:exports   # every subpath in package.json resolves
npm run verify      # lint && build && test && check:exports
```

Fixture goldens are the point: a layout change must show which documents
changed. The ported legacy paper (see `docs/legacy-report-engine.md`) is the first
corpus — 150 / 42 / 19 elements, page counts, key strings. Goldens assert **facts**
(element counts, coordinates, sheet counts, key strings), never raw HTML bytes:
a change in attribute order or whitespace is not a document change (`design §8`,
`plan.md` Phase 4).

## Exports (planned, sure-factor's shape)

An `exports` map of `{ types, import }` pairs, one entry per module — the same
shape sure-factor and sure-ui publish, so `check:exports` is the same script
pattern:

| Subpath | Symbol | Purpose |
|---|---|---|
| `.` | `renderDocument`, `renderPanel` | layout + data → HTML |
| `./layout` | `PageLayout`, `Band`, `Element` | the element model |
| `./format` | `evaluate`, `formatCurrency`, `formatDate` | expressions and the formatters the designs declare |

A **generated** report module follows sure-factor's client-target precedent
(`components/form.ts`): `renderReport`, the layout data as an export, and
`CSS_CLASSES` — one module per report, driven by a layout supplied at runtime.

## Code style

- TypeScript strict, ESM, `type: "module"`.
- **No runtime dependency** in the renderer: it is a pure function of layout and
  data, so an agent can call it in a test harness without a browser. (sure-factor
  carries `sure-ui` and `pg`; this package deliberately carries nothing.)
- Pure functions: a renderer that touches the DOM, the clock or the network is
  untestable and unverifiable.
- **No dynamic code execution.** Expression parsing is the closed vocabulary in
  `design §5`, implemented as a micro-parser — never `eval()`, `new Function()`
  or a third-party AST engine.
- **Explicit inputs only.** Formatters take the declared format and typed values;
  they never read the host clock or locale, and no caller-supplied locale may
  change the paper (A2, A9, A17; `design §6`, `§10`).
- One responsibility per file; no dead code, no commented-out code.
- Tests are the specification: every expression form, every formatter, every
  page-break rule has one.

## Memory

This project has a positronic brain **`sure-document`** (`.positronic/`,
long_term/lexical/live). **Recall before you re-derive:** query the brain
(`positronic recall "<topic>"` / `positronic ask "<object>"`) before touching the
filesystem — before answering project questions, starting a task, editing a file,
or resuming work. Re-derive from files only when recall returns nothing relevant;
when citing a past decision, name the τ you recalled it from. This binds the main
agent and every subagent.

## Graphify

Index this repository with `/graphify .`; `graphify-out/` is git-ignored. Query
the merged cross-repo graph in the shared workspace before grepping.
