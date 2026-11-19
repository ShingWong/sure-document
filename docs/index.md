# Documentation index

Two audiences, **one source**. Nothing here is written twice: the catalog
reference is generated from YAML, the API reference from TSDoc, and every
example is a fixture that the test suite runs. If a page and the code disagree,
the page is the bug.

---

## Reading order — an agent

| # | Read | Why |
|---|---|---|
| 0 | [HANDOFF.md](../HANDOFF.md) | status, the first three tasks, guardrails — transient |
| 1 | [AGENTS.md](../AGENTS.md) | what belongs here, what is refused, the gates |
| 2 | [design.md](design.md) §1–§5 | the model: layout + data → HTML; fixed vs flow; the expression vocabulary |
| 3 | [catalog.md](catalog.md) §2–§3 | the parts that exist and the data shape each eats |
| 4 | [acceptance.md](acceptance.md) | the fixture data policy and the A1–A33 acceptance suite |
| 5 | [../examples/](../examples/) | runnable fixtures — copy one, change the data |
| 6 | `sure-document schema --agent` | the machine contract: arguments, outputs, error codes |
| 7 | [errors.md](errors.md) | every failure the renderer can raise, and what to do |
| 8 | [glossary.md](glossary.md) | the words, so you do not invent a synonym |

If you only have one file: `AGENTS.md`. If you only have one command:
`sure-document schema --agent`.

## Reading order — a human

1. [README](../README.md) — what it is, what it is not
2. [design.md](design.md) — the decisions and their dates
3. [catalog.md](catalog.md) — the parts
4. [plan.md](plan.md) — what exists, what is next
5. [legacy-report-engine.md](legacy-report-engine.md) — what is being replaced, and why it had to go

## The model in sixty seconds

```
layout  +  data  →  render  →  HTML  →  print | PDF (host compiled)
```

- **layout** — bands and elements with geometry (`fixed`) or sections whose
  height comes from content (`flow`). Data, not code, not a binary.
- **data** — named values plus, for a repeating band, rows. Supplied by the
  caller from sure-state. The renderer never queries.
- **render** — a pure function. No DOM, no clock, no network, no locale.
- **sheet** — a named paper size (ten, from letter to b5) or a custom one in
  pt/mm/in, portrait or landscape, with a binding gutter; points are canonical
- **furniture** — header, footer, page number, date, logo, watermark: placed on
  the sheet, so a fixed form and a flow document carry the same ones; the
  watermark prints, and a non-production host stamps `EXAMPLE ONLY` itself
- **verify** — `guards` reconcile totals against the server's figures;
  `fixtures` assert what the output must contain. This is what replaces reading
  a PDF.

## Where things are

| Path | Holds |
|---|---|
| `HANDOFF.md` | transient state: status, first tasks, open decisions |
| `README.md` | the pitch, the boundaries, the name |
| `AGENTS.md` | the agent's contract and the gates |
| `docs/index.md` | this file: reading orders and update duties |
| `docs/design.md` | numbered decisions, dated |
| `docs/catalog.md` | report components: families, entries, two new blocks |
| `docs/acceptance.md` | synthetic data policy and the A1–A33 acceptance suite |
| `docs/legacy-report-engine.md` | the 2007 designs, distilled |
| `docs/plan.md` | phases and acceptance criteria |
| `docs/glossary.md` | one word per concept |
| `docs/errors.md` | stable error codes |
| `examples/` | fixtures that are also documentation |

## When to update what

| Change | Docs that must change in the same commit |
|---|---|
| an element kind or attribute | `design.md` §4, `glossary.md` |
| an expression form | `design.md` §5, `errors.md` (`E_EXPR`) |
| a formatter | `design.md` §6 |
| a typography token or font mapping consumed here | `design.md` §9, `catalog.md` §4; the token itself lives in sure-ui |
| a catalog entry or its data shape | `catalog.md`, the entry's fixture, `examples/` |
| a CLI command or flag | `AGENTS.md` (agent surface), `design.md` §12, generated `schema`, `README` |
| a new error | `errors.md` + a test that raises it |
| a fixture | `"synthetic": true` + a seed; never a real row (`acceptance.md §1`) |
| a phase completed | `plan.md` checkbox, `CHANGELOG.md` |

A pull request that changes behavior without the matching doc line is
incomplete, the same way a change without a test is.

## Generated, never hand-written

| Artifact | Generated from | Guard |
|---|---|---|
| API reference | TSDoc in `src/` | CI regenerates and diffs; a stale file fails |
| catalog reference | `sure-store/components/*.yaml` | schema validation + fixture replay |
| CLI schema | command definitions | `sure-document schema --agent` compared to the committed file |
| error catalog | the codes' tests | every code in `src/` must appear in `errors.md` |
| examples | `examples/` fixtures | every example runs in `npm test` |

## Deliberate omissions

- No marketing pages, no screenshots of a UI that does not exist.
- No prose that repeats a signature — the reference is generated.
- No "coming soon" section that reads like a promise; `plan.md` holds intent.
