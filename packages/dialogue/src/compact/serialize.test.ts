import { describe, expect, it } from 'vitest'
import type { DialogueDocument } from '../model.js'
import { parseOqd } from './parse.js'
import { toOqd } from './serialize.js'

function doc(partial: Partial<DialogueDocument> = {}): DialogueDocument {
  return { speakers: [], conversations: [], ...partial }
}

function lines(text: string): string[] {
  return text.trimEnd().split('\n')
}

describe('the document frame', () => {
  it('writes the magic line and a trailing LF', () => {
    expect(toOqd(doc())).toBe('OQD1\n')
  })

  it('leaves the speakers line out when there are none', () => {
    expect(lines(toOqd(doc({ conversations: [{ id: 'a', start: 'g', nodes: [] }] })))).toEqual([
      'OQD1',
      'C\ta\t\tg',
    ])
  })
})

describe('speaker interning', () => {
  it('writes speakers in first-use order, conversation actor before node speakers', () => {
    const text = toOqd(
      doc({
        speakers: [{ id: 'otter' }, { id: 'ines', name: 'Ines' }],
        conversations: [
          {
            id: 'talk',
            actor: 'ines',
            start: 'g',
            nodes: [{ id: 'g', speaker: 'otter', text: 'x' }],
          },
        ],
      }),
    )
    expect(lines(text)[1]).toBe('A\tines|Ines\totter')
  })

  it('keeps unreferenced speakers after the used ones, in their original order', () => {
    const text = toOqd(
      doc({
        speakers: [{ id: 'gull' }, { id: 'otter' }, { id: 'ines' }],
        conversations: [{ id: 'talk', actor: 'ines', start: 'g', nodes: [] }],
      }),
    )
    expect(lines(text)[1]).toBe('A\tines\tgull\totter')
  })

  it('invents an entry for a speaker the dictionary does not declare', () => {
    const text = toOqd(
      doc({ conversations: [{ id: 'talk', actor: 'ghost', start: 'g', nodes: [] }] }),
    )
    expect(lines(text)[1]).toBe('A\tghost')
  })
})

describe('cells', () => {
  it('drops trailing empty cells', () => {
    const text = toOqd(
      doc({ conversations: [{ id: 'talk', start: 'g', nodes: [{ id: 'g', text: '' }] }] }),
    )
    expect(lines(text)).toEqual(['OQD1', 'C\ttalk\t\tg', 'N\tg'])
  })

  it('escapes tabs, newlines, carriage returns and backslashes in text', () => {
    const text = toOqd(
      doc({
        conversations: [{ id: 'talk', start: 'g', nodes: [{ id: 'g', text: 'a\tb\nc\rd\\e' }] }],
      }),
    )
    expect(lines(text)[2]).toBe(String.raw`N	g						a\tb\nc\rd\\e`)
  })

  it('writes a flag with no value bare and a flag with a value as flag=value', () => {
    const text = toOqd(
      doc({
        conversations: [
          {
            id: 'talk',
            start: 'g',
            nodes: [{ id: 'g', text: 'x', set: [{ flag: 'a' }, { flag: 'b', value: 2 }] }],
          },
        ],
      }),
    )
    expect(lines(text)[2].split('\t')[5]).toBe('a;b=2')
  })

  it('writes an emit with and without a payload', () => {
    const text = toOqd(
      doc({
        conversations: [
          {
            id: 'talk',
            start: 'g',
            nodes: [
              {
                id: 'g',
                text: 'x',
                emit: [{ event: 'one' }, { event: 'two', payload: { k: 'v', n: 3 } }],
              },
            ],
          },
        ],
      }),
    )
    expect(lines(text)[2].split('\t')[6]).toBe('one;two:k=v,n=3')
  })

  it('writes the once and disabled flags in that order', () => {
    const text = toOqd(
      doc({
        conversations: [
          {
            id: 'talk',
            start: 'g',
            nodes: [{ id: 'g', text: 'x', choices: [{ text: 'y', once: true, show: 'disabled' }] }],
          },
        ],
      }),
    )
    expect(lines(text)[3].split('\t')[3]).toBe('od')
  })

  it('treats show hidden as the default and writes no flag', () => {
    const text = toOqd(
      doc({
        conversations: [
          {
            id: 'talk',
            start: 'g',
            nodes: [{ id: 'g', text: 'x', choices: [{ text: 'y', show: 'hidden' }] }],
          },
        ],
      }),
    )
    expect(lines(text)[3]).toBe('O\t\t\t\t\t\ty')
  })

  it('writes a condition in its one canonical spelling', () => {
    const text = toOqd(
      doc({
        conversations: [
          {
            id: 'talk',
            start: 'g',
            nodes: [
              {
                id: 'g',
                text: 'x',
                choices: [
                  {
                    text: 'y',
                    condition: {
                      and: [{ var: 'flag.a' }, { '>=': [{ var: 'count.trade' }, 5] }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
    )
    expect(lines(text)[3].split('\t')[2]).toBe('flag.a and count.trade >= 5')
  })
})

describe('extensions', () => {
  it('writes X lines under the record they belong to, sorted by namespace then key', () => {
    const text = toOqd(
      doc({
        conversations: [
          {
            id: 'talk',
            start: 'g',
            nodes: [
              {
                id: 'g',
                text: 'x',
                choices: [{ text: 'y', ext: { 'x-cozycoast.sfx': 'coins' } }],
                ext: { 'x-unity.prefab': 'Line', 'x-editor.pos': { x: 1, y: 2 } },
              },
            ],
            ext: { 'x-editor.z': 1, 'x-editor.a': true },
          },
        ],
      }),
    )
    expect(lines(text)).toEqual([
      'OQD1',
      'C\ttalk\t\tg',
      'X\teditor\ta\ttrue',
      'X\teditor\tz\t1',
      'N\tg\t\t\t\t\t\tx',
      'X\teditor\tpos\tx=1;y=2',
      'X\tunity\tprefab\tLine',
      'O\t\t\t\t\t\ty',
      'X\tcozycoast\tsfx\tcoins',
    ])
  })

  it('appends the parked extra cells of a newer writer', () => {
    const text = toOqd(
      doc({
        conversations: [
          {
            id: 'talk',
            start: 'g',
            nodes: [],
            ext: { 'x-oqf.extra': 'future\tcells', 'x-editor.a': 1 },
          },
        ],
      }),
    )
    expect(lines(text)).toEqual(['OQD1', 'C\ttalk\t\tg\t\tfuture\tcells', 'X\teditor\ta\t1'])
  })

  it('refuses an extension key that is not x-<namespace>.<key>', () => {
    expect(() =>
      toOqd(doc({ conversations: [{ id: 'talk', start: 'g', nodes: [], ext: { nope: 1 } }] })),
    ).toThrow('x-<namespace>.<key>')
  })

  it('refuses parked extra cells that are not a string', () => {
    expect(() =>
      toOqd(
        doc({
          conversations: [{ id: 'talk', start: 'g', nodes: [], ext: { 'x-oqf.extra': { a: 1 } } }],
        }),
      ),
    ).toThrow('TAB separated cells')
  })
})

describe('round trip', () => {
  it('reproduces every cell of a document that uses all of them', () => {
    const source = [
      'OQD1',
      'A\tines|Harbormaster Ines\totter',
      'C\ttalk\t0\tgreet\tA title',
      'X\teditor\tpos\tx=1;y=2',
      'N\tgreet\t1\tl\tnext_one\ta;b=2\tping:k=v\tHello.',
      'O\tnext_one\tcount.trade >= 5\tod\tc\tpong\tPick me.',
      'N\tnext_one\t\t\t\t\t\tBye.',
      '',
    ].join('\n')
    expect(toOqd(parseOqd(source))).toBe(source)
  })
})
