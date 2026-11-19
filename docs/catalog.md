# Report component catalog

A **catalog of document parts** in the same form as sure-factor's component
catalog, hosted in **`sure-store/components/`** (MIT) and consumed through
sure-factor's loader.

The value is not a designer. It is a fixed vocabulary an agent can compose
from: *these parts exist, this is the data shape each eats, this is what its
output must satisfy.*

---

## 1. The same catalog, four new keys

An entry is a sure-factor `CatalogComponent` — `name`, `description`, `tier`,
`parameters`, `behavior`, `sure_ui`, `cssClasses`, `example` — plus four keys
this package needs. They are a **schema extension to sure-factor** (0.6), not a
parallel registry: two catalogs would drift exactly as the class vocabulary once
did.

```yaml
name: document-table
description: Repeating rows with a repeated header, optional subtotal, kept together on a page.
tier: prototype

parameters:
  fields:
    - { name: columns, type: text, required: true }
    - { name: rows, type: text, required: true }
    - { name: subtotal, type: boolean, required: false }
    - { name: keepTogether, type: boolean, required: false }

behavior:
  notificationModes: []
  audio: { errorBell: false, successChime: false }
  voiceHelp: false
  autoFocus: false
  confirmBeforeCancel: false

# ── the extension ───────────────────────────────────────────────────────────
family: data                      # structure | data | figure
data:
  entity: invoices                # a sure-state store
  projection: [line_number, due_on, amount]
  shape: rows                     # record | rows | series | none | derived
print:
  keepTogether: true
  breakBefore: false
  repeatHeader: true
guards:
  - "totals.grand_total == sum(rows.amount)"
fixture:
  input:  { rows: [{ line_number: 1, due_on: "2031-04-15", amount: 120.00 }] }
  expect: { html_contains: ["$120.00"], pages: 1 }
# ────────────────────────────────────────────────────────────────────────────

sure_ui: [table, form, buttons]
cssClasses:
  form: sure-table
  row: sure-table__row
  cell: sure-table__cell
  header: sure-table__header
```

`form` and `buttons` are declared even though this is not a form: sure-factor's
template generator emits a form wrapper and a submit button for **every** catalog
component, and its registry test enforces the coverage (`markdown` and
`horizontal-icon-menu` declare them for the same reason). Claiming less would
make the test fail — correctly.

## 2. Only two new sure-ui blocks

The registry derives a class's family from its first token
(`sure-table__row` → `table`) and fails if that family is not in sure-ui's
`COMPONENTS`. So the rule for this catalog is: **reuse a family unless the sheet
genuinely needs a new one.**

| Catalog entry | Block(s) | Classes |
|---|---|---|
| `document-sheet` | **`document`** *(new)* | `sure-document`, `__sheet`, `__header`, `__footer`, `__page`, `__signature` |
| `document-section` | `document` | `sure-document__section` |
| `document-note` | `markdown` | `sure-markdown` (prose, already themed) |
| `document-keyvalue` | `table` | `sure-table__row`, `__cell`, `__header` |
| `document-table` | `table` | same, plus `sure-table--print` |
| `document-totals` | `table` | same, plus `sure-table--total` |
| `document-schedule` | `table` | same |
| `document-signature` | `document` | `sure-document__signature` |
| `document-graphic` | `document` | `sure-document__graphic` |
| `document-header`, `document-footer` | `document` | `sure-document__header`, `__footer`, `__zone` |
| `document-page-number`, `document-date` | `document` | `sure-document__page`, `__date` |
| `document-watermark` | `document` | `sure-document__watermark` |
| `figure-bar`, `-line`, `-sparkline`, `-donut` | **`figure`** *(new)* | `sure-figure`, `__plot`, `__axis`, `__bar`, `__line`, `__legend` |
| `figure-legend` | `figure` | `sure-figure__legend` |

Two blocks, therefore two upstream releases — and the order matters:

> sure-ui ships `document` and `figure` **first**; only then may an entry
> declare them, because sure-factor's registry test validates the catalog
> against the *installed* sure-ui. (Precedent: `footer` had to land in sure-ui
> 0.3.4 before sure-factor 0.5.8 could declare it.)

## 3. Families

### Structure

| Entry | Shape | Owns |
|---|---|---|
| `document-sheet` | none | paper, orientation, binding/gutter, body box, scale — see below |
| `document-section` | none | titled block; `breakBefore`, `startOn: any \| recto`, and a narrow sheet override (paper, orientation, margins, bleed) |
| `document-note` | none | prose from markdown (notices, disclosures) |
| `document-keyvalue` | record | label/value pairs; labels from sure-factor metadata |
| `document-signature` | record | signature/date rules, printed name |
| `document-header` | record | running header: three zones, rule, repeat rule |
| `document-footer` | record | running footer: three zones, rule, repeat rule |
| `document-page-number` | none | `Page 1 of 4`, origin/display/scope (below), format |
| `document-date` | record | an issued or captured date — never the clock |
| `document-logo` | none | vector mark, monochrome print variant, alt text |
| `document-watermark` | none | rotated text: `Confidential`, `Example Only`, `Void` |
| `document-toc` | **derived** | contents from section headings, numbers from the pagination plan |

### The sheet: paper, orientation, binding, scale

One entry owns the physical page, because these four are the same decision.

| Option | Values | Rules |
|---|---|---|
| `size` | a name from the paper table below, or `custom` with `w`/`h` in `pt \| mm \| in` | **must equal the design's declared page** in fixed mode — a legal form on different stock is a different document (`E_PAPER`) |
| `orientation` | `portrait \| landscape` (per document, or per section in flow) | it rotates the **paper**, not the design: a fixed panel keeps its coordinates and its orientation must match, because rotating a signed form is a layout change, not a print option |
| `margins` | `top/right/bottom/left` in pt, or a single number; default 36 pt (0.5 in) | declared in the sheet's frame **after** orientation; the body box is what remains after margins, gutter, header and footer |
| `binding` | `edge: left \| right \| top \| bottom`, `gutter: pt`, `mirror: boolean` | the gutter comes **out of the body box**, not the page. `mirror` alternates the gutter side on odd/even sheets for duplex — free to implement because the renderer paginates (`design §9`) |
| `fullBleed` | `boolean`, default false; `bleed` = number or `{top,right,bottom,left}` in pt | ink past the trim. **Per page or per section, not necessarily the whole document** — a brochure cover bleeds, the letter inside it does not. Valid only when that page's design paints to the edge (`E_BLEED`); PDF path only. `cropMarks: boolean` draws trim marks outside the bleed |
| `bleedFallback` | `trim \| none`, default `trim` | what a bleeding page does on a path that has no bleed (browser print, or a shop that trims blind): `trim` extends the painted area to the trim edge and warns that a sliver of white may show; `none` refuses with `E_BLEED` |
| `duplex` | `simplex \| duplex-long-edge \| duplex-short-edge` | declares how the sheets are to be turned; drives mirrored margins, recto/verso and blank-page insertion. The printer is asked, never commanded — a PDF can carry a preference, a browser print cannot |
| `imposition` | `none \| n-up-2 \| n-up-4 \| booklet` | pages arranged on one sheet side (side-by-side printing). **PDF only** — a browser prints one page per sheet (`E_IMPOSITION`). `booklet` needs a page count multiple of 4 and is out of scope for 0.1 |
| `cutMarks` | `{ axis: vertical \| horizontal, at: pt[], style: hairline \| dashed }` | for perforated coupon sheets: drawn outside the body and clipped from it; they do not count as content (`A20`) |
| `scale` | number, default `1.0` | a **fixed** layout must be 1.0 — scaling it moves the boxes a customer signs (`E_SCALE`). Flow may use `fit: none \| width \| page`; the computed factor is recorded as `appliedScale` in the capture |
| `zoom` | — | **not a document property.** A viewer may scale the preview with a CSS transform; it must never change the print output or the capture hash (`A21`) |

The body box is arithmetic, not a hint:

```
body.width  = sheet.width  − margins.left − margins.right − gutterOnBindingSide
body.height = sheet.height − margins.top  − margins.bottom − header.height − footer.height
```

A gutter or header/footer combination that leaves a body narrower than 72 pt
(one inch) fails `E_BINDING` — a document that cannot fit a column is a layout
error, not something to discover at the printer.

**Side-by-side, disambiguated.** Two different requests wear that name:

| Meaning | Where it lives |
|---|---|
| viewing two pages next to each other while reading | a **viewer** transform, like zoom — never in the document, never in the PDF (`A21`) |
| printing two document pages on one sheet side | `imposition: n-up-2`, **PDF only**, with logical page numbers unaffected and cut marks between the pages (`A25`) |

A two-column *coupon sheet* is neither: the columns are part of the design
(`columnCount` in the original), so the renderer lays them out as content and
imposition has nothing to do with it.

#### Page numbering: origin, display, scope

Three independent switches, because conflating them produces documents that lie
about their own length:

| Switch | Values | Means |
|---|---|---|
| `origin` | `first` (**default**) \| `content` | where counting starts. `content` skips the cover: it is not numbered *and not counted*, so the first content page is **1 of N−1** |
| `firstPage` | `show` \| `hide` | whether the number is **printed** — hiding does not stop counting |
| `startAt` | number, default 1 | the first counted page's number, for a document assembled from parts (a binder whose fourth part is page 12) |
| `scope` + `restart` | `document` \| `section`, `boolean` | numbering runs through the document, or restarts per section (a packet whose notice begins at 1) |
| `style` | `arabic` \| `roman-lower` \| `roman-upper` | `i, ii` for front matter, then `1, 2` for content |

Rules:

1. **`hide` ≠ not counted.** A cover with `firstPage: hide` still occupies page 1,
   so the body ends at *N of N*. Only `origin: content` changes the total.
2. **The total counts numbered pages**, not sheets: a blank verso inserted to
   keep a section on a recto neither receives a number nor contributes to `N`.
   It still occupies a sheet, so page 3 of 7 can be printed on sheet 5 — the
   pagination report says so (`pages[]` carries `sheet`, `number`, `blank`).
3. **`origin: content` needs a content page.** A document that is all cover
   fails `E_NUMBERING` rather than printing `0 of 0`.
4. **Restart is a section decision**, and a restarted section starts at 1 unless
   `startAt` says otherwise; `restart` without sections is a no-op warning.
5. **Style is display only.** It never changes counts, and `total` uses the same
   style, so `i of iv` and `1 of 4` describe the same four pages.

**A cover page is not a special case.** It is the existing parts composed:

```yaml
cover:                          # the first section of a flow document
  sheet: { fullBleed: true, margins: 0 }
  furniture:
    header:      { repeat: none }
    footer:      { repeat: none }
    # origin: content → the cover is not counted, so content starts at 1 of N−1.
    # firstPage: hide would print nothing but still count it. Choose deliberately.
    pageNumber:  { origin: content }
  body: [document-graphic, document-note]   # logo, title, subtitle, date
```

Nothing new is needed for a cover except the bleed itself, and the furniture
rules that make the inside pages ordinary are already specified
(`repeat: notFirst`, `firstPage: hide`). A cover that bleeds is a page whose
design paints to the edge; a cover that does not is a page with margins. Both
are the same sheet with different values.

**Bleed is completeness, not a requirement.** Most documents here are forms on
white stock; bleed exists because a customer may want a brochure-looking cover.
The data model reserves it from the start (cheap), the first release renders
without it (honest), and a page that asks for it on a path that cannot deliver
it either falls back to trim with a warning or refuses — never silently prints a
white ring where the design promised ink.

**A break is a sibling, not a block.** Every sheet a document produces is a
top-level member of `sheets[]` (`design §9.3`): a section break, a `startOn:
recto` blank, and a second panel all append a *sibling*. A section is never a
block nested inside the previous sheet's body, even though the markup would
allow it — a nested sheet overflows the box it sits in, and everything that
follows the document then paints through it.

**Duplex rules**

1. `duplex-long-edge` mirrors the gutter and puts page 1 on the **recto**.
2. A section may declare `startOn: recto`; if the previous section ended on a
   recto, a blank verso is inserted. Blank sheets are **unnumbered**, carry no
   header or footer, and are reported as `pages[].blank = true` so a test can
   count them.
3. `simplex` with `mirror: true` is allowed (an office that binds only odd
   sheets); `duplex-long-edge` with `mirror: false` is a warning, not an error —
   asymmetric binding exists.
4. The document *declares* duplex; it cannot set the printer. A PDF written at
   the edge may carry a viewer preference, which is advice, and the layout never
   assumes it was followed.

Two things the renderer cannot control, and therefore does not pretend to:
a printer driver's "fit to page", and a photocopier's zoom. The defence is a
**print-check** command (`sure document print-check`), which emits a sheet with a
calibrated 4 in / 100 mm rule so someone can verify 1:1 on the actual device.
That is a diagnostic, never part of a document.

#### Paper sizes

Ten named sizes cover what a finance office prints; anything else is `custom`.
The table is data, not prose — the renderer ships it, `sure document paper list
--agent` returns it, and an agent should read it rather than hard-code numbers.

| Name | Also known as | in | mm | **pt** (canonical) |
|---|---|---|---|---|
| `letter` | US Letter, ANSI A | 8.5 × 11 | 215.9 × 279.4 | 612 × 792 |
| `legal` | US Legal | 8.5 × 14 | 215.9 × 355.6 | 612 × 1008 |
| `tabloid` | Ledger, ANSI B | 11 × 17 | 279.4 × 431.8 | 792 × 1224 |
| `executive` | — | 7.25 × 10.5 | 184.15 × 266.7 | 522 × 756 |
| `statement` | Half Letter, Memo | 5.5 × 8.5 | 139.7 × 215.9 | 396 × 612 |
| `a3` | ISO A3 | 11.69 × 16.54 | 297 × 420 | 841.89 × 1190.55 |
| `a4` | ISO A4 | 8.27 × 11.69 | 210 × 297 | 595.28 × 841.89 |
| `a5` | ISO A5 | 5.83 × 8.27 | 148 × 210 | 419.53 × 595.28 |
| `a6` | ISO A6 | 4.13 × 5.83 | 105 × 148 | 297.64 × 419.53 |
| `b5` | ISO B5 | 6.93 × 9.84 | 176 × 250 | 498.90 × 708.66 |

Rules:

1. **Points are canonical.** Everything in a layout is points (72 to the inch);
   inch and millimetre values are conveniences, converted once at parse
   (`1 in = 72 pt`, `1 mm = 72/25.4 pt`) and compared in points thereafter.
2. **Named sizes are portrait.** `orientation: landscape` swaps the two
   dimensions after lookup; a size name never implies an orientation.
3. **`custom` normalises at parse**, and is then indistinguishable from a named
   size — the rest of the system never sees the unit.
4. **A unit mistake is caught, not printed.** `612 × 792` declared in `mm`
   (a metric page 21 inches wide) or `8.5 × 11` declared in `pt` (a stamp) fails
   `E_PAPER` with a hint naming the likely unit. The bounds are 72 pt (1 in) to
   14400 pt (200 in) on either side.
5. **An unknown name lists the valid ones** in `error.hint`, and the same list is
   available from `sure document paper list --agent` — an agent should never have
   to guess a spelling.
6. **Default is `letter`**, because the office is in the US; a product may set
   its own default, and a fixed design's size always wins over it.

### Sheet furniture — the six that were missing

These are *sheet* features, not band features: they must work identically over a
fixed panel and a flow document, and they must survive printing.

| Entry | Options | Rules |
|---|---|---|
| `document-header` | `zones: {left, center, right}`, `rule: boolean`, `repeat: all \| notFirst \| none`, `height` | exactly one per sheet; content is text/slot fillers (below); a guard fails if it exceeds `height` — the header never overlaps the body |
| `document-footer` | same zones and rules, `repeat` defaults `all` | reserves its own height from the body; may not contain the page number *and* a page-number element (guard) |
| `document-page-number` | `origin: first \| content`, `firstPage: show \| hide`, `startAt: number`, `scope: document \| section`, `restart: boolean`, `style: arabic \| roman-lower \| roman-upper`, `format: page-of-total \| n \| n/total`, `total: boolean`, `prefix`, `suffix`, `align` | two separate questions — **where counting starts** (`origin`) and **whether it is shown** (`firstPage`) — see the rules below. `total` requires the **pagination pass** (design §9) |
| `document-date` | `kind: issued \| captured`, `format`, `label`, `timezone` | **never the clock.** `issued` comes from the data; `captured` is an input supplied by the capture step. `timezone` defaults to UTC so the same document prints the same date anywhere (A2, A8) |
| `document-logo` | `svg` (inline, no URL), `maxHeight`, `monochrome`, `alt`, `fallback: wordmark` | vector only; intrinsic aspect preserved; `monochrome` renders in `currentColor` for print; a missing asset falls back to the wordmark, never a broken box |
| `document-watermark` | `text`, `angle` (degrees, default **-45**), `opacity` (0.06–0.15), `scale`, `repeat: single \| tile`, `step`, `pages: all \| first \| body`, `mode: screen \| print \| both` | see the rules below |

#### Watermark rules

1. **Arbitrary angle, one transform.** The layer covers the sheet and is clipped
   (`overflow: hidden`, diagonal-sized); the text is rotated by `angle` about its
   centre. Tiling repeats it on a grid whose offsets are derived from `angle` and
   `step` — never from a clock or a random seed (A8).
2. **Behind, never over.** `z-index` below the body, `pointer-events: none`,
   `user-select: none`, `aria-hidden="true"`, opacity capped at **0.15** so it
   cannot reduce the contrast of text on top of it (guard: the cap is enforced,
   not documented).
3. **It prints.** `mode: print` (or `both`) must survive the print stylesheet and
   the page margins; a watermark that only exists on screen is a lie about the
   paper. A12/A14 check the PDF.
4. **It is not a notice.** If the words carry meaning — `EXAMPLE ONLY`,
   `VOID`, `CONFIDENTIAL` — the same words must also appear in the document's
   **text or metadata**, because a watermark is invisible to a screen reader, a
   text extractor, a photocopier set too light, and an OCR pass. A guard fails
   when a meaningful watermark has no textual counterpart.
5. **Non-production stamps itself.** `defaultFromEnv: true` → when the host is
   not production, the sheet is stamped `EXAMPLE ONLY` unless the layout says
   otherwise. A preview deployment must not be able to print an unmarked
   contract that looks real.

### Contents — the derived entry

`document-toc` is the first entry whose data is **not supplied**; it is computed
from the layout itself:

```yaml
document-toc:
  levels: 1..3              # which section headings appear
  leaders: none | dots      # dot leaders to the number
  numbering: content        # entries show the content numbers (arabic), even when the TOC itself is front matter (roman)
  links: screen             # a link on screen; print shows text, never a blue underline
  title: "Contents"
```

Rules:

1. **Derived, not authored.** An entry appears because a section exists, and its
   page number comes from the pagination plan (`design §9.1`). A hand-written
   TOC is a second source of truth and will be wrong within a month.
2. **A fixed point.** Adding the TOC shifts the content it numbers, so the render
   iterates: lay out → paginate → build the TOC → lay out again, until the TOC's
   own length stops changing (bounded at three passes, else `E_TOC`). A TOC that
   spills onto a second page is therefore not a bug but a second iteration.
3. **Front matter.** The TOC section declares `frontMatter: true`, so
   `origin: content` numbering excludes it along with the cover. Entries still
   show content numbers — a TOC whose own pages are `i, ii` and whose entries
   read `1, 2` is the normal convention, not an inconsistency.
4. **Accessible by construction.** An ordered list, and each entry's *text*
   includes its page number (`Appendix … 12`), not just a right-aligned span a
   screen reader drops.
5. **No PDF outline promise here.** Bookmarks in a PDF are an edge feature of
   the product's PDF step; the layout cannot guarantee them.

Deferred past 0.1 (see `plan.md`), but **anchors are not**: the pagination plan
must expose `sections[] { id, title, level, page }` from the first release, or
adding a TOC later means reworking the pass.

### Data

| Entry | Shape | Owns |
|---|---|---|
| `document-table` | rows | columns, formats, repeated header, keep-together |
| `document-totals` | record | labelled totals; **displays** server figures, never computes the binding one |
| `document-schedule` | rows | dated installments and their late figures (the coupon arithmetic) |

### Figures

| Entry | Shape | Owns |
|---|---|---|
| `figure-bar` | series | categorical bars, value labels, negatives |
| `figure-line` | series | trend across periods, optional area |
| `figure-sparkline` | series | inline trend, no axes |
| `figure-donut` | series (≤5) | share of total; refuses more slices than it can name |
| `figure-legend` | series | legend shared by the figures above |
| `document-graphic` | none | logo/illustration, sized by the sheet |

`series` is `{ label, value }[] | { period, value }[]`, declared per entry.

## 4. Figure rules (non-negotiable)

1. **SVG by construction.** Data → scale → path. No canvas, no charting
   dependency, no animation.
2. **Readable in grayscale.** Theme tokens for series colour, plus a
   dash/pattern fallback; a figure that only works in colour is rejected.
3. **Accessible.** `<title>`/`<desc>` on every figure and a data-table fallback
   rendered for print and screen readers.
4. **Honest.** No donut beyond five slices, no truncated axis without a visible
   break, no 3D, no shadows.
5. **Printable.** Fits the sheet's column width; never assumes hover.

## 5. What does not go in the catalog

- Business wording and legal prose (the product's content; `document-note` carries it).
- A product's column names (referenced by `data.projection`, not owned here).
- Anything that queries, caches or joins.
- A specific document layout — a report is a *composition* of entries and
  belongs to the product.

## 6. When to add an entry

Two products need it, or three reports repeat it. On that rule the first five
are justified already by the first consumer's paper and the statement that follows:
`document-sheet` · `document-header` · `document-footer` · `document-page-number`
· `document-date` · `document-logo` · `document-watermark` (the furniture every
multi-page document needs), then `document-table` · `document-totals`
· `document-keyvalue` · `document-schedule`, then `figure-bar` for the first
flow document.

## 7. Upstream work, in order

| # | Package | Change |
|---|---|---|
| 1 | sure-ui | `document` + `figure` blocks (print rules, figure typography) — tests: every theme, tokens only |
| 2 | sure-factor | catalog schema: `family`, `data`, `print`, `guards`, `fixture`; registry test understands them; `report` generation target |
| 3 | sure-store | the entries land in `components/` with fixture goldens (MIT) |
| 4 | sure-document | the renderer that consumes them |
| 5 | sure-state | the event journal (`seq`, ring buffer) that makes `--agent` events a promise it can keep |
