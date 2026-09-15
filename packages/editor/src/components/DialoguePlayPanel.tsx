/**
 * Play a conversation in play mode, and the stage both play panels share.
 *
 * The built-in provider runs against a flags map the author toggles by hand,
 * so a gated choice can be tried both ways. Every line, choice and event lands
 * in the transcript. A running quest playtest hears every event too, the way
 * a game's runtime would.
 */
import type { Scalar } from '@oqf/core'
import type { DialogueView } from '@oqf/dialogue'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { type DialoguePlay, flagsResolver, startConversation } from '../lib/dialoguePlay'
import { useEditorState } from '../store/context'
import { activeConversationId, findConversation } from '../store/selectors'
import '../styles/playtest.css'
import { usePlaytest } from './PlaytestContext'

const INTRO =
  'Play this conversation with the built-in provider. Toggle flags to see how choices react.'

/**
 * The stage: speaker, line, then the choices as buttons or Advance for a
 * linear node. Disabled choices stay visible. `onClose` adds a Close button;
 * the quest panel uses it to abandon a talk without ending it.
 */
export function DialogueStage({
  view,
  ended,
  error,
  onChoose,
  onAdvance,
  onClose,
  heading,
}: {
  view: DialogueView | null
  ended: boolean
  error: string | undefined
  onChoose: (index: number) => void
  onAdvance: () => void
  onClose?: () => void
  heading?: ReactNode
}) {
  return (
    <div className="talk-stage">
      {heading === undefined && onClose === undefined ? null : (
        <div className="talk-head">
          {heading}
          {onClose === undefined ? null : (
            <button type="button" className="ghost talk-close" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      )}
      {error === undefined ? null : <span className="field-error">{error}</span>}
      {view === null ? (
        <p className="talk-ended muted">{ended ? 'The conversation ended.' : 'Nothing to show.'}</p>
      ) : (
        <>
          <p className="talk-speaker">{view.speaker ?? 'narrator'}</p>
          <p className="talk-line">{String(view.text)}</p>
          {view.linear ? (
            <button type="button" className="talk-advance" onClick={onAdvance}>
              Advance
            </button>
          ) : (
            <ul className="talk-choices">
              {view.choices.map((choice) => (
                <li key={choice.index}>
                  <button
                    type="button"
                    className="talk-choice"
                    disabled={choice.disabled}
                    onClick={() => onChoose(choice.index)}
                  >
                    {String(choice.text)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

interface Held {
  play: DialoguePlay
  /** The document and conversation the play was built from; a change discards it. */
  document: unknown
  conversation: string
}

export function DialoguePlayPanel() {
  const state = useEditorState()
  const playtest = usePlaytest()
  const conversationId = activeConversationId(state)
  const conversation = findConversation(state, conversationId)
  const [held, setHeld] = useState<Held | null>(null)
  const [version, setVersion] = useState(0)
  const [flags, setFlags] = useState<Record<string, Scalar>>({})
  const [error, setError] = useState<string | undefined>(undefined)
  const flagsRef = useRef(flags)
  flagsRef.current = flags
  const playtestRef = useRef(playtest)
  playtestRef.current = playtest

  const play =
    held !== null && held.document === state.dialogues && held.conversation === conversationId
      ? held.play
      : null
  // The play mutates in place; bumping the version rerenders and reads it again.
  const view = play === null ? null : play.current()
  const bump = () => setVersion((current) => current + 1)

  const start = () => {
    if (conversationId === undefined) return
    setError(undefined)
    try {
      const next = startConversation(state.dialogues, conversationId, {
        resolve: flagsResolver(() => flagsRef.current),
        emit: (event) => playtestRef.current.feed(event.name, event.payload),
      })
      setHeld({ play: next, document: state.dialogues, conversation: conversationId })
    } catch (failure) {
      setHeld(null)
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const act = (run: (current: DialoguePlay) => void) => {
    if (play === null) return
    run(play)
    bump()
  }

  const submitFlag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem('flag')
    if (!(input instanceof HTMLInputElement)) return
    const name = input.value.trim()
    if (name === '') return
    setFlags((current) => ({ ...current, [name]: true }))
    input.value = ''
    bump()
  }

  const flagNames = Object.keys(flags).sort()
  const [flagsOpen, setFlagsOpen] = useState(true)
  const transcript = useRef<HTMLElement | null>(null)
  const entries = play === null ? [] : play.transcript
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new entry scrolls the transcript
  useEffect(() => {
    const column = transcript.current
    if (column !== null) column.scrollTop = column.scrollHeight
  }, [entries.length, version])

  if (conversation === undefined) {
    return (
      <div className="quest-play dialogue-play">
        <p className="note">No conversation to play.</p>
      </div>
    )
  }

  const title = conversation.title === undefined ? conversation.id : String(conversation.title)

  if (play === null) {
    return (
      <div className="quest-play dialogue-play">
        <section className="play-intro">
          <h3>{title}</h3>
          <p>{INTRO}</p>
          <button type="button" className="primary" onClick={start}>
            Start
          </button>
          {error === undefined ? null : <span className="field-error">{error}</span>}
        </section>
      </div>
    )
  }

  return (
    <div className="quest-play dialogue-play">
      <header className="play-status">
        <span className="play-target mono">{conversation.id}</span>
        <span className={`status-pill ${play.ended ? 'closed' : 'open'}`}>
          {play.ended ? 'ended' : 'talking'}
        </span>
        <div className="play-controls">
          <button type="button" onClick={start}>
            Restart
          </button>
        </div>
      </header>

      <section className="play-section">
        <h4>Stage</h4>
        <DialogueStage
          view={view}
          ended={play.ended}
          error={play.error}
          onChoose={(index) => act((current) => current.choose(index))}
          onAdvance={() => act((current) => current.advance())}
        />
      </section>

      <details
        className="play-section play-world"
        open={flagsOpen}
        onToggle={(event) => setFlagsOpen(event.currentTarget.open)}
      >
        <summary>Flags ({flagNames.length})</summary>
        {flagNames.length === 0 ? (
          <p className="note">No flags yet. Add the ones your choices are gated on.</p>
        ) : (
          <table className="world-table">
            <tbody>
              {flagNames.map((name) => (
                <tr key={name}>
                  <td className="mono">{name}</td>
                  <td>
                    <label className="world-toggle">
                      <input
                        type="checkbox"
                        checked={flags[name] === true}
                        onChange={(event) => {
                          setFlags((current) => ({ ...current, [name]: event.target.checked }))
                          bump()
                        }}
                      />
                      {flags[name] === true ? 'on' : 'off'}
                    </label>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost world-remove"
                      aria-label={`Remove flag ${name}`}
                      onClick={() => {
                        setFlags((current) => {
                          const { [name]: _gone, ...rest } = current
                          return rest
                        })
                        bump()
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form className="add-form" onSubmit={submitFlag}>
          <input className="input mono" name="flag" placeholder="otter_agreed" />
          <button type="submit">Add</button>
        </form>
      </details>

      <section className="play-section play-timeline" ref={transcript}>
        <h4>Transcript</h4>
        {entries.length === 0 ? (
          <p className="note">Lines, choices and events show up here.</p>
        ) : (
          <ul className="tl-effects dialogue-transcript">
            {entries.map((entry, index) => (
              <li key={`${entry.kind}-${index}`} className={`tl-effect ${entry.kind}`}>
                <span className="tl-label">{entry.kind}</span>
                <span className={entry.kind === 'event' ? 'mono' : 'tl-text'}>{entry.text}</span>
                {entry.detail === undefined ? null : (
                  <span className="muted mono">{entry.detail}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
