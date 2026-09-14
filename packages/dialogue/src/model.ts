/**
 * The canonical Open Quest Format dialogue model.
 *
 * Dialogue is a sibling of the quest model, not part of it. A quest binds to a
 * conversation by id and observes the flags and events it sets through the
 * bridge in bridge.ts. See docs/04-dialogue.md and docs/13-dialogue-spec.md.
 */
import type { Condition, Ext, Payload, Ref, Scalar, Text } from '@oqf/core'

/** Sets a flag when a node is shown or a choice is picked. `value` defaults to true. */
export interface FlagSet {
  flag: string
  value?: Scalar
}

/** Emits an event when a node is shown or a choice is picked. */
export interface EmitSpec {
  event: string
  payload?: Payload
}

export interface Choice {
  text: Text
  /** Node to continue at. Absent ends the conversation. */
  next?: string
  /** Hidden unless true. With `show: 'disabled'` it is listed but not selectable. */
  condition?: Condition
  show?: 'hidden' | 'disabled'
  set?: FlagSet[]
  emit?: EmitSpec[]
  /** Hidden after it has been picked once in this save. */
  once?: boolean
  ext?: Ext
}

export interface DialogueNode {
  id: string
  /** Actor id. Defaults to the conversation's actor. */
  speaker?: string
  text: Text
  /** Node to continue at when there are no choices. Absent with no choices ends the conversation. */
  next?: string
  /** When present, `next` is ignored. */
  choices?: Choice[]
  set?: FlagSet[]
  emit?: EmitSpec[]
  /** Declares that nothing in the subtree from this node sets a flag or emits. The validator checks it. */
  lore?: boolean
  ext?: Ext
}

export interface Conversation {
  id: string
  /** Default speaker. */
  actor?: string
  /** Optional label for tooling. */
  title?: Text
  /** Node id to begin at. */
  start: string
  nodes: DialogueNode[]
  ext?: Ext
}

/** One `.oqd` file: a speakers dictionary plus one or more conversations. */
export interface DialogueDocument {
  speakers: Ref[]
  conversations: Conversation[]
}

export const OQD_MAJOR = 1
export const OQD_MAGIC = `OQD${OQD_MAJOR}`

export function emptyDialogueDocument(): DialogueDocument {
  return { speakers: [], conversations: [] }
}
