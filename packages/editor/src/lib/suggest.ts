/**
 * Guided input for condition and completion cells: the names the pack already
 * uses, offered as you type. No React here, the field components call
 * `suggest` on every keystroke and render whatever comes back.
 *
 * The vocabulary is built once per render from the whole editor state. It
 * lists ids that exist, not ids that would be valid, so a suggestion is always
 * something the validator will accept.
 */
import { type Condition, OBJECTIVE_KINDS, STEP_STATES } from '@oqf/core'
import { findQuest, outcomeNames } from '../store/selectors'
import type { EditorState } from '../store/types'

export interface Vocabulary {
  /** Step ids of the current quest, for `step.` and `count.`. */
  steps: string[]
  quests: string[]
  /** Outcome names per quest id. */
  outcomes: Record<string, string[]>
  flags: string[]
  actors: string[]
  items: string[]
  locations: string[]
  /** Objects named by `interact` objectives. */
  objects: string[]
  /** Event names from `event` objectives and event rewards. */
  events: string[]
  /** Kinds named by `custom` objectives. */
  customKinds: string[]
  /** Paths already read under `var.`, without the namespace. */
  vars: string[]
  conversations: string[]
}

export interface Suggestion {
  label: string
  /** Replaces the text in `range`. */
  insert: string
  /** Short category, for example "step", "flag", "keyword". */
  detail: string
  range: { start: number; end: number }
}

export type SuggestMode = 'condition' | 'completion'

const LIMIT = 12
const TOKEN_CHAR = /[A-Za-z0-9_.#]/
const OBJECTIVES = ['collect', 'kill', 'reach', 'talk', 'interact', 'event', 'custom']
const NAMESPACES = ['step', 'count', 'flag', 'outcome', 'quest', 'var']
const KEYWORDS = ['and', 'or', 'not']
const LITERALS = ['true', 'false']
const STEP_OPERATORS = ['==', '!=']
const COUNT_OPERATORS = ['>=', '>', '==', '<', '<=']
/** A `step.x` path followed by whitespace, right before the token. */
const AFTER_STEP_PATH = /(^|[\s(])step\.[A-Za-z0-9_#.-]+\s+$/
/** A `step.x` path, an equality operator and optional whitespace, right before the token. */
const AFTER_STEP_COMPARISON = /(^|[\s(])step\.[A-Za-z0-9_#.-]+\s*(==|!=)\s*$/
const AFTER_COUNT_PATH = /(^|[\s(])count\.[A-Za-z0-9_#.-]+\s+$/

function collectPaths(condition: Condition | undefined, into: (path: string) => void): void {
  if (condition === undefined || condition === null || typeof condition !== 'object') return
  if (Array.isArray(condition)) return
  const record = condition as Record<string, unknown>
  if (typeof record.var === 'string') {
    into(record.var)
    return
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const part of value) collectPaths(part as Condition, into)
    } else {
      collectPaths(value as Condition, into)
    }
  }
}

function add(set: Set<string>, value: string | undefined): void {
  if (value !== undefined && value !== '') set.add(value)
}

/** Every name the pack already uses, keyed by where a condition or objective may read it. */
export function buildVocabulary(state: EditorState, questId: string | undefined): Vocabulary {
  const flags = new Set<string>()
  const objects = new Set<string>()
  const events = new Set<string>()
  const customKinds = new Set<string>()
  const vars = new Set<string>()
  const outcomes: Record<string, string[]> = {}

  const readPath = (path: string) => {
    const dot = path.indexOf('.')
    if (dot < 0) return
    const namespace = path.slice(0, dot)
    const rest = path.slice(dot + 1)
    if (namespace === 'flag') add(flags, rest)
    if (namespace === 'var') add(vars, rest)
  }

  for (const quest of state.quests.quests) {
    outcomes[quest.id] = outcomeNames(quest)
    collectPaths(quest.unlock, readPath)
    for (const reward of quest.rewards) {
      if (reward.kind === 'flag') add(flags, reward.ref)
      if (reward.kind === 'event') add(events, reward.ref)
    }
    for (const step of quest.steps) {
      collectPaths(step.unlock, readPath)
      collectPaths(step.activate, readPath)
      collectPaths(step.complete, readPath)
      collectPaths(step.fail, readPath)
      for (const objective of [step.objective, step.failObjective]) {
        if (objective === undefined) continue
        if (objective.kind === 'interact') add(objects, objective.object)
        if (objective.kind === 'event') add(events, objective.event)
        if (objective.kind === 'custom') add(customKinds, objective.custom)
      }
    }
  }

  for (const conversation of state.dialogues.conversations) {
    for (const node of conversation.nodes) {
      for (const entry of node.set ?? []) add(flags, entry.flag)
      for (const choice of node.choices ?? []) {
        for (const entry of choice.set ?? []) add(flags, entry.flag)
        collectPaths(choice.condition, readPath)
      }
    }
  }

  const dictionaries = state.quests.dictionaries
  return {
    steps: findQuest(state, questId)?.steps.map((step) => step.id) ?? [],
    quests: state.quests.quests.map((quest) => quest.id),
    outcomes,
    flags: [...flags],
    actors: dictionaries.actors.map((ref) => ref.id),
    items: dictionaries.items.map((ref) => ref.id),
    locations: dictionaries.locations.map((ref) => ref.id),
    objects: [...objects],
    events: [...events],
    customKinds: [...customKinds],
    vars: [...vars],
    conversations: state.dialogues.conversations.map((conversation) => conversation.id),
  }
}

interface Candidate {
  label: string
  insert: string
  detail: string
  /** What the typed token is matched against. Defaults to the label. */
  match: string
}

function candidate(insert: string, detail: string, label = insert, match = label): Candidate {
  return { label, insert, detail, match }
}

/** Words that a space should follow, so the next suggestions open at once. */
function word(text: string, detail: string): Candidate {
  return candidate(`${text} `, detail, text)
}

function namespaced(namespace: string, vocabulary: Vocabulary): Candidate[] {
  switch (namespace) {
    case 'step':
    case 'count':
      return vocabulary.steps.map((id) => candidate(`${namespace}.${id}`, 'step'))
    case 'flag':
      return vocabulary.flags.map((flag) => candidate(`flag.${flag}`, 'flag'))
    case 'outcome':
      return Object.entries(vocabulary.outcomes).flatMap(([quest, names]) =>
        names.map((name) => candidate(`outcome.${quest}.${name}`, 'outcome')),
      )
    case 'quest':
      return vocabulary.quests.map((id) => candidate(`quest.${id}`, 'quest'))
    case 'var':
      return vocabulary.vars.map((path) => candidate(`var.${path}`, 'var'))
    default:
      return []
  }
}

function stepStates(): Candidate[] {
  return STEP_STATES.map((state) => candidate(`"${state}"`, 'state', `"${state}"`, state))
}

function conditionCandidates(token: string, before: string, vocabulary: Vocabulary): Candidate[] {
  const dot = token.indexOf('.')
  if (dot >= 0) return namespaced(token.slice(0, dot), vocabulary)
  if (AFTER_STEP_COMPARISON.test(before)) return stepStates()
  if (AFTER_STEP_PATH.test(before)) {
    return [...STEP_OPERATORS.map((op) => word(op, 'operator')), ...stepStates()]
  }
  if (AFTER_COUNT_PATH.test(before)) return COUNT_OPERATORS.map((op) => word(op, 'operator'))
  return [
    ...NAMESPACES.map((namespace) => candidate(`${namespace}.`, 'namespace')),
    ...KEYWORDS.map((keyword) => word(keyword, 'keyword')),
    ...LITERALS.map((literal) => candidate(literal, 'literal')),
  ]
}

function refCandidates(kind: string, vocabulary: Vocabulary): Candidate[] {
  switch (kind) {
    case 'collect':
      return vocabulary.items.map((id) => candidate(id, 'item'))
    case 'kill':
    case 'talk':
      return vocabulary.actors.map((id) => candidate(id, 'actor'))
    case 'reach':
      return vocabulary.locations.map((id) => candidate(id, 'location'))
    case 'interact':
      return vocabulary.objects.map((id) => candidate(id, 'object'))
    case 'event':
      return vocabulary.events.map((name) => candidate(name, 'event'))
    case 'custom':
      return vocabulary.customKinds.map((name) => candidate(name, 'custom'))
    default:
      return []
  }
}

function completionCandidates(token: string, before: string, vocabulary: Vocabulary): Candidate[] {
  const words = before.split(/\s+/).filter((entry) => entry !== '')
  if (words.length === 0) {
    return [
      ...OBJECTIVES.map((kind) => word(kind, 'objective')),
      ...conditionCandidates(token, before, vocabulary),
    ]
  }
  const kind = words[0].toLowerCase()
  if (!(OBJECTIVE_KINDS as readonly string[]).includes(kind)) {
    return conditionCandidates(token, before, vocabulary)
  }
  const pastObjective = words.some((entry, index) => index > 0 && entry.toLowerCase() === 'and')
  if (pastObjective) return conditionCandidates(token, before, vocabulary)
  if (words.length === 1) return refCandidates(kind, vocabulary)
  const candidates: Candidate[] = []
  if (kind === 'talk' && words.length === 2) {
    candidates.push(...vocabulary.conversations.map((id) => candidate(id, 'conversation')))
  }
  candidates.push(word('and', 'keyword'))
  return candidates
}

function insideString(text: string, caret: number): boolean {
  let inside = false
  for (let at = 0; at < caret; at += 1) {
    const character = text[at]
    if (character === '\\' && inside) {
      at += 1
      continue
    }
    if (character === '"') inside = !inside
  }
  return inside
}

/** Suggestions for the token ending at `caret`, best first, at most twelve. */
export function suggest(
  text: string,
  caret: number,
  vocabulary: Vocabulary,
  mode: SuggestMode,
): Suggestion[] {
  const at = Math.max(0, Math.min(caret, text.length))
  if (insideString(text, at)) return []
  let start = at
  while (start > 0 && TOKEN_CHAR.test(text[start - 1])) start -= 1
  const token = text.slice(start, at)
  const before = text.slice(0, start)
  const candidates =
    mode === 'completion'
      ? completionCandidates(token, before, vocabulary)
      : conditionCandidates(token, before, vocabulary)

  const lowered = token.toLowerCase()
  const exact: Candidate[] = []
  const loose: Candidate[] = []
  const seen = new Set<string>()
  for (const entry of candidates) {
    if (seen.has(entry.insert)) continue
    seen.add(entry.insert)
    if (entry.match.startsWith(token)) exact.push(entry)
    else if (entry.match.toLowerCase().startsWith(lowered)) loose.push(entry)
  }
  const range = { start, end: at }
  return [...exact, ...loose].slice(0, LIMIT).map(({ label, insert, detail }) => ({
    label,
    insert,
    detail,
    range,
  }))
}
