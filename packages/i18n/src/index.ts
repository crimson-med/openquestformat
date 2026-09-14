/**
 * Open Quest Format string extraction and injection.
 *
 * Extract moves every literal `text` value into a table and leaves keys behind,
 * inject writes the values back, and the adapters read and write that table as
 * JSON, CSV, PO or XLIFF. Everything here is a pure transformation over the
 * model, with no I/O and no dependencies beyond the model packages.
 */
export * from './adapters/csv.js'
export * from './adapters/json.js'
export * from './adapters/po.js'
export * from './adapters/xliff.js'
export * from './errors.js'
export * from './extract.js'
export * from './inject.js'
export * from './keys.js'
export * from './resolver.js'
