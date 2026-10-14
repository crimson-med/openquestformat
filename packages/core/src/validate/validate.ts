/**
 * The validator. Errors mean the pack is not valid OQF, warnings mean it is
 * valid but probably wrong. docs/08-validation.md is the authority for the list.
 *
 * The unit of validation is the pack: ids are unique across it and conditions
 * reach across it. `validateDocument` therefore validates one document as a
 * pack of one, and a reference to a quest that lives in another file only
 * resolves when that file is passed to `validatePack`.
 *
 * Dialogue is not part of v0.1, so the lore node checks are not implemented.
 */
import { checkCondition, conditionVariables } from '../condition/index.js'
import { isCalendarDuration, parseDuration } from '../duration/index.js'
import {
  type Condition,
  EXPIRED_OUTCOME,
  type Ext,
  type Objective,
  type OqfDocument,
  type Parameter,
  type Quest,
  type Ref,
  type Reward,
  type Step,
  TIME_VARIABLES,
  type Text,
  VARIABLE_NAMESPACES,
  isParamRef,
  paramRefName,
} from '../model.js'
import {
  findCycles,
  pathNamespace,
  pathRest,
  reachableSteps,
  stepConditions,
  stepGraph,
} from './graph.js'
import {
  EXT_KEY_PATTERN,
  type Finding,
  KNOWN_EXT_NAMESPACES,
  type ValidateOptions,
  type ValidationResult,
} from './types.js'

/** The message `checkCondition` uses for a namespace it does not know. */
const NAMESPACE_ERROR = 'unknown variable namespace'

interface QuestEntry {
  quest: Quest
  document: OqfDocument
  path: string
  steps: Map<string, Step>
  stepPaths: Map<string, string>
  outcomes: Set<string>
  rewards: Map<string, Reward>
  /** First parameter per name. Duplicates are reported and then ignored for lookups. */
  params: Map<string, Parameter>
  /** Parameter names referenced anywhere in the quest, filled while checking. */
  usedParams: Set<string>
}

interface Context {
  docs: OqfDocument[]
  /** First quest per id. Duplicates are reported and then ignored for lookups. */
  quests: Map<string, QuestEntry>
  /** Every quest in the pack, duplicates included, in document order. */
  order: QuestEntry[]
  /** Flag names some reward in the pack sets. */
  flagRewards: Set<string>
  /** `quest#step` references made from another quest, keyed by the target. */
  foreignDependents: Map<string, string[]>
  strict: boolean
  findings: Finding[]
}

interface Where {
  quest?: string
  step?: string
  path?: string
}

function report(
  context: Context,
  level: 'error' | 'warning',
  code: string,
  message: string,
  where: Where = {},
): void {
  const finding: Finding = { level, code, message }
  if (where.quest !== undefined) finding.quest = where.quest
  if (where.step !== undefined) finding.step = where.step
  if (where.path !== undefined) finding.path = where.path
  context.findings.push(finding)
}

function quote(value: string): string {
  return `"${value}"`
}

function list(values: string[]): string {
  return values.map(quote).join(', ')
}

function hasRef(refs: Ref[], id: string): boolean {
  return refs.some((ref) => ref.id === id)
}

function buildContext(docs: OqfDocument[], options: ValidateOptions): Context {
  const context: Context = {
    docs,
    quests: new Map(),
    order: [],
    flagRewards: new Set(),
    foreignDependents: new Map(),
    strict: options.strict === true,
    findings: [],
  }
  docs.forEach((document, documentIndex) => {
    const prefix = docs.length > 1 ? `documents[${documentIndex}].` : ''
    document.quests.forEach((quest, questIndex) => {
      const path = `${prefix}quests[${questIndex}]`
      const entry: QuestEntry = {
        quest,
        document,
        path,
        steps: new Map(),
        stepPaths: new Map(),
        outcomes: new Set(),
        rewards: new Map(),
        params: new Map(),
        usedParams: new Set(),
      }
      for (const parameter of quest.params ?? []) {
        if (!entry.params.has(parameter.name)) entry.params.set(parameter.name, parameter)
      }
      quest.steps.forEach((step, stepIndex) => {
        if (!entry.steps.has(step.id)) entry.steps.set(step.id, step)
        if (!entry.stepPaths.has(step.id))
          entry.stepPaths.set(step.id, `${path}.steps[${stepIndex}]`)
        if (step.outcome) entry.outcomes.add(step.outcome.name)
      })
      for (const reward of quest.rewards) {
        if (!entry.rewards.has(reward.id)) entry.rewards.set(reward.id, reward)
        if (reward.kind === 'flag') context.flagRewards.add(reward.ref)
      }
      context.order.push(entry)
      const existing = context.quests.get(quest.id)
      if (existing === undefined) {
        context.quests.set(quest.id, entry)
        return
      }
      report(
        context,
        'error',
        'duplicate-quest-id',
        `quest id ${quote(quest.id)} is already used at ${existing.path}`,
        { quest: quest.id, path },
      )
    })
  })
  collectForeignDependents(context)
  return context
}

/** Records which steps are depended on from a different quest in the pack. */
function collectForeignDependents(context: Context): void {
  for (const entry of context.order) {
    for (const step of entry.quest.steps) {
      for (const { condition } of stepConditions(step)) {
        for (const variable of conditionVariables(condition)) {
          if (pathNamespace(variable) !== 'step') continue
          const rest = pathRest(variable)
          if (!rest.includes('#')) continue
          const dependents = context.foreignDependents.get(rest) ?? []
          const label = `${entry.quest.id}#${step.id}`
          if (!dependents.includes(label)) dependents.push(label)
          context.foreignDependents.set(rest, dependents)
        }
      }
    }
  }
}

function textValues(quest: Quest): Text[] {
  const found: Text[] = [quest.title]
  if (quest.summary !== undefined) found.push(quest.summary)
  for (const step of quest.steps) {
    found.push(step.title)
    if (step.journal !== undefined) found.push(step.journal)
    if (step.outcome?.title !== undefined) found.push(step.outcome.title)
  }
  return found
}

function checkTextKeys(context: Context): void {
  if (!context.strict) return
  let keyed = 0
  let literal = 0
  for (const entry of context.order) {
    for (const text of textValues(entry.quest)) {
      if (text.startsWith('@')) keyed += 1
      else literal += 1
    }
  }
  if (keyed === 0 || literal === 0) return
  report(
    context,
    'warning',
    'mixed-text-keys',
    `the pack mixes ${keyed} keyed and ${literal} literal texts, pick one`,
  )
}

function isShared(reward: Reward): boolean {
  return reward.ext?.['x-oqf.shared'] === true
}

function checkEventCollisions(context: Context): void {
  const byEvent = new Map<string, { quests: string[]; shared: boolean }>()
  for (const entry of context.order) {
    for (const reward of entry.quest.rewards) {
      if (reward.kind !== 'event') continue
      const seen = byEvent.get(reward.ref) ?? { quests: [], shared: false }
      if (!seen.quests.includes(entry.quest.id)) seen.quests.push(entry.quest.id)
      if (isShared(reward)) seen.shared = true
      byEvent.set(reward.ref, seen)
    }
  }
  for (const [event, seen] of byEvent) {
    if (seen.quests.length < 2 || seen.shared) continue
    report(
      context,
      'warning',
      'custom-event-collision',
      `event ${quote(event)} is emitted by ${list(seen.quests)} without an x-oqf.shared mark`,
      { quest: seen.quests[0] },
    )
  }
}

function checkExt(context: Context, ext: Ext | undefined, where: Where): void {
  if (ext === undefined) return
  for (const key of Object.keys(ext)) {
    const at = { ...where, path: `${where.path}.${key}` }
    if (!EXT_KEY_PATTERN.test(key)) {
      report(
        context,
        'error',
        'ext-key-invalid',
        `extension key ${quote(key)} is not of the form x-<namespace>.<key>`,
        at,
      )
      continue
    }
    if (!context.strict) continue
    const namespace = key.slice(2, key.indexOf('.'))
    if ((KNOWN_EXT_NAMESPACES as readonly string[]).includes(namespace)) continue
    report(
      context,
      'warning',
      'unknown-ext-namespace',
      `extension namespace ${quote(namespace)} is not one of ${list([...KNOWN_EXT_NAMESPACES])}`,
      at,
    )
  }
}

function checkDuplicates(context: Context, entry: QuestEntry): void {
  const quest = entry.quest.id
  const steps = new Set<string>()
  entry.quest.steps.forEach((step, index) => {
    const path = `${entry.path}.steps[${index}]`
    if (steps.has(step.id)) {
      report(context, 'error', 'duplicate-step-id', `step id ${quote(step.id)} is used twice`, {
        quest,
        step: step.id,
        path,
      })
    }
    steps.add(step.id)
  })
  const rewards = new Set<string>()
  entry.quest.rewards.forEach((reward, index) => {
    const path = `${entry.path}.rewards[${index}]`
    if (rewards.has(reward.id)) {
      report(
        context,
        'error',
        'duplicate-reward-id',
        `reward id ${quote(reward.id)} is used twice`,
        { quest, path },
      )
    }
    rewards.add(reward.id)
  })
  const outcomes = new Set<string>()
  entry.quest.steps.forEach((step, index) => {
    if (step.outcome === undefined) return
    const path = `${entry.path}.steps[${index}].outcome`
    if (outcomes.has(step.outcome.name)) {
      report(
        context,
        'error',
        'duplicate-outcome-name',
        `outcome name ${quote(step.outcome.name)} is used twice`,
        { quest, step: step.id, path },
      )
    }
    outcomes.add(step.outcome.name)
  })
}

function checkDictionaryRefs(context: Context, entry: QuestEntry): void {
  const quest = entry.quest.id
  const dictionaries = entry.document.dictionaries
  entry.quest.tags.forEach((tag, index) => {
    if (hasRef(dictionaries.tags, tag)) return
    report(
      context,
      'error',
      'unknown-dictionary-ref',
      `tag ${quote(tag)} is not in the tag dictionary`,
      { quest, path: `${entry.path}.tags[${index}]` },
    )
  })
  entry.quest.steps.forEach((step, index) => {
    const path = `${entry.path}.steps[${index}]`
    step.actors.forEach((actor, actorIndex) => {
      if (hasRef(dictionaries.actors, actor)) return
      report(
        context,
        'error',
        'unknown-dictionary-ref',
        `actor ${quote(actor)} is not in the actor dictionary`,
        { quest, step: step.id, path: `${path}.actors[${actorIndex}]` },
      )
    })
    if (step.location === undefined) return
    if (hasRef(dictionaries.locations, step.location)) return
    report(
      context,
      'error',
      'unknown-dictionary-ref',
      `location ${quote(step.location)} is not in the location dictionary`,
      { quest, step: step.id, path: `${path}.location` },
    )
  })
}

function checkRewards(context: Context, entry: QuestEntry): void {
  const quest = entry.quest.id
  entry.quest.rewards.forEach((reward, index) => {
    checkExt(context, reward.ext, { quest, path: `${entry.path}.rewards[${index}].ext` })
    if (reward.outcome === undefined) return
    if (entry.outcomes.has(reward.outcome)) return
    report(
      context,
      'error',
      'unknown-outcome-ref',
      `reward ${quote(reward.id)} is keyed to outcome ${quote(reward.outcome)}, which no step reaches`,
      { quest, path: `${entry.path}.rewards[${index}].outcome` },
    )
  })
  const users = new Map<string, string[]>()
  entry.quest.steps.forEach((step, index) => {
    step.rewards.forEach((id, rewardIndex) => {
      const path = `${entry.path}.steps[${index}].rewards[${rewardIndex}]`
      if (!entry.rewards.has(id)) {
        report(
          context,
          'error',
          'unknown-reward-ref',
          `reward ${quote(id)} is not in the quest reward catalog`,
          { quest, step: step.id, path },
        )
      }
      const seen = users.get(id) ?? []
      if (!seen.includes(step.id)) seen.push(step.id)
      users.set(id, seen)
    })
  })
  for (const [id, steps] of users) {
    if (steps.length < 2) continue
    report(
      context,
      'warning',
      'reward-id-reused',
      `reward ${quote(id)} is granted by ${steps.length} steps: ${list(steps)}`,
      { quest, step: steps[1], path: entry.path },
    )
  }
}

function checkVariable(context: Context, entry: QuestEntry, variable: string, where: Where): void {
  const namespace = pathNamespace(variable)
  const rest = pathRest(variable)
  if (!(VARIABLE_NAMESPACES as readonly string[]).includes(namespace)) {
    report(
      context,
      'error',
      'unknown-variable-namespace',
      `variable ${quote(variable)} reads unknown namespace ${quote(namespace)}`,
      where,
    )
    return
  }
  if (rest === '') {
    report(
      context,
      'error',
      'condition-invalid',
      `variable ${quote(variable)} has no name after the namespace`,
      where,
    )
    return
  }
  if (namespace === 'var') return
  if (namespace === 'param') {
    entry.usedParams.add(rest)
    if (entry.params.has(rest)) return
    report(
      context,
      'error',
      'unknown-param-ref',
      `$${rest} is not a parameter of this quest`,
      where,
    )
    return
  }
  if (namespace === 'time') {
    if ((TIME_VARIABLES as readonly string[]).includes(rest)) return
    report(
      context,
      'error',
      'unknown-time-variable',
      `variable ${quote(variable)} is not one of ${list(TIME_VARIABLES.map((name) => `time.${name}`))}`,
      where,
    )
    return
  }
  if (namespace === 'runs') {
    const [questId, ...outcomeParts] = rest.split('.')
    const target = context.quests.get(questId)
    if (target === undefined) {
      report(
        context,
        'error',
        'unknown-quest-ref',
        `quest ${quote(questId)} is not in this pack`,
        where,
      )
      return
    }
    if (outcomeParts.length === 0) return
    const name = outcomeParts.join('.')
    if (name === EXPIRED_OUTCOME || target.outcomes.has(name)) return
    report(
      context,
      'error',
      'unknown-outcome-ref',
      `quest ${quote(questId)} has no outcome named ${quote(name)}`,
      where,
    )
    return
  }
  if (namespace === 'streak') {
    const target = context.quests.get(rest)
    if (target === undefined) {
      report(
        context,
        'error',
        'unknown-quest-ref',
        `quest ${quote(rest)} is not in this pack`,
        where,
      )
      return
    }
    const cooldown = target.quest.cooldown
    if (cooldown !== undefined && isCalendarDuration(cooldown)) return
    report(
      context,
      'error',
      'streak-without-calendar-cooldown',
      `${quote(variable)} needs quest ${quote(rest)} to have a calendar cooldown (day, week or month)`,
      where,
    )
    return
  }
  if (namespace === 'flag') {
    if (!context.strict || context.flagRewards.has(rest)) return
    report(
      context,
      'warning',
      'unknown-flag',
      `flag ${quote(rest)} is never set by a reward in this pack`,
      where,
    )
    return
  }
  if (namespace === 'count') {
    if (entry.steps.has(rest)) return
    report(
      context,
      'error',
      'unknown-step-ref',
      `counter ${quote(variable)} names ${quote(rest)}, which is not a step of this quest`,
      where,
    )
    return
  }
  if (namespace === 'step') {
    if (!rest.includes('#')) {
      if (entry.steps.has(rest)) return
      report(
        context,
        'error',
        'unknown-step-ref',
        `step ${quote(rest)} is not a step of this quest`,
        where,
      )
      return
    }
    const [questId, stepId] = rest.split('#')
    const target = context.quests.get(questId)
    if (target === undefined) {
      report(
        context,
        'error',
        'unknown-quest-ref',
        `quest ${quote(questId)} is not in this pack`,
        where,
      )
      return
    }
    if (target.steps.has(stepId)) return
    report(
      context,
      'error',
      'unknown-step-ref',
      `step ${quote(stepId)} is not a step of quest ${quote(questId)}`,
      where,
    )
    return
  }
  if (namespace === 'quest') {
    if (context.quests.has(rest)) return
    report(context, 'error', 'unknown-quest-ref', `quest ${quote(rest)} is not in this pack`, where)
    return
  }
  const parts = rest.split('.')
  if (parts.length < 2) {
    report(
      context,
      'error',
      'unknown-outcome-ref',
      `variable ${quote(variable)} must be of the form outcome.<quest>.<name>`,
      where,
    )
    return
  }
  const questId = parts[0]
  const name = parts.slice(1).join('.')
  const target = context.quests.get(questId)
  if (target === undefined) {
    report(
      context,
      'error',
      'unknown-quest-ref',
      `quest ${quote(questId)} is not in this pack`,
      where,
    )
    return
  }
  if (target.outcomes.has(name)) return
  report(
    context,
    'error',
    'unknown-outcome-ref',
    `quest ${quote(questId)} has no outcome named ${quote(name)}`,
    where,
  )
}

const COMPARISONS = ['==', '!=', '<', '<=', '>', '>=', 'in']

/** A `var` read, as the path it names, or undefined for any other node. */
function variableOf(node: unknown): string | undefined {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined
  const path = (node as { var?: unknown }).var
  return typeof path === 'string' ? path : undefined
}

/** True when the node is a number, or a variable the runtime types as a number. */
function isNumeric(node: unknown, entry: QuestEntry): boolean {
  if (typeof node === 'number') return true
  const path = variableOf(node)
  if (path === undefined) return false
  const namespace = pathNamespace(path)
  if (namespace === 'count' || namespace === 'time' || namespace === 'runs') return true
  if (namespace === 'streak') return true
  if (namespace === 'param') return entry.params.get(pathRest(path))?.type === 'number'
  return false
}

/**
 * `time.*` is a number, so comparing it with anything else, or using it bare in
 * boolean position (which the parser sugars to `== true`), can never be meant.
 */
function checkTimeComparisons(
  context: Context,
  entry: QuestEntry,
  node: unknown,
  where: Where,
): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return
  const [operator, args] = Object.entries(node)[0] ?? []
  if (operator === undefined) return
  if (operator === 'var') return
  const parts = Array.isArray(args) ? args : [args]
  if (COMPARISONS.includes(operator) && parts.length === 2) {
    const [left, right] = parts
    const leftTime =
      variableOf(left) !== undefined && pathNamespace(variableOf(left) ?? '') === 'time'
    const rightTime =
      variableOf(right) !== undefined && pathNamespace(variableOf(right) ?? '') === 'time'
    const other = leftTime ? right : left
    const ok =
      operator === 'in'
        ? Array.isArray(other) && other.every((item) => typeof item === 'number')
        : isNumeric(other, entry)
    if ((leftTime || rightTime) && !ok) {
      report(
        context,
        'error',
        'time-not-number',
        `${quote(variableOf(leftTime ? left : right) ?? '')} is a number and cannot be compared with ${JSON.stringify(other)}`,
        where,
      )
    }
  }
  for (const part of parts) checkTimeComparisons(context, entry, part, where)
}

function checkConditionField(
  context: Context,
  entry: QuestEntry,
  condition: Condition,
  where: Where,
): void {
  for (const error of checkCondition(condition)) {
    if (error.message.includes(NAMESPACE_ERROR)) continue
    report(context, 'error', 'condition-invalid', error.message, where)
  }
  checkTimeComparisons(context, entry, condition, where)
  if (condition === true || condition === false) {
    report(
      context,
      'warning',
      'condition-constant',
      `condition is the constant ${String(condition)}`,
      where,
    )
  }
  for (const variable of conditionVariables(condition)) {
    checkVariable(context, entry, variable, where)
  }
}

function checkConditions(context: Context, entry: QuestEntry): void {
  const quest = entry.quest.id
  if (entry.quest.unlock !== undefined) {
    checkConditionField(context, entry, entry.quest.unlock, {
      quest,
      path: `${entry.path}.unlock`,
    })
  }
  entry.quest.steps.forEach((step, index) => {
    checkExt(context, step.ext, { quest, step: step.id, path: `${entry.path}.steps[${index}].ext` })
    for (const { field, condition } of stepConditions(step)) {
      checkConditionField(context, entry, condition, {
        quest,
        step: step.id,
        path: `${entry.path}.steps[${index}].${field}`,
      })
    }
  })
}

function checkGraph(context: Context, entry: QuestEntry): void {
  const quest = entry.quest.id
  const graph = stepGraph(entry.quest)
  const dependents = new Map<string, string[]>()
  for (const [from, to] of graph.edges) {
    const seen = dependents.get(from) ?? []
    if (!seen.includes(to)) seen.push(to)
    dependents.set(from, seen)
  }
  const dependentsOf = (id: string): string[] => [
    ...(dependents.get(id) ?? []),
    ...(context.foreignDependents.get(`${quest}#${id}`) ?? []),
  ]

  for (const cycle of findCycles(graph)) {
    for (const id of cycle) {
      if (entry.steps.get(id)?.repeat === true) continue
      report(
        context,
        'error',
        'cycle-without-repeat',
        `step ${quote(id)} can reach itself through ${list(cycle)} and is not marked repeat`,
        { quest, step: id, path: entry.stepPaths.get(id) },
      )
    }
  }

  const reachable = reachableSteps(entry.quest)
  const endings: Step[] = []
  for (const step of entry.quest.steps) {
    const path = entry.stepPaths.get(step.id)
    const blocked = dependentsOf(step.id)
    if (step.outcome !== undefined) {
      endings.push(step)
      if (blocked.length > 0) {
        report(
          context,
          'error',
          'outcome-with-dependents',
          `ending ${quote(step.id)} must be terminal but ${list(blocked)} depend on it`,
          { quest, step: step.id, path },
        )
      }
    } else if (blocked.length === 0 && step.rewards.length === 0) {
      report(
        context,
        'warning',
        'dead-end',
        `step ${quote(step.id)} has no outcome, no rewards and nothing depends on it`,
        { quest, step: step.id, path },
      )
    }
    if (!reachable.has(step.id)) {
      report(
        context,
        'warning',
        'unreachable-step',
        `no path from a start step reaches ${quote(step.id)}`,
        { quest, step: step.id, path },
      )
    }
  }

  const live = endings.filter((step) => reachable.has(step.id))
  if (live.length === 0) {
    report(
      context,
      context.strict ? 'error' : 'warning',
      'no-ending-reachable',
      `no path from a start step of ${quote(quest)} reaches an outcome`,
      { quest, path: entry.path },
    )
    return
  }
  const proven = reachableSteps(entry.quest, { ignoreVars: true })
  if (live.some((step) => proven.has(step.id))) return
  report(
    context,
    'warning',
    'ending-needs-var',
    `every path to an outcome of ${quote(quest)} passes through a var.* read, so completability cannot be proven`,
    { quest, path: entry.path },
  )
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? 'an' : 'a'
}

/** The parameter type each objective slot accepts, by the field holding the reference. */
const SLOT_TYPES: Record<string, string[]> = {
  actor: ['actor'],
  item: ['item'],
  location: ['location'],
  object: ['item', 'actor', 'location', 'string'],
  dialogue: ['string'],
  event: ['string'],
  count: ['number'],
}

function checkParamSlot(
  context: Context,
  entry: QuestEntry,
  slot: string,
  value: unknown,
  where: Where,
): void {
  if (!isParamRef(value)) return
  const name = paramRefName(value)
  entry.usedParams.add(name)
  const parameter = entry.params.get(name)
  if (parameter === undefined) {
    report(
      context,
      'error',
      'unknown-param-ref',
      `${value} is not a parameter of this quest`,
      where,
    )
    return
  }
  const accepted = SLOT_TYPES[slot] ?? []
  if (accepted.includes(parameter.type)) return
  report(
    context,
    'error',
    'param-type-mismatch',
    `${value} is ${article(parameter.type)} ${parameter.type} parameter and cannot stand for ${article(slot)} ${slot}`,
    where,
  )
}

function checkObjectiveParams(
  context: Context,
  entry: QuestEntry,
  objective: Objective,
  where: Where,
): void {
  const at = (slot: string): Where => ({ ...where, path: `${where.path}.${slot}` })
  switch (objective.kind) {
    case 'kill':
      checkParamSlot(context, entry, 'actor', objective.actor, at('actor'))
      checkParamSlot(context, entry, 'count', objective.count, at('count'))
      return
    case 'collect':
      checkParamSlot(context, entry, 'item', objective.item, at('item'))
      checkParamSlot(context, entry, 'count', objective.count, at('count'))
      return
    case 'reach':
      checkParamSlot(context, entry, 'location', objective.location, at('location'))
      return
    case 'talk':
      checkParamSlot(context, entry, 'actor', objective.actor, at('actor'))
      checkParamSlot(context, entry, 'dialogue', objective.dialogue, at('dialogue'))
      return
    case 'interact':
      checkParamSlot(context, entry, 'object', objective.object, at('object'))
      return
    case 'event':
      checkParamSlot(context, entry, 'event', objective.event, at('event'))
      checkParamSlot(context, entry, 'count', objective.count, at('count'))
      return
    default:
      return
  }
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/** Parameter names a text mentions as `{name}` placeholders. */
function placeholders(text: Text): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1])
}

function checkDuration(
  context: Context,
  value: string | undefined,
  what: string,
  where: Where,
): void {
  if (value === undefined || parseDuration(value) !== undefined) return
  report(
    context,
    'error',
    'duration-invalid',
    `${what} ${quote(value)} is not an ISO 8601 duration of weeks, days, hours, minutes and seconds, nor day, week or month`,
    where,
  )
}

function checkRecurrence(context: Context, entry: QuestEntry): void {
  const quest = entry.quest.id
  const { cooldown, expire } = entry.quest
  checkDuration(context, cooldown, 'cooldown', { quest, path: `${entry.path}.cooldown` })
  checkDuration(context, expire, 'expire', { quest, path: `${entry.path}.expire` })
  if (cooldown !== undefined && entry.quest.repeat !== true) {
    report(
      context,
      'error',
      'cooldown-without-repeat',
      `quest ${quote(quest)} has a cooldown but is not marked repeat`,
      { quest, path: `${entry.path}.cooldown` },
    )
  }

  const names = new Set<string>()
  ;(entry.quest.params ?? []).forEach((parameter, index) => {
    const path = `${entry.path}.params[${index}]`
    checkExt(context, parameter.ext, { quest, path: `${path}.ext` })
    if (names.has(parameter.name)) {
      report(
        context,
        'error',
        'duplicate-param-name',
        `parameter ${quote(parameter.name)} is declared twice`,
        { quest, path },
      )
    }
    names.add(parameter.name)
  })

  for (const name of placeholders(entry.quest.title)) entry.usedParams.add(name)
  for (const name of placeholders(entry.quest.summary ?? '')) entry.usedParams.add(name)

  const expireSpan = expire === undefined ? undefined : parseDuration(expire)
  entry.quest.steps.forEach((step, index) => {
    const path = `${entry.path}.steps[${index}]`
    const where = { quest, step: step.id, path }
    if (step.outcome?.name === EXPIRED_OUTCOME) {
      report(
        context,
        'error',
        'outcome-reserved',
        `outcome ${quote(EXPIRED_OUTCOME)} is reserved for the built-in outcome a quest reaches when it expires`,
        { ...where, path: `${path}.outcome` },
      )
    }
    checkDuration(context, step.deadline, 'deadline', { ...where, path: `${path}.deadline` })
    const deadlineSpan = step.deadline === undefined ? undefined : parseDuration(step.deadline)
    if (
      expireSpan?.kind === 'fixed' &&
      deadlineSpan?.kind === 'fixed' &&
      deadlineSpan.ms > expireSpan.ms
    ) {
      report(
        context,
        'warning',
        'deadline-after-expire',
        `deadline ${quote(step.deadline ?? '')} on step ${quote(step.id)} is longer than the quest's expire ${quote(expire ?? '')}, so the step can never run out first`,
        { ...where, path: `${path}.deadline` },
      )
    }
    if (step.objective !== undefined) {
      checkObjectiveParams(context, entry, step.objective, { ...where, path: `${path}.objective` })
    }
    if (step.failObjective !== undefined) {
      checkObjectiveParams(context, entry, step.failObjective, {
        ...where,
        path: `${path}.failObjective`,
      })
    }
    for (const text of [step.title, step.journal ?? '', step.outcome?.title ?? '']) {
      for (const name of placeholders(text)) entry.usedParams.add(name)
    }
  })
}

/** Runs after the conditions have been checked, so every `$name` read has been seen. */
function checkUnusedParams(context: Context, entry: QuestEntry): void {
  ;(entry.quest.params ?? []).forEach((parameter, index) => {
    if (entry.usedParams.has(parameter.name)) return
    report(
      context,
      'warning',
      'unused-param',
      `parameter ${quote(parameter.name)} is declared and never used`,
      { quest: entry.quest.id, path: `${entry.path}.params[${index}]` },
    )
  })
}

function checkQuest(context: Context, entry: QuestEntry): void {
  checkExt(context, entry.quest.ext, { quest: entry.quest.id, path: `${entry.path}.ext` })
  checkDuplicates(context, entry)
  checkDictionaryRefs(context, entry)
  checkRewards(context, entry)
  checkRecurrence(context, entry)
  checkConditions(context, entry)
  checkUnusedParams(context, entry)
  checkGraph(context, entry)
}

function run(docs: OqfDocument[], options: ValidateOptions): ValidationResult {
  const context = buildContext(docs, options)
  checkTextKeys(context)
  checkEventCollisions(context)
  for (const entry of context.order) checkQuest(context, entry)
  return {
    findings: context.findings,
    ok: !context.findings.some((finding) => finding.level === 'error'),
  }
}

/** Validate one document as a pack of one. */
export function validateDocument(
  doc: OqfDocument,
  options: ValidateOptions = {},
): ValidationResult {
  return run([doc], options)
}

/** Validate several documents as one pack: ids and references span all of them. */
export function validatePack(docs: OqfDocument[], options: ValidateOptions = {}): ValidationResult {
  return run(docs, options)
}
