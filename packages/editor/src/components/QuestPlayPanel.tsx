/**
 * Play the focused quest through the runtime without leaving the editor.
 *
 * One column, top to bottom: where the quest stands, the conversation being
 * talked through (when one is), what can move it now (Next), the rest of the
 * events and the world the conditions read behind disclosures, and the
 * Timeline of every input with what the runtime did under it. The graph shows
 * the same state on every step card.
 *
 * A step bound to a conversation offers Talk: the built-in provider runs with
 * its resolver wired to the runtime and every event it emits fed to the
 * session, so ending the conversation completes the talk objective the way a
 * game would. The synthetic End buttons stay for skipping the talk.
 */
import type { Payload, StepState } from '@oqf/core'
import type { Conversation } from '@oqf/dialogue'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { type DialoguePlay, startConversation } from '../lib/dialoguePlay'
import {
  type EventSuggestion,
  type NextEventGroup,
  ROLE_GLYPHS,
  type TranscriptCard,
  boundConversation,
  formatPayload,
  groupTranscript,
  labelChoices,
  lastOutcome,
  nextEvents,
  objectiveCount,
  parsePayload,
  parseScalar,
  readsWorld,
  suggestEvents,
} from '../lib/playtest'
import { useDispatch, useEditorState } from '../store/context'
import { activeQuestId, findQuest } from '../store/selectors'
import '../styles/playtest.css'
import { DialogueStage } from './DialoguePlayPanel'
import { usePlaytest } from './PlaytestContext'

const INTRO =
  'Run this quest through the runtime. Fire events, watch the steps change on the graph.'

function field(event: FormEvent<HTMLFormElement>, name: string): HTMLInputElement | undefined {
  const input = event.currentTarget.elements.namedItem(name)
  return input instanceof HTMLInputElement ? input : undefined
}

function StateChip({ state, text }: { state: StepState; text?: string }) {
  return <span className={`state-chip ${state}`}>{text ?? state}</span>
}

/** The conversation a Next card can talk through, and how to open it. */
interface TalkOffer {
  conversation: Conversation
  open: (conversation: Conversation) => void
  /** True while another conversation is on the stage. */
  busy: boolean
}

function EventButtons({
  group,
  fire,
  disabled,
  talk,
}: {
  group: NextEventGroup
  fire: (name: string, payload: Payload) => void
  disabled: boolean
  talk?: TalkOffer
}) {
  const key = (event: EventSuggestion) => `${event.fail ? 'fail' : 'do'}-${event.label}`
  return (
    <div className="next-buttons">
      {talk === undefined ? null : (
        <button
          type="button"
          className="next-event next-talk"
          disabled={disabled || group.waiting || talk.busy}
          title={`Play ${talk.conversation.id} through the built-in provider`}
          onClick={() => talk.open(talk.conversation)}
        >
          Talk
        </button>
      )}
      {group.events.map((event) => (
        <button
          key={key(event)}
          type="button"
          className={event.fail ? 'next-event fail' : 'next-event'}
          disabled={disabled || (group.waiting && !event.fail)}
          title={`${event.name} ${formatPayload(event.payload)}`.trim()}
          onClick={() => fire(event.name, event.payload)}
        >
          {event.fail ? <span className="fail-chip">fail</span> : null}
          {event.label}
        </button>
      ))}
    </div>
  )
}

function NextGroup({
  group,
  fire,
  disabled,
  compact,
  talk,
}: {
  group: NextEventGroup
  fire: (name: string, payload: Payload) => void
  disabled: boolean
  compact?: boolean
  talk?: TalkOffer
}) {
  return (
    <li className={`next-group ${group.state}`}>
      <div className="next-head">
        <span className={`role-glyph ${group.role}`} aria-hidden="true">
          {ROLE_GLYPHS[group.role]}
        </span>
        <span className="next-title">{group.stepTitle}</span>
        {group.waiting ? <StateChip state="available" text="waiting on activate" /> : null}
        {compact === true ? <StateChip state={group.state} /> : null}
      </div>
      {group.objective === '' ? null : <div className="next-objective mono">{group.objective}</div>}
      <EventButtons group={group} fire={fire} disabled={disabled} talk={talk} />
    </li>
  )
}

/** One line per effect. A step transition carries the step title as its tooltip. */
function Effect({
  effect,
  titles,
}: {
  effect: TranscriptCard['effects'][number]
  titles: ReadonlyMap<string, string>
}) {
  switch (effect.kind) {
    case 'offered':
      return (
        <li className="tl-effect offered">
          <span className="tl-label">offered</span>
          <span className="mono">{effect.quest}</span>
        </li>
      )
    case 'step':
      return (
        <li className="tl-effect step" title={titles.get(effect.step)}>
          <span className="mono">{effect.step}</span>
          <span className="tl-from mono">{effect.from}</span>
          <StateChip state={effect.to} />
        </li>
      )
    case 'reward':
      return (
        <li className="tl-effect reward">
          <span className="tl-label">reward</span>
          <span className="mono">{effect.grant.reward}</span>
          <span className="muted mono">
            {effect.grant.kind} {effect.grant.ref} {effect.grant.amount}
          </span>
        </li>
      )
    case 'outcome':
      return (
        <li className="tl-effect outcome">
          <span className="tl-label">outcome</span>
          <strong>{effect.name}</strong>
          {effect.failed ? <span className="fail-chip">failed</span> : null}
        </li>
      )
    case 'flag':
      return (
        <li className="tl-effect flag">
          <span className="tl-label">flag</span>
          <span className="mono">
            {effect.flag}={String(effect.value)}
          </span>
        </li>
      )
    case 'event':
      return (
        <li className="tl-effect event">
          <span className="tl-label">event</span>
          <span className="mono">{effect.name}</span>
          <span className="muted mono">{formatPayload(effect.payload)}</span>
        </li>
      )
  }
}

export function QuestPlayPanel() {
  const state = useEditorState()
  const dispatch = useDispatch()
  const playtest = usePlaytest()
  const questId = activeQuestId(state)
  const quest = findQuest(state, questId)
  const session = playtest.session
  const running = session !== null && session.questId === questId
  // The session mutates in place; its version says when to read it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version drives the reread
  const snapshot = useMemo(
    () => (running ? session.snapshot() : undefined),
    [session, running, playtest.version],
  )
  const transcript = running ? session.transcript : []
  const suggestions = useMemo(() => (quest === undefined ? [] : suggestEvents(quest)), [quest])
  const split = useMemo(
    () => (quest === undefined ? { now: [], later: [] } : nextEvents(quest, snapshot, suggestions)),
    [quest, snapshot, suggestions],
  )
  const titles = useMemo(
    () => new Map(quest?.steps.map((step) => [step.id, String(step.title)]) ?? []),
    [quest],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: version drives the reread
  const cards = useMemo(
    () => labelChoices(groupTranscript(transcript), state.dialogues),
    [transcript, state.dialogues, playtest.version],
  )
  const outcome = questId === undefined ? undefined : lastOutcome(transcript, questId)

  // The conversation on the stage. It mutates in place; its version says when to read it again.
  const [talk, setTalk] = useState<DialoguePlay | null>(null)
  const [talkVersion, setTalkVersion] = useState(0)
  const [talkError, setTalkError] = useState<string | undefined>(undefined)
  // biome-ignore lint/correctness/useExhaustiveDependencies: version drives the reread
  const talkView = useMemo(() => (talk === null ? null : talk.current()), [talk, talkVersion])
  useEffect(() => {
    if (!running) setTalk(null)
  }, [running])
  const closeTalk = () => {
    setTalk(null)
    setTalkError(undefined)
  }
  const openTalk = (conversation: Conversation) => {
    if (session === null) return
    setTalkError(undefined)
    try {
      setTalk(
        startConversation(state.dialogues, conversation.id, {
          resolve: (path) => session.engine.resolve(path),
          emit: (event) => playtest.feed(event.name, event.payload),
        }),
      )
    } catch (failure) {
      setTalk(null)
      setTalkError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  const talkAct = (run: (current: DialoguePlay) => void) => {
    if (talk === null) return
    run(talk)
    setTalkVersion((current) => current + 1)
  }
  const talkOffer = (stepId: string): TalkOffer | undefined => {
    const step = quest?.steps.find((entry) => entry.id === stepId)
    if (step === undefined) return undefined
    const conversation = boundConversation(step, state.dialogues)
    if (conversation === undefined) return undefined
    return { conversation, open: openTalk, busy: talk !== null }
  }

  const flagNames = Object.keys(snapshot?.flags ?? {}).sort()
  const varNames = Object.keys(snapshot?.vars ?? {}).sort()
  const world = useMemo(
    () => (quest === undefined ? { flags: false, vars: false } : readsWorld(quest)),
    [quest],
  )
  // World opens on its own when the conditions read it or something is set; the author may close it.
  const worldWanted = world.flags || world.vars || flagNames.length > 0 || varNames.length > 0
  const [worldOpen, setWorldOpen] = useState(worldWanted)
  useEffect(() => {
    if (worldWanted) setWorldOpen(true)
  }, [worldWanted])

  const timeline = useRef<HTMLElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new card scrolls the timeline
  useEffect(() => {
    const column = timeline.current
    if (column !== null) column.scrollTop = column.scrollHeight
  }, [cards.length])

  const open = snapshot?.status === 'open'

  const start = () => {
    if (questId === undefined) return
    closeTalk()
    if (running) playtest.update((current) => current.start())
    else playtest.start(state.quests, questId)
  }

  const fire = (name: string, payload: Payload) =>
    playtest.update((current) => current.emit(name, payload))

  const submitEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = field(event, 'name')
    const payload = field(event, 'payload')
    if (name === undefined || name.value.trim() === '') return
    fire(name.value.trim(), parsePayload(payload?.value ?? ''))
  }

  const submitFlag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = field(event, 'flag')
    if (input === undefined || input.value.trim() === '') return
    playtest.update((current) => current.setFlag(input.value.trim(), true))
    input.value = ''
  }

  const submitVar = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = field(event, 'name')
    const value = field(event, 'value')
    if (name === undefined || name.value.trim() === '') return
    playtest.update((current) => current.setVar(name.value.trim(), parseScalar(value?.value ?? '')))
    name.value = ''
    if (value !== undefined) value.value = ''
  }

  if (quest === undefined) {
    return (
      <div className="quest-play">
        <p className="note">No quest to play.</p>
      </div>
    )
  }

  if (!running || snapshot === undefined) {
    return (
      <div className="quest-play">
        <section className="play-intro">
          <h3>{String(quest.title)}</h3>
          <p>{INTRO}</p>
          <button type="button" className="primary" onClick={start}>
            Start
          </button>
        </section>
      </div>
    )
  }

  const passes = snapshot.passes
  const acceptLabel = quest.repeat === true || passes > 0 ? 'Accept again' : 'Accept'
  const canAccept = snapshot.status !== 'closed' || quest.repeat === true

  return (
    <div className="quest-play">
      <header className="play-status">
        <span className={`status-pill ${snapshot.status}`}>{snapshot.status}</span>
        {snapshot.outcome === null ? null : (
          <span className="play-stat">
            outcome <strong>{snapshot.outcome}</strong>
          </span>
        )}
        <span className="play-stat">
          passes <strong>{passes}</strong>
        </span>
        <span className="play-stat">
          rewards <strong>{snapshot.rewards.length}</strong>
        </span>
        <div className="play-controls">
          <button type="button" onClick={start}>
            Restart
          </button>
          <button
            type="button"
            onClick={() => {
              closeTalk()
              playtest.update((current) => current.reset())
            }}
          >
            Reset
          </button>
        </div>
        {snapshot.error === undefined ? null : (
          <span className="field-error">{snapshot.error}</span>
        )}
      </header>

      {talkError === undefined ? null : <span className="field-error">{talkError}</span>}

      {talk === null ? null : (
        <section className="play-section play-talk">
          <h4>
            Talking <span className="mono">{talk.conversation}</span>
          </h4>
          <DialogueStage
            view={talkView}
            ended={talk.ended}
            error={talk.error}
            onChoose={(index) => talkAct((current) => current.choose(index))}
            onAdvance={() => talkAct((current) => current.advance())}
            onClose={closeTalk}
          />
        </section>
      )}

      {open ? (
        <section className="play-section">
          <h4>Next</h4>
          {split.now.length === 0 ? (
            <p className="note">No step is active. Unlock one with a flag or a variable.</p>
          ) : (
            <ul className="next-groups">
              {split.now.map((group) => (
                <NextGroup
                  key={group.step}
                  group={group}
                  fire={fire}
                  disabled={false}
                  talk={talkOffer(group.step)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="play-intro play-closed">
          <p>
            {outcome !== undefined ? (
              <>
                {outcome.failed ? 'Failed outcome' : 'Outcome'} <strong>{outcome.name}</strong>{' '}
                reached
              </>
            ) : snapshot.status === 'offered' ? (
              'The quest is offered and waits to be accepted.'
            ) : (
              'The quest is unseen. Accept to offer and open it.'
            )}
          </p>
          <div className="play-intro-actions">
            <button type="button" className="primary" onClick={start}>
              Restart
            </button>
            {canAccept ? (
              <button type="button" onClick={() => playtest.update((current) => current.accept())}>
                {acceptLabel}
              </button>
            ) : null}
          </div>
        </section>
      )}

      <details className="play-section play-other">
        <summary>Other events ({split.later.length})</summary>
        {split.later.length === 0 ? null : (
          <ul className="next-groups">
            {split.later.map((group) => (
              <NextGroup key={group.step} group={group} fire={fire} disabled={!open} compact />
            ))}
          </ul>
        )}
        <form className="event-form" onSubmit={submitEvent}>
          <input className="input mono" name="name" placeholder="item.collected" />
          <input className="input mono" name="payload" placeholder="item=fish.rare;amount=1" />
          <button type="submit">Emit</button>
        </form>
      </details>

      <details
        className="play-section play-world"
        open={worldOpen}
        onToggle={(event) => setWorldOpen(event.currentTarget.open)}
      >
        <summary>World</summary>
        <h5>Flags</h5>
        {flagNames.length === 0 ? null : (
          <table className="world-table">
            <tbody>
              {flagNames.map((name) => {
                const value = snapshot.flags[name]
                return (
                  <tr key={name}>
                    <td className="mono">{name}</td>
                    <td>
                      <label className="world-toggle">
                        <input
                          type="checkbox"
                          checked={value === true || (value !== false && value !== undefined)}
                          onChange={(event) =>
                            playtest.update((current) =>
                              current.setFlag(name, event.target.checked),
                            )
                          }
                        />
                        {typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value)}
                      </label>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ghost world-remove"
                        aria-label={`Remove flag ${name}`}
                        onClick={() => playtest.update((current) => current.removeFlag(name))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <form className="add-form" onSubmit={submitFlag}>
          <input className="input mono" name="flag" placeholder="otter_agreed" />
          <button type="submit">Add</button>
        </form>

        <h5>Variables</h5>
        {varNames.length === 0 ? null : (
          <table className="world-table">
            <tbody>
              {varNames.map((name) => {
                const value = snapshot.vars[name] ?? ''
                return (
                  <tr key={name}>
                    <td className="mono">{name}</td>
                    <td>
                      <input
                        key={String(value)}
                        className="input mono"
                        defaultValue={String(value)}
                        aria-label={`Value of ${name}`}
                        onBlur={(event) => {
                          const next = parseScalar(event.target.value.trim())
                          if (next !== value) {
                            playtest.update((current) => current.setVar(name, next))
                          }
                        }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ghost world-remove"
                        aria-label={`Remove variable ${name}`}
                        onClick={() => playtest.update((current) => current.removeVar(name))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <form className="add-form" onSubmit={submitVar}>
          <input className="input mono" name="name" placeholder="time.isNight" />
          <input className="input mono" name="value" placeholder="true" />
          <button type="submit">Add</button>
        </form>
      </details>

      <section className="play-section play-timeline" ref={timeline}>
        <h4>Timeline</h4>
        <div className="step-chips">
          {snapshot.steps
            .filter((step) => step.state !== 'locked')
            .map((step) => {
              const threshold = objectiveCount(quest.steps.find((entry) => entry.id === step.id))
              return (
                <button
                  key={step.id}
                  type="button"
                  className={`step-chip ${step.state}`}
                  title={`${step.title} (${step.state})`}
                  onClick={() =>
                    dispatch({
                      type: 'select',
                      selection: { kind: 'step', quest: snapshot.quest, step: step.id },
                    })
                  }
                >
                  <span className="mono">{step.id}</span>
                  {threshold === undefined ? null : (
                    <span className="step-chip-count mono">
                      {step.count}/{threshold}
                    </span>
                  )}
                </button>
              )
            })}
        </div>
        {cards.length === 0 ? (
          <p className="note">What the runtime does with each event shows up here.</p>
        ) : (
          <ol className="timeline">
            {cards.map((card, index) => (
              <li key={`${card.title}-${index}`} className="tl-card">
                <div className="tl-head">
                  <span className="tl-name mono">{card.title}</span>
                  {card.input === null ? null : (
                    <span className="tl-payload muted mono">
                      {formatPayload(card.input.payload)}
                    </span>
                  )}
                  {card.label === undefined ? null : (
                    <span className="tl-choice" title={card.label}>
                      {card.label}
                    </span>
                  )}
                </div>
                {card.effects.length === 0 ? (
                  <p className="tl-none muted">nothing changed</p>
                ) : (
                  <ul className="tl-effects">
                    {card.effects.map((effect, position) => (
                      <Effect key={`${effect.kind}-${position}`} effect={effect} titles={titles} />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
