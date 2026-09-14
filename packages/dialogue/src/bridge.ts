/**
 * The dialogue bridge: the only surface a quest runtime needs from a dialogue
 * system. Any provider (the built-in one, Ink, Yarn Spinner, a custom engine)
 * implements DialogueProvider and emits the events below.
 *
 * Emitted event names and payloads match docs/03-events.md and the quest
 * runtime's `talk` objective matching: `dialogue.ended` carries `actor` (the
 * conversation's actor) and `node` (the conversation id).
 */
import type { Condition, Payload, Scalar, Text } from '@oqf/core'

export interface DialogueEvent {
  name: string
  payload: Payload
}

export const DIALOGUE_STARTED = 'dialogue.started'
export const DIALOGUE_CHOICE = 'dialogue.choice'
export const DIALOGUE_ENDED = 'dialogue.ended'
export const FLAG_SET = 'flag.set'

/** Remembers which `once` choices have been taken. The game persists it. */
export interface OnceStore {
  has(key: string): boolean
  add(key: string): void
}

export interface DialogueContext {
  /** Resolves condition variables, usually the quest runtime's resolver. */
  resolve: (path: string) => unknown
  /** Receives every event the dialogue emits. Usually `runtime.emit`. */
  emit: (event: DialogueEvent) => void
  once?: OnceStore
}

/** What the UI renders for the current node. */
export interface DialogueView {
  conversation: string
  node: string
  speaker?: string
  text: Text
  choices: DialogueChoiceView[]
  /** True when the node has no choices and `advance()` continues or ends. */
  linear: boolean
}

export interface DialogueChoiceView {
  index: number
  text: Text
  disabled: boolean
}

export interface DialogueSession {
  readonly ended: boolean
  /** Null once ended. */
  current(): DialogueView | null
  /** Continue past a node without choices. No-op when choices are present. */
  advance(): void
  /** Pick a choice by its `index` from the current view. Throws on a disabled or unknown index. */
  choose(index: number): void
}

export interface DialogueProvider {
  readonly name: string
  /** Begin a conversation. `ref` is provider-specific: a conversation id for the built-in provider. */
  start(ref: string, context: DialogueContext): DialogueSession
}

/** Builds the `once` store key for a choice. */
export function onceKey(conversation: string, node: string, choice: number): string {
  return `${conversation}#${node}#${choice}`
}

/** Convenience for building a flag payload in the shape `flag.set` expects. */
export function flagPayload(flag: string, value: Scalar): Payload {
  return { flag, value }
}

export type { Condition }
