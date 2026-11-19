/**
 * Package root — the public surface.
 *
 * `renderDocument` is a pure function of layout + data; agents call it directly
 * in a harness, and the CLI (Phase 7) will wrap it. The subpath exports below
 * keep `./layout` and `./format` coherent with the root: importing a type from
 * either subpath or from `.` names the same thing.
 */
export { renderDocument, renderPanel } from './render.js'
export type { RenderData, RenderInput, RenderResult } from './render.js'

export { parseLayout, bodyBox, PAPER_SIZES } from './layout.js'
export type {
  PaperSize,
  Margins,
  Binding,
  SheetTypography,
  Sheet,
  ElementKind,
  ElementGeometry,
  TextElement,
  LineElement,
  RectElement,
  ImageElement,
  TableElement,
  FigureElement,
  FurnitureElement,
  Element,
  Band,
  Layout,
} from './layout.js'

export {
  evaluate,
  formatCurrency,
  formatNumber,
  formatDate,
  createMeasurementOracle,
  isFontToken,
  FONT_TOKENS,
} from './format.js'
export type {
  EvalContext,
  Scalar,
  MeasurementInput,
  Measurement,
  MeasurementOracle,
  FontToken,
} from './format.js'

export { DocumentError } from './errors.js'
export type { ErrorCode } from './errors.js'
