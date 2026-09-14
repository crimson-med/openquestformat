/**
 * The editor state: two documents, what is selected, and the findings derived
 * from them. Everything here is plain data so the reducer stays testable in
 * node without a DOM.
 */
import type { OqfDocument } from '@oqf/core'
import type { DialogueDocument } from '@oqf/dialogue'
import type { EditorFinding } from './findings'

/** What the inspector is pointed at. */
export type Selection =
  | { kind: 'none' }
  | { kind: 'quest'; quest: string }
  | { kind: 'step'; quest: string; step: string }
  | { kind: 'reward'; quest: string; reward: string }
  | { kind: 'conversation'; conversation: string }
  | { kind: 'node'; conversation: string; node: string }
  | { kind: 'choice'; conversation: string; node: string; choice: number }

export const NO_SELECTION: Selection = { kind: 'none' }

/** The part of the state undo and redo move through. */
export interface EditorDocument {
  quests: OqfDocument
  dialogues: DialogueDocument
  selection: Selection
  dirty: boolean
}

export interface EditorState extends EditorDocument {
  /** Recomputed from both documents on every change. */
  findings: EditorFinding[]
  past: EditorDocument[]
  future: EditorDocument[]
}

/** How many documents the undo stack keeps. */
export const HISTORY_LIMIT = 50
