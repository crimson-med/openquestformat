/**
 * Writes the dialogue model as the JSON form.
 *
 * Key order is the declaration order in model.ts, so two documents with the
 * same content produce byte identical output. Undefined fields, false booleans,
 * empty lists and empty extension bags are left out.
 */
import type { Condition, Ext, Payload, Ref } from '@oqf/core'
import {
  type Choice,
  type Conversation,
  type DialogueDocument,
  type DialogueNode,
  type EmitSpec,
  type FlagSet,
  OQD_MAJOR,
} from '../model.js'

type JsonRecord = Record<string, unknown>

export interface DialogueJsonOptions {
  /** Two space indentation and a trailing newline. Defaults to true. */
  pretty?: boolean
}

function prune(value: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

/** Booleans are only written when true, so `false` and absent look the same. */
function flag(value: boolean | undefined): true | undefined {
  return value === true ? true : undefined
}

function copyPayload(payload: Payload | undefined): JsonRecord | undefined {
  if (payload === undefined || Object.keys(payload).length === 0) return undefined
  return { ...payload }
}

function copyExt(ext: Ext | undefined): JsonRecord | undefined {
  if (ext === undefined) return undefined
  const entries = Object.entries(ext)
  if (entries.length === 0) return undefined
  return Object.fromEntries(
    entries.map(([name, value]) => [
      name,
      typeof value === 'object' && value !== null ? { ...value } : value,
    ]),
  )
}

function copyCondition(condition: Condition): unknown {
  if (Array.isArray(condition)) return [...condition]
  if (typeof condition !== 'object' || condition === null) return condition

  const entry = Object.entries(condition)[0]
  const operator = entry[0]
  const operands = entry[1]
  if (operator === 'var') return { var: operands }
  return { [operator]: (operands as Condition[]).map(copyCondition) }
}

function writeCondition(condition: Condition | undefined): unknown {
  return condition === undefined ? undefined : copyCondition(condition)
}

function writeRef(ref: Ref): JsonRecord {
  return prune({ id: ref.id, name: ref.name })
}

function writeFlagSet(set: FlagSet): JsonRecord {
  return prune({ flag: set.flag, value: set.value })
}

function writeEmit(emit: EmitSpec): JsonRecord {
  return prune({ event: emit.event, payload: copyPayload(emit.payload) })
}

function writeSets(sets: FlagSet[] | undefined): JsonRecord[] | undefined {
  return sets === undefined || sets.length === 0 ? undefined : sets.map(writeFlagSet)
}

function writeEmits(emits: EmitSpec[] | undefined): JsonRecord[] | undefined {
  return emits === undefined || emits.length === 0 ? undefined : emits.map(writeEmit)
}

function writeChoice(choice: Choice): JsonRecord {
  return prune({
    text: choice.text,
    next: choice.next,
    condition: writeCondition(choice.condition),
    // `hidden` is the default, so it is never written.
    show: choice.show === 'disabled' ? choice.show : undefined,
    set: writeSets(choice.set),
    emit: writeEmits(choice.emit),
    once: flag(choice.once),
    ext: copyExt(choice.ext),
  })
}

function writeNode(node: DialogueNode): JsonRecord {
  return prune({
    id: node.id,
    speaker: node.speaker,
    text: node.text,
    next: node.next,
    choices:
      node.choices === undefined || node.choices.length === 0
        ? undefined
        : node.choices.map(writeChoice),
    set: writeSets(node.set),
    emit: writeEmits(node.emit),
    lore: flag(node.lore),
    ext: copyExt(node.ext),
  })
}

function writeConversation(conversation: Conversation): JsonRecord {
  return prune({
    id: conversation.id,
    actor: conversation.actor,
    title: conversation.title,
    start: conversation.start,
    nodes: conversation.nodes.map(writeNode),
    ext: copyExt(conversation.ext),
  })
}

/** Convert the dialogue model to a plain JSON value, ready for JSON.stringify. */
export function toDialogueJsonValue(doc: DialogueDocument): unknown {
  return {
    oqd: OQD_MAJOR,
    speakers: doc.speakers.map(writeRef),
    conversations: doc.conversations.map(writeConversation),
  }
}

/** Serialize the dialogue model as JSON text. Pretty by default, two spaces and a trailing newline. */
export function toDialogueJson(doc: DialogueDocument, options: DialogueJsonOptions = {}): string {
  const value = toDialogueJsonValue(doc)
  if (options.pretty === false) return JSON.stringify(value)
  return `${JSON.stringify(value, null, 2)}\n`
}
