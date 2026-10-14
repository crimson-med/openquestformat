/**
 * Writes the canonical model back out as compact lines.
 *
 * The normalization rules in docs/12-compact-spec.md are what make the round
 * trip byte stable: dictionaries in first-use order, parameters, then rewards, then steps,
 * conditions in their one canonical spelling, no trailing empty cells and `X`
 * lines sorted by namespace then key.
 */
import { formatCompletion, formatCondition } from '../condition/index.js'
import {
  type Ext,
  OQF_MAGIC,
  type OqfDocument,
  type Outcome,
  type Parameter,
  type Payload,
  type Quest,
  type Ref,
  type Reward,
  type Scalar,
  type Step,
} from '../model.js'
import { EXTRA_EXT_KEY } from './parse.js'

const EXT_KEY = /^x-([a-z0-9-]+)\.([A-Za-z0-9_.-]+)$/

/** A dictionary laid out in first-use order, with the index every ref cell uses. */
interface Interned {
  refs: Ref[]
  index: Map<string, number>
}

function escapeCell(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

/**
 * Payload level escapes. The cell level escapes run on top of these, so a
 * backslash written here reaches the line doubled and comes back intact.
 */
function escapePayload(text: string): string {
  return text.replace(/([\;=])/g, '\\$1')
}

function scalarText(value: Scalar): string {
  return typeof value === 'string' ? value : String(value)
}

function payloadCell(payload: Payload): string {
  return Object.entries(payload)
    .map(([name, value]) => `${escapePayload(name)}=${escapePayload(scalarText(value))}`)
    .join(';')
}

function record(type: string, cells: string[]): string {
  const kept = [...cells]
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop()
  return [type, ...kept.map(escapeCell)].join('\t')
}

function refCell(ref: Ref): string {
  return ref.name === undefined ? ref.id : `${ref.id}|${ref.name}`
}

function intern(entries: Ref[], used: string[]): Interned {
  const known = new Map<string, Ref>()
  for (const entry of entries) {
    if (!known.has(entry.id)) known.set(entry.id, entry)
  }
  const refs: Ref[] = []
  const index = new Map<string, number>()
  const push = (ref: Ref): void => {
    if (index.has(ref.id)) return
    index.set(ref.id, refs.length)
    refs.push(ref)
  }
  for (const id of used) push(known.get(id) ?? { id })
  for (const entry of entries) push(entry)
  return { refs, index }
}

function indexOf(dictionary: Interned, id: string, what: string): number {
  const found = dictionary.index.get(id)
  if (found === undefined) throw new Error(`cannot serialize ${what}: "${id}" is not interned`)
  return found
}

interface Used {
  actors: string[]
  locations: string[]
  items: string[]
  tags: string[]
}

/** First-use order: quests, then their steps, then their rewards. */
function usedIds(document: OqfDocument): Used {
  const used: Used = { actors: [], locations: [], items: [], tags: [] }
  for (const quest of document.quests) {
    used.tags.push(...quest.tags)
    for (const step of quest.steps) {
      used.actors.push(...step.actors)
      if (step.location !== undefined) used.locations.push(step.location)
      for (const objective of [step.objective, step.failObjective]) {
        if (objective !== undefined && objective.kind === 'collect') used.items.push(objective.item)
      }
    }
  }
  return used
}

/** The cells of a newer writer, handed straight back in the order they arrived. */
function extraCells(ext: Ext | undefined): string[] {
  const extra = ext?.[EXTRA_EXT_KEY]
  if (extra === undefined) return []
  if (typeof extra !== 'string') {
    throw new Error(`cannot serialize "${EXTRA_EXT_KEY}": expected TAB separated cells`)
  }
  return extra.split('\t')
}

function extLines(ext: Ext | undefined): string[] {
  if (ext === undefined) return []
  const entries: { namespace: string; name: string; value: Scalar | Payload }[] = []
  for (const [key, value] of Object.entries(ext)) {
    if (key === EXTRA_EXT_KEY) continue
    const match = EXT_KEY.exec(key)
    if (match === null) {
      throw new Error(`cannot serialize extension key "${key}", expected x-<namespace>.<key>`)
    }
    entries.push({ namespace: match[1], name: match[2], value })
  }
  entries.sort((left, right) =>
    left.namespace === right.namespace
      ? compare(left.name, right.name)
      : compare(left.namespace, right.namespace),
  )
  return entries.map((entry) =>
    record('X', [
      entry.namespace,
      entry.name,
      typeof entry.value === 'object'
        ? payloadCell(entry.value)
        : escapePayload(scalarText(entry.value)),
    ]),
  )
}

function compare(left: string, right: string): number {
  if (left < right) return -1
  return left > right ? 1 : 0
}

function outcomeCell(outcome: Outcome): string {
  const title = outcome.title === undefined ? '' : `|${outcome.title}`
  return `${outcome.failed === true ? '!' : ''}${outcome.name}${title}`
}

function questCells(quest: Quest, tags: Interned): string[] {
  return [
    quest.id,
    String(quest.version),
    quest.repeat === true ? 'r' : '',
    quest.tags.map((id) => String(indexOf(tags, id, 'a quest tag'))).join(','),
    quest.unlock === undefined ? '' : formatCondition(quest.unlock),
    quest.title,
    quest.summary ?? '',
    quest.cooldown ?? '',
    quest.expire ?? '',
  ]
}

function paramCells(parameter: Parameter): string[] {
  return [parameter.name, parameter.type, parameter.constraint ?? '']
}

function rewardCells(reward: Reward): string[] {
  return [
    reward.id,
    reward.kind,
    reward.ref,
    reward.amount === undefined ? '' : String(reward.amount),
    reward.outcome ?? '',
    reward.payload === undefined ? '' : payloadCell(reward.payload),
  ]
}

function stepCells(
  step: Step,
  rewards: Map<string, number>,
  actors: Interned,
  locations: Interned,
): string[] {
  const flags = `${step.start === true ? 's' : ''}${step.optional === true ? 'o' : ''}${
    step.repeat === true ? 'r' : ''
  }`
  return [
    step.id,
    flags,
    step.unlock === undefined ? '' : formatCondition(step.unlock),
    step.activate === undefined ? '' : formatCondition(step.activate),
    formatCompletion({ objective: step.objective, condition: step.complete }),
    formatCompletion({ objective: step.failObjective, condition: step.fail }),
    step.outcome === undefined ? '' : outcomeCell(step.outcome),
    step.rewards
      .map((id) => {
        const found = rewards.get(id)
        if (found === undefined) {
          throw new Error(`cannot serialize step "${step.id}": unknown reward "${id}"`)
        }
        return String(found)
      })
      .join(','),
    step.dialogue === undefined ? '' : `${step.dialogue.provider}:${step.dialogue.ref}`,
    step.location === undefined ? '' : String(indexOf(locations, step.location, 'a step location')),
    step.actors.map((id) => String(indexOf(actors, id, 'a step actor'))).join(','),
    step.title,
    step.journal ?? '',
    step.deadline ?? '',
  ]
}

/** Render the canonical model as normalized compact text, trailing LF included. */
export function toCompact(document: OqfDocument): string {
  const used = usedIds(document)
  const actors = intern(document.dictionaries.actors, used.actors)
  const locations = intern(document.dictionaries.locations, used.locations)
  const tags = intern(document.dictionaries.tags, used.tags)
  // No cell holds an item index, so an item nothing declares stays out of the dictionary.
  const declared = new Set(document.dictionaries.items.map((entry) => entry.id))
  const items = intern(
    document.dictionaries.items,
    used.items.filter((id) => declared.has(id)),
  )

  const lines: string[] = [OQF_MAGIC]
  for (const [type, dictionary] of [
    ['A', actors],
    ['L', locations],
    ['I', items],
    ['T', tags],
  ] as const) {
    if (dictionary.refs.length > 0) lines.push(record(type, dictionary.refs.map(refCell)))
  }

  for (const quest of document.quests) {
    lines.push(record('Q', [...questCells(quest, tags), ...extraCells(quest.ext)]))
    lines.push(...extLines(quest.ext))

    for (const parameter of quest.params ?? []) {
      lines.push(record('P', [...paramCells(parameter), ...extraCells(parameter.ext)]))
      lines.push(...extLines(parameter.ext))
    }

    const rewards = new Map<string, number>()
    for (const [position, reward] of quest.rewards.entries()) {
      if (!rewards.has(reward.id)) rewards.set(reward.id, position)
    }

    for (const reward of quest.rewards) {
      lines.push(record('R', [...rewardCells(reward), ...extraCells(reward.ext)]))
      lines.push(...extLines(reward.ext))
    }
    for (const step of quest.steps) {
      lines.push(
        record('S', [...stepCells(step, rewards, actors, locations), ...extraCells(step.ext)]),
      )
      lines.push(...extLines(step.ext))
    }
  }

  return `${lines.join('\n')}\n`
}
