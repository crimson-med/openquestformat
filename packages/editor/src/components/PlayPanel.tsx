/**
 * Play a conversation without leaving the editor.
 *
 * The built-in provider runs against a flags map you can toggle by hand, so a
 * gated choice can be tried both ways, and every event it emits lands in the
 * transcript. This is the same bridge a game implements, so what you see here
 * is what the runtime will see.
 */
import type { Scalar } from '@oqf/core'
import {
  type DialogueEvent,
  type DialogueSession,
  type DialogueView,
  OqfDialogueProvider,
} from '@oqf/dialogue'
import { useCallback, useRef, useState } from 'react'
import { useEditorState } from '../store/context'
import { usePlaytest } from './PlaytestContext'

interface TranscriptEntry {
  kind: 'line' | 'choice' | 'event'
  text: string
  detail?: string
}

function payloadText(payload: Record<string, Scalar> | undefined): string | undefined {
  if (payload === undefined) return undefined
  const entries = Object.entries(payload)
  if (entries.length === 0) return undefined
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(' ')
}

export function PlayPanel({ conversation }: { conversation: string | undefined }) {
  const state = useEditorState()
  const session = useRef<DialogueSession | null>(null)
  const [view, setView] = useState<DialogueView | null>(null)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | undefined>(undefined)
  const flagsRef = useRef(flags)
  flagsRef.current = flags
  /** A running quest playtest hears every event this conversation emits. */
  const playtest = usePlaytest()
  const playtestRef = useRef(playtest)
  playtestRef.current = playtest

  const push = useCallback((entry: TranscriptEntry) => {
    setTranscript((current) => [...current, entry])
  }, [])

  const refresh = useCallback(() => {
    const current = session.current
    setView(current === null ? null : current.current())
  }, [])

  const start = useCallback(() => {
    if (conversation === undefined) return
    setTranscript([])
    setError(undefined)
    try {
      const provider = new OqfDialogueProvider([state.dialogues])
      const taken = new Set<string>()
      const next = provider.start(conversation, {
        resolve: (path: string) => {
          const key = path.startsWith('flag.') ? path.slice(5) : path
          return flagsRef.current[key] ?? false
        },
        emit: (event: DialogueEvent) => {
          push({ kind: 'event', text: event.name, detail: payloadText(event.payload) })
          playtestRef.current.feed(event.name, event.payload ?? {})
        },
        once: {
          has: (key: string) => taken.has(key),
          add: (key: string) => {
            taken.add(key)
          },
        },
      })
      session.current = next
      const first = next.current()
      if (first !== null) push({ kind: 'line', text: String(first.text), detail: first.speaker })
      setView(first)
    } catch (failure) {
      session.current = null
      setView(null)
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [conversation, state.dialogues, push])

  const step = useCallback(
    (run: (current: DialogueSession) => void) => {
      const current = session.current
      if (current === null) return
      try {
        run(current)
        const next = current.current()
        if (next !== null) push({ kind: 'line', text: String(next.text), detail: next.speaker })
        setView(next)
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
        refresh()
      }
    },
    [push, refresh],
  )

  const flagNames = Object.keys(flags).sort()

  return (
    <div className="play">
      <div className="play-stage">
        <div className="play-actions">
          <button type="button" onClick={start} disabled={conversation === undefined}>
            {session.current === null ? 'Start' : 'Restart'}
          </button>
          <span className="play-target mono">{conversation ?? 'no conversation'}</span>
        </div>
        {error !== undefined ? <p className="field-error">{error}</p> : null}
        {view === null ? (
          <p className="note">
            {session.current === null
              ? 'Press start to run this conversation through the built-in provider.'
              : 'The conversation ended.'}
          </p>
        ) : (
          <div className="play-view">
            <p className="play-speaker">{view.speaker ?? 'narrator'}</p>
            <p className="play-line">{String(view.text)}</p>
            {view.choices.length === 0 ? (
              <button type="button" onClick={() => step((current) => current.advance())}>
                Continue
              </button>
            ) : (
              <ul className="play-choices">
                {view.choices.map((choice) => (
                  <li key={choice.index}>
                    <button
                      type="button"
                      disabled={choice.disabled}
                      onClick={() =>
                        step((current) => {
                          push({ kind: 'choice', text: String(choice.text) })
                          current.choose(choice.index)
                        })
                      }
                    >
                      {String(choice.text)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="play-flags">
        <h4>Flags</h4>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const input = event.currentTarget.elements.namedItem('flag')
            if (!(input instanceof HTMLInputElement)) return
            const name = input.value.trim()
            if (name === '') return
            setFlags((current) => ({ ...current, [name]: true }))
            input.value = ''
          }}
        >
          <input className="input mono" name="flag" placeholder="otter_agreed" />
          <button type="submit">Add</button>
        </form>
        {flagNames.length === 0 ? (
          <p className="note">No flags yet. Add the ones your choices are gated on.</p>
        ) : (
          <ul className="flag-list">
            {flagNames.map((name) => (
              <li key={name}>
                <label>
                  <input
                    type="checkbox"
                    checked={flags[name]}
                    onChange={(event) =>
                      setFlags((current) => ({ ...current, [name]: event.target.checked }))
                    }
                  />
                  <span className="mono">{name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="play-transcript">
        <h4>Transcript</h4>
        {transcript.length === 0 ? (
          <p className="note">Events the conversation emits show up here.</p>
        ) : (
          <ol>
            {transcript.map((entry, index) => (
              <li key={`${entry.kind}-${index}`} className={entry.kind}>
                <span className="kind">{entry.kind}</span>
                <span className="text">{entry.text}</span>
                {entry.detail === undefined ? null : (
                  <span className="detail mono">{entry.detail}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
