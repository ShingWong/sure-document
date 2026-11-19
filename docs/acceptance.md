# Acceptance tests and the fixture data policy

Two rules, one document: **the fixtures are synthetic**, and **the acceptance
suite says what "correct" means** — for a human reviewing a change and for an
agent that must check its own work.

---

## 1. Data policy — no production data, ever

sure-document is published under MIT. Nothing in it, or in its fixtures, may
come from a real person, a real policy, or a real contract.

| Rule | Why |
|---|---|
| **Fixtures are generated**, never copied | a copied row carries a person with it |
| **The generator is seeded** and the seed is recorded in the fixture | reproducible, and obvious that it is not real |
| **Invented names only** — `Test Person A`, `Example Holdings LLC` | no name in the repository belongs to anyone |
| **Amounts are round and dated in the future** (`2031-04-15`, `$120.00`) | a figure that looks like real paper invites a real record |
| **Every fixture carries `"synthetic": true`** and a `seed` | machine-checkable provenance |
| **No product identifiers**: no company name, address, phone, licence, contract number, agent id | those identify a client and a customer |

### The denylist problem, and its answer

A public repository cannot contain a list of the private words it must not
contain — the list is the leak. So the scan is split:

- **Here**: a structural test — every fixture declares `synthetic`, every
  fixture has a seed, and no fixture contains a string that looks like a real
  identifier (a 6-digit contract number, a 9-digit routing number, a phone
  pattern, an SSN pattern).
- **In the consumer's CI**: a token scan against a private denylist
  (`SUN_DENYLIST=<path>`), run before the package is published or vendored. The
  list lives with the product, behind its access control.

Both run; neither holds the other's secrets.

## 2. The fixture generator

`fixtures/generate.ts` — a spec, not yet code:

```bash
npm run fixtures -- --shape rows --rows 40 --seed 20261119 > fixtures/statement-40.json
```

- deterministic (a small PRNG seeded from `--seed`; no `Math.random`)
- shapes: `record`, `rows`, `series`
- monotonic dates for `rows`, two-decimal amounts, a stable total
- output includes `{"synthetic": true, "seed": 20261119, "generatedAt": "<fixed>"}` —
  `generatedAt` is the seed's date, not the clock, so a regeneration is a no-op
- a golden is updated only with the intent stated in the commit

An output looks like this — invented names, future dates, round money, and the
provenance an agent can check:

```json
{
  "synthetic": true,
  "seed": 20261119,
  "shape": "rows",
  "rows": [
    { "line_number": 1, "due_on": "2031-04-15", "amount": 120.00, "description": "Test Person A" },
    { "line_number": 2, "due_on": "2031-05-15", "amount": 120.00, "description": "Test Person A" }
  ],
  "totals": { "grand_total": 240.00 }
}
```

## 3. Acceptance tests

Each row is a test, not a wish. `A` = acceptance, run by `npm test`; the
**fails** column says what breaks when it regresses.

| ID | Given / when / then | Fails |
|---|---|---|
| **A1 layout identity** | given the ported fixed design, when rendered, then the element count, band heights and every coordinate equal the golden | a layout drift nobody meant |
| **A2 formatting** | given a date and an amount, when formatted, then the output is `MM/DD/YYYY` and `$1,234.56` under any `TZ` and any locale | a paper that changes with the printer's machine |
| **A3 expression vocabulary** | given each supported form, when evaluated, then the value is correct; given an unknown form, then `E_EXPR` with a hint naming the nearest supplied name | a silent blank where a figure belongs |
| **A4 blanks vs totals** | given a null field the design guards, then blank paper; given a missing total, then `E_DATA` | a signed form with a hole in it |
| **A5 guards** | given rows whose sum disagrees with the recomputed total, then `E_GUARD` and no output | the failure Jasper could not detect |
| **A6 pagination** | given 0, 1, 10, 11 and 40 rows, then the page count, repeated header and keep-together are as specified | a page that splits a signature block |
| **A7 figures** | given a series, then the SVG has `<title>`/`<desc>`, a table fallback, and no colour-only encoding; on paper the fallback is hidden unless the layout opts in; given 6 slices to a donut, then a refusal | an unreadable chart on a grayscale printer, or a chart and its table printed back-to-back |
| **A8 determinism** | given the same layout and data, then two renders are byte-identical | a diff on every run, so nobody reads the diff |
| **A9 purity** | given a render with `fetch`, `Date.now` and `Intl` stubbed to throw, then it still succeeds | hidden I/O and locale dependence |
| **A10 agent envelope** | given `--agent` and a forced failure, then stdout is one JSON envelope, the error is in the event journal, and the exit code is the documented one | an agent parsing prose |
| **A11 leak gate** | given the repository, then every fixture is `synthetic`, seeded, and free of identifier patterns | a client's data in a public package |
| **A12 print sheet** | given a rendered document, when printed to PDF by a headless browser, then the page size is the declared one and no element is clipped at the margin | a document that prints wrong only on paper |
| **A13 performance budget** | given a 40-row statement, then render under 250 ms and under 200 KB of HTML at default options | a document that is slow enough to time out in a batch |

| **A14 watermark** | given `text: "Example Only", angle: -45`, when rendered and printed, then it appears on every requested page at that angle, behind the text, at opacity ≤ 0.15, and the same words appear in the document text or metadata | a watermark that is invisible on paper, or the only carrier of a notice |
| **A15 running header/footer** | given `repeat: all` and a three-zone header, when paginated, then every sheet carries it, `notFirst` suppresses it on page 1, and a header taller than `height` fails with `E_LAYOUT` | a header that overlaps the first row of a table |
| **A16 page numbers** | given 1, 4 and 40 pages, then `Page 1 of 4` is exact (a `total` that is guessed is a failure) and `firstPage: hide` removes it from page 1 only | a document that says "of 1" on a forty-page statement |
| **A17 date provenance** | given a render with the clock stubbed forward a year, then every date is byte-identical; `kind: captured` uses the supplied value | a reprint that differs from the original |
| **A18 logo** | given an inline SVG with `monochrome`, then it renders in `currentColor`, keeps its aspect ratio, exposes `alt`, and falls back to a wordmark when the asset is absent | a broken-image box on a legal form |

| **A19 paper** | given **every** named size, when printed to PDF, then the page box equals the table's points (letter 612×792, legal 612×1008, a4 595.28×841.89, …); a fixed design on any other paper, or a mixed orientation without a declaration, fails `E_PAPER` | a legal form printed on the wrong stock, discovered by a customer |
| **A19b custom sizes** | given `{unit:"in",w:5.5,h:8.5}`, `{unit:"mm",w:139.7,h:215.9}` and `{unit:"pt",w:396,h:612}`, then all three render an identical 396×612 pt page; given `{unit:"mm",w:612,h:792}` or `{unit:"pt",w:8.5,h:11}`, then `E_PAPER` with the likely unit in the hint; given `size: "lette"`, then the hint lists the valid names | a page 21 inches wide, or a stamp, printed from a unit typo |
| **A20 binding** | given `gutter: 36` on the left, then the body is exactly 36 pt narrower and no element crosses the binding edge; `mirror` alternates the gutter on odd/even sheets; a gutter that leaves a body under 72 pt fails `E_BINDING`; cut marks print in the margin and are clipped from the body | text running into the binding, or a coupon cut through its amount |
| **A21 scale vs zoom** | given a fixed layout with `scale: 0.97`, then `E_SCALE`; given a flow document with `fit: width`, then `appliedScale` is recorded in the capture and is identical across runs; given preview zoom at 50% and 200%, then the PDF bytes are identical | a form scaled by 3% at the printer, and nobody noticing until the signature boxes are 4 mm off |

| **A22 margins and orientation** | given letter portrait and letter landscape, then the page box is 612×792 and 792×612, and margins apply to the named sides in the sheet's frame; a landscape request for a portrait fixed design fails `E_PAPER` | margins that move to the wrong side when a sheet is turned |
| **A23 bleed** | given `fullBleed: true, bleed: 9, cropMarks: true` on **page 1 only**, then that page's media box is trim + 9 pt and the following pages are unchanged; given bleed on a design with 30 pt margins, then `E_BLEED`; given a bleeding cover on the browser path with `bleedFallback: trim`, then it renders edge-to-edge with a warning, and with `none` it fails; crop marks are excluded from the capture hash | a whole document padded with white, or a cover with a white ring where the design promised ink |
| **A24 duplex** | given `duplex-long-edge` and `mirror`, then the gutter alternates and page 1 is a recto; given a `startOn: recto` section after an odd page, then a blank verso is inserted, unnumbered, with no header or footer, and `pages[]` reports it as blank; given `duplex` with `mirror: false`, then a warning and a render | a section starting on the back of the previous one |
| **A25 imposition** | given 8 pages and `n-up-2` on the PDF path, then four sheet sides hold pages 1–2, 3–4, … with cut marks, and logical page numbers are unchanged; given `imposition` on the browser path, or `booklet` with 6 pages, then `E_IMPOSITION` | pages printed two-up in the wrong order, or a booklet missing its centre spread |

| **A26 numbering origin** | given a 7-page document with a cover: `origin: first` → cover is `1 of 7`; `firstPage: hide` → cover prints nothing but the body still ends `7 of 7`; `origin: content` → cover unnumbered and the first content page is `1 of 6`; `startAt: 12` → the first numbered page is `12 of 18` | a document that is one page too long in its own footer |
| **A27 numbering scope** | given two sections with `restart`, then the second begins at 1 (or at `startAt`); given a blank verso inserted for `startOn: recto`, then it is unnumbered, uncounted, and `pages[]` shows `sheet 5, number 3`; given `roman-lower` front matter then `arabic` content, then `i, ii` precede `1, 2` with the same page set; given `origin: content` on a cover-only document, then `E_NUMBERING` | "of 0", a blank counted as a page, or front matter that disagrees with the body |

| **A28 contents accuracy** | given a document with sections, a roman front matter and a content body, then every TOC entry's page equals the pagination plan's page for that section, every section appears once, and an entry for an unnumbered page fails `E_TOC`; entries' *text* contains the number (not only a right-aligned span) | a contents page that disagrees with the document, the classic compiled-report failure |
| **A29 contents convergence** | given a TOC that fits on one page, then one extra pass settles it; given a TOC that spills to two pages when the content shifts, then the loop converges and the numbers are correct; given a pathological layout that never settles, then `E_TOC` after three passes rather than numbers nobody can trust | a page numbered 7 in the contents and 8 in the footer |

| **A30 sheets are siblings** | given a design whose summary band names a second panel, then `sheets[]` has one entry per page, each a top-level box, with the break between entries; a panel nested inside a band fails `E_LAYOUT`; the element following the document starts below the last sheet | a site footer printed through page two, because page two was a block inside page one |
| **A31 screen is paper** | given a letter document at `scale: 1`, then on screen each sheet measures the declared paper with the page margins as padding and a gap between sheets, and printing that same markup yields exactly `sheets.length` pages | a preview that looks like a web page while the print looks like a document, so every defect is discovered on paper |
| **A32 measurement determinism** | given the same layout and data rendered with the declared type tokens, then identical sheet boundaries regardless of the host's fonts or locale; given a font not resolvable from those tokens, then a render-time failure rather than silent host-font substitution | a document measured with one font and painted with another, wrapping differently in the browser |
| **A33 table splits** | given a table spanning three sheets, then `<thead>` repeats on each continued sheet and no row crosses a boundary; given a row taller than the printable body, then `E_LAYOUT` | a continued table whose data rows have no headings, or a row clipped at the trim |

A12, A14 and A18 need a browser; they belong to the consumer's browser suite,
not to the dependency-free unit tests. They are listed here so they are not
forgotten.

## 4. What "accepted" means for the project

1. A product can replace its compiled-report printout **without changing a
   single coordinate** of a legal form (A1).
2. A printed total **cannot disagree** with the server's figure (A5).
3. An agent given `AGENTS.md`, `docs/schema.json` and one example composes a
   document and verifies it with no human in the loop (A3, A10).
4. Nothing in the repository identifies a person or a client (A11).
5. A document produced outside production **cannot be mistaken for an executed
   original**: it is stamped, and the stamp prints (A14).
6. A legal form **prints at 1:1 on the paper it declares** — same size, same
   orientation, no gutter eating the body, no scale (A19–A21).

Anything else is a feature. These four are the reason the package exists.
