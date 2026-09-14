/**
 * Autosave to local storage.
 *
 * The documents are already plain JSON-safe data, so the saved blob is the
 * model itself rather than a serialized file: reopening the editor lands on the
 * same documents and the same selection, whatever formats they arrived in. The
 * store is injected so this is testable without a browser.
 */
import type { OqfDocument } from '@oqf/core'
import type { DialogueDocument } from '@oqf/dialogue'
import type { Selection } from '../store/types'

export const STORAGE_KEY = 'oqf-editor.state.v1'

/** The slice of `window.localStorage` this module uses. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface PersistedState {
  quests: OqfDocument
  dialogues: DialogueDocument
  selection: Selection
}

export function serializeState(state: PersistedState): string {
  return JSON.stringify({
    version: 1,
    quests: state.quests,
    dialogues: state.dialogues,
    selection: state.selection,
  })
}

function isDocument(value: unknown): value is OqfDocument {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.quests) && typeof record.dictionaries === 'object'
}

function isDialogueDocument(value: unknown): value is DialogueDocument {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.conversations) && Array.isArray(record.speakers)
}

/** Parse a saved blob. Anything unrecognizable is treated as no save at all. */
export function restoreState(text: string | null): PersistedState | undefined {
  if (text === null || text === '') return undefined
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (!isDocument(record.quests) || !isDialogueDocument(record.dialogues)) return undefined
  const selection = record.selection
  return {
    quests: record.quests,
    dialogues: record.dialogues,
    selection:
      selection !== null && typeof selection === 'object' && 'kind' in selection
        ? (selection as Selection)
        : { kind: 'none' },
  }
}

/** Best effort. A full or blocked storage must never break an edit. */
export function saveState(store: KeyValueStore, state: PersistedState): boolean {
  try {
    store.setItem(STORAGE_KEY, serializeState(state))
    return true
  } catch {
    return false
  }
}

export function loadState(store: KeyValueStore): PersistedState | undefined {
  try {
    return restoreState(store.getItem(STORAGE_KEY))
  } catch {
    return undefined
  }
}

export function clearState(store: KeyValueStore): void {
  try {
    store.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do: the next save overwrites whatever is left behind.
  }
}
