import { defineConfig } from 'vitest/config'

// No browser project here: assertions about the compiled artefact (PDF
// MediaBox, byte identity, imposition) belong to the consumer's suite
// (docs/acceptance.md §3 "Where each test runs"). This project checks the
// generator and the documentation gates, all pure Node.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
