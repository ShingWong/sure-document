/**
 * GENERATED — do not edit. Run `npm run typography:generate`.
 * Resolved from SURE_TYPOGRAPHY in @shing.wong/sure-ui, the sole source of
 * truth for document typography (design §9, A32). No imports, no functions.
 */

export interface SureDocumentTypographyStyle {
  readonly css: string
  readonly ptSize: number
  readonly linePt: number
  readonly weight: number
}

export const SURE_DOCUMENT_TYPOGRAPHY = {
  heading1: {
    css: 'var(--sure-font-h1)',
    ptSize: 18,
    linePt: 22,
    weight: 700,
  },
  heading2: {
    css: 'var(--sure-font-h2)',
    ptSize: 14,
    linePt: 18,
    weight: 600,
  },
  body: {
    css: 'var(--sure-font-body)',
    ptSize: 10,
    linePt: 14,
    weight: 400,
  },
  caption: {
    css: 'var(--sure-font-caption)',
    ptSize: 8,
    linePt: 11,
    weight: 400,
  },
  mono: {
    css: 'var(--sure-font-mono)',
    ptSize: 9,
    linePt: 12,
    weight: 400,
  },
} as const satisfies Record<string, SureDocumentTypographyStyle>

export type SureDocumentTypographyKind = keyof typeof SURE_DOCUMENT_TYPOGRAPHY
