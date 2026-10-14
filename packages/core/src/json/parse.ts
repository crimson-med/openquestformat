/**
 * Reads the JSON form of an OQF document into the canonical model.
 *
 * Validation is done by hand, with no schema library, so every failure can
 * carry the exact path of the offending value.
 */
import { normalizeDuration } from '../duration/index.js'
import {
  CONDITION_OPERATORS,
  type Condition,
  type ConditionOperator,
  type DialogueBinding,
  type Dictionaries,
  type Ext,
  OBJECTIVE_KINDS,
  OQF_MAJOR,
  type Objective,
  type OqfDocument,
  type Outcome,
  PARAMETER_TYPES,
  type ParamRef,
  type Parameter,
  type Payload,
  type Quest,
  REWARD_KINDS,
  type Ref,
  type Reward,
  type Scalar,
  type Step,
  isParamRef,
} from '../model.js'

/** Extension keys are `x-<namespace>.<key>`. */
const EXT_KEY = /^x-[a-z0-9-]+\.[A-Za-z0-9_.-]+$/

/** Operators taking a fixed number of operands. Everything else is variadic. */
const OPERATOR_ARITY: Partial<Record<ConditionOperator, number>> = {
  '!': 1,
  '==': 2,
  '!=': 2,
  '<': 2,
  '<=': 2,
  '>': 2,
  '>=': 2,
  in: 2,
}

/** A shape violation in the JSON form, located by a dotted and indexed path. */
export class JsonFormatError extends Error {
  /** Path to the offending value, such as `quests[0].steps[2].objective`. */
  readonly path: string

  constructor(message: string, path: string) {
    super(path === '' ? message : `${message} at ${path}`)
    this.name = 'JsonFormatError'
    this.path = path
  }
}

function fail(message: string, path: string): never {
  throw new JsonFormatError(message, path)
}

function key(path: string, name: string): string {
  return path === '' ? name : `${path}.${name}`
}

function at(path: string, position: number): string {
  return `${path}[${position}]`
}

function prune<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'boolean' || isNumber(value)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function readRecord(value: unknown, path: string, what: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`expected ${what} to be an object, got ${typeName(value)}`, path)
  return value
}

function readArray(value: unknown, path: string, what: string): unknown[] {
  if (!Array.isArray(value)) fail(`expected ${what} to be an array, got ${typeName(value)}`, path)
  return value
}

function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(`expected a string, got ${typeName(value)}`, path)
  return value
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(`expected a boolean, got ${typeName(value)}`, path)
  return value
}

function readNumber(value: unknown, path: string): number {
  if (!isNumber(value)) fail(`expected a number, got ${typeName(value)}`, path)
  return value
}

function readInteger(value: unknown, path: string): number {
  const parsed = readNumber(value, path)
  if (!Number.isInteger(parsed)) fail(`expected an integer, got ${parsed}`, path)
  return parsed
}

function required(record: Record<string, unknown>, name: string, path: string): unknown {
  const value = record[name]
  if (value === undefined) fail(`missing required field "${name}"`, key(path, name))
  return value
}

function requiredString(record: Record<string, unknown>, name: string, path: string): string {
  return readString(required(record, name, path), key(path, name))
}

function optionalString(
  record: Record<string, unknown>,
  name: string,
  path: string,
): string | undefined {
  const value = record[name]
  return value === undefined ? undefined : readString(value, key(path, name))
}

function optionalBoolean(
  record: Record<string, unknown>,
  name: string,
  path: string,
): boolean | undefined {
  const value = record[name]
  return value === undefined ? undefined : readBoolean(value, key(path, name))
}

function optionalNumber(
  record: Record<string, unknown>,
  name: string,
  path: string,
): number | undefined {
  const value = record[name]
  return value === undefined ? undefined : readNumber(value, key(path, name))
}

function optionalCondition(
  record: Record<string, unknown>,
  name: string,
  path: string,
): Condition | undefined {
  const value = record[name]
  return value === undefined ? undefined : readCondition(value, key(path, name))
}

/** A duration string, stored in its canonical spelling when it is valid. */
function optionalDuration(
  record: Record<string, unknown>,
  name: string,
  path: string,
): string | undefined {
  const value = record[name]
  if (value === undefined) return undefined
  const text = readString(value, key(path, name))
  if (text === '') fail('expected a duration, got an empty string', key(path, name))
  return normalizeDuration(text)
}

/** An objective count: a number, or a `$name` parameter reference. */
function optionalCount(
  record: Record<string, unknown>,
  name: string,
  path: string,
): number | ParamRef | undefined {
  const value = record[name]
  if (value === undefined) return undefined
  if (isParamRef(value)) return value
  if (typeof value === 'string') {
    fail(
      `expected a number or a $name parameter reference, got ${JSON.stringify(value)}`,
      key(path, name),
    )
  }
  return readNumber(value, key(path, name))
}

function checkKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const name of Object.keys(record)) {
    if (!allowed.includes(name)) fail(`unknown key "${name}"`, key(path, name))
  }
}

/** A list of ids, such as `Step.rewards` or `Quest.tags`. Defaults to an empty list. */
function readIdList(value: unknown, path: string, what: string): string[] {
  if (value === undefined) return []
  return readArray(value, path, what).map((item, position) => readString(item, at(path, position)))
}

function readCondition(value: unknown, path: string): Condition {
  if (isScalar(value)) return value

  if (Array.isArray(value)) {
    return value.map((item, position) => {
      if (!isScalar(item)) {
        fail(`expected a scalar in a condition list, got ${typeName(item)}`, at(path, position))
      }
      return item
    })
  }

  if (!isRecord(value)) {
    fail(
      `expected a condition, got ${typeName(value)}; a condition is a scalar, a list of scalars, or an operator object`,
      path,
    )
  }

  const names = Object.keys(value)
  if (names.length !== 1) {
    fail(`expected a condition object with exactly one operator key, got ${names.length}`, path)
  }

  const operator = names[0] as ConditionOperator
  if (!CONDITION_OPERATORS.includes(operator)) {
    fail(`unknown condition operator "${operator}"`, path)
  }

  const operands = value[operator]

  if (operator === 'var') {
    if (typeof operands !== 'string') {
      fail(`operator "var" expects a string path, got ${typeName(operands)}`, key(path, 'var'))
    }
    return { var: operands }
  }

  const operandPath = key(path, operator)
  const list = readArray(operands, operandPath, `the operands of "${operator}"`)
  const arity = OPERATOR_ARITY[operator]
  if (arity !== undefined && list.length !== arity) {
    fail(`operator "${operator}" expects ${arity} operands, got ${list.length}`, operandPath)
  }
  if (arity === undefined && list.length === 0) {
    fail(`operator "${operator}" expects at least one operand, got 0`, operandPath)
  }

  const parsed = list.map((item, position) => readCondition(item, at(operandPath, position)))
  // The whitelist and the arity are checked above, so the shape is known good here.
  return { [operator]: parsed } as unknown as Condition
}

function readPayload(value: unknown, path: string): Payload {
  const record = readRecord(value, path, 'a payload')
  const payload: Payload = {}
  for (const [name, item] of Object.entries(record)) {
    if (!isScalar(item)) {
      fail(`expected a payload value to be a scalar, got ${typeName(item)}`, key(path, name))
    }
    payload[name] = item
  }
  return payload
}

function readExt(value: unknown, path: string): Ext {
  const record = readRecord(value, path, 'an extension bag')
  const ext: Ext = {}
  for (const [name, item] of Object.entries(record)) {
    if (!EXT_KEY.test(name)) {
      fail(`invalid extension key "${name}", expected x-<namespace>.<key>`, key(path, name))
    }
    if (isScalar(item)) {
      ext[name] = item
      continue
    }
    // Unknown extension values are preserved as written; only the shape is checked.
    ext[name] = readPayload(item, key(path, name))
  }
  return ext
}

function optionalExt(record: Record<string, unknown>, path: string): Ext | undefined {
  const value = record.ext
  return value === undefined ? undefined : readExt(value, key(path, 'ext'))
}

function readRef(value: unknown, path: string): Ref {
  if (typeof value === 'string') return { id: value }
  const record = readRecord(value, path, 'a reference')
  checkKeys(record, ['id', 'name'], path)
  return prune({
    id: requiredString(record, 'id', path),
    name: optionalString(record, 'name', path),
  })
}

function readRefs(value: unknown, path: string): Ref[] {
  if (value === undefined) return []
  return readArray(value, path, 'a dictionary section').map((item, position) =>
    readRef(item, at(path, position)),
  )
}

function readDictionaries(value: unknown, path: string): Dictionaries {
  if (value === undefined) return { actors: [], locations: [], items: [], tags: [] }
  const record = readRecord(value, path, 'the dictionaries')
  checkKeys(record, ['actors', 'locations', 'items', 'tags'], path)
  return {
    actors: readRefs(record.actors, key(path, 'actors')),
    locations: readRefs(record.locations, key(path, 'locations')),
    items: readRefs(record.items, key(path, 'items')),
    tags: readRefs(record.tags, key(path, 'tags')),
  }
}

function readObjective(value: unknown, path: string): Objective {
  const record = readRecord(value, path, 'an objective')
  const kind = required(record, 'kind', path)
  if (typeof kind !== 'string' || !OBJECTIVE_KINDS.includes(kind as Objective['kind'])) {
    fail(`unknown objective kind ${JSON.stringify(kind)}`, path)
  }

  switch (kind) {
    case 'kill':
      checkKeys(record, ['kind', 'actor', 'count'], path)
      return prune({
        kind,
        actor: requiredString(record, 'actor', path),
        count: optionalCount(record, 'count', path),
      })
    case 'collect':
      checkKeys(record, ['kind', 'item', 'count'], path)
      return prune({
        kind,
        item: requiredString(record, 'item', path),
        count: optionalCount(record, 'count', path),
      })
    case 'reach':
      checkKeys(record, ['kind', 'location'], path)
      return { kind, location: requiredString(record, 'location', path) }
    case 'talk':
      checkKeys(record, ['kind', 'actor', 'dialogue'], path)
      return prune({
        kind,
        actor: requiredString(record, 'actor', path),
        dialogue: optionalString(record, 'dialogue', path),
      })
    case 'interact':
      checkKeys(record, ['kind', 'object'], path)
      return { kind, object: requiredString(record, 'object', path) }
    case 'event':
      checkKeys(record, ['kind', 'event', 'count'], path)
      return prune({
        kind,
        event: requiredString(record, 'event', path),
        count: optionalCount(record, 'count', path),
      })
    default:
      checkKeys(record, ['kind', 'custom', 'args'], path)
      return {
        kind: 'custom',
        custom: requiredString(record, 'custom', path),
        args: readIdList(
          required(record, 'args', path),
          key(path, 'args'),
          'the arguments of a custom objective',
        ),
      }
  }
}

function readReward(value: unknown, path: string): Reward {
  const record = readRecord(value, path, 'a reward')
  checkKeys(record, ['id', 'kind', 'ref', 'amount', 'outcome', 'payload', 'ext'], path)

  const id = requiredString(record, 'id', path)
  const kind = required(record, 'kind', path)
  if (typeof kind !== 'string' || !REWARD_KINDS.includes(kind as Reward['kind'])) {
    fail(`unknown reward kind ${JSON.stringify(kind)}`, path)
  }

  const payload = record.payload
  return prune({
    id,
    kind: kind as Reward['kind'],
    ref: requiredString(record, 'ref', path),
    amount: optionalNumber(record, 'amount', path),
    outcome: optionalString(record, 'outcome', path),
    payload: payload === undefined ? undefined : readPayload(payload, key(path, 'payload')),
    ext: optionalExt(record, path),
  })
}

function readParameter(value: unknown, path: string): Parameter {
  const record = readRecord(value, path, 'a parameter')
  checkKeys(record, ['name', 'type', 'constraint', 'ext'], path)
  const type = required(record, 'type', path)
  if (typeof type !== 'string' || !PARAMETER_TYPES.includes(type as Parameter['type'])) {
    fail(`unknown parameter type ${JSON.stringify(type)}`, key(path, 'type'))
  }
  return prune({
    name: requiredString(record, 'name', path),
    type: type as Parameter['type'],
    constraint: optionalString(record, 'constraint', path),
    ext: optionalExt(record, path),
  })
}

/** The parameter list, left out of the model when it is absent or empty. */
function optionalParameters(value: unknown, path: string): Parameter[] | undefined {
  if (value === undefined) return undefined
  const list = readArray(value, path, 'the parameters of a quest').map((item, position) =>
    readParameter(item, at(path, position)),
  )
  return list.length === 0 ? undefined : list
}

function readOutcome(value: unknown, path: string): Outcome {
  const record = readRecord(value, path, 'an outcome')
  checkKeys(record, ['name', 'failed', 'title'], path)
  return prune({
    name: requiredString(record, 'name', path),
    failed: optionalBoolean(record, 'failed', path),
    title: optionalString(record, 'title', path),
  })
}

function readDialogue(value: unknown, path: string): DialogueBinding {
  const record = readRecord(value, path, 'a dialogue binding')
  checkKeys(record, ['provider', 'ref'], path)
  return {
    provider: requiredString(record, 'provider', path),
    ref: requiredString(record, 'ref', path),
  }
}

const STEP_KEYS = [
  'id',
  'title',
  'journal',
  'start',
  'unlock',
  'activate',
  'objective',
  'complete',
  'failObjective',
  'fail',
  'deadline',
  'optional',
  'repeat',
  'outcome',
  'rewards',
  'dialogue',
  'location',
  'actors',
  'ext',
] as const

function readStep(value: unknown, path: string): Step {
  const record = readRecord(value, path, 'a step')
  checkKeys(record, STEP_KEYS, path)

  const objective = record.objective
  const failObjective = record.failObjective
  const outcome = record.outcome
  const dialogue = record.dialogue

  return prune({
    id: requiredString(record, 'id', path),
    title: requiredString(record, 'title', path),
    journal: optionalString(record, 'journal', path),
    start: optionalBoolean(record, 'start', path),
    unlock: optionalCondition(record, 'unlock', path),
    activate: optionalCondition(record, 'activate', path),
    objective:
      objective === undefined ? undefined : readObjective(objective, key(path, 'objective')),
    complete: optionalCondition(record, 'complete', path),
    failObjective:
      failObjective === undefined
        ? undefined
        : readObjective(failObjective, key(path, 'failObjective')),
    fail: optionalCondition(record, 'fail', path),
    deadline: optionalDuration(record, 'deadline', path),
    optional: optionalBoolean(record, 'optional', path),
    repeat: optionalBoolean(record, 'repeat', path),
    outcome: outcome === undefined ? undefined : readOutcome(outcome, key(path, 'outcome')),
    rewards: readIdList(record.rewards, key(path, 'rewards'), 'the rewards of a step'),
    dialogue: dialogue === undefined ? undefined : readDialogue(dialogue, key(path, 'dialogue')),
    location: optionalString(record, 'location', path),
    actors: readIdList(record.actors, key(path, 'actors'), 'the actors of a step'),
    ext: optionalExt(record, path),
  })
}

const QUEST_KEYS = [
  'id',
  'version',
  'title',
  'summary',
  'tags',
  'repeat',
  'unlock',
  'cooldown',
  'expire',
  'params',
  'steps',
  'rewards',
  'ext',
] as const

function readQuest(value: unknown, path: string): Quest {
  const record = readRecord(value, path, 'a quest')
  checkKeys(record, QUEST_KEYS, path)

  const stepsPath = key(path, 'steps')
  const rewardsPath = key(path, 'rewards')

  return prune({
    id: requiredString(record, 'id', path),
    version: readInteger(required(record, 'version', path), key(path, 'version')),
    title: requiredString(record, 'title', path),
    summary: optionalString(record, 'summary', path),
    tags: readIdList(record.tags, key(path, 'tags'), 'the tags of a quest'),
    repeat: optionalBoolean(record, 'repeat', path),
    unlock: optionalCondition(record, 'unlock', path),
    cooldown: optionalDuration(record, 'cooldown', path),
    expire: optionalDuration(record, 'expire', path),
    params: optionalParameters(record.params, key(path, 'params')),
    steps: readArray(required(record, 'steps', path), stepsPath, 'the steps of a quest').map(
      (item, position) => readStep(item, at(stepsPath, position)),
    ),
    rewards:
      record.rewards === undefined
        ? []
        : readArray(record.rewards, rewardsPath, 'the rewards of a quest').map((item, position) =>
            readReward(item, at(rewardsPath, position)),
          ),
    ext: optionalExt(record, path),
  })
}

/** Read a parsed JSON value into the canonical model. Throws JsonFormatError. */
export function fromJsonValue(value: unknown): OqfDocument {
  const record = readRecord(value, '', 'the document')
  checkKeys(record, ['oqf', 'dictionaries', 'quests'], '')

  const version = readNumber(required(record, 'oqf', ''), 'oqf')
  if (version !== OQF_MAJOR) {
    fail(`unsupported oqf version ${version}, expected ${OQF_MAJOR}`, 'oqf')
  }

  return {
    dictionaries: readDictionaries(record.dictionaries, 'dictionaries'),
    quests: readArray(required(record, 'quests', ''), 'quests', 'the quests').map(
      (item, position) => readQuest(item, at('quests', position)),
    ),
  }
}

/** Parse JSON text into the canonical model. Throws JsonFormatError. */
export function parseJson(text: string): OqfDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    fail(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`, '')
  }
  return fromJsonValue(value)
}
