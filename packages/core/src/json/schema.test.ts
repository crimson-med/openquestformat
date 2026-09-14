import { describe, expect, it } from 'vitest'
import { CONDITION_OPERATORS, OBJECTIVE_KINDS, OQF_MAJOR, REWARD_KINDS } from '../model.js'
import { fullDocument } from './fixtures.js'
import { OQF_JSON_SCHEMA, schemaJson } from './schema.js'
import { toJsonValue } from './serialize.js'

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function defs(): Json {
  return OQF_JSON_SCHEMA.$defs as Json
}

function def(name: string): Json {
  const found = defs()[name]
  expect(found, `missing $defs/${name}`).toBeDefined()
  return found as Json
}

function props(name: string): Json {
  return def(name).properties as Json
}

/** The object branch of a definition written as anyOf, such as Ref. */
function objectBranch(name: string): Json {
  const branches = def(name).anyOf as Json[]
  return branches.find((branch) => branch.type === 'object') as Json
}

function objectiveBranch(kind: string): Json {
  const branches = def('Objective').oneOf as Json[]
  return branches.find(
    (branch) => ((branch.properties as Json).kind as Json).const === kind,
  ) as Json
}

describe('OQF_JSON_SCHEMA', () => {
  it('declares the 2020-12 dialect and an id', () => {
    expect(OQF_JSON_SCHEMA.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(typeof OQF_JSON_SCHEMA.$id).toBe('string')
  })

  it('describes the document envelope', () => {
    expect(OQF_JSON_SCHEMA.type).toBe('object')
    expect(OQF_JSON_SCHEMA.required).toEqual(['oqf', 'quests'])
    expect(OQF_JSON_SCHEMA.additionalProperties).toBe(false)
    const root = OQF_JSON_SCHEMA.properties as Json
    expect((root.oqf as Json).const).toBe(OQF_MAJOR)
    expect((root.dictionaries as Json).$ref).toBe('#/$defs/Dictionaries')
    expect(((root.quests as Json).items as Json).$ref).toBe('#/$defs/Quest')
  })

  it('carries every definition the format needs', () => {
    expect(Object.keys(defs())).toEqual(
      expect.arrayContaining([
        'Condition',
        'Objective',
        'Reward',
        'Outcome',
        'DialogueBinding',
        'Step',
        'Quest',
        'Ref',
        'Ext',
        'Payload',
      ]),
    )
  })

  it('declares every quest field', () => {
    expect(Object.keys(props('Quest'))).toEqual([
      'id',
      'version',
      'title',
      'summary',
      'tags',
      'repeat',
      'unlock',
      'steps',
      'rewards',
      'ext',
    ])
    expect(def('Quest').required).toEqual(['id', 'version', 'title', 'steps'])
  })

  it('declares every step field', () => {
    expect(Object.keys(props('Step'))).toEqual([
      'id',
      'title',
      'journal',
      'start',
      'unlock',
      'activate',
      'objective',
      'complete',
      'failObjective',
      'fail',
      'optional',
      'repeat',
      'outcome',
      'rewards',
      'dialogue',
      'location',
      'actors',
      'ext',
    ])
    expect(def('Step').required).toEqual(['id', 'title'])
  })

  it('declares every reward, outcome, dialogue and reference field', () => {
    expect(Object.keys(props('Reward'))).toEqual([
      'id',
      'kind',
      'ref',
      'amount',
      'outcome',
      'payload',
      'ext',
    ])
    expect(Object.keys(props('Outcome'))).toEqual(['name', 'failed', 'title'])
    expect(Object.keys(props('DialogueBinding'))).toEqual(['provider', 'ref'])
    expect(Object.keys(objectBranch('Ref').properties as Json)).toEqual(['id', 'name'])
    expect(Object.keys(props('Dictionaries'))).toEqual(['actors', 'locations', 'items', 'tags'])
  })

  it('mirrors the model enums', () => {
    expect((props('Reward').kind as Json).enum).toEqual([...REWARD_KINDS])
    const kinds = (def('Objective').oneOf as Json[]).map(
      (branch) => ((branch.properties as Json).kind as Json).const,
    )
    expect(kinds).toEqual([...OBJECTIVE_KINDS])
  })

  it('declares every objective field per kind', () => {
    const fields: Record<string, string[]> = {
      kill: ['kind', 'actor', 'count'],
      collect: ['kind', 'item', 'count'],
      reach: ['kind', 'location'],
      talk: ['kind', 'actor', 'dialogue'],
      interact: ['kind', 'object'],
      event: ['kind', 'event', 'count'],
      custom: ['kind', 'custom', 'args'],
    }
    for (const [kind, expected] of Object.entries(fields)) {
      const branch = objectiveBranch(kind)
      expect(Object.keys(branch.properties as Json), kind).toEqual(expected)
      expect(branch.additionalProperties, kind).toBe(false)
    }
  })

  it('describes conditions as scalars, scalar lists or a single operator object', () => {
    const branches = def('Condition').anyOf as Json[]
    expect(branches).toHaveLength(3)
    expect(branches[0].$ref).toBe('#/$defs/Scalar')
    expect((branches[1].items as Json).$ref).toBe('#/$defs/Scalar')

    const operators = branches[2]
    expect(operators.minProperties).toBe(1)
    expect(operators.maxProperties).toBe(1)
    expect(operators.additionalProperties).toBe(false)
    expect(Object.keys(operators.properties as Json)).toEqual([...CONDITION_OPERATORS])
  })

  it('pins the arity of every condition operator', () => {
    const operators = (def('Condition').anyOf as Json[])[2].properties as Json
    const arity: Record<string, [number, number | undefined]> = {
      and: [1, undefined],
      or: [1, undefined],
      '!': [1, 1],
      '==': [2, 2],
      '!=': [2, 2],
      '<': [2, 2],
      '<=': [2, 2],
      '>': [2, 2],
      '>=': [2, 2],
      in: [2, 2],
    }
    for (const [operator, [min, max]] of Object.entries(arity)) {
      const node = operators[operator] as Json
      expect(node.minItems, operator).toBe(min)
      expect(node.maxItems, operator).toBe(max)
      expect((node.items as Json).$ref, operator).toBe('#/$defs/Condition')
    }
    expect((operators.var as Json).type).toBe('string')
  })

  it('closes every object except the extension bags and payloads', () => {
    for (const name of ['Dictionaries', 'Reward', 'Outcome', 'DialogueBinding', 'Step', 'Quest']) {
      expect(def(name).additionalProperties, name).toBe(false)
    }
    expect(objectBranch('Ref').additionalProperties).toBe(false)
    expect(def('Ext').additionalProperties).not.toBe(false)
    expect(def('Payload').additionalProperties).toEqual({ $ref: '#/$defs/Scalar' })
    expect((def('Ext').propertyNames as Json).pattern).toBe('^x-[a-z0-9-]+\\.[A-Za-z0-9_.-]+$')
    expect((props('Quest').ext as Json).$ref).toBe('#/$defs/Ext')
    expect((props('Step').ext as Json).$ref).toBe('#/$defs/Ext')
    expect((props('Reward').ext as Json).$ref).toBe('#/$defs/Ext')
  })
})

describe('schemaJson', () => {
  it('pretty prints with two spaces', () => {
    const text = schemaJson()
    expect(text.split('\n')[1]).toBe('  "$schema": "https://json-schema.org/draft/2020-12/schema",')
  })

  it('parses back to the same object', () => {
    expect(JSON.parse(schemaJson())).toEqual(OQF_JSON_SCHEMA)
  })
})

describe('hand walk of a full document against the schema', () => {
  const document = toJsonValue(fullDocument()) as Json

  function declared(value: Json, schema: Json, path: string): void {
    const allowed = Object.keys(schema.properties as Json)
    for (const name of Object.keys(value)) {
      expect(allowed, `${path}.${name} is not declared in the schema`).toContain(name)
    }
  }

  function walkExt(value: Json, path: string): void {
    const pattern = new RegExp((def('Ext').propertyNames as Json).pattern as string)
    for (const name of Object.keys(value)) {
      expect(pattern.test(name), `${path}.${name}`).toBe(true)
    }
  }

  it('declares every key the serializer writes', () => {
    declared(document, OQF_JSON_SCHEMA, 'document')

    const dictionaries = document.dictionaries as Json
    declared(dictionaries, def('Dictionaries'), 'dictionaries')
    for (const [section, refs] of Object.entries(dictionaries)) {
      for (const [index, ref] of (refs as Json[]).entries()) {
        declared(ref, objectBranch('Ref'), `dictionaries.${section}[${index}]`)
      }
    }

    for (const [questIndex, quest] of (document.quests as Json[]).entries()) {
      const questPath = `quests[${questIndex}]`
      declared(quest, def('Quest'), questPath)
      if (isRecord(quest.ext)) walkExt(quest.ext, `${questPath}.ext`)

      for (const [stepIndex, step] of (quest.steps as Json[]).entries()) {
        const stepPath = `${questPath}.steps[${stepIndex}]`
        declared(step, def('Step'), stepPath)
        if (isRecord(step.ext)) walkExt(step.ext, `${stepPath}.ext`)
        if (isRecord(step.outcome)) declared(step.outcome, def('Outcome'), `${stepPath}.outcome`)
        if (isRecord(step.dialogue)) {
          declared(step.dialogue, def('DialogueBinding'), `${stepPath}.dialogue`)
        }
        if (isRecord(step.objective)) {
          declared(step.objective, objectiveBranch(step.objective.kind as string), stepPath)
        }
      }

      for (const [rewardIndex, reward] of ((quest.rewards ?? []) as Json[]).entries()) {
        const rewardPath = `${questPath}.rewards[${rewardIndex}]`
        declared(reward, def('Reward'), rewardPath)
        if (isRecord(reward.ext)) walkExt(reward.ext, `${rewardPath}.ext`)
        expect((def('Reward').properties as Json).kind).toHaveProperty('enum')
      }
    }
  })

  it('covers every objective kind and reward kind in the fixture', () => {
    const quest = (document.quests as Json[])[0]
    const objectives = (quest.steps as Json[])
      .map((step) => (step.objective as Json | undefined)?.kind)
      .filter((kind): kind is string => kind !== undefined)
    expect(new Set(objectives)).toEqual(new Set(OBJECTIVE_KINDS))

    const rewards = (quest.rewards as Json[]).map((reward) => reward.kind as string)
    expect(new Set(rewards)).toEqual(new Set(REWARD_KINDS))
  })
})
