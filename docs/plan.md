# Plan

Ordered so that each step is *possible*: upstream blocks and schema land before
anything declares them, and each phase ends with something checkable.

**Definition of done for every phase below:** code + tests + the docs surface it
touches (`docs/index.md §When to update what`) + a `CHANGELOG.md` line, in one
commit. A phase is not done because it runs; it is done because the next agent
can find out how it runs.

Criterion for the whole project: **a second consumer**. The ported product
paper proves the fixed mode; a monthly statement must prove the flow mode, or
the engine stays 250 lines inside the first consumer and never becomes a package.

---

## Phase 0 — the contract (done)

- [x] `README.md`, `AGENTS.md`, `docs/design.md`, `docs/catalog.md`,
      `docs/legacy-report-engine.md`, `LICENSE` (MIT).

**Acceptance:** a new agent can read the repository and know what belongs here,
what is refused, and in which order the work runs.

## Phase 0.5 — the documentation system

The six contract documents exist; the *system* that keeps them true does not.
This phase wires it before code arrives, because docs gates retrofitted onto a
finished project never get switched on.

- [x] `docs/index.md` as the single entry point, with a reading order per
      audience (this file's sibling)
- [x] `docs/glossary.md` and `docs/errors.md`
- [x] `examples/` with one runnable fixture per layout mode; every example is
      replayed by `check:examples`
- [x] `fixtures/generate.ts` — seeded, deterministic, synthetic only
      (`docs/acceptance.md §2`)
- [ ] the acceptance suite as code (A1–A33), starting with the non-browser
      criteria (A2, A3, A8, A9, A11, A32, A33) — needs the renderer
- [ ] CI gates: link + anchor check, example replay and error-code coverage are
      live; **generated-reference freshness is still outstanding**
- [x] Definition of done written into AGENTS.md: behavior change ⇒ test +
      doc row + changelog entry in the same commit

**Acceptance:** CI fails when a documented example stops running, when an error
code has no row, or when a generated reference is stale.

## Phase 1 — sure-ui: the two blocks

`document` (`sure-document`, `__sheet`, `__header`, `__footer`, `__zone`,
`__page`, `__date`, `__section`, `__signature`, `__graphic`, `__watermark`) and
`figure` (`sure-figure`, `__plot`, `__axis`, `__bar`, `__line`, `__legend`).

The block must cover the six furniture parts, because they are what a printer
actually needs: running header and footer with three zones, page numbers with a
true total, issued/captured dates, a monochrome logo, and a watermark at an
arbitrary angle that prints.

It must also carry the sheet itself (`design.md §3.1`): named and custom paper,
orientation, binding edge with a gutter, mirrored margins for duplex, bleed
(PDF-only), cut marks for perforated sheets — and it must express `scale` as a
document decision while leaving `zoom` to the viewer (`§3.2`).

- print rules: page-break helpers, keep-together, header repetition — and the
  screen rules that draw the sheet as paper, so the print rules only have to
  defer size and margins to `@page` (`design §11`);
- figures monochrome-safe; no animation;
- tokens only — no literal colors (the footer block's test is the model).

**Acceptance:** every theme styles both blocks; the `compose()` fixture is
regenerated; the registry test in sure-factor passes against the published
version (release order: sure-ui first).

**Status (2026-11-19):** shipped in `@shing.wong/sure-ui` 0.3.6. Every theme
styles both blocks and the 0.1.9 fixture change is additive-only. A sure-factor
follow-up is enabling the registry check against that published version.

## Phase 2 — sure-factor: catalog schema 0.6

Add `family`, `data`, `print`, `guards`, `fixture` to `CatalogComponent`, and
teach the registry test that a report entry is a document part, not a form —
without weakening the class-coverage guard for templates.

**Acceptance:** an entry with the four keys parses, generates a `report` module,
and fails loudly when a `guard` expression references a projection that does not
exist.

**Status (2026-11-19):** shipped in `@shing.wong/sure-factor` 0.6.0; the
bidirectional error-code gate here covers all 19 codes. The template
class-coverage guard is unchanged.

## Phase 3 — the first five entries (sure-store/components)

`document-table`, `document-totals`, `document-keyvalue`, `document-schedule`, `document-graphic` — each
with a fixture golden and, where it prints a figure, a guard.

**Acceptance:** sure-store's verification suite replays the fixtures; each entry
declares `sure_ui` blocks that exist; no product-specific word appears.

## Phase 4 — the renderer (this package, fixed mode)

Extract from the first consumer: element model, expression evaluator, formatters,
panel renderer. The ported agreement, notice page and coupons become the first
fixtures (150 / 42 / 19 elements, page counts, key strings).

It returns **`sheets[]`** — one top-level box per sheet with the break between
them (`design §9.3`) — and the same markup serves both media: on screen a sheet
is the declared paper, on paper `@page` owns size and margins (`design §11`).

**Acceptance:** rendering the ported panels through this package reproduces the
portal's paper — every element at the same coordinate, every sheet the same size
and count — with this package's own class names, never with the product's. (Byte
identity would mean copying the consumer's markup, which contradicts Phase 1's
sure-ui classes and the catalog contract; what must be identical is the paper.)
`npm run verify` green;
no runtime dependency; the sheet set is flat (A30) and the screen preview is the
printed artefact (A31).

## Phase 5 — flow mode, proven by the statement

Bands, sections, repeating rows, keep-together, page numbers, subtotals. The
document: a monthly statement of account (header, opening balance,
transactions, totals, remittance slip).

The pass must also emit **section marks** (`id`, `title`, `level`, `page`,
`frontMatter`) even though nothing consumes them yet: a TOC added later reads
them, and retro-fitting them into a working pagination pass is a rewrite.

**Acceptance:** a 40-row statement paginates correctly through the renderer's
own pagination pass (Chromium has no CSS margin boxes, `design.md §9`) with a
repeated header, a true `of N`, a watermark, mirrored binding margins that
alternate per sheet, and section marks that name every section with its page;
totals reconcile against the server's recomputation; the figure prints in
grayscale; the fixture asserts both pages and strings; `sheets[]` stays flat, so
a keep-together group that would span two sheets is moved rather than split.
Tables follow `design §9.3`: `<thead>` repeats on every continued sheet, no row
crosses a boundary, and a row taller than the printable body fails `E_LAYOUT`
(A33). `fit: width|page` is one uniform scale applied *after* pagination — it
never changes the sheet cut or the numbering plan (A21).

## Phase 6 — the cancellation notice

The ten-day cure letter: `document-sheet` + `document-note` + `document-signature` + dates from
the record. The wording comes from that product's compliance documentation,
never from this package.

**Acceptance:** the notice is generated from a defaulted contract with no manual
typing; the date arithmetic is tested (notice date + 10 days, 12:01 a.m. rule
documented).

## Phase 7 — the agent surface

`sure-document render|validate|paper|vars|state|events` with `--agent` per the
stack convention — `paper list` returns the ten named sizes in pt/mm/in so an
agent never hard-codes a page; structured errors emitted as events; the event journal that makes
`events` true (sure-state).

The CLI resolves `--entity`/`--id` through sure-state (design §7); at the
library boundary the call is `renderDocument({ layout, data })` with local
inputs. It emits HTML — the host compiles PDF at the product edge (design §11).

**Acceptance:** an agent runs
`sure-document render --entity invoices --id INV-1042 --format html --verify-totals --agent`
and gets an envelope containing the file path, the page count and the guard
results — with no human in the loop and no PDF eyeballing.

## Phase 7.5 — comprehensive documentation, human and agent

By now the surface is real, so the reference can be generated rather than
imagined.

**Human:** quickstart (install → render → verify in one page), the two mode
guides (fixed, flow), a PDF/printing guide (sheet sizes, margins, Chromium at
the edge), a migrating-from-Jasper guide, a cookbook built from `examples/`,
an API reference generated from TSDoc, a CHANGELOG with migration notes.

**Agent:** the `sure-document` skill in `.opencode/skills/` (when to use it,
the composition recipe, the five mistakes), `sure-document schema --agent`
committed as `docs/schema.json`, the catalog reference generated from the YAML
(data shape, guards, fixture per entry), and the error catalog regenerated
from the codes' tests.

**Shared:** `docs/index.md` reading orders; the glossary as the tie-breaker for
naming.

- [ ] every doc page linked from `docs/index.md`, no orphans
- [ ] every example executed by `npm test`
- [ ] API reference regenerated in CI and diffed
- [ ] `docs/schema.json` matches `sure-document schema --agent`
- [ ] every code in `src/` present in `docs/errors.md`, and vice versa
- [ ] a human who has never seen the project renders the statement in < 15
      minutes using only the quickstart
- [ ] an agent given only `AGENTS.md` + `docs/schema.json` composes a document
      and runs `--verify-totals` without asking a question

**Acceptance:** both bullet lists above are tests or review checklists, not
aspirations. The last two are the ones that matter.

## Phase 8 — publish

`@shing.wong/sure-document` 0.1, exports map like sure-factor's
(`.`, `./render`, `./layout`, `./format`), `npm run verify` in CI, staged publish.

**Acceptance:** a fresh consumer installs it, renders the statement fixture, and
`check:exports` resolves every subpath.

---

## Risks

| Risk | Handling |
|---|---|
| The flow mode grows into a layout engine (widows, orphans, measured reflow) | page breaks only where the design or an explicit `break` says; text never reflows around figures |
| Two renderers drift (fixed and flow) | one element model, one formatter set, two layout strategies; fixtures from both |
| The catalog becomes a second registry | entries live in sure-store/components, loaded by sure-factor; this package consumes |
| PDF pulls a browser into the library | PDF stays at the product edge; the package renders HTML only |
| The statement never happens, so the abstraction is unproven | it is Phase 5, before any publish |
| Documentation drifts from behavior — the failure mode that killed the `.jasper` designs, one level up | every reference is generated, every example is a test, and the definition of done puts the doc line in the same commit as the code |
