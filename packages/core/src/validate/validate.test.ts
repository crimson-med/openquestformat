import { describe, expect, it } from 'vitest'
import type { Condition, OqfDocument } from '../model.js'
import { cleanDocument, doc, done, inState, quest, referenceDocument, step } from './fixtures.js'
import type { ValidationResult } from './types.js'
import { validateDocument, validatePack } from './validate.js'

function codes(result: ValidationResult): string[] {
  return result.findings.map((finding) => finding.code)
}

function only(result: ValidationResult, code: string) {
  return result.findings.filter((finding) => finding.code === code)
}

/** A start step that pays out and an ending gated on the given condition. */
function endingDocument(unlock: Condition): OqfDocument {
  return doc([
    quest(
      'q',
      [
        step('begin', { start: true, rewards: ['tip'] }),
        step('finish', { unlock, outcome: { name: 'done' } }),
      ],
      { rewards: [{ id: 'tip', kind: 'xp', ref: 'xp' }] },
    ),
  ])
}

describe('clean documents', () => {
  it('reports nothing for a start step and an ending', () => {
    const result = validateDocument(cleanDocument())
    expect(result.findings).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('reports nothing in strict mode either', () => {
    expect(validateDocument(cleanDocument(), { strict: true }).findings).toEqual([])
  })

  it('is ok when only warnings are found', () => {
    const result = validateDocument(doc([quest('q', [step('begin', { start: true })])]))
    expect(codes(result)).toContain('no-ending-reachable')
    expect(result.ok).toBe(true)
  })
})

describe('duplicate ids', () => {
  it('reports a quest id used twice in one document', () => {
    const result = validateDocument(
      doc([quest('q', [step('a', { start: true })]), quest('q', [step('b', { start: true })])]),
    )
    expect(only(result, 'duplicate-quest-id')).toHaveLength(1)
    expect(result.ok).toBe(false)
  })

  it('reports a quest id used by two documents in a pack', () => {
    const result = validatePack([
      doc([quest('q', [step('a', { start: true })])]),
      doc([quest('q', [step('b', { start: true })])]),
    ])
    const finding = only(result, 'duplicate-quest-id')[0]
    expect(finding.level).toBe('error')
    expect(finding.path).toBe('documents[1].quests[0]')
  })

  it('reports a step id used twice', () => {
    const result = validateDocument(
      doc([quest('q', [step('a', { start: true }), step('a', { start: true })])]),
    )
    expect(only(result, 'duplicate-step-id')).toHaveLength(1)
  })

  it('reports a reward id used twice', () => {
    const result = validateDocument(
      doc([
        quest('q', [step('a', { start: true })], {
          rewards: [
            { id: 'tip', kind: 'currency', ref: 'coins' },
            { id: 'tip', kind: 'xp', ref: 'xp' },
          ],
        }),
      ]),
    )
    expect(only(result, 'duplicate-reward-id')).toHaveLength(1)
  })

  it('reports an outcome name used twice', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('a', { start: true, outcome: { name: 'done' } }),
          step('b', { start: true, outcome: { name: 'done' } }),
        ]),
      ]),
    )
    expect(only(result, 'duplicate-outcome-name')).toHaveLength(1)
  })

  it('accepts two outcomes with different names', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('a', { start: true, outcome: { name: 'good' } }),
          step('b', { start: true, outcome: { name: 'bad', failed: true } }),
        ]),
      ]),
    )
    expect(codes(result)).toEqual([])
  })
})

describe('unknown references', () => {
  it('reports a step that does not exist', () => {
    const result = validateDocument(endingDocument(done('ghost')))
    expect(only(result, 'unknown-step-ref')).toHaveLength(1)
  })

  it('reports a counter that does not name a step of the quest', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('begin', { start: true, complete: { '>=': [{ var: 'count.ghost' }, 5] } }),
          step('finish', { unlock: done('begin'), outcome: { name: 'done' } }),
        ]),
      ]),
    )
    expect(only(result, 'unknown-step-ref')).toHaveLength(1)
  })

  it('accepts a counter that names a step of the quest', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('begin', { start: true }),
          step('finish', {
            unlock: { '>=': [{ var: 'count.begin' }, 5] },
            outcome: { name: 'done' },
          }),
        ]),
      ]),
    )
    expect(codes(result)).toEqual([])
  })

  it('reports a quest that is not in the pack', () => {
    const result = validateDocument(endingDocument(done('elsewhere#s')))
    expect(only(result, 'unknown-quest-ref')).toHaveLength(1)
  })

  it('reports a step of another quest that does not exist', () => {
    const result = validatePack([
      endingDocument(done('other#ghost')),
      doc([quest('other', [step('s', { start: true, outcome: { name: 'done' } })])]),
    ])
    expect(only(result, 'unknown-step-ref')).toHaveLength(1)
    expect(only(result, 'unknown-quest-ref')).toHaveLength(0)
  })

  it('reports an outcome the target quest does not have', () => {
    const result = validatePack([
      endingDocument({ var: 'outcome.other.missing' }),
      doc([quest('other', [step('s', { start: true, outcome: { name: 'done' } })])]),
    ])
    expect(only(result, 'unknown-outcome-ref')).toHaveLength(1)
  })

  it('accepts an outcome the target quest has', () => {
    const result = validatePack([
      endingDocument({ var: 'outcome.other.done' }),
      doc([quest('other', [step('s', { start: true, outcome: { name: 'done' } })])]),
    ])
    expect(codes(result)).toEqual([])
  })

  it('reports an unknown quest state read', () => {
    const result = validateDocument(endingDocument({ '==': [{ var: 'quest.nope' }, 'closed'] }))
    expect(only(result, 'unknown-quest-ref')).toHaveLength(1)
  })

  it('reports a reward keyed to an outcome no step reaches', () => {
    const result = validateDocument(
      doc([
        quest('q', [step('a', { start: true, outcome: { name: 'good' } })], {
          rewards: [{ id: 'prize', kind: 'item', ref: 'lure', outcome: 'bad' }],
        }),
      ]),
    )
    expect(only(result, 'unknown-outcome-ref')).toHaveLength(1)
  })

  it('reports a step reward that is not in the catalog', () => {
    const result = validateDocument(
      doc([quest('q', [step('a', { start: true, outcome: { name: 'x' }, rewards: ['nope'] })])]),
    )
    expect(only(result, 'unknown-reward-ref')).toHaveLength(1)
  })

  it('accepts a step reward that is in the catalog', () => {
    const result = validateDocument(
      doc([
        quest('q', [step('a', { start: true, outcome: { name: 'x' }, rewards: ['tip'] })], {
          rewards: [{ id: 'tip', kind: 'currency', ref: 'coins', amount: 10 }],
        }),
      ]),
    )
    expect(codes(result)).toEqual([])
  })

  it('reports tags, actors and locations that are not in the dictionaries', () => {
    const result = validateDocument(
      doc([
        quest(
          'q',
          [
            step('a', {
              start: true,
              outcome: { name: 'x' },
              actors: ['ghost'],
              location: 'nowhere',
            }),
          ],
          { tags: ['untagged'] },
        ),
      ]),
    )
    expect(only(result, 'unknown-dictionary-ref')).toHaveLength(3)
  })

  it('accepts dictionary references that exist', () => {
    const result = validateDocument(
      doc(
        [
          quest(
            'q',
            [
              step('a', {
                start: true,
                outcome: { name: 'x' },
                actors: ['ines'],
                location: 'harbor',
              }),
            ],
            { tags: ['main'] },
          ),
        ],
        {
          actors: [{ id: 'ines' }],
          locations: [{ id: 'harbor' }],
          items: [],
          tags: [{ id: 'main' }],
        },
      ),
    )
    expect(codes(result)).toEqual([])
  })
})

describe('conditions', () => {
  it('reports an operator outside the whitelist once per error', () => {
    const result = validateDocument(endingDocument({ nope: [1, 2] } as unknown as Condition))
    expect(only(result, 'condition-invalid')).toHaveLength(1)
  })

  it('reports a malformed boolean operator', () => {
    const result = validateDocument(endingDocument({ and: [true] } as unknown as Condition))
    expect(only(result, 'condition-invalid')).toHaveLength(1)
  })

  it('reports an unknown variable namespace without repeating it as invalid', () => {
    const result = validateDocument(endingDocument({ var: 'stats.strength' }))
    expect(only(result, 'unknown-variable-namespace')).toHaveLength(1)
    expect(only(result, 'condition-invalid')).toHaveLength(0)
  })

  it('reports a condition that is a bare literal', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('begin', { start: true, activate: true }),
          step('finish', { unlock: done('begin'), outcome: { name: 'done' } }),
        ]),
      ]),
    )
    expect(only(result, 'condition-constant')).toHaveLength(1)
    expect(only(result, 'condition-constant')[0].level).toBe('warning')
  })

  it('accepts a nested tree over every owned namespace', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('begin', { start: true }),
          step('finish', {
            unlock: {
              and: [
                done('begin'),
                { '!': [{ var: 'flag.banned' }] },
                { or: [{ var: 'var.season' }, { '>=': [{ var: 'count.begin' }, 1] }] },
              ],
            },
            outcome: { name: 'done' },
          }),
        ]),
      ]),
    )
    expect(codes(result)).toEqual([])
  })
})

describe('flags', () => {
  it('reports an unset flag in strict mode only', () => {
    const document = endingDocument({ var: 'flag.never_set' })
    expect(codes(validateDocument(document))).not.toContain('unknown-flag')
    expect(codes(validateDocument(document, { strict: true }))).toContain('unknown-flag')
  })

  it('stays quiet when a reward in the pack sets the flag', () => {
    const result = validatePack(
      [
        endingDocument({ var: 'flag.otter_agreed' }),
        doc([
          quest('other', [step('s', { start: true, outcome: { name: 'done' } })], {
            rewards: [{ id: 'agreed', kind: 'flag', ref: 'otter_agreed' }],
          }),
        ]),
      ],
      { strict: true },
    )
    expect(codes(result)).not.toContain('unknown-flag')
  })
})

describe('extension keys', () => {
  it('reports a key that is not namespaced', () => {
    const result = validateDocument(
      doc([
        quest('q', [step('a', { start: true, outcome: { name: 'x' }, ext: { color: 'red' } })]),
      ]),
    )
    expect(only(result, 'ext-key-invalid')).toHaveLength(1)
    expect(only(result, 'ext-key-invalid')[0].level).toBe('error')
  })

  it('reports an unknown namespace in strict mode only', () => {
    const document = doc([
      quest('q', [step('a', { start: true, outcome: { name: 'x' } })], {
        ext: { 'x-mystery.key': 1 },
      }),
    ])
    expect(codes(validateDocument(document))).toEqual([])
    expect(codes(validateDocument(document, { strict: true }))).toEqual(['unknown-ext-namespace'])
  })

  it('accepts known namespaces on quests, steps and rewards', () => {
    const result = validateDocument(
      doc([
        quest(
          'q',
          [
            step('a', {
              start: true,
              outcome: { name: 'x' },
              rewards: ['tip'],
              ext: { 'x-editor.x': 12 },
            }),
          ],
          {
            ext: { 'x-unity.prefab': 'Quest' },
            rewards: [
              { id: 'tip', kind: 'currency', ref: 'coins', ext: { 'x-cozycoast.sfx': 'ching' } },
            ],
          },
        ),
      ]),
      { strict: true },
    )
    expect(codes(result)).toEqual([])
  })
})

describe('cycles', () => {
  it('reports every step of a cycle that is not marked repeat', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('a', { unlock: done('b') }),
          step('b', { unlock: done('a') }),
          step('finish', { start: true, outcome: { name: 'done' } }),
        ]),
      ]),
    )
    expect(only(result, 'cycle-without-repeat')).toHaveLength(2)
    expect(result.ok).toBe(false)
  })

  it('accepts a cycle whose steps are marked repeat', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('a', { unlock: done('b'), repeat: true }),
          step('b', { unlock: done('a'), repeat: true }),
          step('finish', { start: true, outcome: { name: 'done' } }),
        ]),
      ]),
    )
    expect(only(result, 'cycle-without-repeat')).toHaveLength(0)
  })

  it('accepts a step that watches its own counter', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('catch', { start: true, complete: { '>=': [{ var: 'count.catch' }, 5] } }),
          step('finish', { unlock: done('catch'), outcome: { name: 'done' } }),
        ]),
      ]),
    )
    expect(codes(result)).toEqual([])
  })

  it('reports a step that depends on itself', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('loop', { unlock: done('loop') }),
          step('finish', { start: true, outcome: { name: 'done' } }),
        ]),
      ]),
    )
    expect(only(result, 'cycle-without-repeat')).toHaveLength(1)
  })
})

describe('graph shape', () => {
  it('reports an ending that other steps depend on', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('begin', { start: true, outcome: { name: 'done' } }),
          step('after', { unlock: done('begin'), rewards: ['tip'] }),
        ]),
      ]),
    )
    expect(only(result, 'outcome-with-dependents')).toHaveLength(1)
    expect(result.ok).toBe(false)
  })

  it('reports an ending another quest in the pack depends on', () => {
    const result = validatePack([
      doc([quest('q', [step('begin', { start: true, outcome: { name: 'done' } })])]),
      doc([
        quest('other', [
          step('a', { start: true }),
          step('b', { unlock: done('q#begin'), outcome: { name: 'done' } }),
        ]),
      ]),
    ])
    expect(only(result, 'outcome-with-dependents')).toHaveLength(1)
  })

  it('reports a step no start step can reach', () => {
    const result = validateDocument(
      doc([
        quest(
          'q',
          [
            step('begin', { start: true }),
            step('finish', { unlock: done('begin'), outcome: { name: 'done' } }),
            step('never', {
              unlock: { and: [done('begin'), inState('begin', 'failed')] },
              rewards: ['tip'],
            }),
          ],
          { rewards: [{ id: 'tip', kind: 'xp', ref: 'xp' }] },
        ),
      ]),
    )
    expect(only(result, 'unreachable-step')).toHaveLength(1)
    expect(only(result, 'unreachable-step')[0].step).toBe('never')
    expect(result.ok).toBe(true)
  })

  it('reports a step with no dependents, no rewards and no outcome', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('begin', { start: true }),
          step('finish', { unlock: done('begin'), outcome: { name: 'done' } }),
          step('chat', { unlock: done('begin') }),
        ]),
      ]),
    )
    expect(only(result, 'dead-end')).toHaveLength(1)
    expect(only(result, 'dead-end')[0].step).toBe('chat')
  })

  it('does not call an optional step with a reward a dead end', () => {
    const result = validateDocument(
      doc([
        quest(
          'q',
          [
            step('begin', { start: true }),
            step('finish', { unlock: done('begin'), outcome: { name: 'done' } }),
            step('chat', { unlock: done('begin'), optional: true, rewards: ['tip'] }),
          ],
          { rewards: [{ id: 'tip', kind: 'currency', ref: 'coins', amount: 10 }] },
        ),
      ]),
    )
    expect(codes(result)).toEqual([])
  })

  it('reports a quest with no reachable ending, as an error in strict mode', () => {
    const document = doc([
      quest('q', [step('begin', { start: true, rewards: ['tip'] })], {
        rewards: [{ id: 'tip', kind: 'xp', ref: 'xp' }],
      }),
    ])
    expect(only(validateDocument(document), 'no-ending-reachable')[0].level).toBe('warning')
    expect(only(validateDocument(document, { strict: true }), 'no-ending-reachable')[0].level).toBe(
      'error',
    )
    expect(validateDocument(document, { strict: true }).ok).toBe(false)
  })

  it('reports an ending only a game variable can reach', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('begin', { start: true }),
          step('risky', { unlock: done('begin'), complete: { var: 'var.time.isNight' } }),
          step('finish', { unlock: done('risky'), outcome: { name: 'done' } }),
        ]),
      ]),
    )
    expect(only(result, 'ending-needs-var')).toHaveLength(1)
    expect(only(result, 'ending-needs-var')[0].level).toBe('warning')
  })

  it('stays quiet when a second route to the ending is free of game variables', () => {
    const result = validateDocument(
      doc([
        quest('q', [
          step('begin', { start: true }),
          step('risky', { unlock: done('begin'), complete: { var: 'var.time.isNight' } }),
          step('safe', { unlock: done('begin') }),
          step('finish', {
            unlock: { or: [done('risky'), done('safe')] },
            outcome: { name: 'done' },
          }),
        ]),
      ]),
    )
    expect(codes(result)).toEqual([])
  })
})

describe('rewards across steps', () => {
  it('reports a reward id granted by more than one step', () => {
    const result = validateDocument(
      doc([
        quest(
          'q',
          [
            step('begin', { start: true, rewards: ['tip'] }),
            step('finish', { unlock: done('begin'), outcome: { name: 'done' }, rewards: ['tip'] }),
          ],
          { rewards: [{ id: 'tip', kind: 'currency', ref: 'coins', amount: 10 }] },
        ),
      ]),
    )
    expect(only(result, 'reward-id-reused')).toHaveLength(1)
    expect(only(result, 'reward-id-reused')[0].level).toBe('warning')
  })
})

describe('pack level checks', () => {
  function eventDocument(id: string, shared: boolean): OqfDocument {
    return doc([
      quest(id, [step('a', { start: true, outcome: { name: 'done' } })], {
        rewards: [
          {
            id: 'boom',
            kind: 'event',
            ref: 'cozycoast.ledger.restored',
            outcome: 'done',
            ...(shared ? { ext: { 'x-oqf.shared': true } } : {}),
          },
        ],
      }),
    ])
  }

  it('reports the same custom event emitted by two quests', () => {
    const result = validatePack([eventDocument('one', false), eventDocument('two', false)])
    expect(only(result, 'custom-event-collision')).toHaveLength(1)
    expect(only(result, 'custom-event-collision')[0].level).toBe('warning')
  })

  it('accepts the collision when one side is marked shared', () => {
    const result = validatePack([eventDocument('one', true), eventDocument('two', false)])
    expect(codes(result)).toEqual([])
  })

  it('does not call one quest emitting one event a collision', () => {
    expect(codes(validateDocument(eventDocument('one', false)))).toEqual([])
  })

  it('reports mixed keyed and literal text in strict mode only', () => {
    const document = doc([
      quest('q', [step('a', { start: true, title: '@step.a', outcome: { name: 'x' } })]),
    ])
    expect(codes(validateDocument(document))).toEqual([])
    expect(codes(validateDocument(document, { strict: true }))).toEqual(['mixed-text-keys'])
  })

  it('accepts a pack that is keyed throughout', () => {
    const document = doc([
      quest('q', [step('a', { start: true, title: '@step.a', outcome: { name: 'x' } })], {
        title: '@quest.q',
      }),
    ])
    expect(codes(validateDocument(document, { strict: true }))).toEqual([])
  })

  it('resolves a cross document step reference only when both files are in the pack', () => {
    const first = doc([
      quest('q', [
        step('begin', { start: true }),
        step('finish', {
          unlock: { and: [done('begin'), done('other#s')] },
          outcome: { name: 'done' },
        }),
      ]),
    ])
    const second = doc([
      quest('other', [
        step('s', { start: true }),
        step('t', { unlock: done('s'), outcome: { name: 'done' } }),
      ]),
    ])
    expect(codes(validateDocument(first))).toContain('unknown-quest-ref')
    expect(codes(validatePack([first, second]))).toEqual([])
  })
})

describe('the reference quest', () => {
  it('validates with no findings at all', () => {
    const result = validateDocument(referenceDocument())
    expect(result.findings).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('validates clean in strict mode', () => {
    expect(validateDocument(referenceDocument(), { strict: true }).findings).toEqual([])
  })

  it('does not report ending-needs-var because trade is a var free route', () => {
    expect(codes(validateDocument(referenceDocument()))).not.toContain('ending-needs-var')
  })
})
