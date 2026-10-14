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

/**
 * Variable namespaces a condition may read. Everything but `var` is runtime-owned.
 * `param`, `time`, `runs` and `streak` are typed but not valued until play, so the
 * validator treats their values as unknown, like `var`.
 */
export const VARIABLE_NAMESPACES = [
  'flag',
  'count',
  'step',
  'outcome',
  'quest',
  'var',
  'param',
  'time',
  'runs',
  'streak',
] as const
export type VariableNamespace = (typeof VARIABLE_NAMESPACES)[number]

/** Namespaces whose values the validator cannot know, so reachability treats them as opaque. */
export const OPAQUE_NAMESPACES = ['var', 'param', 'time', 'runs', 'streak'] as const

/** The names under `time.*`, all numbers. See docs/02-conditions.md. */
export const TIME_VARIABLES = ['now', 'day', 'week', 'weekday', 'hour', 'minute'] as const
export type TimeVariable = (typeof TIME_VARIABLES)[number]

/**
 * A reference to a quest parameter, written `$name`. May stand wherever an id or a
 * count appears in an objective. In a condition it is sugar for `param.<name>`.
 */
export type ParamRef = `$${string}`

export const PARAM_REF_PATTERN = /^\$[A-Za-z_][A-Za-z0-9_]*$/

export function isParamRef(value: unknown): value is ParamRef {
  return typeof value === 'string' && PARAM_REF_PATTERN.test(value)
}

/** The parameter name a `$name` reference points at. */
export function paramRefName(ref: ParamRef): string {
  return ref.slice(1)
}

/**
 * An objective is sugar for an event-driven counter. See docs/01-model.md.
 * `count` defaults to 1 when absent. Any id and any count may be a `$name`
 * parameter reference, which the runtime substitutes when the step is evaluated.
 */
export type Objective =
  | { kind: 'kill'; actor: string; count?: number | ParamRef }
  | { kind: 'collect'; item: string; count?: number | ParamRef }
  | { kind: 'reach'; location: string }
  | { kind: 'talk'; actor: string; dialogue?: string }
  | { kind: 'interact'; object: string }
  | { kind: 'event'; event: string; count?: number | ParamRef }
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

/**
 * The built-in failed outcome a quest with `expire` reaches when its time runs
 * out. Reserved: an author cannot declare an outcome with this name.
 */
export const EXPIRED_OUTCOME = 'expired'

/**
 * A span of time on a quest or a step. Either an ISO 8601 duration restricted to
 * weeks, days, hours, minutes and seconds (`PT20H`, `P3D`, `P1W`) or one of the
 * calendar keywords, which wait for the next day, week or month boundary. The
 * parsers normalize an ISO spelling to its canonical form. See docs/01-model.md.
 */
export type Duration = string

export const DURATION_KEYWORDS = ['day', 'week', 'month'] as const
export type DurationKeyword = (typeof DURATION_KEYWORDS)[number]

export const PARAMETER_TYPES = ['item', 'actor', 'location', 'number', 'string'] as const
export type ParameterType = (typeof PARAMETER_TYPES)[number]

/**
 * A value the engine binds when an instance of the quest is offered. Referenced
 * as `$name` in objectives and conditions and as `{name}` in text.
 */
export interface Parameter {
  /** Unique in the quest. */
  name: string
  type: ParameterType
  /**
   * For `item`, `actor` and `location`: a tag id the bound reference must carry.
   * For `number`: `min..max`, inclusive, either side optional. Ignored for `string`.
   */
  constraint?: string
  ext?: Ext
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
  /** How long after the step is entered it takes its `fail` transition. */
  deadline?: Duration
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
  /** Requires `repeat`. How long after an outcome a new instance may be offered. */
  cooldown?: Duration
  /** How long after an instance starts it reaches the `expired` outcome. */
  expire?: Duration
  /** Values the engine binds when an instance is offered. Absent means none. */
  params?: Parameter[]
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
