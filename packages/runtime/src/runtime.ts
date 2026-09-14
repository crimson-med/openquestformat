/**
 * The quest state machine. One runtime holds every loaded quest, the state
 * document for each, and the world view conditions are evaluated against.
 *
 * Input is a single `emit`, output a single `on`. Everything the runtime emits
 * while processing an input is queued and delivered after that input finishes,
 * so a handler never observes a half applied transition. See docs/03-events.md.
 */
import {
  type Condition,
  type Objective,
  type OqfDocument,
  type Outcome,
  type Payload,
  type Quest,
  type Reward,
  type Scalar,
  type Step,
  type StepState,
  type VariableResolver,
  evaluateCondition,
  outcomeFlag,
} from '@oqf/core'
import {
  EVENT_ACTOR_KILLED,
  EVENT_DIALOGUE_ENDED,
  EVENT_FLAG_SET,
  EVENT_ITEM_COLLECTED,
  EVENT_LOCATION_ENTERED,
  EVENT_OBJECT_INTERACTED,
  EVENT_REWARD_GRANTED,
  type EventHandler,
  type OqfEvent,
  customObjectiveEvent,
  questOfferedEvent,
  questOutcomeEvent,
  stepEvent,
  toEvent,
} from './events.js'
import {
  ORPHANED_KEY,
  type QuestState,
  STATE_VERSION,
  cloneQuestState,
  newQuestState,
  newStepRuntime,
} from './state.js'

/**
 * How many evaluation passes may run before the runtime gives up. A quest that
 * never settles is an authoring bug: some pair of steps is toggling each other.
 */
export const MAX_PASSES = 1000

export interface QuestRuntimeOptions {
  /** Every document the runtime should hold. Quest ids must be unique across them. */
  documents: OqfDocument[]
  /** Resolver for the `var.*` namespace. Receives the full path, `var.` included. */
  resolveVar?: VariableResolver
  /** Clock for `log` entries and `enteredAt`. Defaults to a counter starting at 0. */
  clock?: () => number
  /** Renames incoming event names, engine vocabulary to OQF vocabulary. */
  eventMap?: Record<string, string>
}

function objectiveThreshold(objective: Objective): number {
  if (objective.kind === 'kill' || objective.kind === 'collect' || objective.kind === 'event') {
    return objective.count ?? 1
  }
  return 1
}

function text(payload: Payload, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function counter(payload: Payload): number {
  const amount = payload.amount
  return typeof amount === 'number' ? amount : 1
}

function counting(): () => number {
  let tick = 0
  return () => {
    const value = tick
    tick += 1
    return value
  }
}

export class QuestRuntime {
  /** State documents replaced when a `repeat` quest was retaken, oldest first. */
  readonly history: QuestState[] = []

  private readonly quests = new Map<string, Quest>()
  private readonly states = new Map<string, QuestState>()
  /** Flags set by incoming `flag.set` events. Quest scoped flags live in the documents. */
  private readonly worldFlags = new Map<string, Scalar>()
  /** Outcome flag names, `outcome.<questId>.<name>`, reached by any loaded quest. */
  private readonly reached = new Set<string>()
  private readonly handlers = new Set<EventHandler>()
  private readonly outbox: OqfEvent[] = []
  private readonly inputs: OqfEvent[] = []
  private readonly resolveVar: VariableResolver
  private readonly clock: () => number
  private readonly eventMap: Record<string, string>
  private busy = false
  /** The quest whose conditions are being evaluated, for `count.*` and bare `step.*`. */
  private scope: string | null = null

  constructor(options: QuestRuntimeOptions) {
    this.resolveVar = options.resolveVar ?? (() => undefined)
    this.clock = options.clock ?? counting()
    this.eventMap = options.eventMap ?? {}
    for (const document of options.documents) {
      for (const quest of document.quests) {
        if (this.quests.has(quest.id)) throw new Error(`duplicate quest id "${quest.id}"`)
        this.quests.set(quest.id, quest)
        this.states.set(quest.id, newQuestState(quest))
      }
    }
  }

  /** Register an output handler. Returns the unsubscribe function. */
  on(handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  /** The live state document. Treat it as read only; `save` returns copies. */
  getState(questId: string): QuestState {
    const state = this.states.get(questId)
    if (state === undefined) throw new Error(`unknown quest "${questId}"`)
    return state
  }

  /** A copy of every state document, in the order the quests were loaded. */
  save(): QuestState[] {
    return [...this.states.values()].map(cloneQuestState)
  }

  /**
   * Adopt saved documents and reconcile them against the loaded quests, per
   * docs/05-state.md: unknown steps are parked in `ext['x-oqf.orphaned']`, steps
   * the quest gained start locked, `questVersion` is updated and every condition
   * is re-evaluated. Documents for quests that are not loaded are ignored.
   */
  load(states: QuestState[]): void {
    for (const incoming of states) {
      if (incoming.stateVersion > STATE_VERSION) {
        throw new Error(
          `state document for "${incoming.quest}" has version ${incoming.stateVersion}, this runtime understands ${STATE_VERSION}`,
        )
      }
    }
    this.run(() => {
      for (const incoming of states) {
        const quest = this.quests.get(incoming.quest)
        if (quest === undefined) continue
        this.states.set(quest.id, this.reconcile(quest, incoming))
      }
      this.settle()
    })
  }

  /**
   * The single input. Accepts an event object or a name plus payload. Incoming
   * names are renamed through `eventMap` first, then objective counters run and
   * every open quest is re-evaluated to a fixed point.
   */
  emit(event: OqfEvent | string, payload?: Payload): void {
    const next = toEvent(event, payload)
    if (this.busy) {
      this.inputs.push(next)
      return
    }
    this.run(() => this.consume(next))
  }

  /**
   * Move a quest from `unseen` to `offered` and emit `quest.<id>.offered`. Games
   * call this for quests with no unlock condition; quests that have one are
   * offered automatically when it becomes true. Does nothing once the quest has
   * been offered.
   */
  offer(questId: string): void {
    const quest = this.questOf(questId)
    this.run(() => {
      const state = this.getState(questId)
      if (state.status !== 'unseen') return
      this.offerQuest(quest, state)
      this.settle()
    })
  }

  /**
   * Move a quest from `offered` to `open`, which starts its steps. A quest that
   * is still `unseen` is offered first. Games with no accept step call this
   * immediately after `offer`, or on its own.
   */
  accept(questId: string): void {
    const quest = this.questOf(questId)
    this.run(() => {
      const state = this.getState(questId)
      if (state.status === 'unseen') this.offerQuest(quest, state)
      if (state.status !== 'offered') return
      state.status = 'open'
      this.settle()
    })
  }

  /**
   * Read a condition variable. Every namespace in docs/02-conditions.md is
   * served from loaded state except `var.*`, which the engine resolver owns.
   * `count.*` and unqualified `step.*` read the quest being evaluated.
   */
  resolve(path: string): unknown {
    const dot = path.indexOf('.')
    const namespace = dot === -1 ? path : path.slice(0, dot)
    const rest = dot === -1 ? '' : path.slice(dot + 1)
    if (namespace === 'flag') return this.flag(rest)
    if (namespace === 'count') return this.count(rest)
    if (namespace === 'step') return this.stepState(rest)
    if (namespace === 'outcome') return this.reached.has(path)
    if (namespace === 'quest') return this.states.get(rest)?.status
    if (namespace === 'var') return this.resolveVar(path)
    return undefined
  }

  private questOf(questId: string): Quest {
    const quest = this.quests.get(questId)
    if (quest === undefined) throw new Error(`unknown quest "${questId}"`)
    return quest
  }

  /** Merged flag view: world flags first, then the quest scoped flags. Unset reads false. */
  private flag(name: string): Scalar {
    const world = this.worldFlags.get(name)
    if (world !== undefined) return world
    for (const state of this.states.values()) {
      const value = state.flags[name]
      if (value !== undefined) return value
    }
    return false
  }

  private count(stepId: string): number | undefined {
    if (this.scope === null) return undefined
    return this.states.get(this.scope)?.steps[stepId]?.count
  }

  private stepState(ref: string): StepState | undefined {
    const hash = ref.indexOf('#')
    const questId = hash === -1 ? this.scope : ref.slice(0, hash)
    const stepId = hash === -1 ? ref : ref.slice(hash + 1)
    if (questId === null) return undefined
    return this.states.get(questId)?.steps[stepId]?.state
  }

  private test(condition: Condition, questId: string): boolean {
    const previous = this.scope
    this.scope = questId
    try {
      return evaluateCondition(condition, this.resolvePath)
    } finally {
      this.scope = previous
    }
  }

  private readonly resolvePath: VariableResolver = (path) => this.resolve(path)

  private reconcile(quest: Quest, incoming: QuestState): QuestState {
    const state = cloneQuestState(incoming)
    const known = new Set(quest.steps.map((step) => step.id))
    const parked = state.ext[ORPHANED_KEY]
    const orphaned: Record<string, Scalar> =
      parked !== null && typeof parked === 'object' ? { ...parked } : {}
    for (const [stepId, step] of Object.entries(state.steps)) {
      if (known.has(stepId)) continue
      orphaned[stepId] = step.state
      delete state.steps[stepId]
    }
    if (Object.keys(orphaned).length > 0) state.ext[ORPHANED_KEY] = orphaned
    for (const step of quest.steps) {
      if (state.steps[step.id] === undefined) state.steps[step.id] = newStepRuntime()
    }
    state.questVersion = quest.version
    state.stateVersion = STATE_VERSION
    if (state.outcome !== null) this.reached.add(outcomeFlag(quest.id, state.outcome))
    return state
  }

  private run(work: () => void): void {
    if (this.busy) {
      work()
      return
    }
    this.busy = true
    try {
      work()
      this.deliver()
    } catch (error) {
      this.outbox.length = 0
      this.inputs.length = 0
      throw error
    } finally {
      this.busy = false
    }
  }

  private deliver(): void {
    for (;;) {
      while (this.outbox.length > 0) {
        const event = this.outbox.shift() as OqfEvent
        for (const handler of [...this.handlers]) handler(event)
      }
      const next = this.inputs.shift()
      if (next === undefined) return
      this.consume(next)
    }
  }

  private consume(event: OqfEvent): void {
    const mapped = this.eventMap[event.name]
    this.applyEvent(mapped === undefined ? event : { name: mapped, payload: event.payload })
    this.settle()
  }

  private push(name: string, payload: Payload): void {
    this.outbox.push({ name, payload })
  }

  private applyEvent(event: OqfEvent): void {
    if (event.name === EVENT_FLAG_SET) {
      const flag = text(event.payload, 'flag')
      if (flag !== undefined) {
        const value = event.payload.value
        this.worldFlags.set(flag, value === undefined ? true : value)
      }
    }
    for (const [questId, state] of this.states) {
      if (state.status !== 'open') continue
      const quest = this.questOf(questId)
      for (const step of quest.steps) {
        const runtime = state.steps[step.id]
        if (runtime === undefined) continue
        const live = runtime.state === 'active'
        if (live && step.objective !== undefined) {
          runtime.count += this.increment(step.objective, event, questId, step.id)
        }
        if ((live || runtime.state === 'available') && step.failObjective !== undefined) {
          runtime.failCount += this.increment(step.failObjective, event, questId, step.id)
        }
      }
    }
  }

  /** How much a single event adds to an objective counter. Zero when it does not match. */
  private increment(
    objective: Objective,
    event: OqfEvent,
    questId: string,
    stepId: string,
  ): number {
    const payload = event.payload
    if (objective.kind === 'kill') {
      return event.name === EVENT_ACTOR_KILLED && text(payload, 'actor') === objective.actor ? 1 : 0
    }
    if (objective.kind === 'collect') {
      if (event.name !== EVENT_ITEM_COLLECTED || text(payload, 'item') !== objective.item) return 0
      return counter(payload)
    }
    if (objective.kind === 'reach') {
      return event.name === EVENT_LOCATION_ENTERED &&
        text(payload, 'location') === objective.location
        ? 1
        : 0
    }
    if (objective.kind === 'talk') {
      if (event.name !== EVENT_DIALOGUE_ENDED || text(payload, 'actor') !== objective.actor)
        return 0
      if (objective.dialogue !== undefined && text(payload, 'node') !== objective.dialogue) return 0
      return 1
    }
    if (objective.kind === 'interact') {
      return event.name === EVENT_OBJECT_INTERACTED && text(payload, 'object') === objective.object
        ? 1
        : 0
    }
    if (objective.kind === 'event') return event.name === objective.event ? 1 : 0
    return event.name === customObjectiveEvent(questId, stepId) && payload.done === true ? 1 : 0
  }

  private settle(): void {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      let changed = false
      for (const questId of [...this.quests.keys()]) {
        if (this.questPass(questId)) changed = true
      }
      if (!changed) return
    }
    throw new Error(`quest runtime did not settle after ${MAX_PASSES} passes`)
  }

  /** One evaluation pass over one quest. At most one transition per step. */
  private questPass(questId: string): boolean {
    const quest = this.questOf(questId)
    const state = this.getState(questId)
    if (state.status === 'unseen') {
      if (quest.unlock === undefined || !this.test(quest.unlock, questId)) return false
      this.offerQuest(quest, state)
      return true
    }
    if (state.status !== 'open') return false
    let changed = false
    for (const step of quest.steps) {
      if (this.stepPass(quest, state, step)) changed = true
      if (this.states.get(questId) !== state || state.status !== 'open') break
    }
    return changed
  }

  private offerQuest(quest: Quest, state: QuestState): void {
    state.status = 'offered'
    this.push(questOfferedEvent(quest.id), {})
  }

  private stepPass(quest: Quest, state: QuestState, step: Step): boolean {
    const runtime = state.steps[step.id]
    if (runtime === undefined) return false
    if (runtime.state === 'done' || runtime.state === 'failed') {
      return this.rearm(quest, state, step)
    }
    if (runtime.state === 'locked') {
      if (step.start !== true && step.unlock !== undefined && !this.test(step.unlock, quest.id)) {
        return false
      }
      this.transition(quest, state, step, 'available')
      return true
    }
    if (runtime.state === 'available') {
      if (this.failed(quest, state, step)) return true
      if (step.activate !== undefined && !this.test(step.activate, quest.id)) return false
      this.transition(quest, state, step, 'active')
      return true
    }
    if (runtime.state !== 'active') return false
    if (this.failed(quest, state, step)) return true
    if (!this.complete(quest, state, step)) return false
    this.finish(quest, state, step)
    return true
  }

  /**
   * A `repeat` step returns to `locked` once its unlock condition is false
   * again, with both counters reset and its rewards cleared so the next pass
   * through grants them once more. A repeat step with no unlock condition would
   * re-enter forever, so it is left alone.
   */
  private rearm(quest: Quest, state: QuestState, step: Step): boolean {
    if (step.repeat !== true || step.unlock === undefined) return false
    if (this.test(step.unlock, quest.id)) return false
    const runtime = state.steps[step.id]
    runtime.count = 0
    runtime.failCount = 0
    state.rewards = state.rewards.filter((id) => !step.rewards.includes(id))
    this.transition(quest, state, step, 'locked')
    return true
  }

  /** `fail` is checked before `complete`. The objective and the condition combine by `and`. */
  private failed(quest: Quest, state: QuestState, step: Step): boolean {
    if (step.failObjective === undefined && step.fail === undefined) return false
    const runtime = state.steps[step.id]
    if (
      step.failObjective !== undefined &&
      runtime.failCount < objectiveThreshold(step.failObjective)
    ) {
      return false
    }
    if (step.fail !== undefined && !this.test(step.fail, quest.id)) return false
    this.transition(quest, state, step, 'failed')
    if (step.outcome !== undefined) this.reachOutcome(quest, state, step, step.outcome)
    return true
  }

  private complete(quest: Quest, state: QuestState, step: Step): boolean {
    const runtime = state.steps[step.id]
    if (step.objective !== undefined && runtime.count < objectiveThreshold(step.objective)) {
      return false
    }
    if (step.complete !== undefined && !this.test(step.complete, quest.id)) return false
    return true
  }

  /** A step met its completion. Ending steps run the outcome sequence afterwards. */
  private finish(quest: Quest, state: QuestState, step: Step): void {
    const failedEnding = step.outcome?.failed === true
    this.transition(quest, state, step, failedEnding ? 'failed' : 'done')
    if (!failedEnding) {
      for (const reward of step.rewards) {
        const definition = quest.rewards.find((entry) => entry.id === reward)
        if (definition !== undefined) this.grant(quest, state, step.id, definition)
      }
    }
    if (step.outcome !== undefined) this.reachOutcome(quest, state, step, step.outcome)
  }

  /** The five steps of docs/01-model.md, in order, then the quest closes or restarts. */
  private reachOutcome(quest: Quest, state: QuestState, step: Step, outcome: Outcome): void {
    state.outcome = outcome.name
    for (const other of quest.steps) {
      const runtime = state.steps[other.id]
      if (runtime === undefined) continue
      if (runtime.state !== 'done' && runtime.state !== 'failed') {
        this.transition(quest, state, other, 'skipped')
      }
    }
    this.reached.add(outcomeFlag(quest.id, outcome.name))
    for (const reward of quest.rewards) {
      if (reward.outcome === outcome.name) this.grant(quest, state, step.id, reward)
    }
    this.push(questOutcomeEvent(quest.id), { name: outcome.name, failed: outcome.failed === true })
    state.status = 'closed'
    if (quest.repeat === true) {
      this.history.push(state)
      this.states.set(quest.id, newQuestState(quest))
    }
  }

  /** Grant a reward once. Ids already in `state.rewards` are skipped. */
  private grant(quest: Quest, state: QuestState, stepId: string, reward: Reward): void {
    if (state.rewards.includes(reward.id)) return
    state.rewards.push(reward.id)
    const amount = reward.amount ?? 1
    this.push(EVENT_REWARD_GRANTED, {
      quest: quest.id,
      step: stepId,
      reward: reward.id,
      kind: reward.kind,
      ref: reward.ref,
      amount,
      ...(reward.payload ?? {}),
    })
    if (reward.kind === 'flag') {
      const value = reward.payload?.value ?? amount !== 0
      state.flags[reward.ref] = value
      this.push(EVENT_FLAG_SET, { flag: reward.ref, value, quest: quest.id })
    }
    if (reward.kind === 'event') this.push(reward.ref, { ...(reward.payload ?? {}) })
  }

  private transition(quest: Quest, state: QuestState, step: Step, to: StepState): void {
    const runtime = state.steps[step.id]
    const from = runtime.state
    if (from === to) return
    const at = this.clock()
    runtime.state = to
    runtime.enteredAt = at
    state.log.push({ step: step.id, from, to, at })
    this.push(stepEvent(quest.id, step.id, to), { from })
  }
}
