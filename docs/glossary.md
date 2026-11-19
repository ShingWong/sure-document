# Glossary

One word per concept. If code, docs or a commit message needs a synonym, the
synonym is the bug — an agent that has to guess which of two words means the
same thing will guess wrong.

| Word | Means | Not |
|---|---|---|
| **document** | a whole printed artefact: agreement, notice, statement, coupon sheet | a file, a page, a record |
| **layout** | the arrangement — bands, elements, geometry, or sections and flow | a template with logic in it |
| **sheet** | one physical page of paper: size, margins, header/footer slots | a web page |
| **sheet set** | the flat, ordered `sheets[]` a document renders to; a break is between members, never inside one | a DOM subtree, one HTML page |
| **band** | a horizontal strip of a fixed layout that lands on the sheet as a unit | a section (that is flow) |
| **section** | a block in a flow layout; its height comes from its content | a band |
| **expression** | the closed, scoped vocabulary of `design §5`: `@`/`root.` for parameters, `.`/`row.` for the current row, five aggregates, `ifpresent` | a script, a bare identifier, `P:`/`F:` |
| **element** | one placed thing: text, field, line, box, image, table, figure | a component (that is a catalog entry) |
| **panel** | a complete fixed layout, e.g. the ported agreement — a renderer's **input**; one panel can become several sheets | a page, a sheet |
| **projection** | the columns a document prints, taken from a store's row | a query, a select |
| **row** | one entity from a store, as the renderer receives it | a database row |
| **guard** | a machine-checkable rule over the data a document printed | a warning |
| **fixture** | an input plus the output facts a document must produce | a screenshot |
| **synthetic fixture** | test data generated from a recorded seed, carrying `"synthetic": true` and that seed | scrubbed production data, copied JSON, unseeded random rows (`acceptance.md §1`) |
| **fixed** | absolute geometry in points, from a design | legacy (it is a supported mode) |
| **flow** | banded layout whose length is data | modern |
| **render** | layout + data → HTML, purely | print, export |
| **capture** | a rendered document frozen with a timestamp and content hash | render |
| **furniture** | sheet-level parts that repeat or identify: header, footer, page number, date, logo, watermark | a band, a section |
| **running header** | the header repeated on every sheet of a multi-page document | the document title inside the body |
| **watermark** | rotated text drawn behind the body (`Example Only`, `Void`) — never the only carrier of a notice | a notice, a stamp |
| **issued date** | a date originating from domain data (`effective_on`, an invoice date) — `kind: issued` | the clock, a captured date (`design §10`) |
| **captured date** | an explicit input timestamp frozen at the moment of capture — `kind: captured` | `Date.now()`, the clock, a runtime timestamp (`design §10`) |
| **pagination pass** | the measurement step that cuts flow content into sheets and makes `of N` true | browser page breaks |
| **measurement oracle** | the injected function that measures element dimensions from declared sure-ui type tokens during pagination | a headless browser, DOM measurement, or host font metrics (A32) |
| **paper size** | a named size from the ten-entry table, or a custom `{unit, w, h}` normalized to points | a sheet, an orientation |
| **body box** | what is left of the sheet after margins, gutter, header and footer | the sheet |
| **gutter** | extra inner margin for binding; comes out of the body | a margin |
| **binding edge** | the side that is bound or punched (`left`, `right`, `top`, `bottom`) | the margin side |
| **mirror margins** | the gutter alternating sides on odd/even sheets for duplex | two-sided printing in general |
| **bleed** | ink past the trim, only from a design that paints to the edge, PDF-only | a margin, padding |
| **trim** | the line the sheet is cut to; the page box a reader sees | the media box |
| **numbered page** | a page that carries a logical number and counts toward `N` | a sheet |
| **section mark** | the pagination pass's record of a section: stable id, title, level, page | a heading in the text |
| **contents (TOC)** | a derived page listing section marks and their numbers | a hand-written list |
| **fixed point** | the iteration that settles a TOC's own length against the numbers it reports | a second pass |
| **dot leader** | the row of dots between an entry and its page number | a tab |
| **front matter** | pages before the content that use roman numbering (`i, ii`) | the cover |
| **numbering origin** | where counting starts (`first` or `content`) — distinct from whether the number is printed | `firstPage: hide` |
| **cover page** | an ordinary sheet with bleed and its furniture switched off — not a special component | a template |
| **crop marks** | hairlines outside the bleed showing where to cut | cut marks |
| **duplex** | sheets printed both sides; `long-edge` mirrors the gutter and puts page 1 on the recto | mirrored margins (they follow from it) |
| **recto / verso** | the front (odd) and back (even) of a leaf | left/right page |
| **imposition** | arranging document pages onto a sheet side (`n-up-2`, `n-up-4`, `booklet`) — PDF only | a two-column design, a viewer's side-by-side |
| **n-up** | N document pages on one sheet side, with cut marks and logical numbering unchanged | columns of content |
| **cut marks** | hairlines in the margin showing where a sheet is cut (coupons) | content |
| **scale** | a rendering factor the document applies and records | zoom |
| **zoom** | a viewer transform on the preview; never printed | scale |
| **applied scale** | the uniform factor recorded after pagination for `fit: width \| page` | viewer zoom, pre-pagination reflow (`design §3.3`) |
| **template** | sure-factor's Handlebars/htmx output — a *generator* word, never a document | a layout |
| **report** | the catalog *family* of parts; also the domain word for "a document with rows" | the engine |

## Spelling decisions

- `document`, never `doc` — package, block, entries, CLI verb, code all agree
  (see `README.md §Name`).
- UK spellings — `programme`, `licence`, `colour`, `millimetre`, `centre` — are
  not used; code and docs are US English, matching the paper the office prints.
- Field **labels** belong to sure-factor; print **formats** belong here. Two
  words, two owners — do not use "format" for a label.

## Reading a name

| Name | Reads as |
|---|---|
| `sure-document` | the standalone CLI binary for this package: `render\|validate\|paper\|vars\|state\|events`; resolves `--entity`/`--id` through sure-state, while the library call is `renderDocument({ layout, data })` |
| `document-table` | a table that is part of a document (print) — not the interactive `data-table` |
| `figure-bar` | a bar figure — SVG, printable, one data shape: series |
| `sure-document__sheet` | the sure-ui class for the sheet inside the document block |
| `renderPanel` | one panel → the fragment it draws; a convenience, not the document |
| `renderDocument` | whole-document entry point → `sheets[]`; composes panels or flow |
