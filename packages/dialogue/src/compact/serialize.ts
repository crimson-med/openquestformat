/**
 * Writes the dialogue model back out as compact lines.
 *
 * The normalization rules in docs/13-dialogue-spec.md are what make the round
 * trip byte stable: speakers in first-use order, nodes and choices in model
 * order, conditions in their one canonical spelling, no trailing empty cells
 * and `X` lines sorted by namespace then key.
 */
import {
  type Condition,
  type Ext,
  type Payload,
  type Ref,
  type Scalar,
  formatCondition,
} from '@oqf/core'
import type {
  Choice,
  Conversation,
  DialogueDocument,
  DialogueNode,
  EmitSpec,
  FlagSet,
} from '../model.js'
import { OQD_MAGIC } from '../model.js'
import { EXTRA_EXT_KEY } from './parse.js'

const EXT_KEY = /^x-([a-z0-9-]+)\.([A-Za-z0-9_.-]+)$/

/** Characters a `set` cell escapes on top of the cell level escapes. */
const SET_SPECIALS = /([;=\\])/g
/** Characters an `emit` cell escapes on top of the cell level escapes. */
const EMIT_SPECIALS = /([;:,=\\])/g

/** A speakers dictionary laid out in first-use order, with the index every ref cell uses. */
interface Interned {
  refs: Ref[]
  index: Map<string, number>
}

function escapeCell(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

/**
 * Sub-cell escapes. The cell level escapes run on top of these, so a backslash
 * written here reaches the line doubled and comes back intact.
 */
function escapeIn(text: string, specials: RegExp): string {
  return text.replace(specials, '\\$1')
}

function scalarText(value: Scalar): string {
  return typeof value === 'string' ? value : String(value)
}

function record(type: string, cells: string[]): string {
  const kept = [...cells]
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop()
  return [type, ...kept.map(escapeCell)].join('\t')
}

function refCell(ref: Ref): string {
  return ref.name === undefined ? ref.id : `${ref.id}|${ref.name}`
}

function intern(entries: Ref[], used: string[]): Interned {
  const known = new Map<string, Ref>()
  for (const entry of entries) {
    if (!known.has(entry.id)) known.set(entry.id, entry)
  }
  const refs: Ref[] = []
  const index = new Map<string, number>()
  const push = (ref: Ref): void => {
    if (index.has(ref.id)) return
    index.set(ref.id, refs.length)
    refs.push(ref)
  }
  for (const id of used) push(known.get(id) ?? { id })
  for (const entry of entries) push(entry)
  return { refs, index }
}

function indexOf(dictionary: Interned, id: string, what: string): number {
  const found = dictionary.index.get(id)
  if (found === undefined) throw new Error(`cannot serialize ${what}: "${id}" is not interned`)
  return found
}

/** First-use order: each conversation's actor, then the speakers of its nodes. */
function usedSpeakers(document: DialogueDocument): string[] {
  const used: string[] = []
  for (const conversation of document.conversations) {
    if (conversation.actor !== undefined) used.push(conversation.actor)
    for (const node of conversation.nodes) {
      if (node.speaker !== undefined) used.push(node.speaker)
    }
  }
  return used
}

/** `flag=value;flag=value`. A flag with no value is written bare. */
function setCell(sets: FlagSet[] | undefined): string {
  if (sets === undefined || sets.length === 0) return ''
  return sets
    .map((entry) => {
      const flag = escapeIn(entry.flag, SET_SPECIALS)
      if (entry.value === undefined) return flag
      return `${flag}=${escapeIn(scalarText(entry.value), SET_SPECIALS)}`
    })
    .join(';')
}

function payloadText(payload: Payload): string {
  return Object.entries(payload)
    .map(
      ([name, value]) =>
        `${escapeIn(name, EMIT_SPECIALS)}=${escapeIn(scalarText(value), EMIT_SPECIALS)}`,
    )
    .join(',')
}

/** `event;event`, each optionally `event:k=v,k=v`. */
function emitCell(emits: EmitSpec[] | undefined): string {
  if (emits === undefined || emits.length === 0) return ''
  return emits
    .map((entry) => {
      const event = escapeIn(entry.event, EMIT_SPECIALS)
      if (entry.payload === undefined || Object.keys(entry.payload).length === 0) return event
      return `${event}:${payloadText(entry.payload)}`
    })
    .join(';')
}

/** The cells of a newer writer, handed straight back in the order they arrived. */
function extraCells(ext: Ext | undefined): string[] {
  const extra = ext?.[EXTRA_EXT_KEY]
  if (extra === undefined) return []
  if (typeof extra !== 'string') {
    throw new Error(`cannot serialize "${EXTRA_EXT_KEY}": expected TAB separated cells`)
  }
  return extra.split('\t')
}

function compare(left: string, right: string): number {
  if (left < right) return -1
  return left > right ? 1 : 0
}

function extValueCell(value: Scalar | Record<string, Scalar>): string {
  if (typeof value !== 'object') return escapeIn(scalarText(value), SET_SPECIALS)
  return Object.entries(value)
    .map(
      ([name, item]) =>
        `${escapeIn(name, SET_SPECIALS)}=${escapeIn(scalarText(item), SET_SPECIALS)}`,
    )
    .join(';')
}

function extLines(ext: Ext | undefined): string[] {
  if (ext === undefined) return []
  const entries: { namespace: string; name: string; value: Scalar | Record<string, Scalar> }[] = []
  for (const [key, value] of Object.entries(ext)) {
    if (key === EXTRA_EXT_KEY) continue
    const match = EXT_KEY.exec(key)
    if (match === null) {
      throw new Error(`cannot serialize extension key "${key}", expected x-<namespace>.<key>`)
    }
    entries.push({ namespace: match[1], name: match[2], value })
  }
  entries.sort((left, right) =>
    left.namespace === right.namespace
      ? compare(left.name, right.name)
      : compare(left.namespace, right.namespace),
  )
  return entries.map((entry) =>
    record('X', [entry.namespace, entry.name, extValueCell(entry.value)]),
  )
}

function conditionCell(condition: Condition | undefined): string {
  return condition === undefined ? '' : formatCondition(condition)
}

function conversationCells(conversation: Conversation, speakers: Interned): string[] {
  return [
    conversation.id,
    conversation.actor === undefined
      ? ''
      : String(indexOf(speakers, conversation.actor, 'a conversation actor')),
    conversation.start,
    conversation.title ?? '',
  ]
}

function nodeCells(node: DialogueNode, speakers: Interned): string[] {
  return [
    node.id,
    node.speaker === undefined ? '' : String(indexOf(speakers, node.speaker, 'a node speaker')),
    node.lore === true ? 'l' : '',
    node.next ?? '',
    setCell(node.set),
    emitCell(node.emit),
    node.text,
  ]
}

function choiceCells(choice: Choice): string[] {
  const flags = `${choice.once === true ? 'o' : ''}${choice.show === 'disabled' ? 'd' : ''}`
  return [
    choice.next ?? '',
    conditionCell(choice.condition),
    flags,
    setCell(choice.set),
    emitCell(choice.emit),
    choice.text,
  ]
}

/** Render the dialogue model as normalized compact text, trailing LF included. */
export function toOqd(doc: DialogueDocument): string {
  const speakers = intern(doc.speakers, usedSpeakers(doc))

  const lines: string[] = [OQD_MAGIC]
  if (speakers.refs.length > 0) lines.push(record('A', speakers.refs.map(refCell)))

  for (const conversation of doc.conversations) {
    lines.push(
      record('C', [...conversationCells(conversation, speakers), ...extraCells(conversation.ext)]),
    )
    lines.push(...extLines(conversation.ext))
    for (const node of conversation.nodes) {
      lines.push(record('N', [...nodeCells(node, speakers), ...extraCells(node.ext)]))
      lines.push(...extLines(node.ext))
      for (const choice of node.choices ?? []) {
        lines.push(record('O', [...choiceCells(choice), ...extraCells(choice.ext)]))
        lines.push(...extLines(choice.ext))
      }
    }
  }

  return `${lines.join('\n')}\n`
}
