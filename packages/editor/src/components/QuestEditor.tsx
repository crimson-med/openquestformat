/**
 * The editor as one component.
 *
 * Mounted full screen by `main.tsx`, and usable from another app the same way:
 * hand it documents, get changes back. Autosave is on unless documents are
 * passed in, since a host that owns the documents should own persistence too.
 */
import type { OqfDocument } from '@oqf/core'
import type { DialogueDocument } from '@oqf/dialogue'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useRef } from 'react'
import { type KeyValueStore, loadState, saveState } from '../lib/persist'
import { readStrict } from '../lib/strict'
import { StoreProvider, useEditorState } from '../store/context'
import { createState } from '../store/reducer'
import type { EditorState, Selection } from '../store/types'
import { App } from './App'

export interface QuestEditorProps {
  initialQuests?: OqfDocument
  initialDialogues?: DialogueDocument
  onChange?: (documents: { quests: OqfDocument; dialogues: DialogueDocument }) => void
  /** Autosave to local storage. Defaults to true when no documents are passed in. */
  persist?: boolean
  /** Override where autosave writes. Defaults to `window.localStorage`. */
  storage?: KeyValueStore
}

function browserStorage(): KeyValueStore | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/** Reports changes upward and writes the autosave. */
function Sync({
  onChange,
  storage,
}: {
  onChange?: QuestEditorProps['onChange']
  storage?: KeyValueStore
}) {
  const state = useEditorState()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (onChange !== undefined) onChange({ quests: state.quests, dialogues: state.dialogues })
    if (storage !== undefined) {
      saveState(storage, {
        quests: state.quests,
        dialogues: state.dialogues,
        selection: state.selection,
      })
    }
  }, [state.quests, state.dialogues, state.selection, onChange, storage])
  return null
}

export function QuestEditor({
  initialQuests,
  initialDialogues,
  onChange,
  persist,
  storage,
}: QuestEditorProps) {
  const given = initialQuests !== undefined || initialDialogues !== undefined
  const shouldPersist = persist ?? !given
  const store = useMemo<KeyValueStore | undefined>(
    () => (shouldPersist ? (storage ?? browserStorage()) : undefined),
    [shouldPersist, storage],
  )

  const initial = useMemo<EditorState>(() => {
    // Strict is a viewer preference, remembered whether or not the documents are.
    const strict = readStrict(storage ?? browserStorage())
    if (given) return createState(initialQuests, initialDialogues, undefined, strict)
    const restored = store === undefined ? undefined : loadState(store)
    if (restored === undefined) return createState(undefined, undefined, undefined, strict)
    return createState(restored.quests, restored.dialogues, restored.selection as Selection, strict)
    // The initial document is read once. Later changes flow through the reducer.
  }, [given, initialQuests, initialDialogues, store, storage])

  return (
    <StoreProvider initial={initial}>
      <Sync onChange={onChange} storage={store} />
      <App />
    </StoreProvider>
  )
}
