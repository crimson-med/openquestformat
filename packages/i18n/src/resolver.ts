/**
 * The runtime side of localization. A resolver turns whatever a `text` field
 * holds into a string to show: literals pass through untouched, key references
 * are looked up in the active locale, then in the fallback locale, and are
 * returned as they are when neither has them.
 */
import type { Text } from '@oqf/core'
import type { StringTable } from './extract.js'
import { isKey, keyOf } from './keys.js'

export interface ResolverOptions {
  /** Locale to read first. */
  locale: string
  /** Locale to read when the active one has no value for the key. */
  fallback?: string
}

/** Turns a `text` value into a displayable string. */
export type Resolver = (text: Text) => string

/** Builds a resolver over a set of tables, one per locale. */
export function createResolver(
  tables: Record<string, StringTable>,
  options: ResolverOptions,
): Resolver {
  const primary = tables[options.locale]
  const fallback = options.fallback === undefined ? undefined : tables[options.fallback]
  return (text) => {
    if (!isKey(text)) return text
    const key = keyOf(text)
    const value = primary?.[key] ?? fallback?.[key]
    return value ?? text
  }
}
