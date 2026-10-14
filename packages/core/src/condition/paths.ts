/** Shapes shared by variable paths and objective references. */
import { PARAM_REF_PATTERN, VARIABLE_NAMESPACES } from '../model.js'

/** A `$name` parameter reference, in a condition or in an objective slot. */
export const PARAM_PATTERN = PARAM_REF_PATTERN

/** The variable path a `$name` reference is sugar for. */
export function paramPath(ref: string): string {
  return `param.${ref.slice(1)}`
}

/** The `$name` spelling of a `param.<name>` path, or undefined for any other path. */
export function paramRefOf(path: string): string | undefined {
  if (!path.startsWith('param.')) return undefined
  const name = path.slice('param.'.length)
  return name === '' || name.includes('.') ? undefined : `$${name}`
}

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
