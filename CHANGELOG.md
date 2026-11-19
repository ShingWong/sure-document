# Changelog

## Unreleased

### Upstream releases (Phases 1–2)

- `@shing.wong/sure-ui` 0.3.6 published: the `document` and `figure` blocks,
  print rules, tokens-only CSS, and a regenerated additive-only compose fixture.
- `@shing.wong/sure-factor` 0.6.0 published: the five catalog extension keys,
  projection-safe guard validation, and the report-module generator. The
  template class-coverage guard was not weakened.

### Phase 0.5 — documentation/test harness (scaffolding)

- Added `package.json` (`@shing.wong/sure-document`, MIT, ESM, zero runtime
  dependencies), `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`.
- Added gates: `check:exports`, `check:errors` (src ↔ `docs/errors.md`, both
  directions), `check:docs` (link targets, heading anchors, no orphan docs), and
  `check:examples` (generated-example replay). Each is unit-tested against a
  deliberately broken input in `tests/gates.test.ts`.
- Added `fixtures/generate.ts`: seeded PRNG, three shapes, synthetic-only data,
  `generatedAt` derived from the seed's digits (no clock, no `Math.random`).
- Generated `examples/fixed-record.json`, `examples/flow-rows-40.json` and
  `examples/series-bars.json` from seed `20261119`.
- Documented the `--silent` needed to redirect the generator's JSON cleanly.

The renderer and the A1–A33 acceptance tests (Phases 4–5) are deliberately out
of scope: `check:exports` stays red until their modules are built.
