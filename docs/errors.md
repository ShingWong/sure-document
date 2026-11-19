# Error catalog

Every failure the renderer can raise, with the fix. **The codes are the
contract**: they appear in `--agent` envelopes, in the event journal, and in
this table. A code added in `src/` without a row here fails the test suite;
a row here without a code is a lie caught the same way.

Envelope (in `--agent` mode):

```json
{"ok":false,"error":{"code":"E_EXPR","message":"unknown expression \"P:TotlDP\"","hint":"did you mean P:TotalDP?","details":{"expr":"P:TotlDP"},"retryable":false,"exitCode":2},"trace":"op_8f2c","events":[{"seq":99,"type":"error","payload":{"code":"E_EXPR"}}]}
```

| Code | Exit | Raised when | Fix |
|---|---|---|---|
| `E_LAYOUT` | 2 | a layout is malformed: band without height, element without geometry, page without size, a panel/section nested inside another sheet (sheets are siblings, `design §9.3`), or a single table row taller than the printable body height (`design §9.3`, A33) | fix the layout data, or split the row's content across rows; it is data, so the failure names the path |
| `E_ELEMENT` | 2 | an element kind this version does not render | upgrade, or use a supported kind (`docs/design.md §4`) |
| `E_EXPR` | 2 | an expression form outside the vocabulary, or a parameter/field that is not supplied | the vocabulary is closed (`design.md §5`); the hint names the nearest supplied name |
| `E_DATA` | 2 | the data does not match the layout's declared shape (`rows` given to a `record` element, a projection missing a column) | fix the projection at the caller, not the layout |
| `E_FORMAT` | 2 | a declared format cannot render its value (e.g. `date` on a non-date) | fix the data; a format never guesses |
| `E_FONT` | 2 | a declared typography token or font family cannot be resolved by the measurement oracle (A32) | declare a supported sure-ui type token, or supply metrics for the family; never fall back to a host font silently |
| `E_GUARD` | 3 | a `guard` failed: the document printed figures that do not reconcile, or a meaningful watermark (`EXAMPLE ONLY`, `VOID`, `CONFIDENTIAL`) has no textual counterpart in the document's text or metadata (`catalog.md §3` rule 4) | **do not print**. For totals, recompute server-side and re-render; for a watermark, put the same words in the document text or metadata — this is the failure that replaces PDF eyeballing |
| `E_FIXTURE` | 3 | a fixture's expectations do not match the output | the document changed: update the fixture in the same commit, and say so |
| `E_PAGE` | 2 | an element falls outside the sheet (fixed mode) | fix the design; overflow is a layout bug, not a printer's problem |
| `E_PAPER` | 2 | an unknown paper name, a custom size outside 72–14400 pt, a unit mistake (612×792 in `mm`, 8.5×11 in `pt`), paper or orientation that does not match the design (fixed mode), or a document mixing orientations without declaring them per section | correct the sheet, not the design. `error.hint` lists the valid names, or names the likely unit; `sure-document paper list --agent` has the table |
| `E_BINDING` | 2 | the gutter, header or footer leaves a body box narrower than 72 pt, or a gutter is declared without a binding edge | reduce the gutter or the furniture; the document must fit a column |
| `E_TOC` | 2 | the contents did not converge in three passes, a TOC entry resolved to an unnumbered page, or a section was marked `level` outside 1–3 | a contents line with no page number is a lie; fix the layout (usually a section that is too tall to stay with its heading) |
| `E_NUMBERING` | 2 | `origin: content` on a document with no content pages, `startAt` below 1, or a total that would contradict the numbered set | fix the numbering plan; an empty or contradictory footer is worse than no footer |
| `E_BLEED` | 2 | `bleed > 0` without `fullBleed: true`, or the design declares inner margins (white margins cannot bleed), or bleed requested on the browser-print path | bleed is a property of a design that paints to the trim; add it to the design, or drop the bleed |
| `E_IMPOSITION` | 2 | `imposition` requested for browser print, or `booklet` with a page count that is not a multiple of four | imposition is a PDF-path feature; print one page per sheet, or produce the PDF at the edge |
| `E_SCALE` | 2 | a fixed layout asked for `scale ≠ 1.0` | print 1:1. Verify with `sure-document print-check` if the page comes out wrong — the driver is shrinking it, not the document |
| `E_ASYNC` | 2 | a layout asked for something asynchronous (fetch, image URL) | not supported: all data is supplied before render |
| `ECONFIRM` | 4 | a destructive command ran without `--yes` | add `--yes`; nothing was changed |
| `EINTERACTIVE` | 4 | a command wanted a prompt | pass the flag named in `error.hint`; nothing waits |

## Rules the catalog encodes

1. **Fail closed.** A document that cannot be rendered correctly is not rendered
   at all — never a page with a blank where a total should be. (A blank *field*
   the design leaves empty is different: that is `P:…` returning null, which is
   legal.)
2. **No silent coercion.** `"1,500.00"` is not a number, `"05/27/08"` is not a
   date. The renderer formats values it was given as typed data.
3. **Errors are events.** Every failure is also emitted with a journal sequence,
   so a supervising agent sees the failure even if it did not run the command.
4. **Hints are actionable.** Where a near-miss exists (a misspelt parameter, a
   missing column), the hint names it. A hint that repeats the message is a bug.

## What is *not* an error

| Situation | Why it renders |
|---|---|
| a parameter is `null` and the design's `ifpresent` guard covers it | the design said "print nothing here" |
| a projection column is absent from one row | blank cell, as the 2007 forms did |
| a figure has no series | an empty plot frame, with the axis drawn — not a missing chart |
| a document has zero rows | header plus "no activity", as the design dictates |
