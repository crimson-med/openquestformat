/**
 * A quest playtest: the editor's documents run through `@oqf/runtime`.
 *
 * The session holds one runtime with every quest loaded and one quest in focus.
 * The author feeds it events, flags and game variables by hand; the transcript
 * records what the runtime answered and the snapshot says where the quest
 * stands. Nothing here touches React or the document store: playtest state is
 * scratch, never document state, so it is neither saved nor undone.
 */
import type { OqfDocument, Payload, Quest, Scalar, Step, StepState } from '@oqf/core'
import {
  EVENT_FLAG_SET,
  EVENT_REWARD_GRANTED,
  type OqfEvent,
  QuestRuntime,
  type QuestStatus,
  customObjectiveEvent,
  questOfferedEvent,
  questOutcomeEvent,
} from '@oqf/runtime'

/** The event the session emits so conditions re-run after a game variable changed. */
export const VAR_CHANGED_EVENT = 'playtest.var.changed'

export interface StepSnapshot {
  id: string
  title: string
  state: StepState
  count: number
  failCount: number
}

export interface RewardGrant {
  quest: string
  step: string
  reward: string
  kind: string
  ref: string
  amount: number
}

export interface PlaytestSnapshot {
  quest: string
  status: QuestStatus
  outcome: string | null
  /** Completed runs of a repeat quest, from `runtime.history`. */
  passes: number
  steps: StepSnapshot[]
  /** Flags the author set plus flags rewards set, as the runtime reads them. */
  flags: Record<string, Scalar>
  vars: Record<string, Scalar>
  rewards: RewardGrant[]
  error?: string
}

export type TranscriptEntry =
  | { kind: 'input'; name: string; payload: Payload }
  | { kind: 'offered'; quest: string }
  | { kind: 'step'; quest: string; step: string; from: StepState; to: StepState }
  | { kind: 'reward'; grant: RewardGrant }
  | { kind: 'outcome'; quest: string; name: string; failed: boolean }
  | { kind: 'flag'; flag: string; value: Scalar }
  | { kind: 'event'; name: string; payload: Payload }

export interface EventSuggestion {
  quest: string
  step: string
  stepTitle: string
  /** True when the event drives the step's fail objective rather than its objective. */
  fail: boolean
  label: string
  name: string
  payload: Payload
}

function isStepState(value: string): value is StepState {
  return (
    value === 'locked' ||
    value === 'available' ||
    value === 'active' ||
    value === 'done' ||
    value === 'failed' ||
    value === 'skipped'
  )
}

function scalar(value: unknown, fallback: Scalar): Scalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : fallback
}

/**
 * Read `key=value;key=value` into a payload. Numbers and booleans are typed,
 * everything else stays a string. Empty pairs are skipped.
 */
export function parsePayload(text: string): Payload {
  const payload: Payload = {}
  for (const pair of text.split(';')) {
    const trimmed = pair.trim()
    if (trimmed === '') continue
    const equals = trimmed.indexOf('=')
    const key = (equals === -1 ? trimmed : trimmed.slice(0, equals)).trim()
    if (key === '') continue
    payload[key] = equals === -1 ? true : parseScalar(trimmed.slice(equals + 1).trim())
  }
  return payload
}

/** A typed scalar from typed text: `true`, `false`, a number, or the text itself. */
export function parseScalar(text: string): Scalar {
  if (text === 'true') return true
  if (text === 'false') return false
  if (text !== '' && !Number.isNaN(Number(text))) return Number(text)
  return text
}

/** `key=value key=value`, the way the transcript prints a payload. */
export function formatPayload(payload: Payload): string {
  return Object.entries(payload)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')
}

export class PlaytestSession {
  /** The document the runtime was built from. A different document means a stale session. */
  readonly document: OqfDocument
  readonly questId: string
  readonly transcript: TranscriptEntry[] = []
  readonly rewards: RewardGrant[] = []
  /** The last error the runtime threw, cleared by the next successful input. */
  error: string | undefined = undefined

  private readonly quests: Map<string, Quest>
  private readonly flags = new Map<string, Scalar>()
  private readonly vars = new Map<string, Scalar>()
  private runtime: QuestRuntime

  constructor(document: OqfDocument, questId: string) {
    this.document = document
    this.questId = questId
    this.quests = new Map(document.quests.map((quest) => [quest.id, quest]))
    if (!this.quests.has(questId)) throw new Error(`unknown quest "${questId}"`)
    this.runtime = this.build()
  }

  /** The runtime under test, for callers that want to read conditions through it. */
  get engine(): QuestRuntime {
    return this.runtime
  }

  /** Offer and accept the focused quest on a fresh runtime. */
  start(): void {
    this.reset()
    this.accept()
  }

  /** Offer and accept the focused quest as it stands, for retaking a repeat quest. */
  accept(): void {
    this.run(() => {
      this.runtime.offer(this.questId)
      this.runtime.accept(this.questId)
    })
  }

  /** A fresh runtime with the transcript cleared. Flags and variables the author set survive. */
  reset(): void {
    this.transcript.length = 0
    this.rewards.length = 0
    this.error = undefined
    this.runtime = this.build()
    for (const [flag, value] of this.flags) {
      this.run(() => this.runtime.emit(EVENT_FLAG_SET, { flag, value }))
    }
  }

  /** Feed one event to the runtime, recorded as an input. */
  emit(name: string, payload: Payload = {}): void {
    this.transcript.push({ kind: 'input', name, payload })
    this.run(() => this.runtime.emit(name, payload))
  }

  /** Set a world flag through a `flag.set` event, so conditions re-run. */
  setFlag(flag: string, value: Scalar = true): void {
    this.flags.set(flag, value)
    this.emit(EVENT_FLAG_SET, { flag, value })
  }

  /** Set a `var.*` value the runtime resolves, then re-run conditions. */
  setVar(name: string, value: Scalar): void {
    this.vars.set(name, value)
    this.emit(VAR_CHANGED_EVENT, { name, value })
  }

  removeVar(name: string): void {
    this.vars.delete(name)
    this.emit(VAR_CHANGED_EVENT, { name })
  }

  /** Runtime state of every step of one quest, keyed by step id. */
  stepStates(questId: string = this.questId): Record<string, StepState> {
    const states: Record<string, StepState> = {}
    if (!this.quests.has(questId)) return states
    for (const [id, step] of Object.entries(this.runtime.getState(questId).steps)) {
      states[id] = step.state
    }
    return states
  }

  snapshot(): PlaytestSnapshot {
    const quest = this.quests.get(this.questId) as Quest
    const state = this.runtime.getState(this.questId)
    const flags: Record<string, Scalar> = {}
    for (const other of this.document.quests) {
      Object.assign(flags, this.runtime.getState(other.id).flags)
    }
    for (const [flag, value] of this.flags) flags[flag] = value
    return {
      quest: this.questId,
      status: state.status,
      outcome: state.outcome,
      passes: this.runtime.history.filter((entry) => entry.quest === this.questId).length,
      steps: quest.steps.map((step) => ({
        id: step.id,
        title: String(step.title),
        state: state.steps[step.id]?.state ?? 'locked',
        count: state.steps[step.id]?.count ?? 0,
        failCount: state.steps[step.id]?.failCount ?? 0,
      })),
      flags,
      vars: Object.fromEntries(this.vars),
      rewards: [...this.rewards],
      ...(this.error === undefined ? {} : { error: this.error }),
    }
  }

  private build(): QuestRuntime {
    const runtime = new QuestRuntime({
      documents: [this.document],
      resolveVar: (path) => this.vars.get(path.startsWith('var.') ? path.slice(4) : path),
    })
    runtime.on((event) => this.record(event))
    return runtime
  }

  private run(work: () => void): void {
    try {
      work()
      this.error = undefined
    } catch (failure) {
      this.error = failure instanceof Error ? failure.message : String(failure)
    }
  }

  /** Turn one runtime output into a transcript entry. */
  private record(event: OqfEvent): void {
    const payload = event.payload
    if (event.name === EVENT_REWARD_GRANTED) {
      const grant: RewardGrant = {
        quest: String(payload.quest ?? ''),
        step: String(payload.step ?? ''),
        reward: String(payload.reward ?? ''),
        kind: String(payload.kind ?? ''),
        ref: String(payload.ref ?? ''),
        amount: typeof payload.amount === 'number' ? payload.amount : 1,
      }
      this.rewards.push(grant)
      this.transcript.push({ kind: 'reward', grant })
      return
    }
    if (event.name === EVENT_FLAG_SET) {
      this.transcript.push({
        kind: 'flag',
        flag: String(payload.flag ?? ''),
        value: scalar(payload.value, true),
      })
      return
    }
    for (const questId of this.quests.keys()) {
      if (event.name === questOfferedEvent(questId)) {
        this.transcript.push({ kind: 'offered', quest: questId })
        return
      }
      if (event.name === questOutcomeEvent(questId)) {
        this.transcript.push({
          kind: 'outcome',
          quest: questId,
          name: String(payload.name ?? ''),
          failed: payload.failed === true,
        })
        return
      }
      const prefix = `quest.${questId}.step.`
      if (event.name.startsWith(prefix)) {
        const rest = event.name.slice(prefix.length)
        const dot = rest.lastIndexOf('.')
        const to = rest.slice(dot + 1)
        const from = String(payload.from ?? 'locked')
        if (dot !== -1 && isStepState(to) && isStepState(from)) {
          this.transcript.push({ kind: 'step', quest: questId, step: rest.slice(0, dot), from, to })
          return
        }
      }
    }
    this.transcript.push({ kind: 'event', name: event.name, payload })
  }
}

function suggestFor(quest: Quest, step: Step, fail: boolean): EventSuggestion[] {
  const objective = fail ? step.failObjective : step.objective
  if (objective === undefined) return []
  const base = { quest: quest.id, step: step.id, stepTitle: String(step.title), fail }
  switch (objective.kind) {
    case 'kill':
      return [
        {
          ...base,
          label: `Kill ${objective.actor}`,
          name: 'actor.killed',
          payload: { actor: objective.actor },
        },
      ]
    case 'collect': {
      const count = objective.count ?? 1
      const one: EventSuggestion = {
        ...base,
        label: `Collect 1 ${objective.item}`,
        name: 'item.collected',
        payload: { item: objective.item, amount: 1 },
      }
      if (count <= 1) return [one]
      return [
        one,
        {
          ...base,
          label: `Collect all ${count} ${objective.item}`,
          name: 'item.collected',
          payload: { item: objective.item, amount: count },
        },
      ]
    }
    case 'reach':
      return [
        {
          ...base,
          label: `Reach ${objective.location}`,
          name: 'location.entered',
          payload: { location: objective.location },
        },
      ]
    case 'talk': {
      const payload: Payload = { actor: objective.actor }
      const binding = objective.dialogue
      if (binding !== undefined) {
        const hash = binding.indexOf('#')
        payload.node = hash === -1 ? binding : binding.slice(0, hash)
        if (hash !== -1) payload.at = binding.slice(hash + 1)
      }
      return [
        {
          ...base,
          label: binding === undefined ? `Talk to ${objective.actor}` : `End ${binding}`,
          name: 'dialogue.ended',
          payload,
        },
      ]
    }
    case 'interact':
      return [
        {
          ...base,
          label: `Interact with ${objective.object}`,
          name: 'object.interacted',
          payload: { object: objective.object },
        },
      ]
    case 'event':
      return [{ ...base, label: objective.event, name: objective.event, payload: {} }]
    case 'custom':
      return [
        {
          ...base,
          label: `Complete ${objective.custom}`,
          name: customObjectiveEvent(quest.id, step.id),
          payload: { done: true },
        },
      ]
  }
}

/** One labelled event per objective and fail objective of every step, in step order. */
export function suggestEvents(quest: Quest): EventSuggestion[] {
  const suggestions: EventSuggestion[] = []
  for (const step of quest.steps) {
    suggestions.push(...suggestFor(quest, step, false), ...suggestFor(quest, step, true))
  }
  return suggestions
}
