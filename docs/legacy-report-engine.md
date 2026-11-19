# Prior art: replacing a compiled report engine

The engine this package replaces was JasperReports: `.jrxml` designs authored in
iReport, compiled to `.jasper`, filled with a map of parameters by a host
application, exported to PDF. That was normal in 2007 and is a liability in
2026 — not because the layouts were bad, but because of four properties that are
inherent to the format:

| Property | Consequence |
|---|---|
| the design compiles to a **binary** | an agent cannot read it, diff it, or check it. Nothing can review a change except by printing |
| values are assembled **in the host language** | the paper can disagree with the database and nothing notices |
| rendering needs the **engine's runtime** | a JVM dependency follows the document forever |
| the design names the **product's rows** | nothing generic survives; a second product starts over |

This package keeps what was right — precise layout for a form that must not
move, and bands for a document whose length is data — and rejects the four.

## What the old designs got right, and is kept

**Geometry in points is a legitimate specification.** A form a customer signs
has boxes where the law and familiarity put them. Coordinates in points (72 to
the inch), a page size, margins and bands are all data here, and `fixed` mode
reproduces a design exactly rather than "improving" it.

**Bands are the right unit.** A header that repeats, a detail band that
repeats per row, a footer that carries a total — those are the primitives a
printed document needs, in every layout engine since paper.

**A closed expression vocabulary is a feature.** The old designs used four
forms (a parameter, a field, two arithmetic shapes). A small vocabulary is
verifiable; a general expression language is not.

## What this package does instead

- **Layouts are data** in the repository: readable, reviewable, diffable by a
  human and checkable by an agent.
- **Values arrive from the application's state layer** (sure-state), already
  recomputed server-side. The renderer never queries.
- **Output is HTML** that prints through a browser, so the document needs no
  runtime beyond the one the user already has. PDF, when needed, is the same
  HTML through headless Chromium, at the product's edge.
- **Fixtures and guards replace eyeballing.** A design change shows which
  documents changed; a printed total is reconciled against the server's figure
  before the page exists.

## A note on product specifics

A *product's* paper — its wording, its geometry, its parameter names — belongs
to that product's repository, not to this package. This document describes the
class of engine being replaced; a distilled specification of a particular
company's forms is kept (proprietary) with that product. The examples and
fixtures here are synthetic: see `docs/acceptance.md` for the data policy.
