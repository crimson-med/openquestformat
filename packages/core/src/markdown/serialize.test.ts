import { describe, expect, it, vi } from 'vitest'
import type { OqfDocument } from '../model.js'
import { toMarkdown } from './serialize.js'

// The condition module is built in parallel, so the export is tested against a
// stub: scalar conditions print as themselves, trees print as a stable marker.
vi.mock('../condition/index.js', () => {
  const format = (condition: unknown): string =>
    typeof condition === 'string' ? condition : `cond(${JSON.stringify(condition)})`

  const variables = (condition: unknown): string[] => {
    if (Array.isArray(condition)) return condition.flatMap(variables)
    if (typeof condition !== 'object' || condition === null) return []
    const [operator, operands] = Object.entries(condition)[0]
    return operator === 'var' ? [String(operands)] : variables(operands)
  }

  return {
    formatCondition: format,
    conditionVariables: variables,
    formatCompletion: ({
      objective,
      condition,
    }: { objective?: { kind: string }; condition?: unknown }) =>
      [
        objective === undefined ? undefined : `objective:${objective.kind}`,
        condition === undefined ? undefined : format(condition),
      ]
        .filter((part) => part !== undefined)
        .join(' and '),
  }
})

function document(): OqfDocument {
  return {
    dictionaries: { actors: [], locations: [], items: [], tags: [] },
    quests: [
      {
        id: 'ledger',
        version: 2,
        title: 'The Ledger',
        summary: 'Find the ledger, then decide what it is worth.',
        tags: ['main'],
        steps: [
          {
            id: 'a',
            title: 'Start here',
            start: true,
            complete: 'flag.ready',
            rewards: ['coins'],
            actors: [],
          },
          {
            id: 'b',
            title: 'Trade | barter for it',
            unlock: { var: 'step.a' },
            objective: { kind: 'collect', item: 'fish.rare', count: 2 },
            failObjective: { kind: 'event', event: 'guard.caught' },
            fail: 'flag.caught | flag.fled',
            rewards: [],
            actors: [],
          },
          {
            id: 'c',
            title: 'Return it',
            unlock: { or: [{ var: 'step.a' }, { var: 'step.b' }] },
            outcome: { name: 'returned' },
            rewards: [],
            actors: [],
          },
          {
            id: 'd',
            title: 'Caught in the "den"',
            unlock: {
              and: [{ var: 'step.ledger2#other' }, { var: 'step.b' }, { var: 'step.nowhere' }],
            },
            outcome: { name: 'confiscated', failed: true },
            rewards: [],
            actors: [],
          },
        ],
        rewards: [
          { id: 'coins', kind: 'currency', ref: 'coins', amount: 10 },
          { id: 'rep_up', kind: 'reputation', ref: 'harbor', amount: 10, outcome: 'returned' },
          { id: 'lure', kind: 'item', ref: 'lure.golden', outcome: 'returned' },
          { id: 'fine', kind: 'currency', ref: 'coins', amount: -5, outcome: 'confiscated' },
        ],
      },
      {
        id: 'ledger2',
        version: 1,
        title: 'Aftermath',
        tags: [],
        steps: [{ id: 'other', title: 'Wait', rewards: [], actors: [] }],
        rewards: [],
      },
    ],
  }
}

function lines(): string[] {
  return toMarkdown(document()).split('\n')
}

/** The mermaid block of the first quest, fences included. */
function firstGraph(): string {
  const text = toMarkdown(document())
  return text.slice(text.indexOf('```mermaid'), text.indexOf('\n```\n'))
}

describe('toMarkdown', () => {
  it('writes a heading with the title and the id', () => {
    expect(lines()[0]).toBe('# The Ledger `ledger`')
  })

  it('writes the summary as a paragraph', () => {
    expect(lines()[2]).toBe('Find the ledger, then decide what it is worth.')
  })

  it('omits the summary when there is none', () => {
    const text = toMarkdown(document())
    expect(text).toContain('# Aftermath `ledger2`\n\n## Steps')
  })

  it('writes the step table header', () => {
    const table = lines()
    expect(table[4]).toBe('## Steps')
    expect(table[6]).toBe('| ID | Title | Unlock | Complete | Fail | Outcome | Rewards |')
    expect(table[7]).toBe('| --- | --- | --- | --- | --- | --- | --- |')
  })

  it('writes one row per step, with conditions from the condition module', () => {
    const table = lines()
    expect(table[8]).toBe('| `a` | Start here |  | flag.ready |  |  | `coins` |')
    expect(table[9]).toBe(
      '| `b` | Trade \\| barter for it | cond({"var":"step.a"}) | objective:collect | objective:event and flag.caught \\| flag.fled |  |  |',
    )
  })

  it('writes a fail objective and a fail condition in one cell', () => {
    expect(lines()[9]).toContain('| objective:event and flag.caught \\| flag.fled |')
  })

  it('marks a failed outcome with a leading bang', () => {
    const table = lines()
    expect(table[10]).toContain('| returned |')
    expect(table[11]).toContain('| !confiscated |')
  })

  it('escapes pipes in table cells', () => {
    const table = lines().slice(6, 12).join('\n')
    expect(table).toContain('Trade \\| barter for it')
    expect(table).toContain('flag.caught \\| flag.fled')
    expect(table).not.toContain('Trade | barter')
  })

  it('groups quest-level rewards by outcome and skips step rewards', () => {
    const text = toMarkdown(document())
    const section = text.slice(text.indexOf('## Rewards'), text.indexOf('```mermaid'))
    expect(section.trimEnd()).toBe(
      [
        '## Rewards',
        '',
        '### returned',
        '',
        '- `rep_up` reputation `harbor` (10)',
        '- `lure` item `lure.golden`',
        '',
        '### confiscated',
        '',
        '- `fine` currency `coins` (-5)',
      ].join('\n'),
    )
    expect(section).not.toContain('`coins` currency')
  })

  it('omits the rewards section when no reward names an outcome', () => {
    const text = toMarkdown(document())
    expect(text.slice(text.indexOf('# Aftermath'))).not.toContain('## Rewards')
  })

  it('draws one mermaid node per step, endings with double brackets', () => {
    expect(firstGraph().split('\n').slice(0, 6)).toEqual([
      '```mermaid',
      'flowchart TD',
      '  a["Start here"]',
      '  b["Trade | barter for it"]',
      '  c[["Return it"]]',
      '  d[["Caught in the #quot;den#quot;"]]',
    ])
  })

  it('draws one edge per step id named in another step unlock condition', () => {
    expect(firstGraph().split('\n').slice(6)).toEqual([
      '  a --> b',
      '  a --> c',
      '  b --> c',
      '  b --> d',
    ])
  })

  it('leaves cross quest references and unknown step ids out of the graph', () => {
    const graph = firstGraph()
    expect(graph).not.toContain('ledger2#other')
    expect(graph).not.toContain('nowhere')
  })

  it('separates quests with two blank lines and ends with a newline', () => {
    const text = toMarkdown(document())
    expect(text).toContain('```\n\n\n# Aftermath `ledger2`')
    expect(text.endsWith('```\n')).toBe(true)
  })

  it('writes recurrence, parameters and a deadline column when a quest has them', () => {
    const doc = document()
    Object.assign(doc.quests[0], {
      repeat: true,
      cooldown: 'day',
      expire: 'P1D',
      params: [
        { name: 'fish', type: 'item', constraint: 'fish.catchable' },
        { name: 'n', type: 'number' },
      ],
    })
    doc.quests[0].steps[1].deadline = 'PT2H'
    const text = toMarkdown(doc)
    const head = text.slice(0, text.indexOf('| `a` |'))
    expect(head).toBe(
      [
        '# The Ledger `ledger`',
        '',
        'Find the ledger, then decide what it is worth.',
        '',
        'Repeatable, cooldown `day`, expires after `P1D`.',
        '',
        '## Parameters',
        '',
        '- `$fish` item (`fish.catchable`)',
        '- `$n` number',
        '',
        '## Steps',
        '',
        '| ID | Title | Unlock | Complete | Fail | Outcome | Rewards | Deadline |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        '',
      ].join('\n'),
    )
    expect(text).toContain(
      '| objective:collect | objective:event and flag.caught \\| flag.fled |  |  | PT2H |',
    )
    expect(text).toContain('| `a` | Start here |  | flag.ready |  |  | `coins` |  |')
  })

  it('writes the timing line for a one time quest that expires', () => {
    const doc = document()
    doc.quests[1].expire = 'PT12H'
    expect(toMarkdown(doc)).toContain(
      '# Aftermath `ledger2`\n\nOne time, expires after `PT12H`.\n\n## Steps',
    )
  })

  it('writes nothing for a document with no quests', () => {
    expect(
      toMarkdown({ dictionaries: { actors: [], locations: [], items: [], tags: [] }, quests: [] }),
    ).toBe('')
  })
})
