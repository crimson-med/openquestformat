import { describe, expect, it } from 'vitest'
import { OQF_MAGIC } from '../model.js'
import { CompactFormatError, parseCompact } from './parse.js'

/** Column positions from the frozen order in docs/12-compact-spec.md. */
const Q = { id: 1, version: 2, flags: 3, tags: 4, unlock: 5, title: 6, summary: 7 } as const
const R = { id: 1, kind: 2, ref: 3, amount: 4, outcome: 5, payload: 6 } as const
const S = {
  id: 1,
  flags: 2,
  unlock: 3,
  activate: 4,
  complete: 5,
  fail: 6,
  outcome: 7,
  rewards: 8,
  dialogue: 9,
  location: 10,
  actors: 11,
  title: 12,
  journal: 13,
} as const

function row(type: string, fields: Record<number, string>, count: number): string {
  const cells = [type, ...new Array<string>(count).fill('')]
  for (const [index, value] of Object.entries(fields)) cells[Number(index)] = value
  return cells.join('\t')
}

const quest = (fields: Record<number, string> = {}): string =>
  row('Q', { [Q.id]: 'q', [Q.version]: '1', [Q.title]: 'Quest', ...fields }, 7)

const reward = (fields: Record<number, string> = {}): string =>
  row('R', { [R.id]: 'r1', [R.kind]: 'xp', [R.ref]: 'xp', ...fields }, 6)

const step = (fields: Record<number, string> = {}): string =>
  row('S', { [S.id]: 's1', [S.title]: 'Step', ...fields }, 13)

const doc = (...rows: string[]): string => `${[OQF_MAGIC, ...rows].join('\n')}\n`

function raised(text: string): CompactFormatError {
  try {
    parseCompact(text)
  } catch (caught) {
    if (caught instanceof CompactFormatError) return caught
    throw caught
  }
  throw new Error('expected parseCompact to throw a CompactFormatError')
}

describe('parseCompact structure', () => {
  it('reads a quest with its steps and rewards', () => {
    const document = parseCompact(
      doc(
        'T\tmain\tside',
        'A\thero|The Hero',
        'L\tden|The den',
        quest({ [Q.tags]: '1,0', [Q.flags]: 'r', [Q.unlock]: 'flag.open', [Q.summary]: 'Sum' }),
        reward({ [R.amount]: '50' }),
        step({
          [S.flags]: 'sor',
          [S.complete]: 'kill hero 3 and flag.night',
          [S.rewards]: '0',
          [S.dialogue]: 'oqf:intro',
          [S.location]: '0',
          [S.actors]: '0',
          [S.journal]: 'Journal',
        }),
      ),
    )

    expect(document.dictionaries).toEqual({
      actors: [{ id: 'hero', name: 'The Hero' }],
      locations: [{ id: 'den', name: 'The den' }],
      items: [],
      tags: [{ id: 'main' }, { id: 'side' }],
    })
    expect(document.quests).toEqual([
      {
        id: 'q',
        version: 1,
        title: 'Quest',
        summary: 'Sum',
        tags: ['side', 'main'],
        repeat: true,
        unlock: { '==': [{ var: 'flag.open' }, true] },
        steps: [
          {
            id: 's1',
            title: 'Step',
            journal: 'Journal',
            start: true,
            objective: { kind: 'kill', actor: 'hero', count: 3 },
            complete: { '==': [{ var: 'flag.night' }, true] },
            optional: true,
            repeat: true,
            rewards: ['r1'],
            dialogue: { provider: 'oqf', ref: 'intro' },
            location: 'den',
            actors: ['hero'],
          },
        ],
        rewards: [{ id: 'r1', kind: 'xp', ref: 'xp', amount: 50 }],
      },
    ])
  })

  it('ignores comments and blank lines', () => {
    const document = parseCompact(
      `# leading note\n${OQF_MAGIC}\n\n# another\n${quest()}\n\n${step()}\n`,
    )
    expect(document.quests).toHaveLength(1)
    expect(document.quests[0].steps).toHaveLength(1)
  })

  it('reads two quests in one file', () => {
    const document = parseCompact(
      doc(
        quest({ [Q.id]: 'first' }),
        step({ [S.id]: 'a' }),
        quest({ [Q.id]: 'second', [Q.version]: '4' }),
        reward({ [R.id]: 'gold', [R.kind]: 'currency', [R.ref]: 'coins' }),
        step({ [S.id]: 'b', [S.rewards]: '0' }),
      ),
    )
    expect(document.quests.map((entry) => entry.id)).toEqual(['first', 'second'])
    expect(document.quests[0].steps.map((entry) => entry.id)).toEqual(['a'])
    expect(document.quests[1].version).toBe(4)
    expect(document.quests[1].steps[0].rewards).toEqual(['gold'])
  })

  it('treats missing trailing cells as absent', () => {
    const document = parseCompact(`${OQF_MAGIC}\nQ\tq\t1\n`)
    expect(document.quests[0]).toEqual({
      id: 'q',
      version: 1,
      title: '',
      tags: [],
      steps: [],
      rewards: [],
    })
  })

  it('treats explicit trailing empty cells as absent too', () => {
    expect(parseCompact(`${OQF_MAGIC}\nQ\tq\t1\t\t\t\t\t\n`).quests[0].summary).toBeUndefined()
  })

  it('reads the outcome cell in all four spellings', () => {
    const document = parseCompact(
      doc(
        quest(),
        step({ [S.id]: 'a', [S.outcome]: 'done' }),
        step({ [S.id]: 'b', [S.outcome]: '!lost' }),
        step({ [S.id]: 'c', [S.outcome]: 'done|All Good' }),
        step({ [S.id]: 'd', [S.outcome]: '!lost|Too Bad' }),
      ),
    )
    expect(document.quests[0].steps.map((entry) => entry.outcome)).toEqual([
      { name: 'done' },
      { name: 'lost', failed: true },
      { name: 'done', title: 'All Good' },
      { name: 'lost', failed: true, title: 'Too Bad' },
    ])
  })

  it('splits a dialogue binding on the first colon', () => {
    const document = parseCompact(doc(quest(), step({ [S.dialogue]: 'ink:knot.sub:2' })))
    expect(document.quests[0].steps[0].dialogue).toEqual({ provider: 'ink', ref: 'knot.sub:2' })
  })

  it('reads the fail cell as an objective and a condition', () => {
    const document = parseCompact(
      doc(quest(), step({ [S.fail]: 'event guard.caught 2 and flag.alarm' })),
    )
    expect(document.quests[0].steps[0].failObjective).toEqual({
      kind: 'event',
      event: 'guard.caught',
      count: 2,
    })
    expect(document.quests[0].steps[0].fail).toEqual({ '==': [{ var: 'flag.alarm' }, true] })
  })

  it('reads dictionary refs with and without a display name', () => {
    const document = parseCompact(doc('A\tplain\tnamed|A Name|With Pipe', quest()))
    expect(document.dictionaries.actors).toEqual([
      { id: 'plain' },
      { id: 'named', name: 'A Name|With Pipe' },
    ])
  })
})

describe('parseCompact escapes', () => {
  it('decodes the four cell escapes', () => {
    const document = parseCompact(
      doc(quest({ [Q.title]: 'a\\tb\\nc\\rd\\\\e', [Q.summary]: 'no escapes' })),
    )
    expect(document.quests[0].title).toBe('a\tb\nc\rd\\e')
  })

  it('leaves an unknown escape alone', () => {
    expect(parseCompact(doc(quest({ [Q.title]: 'a\\qb' }))).quests[0].title).toBe('a\\qb')
  })
})

describe('parseCompact payloads', () => {
  it('types values as numbers, booleans and strings', () => {
    const document = parseCompact(
      doc(quest(), reward({ [R.payload]: 'n=2.5;neg=-7;yes=true;no=false;word=catch_log' })),
    )
    expect(document.quests[0].rewards[0].payload).toEqual({
      n: 2.5,
      neg: -7,
      yes: true,
      no: false,
      word: 'catch_log',
    })
  })

  it('decodes escaped separators inside keys and values', () => {
    const document = parseCompact(doc(quest(), reward({ [R.payload]: 'a\\=b=c\\;d' })))
    expect(document.quests[0].rewards[0].payload).toEqual({ 'a=b': 'c;d' })
  })

  it('keeps a value with a leading zero as text', () => {
    const document = parseCompact(doc(quest(), reward({ [R.payload]: 'code=007' })))
    expect(document.quests[0].rewards[0].payload).toEqual({ code: '007' })
  })
})

describe('parseCompact extensions', () => {
  it('attaches X to the previous quest, reward and step', () => {
    const document = parseCompact(
      doc(
        quest(),
        'X\teditor\tpos\tx=120;y=40',
        reward(),
        'X\teditor\tnote\thello',
        step(),
        'X\tcozycoast\tmarker\tpier_02',
      ),
    )
    expect(document.quests[0].ext).toEqual({ 'x-editor.pos': { x: 120, y: 40 } })
    expect(document.quests[0].rewards[0].ext).toEqual({ 'x-editor.note': 'hello' })
    expect(document.quests[0].steps[0].ext).toEqual({ 'x-cozycoast.marker': 'pier_02' })
  })

  it('types a scalar X value and escapes it out of map shape', () => {
    const document = parseCompact(
      doc(quest(), 'X\tns\tcount\t12', 'X\tns\tflag\ttrue', 'X\tns\ttext\ta\\=b'),
    )
    expect(document.quests[0].ext).toEqual({
      'x-ns.count': 12,
      'x-ns.flag': true,
      'x-ns.text': 'a=b',
    })
  })

  it('preserves extra cells beyond the frozen order', () => {
    const document = parseCompact(
      doc(`${quest()}\tone\ttwo`, `${reward()}\tthree`, `${step()}\tfour\t\tfive`),
    )
    expect(document.quests[0].ext).toEqual({ 'x-oqf.extra': 'one\ttwo' })
    expect(document.quests[0].rewards[0].ext).toEqual({ 'x-oqf.extra': 'three' })
    expect(document.quests[0].steps[0].ext).toEqual({ 'x-oqf.extra': 'four\t\tfive' })
  })
})

describe('parseCompact errors', () => {
  it('rejects a wrong magic line', () => {
    const error = raised('OQF2\n')
    expect(error.line).toBe(1)
    expect(error.message).toMatch(/expected the magic line "OQF1"/)
  })

  it('rejects an empty document', () => {
    expect(raised('').line).toBe(1)
  })

  it('rejects an unknown record type', () => {
    const error = raised(doc(quest(), 'Z\tsomething'))
    expect(error.line).toBe(3)
    expect(error.message).toMatch(/unknown record type "Z"/)
  })

  it('rejects a dictionary line after the first quest', () => {
    const error = raised(doc(quest(), 'T\tmain'))
    expect(error.line).toBe(3)
    expect(error.message).toMatch(/dictionary line "T" after the first quest/)
  })

  it('rejects a duplicate dictionary line', () => {
    const error = raised(doc('T\tmain', 'T\tside', quest()))
    expect(error.line).toBe(3)
    expect(error.message).toMatch(/duplicate dictionary line "T"/)
  })

  it('rejects a reward before any quest', () => {
    const error = raised(doc(reward()))
    expect(error.line).toBe(2)
    expect(error.message).toMatch(/reward line before any quest/)
  })

  it('rejects a step before any quest', () => {
    const error = raised(doc(step()))
    expect(error.line).toBe(2)
    expect(error.message).toMatch(/step line before any quest/)
  })

  it('rejects an extension before any quest', () => {
    const error = raised(doc('T\tmain', 'X\tns\tkey\tvalue'))
    expect(error.line).toBe(3)
    expect(error.message).toMatch(/extension line before any quest/)
  })

  it('rejects a tag index out of range', () => {
    const error = raised(doc('T\tmain', quest({ [Q.tags]: '0,4' })))
    expect(error.line).toBe(3)
    expect(error.message).toMatch(/a quest tag index 4 is out of range/)
  })

  it('rejects an actor index out of range', () => {
    const error = raised(doc(quest(), step({ [S.actors]: '0' })))
    expect(error.line).toBe(3)
    expect(error.message).toMatch(/a step actor index 0 is out of range/)
  })

  it('rejects a location index out of range', () => {
    const error = raised(doc('L\tden', quest(), step({ [S.location]: '1' })))
    expect(error.line).toBe(4)
    expect(error.message).toMatch(/a step location index 1 is out of range/)
  })

  it('rejects a reward index out of range', () => {
    const error = raised(doc(quest(), reward(), step({ [S.rewards]: '0,1' })))
    expect(error.line).toBe(4)
    expect(error.message).toMatch(/a step reward index 1 is out of range/)
  })

  it('rejects a bad flags letter on a quest', () => {
    const error = raised(doc(quest({ [Q.flags]: 'z' })))
    expect(error.line).toBe(2)
    expect(error.message).toMatch(/unknown flag "z"/)
  })

  it('rejects a bad flags letter on a step', () => {
    const error = raised(doc(quest(), step({ [S.flags]: 'sx' })))
    expect(error.line).toBe(3)
    expect(error.message).toMatch(/unknown flag "x"/)
  })

  it('rejects an unknown reward kind', () => {
    const error = raised(doc(quest(), reward({ [R.kind]: 'magic' })))
    expect(error.line).toBe(3)
    expect(error.message).toMatch(/unknown reward kind "magic"/)
  })

  it('rejects a bad quest version', () => {
    const error = raised(doc(quest({ [Q.version]: 'one' })))
    expect(error.line).toBe(2)
    expect(error.message).toMatch(/invalid number "one" for a quest version/)
  })

  it('rejects a fractional quest version', () => {
    expect(raised(doc(quest({ [Q.version]: '1.5' }))).message).toMatch(/expected an integer/)
  })

  it('rejects a bad reward amount', () => {
    const error = raised(doc(quest(), reward({ [R.amount]: 'lots' })))
    expect(error.line).toBe(3)
    expect(error.message).toMatch(/invalid number "lots" for a reward amount/)
  })

  it('rejects a bad index', () => {
    const error = raised(doc('T\tmain', quest({ [Q.tags]: 'main' })))
    expect(error.line).toBe(3)
    expect(error.message).toMatch(/invalid number "main" for a quest tag/)
  })

  it('rejects bad payload syntax', () => {
    expect(raised(doc(quest(), reward({ [R.payload]: 'a=b=c' }))).message).toMatch(
      /invalid entry "a=b=c" in a reward payload/,
    )
    expect(raised(doc(quest(), reward({ [R.payload]: 'lonely' }))).message).toMatch(
      /expected key=value/,
    )
    expect(raised(doc(quest(), reward({ [R.payload]: 'a=1;' }))).message).toMatch(/empty entry/)
    expect(raised(doc(quest(), reward({ [R.payload]: '=1' }))).message).toMatch(/empty key/)
    expect(raised(doc(quest(), reward({ [R.payload]: 'a=1;b' }))).line).toBe(3)
  })

  it('rejects a bad dialogue binding', () => {
    const error = raised(doc(quest(), step({ [S.dialogue]: 'oqf_intro' })))
    expect(error.line).toBe(3)
    expect(error.message).toMatch(/invalid dialogue binding "oqf_intro"/)
  })

  it('rejects a bad extension namespace or key', () => {
    expect(raised(doc(quest(), 'X\tNS\tkey\tv')).message).toMatch(/invalid extension namespace/)
    expect(raised(doc(quest(), 'X\tns\tk y\tv')).message).toMatch(/invalid extension key/)
  })

  it('wraps a condition syntax error with the line and the offset', () => {
    const error = raised(doc(quest({ [Q.unlock]: 'flag.open ==' })))
    expect(error.line).toBe(2)
    expect(error.message).toMatch(/at offset 12 on line 2/)
  })

  it('wraps a completion syntax error', () => {
    const error = raised(doc(quest(), step({ [S.complete]: 'collect' })))
    expect(error.line).toBe(3)
    expect(error.message).toMatch(/an item reference.*on line 3/)
  })

  it('rejects missing required cells', () => {
    expect(raised(doc(quest({ [Q.id]: '' }))).message).toMatch(/missing quest id/)
    expect(raised(doc(quest({ [Q.version]: '' }))).message).toMatch(/missing quest version/)
    expect(raised(doc(quest(), reward({ [R.id]: '' }))).message).toMatch(/missing reward id/)
    expect(raised(doc(quest(), reward({ [R.kind]: '' }))).message).toMatch(/missing reward kind/)
    expect(raised(doc(quest(), reward({ [R.ref]: '' }))).message).toMatch(/missing reward ref/)
    expect(raised(doc(quest(), step({ [S.id]: '' }))).message).toMatch(/missing step id/)
    expect(raised(doc(quest(), step({ [S.title]: '' }))).message).toMatch(/missing step title/)
  })
})
