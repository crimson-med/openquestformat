/**
 * Reads the compact dialogue line format (.oqd) into the dialogue model.
 *
 * The record order and the cell encodings are frozen in docs/13-dialogue-spec.md.
 * Parsing is a single pass over the lines: a `C` opens a conversation, every `N`
 * after it belongs to that conversation, every `O` attaches to the `N` above it,
 * and an `X` attaches to whichever of the three came last. Every failure is an
 * OqdFormatError carrying the 1-based line it was raised on.
 */
import {
  type Condition,
  ConditionSyntaxError,
  type Ext,
  type Payload,
  type Ref,
  type Scalar,
  parseCondition,
} from '@oqf/core'
import {
  type Choice,
  type Conversation,
  type DialogueDocument,
  type DialogueNode,
  type EmitSpec,
  type FlagSet,
  OQD_MAGIC,
  emptyDialogueDocument,
} from '../model.js'

/** Where the extra cells of a newer writer are parked so they round trip. */
export const EXTRA_EXT_KEY = 'x-oqf.extra'

/** Field counts per record, not counting the leading type cell. */
const CONVERSATION_FIELDS = 4
const NODE_FIELDS = 7
const CHOICE_FIELDS = 6

const NAMESPACE = /^[a-z0-9-]+$/
const EXT_NAME = /^[A-Za-z0-9_.-]+$/
const INDEX = /^[0-9]+$/
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/

/** Characters a `set` cell escapes on top of the cell level escapes. */
const SET_SPECIALS = ';='
/** Characters an `emit` cell escapes on top of the cell level escapes. */
const EMIT_SPECIALS = ';:,='

/** A malformed compact dialogue record, located by line. */
export class OqdFormatError extends Error {
  /** 1-based line the failure was raised on. */
  readonly line: number

  constructor(message: string, line: number) {
    super(`${message} on line ${line}`)
    this.name = 'OqdFormatError'
    this.line = line
  }
}

function fail(message: string, line: number): never {
  throw new OqdFormatError(message, line)
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

/** Sub-cell escapes, applied on top of the cell level ones. */
function unescapeIn(text: string, specials: string): string {
  if (!text.includes('\\')) return text
  return text.replace(/\\(.)/g, (whole, character: string) =>
    character === '\\' || specials.includes(character) ? character : whole,
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

function indexCell(text: string, line: number, size: number, what: string): number {
  if (!INDEX.test(text)) fail(`invalid number "${text}" for ${what}`, line)
  const value = Number(text)
  if (value >= size) {
    fail(`${what} index ${value} is out of range, the dictionary holds ${size}`, line)
  }
  return value
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

function asFormatError(error: unknown, line: number): unknown {
  if (error instanceof ConditionSyntaxError) return new OqdFormatError(error.message, line)
  return error
}

function conditionCell(text: string, line: number): Condition {
  try {
    return parseCondition(text)
  } catch (error) {
    throw asFormatError(error, line)
  }
}

/** `flag=value;flag=value`. A bare `flag` carries no value, so the model default applies. */
function parseSetCell(text: string, line: number): FlagSet[] {
  const sets: FlagSet[] = []
  for (const entry of splitEscaped(text, ';')) {
    if (entry === '') fail('empty entry in a set cell, expected flag or flag=value', line)
    const pair = splitEscaped(entry, '=')
    if (pair.length > 2) {
      fail(`invalid entry "${unescapeIn(entry, SET_SPECIALS)}" in a set cell`, line)
    }
    const flag = unescapeIn(pair[0], SET_SPECIALS)
    if (flag === '') fail('empty flag name in a set cell', line)
    if (pair.length === 1) {
      sets.push({ flag })
      continue
    }
    sets.push({ flag, value: typedValue(unescapeIn(pair[1], SET_SPECIALS)) })
  }
  return sets
}

/** `event;event`, each optionally `event:k=v,k=v`. */
function parseEmitCell(text: string, line: number): EmitSpec[] {
  const emits: EmitSpec[] = []
  for (const entry of splitEscaped(text, ';')) {
    if (entry === '') fail('empty entry in an emit cell, expected an event name', line)
    const parts = splitEscaped(entry, ':')
    if (parts.length > 2) {
      fail(`invalid entry "${unescapeIn(entry, EMIT_SPECIALS)}" in an emit cell`, line)
    }
    const event = unescapeIn(parts[0], EMIT_SPECIALS)
    if (event === '') fail('empty event name in an emit cell', line)
    if (parts.length === 1) {
      emits.push({ event })
      continue
    }
    const payload: Payload = {}
    for (const item of splitEscaped(parts[1], ',')) {
      if (item === '') fail(`empty entry in the payload of "${event}", expected key=value`, line)
      const pair = splitEscaped(item, '=')
      if (pair.length !== 2) {
        fail(
          `invalid entry "${unescapeIn(item, EMIT_SPECIALS)}" in the payload of "${event}", expected key=value`,
          line,
        )
      }
      const name = unescapeIn(pair[0], EMIT_SPECIALS)
      if (name === '') fail(`empty key in the payload of "${event}"`, line)
      payload[name] = typedValue(unescapeIn(pair[1], EMIT_SPECIALS))
    }
    emits.push({ event, payload })
  }
  return emits
}

/** An `X` value cell: a flat map when it holds an unescaped `=`, a scalar otherwise. */
function parseExtValue(text: string, line: number): Scalar | Record<string, Scalar> {
  if (!hasUnescaped(text, '=')) return typedValue(unescapeIn(text, SET_SPECIALS))
  const value: Record<string, Scalar> = {}
  for (const entry of splitEscaped(text, ';')) {
    if (entry === '') fail('empty entry in an extension value, expected key=value', line)
    const pair = splitEscaped(entry, '=')
    if (pair.length !== 2) {
      fail(
        `invalid entry "${unescapeIn(entry, SET_SPECIALS)}" in an extension value, expected key=value`,
        line,
      )
    }
    const name = unescapeIn(pair[0], SET_SPECIALS)
    if (name === '') fail('empty key in an extension value', line)
    value[name] = typedValue(unescapeIn(pair[1], SET_SPECIALS))
  }
  return value
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

/** Parse compact dialogue text into the dialogue model. Throws OqdFormatError. */
export function parseOqd(text: string): DialogueDocument {
  const document = emptyDialogueDocument()
  const lines = text.split('\n')
  let magic = false
  let speakersSeen = false
  let conversation: Conversation | undefined
  let node: DialogueNode | undefined
  let extTarget: { ext?: Ext } | undefined

  for (let position = 0; position < lines.length; position += 1) {
    const line = position + 1
    const source = lines[position].endsWith('\r') ? lines[position].slice(0, -1) : lines[position]
    if (source === '' || source.startsWith('#')) continue

    if (!magic) {
      if (source !== OQD_MAGIC) {
        fail(`expected the magic line "${OQD_MAGIC}", got "${source}"`, line)
      }
      magic = true
      continue
    }

    const cells = source.split('\t').map(unescapeCell)
    while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop()
    const type = cells[0]
    const cell = (index: number): string => cells[index] ?? ''

    if (type === 'A') {
      if (conversation !== undefined) fail('speakers line after the first conversation', line)
      if (speakersSeen) fail('duplicate speakers line "A"', line)
      speakersSeen = true
      document.speakers = cells.slice(1).map(parseRef)
      continue
    }

    if (type === 'C') {
      const id = cell(1)
      if (id === '') fail('missing conversation id', line)
      const actor = cell(2)
      const start = cell(3)
      if (start === '') fail(`missing start node for conversation "${id}"`, line)
      const title = cell(4)
      const parsed: Conversation = {
        id,
        ...(actor === ''
          ? {}
          : {
              actor:
                document.speakers[
                  indexCell(actor, line, document.speakers.length, 'a conversation actor')
                ].id,
            }),
        ...(title === '' ? {} : { title }),
        start,
        nodes: [],
      }
      attachExtra(parsed, cells, CONVERSATION_FIELDS)
      document.conversations.push(parsed)
      conversation = parsed
      node = undefined
      extTarget = parsed
      continue
    }

    if (type === 'N') {
      if (conversation === undefined) fail('node line before any conversation', line)
      const id = cell(1)
      if (id === '') fail('missing node id', line)
      const speaker = cell(2)
      const flags = flagSet(cell(3), 'l', line)
      const next = cell(4)
      const set = cell(5)
      const emit = cell(6)
      const parsed: DialogueNode = {
        id,
        ...(speaker === ''
          ? {}
          : {
              speaker:
                document.speakers[
                  indexCell(speaker, line, document.speakers.length, 'a node speaker')
                ].id,
            }),
        text: cell(7),
        ...(next === '' ? {} : { next }),
        ...(set === '' ? {} : { set: parseSetCell(set, line) }),
        ...(emit === '' ? {} : { emit: parseEmitCell(emit, line) }),
        ...(flags.has('l') ? { lore: true } : {}),
      }
      attachExtra(parsed, cells, NODE_FIELDS)
      conversation.nodes.push(parsed)
      node = parsed
      extTarget = parsed
      continue
    }

    if (type === 'O') {
      if (node === undefined) fail('choice line before any node', line)
      const next = cell(1)
      const condition = cell(2)
      const flags = flagSet(cell(3), 'od', line)
      const set = cell(4)
      const emit = cell(5)
      const parsed: Choice = {
        text: cell(6),
        ...(next === '' ? {} : { next }),
        ...(condition === '' ? {} : { condition: conditionCell(condition, line) }),
        ...(flags.has('d') ? { show: 'disabled' as const } : {}),
        ...(set === '' ? {} : { set: parseSetCell(set, line) }),
        ...(emit === '' ? {} : { emit: parseEmitCell(emit, line) }),
        ...(flags.has('o') ? { once: true } : {}),
      }
      attachExtra(parsed, cells, CHOICE_FIELDS)
      node.choices = [...(node.choices ?? []), parsed]
      extTarget = parsed
      continue
    }

    if (type === 'X') {
      if (extTarget === undefined) fail('extension line before any conversation', line)
      const namespace = cell(1)
      const name = cell(2)
      if (!NAMESPACE.test(namespace)) fail(`invalid extension namespace "${namespace}"`, line)
      if (!EXT_NAME.test(name)) fail(`invalid extension key "${name}"`, line)
      addExt(extTarget, `x-${namespace}.${name}`, parseExtValue(cell(3), line))
      continue
    }

    fail(`unknown record type "${type}"`, line)
  }

  if (!magic) fail(`expected the magic line "${OQD_MAGIC}", got an empty document`, 1)
  return document
}
