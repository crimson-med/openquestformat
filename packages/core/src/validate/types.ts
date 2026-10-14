/**
 * Findings produced by the validator and the vocabulary they use.
 *
 * Codes are stable kebab-case identifiers, one per check, so a tool may switch
 * on them. The level of a code is fixed with one exception: `no-ending-reachable`
 * is a warning by default and an error in strict mode.
 */

/**
 * Every code the validator knows.
 *
 * `lore-node-effect` is reserved. Dialogue is not part of v0.1, so nothing
 * emits it yet; it is listed here so the vocabulary stays stable once it is.
 */
export const VALIDATION_CODES = [
  'duplicate-quest-id',
  'duplicate-step-id',
  'duplicate-reward-id',
  'duplicate-outcome-name',
  'unknown-step-ref',
  'unknown-quest-ref',
  'unknown-outcome-ref',
  'unknown-reward-ref',
  'unknown-dictionary-ref',
  'unknown-variable-namespace',
  'unknown-flag',
  'unknown-ext-namespace',
  'ext-key-invalid',
  'condition-invalid',
  'condition-constant',
  'cycle-without-repeat',
  'outcome-with-dependents',
  'unreachable-step',
  'dead-end',
  'no-ending-reachable',
  'ending-needs-var',
  'custom-event-collision',
  'reward-id-reused',
  'mixed-text-keys',
  'lore-node-effect',
  'cooldown-without-repeat',
  'duration-invalid',
  'outcome-reserved',
  'duplicate-param-name',
  'unknown-param-ref',
  'param-type-mismatch',
  'unused-param',
  'streak-without-calendar-cooldown',
  'time-not-number',
  'unknown-time-variable',
  'deadline-after-expire',
] as const

export type ValidationCode = (typeof VALIDATION_CODES)[number]

/** One thing the validator has to say about a pack. */
export interface Finding {
  level: 'error' | 'warning'
  code: string
  message: string
  /** Quest id the finding belongs to, absent for pack-wide findings. */
  quest?: string
  /** Step id the finding belongs to, absent for quest-wide findings. */
  step?: string
  /** Dotted path to the offending field, for editors and the CLI. */
  path?: string
}

/** The outcome of a validation run. `ok` is false as soon as one error is found. */
export interface ValidationResult {
  findings: Finding[]
  ok: boolean
}

export interface ValidateOptions {
  /**
   * Turns three advisory checks on and promotes one warning to an error. See
   * docs/08-validation.md for the list.
   */
  strict?: boolean
}

/** Extension keys are `x-<namespace>.<key>`. Nothing else is accepted. */
export const EXT_KEY_PATTERN = /^x-[a-z0-9-]+\.[A-Za-z0-9_.-]+$/

/** Namespaces the toolchain recognizes. Anything else is flagged in strict mode. */
export const KNOWN_EXT_NAMESPACES = [
  'oqf',
  'editor',
  'unity',
  'godot',
  'unreal',
  'cozycoast',
] as const

export type KnownExtNamespace = (typeof KNOWN_EXT_NAMESPACES)[number]
