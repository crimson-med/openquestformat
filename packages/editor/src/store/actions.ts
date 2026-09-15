/**
 * Every edit the store understands.
 *
 * Field setters are generated from the model types, so adding a field to the
 * model adds it here without a new action. `value: undefined` removes the key
 * rather than writing an undefined into the document.
 */
import type { OqfDocument, Outcome, Quest, Ref, Reward, Step } from '@oqf/core'
import type { Choice, Conversation, DialogueDocument, DialogueNode } from '@oqf/dialogue'
import type { DependencyField, DependencyState } from '../lib/connections'
import type { EntryKind } from '../lib/dictionaries'
import type { Position } from '../lib/position'
import type { Selection } from './types'

/** One `field` plus the `value` its type allows, for any key of T. */
export type FieldPatch<T> = { [K in keyof T]-?: { field: K; value: T[K] } }[keyof T]

export type DictionaryKind = 'actors' | 'locations' | 'items' | 'tags'

export type Action =
  | { type: 'doc/load'; quests?: OqfDocument; dialogues?: DialogueDocument; selection?: Selection }
  | { type: 'doc/reset' }
  | { type: 'doc/markSaved' }
  /** Swaps whole documents as one undoable edit, for extraction and injection. */
  | { type: 'doc/replace'; quests?: OqfDocument; dialogues?: DialogueDocument }
  | { type: 'select'; selection: Selection }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'dict/set'; kind: DictionaryKind; refs: Ref[] }
  | { type: 'speakers/set'; speakers: Ref[] }
  /** Appends an entry to a dictionary (`speakers` lives in the dialogue document). */
  | { type: 'dict/add'; kind: EntryKind; id: string; name?: string }
  /** Renames an entry and every usage of it; a `name` replaces the display name. */
  | { type: 'dict/rename'; kind: EntryKind; id: string; to: string; name?: string }
  | { type: 'dict/remove'; kind: EntryKind; id: string }
  | { type: 'quest/add'; id?: string; title?: string }
  | { type: 'quest/remove'; quest: string }
  | { type: 'quest/move'; quest: string; to: number }
  | ({ type: 'quest/set'; quest: string } & FieldPatch<Quest>)
  | { type: 'step/add'; quest: string; id?: string; after?: string }
  | { type: 'step/remove'; quest: string; step: string }
  | { type: 'step/move'; quest: string; step: string; to: number }
  | ({ type: 'step/set'; quest: string; step: string } & FieldPatch<Step>)
  | { type: 'step/position'; quest: string; step: string; position: Position }
  | { type: 'step/positions'; quest: string; positions: Record<string, Position> }
  /** Make `to` depend on `from`: `to.<field>` (default `unlock`) gains `step.<from>` in `state` (default done). */
  | {
      type: 'step/link'
      quest: string
      from: string
      to: string
      field?: DependencyField
      state?: DependencyState
    }
  /** Drop every read of `from` from the conditions of `to`. */
  | { type: 'step/unlink'; quest: string; from: string; to: string }
  /** Unlink then link again with a new field and state, as one undo entry. */
  | {
      type: 'step/relink'
      quest: string
      from: string
      to: string
      field: DependencyField
      state: DependencyState
    }
  | ({ type: 'outcome/set'; quest: string; step: string } & FieldPatch<Outcome>)
  | { type: 'reward/add'; quest: string; id?: string }
  | { type: 'reward/remove'; quest: string; reward: string }
  | { type: 'reward/move'; quest: string; reward: string; to: number }
  | ({ type: 'reward/set'; quest: string; reward: string } & FieldPatch<Reward>)
  | { type: 'conversation/add'; id?: string }
  | { type: 'conversation/remove'; conversation: string }
  | { type: 'conversation/move'; conversation: string; to: number }
  | ({ type: 'conversation/set'; conversation: string } & FieldPatch<Conversation>)
  | { type: 'node/add'; conversation: string; id?: string; after?: string }
  | { type: 'node/remove'; conversation: string; node: string }
  | { type: 'node/move'; conversation: string; node: string; to: number }
  | ({ type: 'node/set'; conversation: string; node: string } & FieldPatch<DialogueNode>)
  | { type: 'node/position'; conversation: string; node: string; position: Position }
  | { type: 'node/positions'; conversation: string; positions: Record<string, Position> }
  | { type: 'choice/add'; conversation: string; node: string }
  | { type: 'choice/remove'; conversation: string; node: string; choice: number }
  | { type: 'choice/move'; conversation: string; node: string; choice: number; to: number }
  | ({
      type: 'choice/set'
      conversation: string
      node: string
      choice: number
    } & FieldPatch<Choice>)
  /** Several edits applied in order as one undoable step. */
  | { type: 'batch'; actions: Action[] }

/** Action types that leave the documents untouched, so they never push history. */
const NON_MUTATING = new Set(['select', 'undo', 'redo', 'doc/load', 'doc/reset', 'doc/markSaved'])

export function isMutating(action: Action): boolean {
  return !NON_MUTATING.has(action.type)
}
