# Handoff — sure-document

**State as of 2026-11-19.** Documentation only: no source, no `package.json`, no
git repository, nothing published. The owner asked that `git init` not happen
until they say so — **do not initialise the repository or publish anything.**

Read [docs/index.md](docs/index.md) first; it carries a reading order for an
agent (seven steps) and for a human. This file is the *transient* part — status,
first tasks, guardrails. Decisions live in [docs/design.md](docs/design.md) and
[docs/catalog.md](docs/catalog.md); when this file and those disagree, those win.

---

## What exists

| File | Holds |
|---|---|
| `README.md` | what it is, what it is not, the name decision |
| `AGENTS.md` | what belongs here, refusals, agent surface, doc duties, data hygiene, gates |
| `docs/design.md` | 14 numbered decisions: modes, sheet, elements, expressions, verification, pagination, numbering, output |
| `docs/catalog.md` | 21 catalog entries, the four extension keys, two new sure-ui blocks, sheet/paper/numbering rules |
| `docs/acceptance.md` | A1–A33, the fixture generator, the synthetic-data policy |
| `docs/errors.md` | 19 stable error codes with exit codes |
| `docs/glossary.md` | one word per concept — use it, don't invent synonyms |
| `docs/legacy-report-engine.md` | why compiled report engines are being replaced (generic) |
| `docs/plan.md` | phases 0 → 8, acceptance criteria, deferred list |
| `examples/README.md` | the fixture policy; fixtures land with the code |

## Closed decisions — do not reopen without the owner

1. **Package name** `sure-document`; one spelling of the word everywhere:
   block `document`, entries `document-*`, verb `sure-document …`, code
   `renderDocument`.
2. **Two new sure-ui blocks only**: `document` and `figure`. Tables, totals and
   prose reuse `table` and `markdown`.
3. **Zero runtime dependencies** in the renderer. It is a pure function of
   layout + data (A9).
4. **The renderer paginates.** Chromium has no CSS paged-media margin boxes, so
   page numbers, repeated headers and mirrored binding are ours to do
   (`design §9`).
5. **No clock in the renderer.** Dates are `issued` (data) or `captured` (input);
   a reprint must be byte-identical (A8, A17).
6. **Bleed is a claim about the design**, per page — not a document-wide padding
   knob. Deferred past 0.1, model reserved.
7. **Fixtures are synthetic only**, seeded, `"synthetic": true`. No product data,
   ever (`AGENTS.md §Data hygiene`, `acceptance §1`).
8. **MIT**, like the rest of the shared stack.
9. **Release order**: sure-ui blocks → sure-factor schema → catalog entries →
   sure-document. The registry test validates against the *installed* sure-ui.
10. **PDF output boundary** (closed 2026-11-19): this package emits print-ready
    HTML/CSS only; headless Chromium compilation stays at the product edge
    (`design §11`, §14 decision 2). No PDF or headless-browser dependency here.

## Open decisions — ask, do not assume

| # | Question | Recommendation |
|---|---|---|
| 1 | `document-watermark` or `document-stamp`? | watermark — it is the word a printer uses |
| 2 | Watermark default: one centred mark or a tile? | one, tiled is opt-in |
| 3 | Non-production stamp wording | `EXAMPLE ONLY` |
| 4 | Do `tabloid`, `executive`, `b5` earn a place in the paper table? | ship `letter`, `legal`, `statement`, `a4`, `a5` + custom; add others when a document needs them |
| 5 | Is `booklet` in 0.1? | no — named in the type, refused in the renderer |
| 7 | Where do the ported fixed panels live? | the product's repository — the engine is generic, the paper is theirs |

## First three tasks, in order

**1. sure-ui: the two blocks** (`document`, `figure`)

Classes from `docs/catalog.md §2` and `plan.md` Phase 1. Print rules belong in
the `document` block (page breaks, keep-together, header/footer repetition),
figure typography and monochrome safety in `figure`. Tests, same shape as the
existing `footer` block: every theme, tokens only (no literal colours), the
print rule present, `compose()` fixture regenerated.

**2. sure-factor 0.6: catalog schema**

Add `family`, `data`, `print`, `guards`, `fixture` to `CatalogComponent`; teach
the registry test that a report entry is a document part — **without weakening
the class-coverage guard** for templates (`form` + `buttons` are still required,
which is why the report entries declare them).

**3. sure-store/components: the first entries**

`document-table`, `document-totals`, `document-keyvalue`, `document-schedule`,
`document-graphic` — each with a fixture golden. Then the renderer extraction
(`plan.md` Phase 4) from the first consumer's working code, with the ported
panels as regression fixtures.

Do not start with the renderer: the catalog entries are what the renderer is
tested against.

## Guardrails

- **No designer, no template GUI, no binary layout format.** Layouts are data.
- **No query layer.** Rows arrive from sure-state; totals are recomputed
  server-side. A document that can query is an ORM with a ruler.
- **No charting dependency, no canvas, no animation.** Figures are SVG.
- **Sheets are siblings** (`design §9.3`). A page break is between top-level
  boxes, never a block inside one. The first consumer shipped a sheet nested in
  a band: the paper was correct and its site footer printed through page two —
  the defect was only visible on screen, which is why §11 draws the paper there.
- **No product identifiers** — no company name, address, licence, contract
  number, agent id. The public repository cannot hold the denylist it is scanned
  against; that scan runs in the consumer's CI.
- **Never declare a sure-ui block that is not published** — the registry test
  fails, correctly, and a staged publish that lapses takes the block with it.
- **Do not weaken a test to make a phase pass.** Every acceptance row names the
  failure it prevents; if one is wrong, say so and change the row with a reason.

## Verification before claiming a step done

```bash
npm run lint          # tsc --noEmit
npm run build         # tsc -p tsconfig.build.json
npm test              # vitest: unit + fixture goldens
npm run check:exports # every package.json subpath resolves
npm run verify        # all of the above
```

Plus: the doc row for the change (`docs/index.md §When to update what`), a
`CHANGELOG.md` line, and — for anything with an argument — the generated
`docs/schema.json` regenerated.

## Release mechanics (learned the hard way)

1. Upstream first: sure-ui ⇒ sure-factor ⇒ entries ⇒ this package.
2. PR → CI green (`lint, build, test`) → squash merge to `master`.
3. Merging stages the package on npm; a **human with 2FA must approve it**, and
   **staged publishes expire after seven days** — a release staged and forgotten
   simply vanishes. Ask the owner to approve the same day.
4. `master` is to be protected once the repo goes public at first stable release:
   a direct push must fail; everything goes through a PR. Until then the account's
   free `User` plan returns 403 for protection on a private repo, so this is a
   convention only — see `AGENTS.md §Security gate`.

## The product this serves

The first consumer is a proprietary finance application in a separate
repository. It is read-only reference material: its working printout code, its
ported legacy designs and its product wording stay there. **Never copy its data,
wording or geometry here**; if an example needs it, the example is wrong. Its own
documentation describes the paper this package must reproduce, and that
description is deliberately not part of this repository.

The owner is working on that product in parallel. Interface changes to sure-ui
and sure-factor affect it: land and publish upstream first, then tell the owner
which version to adopt.

## When you finish a phase

Tick it in `docs/plan.md`, add the `CHANGELOG.md` line, update the docs surface
it touched, and report in prose what changed and what you deliberately did not
do. The next agent reads that report before reading code — make it honest, and
make it short enough to be read.
