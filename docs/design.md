# Design — the document layer

Numbered like the other design docs in the stack: each section is a decision
with its reason, dated, so a later reader can tell what was settled from what
was merely tried.

---

## 1. The problem

Documents in the stack have been produced by JasperReports: `.jrxml` designs
compiled to `.jasper`, filled with a map of parameters by a Java action, exported
to PDF by iText. It worked for twenty years and then became a liability:

- the design is a **binary** — an agent cannot read it, diff it, or check it;
- the values are assembled **by hand in Java**, so the paper can disagree with
  the database and nothing notices;
- the renderer needs a JVM and a 2007 stack no one else runs.

The rewrite already proved the alternative on the actual forms: the three
legacy designs were parsed into data (coordinates in points) and rendered by
~250 lines of TypeScript. This package is that renderer, generalised and given
a contract.

## 2. What a document is

**Layout + data → HTML.** Nothing else.

- **Layout**: a tree of bands and elements with geometry in points, or a flow of
  sections whose height comes from their content. Data, not code.
- **Data**: a record of named values (parameters) and, for a repeating band, a
  row set. Supplied by the caller from **sure-state**.
- **Output**: HTML (primary) and PDF (optional, via headless Chromium).

A document never reads a database, never formats money from a locale, and never
decides wording.

## 3. Two layout modes, named apart

| Mode | Geometry | Use |
|---|---|---|
| `fixed` | absolute, in points, from a design | legal forms: the premium finance agreement and its notice page. The customer signs *this* shape |
| `flow` | bands, sections, repeating rows, keep-together | statements, cancellation notices, anything whose length is data |

They are not variants of one engine; they are two renderers sharing an element
model and formatters. Trying to make coordinates reflow, or a flow model hit a
fixed position, is how reporting engines become unmaintainable.

The fixed corpus is the ported legacy designs. They are also the regression
test: their output must not move.

### 3.1 The sheet: paper, orientation, binding

The sheet is a first-class input, not a stylesheet side effect:

```ts
/** Ten named sizes, in points, portrait; see docs/catalog.md "Paper sizes". */
export const PAPER_SIZES = {
  letter: { w: 612, h: 792 }, legal: { w: 612, h: 1008 },
  tabloid: { w: 792, h: 1224 }, executive: { w: 522, h: 756 },
  statement: { w: 396, h: 612 },
  a3: { w: 841.89, h: 1190.55 }, a4: { w: 595.28, h: 841.89 },
  a5: { w: 419.53, h: 595.28 }, a6: { w: 297.64, h: 419.53 },
  b5: { w: 498.9, h: 708.66 },
} as const

type PaperSize =
  | keyof typeof PAPER_SIZES
  | { unit: "pt" | "mm" | "in"; w: number; h: number }   // custom, normalized to pt at parse

/**
 * The sheet is document-level; a **section** (or the single page of a fixed
 * panel) may override size, orientation, margins and bleed. That is how a
 * brochure cover bleeds while the letter inside it does not.
 */
type SheetOverride = Partial<Sheet>

interface Sheet {
  size: PaperSize
  orientation: "portrait" | "landscape"
  margins: { top: number; right: number; bottom: number; left: number }   // points
  binding?: { edge: "left" | "right" | "top" | "bottom"; gutter: number; mirror: boolean }
  fullBleed?: boolean
  /** On a path without bleed: extend paint to the trim (and warn), or refuse. */
  bleedFallback?: "trim" | "none"
  bleed?: number | { top: number; right: number; bottom: number; left: number }
  cropMarks?: boolean
  cutMarks?: { axis: "vertical" | "horizontal"; at: number[]; style: "hairline" | "dashed" }
  duplex?: "simplex" | "duplex-long-edge" | "duplex-short-edge"
  imposition?: "none" | "n-up-2" | "n-up-4" | "booklet"
}
```

Decisions:

- **Points are canonical; named sizes are portrait.** Inch and millimeter
  inputs are converted once at parse (`1 in = 72 pt`, `1 mm = 72/25.4 pt`), and
  `orientation` swaps the dimensions afterwards. Converted values are rounded to
  **4 decimal places** at that single parse, before serialization or the capture
  hash, so a millimeter input and its point equivalent produce identical bytes
  (A8, A19b). Downstream code only ever sees points, so a custom size and a named
  size are indistinguishable after parse.
- **A unit mistake fails loudly.** `612 × 792` in `mm`, or `8.5 × 11` in `pt`,
  is a typo that would otherwise print a 21-inch page (`E_PAPER`, with the likely
  unit in the hint). Bounds: 72 pt to 14400 pt per side.
- **Orientation rotates the paper, not the design.** In fixed mode the page size
  must equal the design's; a landscape request for a portrait form is a layout
  change and is refused (`E_PAPER`), not silently rotated.
- **The gutter comes out of the body**, never out of the page — otherwise the
  right margin silently shrinks and a signature line runs into the trim.
- **Mirrored margins are per-sheet padding.** They are cheap here only because
  the renderer paginates (§9); relying on the browser to alternate margins would
  require paged-media support that Chromium does not have.
- **Overrides are per page, and narrow.** A section may override size,
  orientation, margins and bleed — never the binding of the document, never the
  duplex. A fixed legal panel may not be overridden at all (`E_PAPER`), because
  the form's paper is part of what the customer signs.
- **Bleed is a claim about the design, not a setting.** `fullBleed: true`
  asserts that the design paints to the trim edge; only then is `bleed` valid,
  and only the PDF path can carry it. A document with white margins that asks
  for bleed is refused (`E_BLEED`) rather than quietly padded — padding a white
  margin with white ink is the kind of "fix" nobody notices until the trim is
  off by 3 mm.
- **Duplex is declared, not enforced.** `duplex-long-edge` mirrors the gutter
  and puts page 1 on the recto; a `startOn: recto` section inserts an unnumbered
  blank verso. A PDF can carry a viewer preference; a browser print cannot, so
  the layout never assumes the advice was taken.
- **Cut marks are furniture, not content**: drawn in the margin, clipped from
  the body, and excluded from the capture hash's content section.

### 3.2 Imposition, and what is not imposition

`imposition` arranges **document pages** onto a **sheet side**: `n-up-2`,
`n-up-4`, and `booklet` (saddle-stitch, pages must be a multiple of four).

- It exists only on the PDF path. A browser print dialog prints one page per
  sheet and cannot be told otherwise, so requesting it there is `E_IMPOSITION`.
- Page numbering stays **logical**: page 3 is page 3 even when it lands in the
  bottom-left of a 4-up sheet. Imposition changes the sheet, never the document.
- Cut marks separate the imposed pages; they are drawn in the margin, clipped
  from the body, and excluded from the capture hash's content.
- A two-column *coupon sheet* is a **design layout**, not imposition: the
  columns are content. The distinction matters, because imposition of coupons
  would cut them in half.

### 3.3 Scale is not zoom

Two numbers people confuse, and the confusion costs a legal form its geometry:

| | `scale` | `zoom` |
|---|---|---|
| what | a rendering factor applied by the document | a viewer transform on the preview |
| affects print | yes | **never** |
| affects the capture hash | yes (recorded as `appliedScale`) | no |
| allowed in fixed mode | only `1.0` (`E_SCALE`) | irrelevant |
| allowed in flow mode | `fit: none \| width \| page`, applied once after pagination (`appliedScale` recorded) | irrelevant |

`fit` is **not** a layout input. The pagination pass cuts sheets from the
unscaled body; `fit` then applies one uniform scale to those finished sheets. It
never feeds back into pagination, so sheet count and boundaries are fixed before
scaling and there is no convergence loop — the reason it is deterministic (A21),
and why `zoom`, a viewer transform that never reaches the paper, is a different
thing.

A printer driver may still shrink the page; that is outside the document, so the
defence is a calibration sheet from `sure-document print-check`, printed on the
real device — a 4 in / 100 mm rule that either measures true or reveals the
driver is at 96%.

## 4. Element model

```ts
type Element = PrintText | PrintLine | PrintRect | PrintSubreport | Table | Figure

interface PrintText { kind: "text"; x; y; w; h; text?; expr?; format?; align?; size?; bold?; italic? }
interface PrintLine { kind: "line"; x; y; w; h; direction }
interface PrintRect { kind: "rect"; x; y; w; h }
type PrintFormat = "currency" | "number" | "date"
```

Sheet furniture is part of the element model, not a special case of it: a
running header, a footer, a page number, a date, a logo and a watermark are
elements that may appear in either mode, placed on the **sheet** rather than in
a band. That is what lets a fixed legal form and a flowing statement carry the
same furniture.

```
header     { zones: {left, center, right}, rule, repeat }
footer     { zones: {left, center, right}, rule, repeat }
pageNumber { format, firstPage, total }
date       { kind: issued | captured, format, timezone }
logo       { svg, maxHeight, monochrome, alt }
watermark  { text, angle, opacity, repeat, pages, mode }
```

Flow mode adds structural elements (`section`, `row`, `cell`, `keep`, `break`,
`page-number`) rather than reusing coordinates.

Figures are inline SVG built from a scale, with `<title>`, `<desc>` and a
data-table fallback. The fallback serves screen readers; in print it is hidden
by default so the chart and its table do not print back-to-back, and a layout may
opt in. The print rule itself lives in the sure-ui `figure` block (plan Phase 1);
this paragraph is the contract that block implements. See `catalog.md §4`.

Classes follow sure-factor's registry rule — the family is the first token after
`sure-`, and it must exist in sure-ui's `COMPONENTS`. So the sheet and figures
are the only new families (`document`, `figure`); tables, totals and prose reuse
`table` and `markdown`, which the themes already style. See `docs/catalog.md §2`.

## 5. Expressions — a vocabulary, not a language

The legacy designs used `P:` and `F:`. Both are **removed**. Scope is now
explicit, so the parser never guesses which scope a bare name belongs to:

```
@name        root/document parameter
root.name    the same, spelled out
.name        a field of the current row
row.name     the same, spelled out
totals.name  a server-recomputed total (explicit root namespace)
100, 0.05    numeric literals — raw digits, never a name
```

Five aggregates, with comma-separated operands; an explicit array range such
as `rows.amount` is a legal operand:

```
sum: .hours, .rate          sub: @initial, sum: rows.principal
mul: .qty, @price           div: @total, .count
avg: rows.amount            ifpresent: @discount -> @discount
```

**No bare identifiers, no implicit row fallback, no conditionals beyond
`ifpresent`, no loops, no functions, no scripting.** A bare name, a removed
`P:`/`F:` form, a `.field` with no active row, or an `@field` that does not exist
fails closed with `E_SCOPE_INVALID`; an unknown form fails with `E_EXPR`. Every
addition to this vocabulary must be forced by a real document — an expression
language is where a reporting engine stops being verifiable.

An invalid expression **throws** at render time. A document that silently loses
a figure is worse than one that fails to build.

## 6. Formatting

Formats are declared by the design and fixed in the renderer:

| Design pattern | Renderer |
|---|---|
| `¤ #,##0.00` | `$1,234.56` |
| `###0.00` | `1234.56` |
| `MM/dd/yyyy` | `07/07/2008` from `2008-07-07`, parsed as parts so no timezone shifts it |

Field *labels*, validation and column typing are **sure-factor's**
(`fields.json`): a document asks the catalog rather than hard-coding a caption.
`sure-document` owns only the print formats above, because a design declares
them (`¤ #,##0.00`) and the paper must not depend on the viewer's locale.

Catalog entries carry sure-factor's `tier` vocabulary (`vibe`, `prototype`,
`production`); the tier decides how much a generated module inlines, not what
the document prints.

## 7. Data binding to sure-state

A document declares what it needs; the host supplies it:

```ts
interface DocumentSource {
  entity: string             // a sure-state store name (e.g. "contracts")
  projection: string[]       // the columns the document prints
  shape: "record" | "rows" | "series" | "none"
}
```

Rules:

1. **Rows come from the store**, which is server truth. The renderer receives
   plain values.
2. **Totals are recomputed server-side** before the document is built. A
   document may display a total; it may never compute the one that matters.
3. **Live on screen, frozen on paper.** A screen-rendered document may subscribe
   to store events; a printed one is a snapshot with `capturedAt` and a content
   hash, so the same paper can be produced again later.
4. **Events are observable.** When a bound store emits `push`, `action` or
   `error`, a host may refresh or invalidate the document; the document itself
   never listens.

The report component catalog (see `docs/catalog.md`) declares the same
`entity` + `projection`, which is what lets an agent assemble a document without
reading application code.

## 8. Verification: guards and fixtures

The difference from Jasper, stated as a type:

```ts
interface DocumentGuard {
  /** Human-readable rule, e.g. "totals.total == sum(rows.amount)". */
  rule: string
  /** Machine check over the rendered data. Throws or returns the failing pair. */
  check(data: DocumentData): void
}
```

Every catalog component ships a **fixture**: an input and the output facts it
must produce (substrings, page count, element count). Tests replay fixtures;
`--verify-totals` runs the guards against the server's recomputation.

This is what makes the paper checkable by an agent: no PDF eyeballing.

## 9. Pagination and page numbers

Chromium does **not** implement CSS paged-media margin boxes
(`@page { @bottom-right { content: counter(page) } }`), and `position: running()`
is not available. A document that relies on the browser to number its pages
numbers them only in the print dialog's own header, which the layout cannot
control.

So **the renderer paginates**:

- `fixed` mode knows its panel list: page count and numbers come from the design.
- `flow` mode measures content, cuts it into sheets of the declared body height,
  and repeats the header and footer per sheet. That pass is also what makes
  `total` in `Page 1 of 4` true rather than guessed.

This costs a measurement step and buys determinism: the same data produces the
same sheets in the browser and in a PDF at the edge (A6, A12). The
`page.pdf({ displayHeaderFooter })` facility remains available to a *product*
that wants Chromium's own header on an artefact — it is never the mechanism the
layout depends on.

Two consequences worth stating: the flow renderer must know text height before
it can print (a measurement oracle, injected, so tests can be deterministic),
and a sheet is a unit of layout, so `keep-together` is arithmetic over measured
blocks rather than a CSS hint.

The oracle's contract: measurements are keyed to the declared type tokens —
family, size and line-height from sure-ui — and the metric source is an injected
input, never an implicit lookup of the host's fonts or locale. The host must load
the declared fonts, or the design must declare a fixed fallback set, so the
browser wraps lines where the oracle measured them. A font that cannot be
resolved from the declared tokens fails at render rather than silently
substituting a host font (A32). The package ships no font binaries and no metric
engine of its own.

### 9.1 Numbering is a partition, not a counter

The pagination pass returns sheets, and separately a **numbering plan**:

```ts
interface PrintedPage {
  sheet: number      // physical position, 1-based: what a person holds
  section: string
  blank: boolean     // inserted verso — never numbered, never counted
  number?: number    // logical page number; absent = not counted
  display: boolean   // printed or hidden (firstPage: hide)
}
```

Because the pass knows the whole document before anything is printed, "Page 3 of
7" is a fact rather than a guess, and the two questions stay separate:
`origin` decides *which pages carry a number*, `firstPage` decides *whether a
numbered page prints it*. A cover that is hidden but counted, and a cover that is
excluded, produce different totals — which is exactly the bug this separation
prevents.

Alongside the pages, the pass exposes the **sections**:

```ts
interface SectionMark {
  id: string            // stable anchor, from the section's declared id (not its title)
  title: string
  level: 1 | 2 | 3
  page?: number         // filled by the pass; absent for an unnumbered (front-matter) page
  frontMatter: boolean
}
```

Those marks are what a table of contents reads, and they are cheap to emit now
even though the TOC entry itself is deferred.

### 9.2 A table of contents is a fixed point

A TOC reports page numbers and occupies pages, so inserting it moves what it
reports. The render therefore iterates:

```
layout → paginate → sections[] → render TOC → relayout → paginate → …
```

Three behaviors matter:

- **Convergence is bounded.** A TOC that moves from one page to two changes the
  numbers again; the loop stops when the TOC's own length is stable, and fails
  with `E_TOC` after three passes rather than printing numbers it cannot vouch
  for.
- **Front matter is excluded from content numbering**, so the loop only has to
  settle the TOC's own extent, not renumber the world.
- **Entries use content numbers.** A roman-numbered TOC listing arabic content
  pages is correct; a TOC entry whose page is unnumbered is a design error
  (`E_TOC`), because a contents line without a page is not a contents line.

Determinism (A8) still holds: the fixed point depends on layout and data, never
on the clock or on iteration timing.

### 9.3 The paint tree is flat

The pagination pass produces `sheets[]`, and the sheets are **siblings**: one
top-level box per physical page, with the break *between* them.

This is not a styling preference. The first consumer's agreement ends with a
subreport element naming a second panel, and the port rendered that panel in
place — a whole sheet nested inside a band of the first. The band's height is
fixed by the design, so the sheet overflowed it; everything that followed the
document in the flow was then laid out at the end of *page one* and painted
through the middle of page two. The paper was right. The screen was wrong, and
nobody saw it until a human opened the preview.

Four rules follow:

1. **A panel is an input, not an output.** A fixed renderer accepts a panel and
   returns the sheets it becomes. A single-panel convenience is fine for one
   sheet and for fragments (a coupon cell is a panel, not a sheet); the document
   entry point always returns `sheets[]`.
2. **A composition is a sibling.** A design that names a second panel, declares
   a section break, or asks for `startOn: recto` appends a member of `sheets[]`.
   It is never a block inside the previous sheet's body or bands (`E_LAYOUT`).
3. **Nothing is measured across a sheet boundary.** Body content, a running
   header and a keep-together group each belong to exactly one sheet; a group
   that would span two is moved, never split.
4. **A table repeats its head, never its rows.** A continued sheet repeats the
   table's `<thead>`; a row is never split across a boundary (`break-inside:
   avoid`). A row taller than the printable body height fails `E_LAYOUT` rather
   than being clipped or silently shunted to the next sheet (A33).

All four are mechanically checkable, which is the point: an agent asserts the
sheet count, the sibling structure, that the element following the document
begins below the last sheet (A30, A31), and that no row crosses a boundary
(A33).

## 10. Dates: three kinds, and only two are allowed

| Kind | Source | Allowed |
|---|---|---|
| **issued** | the record (`effective_on`, an invoice date) | yes — data |
| **captured** | the capture step that froze the document (an input) | yes |
| **printed at** | the clock at render time | **no** |

A clock in a renderer breaks A8 (same input, same bytes) and makes a reprint
differ from the original. Where a document must say when it was produced, the
host supplies `capturedAt`; the renderer never reads the clock. Timezone defaults
to UTC for the same reason.

## 11. Output

**HTML is primary.** It prints through the browser with `@page`, it is
selectable, accessible, and needs no runtime. `fixed` panels declare their own
page size and margins; `flow` documents rely on the sheet's.

**One layout, two media.** The same markup is the screen preview and the
artefact. On screen a sheet is drawn as the declared paper: its size times
`scale`, the page margins as padding, a gap at each break, a shadow per sheet.
The print rules drop that pretence, because `@page` then owns the size and the
margins. The difference is a media query — never a second renderer, never a
second stylesheet, because a preview built differently from the print is a
preview that lies. The defect in §9.3 was found on a screen and survived a
correct paper pass precisely because nobody had drawn the paper on the screen.

**PDF is a convenience**, produced by headless Chromium when a filing or an
email needs a frozen artefact. It is not a second renderer: same HTML, same CSS.
The dependency stays in the *product*, not in this package.

## 12. The agent surface

`sure-document` is consumed by agents first, so its commands must satisfy the
stack convention:

- `--agent` turns on the machine contract: JSON envelopes, structured errors,
  no prompts, no color.
- errors are emitted **as events** as well as returned, so a supervising agent
  sees failures from operations it did not run.
- complete visibility: `vars` (resolved values with provenance), `state`
  (full store state), `events` (journal with monotonic sequence).
- destructive operations require `--yes`; without it: `ECONFIRM`.

The renderer itself is a pure function, so an agent can call it directly in a
test harness without a browser.

## 13. Non-goals

- A designer, a template GUI, or a WYSIWYG editor.
- A proprietary or binary layout format.
- A charting library, canvas, or animation.
- A query layer of any kind (see sure-state).
- A second component registry (see sure-store/components).

## 14. Open decisions

| # | Question | Leaning |
|---|---|---|
| 1 | Where do the ported fixed panels live — this package or the product? | product content, engine here: the *agreement* is the product's, the *renderer* is the stack's |
| 2 | PDF dependency policy — **closed 2026-11-19** | Chromium at the product edge; this package stays dependency-free (`§11`). Settled; no longer open. |
| 3 | Does the event journal belong in sure-state or here? | sure-state — it emits the events; this package consumes them |
| 4 | License | MIT, like the rest of the shared stack |
| 5 | First flow document | monthly statement — it exercises rows, grouping and a figure; a notice is prose and proves less |
| 6 | New sure-ui families | exactly two: `document` and `figure`. Everything printable that already exists (tables, totals, prose) reuses `table` / `markdown` rather than inventing a family |
| 6a | Watermark default in non-production | stamp `EXAMPLE ONLY` from the environment unless the layout overrides — a preview deployment must not print an unmarked contract that looks real |
| 7 | Order of upstream releases | sure-ui blocks → sure-factor schema 0.6 → catalog entries → this package; the registry test validates against the *installed* sure-ui, so declaring a block early fails CI (the `footer`/0.3.4 precedent) |
