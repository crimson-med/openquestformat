/**
 * Writes the canonical model as the JSON form.
 *
 * Key order is the declaration order in model.ts, so two documents with the
 * same content produce byte identical output.
 */
import {
  type Condition,
  type DialogueBinding,
  type Dictionaries,
  type Ext,
  OQF_MAJOR,
  type Objective,
  type OqfDocument,
  type Outcome,
  type Parameter,
  type Payload,
  type Quest,
  type Ref,
  type Reward,
  type Step,
} from '../model.js'

type JsonRecord = Record<string, unknown>

export interface JsonOptions {
  /** Two space indentation and a trailing newline. Defaults to true. */
  pretty?: boolean
}

function prune(value: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

/** Booleans are only written when true, so `false` and absent look the same. */
function flag(value: boolean | undefined): true | undefined {
  return value === true ? true : undefined
}

/** Lists that default to empty are only written when they hold something. */
function list(value: readonly string[] | undefined): string[] | undefined {
  return value !== undefined && value.length > 0 ? [...value] : undefined
}

function copyPayload(payload: Payload | undefined): JsonRecord | undefined {
  return payload === undefined ? undefined : { ...payload }
}

function copyExt(ext: Ext | undefined): JsonRecord | undefined {
  if (ext === undefined) return undefined
  const entries = Object.entries(ext)
  if (entries.length === 0) return undefined
  return Object.fromEntries(
    entries.map(([name, value]) => [
      name,
      typeof value === 'object' && value !== null ? { ...value } : value,
    ]),
  )
}

function copyCondition(condition: Condition): unknown {
  if (Array.isArray(condition)) return [...condition]
  if (typeof condition !== 'object' || condition === null) return condition

  const entry = Object.entries(condition)[0]
  const operator = entry[0]
  const operands = entry[1]
  if (operator === 'var') return { var: operands }
  return { [operator]: (operands as Condition[]).map(copyCondition) }
}

function writeCondition(condition: Condition | undefined): unknown {
  return condition === undefined ? undefined : copyCondition(condition)
}

function writeRef(ref: Ref): JsonRecord {
  return prune({ id: ref.id, name: ref.name })
}

function writeDictionaries(dictionaries: Dictionaries): JsonRecord {
  return {
    actors: dictionaries.actors.map(writeRef),
    locations: dictionaries.locations.map(writeRef),
    items: dictionaries.items.map(writeRef),
    tags: dictionaries.tags.map(writeRef),
  }
}

function writeObjective(objective: Objective): JsonRecord {
  switch (objective.kind) {
    case 'kill':
      return prune({ kind: objective.kind, actor: objective.actor, count: objective.count })
    case 'collect':
      return prune({ kind: objective.kind, item: objective.item, count: objective.count })
    case 'reach':
      return { kind: objective.kind, location: objective.location }
    case 'talk':
      return prune({ kind: objective.kind, actor: objective.actor, dialogue: objective.dialogue })
    case 'interact':
      return { kind: objective.kind, object: objective.object }
    case 'event':
      return prune({ kind: objective.kind, event: objective.event, count: objective.count })
    default:
      return { kind: objective.kind, custom: objective.custom, args: [...objective.args] }
  }
}

function writeParameter(parameter: Parameter): JsonRecord {
  return prune({
    name: parameter.name,
    type: parameter.type,
    constraint: parameter.constraint,
    ext: copyExt(parameter.ext),
  })
}

function writeOutcome(outcome: Outcome): JsonRecord {
  return prune({ name: outcome.name, failed: flag(outcome.failed), title: outcome.title })
}

function writeDialogue(dialogue: DialogueBinding): JsonRecord {
  return { provider: dialogue.provider, ref: dialogue.ref }
}

function writeReward(reward: Reward): JsonRecord {
  return prune({
    id: reward.id,
    kind: reward.kind,
    ref: reward.ref,
    amount: reward.amount,
    outcome: reward.outcome,
    payload: copyPayload(reward.payload),
    ext: copyExt(reward.ext),
  })
}

function writeStep(step: Step): JsonRecord {
  return prune({
    id: step.id,
    title: step.title,
    journal: step.journal,
    start: flag(step.start),
    unlock: writeCondition(step.unlock),
    activate: writeCondition(step.activate),
    objective: step.objective === undefined ? undefined : writeObjective(step.objective),
    complete: writeCondition(step.complete),
    failObjective:
      step.failObjective === undefined ? undefined : writeObjective(step.failObjective),
    fail: writeCondition(step.fail),
    deadline: step.deadline,
    optional: flag(step.optional),
    repeat: flag(step.repeat),
    outcome: step.outcome === undefined ? undefined : writeOutcome(step.outcome),
    rewards: list(step.rewards),
    dialogue: step.dialogue === undefined ? undefined : writeDialogue(step.dialogue),
    location: step.location,
    actors: list(step.actors),
    ext: copyExt(step.ext),
  })
}

function writeQuest(quest: Quest): JsonRecord {
  return prune({
    id: quest.id,
    version: quest.version,
    title: quest.title,
    summary: quest.summary,
    tags: list(quest.tags),
    repeat: flag(quest.repeat),
    unlock: writeCondition(quest.unlock),
    cooldown: quest.cooldown,
    expire: quest.expire,
    params:
      quest.params !== undefined && quest.params.length > 0
        ? quest.params.map(writeParameter)
        : undefined,
    steps: quest.steps.map(writeStep),
    rewards: quest.rewards.length > 0 ? quest.rewards.map(writeReward) : undefined,
    ext: copyExt(quest.ext),
  })
}

/** Convert the model to a plain JSON value, ready for JSON.stringify. */
export function toJsonValue(doc: OqfDocument): unknown {
  return {
    oqf: OQF_MAJOR,
    dictionaries: writeDictionaries(doc.dictionaries),
    quests: doc.quests.map(writeQuest),
  }
}

/** Serialize the model as JSON text. Pretty by default, two spaces and a trailing newline. */
export function toJson(doc: OqfDocument, options: JsonOptions = {}): string {
  const value = toJsonValue(doc)
  if (options.pretty === false) return JSON.stringify(value)
  return `${JSON.stringify(value, null, 2)}\n`
}
