/**
 * Reads the compact line format into the canonical model.
 *
 * The record order and the cell encodings are frozen in docs/12-compact-spec.md.
 * Parsing is a single pass over the lines, which is why `R` records have to come
 * before the `S` records that reference them. Every failure is a
 * CompactFormatError carrying the 1-based line it was raised on.
 */
import { ConditionSyntaxError, parseCompletion, parseCondition } from '../condition/index.js'
import {
  type Condition,
  type DialogueBinding,
  type Ext,
  OQF_MAGIC,
  type Objective,
  type OqfDocument,
  type Outcome,
  type Payload,
  type Quest,
  REWARD_KINDS,
  type Ref,
  type Reward,
  type RewardKind,
  type Scalar,
  type Step,
  emptyDocument,
} from '../model.js'

/** Where the extra cells of a newer writer are parked so they round trip. */
export const EXTRA_EXT_KEY = 'x-oqf.extra'

/** Field counts per record, not counting the leading type cell. */
const QUEST_FIELDS = 7
const REWARD_FIELDS = 6
const STEP_FIELDS = 13

const NAMESPACE = /^[a-z0-9-]+$/
const EXT_NAME = /^[A-Za-z0-9_.-]+$/
const INDEX = /^[0-9]+$/
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/

/** A malformed compact record, located by line. */
export class CompactFormatError extends Error {
  /** 1-based line the failure was raised on. */
  readonly line: number

  constructor(message: string, line: number) {
    super(`${message} on line ${line}`)
    this.name = 'CompactFormatError'
    this.line = line
  }
}

function fail(message: string, line: number): never {
  throw new CompactFormatError(message, line)
}

/** Cell level escapes. Nothing but these four sequences means anything. */
function unescapeCell(text: string): string {
  if (!text.includes('\\')) return text
  return text.replace(/\\(.)/g, (whole, character: string) => {
    if (character === '\\') return '\\'
    if (character === 't') return '\t'
    if (character === 'n') return '\n'
    if (character === 'r') return '\r'
    return whole
  })
}

/** Splits on a separator, stepping over backslash escapes without decoding them. */
function splitEscaped(text: string, separator: string): string[] {
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i]
    if (character === '\\' && i + 1 < text.length) {
      current += character + text[i + 1]
      i += 1
      continue
    }
    if (character === separator) {
      parts.push(current)
      current = ''
      continue
    }
    current += character
  }
  parts.push(current)
  return parts
}

function hasUnescaped(text: string, separator: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1
      continue
    }
    if (text[i] === separator) return true
  }
  return false
}

/** Payload level escapes, applied on top of the cell level ones. */
function unescapePayload(text: string): string {
  if (!text.includes('\\')) return text
  return text.replace(/\\(.)/g, (whole, character: string) =>
    character === ';' || character === '=' || character === '\\' ? character : whole,
  )
}

/** Numbers stay numbers, `true` and `false` stay booleans, everything else is text. */
function typedValue(text: string): Scalar {
  if (text === 'true') return true
  if (text === 'false') return false
  if (NUMBER.test(text)) {
    const value = Number(text)
    if (Number.isFinite(value)) return value
  }
  return text
}

function parsePayload(text: string, line: number, what: string): Payload {
  const payload: Payload = {}
  for (const entry of splitEscaped(text, ';')) {
    if (entry === '') fail(`empty entry in ${what}, expected key=value`, line)
    const pair = splitEscaped(entry, '=')
    if (pair.length !== 2) {
      fail(`invalid entry "${unescapePayload(entry)}" in ${what}, expected key=value`, line)
    }
    const name = unescapePayload(pair[0])
    if (name === '') fail(`empty key in ${what}`, line)
    payload[name] = typedValue(unescapePayload(pair[1]))
  }
  return payload
}

function numberCell(text: string, line: number, what: string): number {
  if (!NUMBER.test(text)) fail(`invalid number "${text}" for ${what}`, line)
  const value = Number(text)
  if (!Number.isFinite(value)) fail(`invalid number "${text}" for ${what}`, line)
  return value
}

function integerCell(text: string, line: number, what: string): number {
  const value = numberCell(text, line, what)
  if (!Number.isInteger(value))
    fail(`invalid number "${text}" for ${what}, expected an integer`, line)
  return value
}

function indexCell(text: string, line: number, size: number, what: string): number {
  if (!INDEX.test(text)) fail(`invalid number "${text}" for ${what}`, line)
  const value = Number(text)
  if (value >= size) {
    fail(`${what} index ${value} is out of range, the dictionary holds ${size}`, line)
  }
  return value
}

function indexList(text: string, line: number, size: number, what: string): number[] {
  if (text === '') return []
  return text.split(',').map((part) => {
    if (!INDEX.test(part)) fail(`invalid number "${part}" for ${what}`, line)
    const value = Number(part)
    if (value >= size) fail(`${what} index ${value} is out of range, ${size} available`, line)
    return value
  })
}

function flagSet(text: string, allowed: string, line: number): Set<string> {
  const flags = new Set<string>()
  for (const character of text) {
    if (!allowed.includes(character)) {
      fail(`unknown flag "${character}", expected one of "${allowed}"`, line)
    }
    flags.add(character)
  }
  return flags
}

function parseRef(text: string): Ref {
  const pipe = text.indexOf('|')
  if (pipe === -1) return { id: text }
  return { id: text.slice(0, pipe), name: text.slice(pipe + 1) }
}

function parseOutcome(text: string): Outcome {
  const failed = text.startsWith('!')
  const body = failed ? text.slice(1) : text
  const pipe = body.indexOf('|')
  const name = pipe === -1 ? body : body.slice(0, pipe)
  const title = pipe === -1 ? undefined : body.slice(pipe + 1)
  return {
    name,
    ...(failed ? { failed: true } : {}),
    ...(title === undefined ? {} : { title }),
  }
}

function parseDialogue(text: string, line: number): DialogueBinding {
  const colon = text.indexOf(':')
  if (colon === -1) fail(`invalid dialogue binding "${text}", expected provider:ref`, line)
  return { provider: text.slice(0, colon), ref: text.slice(colon + 1) }
}

function asFormatError(error: unknown, line: number): unknown {
  if (error instanceof ConditionSyntaxError) return new CompactFormatError(error.message, line)
  return error
}

function conditionCell(text: string, line: number): Condition {
  try {
    return parseCondition(text)
  } catch (error) {
    throw asFormatError(error, line)
  }
}

interface Completion {
  objective?: Objective
  condition?: Condition
}

function completionCell(text: string, line: number): Completion {
  try {
    return parseCompletion(text)
  } catch (error) {
    throw asFormatError(error, line)
  }
}

function addExt(target: { ext?: Ext }, name: string, value: Scalar | Record<string, Scalar>): void {
  const ext = target.ext ?? {}
  ext[name] = value
  target.ext = ext
}

/** Cells past the frozen column order belong to a newer writer. Keep them verbatim. */
function attachExtra(target: { ext?: Ext }, cells: string[], fields: number): void {
  if (cells.length <= fields + 1) return
  addExt(target, EXTRA_EXT_KEY, cells.slice(fields + 1).join('\t'))
}

/** Parse compact text into the canonical model. Throws CompactFormatError. */
export function parseCompact(text: string): OqfDocument {
  const document = emptyDocument()
  const lines = text.split('\n')
  const dictionaries = new Set<string>()
  let magic = false
  let quest: Quest | undefined
  let extTarget: { ext?: Ext } | undefined

  for (let position = 0; position < lines.length; position += 1) {
    const line = position + 1
    const source = lines[position].endsWith('\r') ? lines[position].slice(0, -1) : lines[position]
    if (source === '' || source.startsWith('#')) continue

    if (!magic) {
      if (source !== OQF_MAGIC) {
        fail(`expected the magic line "${OQF_MAGIC}", got "${source}"`, line)
      }
      magic = true
      continue
    }

    const cells = source.split('\t').map(unescapeCell)
    while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop()
    const type = cells[0]
    const cell = (index: number): string => cells[index] ?? ''

    if (type === 'A' || type === 'L' || type === 'I' || type === 'T') {
      if (quest !== undefined) fail(`dictionary line "${type}" after the first quest`, line)
      if (dictionaries.has(type)) fail(`duplicate dictionary line "${type}"`, line)
      dictionaries.add(type)
      const refs = cells.slice(1).map(parseRef)
      if (type === 'A') document.dictionaries.actors = refs
      if (type === 'L') document.dictionaries.locations = refs
      if (type === 'I') document.dictionaries.items = refs
      if (type === 'T') document.dictionaries.tags = refs
      continue
    }

    if (type === 'Q') {
      const id = cell(1)
      if (id === '') fail('missing quest id', line)
      const version = cell(2)
      if (version === '') fail('missing quest version', line)
      const flags = flagSet(cell(3), 'r', line)
      const tags = indexList(cell(4), line, document.dictionaries.tags.length, 'a quest tag').map(
        (index) => document.dictionaries.tags[index].id,
      )
      const unlock = cell(5)
      const summary = cell(7)
      const parsed: Quest = {
        id,
        version: integerCell(version, line, 'a quest version'),
        title: cell(6),
        ...(summary === '' ? {} : { summary }),
        tags,
        ...(flags.has('r') ? { repeat: true } : {}),
        ...(unlock === '' ? {} : { unlock: conditionCell(unlock, line) }),
        steps: [],
        rewards: [],
      }
      attachExtra(parsed, cells, QUEST_FIELDS)
      document.quests.push(parsed)
      quest = parsed
      extTarget = parsed
      continue
    }

    if (type === 'R') {
      if (quest === undefined) fail('reward line before any quest', line)
      const id = cell(1)
      if (id === '') fail('missing reward id', line)
      const kind = cell(2)
      if (kind === '') fail('missing reward kind', line)
      if (!(REWARD_KINDS as readonly string[]).includes(kind)) {
        fail(`unknown reward kind "${kind}"`, line)
      }
      const ref = cell(3)
      if (ref === '') fail('missing reward ref', line)
      const amount = cell(4)
      const outcome = cell(5)
      const payload = cell(6)
      const parsed: Reward = {
        id,
        kind: kind as RewardKind,
        ref,
        ...(amount === '' ? {} : { amount: numberCell(amount, line, 'a reward amount') }),
        ...(outcome === '' ? {} : { outcome }),
        ...(payload === '' ? {} : { payload: parsePayload(payload, line, 'a reward payload') }),
      }
      attachExtra(parsed, cells, REWARD_FIELDS)
      quest.rewards.push(parsed)
      extTarget = parsed
      continue
    }

    if (type === 'S') {
      if (quest === undefined) fail('step line before any quest', line)
      const owner = quest
      const id = cell(1)
      if (id === '') fail('missing step id', line)
      const title = cell(12)
      if (title === '') fail('missing step title', line)
      const flags = flagSet(cell(2), 'sor', line)
      const unlock = cell(3)
      const activate = cell(4)
      const complete = cell(5)
      const failure = cell(6)
      const outcome = cell(7)
      const dialogue = cell(9)
      const location = cell(10)
      const journal = cell(13)
      const completion = complete === '' ? {} : completionCell(complete, line)
      const failed = failure === '' ? {} : completionCell(failure, line)
      const rewards = indexList(cell(8), line, owner.rewards.length, 'a step reward').map(
        (index) => owner.rewards[index].id,
      )
      const actors = indexList(
        cell(11),
        line,
        document.dictionaries.actors.length,
        'a step actor',
      ).map((index) => document.dictionaries.actors[index].id)
      const parsed: Step = {
        id,
        title,
        ...(journal === '' ? {} : { journal }),
        ...(flags.has('s') ? { start: true } : {}),
        ...(unlock === '' ? {} : { unlock: conditionCell(unlock, line) }),
        ...(activate === '' ? {} : { activate: conditionCell(activate, line) }),
        ...(completion.objective === undefined ? {} : { objective: completion.objective }),
        ...(completion.condition === undefined ? {} : { complete: completion.condition }),
        ...(failed.objective === undefined ? {} : { failObjective: failed.objective }),
        ...(failed.condition === undefined ? {} : { fail: failed.condition }),
        ...(flags.has('o') ? { optional: true } : {}),
        ...(flags.has('r') ? { repeat: true } : {}),
        ...(outcome === '' ? {} : { outcome: parseOutcome(outcome) }),
        rewards,
        ...(dialogue === '' ? {} : { dialogue: parseDialogue(dialogue, line) }),
        ...(location === ''
          ? {}
          : {
              location:
                document.dictionaries.locations[
                  indexCell(
                    location,
                    line,
                    document.dictionaries.locations.length,
                    'a step location',
                  )
                ].id,
            }),
        actors,
      }
      attachExtra(parsed, cells, STEP_FIELDS)
      owner.steps.push(parsed)
      extTarget = parsed
      continue
    }

    if (type === 'X') {
      if (extTarget === undefined) fail('extension line before any quest', line)
      const namespace = cell(1)
      const name = cell(2)
      if (!NAMESPACE.test(namespace)) fail(`invalid extension namespace "${namespace}"`, line)
      if (!EXT_NAME.test(name)) fail(`invalid extension key "${name}"`, line)
      const value = cell(3)
      addExt(
        extTarget,
        `x-${namespace}.${name}`,
        hasUnescaped(value, '=')
          ? parsePayload(value, line, 'an extension value')
          : typedValue(unescapePayload(value)),
      )
      continue
    }

    fail(`unknown record type "${type}"`, line)
  }

  if (!magic) fail(`expected the magic line "${OQF_MAGIC}", got an empty document`, 1)
  return document
}
