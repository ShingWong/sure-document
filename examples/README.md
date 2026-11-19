# Examples

Runnable fixtures that double as documentation. **A document example is not a
snippet to read — it is a test that runs**, so it cannot drift from the code.

## What goes here

| Name | Shows |
|---|---|
| `fixed-record.json` | a `fixed` layout with a record: bands, points, one substitution |
| `flow-rows-40.json` | a `flow` document with 40 rows: repeated header, page breaks, a total |
| `series-bars.json` | a `figure-bar` from a series, with its table fallback |

## Rules

1. **Synthetic only.** Invented names, round amounts, future dates, and
   `"synthetic": true` with the seed that produced it — `docs/acceptance.md §1`.
   An example that looks like real paper invites a real record.
2. **Generated, not typed.** `npm run fixtures -- --shape rows --rows 40 --seed …`
   produces the file and its manifest; the seed is recorded.
3. **One copy.** The docs link to these files; no example is pasted twice. If a
   walkthrough needs a shortened view, it links and quotes with a line citation.
4. **Executed.** `npm test` renders every example and asserts the facts in
   `expect` (strings, page count, element count). A new example without an
   assertion is not an example, it is a file.

## Why not screenshots

A screenshot of a document is a claim nobody can check. The fixture is the
claim, and the assertion is the proof.
