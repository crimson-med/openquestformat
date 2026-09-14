/**
 * Ink interop: export, import and a runtime provider that wraps inkjs.
 *
 * naming.ts and expression.ts are shared with the Yarn Spinner interop on
 * purpose, so identifier translation, payload encoding and condition printing
 * stay identical between the two formats.
 */
export type { InkProviderOptions, StoryChoiceLike, StoryLike } from './adapter.js'
export { InkProvider } from './adapter.js'
export { escapeInkText, inkVariables, toInk } from './export.js'
export type { Dialect } from './expression.js'
export { ExpressionError, parseExpression, renderExpression } from './expression.js'
export type { InkImportResult } from './import.js'
export { fromInk, unescapeInk } from './import.js'
export type { ImportWarning } from './naming.js'
export {
  decodeExt,
  decodePayload,
  decodeTagValue,
  encodeExt,
  encodePayload,
  encodeTagValue,
  fromIdentifier,
  toIdentifier,
} from './naming.js'
