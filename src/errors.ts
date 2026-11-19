/**
 * The stable error-code catalog — data only, no renderer.
 *
 * `scripts/check-errors.mjs` scans `src/` for quoted codes and compares the
 * set with the table in `docs/errors.md`, in both directions. Keeping the
 * catalog here (rather than in prose) is what makes that gate real before the
 * renderer lands in Phase 4.
 */
export const ERROR_CODES = [
  'E_LAYOUT',
  'E_ELEMENT',
  'E_EXPR',
  'E_SCOPE_INVALID',
  'E_DATA',
  'E_FORMAT',
  'E_FONT',
  'E_GUARD',
  'E_FIXTURE',
  'E_PAGE',
  'E_PAPER',
  'E_BINDING',
  'E_TOC',
  'E_NUMBERING',
  'E_BLEED',
  'E_IMPOSITION',
  'E_SCALE',
  'E_ASYNC',
  'ECONFIRM',
  'EINTERACTIVE',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/**
 * The one error shape the renderer throws. It carries the stable code, an
 * actionable hint and optional details so the host can build the `--agent`
 * envelope without parsing the message. No error is ever a bare `Error`.
 */
export class DocumentError extends Error {
  readonly code: ErrorCode
  readonly hint?: string
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, hint?: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'DocumentError'
    this.code = code
    this.hint = hint
    this.details = details
  }
}

/** Throw the stable error type. Returns `never` so callers get narrowing. */
export function fail(code: ErrorCode, message: string, hint?: string, details?: Record<string, unknown>): never {
  throw new DocumentError(code, message, hint, details)
}
