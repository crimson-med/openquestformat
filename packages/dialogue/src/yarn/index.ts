/**
 * Yarn Spinner interop: export and import.
 *
 * There is no runtime provider here on purpose. Yarn Spinner runs inside the
 * engine, not inside JavaScript, so the bridge adapter belongs to the host.
 * README.md next to this file explains what the host has to translate.
 *
 * Identifier translation, payload encoding and the expression printer come from
 * ../ink/naming.ts and ../ink/expression.ts, shared with the Ink interop so
 * both formats spell a variable the same way. `ImportWarning` is exported from
 * the ink entry point, and is the same type here.
 */
export { escapeYarnHeader, escapeYarnText, toYarn, yarnTitle, yarnTitles } from './export.js'
export type { YarnImportResult } from './import.js'
export { fromYarn, unescapeYarn } from './import.js'
