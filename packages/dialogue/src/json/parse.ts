/**
 * Reads the JSON form of a DialogueDocument into the dialogue model.
 *
 * Validation is done by hand, with no schema library, so every failure can
 * carry the exact path of the offending value. Defaults are normalized away on
 * read: empty lists, empty extension bags, `lore: false`, `once: false` and
 * `show: "hidden"` all read as absent, so the JSON and compact forms of the
 * same document parse to deep-equal models.
 */
import {
  CONDITION_OPERATORS,
  type Condition,
  type ConditionOperator,
  type Ext,
  type Payload,
  type Ref,
  type Scalar,
} from '@oqf/core'
import {
  type Choice,
  type Conversation,
  type DialogueDocument,
  type DialogueNode,
  type EmitSpec,
  type FlagSet,
  OQD_MAJOR,
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
export class DialogueJsonError extends Error {
  /** Path to the offending value, such as `conversations[0].nodes[2].choices[1]`. */
  readonly path: string

  constructor(message: string, path: string) {
    super(path === '' ? message : `${message} at ${path}`)
    this.name = 'DialogueJsonError'
    this.path = path
  }
}

function fail(message: string, path: string): never {
  throw new DialogueJsonError(message, path)
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

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'boolean' || isNumber(value)
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

/** `false` and absent mean the same thing, so both read as absent. */
function optionalFlag(
  record: Record<string, unknown>,
  name: string,
  path: string,
): true | undefined {
  const value = record[name]
  if (value === undefined) return undefined
  return readBoolean(value, key(path, name)) ? true : undefined
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

function readExt(value: unknown, path: string): Ext | undefined {
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
  return Object.keys(ext).length === 0 ? undefined : ext
}

function optionalExt(record: Record<string, unknown>, path: string): Ext | undefined {
  const value = record.ext
  return value === undefined ? undefined : readExt(value, key(path, 'ext'))
}

function readRef(value: unknown, path: string): Ref {
  if (typeof value === 'string') return { id: value }
  const record = readRecord(value, path, 'a speaker')
  checkKeys(record, ['id', 'name'], path)
  return prune({
    id: requiredString(record, 'id', path),
    name: optionalString(record, 'name', path),
  })
}

function readFlagSet(value: unknown, path: string): FlagSet {
  const record = readRecord(value, path, 'a flag set')
  checkKeys(record, ['flag', 'value'], path)
  const item = record.value
  if (item !== undefined && !isScalar(item)) {
    fail(`expected a flag value to be a scalar, got ${typeName(item)}`, key(path, 'value'))
  }
  return prune({ flag: requiredString(record, 'flag', path), value: item as Scalar | undefined })
}

function readEmit(value: unknown, path: string): EmitSpec {
  const record = readRecord(value, path, 'an emit')
  checkKeys(record, ['event', 'payload'], path)
  const payload = record.payload
  const parsed = payload === undefined ? undefined : readPayload(payload, key(path, 'payload'))
  return prune({
    event: requiredString(record, 'event', path),
    payload: parsed !== undefined && Object.keys(parsed).length === 0 ? undefined : parsed,
  })
}

/** Empty lists read as absent so the JSON and compact forms agree. */
function readList<T>(
  value: unknown,
  path: string,
  what: string,
  read: (item: unknown, itemPath: string) => T,
): T[] | undefined {
  if (value === undefined) return undefined
  const items = readArray(value, path, what).map((item, position) => read(item, at(path, position)))
  return items.length === 0 ? undefined : items
}

const CHOICE_KEYS = ['text', 'next', 'condition', 'show', 'set', 'emit', 'once', 'ext'] as const

function readChoice(value: unknown, path: string): Choice {
  const record = readRecord(value, path, 'a choice')
  checkKeys(record, CHOICE_KEYS, path)

  const condition = record.condition
  const show = optionalString(record, 'show', path)
  if (show !== undefined && show !== 'hidden' && show !== 'disabled') {
    fail(`expected "hidden" or "disabled", got ${JSON.stringify(show)}`, key(path, 'show'))
  }

  return prune({
    text: requiredString(record, 'text', path),
    next: optionalString(record, 'next', path),
    condition:
      condition === undefined ? undefined : readCondition(condition, key(path, 'condition')),
    // `hidden` is the default, so it is normalized away.
    show: show === 'disabled' ? show : undefined,
    set: readList(record.set, key(path, 'set'), 'the flags of a choice', readFlagSet),
    emit: readList(record.emit, key(path, 'emit'), 'the events of a choice', readEmit),
    once: optionalFlag(record, 'once', path),
    ext: optionalExt(record, path),
  })
}

const NODE_KEYS = [
  'id',
  'speaker',
  'text',
  'next',
  'choices',
  'set',
  'emit',
  'lore',
  'ext',
] as const

function readNode(value: unknown, path: string): DialogueNode {
  const record = readRecord(value, path, 'a node')
  checkKeys(record, NODE_KEYS, path)

  return prune({
    id: requiredString(record, 'id', path),
    speaker: optionalString(record, 'speaker', path),
    text: requiredString(record, 'text', path),
    next: optionalString(record, 'next', path),
    choices: readList(record.choices, key(path, 'choices'), 'the choices of a node', readChoice),
    set: readList(record.set, key(path, 'set'), 'the flags of a node', readFlagSet),
    emit: readList(record.emit, key(path, 'emit'), 'the events of a node', readEmit),
    lore: optionalFlag(record, 'lore', path),
    ext: optionalExt(record, path),
  })
}

const CONVERSATION_KEYS = ['id', 'actor', 'title', 'start', 'nodes', 'ext'] as const

function readConversation(value: unknown, path: string): Conversation {
  const record = readRecord(value, path, 'a conversation')
  checkKeys(record, CONVERSATION_KEYS, path)

  const nodesPath = key(path, 'nodes')
  return prune({
    id: requiredString(record, 'id', path),
    actor: optionalString(record, 'actor', path),
    title: optionalString(record, 'title', path),
    start: requiredString(record, 'start', path),
    nodes: readArray(required(record, 'nodes', path), nodesPath, 'the nodes of a conversation').map(
      (item, position) => readNode(item, at(nodesPath, position)),
    ),
    ext: optionalExt(record, path),
  })
}

/** Read a parsed JSON value into the dialogue model. Throws DialogueJsonError. */
export function fromDialogueJsonValue(value: unknown): DialogueDocument {
  const record = readRecord(value, '', 'the document')
  checkKeys(record, ['oqd', 'speakers', 'conversations'], '')

  const version = readNumber(required(record, 'oqd', ''), 'oqd')
  if (version !== OQD_MAJOR) {
    fail(`unsupported oqd version ${version}, expected ${OQD_MAJOR}`, 'oqd')
  }

  const speakers = record.speakers
  return {
    speakers:
      speakers === undefined
        ? []
        : readArray(speakers, 'speakers', 'the speakers').map((item, position) =>
            readRef(item, at('speakers', position)),
          ),
    conversations: readArray(
      required(record, 'conversations', ''),
      'conversations',
      'the conversations',
    ).map((item, position) => readConversation(item, at('conversations', position))),
  }
}

/** Parse JSON text into the dialogue model. Throws DialogueJsonError. */
export function parseDialogueJson(text: string): DialogueDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    fail(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`, '')
  }
  return fromDialogueJsonValue(value)
}
