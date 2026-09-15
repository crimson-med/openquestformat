/**
 * The playtest session shared by play mode and the graph.
 *
 * The session is a mutable object outside the store, so a version counter is
 * bumped after every action to rerender the readers. A session built from a
 * different quest document than the store holds now is stale and reads as
 * none: any edit, undo or load discards it.
 */
import type { OqfDocument, Payload } from '@oqf/core'
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react'
import { PlaytestSession } from '../lib/playtest'
import { useEditorState } from '../store/context'

export interface PlaytestContextValue {
  session: PlaytestSession | null
  /** Bumped after every action on the session. Read it to rerender on change. */
  version: number
  /** Build a session for the quest and start it. Replaces any running session. */
  start: (quests: OqfDocument, questId: string) => void
  /** Discard the session. */
  stop: () => void
  /** Run an action on the session, then rerender. Does nothing without a session. */
  update: (run: (session: PlaytestSession) => void) => void
  /** Feed an event from elsewhere in the editor, such as a played conversation. */
  feed: (name: string, payload: Payload) => void
}

const PlaytestContext = createContext<PlaytestContextValue | null>(null)

export function PlaytestProvider({ children }: { children: ReactNode }) {
  const state = useEditorState()
  const [held, setHeld] = useState<PlaytestSession | null>(null)
  const [version, setVersion] = useState(0)
  const session = held !== null && held.document === state.quests ? held : null
  const bump = useCallback(() => setVersion((current) => current + 1), [])

  const start = useCallback(
    (quests: OqfDocument, questId: string) => {
      const next = new PlaytestSession(quests, questId)
      next.start()
      setHeld(next)
      bump()
    },
    [bump],
  )

  const stop = useCallback(() => setHeld(null), [])

  const update = useCallback(
    (run: (session: PlaytestSession) => void) => {
      if (session === null) return
      run(session)
      bump()
    },
    [session, bump],
  )

  const feed = useCallback(
    (name: string, payload: Payload) => update((current) => current.emit(name, payload)),
    [update],
  )

  const value = useMemo<PlaytestContextValue>(
    () => ({ session, version, start, stop, update, feed }),
    [session, version, start, stop, update, feed],
  )

  return <PlaytestContext.Provider value={value}>{children}</PlaytestContext.Provider>
}

export function usePlaytest(): PlaytestContextValue {
  const value = useContext(PlaytestContext)
  if (value === null) throw new Error('usePlaytest must be used inside a PlaytestProvider')
  return value
}
