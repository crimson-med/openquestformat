/**
 * The canonical Open Quest Format model.
 *
 * Every parser produces this shape and every serializer consumes it. Nothing in
 * this file performs I/O or evaluation; it is the contract the rest of the
 * workspace builds against. See docs/01-model.md for the prose description.
 */

/** A player-facing string. Either a literal or an i18n key prefixed with `@`. */
export type Text = string

/** An opaque engine reference with an optional display name for tooling. */
export interface Ref {
  id: string
  name?: string
}

/** Scalar values allowed in extension bags and event payloads. */
export type Scalar = string | number | boolean

/**
 * Namespaced extension data. Keys are `x-<namespace>.<key>`. OQF code preserves
 * these and never reads them.
 */
export type Ext = Record<string, Scalar | Record<string, Scalar>>

/** A flat event or reward payload. */
export type Payload = Record<string, Scalar>

/**
 * A condition tree. JSON Logic compatible, restricted to the whitelist below.
 *
 * Operators: `and`, `or`, `!`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `var`.
 * Leaves are scalars. `{ var: 'flag.met' }` reads a variable. `{ '!': [x] }` negates.
 * `{ in: [x, [a, b]] }` tests membership in a literal list.
 */
export type Condition =
  | Scalar
  | Scalar[]
  | { and: Condition[] }
  | { or: Condition[] }
  | { '!': [Condition] }
  | { '==': [Condition, Condition] }
  | { '!=': [Condition, Condition] }
  | { '<': [Condition, Condition] }
  | { '<=': [Condition, Condition] }
  | { '>': [Condition, Condition] }
  | { '>=': [Condition, Condition] }
  | { in: [Condition, Condition] }
  | { var: string }

export const CONDITION_OPERATORS = [
  'and',
  'or',
  '!',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'in',
  'var',
] as const
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]

/** Variable namespaces a condition may read. Everything but `var` is runtime-owned. */
export const VARIABLE_NAMESPACES = ['flag', 'count', 'step', 'outcome', 'quest', 'var'] as const
export type VariableNamespace = (typeof VARIABLE_NAMESPACES)[number]

/**
 * An objective is sugar for an event-driven counter. See docs/01-model.md.
 * `count` defaults to 1 when absent.
 */
export type Objective =
  | { kind: 'kill'; actor: string; count?: number }
  | { kind: 'collect'; item: string; count?: number }
  | { kind: 'reach'; location: string }
  | { kind: 'talk'; actor: string; dialogue?: string }
  | { kind: 'interact'; object: string }
  | { kind: 'event'; event: string; count?: number }
  | { kind: 'custom'; custom: string; args: string[] }

export const OBJECTIVE_KINDS = [
  'kill',
  'collect',
  'reach',
  'talk',
  'interact',
  'event',
  'custom',
] as const
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number]

export const REWARD_KINDS = [
  'item',
  'currency',
  'xp',
  'reputation',
  'unlock',
  'flag',
  'event',
  'custom',
] as const
export type RewardKind = (typeof REWARD_KINDS)[number]

/**
 * A reward. Defined once per quest in `Quest.rewards`. Steps reference rewards
 * by id. A reward with `outcome` set is a quest-level reward granted when that
 * outcome is reached; it is not referenced from steps.
 */
export interface Reward {
  id: string
  kind: RewardKind
  /** Item id, currency id, reputation track, unlock id, flag name, event name or custom kind. */
  ref: string
  /** Defaults to 1. Negative allowed for `currency` and `reputation`. */
  amount?: number
  /** Present on quest-level rewards only. Names the outcome that grants it. */
  outcome?: string
  payload?: Payload
  ext?: Ext
}

export interface Outcome {
  name: string
  failed?: boolean
  title?: Text
}

export interface DialogueBinding {
  /** `oqf`, `ink`, `yarn`, or a custom provider name. */
  provider: string
  ref: string
}

export const STEP_STATES = ['locked', 'available', 'active', 'done', 'failed', 'skipped'] as const
export type StepState = (typeof STEP_STATES)[number]

export interface Step {
  id: string
  title: Text
  journal?: Text
  /** Begins `available` when the quest opens. Equivalent to having no `unlock`. */
  start?: boolean
  /** `locked` to `available`. */
  unlock?: Condition
  /** `available` to `active`. Absent means immediate. */
  activate?: Condition
  /** Event-driven counter that must be satisfied for `done`. */
  objective?: Objective
  /** Condition that must also hold for `done`. Absent with no objective means immediate. */
  complete?: Condition
  /** Event-driven counter that, once satisfied, moves the step to `failed`. */
  failObjective?: Objective
  /** Condition that moves `active` or `available` to `failed`. Combined with `failObjective` by `and`. */
  fail?: Condition
  /** UI hint only. The validator derives optionality independently. */
  optional?: boolean
  /** Allows re-entry. Required for any cycle in the graph. */
  repeat?: boolean
  /** Present on ending steps only. */
  outcome?: Outcome
  /** Ids into `Quest.rewards`, granted on `done`. */
  rewards: string[]
  dialogue?: DialogueBinding
  /** Location id, a marker hint for the tracker. */
  location?: string
  /** Actor ids involved, for tooling and markers. */
  actors: string[]
  ext?: Ext
}

export interface Quest {
  id: string
  /** Content version. Bumped when steps are added, removed or renamed. */
  version: number
  title: Text
  summary?: Text
  /** Tag ids. */
  tags: string[]
  /** The whole quest may be taken again after an outcome. */
  repeat?: boolean
  /** When the quest becomes offerable. Absent means always. */
  unlock?: Condition
  steps: Step[]
  /** Every reward this quest can grant, step-level and quest-level alike. */
  rewards: Reward[]
  ext?: Ext
}

/** Per-file dictionaries. Interned in the compact format, inlined in JSON. */
export interface Dictionaries {
  actors: Ref[]
  locations: Ref[]
  items: Ref[]
  tags: Ref[]
}

/**
 * One OQF file: shared dictionaries plus one or more quests. A pack is a
 * directory of these; ids are unique across the pack.
 */
export interface OqfDocument {
  dictionaries: Dictionaries
  quests: Quest[]
}

/** Format major version carried by the compact magic line. */
export const OQF_MAJOR = 1
export const OQF_MAGIC = `OQF${OQF_MAJOR}`

export function emptyDictionaries(): Dictionaries {
  return { actors: [], locations: [], items: [], tags: [] }
}

export function emptyDocument(): OqfDocument {
  return { dictionaries: emptyDictionaries(), quests: [] }
}

/** A stable reference to a step from outside its quest: `questId#stepId`. */
export function stepRef(questId: string, stepId: string): string {
  return `${questId}#${stepId}`
}

/** The world flag set when a quest reaches an outcome. */
export function outcomeFlag(questId: string, outcome: string): string {
  return `outcome.${questId}.${outcome}`
}
