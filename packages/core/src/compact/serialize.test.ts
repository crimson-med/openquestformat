import { describe, expect, it } from 'vitest'
import {
  type Dictionaries,
  type OqfDocument,
  type Quest,
  type Step,
  emptyDictionaries,
} from '../model.js'
import { parseCompact } from './parse.js'
import { toCompact } from './serialize.js'

/** One backslash, named so the escape expectations below stay readable. */
const BS = '\\'

function document(quests: Quest[], dictionaries: Dictionaries = emptyDictionaries()): OqfDocument {
  return { dictionaries, quests }
}

function quest(fields: Partial<Quest> = {}): Quest {
  return { id: 'q', version: 1, title: 'Quest', tags: [], steps: [], rewards: [], ...fields }
}

function step(fields: Partial<Step> = {}): Step {
  return { id: 's1', title: 'Step', rewards: [], actors: [], ...fields }
}

/** The records of a rendered document, without the magic line or the trailing LF. */
function records(text: string): string[] {
  const lines = text.split('\n')
  expect(lines[0]).toBe('OQF1')
  expect(lines[lines.length - 1]).toBe('')
  return lines.slice(1, -1)
}

describe('toCompact layout', () => {
  it('writes the magic line and a trailing LF for an empty document', () => {
    expect(toCompact(document([]))).toBe('OQF1\n')
  })

  it('drops trailing empty cells', () => {
    const text = toCompact(document([quest({ steps: [step()] })]))
    expect(records(text)).toEqual(['Q\tq\t1\t\t\t\tQuest', 'S\ts1\t\t\t\t\t\t\t\t\t\t\tStep'])
    expect(records(text)[1].split('\t')).toHaveLength(13)
  })

  it('writes rewards before steps and steps in model order', () => {
    const text = toCompact(
      document([
        quest({
          steps: [step({ id: 'a' }), step({ id: 'b' })],
          rewards: [
            { id: 'r1', kind: 'xp', ref: 'xp' },
            { id: 'r2', kind: 'flag', ref: 'open' },
          ],
        }),
      ]),
    )
    expect(records(text).map((line) => line.split('\t').slice(0, 2))).toEqual([
      ['Q', 'q'],
      ['R', 'r1'],
      ['R', 'r2'],
      ['S', 'a'],
      ['S', 'b'],
    ])
  })

  it('writes flags on quests and steps', () => {
    const text = toCompact(
      document([
        quest({
          repeat: true,
          steps: [step({ start: true, optional: true, repeat: true })],
        }),
      ]),
    )
    expect(records(text)[0].split('\t')[3]).toBe('r')
    expect(records(text)[1].split('\t')[2]).toBe('sor')
  })
})

describe('toCompact dictionaries', () => {
  it('interns in first-use order and keeps unreferenced entries after', () => {
    const text = toCompact(
      document(
        [
          quest({
            tags: ['t2'],
            steps: [
              step({ id: 'a', actors: ['c', 'a'], location: 'l2' }),
              step({
                id: 'b',
                actors: ['a'],
                location: 'l1',
                objective: { kind: 'collect', item: 'i2', count: 2 },
              }),
            ],
          }),
        ],
        {
          actors: [{ id: 'a' }, { id: 'b' }, { id: 'c', name: 'C' }],
          locations: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }],
          items: [{ id: 'i1' }, { id: 'i2' }],
          tags: [{ id: 't1' }, { id: 't2' }],
        },
      ),
    )
    const lines = records(text)
    expect(lines.slice(0, 4)).toEqual(['A\tc|C\ta\tb', 'L\tl2\tl1\tl3', 'I\ti2\ti1', 'T\tt2\tt1'])
    expect(lines[4].split('\t')[4]).toBe('0')
    expect(lines[5].split('\t')[11]).toBe('0,1')
    expect(lines[5].split('\t')[10]).toBe('0')
    expect(lines[6].split('\t')[10]).toBe('1')
  })

  it('omits dictionary lines that hold nothing', () => {
    expect(records(toCompact(document([quest()])))).toEqual(['Q\tq\t1\t\t\t\tQuest'])
  })
})

describe('toCompact cells', () => {
  it('writes conditions in their canonical spelling', () => {
    const text = toCompact(
      document([
        quest({
          unlock: { and: [{ '==': [{ var: 'flag.a' }, true] }, { var: 'flag.b' }] },
          steps: [
            step({
              unlock: { '==': [{ var: 'step.earlier' }, 'done'] },
              objective: { kind: 'collect', item: 'fish', count: 5 },
              complete: { '==': [{ var: 'flag.ok' }, true] },
              failObjective: { kind: 'event', event: 'caught' },
              fail: { '==': [{ var: 'flag.alarm' }, true] },
            }),
          ],
        }),
      ]),
    )
    const [questLine, stepLine] = records(text)
    expect(questLine.split('\t')[5]).toBe('flag.a and flag.b')
    expect(stepLine.split('\t')[3]).toBe('step.earlier')
    expect(stepLine.split('\t')[5]).toBe('collect fish 5 and flag.ok')
    expect(stepLine.split('\t')[6]).toBe('event caught and flag.alarm')
  })

  it('writes every outcome spelling', () => {
    const text = toCompact(
      document([
        quest({
          steps: [
            step({ id: 'a', outcome: { name: 'done' } }),
            step({ id: 'b', outcome: { name: 'lost', failed: true } }),
            step({ id: 'c', outcome: { name: 'done', title: 'All Good' } }),
            step({ id: 'd', outcome: { name: 'lost', failed: true, title: 'Too Bad' } }),
          ],
        }),
      ]),
    )
    expect(
      records(text)
        .slice(1)
        .map((line) => line.split('\t')[7]),
    ).toEqual(['done', '!lost', 'done|All Good', '!lost|Too Bad'])
  })

  it('writes numbers in shortest decimal form', () => {
    const text = toCompact(
      document([
        quest({
          version: 12,
          rewards: [
            { id: 'a', kind: 'currency', ref: 'coins', amount: -10 },
            { id: 'b', kind: 'xp', ref: 'xp', amount: 2.5 },
            { id: 'c', kind: 'xp', ref: 'xp', amount: 1e21 },
          ],
        }),
      ]),
    )
    const lines = records(text)
    expect(lines[0].split('\t')[2]).toBe('12')
    expect(lines.slice(1).map((line) => line.split('\t')[4])).toEqual(['-10', '2.5', '1e+21'])
  })

  it('writes a step dialogue binding and reward indices', () => {
    const text = toCompact(
      document([
        quest({
          rewards: [
            { id: 'r1', kind: 'xp', ref: 'xp' },
            { id: 'r2', kind: 'xp', ref: 'xp' },
          ],
          steps: [step({ rewards: ['r2', 'r1'], dialogue: { provider: 'ink', ref: 'knot:2' } })],
        }),
      ]),
    )
    const cells = records(text)[3].split('\t')
    expect(cells[8]).toBe('1,0')
    expect(cells[9]).toBe('ink:knot:2')
  })

  it('escapes the four cell characters', () => {
    const text = toCompact(document([quest({ title: 'a\tb\nc\rd\\e' })]))
    expect(records(text)[0].split('\t')[6]).toBe('a\\tb\\nc\\rd\\\\e')
  })

  it('escapes payload separators', () => {
    const text = toCompact(
      document([
        quest({
          rewards: [
            { id: 'r1', kind: 'event', ref: 'e', payload: { 'a=b': 'c;d', n: 3, yes: true } },
          ],
        }),
      ]),
    )
    expect(records(text)[1].split('\t')[6]).toBe(`a${BS}${BS}=b=c${BS}${BS};d;n=3;yes=true`)
  })
})

describe('toCompact extensions', () => {
  it('writes X lines after their record, sorted by namespace then key', () => {
    const text = toCompact(
      document([
        quest({
          ext: { 'x-zed.a': 1, 'x-alpha.b': 'two', 'x-alpha.a': true },
          rewards: [{ id: 'r1', kind: 'xp', ref: 'xp', ext: { 'x-ns.note': 'r' } }],
          steps: [step({ ext: { 'x-ns.marker': { x: 1, y: 2 } } })],
        }),
      ]),
    )
    expect(records(text).map((line) => line.split('\t').slice(0, 4).join(' '))).toEqual([
      'Q q 1 ',
      'X alpha a true',
      'X alpha b two',
      'X zed a 1',
      'R r1 xp xp',
      'X ns note r',
      'S s1  ',
      'X ns marker x=1;y=2',
    ])
  })

  it('escapes an X scalar that would otherwise read as a map', () => {
    const text = toCompact(document([quest({ ext: { 'x-ns.k': 'a=b;c' } })]))
    expect(records(text)[1]).toBe(`X\tns\tk\ta${BS}${BS}=b${BS}${BS};c`)
    expect(parseCompact(text).quests[0].ext).toEqual({ 'x-ns.k': 'a=b;c' })
  })

  it('appends x-oqf.extra as extra cells rather than an X line', () => {
    const text = toCompact(
      document([
        quest({
          ext: { 'x-oqf.extra': 'one\ttwo', 'x-ns.k': 'v' },
          steps: [step({ ext: { 'x-oqf.extra': 'late' } })],
        }),
      ]),
    )
    expect(records(text)).toEqual([
      'Q\tq\t1\t\t\t\tQuest\t\tone\ttwo',
      'X\tns\tk\tv',
      'S\ts1\t\t\t\t\t\t\t\t\t\t\tStep\t\tlate',
    ])
  })

  it('rejects an extension key that is not x-<namespace>.<key>', () => {
    expect(() => toCompact(document([quest({ ext: { oops: 1 } })]))).toThrow(
      /expected x-<namespace>.<key>/,
    )
    expect(() => toCompact(document([quest({ ext: { 'x-NS.k': 1 } })]))).toThrow(
      /cannot serialize extension key/,
    )
  })

  it('rejects a non string x-oqf.extra', () => {
    expect(() => toCompact(document([quest({ ext: { 'x-oqf.extra': 3 } })]))).toThrow(
      /TAB separated cells/,
    )
  })
})

describe('toCompact failures', () => {
  it('rejects a step reward that no reward line defines', () => {
    expect(() => toCompact(document([quest({ steps: [step({ rewards: ['nope'] })] })]))).toThrow(
      /unknown reward "nope"/,
    )
  })
})

describe('toCompact round trips its own output', () => {
  it('returns the same model after a parse', () => {
    const source = document(
      [
        quest({
          id: 'q1',
          version: 2,
          summary: 'Sum',
          tags: ['t1'],
          repeat: true,
          unlock: { '==': [{ var: 'flag.open' }, true] },
          rewards: [
            {
              id: 'r1',
              kind: 'event',
              ref: 'e',
              amount: -3,
              outcome: 'won',
              payload: { a: 1, b: 'text' },
              ext: { 'x-ns.k': 'v' },
            },
          ],
          steps: [
            step({
              id: 's1',
              journal: 'Journal',
              start: true,
              activate: { '==': [{ var: 'flag.ready' }, true] },
              objective: { kind: 'collect', item: 'i1', count: 5 },
              complete: { '==': [{ var: 'flag.ok' }, true] },
              failObjective: { kind: 'event', event: 'caught' },
              optional: true,
              repeat: true,
              outcome: { name: 'won', failed: true, title: 'Won' },
              rewards: ['r1'],
              dialogue: { provider: 'oqf', ref: 'intro' },
              location: 'l1',
              actors: ['a1'],
              ext: { 'x-ns.marker': { x: 1 }, 'x-oqf.extra': 'tail' },
            }),
          ],
        }),
        quest({ id: 'q2', title: 'Second' }),
      ],
      {
        actors: [{ id: 'a1', name: 'One' }],
        locations: [{ id: 'l1' }],
        items: [{ id: 'i1' }],
        tags: [{ id: 't1' }],
      },
    )
    const text = toCompact(source)
    expect(parseCompact(text)).toEqual(source)
    expect(toCompact(parseCompact(text))).toBe(text)
  })
})
