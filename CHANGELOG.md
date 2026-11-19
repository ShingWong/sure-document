# Changelog

## Unreleased

### Performance

- Added `scripts/bench.mjs` and `npm run bench`: 20 warmup + 200 timed renders
  of three synthetic workloads against the built package, reporting median,
  p95 and throughput. README publishes the measured numbers and hardware.

### Documentation

- Removed an absolute local workspace path from AGENTS.md before public release.
- `docs/design.md` is now an append-only Architectural Decision Record. All
  decisions through Phase 4 are accepted and frozen (§1–§13 and §14.2); a change
  must append a dated superseding section, never edit one. AGENTS.md enforces it.
- `docs/plan.md` marks Phase 4 complete and `docs/index.md` checks all links.
- Removed the transient `HANDOFF.md`. Its still-live rules — upstream release
  order, PR/CI/squash flow, 2FA approval of staged publishes, the seven-day
  expiry, and the refusal to weaken tests — now live in
  `AGENTS.md §Release mechanics`. Reading orders and doc maps no longer link to it.

### Phase 4 — fixed-mode renderer

- Added `renderDocument`/`renderPanel`: layout + rows → flat `sheets[]` HTML,
  renderer-owned `@page` geometry, sheet-level furniture, escaped text and
  sure-ui 0.3.7 class names only.
- Bound typography to `SURE_TYPOGRAPHY` from sure-ui 0.3.7 via a checked-in
  generated map with a `check:typography` drift gate; zero runtime dependencies.
- Rewrote `evaluate` to the strict `@`/`.` grammar with five aggregates,
  `ifpresent` and `E_SCOPE_INVALID`; removed the hard-coded `FONT_TOKENS` list.
- `npm run verify` is green, including `check:exports` (3 subpaths).

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
