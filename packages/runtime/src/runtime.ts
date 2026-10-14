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
  type Duration,
  EXPIRED_OUTCOME,
  type Objective,
  type OqfDocument,
  type Outcome,
  type Parameter,
  type Payload,
  type Quest,
  type Reward,
  type Scalar,
  type Step,
  type StepState,
  TIME_VARIABLES,
  type VariableResolver,
  conditionVariables,
  evaluateCondition,
  isParamRef,
  outcomeFlag,
  paramRefName,
  parseDuration,
} from '@oqf/core'
import { Calendar, type CalendarOptions } from './calendar.js'
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
  type ParamValue,
  type QuestRecord,
  type QuestState,
  STATE_VERSION,
  type StepRuntime,
  cloneQuestRecord,
  cloneQuestState,
  newQuestRecord,
  newQuestState,
  newStepRuntime,
} from './state.js'

/**
 * How many evaluation passes may run before the runtime gives up. A quest that
 * never settles is an authoring bug: some pair of steps is toggling each other.
 */
export const MAX_PASSES = 1000

/**
 * Binds the parameters of a templated quest when an instance is about to be
 * offered. Returns a value per parameter name, or undefined to decline; a
 * missing or out of constraint value declines as well. Declining keeps the
 * quest unseen and the runtime asks again the next time it would offer it.
 */
export type BindHook = (
  questId: string,
  instance: number,
  params: Parameter[],
) => Record<string, ParamValue> | undefined

/** The arguments a text key receives, per docs/07-i18n.md. */
export type TextArguments = Record<string, ParamValue>

export interface QuestRuntimeOptions {
  /** Every document the runtime should hold. Quest ids must be unique across them. */
  documents: OqfDocument[]
  /** Resolver for the `var.*` namespace. Receives the full path, `var.` included. */
  resolveVar?: VariableResolver
  /**
   * Clock for `log` entries, `enteredAt` and every timing feature, read once
   * per input so everything one input does carries the same instant. Defaults
   * to a counter starting at 0, which only orders inputs. A quest that uses
   * `cooldown`, `expire`, `deadline` or `time.*` needs milliseconds since the
   * epoch, and the runtime refuses to construct on the counter with one loaded.
   */
  clock?: () => number
  /** How calendar durations and `time.*` read the clock. Defaults to the host zone, Monday, midnight. */
  calendar?: CalendarOptions
  /** Binds the parameters of templated quests. Without it a quest with parameters is never offered. */
  bind?: BindHook
  /** Renames incoming event names, engine vocabulary to OQF vocabulary. */
  eventMap?: Record<string, string>
}

/** True when any timing feature of the quest needs a real clock. */
function usesClock(quest: Quest): boolean {
  if (quest.cooldown !== undefined || quest.expire !== undefined) return true
  const conditions: Condition[] = []
  if (quest.unlock !== undefined) conditions.push(quest.unlock)
  for (const step of quest.steps) {
    if (step.deadline !== undefined) return true
    for (const condition of [step.unlock, step.activate, step.complete, step.fail]) {
      if (condition !== undefined) conditions.push(condition)
    }
  }
  return conditions.some((condition) =>
    conditionVariables(condition).some((path) => path.startsWith('time.')),
  )
}

/** A number constraint `min..max`, either side optional. */
function withinRange(value: number, constraint: string | undefined): boolean {
  if (constraint === undefined) return true
  const match = /^(-?\d+(?:\.\d+)?)?\.\.(-?\d+(?:\.\d+)?)?$/.exec(constraint)
  if (match === null) return true
  if (match[1] !== undefined && value < Number(match[1])) return false
  if (match[2] !== undefined && value > Number(match[2])) return false
  return true
}

/** True when the value fits the parameter's type and constraint. Tag constraints are the engine's. */
function fitsParameter(parameter: Parameter, value: unknown): value is ParamValue {
  if (parameter.type === 'number') {
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      withinRange(value, parameter.constraint)
    )
  }
  return typeof value === 'string' && value !== ''
}

function text(payload: Payload, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function counter(payload: Payload): number {
  const amount = payload.amount
  return typeof amount === 'number' ? amount : 1
}

/**
 * Does a `dialogue.ended` payload satisfy a `talk` objective's dialogue binding?
 * The binding is either `conversationId`, which pins the conversation only, or
 * `conversationId#nodeId`, which also pins the node the conversation ended on.
 * The payload carries the conversation in `node` and that end node in `at`.
 */
function spokeTo(payload: Payload, dialogue: string | undefined): boolean {
  if (dialogue === undefined) return true
  const hash = dialogue.indexOf('#')
  if (hash === -1) return text(payload, 'node') === dialogue
  return (
    text(payload, 'node') === dialogue.slice(0, hash) &&
    text(payload, 'at') === dialogue.slice(hash + 1)
  )
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
  /** One record per quest id, outliving instances. */
  private readonly records = new Map<string, QuestRecord>()
  private readonly calendar: Calendar
  private readonly bind: BindHook | undefined
  /** The clock as read at the start of the current input, so one pass sees one instant. */
  private now = 0
  /** True when a loaded quest uses a timing feature, which is when time is evaluated at all. */
  private readonly timed: boolean
  /** Quests whose bind hook declined during the current input, so it is asked once per input. */
  private readonly declined = new Set<string>()
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
    this.calendar = new Calendar(options.calendar)
    this.bind = options.bind
    this.eventMap = options.eventMap ?? {}
    let timed = false
    for (const document of options.documents) {
      for (const quest of document.quests) {
        if (this.quests.has(quest.id)) throw new Error(`duplicate quest id "${quest.id}"`)
        if (usesClock(quest)) {
          if (options.clock === undefined) {
            throw new Error(
              `quest "${quest.id}" uses cooldown, expire, deadline or time.*, so QuestRuntimeOptions.clock must return milliseconds since the epoch`,
            )
          }
          timed = true
        }
        this.quests.set(quest.id, quest)
        this.states.set(quest.id, newQuestState(quest))
        this.records.set(quest.id, newQuestRecord(quest.id))
      }
    }
    this.timed = timed
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

  /** The live quest record. Treat it as read only; `saveRecords` returns copies. */
  getRecord(questId: string): QuestRecord {
    const record = this.records.get(questId)
    if (record === undefined) throw new Error(`unknown quest "${questId}"`)
    return record
  }

  /** A copy of every quest record, in the order the quests were loaded. Persist them with `save`. */
  saveRecords(): QuestRecord[] {
    return [...this.records.values()].map(cloneQuestRecord)
  }

  /**
   * Adopt saved documents and reconcile them against the loaded quests, per
   * docs/05-state.md: unknown steps are parked in `ext['x-oqf.orphaned']`, steps
   * the quest gained start locked, `questVersion` is updated and every condition
   * is re-evaluated. Documents for quests that are not loaded are ignored.
   *
   * Records restore first so a restored instance is numbered after the runs the
   * record already counts. A record for a quest that is not loaded is ignored.
   */
  load(states: QuestState[], records: QuestRecord[] = []): void {
    for (const incoming of states) {
      if (incoming.stateVersion > STATE_VERSION) {
        throw new Error(
          `state document for "${incoming.quest}" has version ${incoming.stateVersion}, this runtime understands ${STATE_VERSION}`,
        )
      }
    }
    this.run(() => {
      for (const record of records) {
        if (this.records.has(record.quest)) this.records.set(record.quest, cloneQuestRecord(record))
      }
      for (const incoming of states) {
        const quest = this.quests.get(incoming.quest)
        if (quest === undefined) continue
        this.states.set(quest.id, this.reconcile(quest, incoming))
      }
      this.applyTime()
      this.settle()
    })
  }

  /**
   * Re-evaluate cooldowns, expiry and deadlines against the clock. Time passes
   * without events, so games call this on a timer or on resume; every other
   * entry point evaluates time first as well.
   */
  tick(): void {
    this.run(() => {
      this.applyTime()
      this.settle()
    })
  }

  /**
   * The arguments a text key of the quest receives, per docs/07-i18n.md: the
   * bound parameters, plus `count` and `target` when a step is named.
   */
  textArgs(questId: string, stepId?: string): TextArguments {
    const state = this.getState(questId)
    const args: TextArguments = { ...state.params }
    if (stepId === undefined) return args
    const step = this.questOf(questId).steps.find((entry) => entry.id === stepId)
    if (step === undefined) throw new Error(`unknown step "${stepId}" in quest "${questId}"`)
    args.count = state.steps[stepId]?.count ?? 0
    if (step.objective !== undefined) args.target = this.threshold(step.objective, state)
    return args
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
   * offered automatically when it becomes true. Returns false, and does nothing,
   * once the quest has been offered, while a `repeat` quest's cooldown has not
   * passed, or when the bind hook declines to bind the quest's parameters.
   */
  offer(questId: string): boolean {
    const quest = this.questOf(questId)
    let offered = false
    this.run(() => {
      this.applyTime()
      const state = this.getState(questId)
      if (state.status === 'unseen') offered = this.tryOffer(quest, state)
      this.settle()
    })
    return offered
  }

  /**
   * Move a quest from `offered` to `open`, which starts its steps and its
   * expiry. A quest that is still `unseen` is offered first, subject to the same
   * gates as `offer`. Games with no accept step call this immediately after
   * `offer`, or on its own.
   */
  accept(questId: string): void {
    const quest = this.questOf(questId)
    this.run(() => {
      this.applyTime()
      const state = this.getState(questId)
      if (state.status === 'unseen') this.tryOffer(quest, state)
      if (state.status !== 'offered') return
      state.status = 'open'
      state.startedAt = this.now
      this.settle()
    })
  }

  /**
   * Read a condition variable. Every namespace in docs/02-conditions.md is
   * served from loaded state except `var.*`, which the engine resolver owns.
   *
   * `count.*` and `step.*` accept both the unqualified `<stepId>` and the
   * qualified `<questId>#<stepId>` form. An unqualified path reads the quest
   * under evaluation first and otherwise searches every loaded quest that is
   * not `unseen`, in load order, for a step with that id. That is what lets a
   * dialogue provider wire its resolver straight to this method.
   */
  resolve(path: string): unknown {
    if (!this.busy && this.timed) {
      // Outside an evaluation the clock may have moved: settle time first (D25 to D27).
      this.run(() => {
        this.applyTime()
        this.settle()
      })
    }
    const dot = path.indexOf('.')
    const namespace = dot === -1 ? path : path.slice(0, dot)
    const rest = dot === -1 ? '' : path.slice(dot + 1)
    if (namespace === 'flag') return this.flag(rest)
    if (namespace === 'count') return this.locate(rest)?.count
    if (namespace === 'step') return this.locate(rest)?.state
    if (namespace === 'outcome') return this.reached.has(path)
    if (namespace === 'quest') return this.states.get(rest)?.status
    if (namespace === 'var') return this.resolveVar(path)
    if (namespace === 'param') {
      return this.scope === null ? undefined : this.states.get(this.scope)?.params[rest]
    }
    if (namespace === 'time') {
      return (TIME_VARIABLES as readonly string[]).includes(rest)
        ? this.calendar.timeVariables(this.now)[rest as (typeof TIME_VARIABLES)[number]]
        : undefined
    }
    if (namespace === 'runs') {
      const hash = rest.indexOf('.')
      const record = this.records.get(hash === -1 ? rest : rest.slice(0, hash))
      if (record === undefined) return undefined
      return hash === -1 ? record.runs : (record.outcomes[rest.slice(hash + 1)] ?? 0)
    }
    if (namespace === 'streak') return this.streak(rest)
    return undefined
  }

  /**
   * `streak.<questId>`: the record's streak while the last outcome fell in the
   * current or the previous period, zero otherwise, so a missed period breaks
   * the streak without the record being touched (D30).
   */
  private streak(questId: string): number | undefined {
    const quest = this.quests.get(questId)
    const record = this.records.get(questId)
    if (quest === undefined || record === undefined) return undefined
    const unit = this.calendarUnit(quest)
    if (unit === undefined) return undefined
    if (record.lastOutcomeAt === null) return 0
    const current = this.calendar.period(this.now, unit)
    const last = this.calendar.period(record.lastOutcomeAt, unit)
    return last === current || last === current - 1 ? record.streak : 0
  }

  /** The calendar unit of the quest's cooldown, or undefined for a fixed span or none. */
  private calendarUnit(quest: Quest): 'day' | 'week' | 'month' | undefined {
    if (quest.cooldown === undefined) return undefined
    const parsed = parseDuration(quest.cooldown)
    return parsed?.kind === 'calendar' ? parsed.unit : undefined
  }

  /** True when `duration` measured from `anchor` has passed at `this.now`. */
  private elapsed(anchor: number, duration: Duration): boolean {
    const parsed = parseDuration(duration)
    if (parsed === undefined) return false
    if (parsed.kind === 'fixed') return this.now >= anchor + parsed.ms
    return this.now >= this.calendar.nextBoundary(anchor, parsed.unit)
  }

  /**
   * Whether a repeat quest's cooldown has passed since its last outcome, with
   * the clock-jump guard of D25: a last outcome more than a whole cooldown in
   * the future counts as passed, and one less far ahead is moved back to now on
   * the record, so the wait is one cooldown from the moment the jump was seen
   * rather than from an instant the clock has yet to reach.
   */
  private cooldownPassed(quest: Quest): boolean {
    if (quest.cooldown === undefined) return true
    const record = this.getRecord(quest.id)
    const last = record.lastOutcomeAt
    if (last === null) return true
    const parsed = parseDuration(quest.cooldown)
    if (parsed === undefined) return true
    if (last > this.now) {
      const beyond =
        parsed.kind === 'fixed'
          ? last > this.now + parsed.ms
          : last >=
            this.calendar.nextBoundary(
              this.calendar.nextBoundary(this.now, parsed.unit),
              parsed.unit,
            )
      if (beyond) return true
      record.lastOutcomeAt = this.now
    }
    return this.elapsed(record.lastOutcomeAt ?? this.now, quest.cooldown)
  }

  /**
   * Bind the parameters of a templated quest for the instance about to be
   * offered. Returns the values, or undefined when the quest cannot be offered:
   * no hook, the hook declined, a value is missing or breaks its constraint.
   */
  private bindParams(quest: Quest, state: QuestState): Record<string, ParamValue> | undefined {
    const params = quest.params ?? []
    if (params.length === 0) return {}
    if (this.bind === undefined || this.declined.has(quest.id)) return undefined
    const bound = this.bind(quest.id, state.instance, params)
    const values: Record<string, ParamValue> = {}
    for (const parameter of params) {
      const value = bound?.[parameter.name]
      if (!fitsParameter(parameter, value)) {
        this.declined.add(quest.id)
        return undefined
      }
      values[parameter.name] = value
    }
    return values
  }

  /** Offer an unseen quest if its cooldown has passed and its parameters bind. */
  private tryOffer(quest: Quest, state: QuestState): boolean {
    if (quest.repeat === true && !this.cooldownPassed(quest)) return false
    const params = this.bindParams(quest, state)
    if (params === undefined) return false
    state.params = params
    this.offerQuest(quest, state)
    return true
  }

  /** The value an objective slot stands for on this instance: a bound parameter or the id itself. */
  private bound(state: QuestState, value: string): string | undefined {
    if (!isParamRef(value)) return value
    const found = state.params[paramRefName(value)]
    return typeof found === 'string' ? found : found === undefined ? undefined : String(found)
  }

  /** The count an objective must reach on this instance. A missing bound count reads as one. */
  private threshold(objective: Objective, state: QuestState): number {
    if (objective.kind === 'kill' || objective.kind === 'collect' || objective.kind === 'event') {
      if (typeof objective.count === 'number') return objective.count
      if (objective.count === undefined) return 1
      const found = state.params[paramRefName(objective.count)]
      return typeof found === 'number' ? found : 1
    }
    return 1
  }

  /**
   * Time first, on every entry point: an open instance past its `expire`
   * reaches the built-in `expired` outcome (D26), and an active or available
   * step past its `deadline` takes its fail transition (D27).
   */
  private applyTime(): void {
    if (!this.timed) return
    for (const [questId, state] of [...this.states]) {
      if (state.status !== 'open') continue
      const quest = this.questOf(questId)
      if (
        quest.expire !== undefined &&
        state.startedAt !== null &&
        this.elapsed(state.startedAt, quest.expire)
      ) {
        this.reachOutcome(quest, state, null, { name: EXPIRED_OUTCOME, failed: true })
        continue
      }
      for (const step of quest.steps) {
        if (step.deadline === undefined) continue
        const runtime = state.steps[step.id]
        if (runtime === undefined || runtime.enteredAt === undefined) continue
        if (runtime.state !== 'active' && runtime.state !== 'available') continue
        if (this.elapsed(runtime.enteredAt, step.deadline)) {
          this.transition(quest, state, step, 'failed')
        }
      }
    }
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

  /**
   * Find the step record a `count.*` or `step.*` path names. `<questId>#<stepId>`
   * is exact. A bare step id reads the quest under evaluation first, then every
   * loaded quest the player has at least been offered, in load order.
   */
  private locate(ref: string): StepRuntime | undefined {
    const hash = ref.indexOf('#')
    if (hash !== -1) return this.states.get(ref.slice(0, hash))?.steps[ref.slice(hash + 1)]
    if (this.scope !== null) {
      const scoped = this.states.get(this.scope)?.steps[ref]
      if (scoped !== undefined) return scoped
    }
    for (const state of this.states.values()) {
      if (state.status === 'unseen') continue
      const step = state.steps[ref]
      if (step !== undefined) return step
    }
    return undefined
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
    const record = this.getRecord(quest.id)
    // A version 1 document predates these fields; fill them per docs/05-state.md.
    const legacy = incoming as Partial<QuestState>
    const state = cloneQuestState({
      ...incoming,
      instance: legacy.instance ?? record.runs + 1,
      startedAt: legacy.startedAt ?? (incoming.status === 'open' ? this.now : null),
      outcomeAt: legacy.outcomeAt ?? null,
      params: legacy.params ?? {},
    })
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

  /** One input, one clock reading: every transition inside it carries the same `at`. */
  private run(work: () => void): void {
    if (this.busy) {
      work()
      return
    }
    this.busy = true
    this.now = this.clock()
    this.declined.clear()
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
    this.applyTime()
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
          runtime.count += this.increment(step.objective, event, state, step.id)
        }
        if ((live || runtime.state === 'available') && step.failObjective !== undefined) {
          runtime.failCount += this.increment(step.failObjective, event, state, step.id)
        }
      }
    }
  }

  /** How much a single event adds to an objective counter. Zero when it does not match. */
  private increment(
    objective: Objective,
    event: OqfEvent,
    state: QuestState,
    stepId: string,
  ): number {
    const payload = event.payload
    const bound = (value: string): string | undefined => this.bound(state, value)
    if (objective.kind === 'kill') {
      return event.name === EVENT_ACTOR_KILLED && text(payload, 'actor') === bound(objective.actor)
        ? 1
        : 0
    }
    if (objective.kind === 'collect') {
      if (event.name !== EVENT_ITEM_COLLECTED || text(payload, 'item') !== bound(objective.item)) {
        return 0
      }
      return counter(payload)
    }
    if (objective.kind === 'reach') {
      return event.name === EVENT_LOCATION_ENTERED &&
        text(payload, 'location') === bound(objective.location)
        ? 1
        : 0
    }
    if (objective.kind === 'talk') {
      if (event.name !== EVENT_DIALOGUE_ENDED || text(payload, 'actor') !== bound(objective.actor))
        return 0
      const dialogue = objective.dialogue === undefined ? undefined : bound(objective.dialogue)
      return spokeTo(payload, dialogue) ? 1 : 0
    }
    if (objective.kind === 'interact') {
      return event.name === EVENT_OBJECT_INTERACTED &&
        text(payload, 'object') === bound(objective.object)
        ? 1
        : 0
    }
    if (objective.kind === 'event') return event.name === bound(objective.event) ? 1 : 0
    return event.name === customObjectiveEvent(state.quest, stepId) && payload.done === true ? 1 : 0
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
      return this.tryOffer(quest, state)
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

  /**
   * `fail` is checked before `complete`. The objective and the condition combine
   * by `and`. A step that fails this way only turns `failed`: it never reaches
   * its outcome, whatever the outcome's `failed` flag says. An ending carrying a
   * fail rule is how an author rules that route out, so the quest stays open and
   * the remaining steps carry on. Only completing an ending closes a quest, see
   * D23 in docs/00-decisions.md.
   */
  private failed(quest: Quest, state: QuestState, step: Step): boolean {
    if (step.failObjective === undefined && step.fail === undefined) return false
    const runtime = state.steps[step.id]
    if (
      step.failObjective !== undefined &&
      runtime.failCount < this.threshold(step.failObjective, state)
    ) {
      return false
    }
    if (step.fail !== undefined && !this.test(step.fail, quest.id)) return false
    this.transition(quest, state, step, 'failed')
    return true
  }

  private complete(quest: Quest, state: QuestState, step: Step): boolean {
    const runtime = state.steps[step.id]
    if (step.objective !== undefined && runtime.count < this.threshold(step.objective, state)) {
      return false
    }
    if (step.complete !== undefined && !this.test(step.complete, quest.id)) return false
    return true
  }

  /**
   * A step met its completion. Ending steps run the outcome sequence afterwards.
   * This is the only path to an outcome: reaching one always means a step was
   * completed, never that a step failed through `fail` or `failObjective`.
   */
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

  /**
   * The five steps of docs/01-model.md, in order, then the quest closes or
   * restarts. `step` is null for the built-in `expired` outcome, which no step
   * completes. The quest record is updated here, D30 included.
   */
  private reachOutcome(quest: Quest, state: QuestState, step: Step | null, outcome: Outcome): void {
    state.outcome = outcome.name
    state.outcomeAt = this.now
    for (const other of quest.steps) {
      const runtime = state.steps[other.id]
      if (runtime === undefined) continue
      if (runtime.state !== 'done' && runtime.state !== 'failed') {
        this.transition(quest, state, other, 'skipped')
      }
    }
    this.reached.add(outcomeFlag(quest.id, outcome.name))
    for (const reward of quest.rewards) {
      if (reward.outcome === outcome.name) this.grant(quest, state, step?.id ?? '', reward)
    }
    this.record(quest, outcome.name)
    this.push(questOutcomeEvent(quest.id), { name: outcome.name, failed: outcome.failed === true })
    state.status = 'closed'
    if (quest.repeat === true) {
      this.history.push(state)
      this.states.set(quest.id, newQuestState(quest, this.getRecord(quest.id).runs + 1))
    }
  }

  /** Count the outcome on the quest record and move the streak per D30. */
  private record(quest: Quest, outcome: string): void {
    const record = this.getRecord(quest.id)
    const unit = this.calendarUnit(quest)
    if (unit !== undefined) {
      if (outcome === EXPIRED_OUTCOME) {
        record.streak = 0
      } else if (record.lastOutcomeAt === null) {
        record.streak = 1
      } else {
        const current = this.calendar.period(this.now, unit)
        const last = this.calendar.period(record.lastOutcomeAt, unit)
        if (last === current - 1) record.streak += 1
        else if (last !== current) record.streak = 1
      }
    }
    record.runs += 1
    record.outcomes[outcome] = (record.outcomes[outcome] ?? 0) + 1
    record.lastOutcome = outcome
    record.lastOutcomeAt = this.now
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
    const at = this.now
    runtime.state = to
    runtime.enteredAt = at
    state.log.push({ step: step.id, from, to, at })
    this.push(stepEvent(quest.id, step.id, to), { from })
  }
}
