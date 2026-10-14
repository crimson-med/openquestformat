/**
 * The runtime side of localization. A resolver turns whatever a `text` field
 * holds into a string to show: literals pass through untouched, key references
 * are looked up in the active locale, then in the fallback locale, and are
 * returned as they are when neither has them. Arguments, per docs/07-i18n.md,
 * fill `{name}` placeholders by plain substitution; plural rules stay the game's.
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

/** The arguments a text receives: the bound parameters, plus `count` and `target` for a step. */
export type TextArguments = Record<string, string | number>

/** Turns a `text` value into a displayable string, filling placeholders from the arguments. */
export type Resolver = (text: Text, args?: TextArguments) => string

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/** The placeholder names a text mentions, in order of first appearance. */
export function textPlaceholders(text: Text): string[] {
  const found: string[] = []
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (!found.includes(match[1])) found.push(match[1])
  }
  return found
}

/**
 * Replace every `{name}` with the argument's string form. A name the arguments
 * do not carry is left as written, so a missing value is visible rather than
 * silently blank.
 */
export function formatText(text: string, args: TextArguments | undefined): string {
  if (args === undefined || !text.includes('{')) return text
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const value = args[name]
    return value === undefined ? whole : String(value)
  })
}

/** Builds a resolver over a set of tables, one per locale. */
export function createResolver(
  tables: Record<string, StringTable>,
  options: ResolverOptions,
): Resolver {
  const primary = tables[options.locale]
  const fallback = options.fallback === undefined ? undefined : tables[options.fallback]
  return (text, args) => {
    if (!isKey(text)) return formatText(text, args)
    const key = keyOf(text)
    const value = primary?.[key] ?? fallback?.[key]
    return value === undefined ? text : formatText(value, args)
  }
}
