/**
 * Play the focused quest through the runtime without leaving the editor.
 *
 * Every objective becomes a button that fires the event it listens for, and
 * anything else can be typed in by hand. Flags and game variables are the
 * world the conditions read. The transcript is what the runtime answered, and
 * the graph shows the same state on every step card.
 */
import type { Payload } from '@oqf/core'
import { type FormEvent, useMemo } from 'react'
import {
  type EventSuggestion,
  type TranscriptEntry,
  formatPayload,
  parsePayload,
  parseScalar,
  suggestEvents,
} from '../lib/playtest'
import { useEditorState } from '../store/context'
import { activeQuestId, findQuest } from '../store/selectors'
import '../styles/playtest.css'
import { usePlaytest } from './PlaytestContext'

function field(event: FormEvent<HTMLFormElement>, name: string): HTMLInputElement | undefined {
  const input = event.currentTarget.elements.namedItem(name)
  return input instanceof HTMLInputElement ? input : undefined
}

function describe(entry: TranscriptEntry): { kind: string; text: string; detail?: string } {
  switch (entry.kind) {
    case 'input':
      return { kind: 'you', text: entry.name, detail: formatPayload(entry.payload) }
    case 'offered':
      return { kind: 'offered', text: entry.quest }
    case 'step':
      return { kind: 'step', text: entry.step, detail: `${entry.from} to ${entry.to}` }
    case 'reward':
      return {
        kind: 'reward',
        text: entry.grant.reward,
        detail: `${entry.grant.kind} ${entry.grant.ref} x${entry.grant.amount}`,
      }
    case 'outcome':
      return { kind: 'outcome', text: entry.name, detail: entry.failed ? 'failed' : undefined }
    case 'flag':
      return { kind: 'flag', text: `${entry.flag}=${String(entry.value)}` }
    case 'event':
      return { kind: 'event', text: entry.name, detail: formatPayload(entry.payload) }
  }
}

export function QuestPlayPanel() {
  const state = useEditorState()
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
  const groups = useMemo(() => {
    const byStep = new Map<string, EventSuggestion[]>()
    for (const suggestion of suggestions) {
      const list = byStep.get(suggestion.step) ?? []
      list.push(suggestion)
      byStep.set(suggestion.step, list)
    }
    return [...byStep.entries()]
  }, [suggestions])

  const open = snapshot?.status === 'open'

  const start = () => {
    if (questId === undefined) return
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

  const flagNames = Object.keys(snapshot?.flags ?? {}).sort()
  const varNames = Object.keys(snapshot?.vars ?? {}).sort()

  return (
    <div className="quest-play">
      <section className="quest-play-drive">
        <div className="play-actions">
          <button type="button" onClick={start} disabled={quest === undefined}>
            {running ? 'Restart' : 'Start'}
          </button>
          {snapshot !== undefined && snapshot.status !== 'open' ? (
            <button type="button" onClick={() => playtest.update((current) => current.accept())}>
              Accept
            </button>
          ) : null}
          <button
            type="button"
            className="ghost"
            disabled={!running}
            onClick={() => playtest.update((current) => current.reset())}
          >
            Reset
          </button>
          <button type="button" className="ghost" disabled={!running} onClick={playtest.stop}>
            Stop
          </button>
          <span className="play-target mono">{questId ?? 'no quest'}</span>
        </div>
        {snapshot === undefined ? (
          <p className="note">Press start to offer and accept this quest in a fresh runtime.</p>
        ) : (
          <p className="quest-play-status">
            <span className={`status-tag ${snapshot.status}`}>{snapshot.status}</span>
            <span>
              outcome <strong>{snapshot.outcome ?? 'none'}</strong>
            </span>
            <span>
              passes <strong>{snapshot.passes}</strong>
            </span>
            <span>
              rewards <strong>{snapshot.rewards.length}</strong>
            </span>
          </p>
        )}
        {snapshot?.error !== undefined ? <p className="field-error">{snapshot.error}</p> : null}

        <h4>Suggested events</h4>
        {groups.length === 0 ? (
          <p className="note">No step has an objective to fire an event for.</p>
        ) : (
          <ul className="suggestion-groups">
            {groups.map(([stepId, list]) => (
              <li
                key={stepId}
                className={
                  snapshot === undefined
                    ? ''
                    : `run-${snapshot.steps.find((step) => step.id === stepId)?.state ?? 'locked'}`
                }
              >
                <div className="suggestion-step">
                  <span className="mono">{stepId}</span>
                  <span className="muted">{list[0].stepTitle}</span>
                </div>
                <div className="suggestion-buttons">
                  {list.map((suggestion) => (
                    <button
                      key={`${suggestion.fail ? 'fail' : 'do'}-${suggestion.label}`}
                      type="button"
                      className={suggestion.fail ? 'suggestion fail' : 'suggestion'}
                      disabled={!open}
                      title={`${suggestion.name} ${formatPayload(suggestion.payload)}`.trim()}
                      onClick={() => fire(suggestion.name, suggestion.payload)}
                    >
                      {suggestion.fail ? <span className="suggestion-fail">fail</span> : null}
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        <h4>Any event</h4>
        <form className="event-form" onSubmit={submitEvent}>
          <input className="input mono" name="name" placeholder="item.collected" />
          <input className="input mono" name="payload" placeholder="item=fish.rare;amount=1" />
          <button type="submit" disabled={!running}>
            Emit
          </button>
        </form>
      </section>

      <section className="quest-play-world">
        <h4>Flags</h4>
        <form className="add-form" onSubmit={submitFlag}>
          <input className="input mono" name="flag" placeholder="otter_agreed" />
          <button type="submit" disabled={!running}>
            Add
          </button>
        </form>
        {flagNames.length === 0 ? (
          <p className="note">Flags set here reach the runtime as flag.set events.</p>
        ) : (
          <ul className="flag-list">
            {flagNames.map((name) => {
              const value = snapshot?.flags[name]
              return (
                <li key={name}>
                  <label>
                    <input
                      type="checkbox"
                      checked={value === true || (value !== false && value !== undefined)}
                      onChange={(event) =>
                        playtest.update((current) => current.setFlag(name, event.target.checked))
                      }
                    />
                    <span className="mono">{name}</span>
                    {typeof value === 'boolean' ? null : (
                      <span className="muted mono">{String(value)}</span>
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        )}

        <h4>Game variables</h4>
        <form className="add-form" onSubmit={submitVar}>
          <input className="input mono" name="name" placeholder="time.isNight" />
          <input className="input mono" name="value" placeholder="true" />
          <button type="submit" disabled={!running}>
            Add
          </button>
        </form>
        {varNames.length === 0 ? (
          <p className="note">Values for var.* conditions, typed as numbers and booleans.</p>
        ) : (
          <table className="var-table">
            <tbody>
              {varNames.map((name) => {
                const value = snapshot?.vars[name]
                return (
                  <tr key={name}>
                    <td className="mono">{name}</td>
                    <td>
                      <input
                        key={String(value)}
                        className="input mono"
                        defaultValue={String(value)}
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
                        className="ghost"
                        onClick={() => playtest.update((current) => current.removeVar(name))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="quest-play-watch">
        <h4>Steps</h4>
        {snapshot === undefined ? (
          <p className="note">Each step shows its runtime state and counters here.</p>
        ) : (
          <ul className="step-board">
            {snapshot.steps.map((step) => (
              <li key={step.id} className={`run-${step.state}`}>
                <span className="state-tag">{step.state}</span>
                <span className="mono">{step.id}</span>
                <span className="muted step-counts mono">
                  {step.count}
                  {step.failCount > 0 ? ` / fail ${step.failCount}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        <h4>Transcript</h4>
        {transcript.length === 0 ? (
          <p className="note">What the runtime does with each event shows up here.</p>
        ) : (
          <ol className="quest-transcript">
            {transcript.map((entry, index) => {
              const line = describe(entry)
              return (
                <li key={`${entry.kind}-${index}`} className={entry.kind}>
                  <span className="kind">{line.kind}</span>
                  <span className="text mono">{line.text}</span>
                  {line.detail === undefined || line.detail === '' ? null : (
                    <span className="detail mono">{line.detail}</span>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
