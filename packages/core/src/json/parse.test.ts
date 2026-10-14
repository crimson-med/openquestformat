import { describe, expect, it } from 'vitest'
import { fullDocument, minimalDocument } from './fixtures.js'
import { JsonFormatError, fromJsonValue, parseJson } from './parse.js'
import { toJson, toJsonValue } from './serialize.js'

type Json = Record<string, unknown>

function baseJson(): Json {
  return {
    oqf: 1,
    quests: [{ id: 'q', version: 1, title: 'Q', steps: [{ id: 's', title: 'S' }] }],
  }
}

function quests(value: Json): Json[] {
  return value.quests as Json[]
}

function withQuest(patch: Json): Json {
  const value = baseJson()
  Object.assign(quests(value)[0], patch)
  return value
}

function withStep(patch: Json): Json {
  const value = baseJson()
  Object.assign((quests(value)[0].steps as Json[])[0], patch)
  return value
}

function caught(run: () => unknown): JsonFormatError {
  try {
    run()
  } catch (error) {
    if (error instanceof JsonFormatError) return error
    throw error
  }
  throw new Error('expected a JsonFormatError, nothing was thrown')
}

function failsAt(value: unknown, path: string): JsonFormatError {
  const error = caught(() => fromJsonValue(value))
  expect(error.path).toBe(path)
  return error
}

describe('fromJsonValue', () => {
  it('reads the minimal document', () => {
    expect(fromJsonValue(baseJson())).toEqual({
      dictionaries: { actors: [], locations: [], items: [], tags: [] },
      quests: [
        {
          id: 'q',
          version: 1,
          title: 'Q',
          tags: [],
          steps: [{ id: 's', title: 'S', rewards: [], actors: [] }],
          rewards: [],
        },
      ],
    })
  })

  it('fills defaults for absent lists and dictionaries', () => {
    const doc = fromJsonValue(baseJson())
    expect(doc.dictionaries).toEqual({ actors: [], locations: [], items: [], tags: [] })
    expect(doc.quests[0].tags).toEqual([])
    expect(doc.quests[0].rewards).toEqual([])
    expect(doc.quests[0].steps[0].rewards).toEqual([])
    expect(doc.quests[0].steps[0].actors).toEqual([])
  })

  it('fills defaults for partial dictionaries', () => {
    const value = baseJson()
    value.dictionaries = { items: ['ledger'] }
    expect(fromJsonValue(value).dictionaries).toEqual({
      actors: [],
      locations: [],
      items: [{ id: 'ledger' }],
      tags: [],
    })
  })

  it('accepts both reference forms', () => {
    const value = baseJson()
    value.dictionaries = {
      actors: ['otter', { id: 'harbormaster', name: 'Harbormaster Ines' }],
    }
    expect(fromJsonValue(value).dictionaries.actors).toEqual([
      { id: 'otter' },
      { id: 'harbormaster', name: 'Harbormaster Ines' },
    ])
  })

  it('preserves extension values as written', () => {
    const ext = {
      'x-editor.position': { x: 12, y: -4 },
      'x-cozycoast.icon': 'ledger',
      'x-unity.enabled': true,
      'x-a-b.deep_key.1': 7,
    }
    expect(fromJsonValue(withQuest({ ext })).quests[0].ext).toEqual(ext)
  })

  it('reads every objective kind', () => {
    const kinds = [
      { kind: 'kill', actor: 'gull', count: 3 },
      { kind: 'collect', item: 'fish.rare', count: 5 },
      { kind: 'reach', location: 'harbor' },
      { kind: 'talk', actor: 'otter', dialogue: 'otter_trade' },
      { kind: 'interact', object: 'ledger_chest' },
      { kind: 'event', event: 'tide.turned', count: 2 },
      { kind: 'custom', custom: 'cozycoast.ritual', args: ['dawn'] },
    ]
    for (const objective of kinds) {
      expect(fromJsonValue(withStep({ objective })).quests[0].steps[0].objective).toEqual(objective)
    }
  })

  it('reads a fail objective', () => {
    const failObjective = { kind: 'event', event: 'guard.caught' }
    expect(fromJsonValue(withStep({ failObjective })).quests[0].steps[0].failObjective).toEqual(
      failObjective,
    )
  })

  it('reads a nested condition tree', () => {
    const unlock = {
      and: [
        { var: 'flag.pier_open' },
        { or: [{ '!': [{ var: 'flag.banned' }] }, { in: [{ var: 'var.season' }, ['spring']] }] },
        { '>=': [{ var: 'count.koi' }, 5] },
      ],
    }
    expect(fromJsonValue(withStep({ unlock })).quests[0].steps[0].unlock).toEqual(unlock)
  })

  it('reads scalar and list conditions', () => {
    expect(fromJsonValue(withStep({ complete: true })).quests[0].steps[0].complete).toBe(true)
    expect(fromJsonValue(withStep({ complete: 3 })).quests[0].steps[0].complete).toBe(3)
    expect(
      fromJsonValue(withStep({ complete: ['a', 2, false] })).quests[0].steps[0].complete,
    ).toEqual(['a', 2, false])
  })
})

describe('parseJson', () => {
  it('parses text', () => {
    expect(parseJson(JSON.stringify(baseJson())).quests[0].id).toBe('q')
  })

  it('reports invalid JSON at the root', () => {
    const error = caught(() => parseJson('{ nope'))
    expect(error.path).toBe('')
    expect(error.message).toMatch(/invalid JSON/)
  })
})

describe('round trips', () => {
  it('round trips the minimal document', () => {
    expect(fromJsonValue(toJsonValue(minimalDocument()))).toEqual(minimalDocument())
  })

  it('round trips the full document', () => {
    expect(fromJsonValue(toJsonValue(fullDocument()))).toEqual(fullDocument())
  })

  it('round trips through text', () => {
    expect(parseJson(toJson(fullDocument()))).toEqual(fullDocument())
    expect(parseJson(toJson(fullDocument(), { pretty: false }))).toEqual(fullDocument())
  })
})

describe('error paths', () => {
  it('rejects a non object document', () => {
    expect(failsAt([], '').message).toMatch(/expected the document to be an object, got array/)
  })

  it('rejects a missing oqf field', () => {
    expect(failsAt({ quests: baseJson().quests }, 'oqf').message).toMatch(
      /missing required field "oqf"/,
    )
  })

  it('rejects an unsupported oqf version', () => {
    expect(failsAt({ ...baseJson(), oqf: 2 }, 'oqf').message).toMatch(/unsupported oqf version 2/)
  })

  it('rejects an unknown root key', () => {
    expect(failsAt({ ...baseJson(), extra: 1 }, 'extra').message).toMatch(/unknown key "extra"/)
  })

  it('rejects missing quests', () => {
    failsAt({ oqf: 1 }, 'quests')
  })

  it('rejects a non array quests field', () => {
    failsAt({ oqf: 1, quests: {} }, 'quests')
  })

  it('rejects an unknown dictionary section', () => {
    const value = baseJson()
    value.dictionaries = { npcs: [] }
    failsAt(value, 'dictionaries.npcs')
  })

  it('rejects a reference without an id', () => {
    const value = baseJson()
    value.dictionaries = { actors: [{ name: 'Ines' }] }
    failsAt(value, 'dictionaries.actors[0].id')
  })

  it('rejects an unknown reference key', () => {
    const value = baseJson()
    value.dictionaries = { tags: [{ id: 'main', label: 'Main' }] }
    failsAt(value, 'dictionaries.tags[0].label')
  })

  it('rejects a missing quest field', () => {
    failsAt({ oqf: 1, quests: [{ id: 'q', version: 1, steps: [] }] }, 'quests[0].title')
  })

  it('rejects a quest version that is not an integer', () => {
    expect(failsAt(withQuest({ version: 1.5 }), 'quests[0].version').message).toMatch(
      /expected an integer/,
    )
  })

  it('rejects an unknown quest key', () => {
    failsAt(withQuest({ start: ['s'] }), 'quests[0].start')
  })

  it('rejects a wrongly typed quest field', () => {
    expect(failsAt(withQuest({ summary: 7 }), 'quests[0].summary').message).toMatch(
      /expected a string, got number/,
    )
  })

  it('rejects a missing step field', () => {
    const value = baseJson()
    quests(value)[0].steps = [{ id: 'a', title: 'A' }, { id: 'b' }]
    failsAt(value, 'quests[0].steps[1].title')
  })

  it('rejects an unknown step key', () => {
    failsAt(withStep({ hidden: true }), 'quests[0].steps[0].hidden')
  })

  it('rejects a wrongly typed step flag', () => {
    expect(failsAt(withStep({ optional: 'yes' }), 'quests[0].steps[0].optional').message).toMatch(
      /expected a boolean, got string/,
    )
  })

  it('rejects an unknown objective kind', () => {
    expect(
      failsAt(
        withStep({ objective: { kind: 'slay', actor: 'gull' } }),
        'quests[0].steps[0].objective',
      ).message,
    ).toMatch(/unknown objective kind "slay"/)
  })

  it('rejects a missing objective kind', () => {
    failsAt(withStep({ objective: { actor: 'gull' } }), 'quests[0].steps[0].objective.kind')
  })

  it('rejects a missing objective field', () => {
    failsAt(withStep({ objective: { kind: 'collect' } }), 'quests[0].steps[0].objective.item')
  })

  it('rejects an objective key that belongs to another kind', () => {
    failsAt(
      withStep({ objective: { kind: 'reach', location: 'harbor', count: 2 } }),
      'quests[0].steps[0].objective.count',
    )
  })

  it('rejects a custom objective without args', () => {
    failsAt(
      withStep({ objective: { kind: 'custom', custom: 'rite' } }),
      'quests[0].steps[0].objective.args',
    )
  })

  it('rejects an unknown fail objective kind', () => {
    expect(
      failsAt(
        withStep({ failObjective: { kind: 'trip', actor: 'guard' } }),
        'quests[0].steps[0].failObjective',
      ).message,
    ).toMatch(/unknown objective kind "trip"/)
  })

  it('rejects a missing fail objective field', () => {
    failsAt(
      withStep({ failObjective: { kind: 'event' } }),
      'quests[0].steps[0].failObjective.event',
    )
  })

  it('rejects an unknown reward kind', () => {
    expect(
      failsAt(withQuest({ rewards: [{ id: 'r', kind: 'loot', ref: 'x' }] }), 'quests[0].rewards[0]')
        .message,
    ).toMatch(/unknown reward kind "loot"/)
  })

  it('rejects a missing reward field', () => {
    failsAt(withQuest({ rewards: [{ id: 'r', kind: 'xp' }] }), 'quests[0].rewards[0].ref')
  })

  it('rejects a non scalar payload value', () => {
    failsAt(
      withQuest({ rewards: [{ id: 'r', kind: 'xp', ref: 'x', payload: { deep: { a: 1 } } }] }),
      'quests[0].rewards[0].payload.deep',
    )
  })

  it('rejects an unknown outcome key', () => {
    failsAt(
      withStep({ outcome: { name: 'sold', bonus: true } }),
      'quests[0].steps[0].outcome.bonus',
    )
  })

  it('rejects a dialogue binding without a ref', () => {
    failsAt(withStep({ dialogue: { provider: 'ink' } }), 'quests[0].steps[0].dialogue.ref')
  })

  it('rejects a non string entry in an id list', () => {
    failsAt(withStep({ rewards: ['a', 2] }), 'quests[0].steps[0].rewards[1]')
  })

  it('rejects an unknown condition operator', () => {
    expect(
      failsAt(withStep({ unlock: { xor: [true, false] } }), 'quests[0].steps[0].unlock').message,
    ).toMatch(/unknown condition operator "xor"/)
  })

  it('rejects a condition object with more than one key', () => {
    expect(
      failsAt(withStep({ unlock: { and: [true], or: [false] } }), 'quests[0].steps[0].unlock')
        .message,
    ).toMatch(/exactly one operator key/)
  })

  it('rejects a condition object with no keys', () => {
    failsAt(withStep({ unlock: {} }), 'quests[0].steps[0].unlock')
  })

  it('rejects the wrong arity on a binary operator', () => {
    expect(
      failsAt(withStep({ unlock: { '==': [1] } }), 'quests[0].steps[0].unlock.==').message,
    ).toMatch(/operator "==" expects 2 operands, got 1/)
  })

  it('rejects the wrong arity on not', () => {
    failsAt(withStep({ unlock: { '!': [true, false] } }), 'quests[0].steps[0].unlock.!')
  })

  it('rejects an empty variadic operator', () => {
    expect(
      failsAt(withStep({ unlock: { and: [] } }), 'quests[0].steps[0].unlock.and').message,
    ).toMatch(/at least one operand/)
  })

  it('reports the path of a nested condition', () => {
    failsAt(
      withStep({ unlock: { and: [true, { or: [{ '!': [] }] }] } }),
      'quests[0].steps[0].unlock.and[1].or[0].!',
    )
  })

  it('rejects a var operand that is not a string', () => {
    failsAt(withStep({ unlock: { var: 12 } }), 'quests[0].steps[0].unlock.var')
  })

  it('rejects a null condition', () => {
    failsAt(withStep({ fail: null }), 'quests[0].steps[0].fail')
  })

  it('rejects a non scalar inside a condition list', () => {
    failsAt(withStep({ complete: ['a', { var: 'flag.x' }] }), 'quests[0].steps[0].complete[1]')
  })

  it('rejects an extension key that is not namespaced', () => {
    expect(failsAt(withQuest({ ext: { icon: 'ledger' } }), 'quests[0].ext.icon').message).toMatch(
      /invalid extension key "icon"/,
    )
  })

  it('rejects an extension key with an uppercase namespace', () => {
    failsAt(withQuest({ ext: { 'x-Unity.prefab': 'a' } }), 'quests[0].ext.x-Unity.prefab')
  })

  it('rejects an extension key without a dot', () => {
    failsAt(withStep({ ext: { 'x-unity': 'a' } }), 'quests[0].steps[0].ext.x-unity')
  })

  it('rejects an extension value nested two levels deep', () => {
    failsAt(
      withQuest({ ext: { 'x-editor.position': { at: { x: 1 } } } }),
      'quests[0].ext.x-editor.position.at',
    )
  })

  it('rejects an extension bag on a reward with a bad key', () => {
    failsAt(
      withQuest({ rewards: [{ id: 'r', kind: 'xp', ref: 'x', ext: { 'y-a.b': 1 } }] }),
      'quests[0].rewards[0].ext.y-a.b',
    )
  })
})

describe('recurrence fields', () => {
  it('reads cooldown, expire, params and deadline', () => {
    const value = withQuest({
      repeat: true,
      cooldown: 'day',
      expire: 'P1DT0H',
      params: [
        { name: 'fish', type: 'item', constraint: 'fish.catchable' },
        { name: 'n', type: 'number', ext: { 'x-editor.note': 'picked' } },
      ],
      steps: [
        {
          id: 's',
          title: 'S',
          deadline: 'PT2H',
          objective: { kind: 'collect', item: '$fish', count: '$n' },
        },
      ],
    })
    const quest = fromJsonValue(value).quests[0]
    expect(quest.cooldown).toBe('day')
    expect(quest.expire).toBe('P1D')
    expect(quest.params).toEqual([
      { name: 'fish', type: 'item', constraint: 'fish.catchable' },
      { name: 'n', type: 'number', ext: { 'x-editor.note': 'picked' } },
    ])
    expect(quest.steps[0].deadline).toBe('PT2H')
    expect(quest.steps[0].objective).toEqual({ kind: 'collect', item: '$fish', count: '$n' })
  })

  it('leaves an empty params list out of the model', () => {
    expect(fromJsonValue(withQuest({ params: [] })).quests[0]).not.toHaveProperty('params')
  })

  it('keeps an invalid duration for the validator', () => {
    expect(fromJsonValue(withQuest({ expire: 'tomorrow' })).quests[0].expire).toBe('tomorrow')
  })

  it('rejects an empty or non string duration', () => {
    failsAt(withQuest({ cooldown: '' }), 'quests[0].cooldown')
    failsAt(withQuest({ expire: 3 }), 'quests[0].expire')
    failsAt(withStep({ deadline: true }), 'quests[0].steps[0].deadline')
  })

  it('rejects a bad parameter', () => {
    failsAt(withQuest({ params: [{ type: 'item' }] }), 'quests[0].params[0].name')
    failsAt(withQuest({ params: [{ name: 'n', type: 'colour' }] }), 'quests[0].params[0].type')
    failsAt(
      withQuest({ params: [{ name: 'n', type: 'number', min: 1 }] }),
      'quests[0].params[0].min',
    )
    failsAt(withQuest({ params: 'n' }), 'quests[0].params')
  })

  it('rejects a count that is neither a number nor a $name', () => {
    const error = failsAt(
      withStep({ objective: { kind: 'collect', item: 'fish', count: 'five' } }),
      'quests[0].steps[0].objective.count',
    )
    expect(error.message).toMatch(/number or a \$name parameter reference/)
  })
})
