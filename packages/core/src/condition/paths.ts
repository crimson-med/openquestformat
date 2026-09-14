/** Shapes shared by variable paths and objective references. */
import { VARIABLE_NAMESPACES } from '../model.js'

/** A variable path inside a condition. The first segment must be a namespace. */
export const PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_#.-]*$/

/** A reference inside an objective. Wider than a variable path: colons are allowed. */
export const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:#-]*$/

/** The first segment of a dotted path. */
export function variableNamespace(path: string): string {
  return path.split('.')[0]
}

/** True when the name is one of the namespaces a condition may read. */
export function isVariableNamespace(name: string): boolean {
  return (VARIABLE_NAMESPACES as readonly string[]).includes(name)
}
