import { describe, expect, it } from 'vitest'
import { OqdFormatError, parseOqd } from './parse.js'

function oqd(...lines: string[]): string {
  return `${['OQD1', ...lines].join('\n')}\n`
}

/** A one node conversation with the given `N` cells filled in. */
function node(cells: string): string {
  return oqd('C\ttalk\t\tonly\t', `N\t${cells}`)
}

function caught(text: string): OqdFormatError {
  try {
    parseOqd(text)
  } catch (error) {
    if (error instanceof OqdFormatError) return error
    throw error
  }
  throw new Error('expected parseOqd to throw')
}

describe('the magic line', () => {
  it('accepts a document that starts with OQD1', () => {
    expect(parseOqd('OQD1\n')).toEqual({ speakers: [], conversations: [] })
  })

  it('skips blank lines and comments before the magic line', () => {
    expect(parseOqd('\n# a note\nOQD1\n')).toEqual({ speakers: [], conversations: [] })
  })

  it('rejects a different magic line', () => {
    expect(caught('OQF1\n')).toMatchObject({ line: 1, name: 'OqdFormatError' })
  })

  it('rejects an empty document', () => {
    expect(caught('')).toMatchObject({ line: 1 })
    expect(caught('').message).toContain('empty document')
  })
})

describe('the speakers dictionary', () => {
  it('reads bare ids and piped display names', () => {
    const doc = parseOqd(oqd('A\tharbormaster|Harbormaster Ines\totter'))
    expect(doc.speakers).toEqual([
      { id: 'harbormaster', name: 'Harbormaster Ines' },
      { id: 'otter' },
    ])
  })

  it('rejects a second speakers line', () => {
    expect(caught(oqd('A\tone', 'A\ttwo'))).toMatchObject({ line: 3 })
  })

  it('rejects a speakers line after the first conversation', () => {
    expect(caught(oqd('C\ttalk\t\tonly', 'A\tone'))).toMatchObject({ line: 3 })
  })
})

describe('conversations', () => {
  it('reads id, actor, start and title', () => {
    const doc = parseOqd(oqd('A\tharbormaster|Harbormaster Ines', 'C\tines_intro\t0\tgreet\tIntro'))
    expect(doc.conversations).toEqual([
      { id: 'ines_intro', actor: 'harbormaster', title: 'Intro', start: 'greet', nodes: [] },
    ])
  })

  it('leaves the actor and the title out when the cells are empty', () => {
    const doc = parseOqd(oqd('C\tines_intro\t\tgreet'))
    expect(doc.conversations[0]).toEqual({ id: 'ines_intro', start: 'greet', nodes: [] })
  })

  it('rejects a missing id', () => {
    expect(caught(oqd('C\t\t\tgreet'))).toMatchObject({ line: 2 })
  })

  it('rejects a missing start node', () => {
    expect(caught(oqd('C\tines_intro'))).toMatchObject({ line: 2 })
    expect(caught(oqd('C\tines_intro')).message).toContain('missing start node')
  })

  it('rejects an actor index outside the dictionary', () => {
    expect(caught(oqd('A\tone', 'C\tines_intro\t4\tgreet'))).toMatchObject({ line: 3 })
  })
})

describe('nodes', () => {
  it('reads the plain cells', () => {
    const doc = parseOqd(node('greet\t\t\thello\t\t\tThe ledger is gone.'))
    expect(doc.conversations[0].nodes[0]).toEqual({
      id: 'greet',
      text: 'The ledger is gone.',
      next: 'hello',
    })
  })

  it('reads the speaker index and the lore flag', () => {
    const doc = parseOqd(
      oqd('A\tharbormaster\totter', 'C\ttalk\t\tonly', 'N\tonly\t1\tl\t\t\t\tA line.'),
    )
    expect(doc.conversations[0].nodes[0]).toEqual({
      id: 'only',
      speaker: 'otter',
      text: 'A line.',
      lore: true,
    })
  })

  it('rejects an unknown node flag', () => {
    expect(caught(node('only\t\tz'))).toMatchObject({ line: 3 })
  })

  it('rejects a node before any conversation', () => {
    expect(caught(oqd('N\tonly'))).toMatchObject({ line: 2 })
  })

  it('rejects a missing node id', () => {
    expect(caught(node('\t\t\t\t\t\tA line.'))).toMatchObject({ line: 3 })
  })
})

describe('the set cell', () => {
  it('reads a bare flag as a set with no value', () => {
    const doc = parseOqd(node('only\t\t\t\tmet_ines\t\tA line.'))
    expect(doc.conversations[0].nodes[0].set).toEqual([{ flag: 'met_ines' }])
  })

  it('types values like payload values', () => {
    const doc = parseOqd(node('only\t\t\t\ta=1;b=true;c=false;d=text;e=-2.5\t\tA line.'))
    expect(doc.conversations[0].nodes[0].set).toEqual([
      { flag: 'a', value: 1 },
      { flag: 'b', value: true },
      { flag: 'c', value: false },
      { flag: 'd', value: 'text' },
      { flag: 'e', value: -2.5 },
    ])
  })

  it('honours backslash escapes for the separators', () => {
    const escaped = String.raw`a\;b=c\=d`
    const doc = parseOqd(node(`only\t\t\t\t${escaped}\t\tA line.`))
    expect(doc.conversations[0].nodes[0].set).toEqual([{ flag: 'a;b', value: 'c=d' }])
  })

  it('rejects an empty entry', () => {
    expect(caught(node('only\t\t\t\ta;;b\t\tA line.'))).toMatchObject({ line: 3 })
  })

  it('rejects an empty flag name', () => {
    expect(caught(node('only\t\t\t\t=1\t\tA line.'))).toMatchObject({ line: 3 })
  })
})

describe('the emit cell', () => {
  it('reads bare event names', () => {
    const doc = parseOqd(node('only\t\t\t\t\tone;two\tA line.'))
    expect(doc.conversations[0].nodes[0].emit).toEqual([{ event: 'one' }, { event: 'two' }])
  })

  it('reads a flat payload', () => {
    const doc = parseOqd(node('only\t\t\t\t\tdone:who=ines,count=2\tA line.'))
    expect(doc.conversations[0].nodes[0].emit).toEqual([
      { event: 'done', payload: { who: 'ines', count: 2 } },
    ])
  })

  it('honours backslash escapes for the separators', () => {
    const escaped = String.raw`a\:b:k\,x=v\;y`
    const doc = parseOqd(node(`only\t\t\t\t\t${escaped}\tA line.`))
    expect(doc.conversations[0].nodes[0].emit).toEqual([
      { event: 'a:b', payload: { 'k,x': 'v;y' } },
    ])
  })

  it('rejects a payload entry that is not key=value', () => {
    expect(caught(node('only\t\t\t\t\tdone:oops\tA line.'))).toMatchObject({ line: 3 })
  })

  it('rejects an empty event name', () => {
    expect(caught(node('only\t\t\t\t\t;a\tA line.'))).toMatchObject({ line: 3 })
  })
})

describe('choices', () => {
  it('attaches to the node above and reads every cell', () => {
    const doc = parseOqd(
      oqd(
        'C\ttalk\t\tgreet',
        'N\tgreet\t\t\t\t\t\tPick one.',
        'O\thelp\tflag.met\tod\tmet=1\tping\tI will help.',
        'O\t\t\t\t\t\tNever mind.',
      ),
    )
    expect(doc.conversations[0].nodes[0].choices).toEqual([
      {
        text: 'I will help.',
        next: 'help',
        condition: { '==': [{ var: 'flag.met' }, true] },
        show: 'disabled',
        set: [{ flag: 'met', value: 1 }],
        emit: [{ event: 'ping' }],
        once: true,
      },
      { text: 'Never mind.' },
    ])
  })

  it('rejects an unknown choice flag', () => {
    expect(caught(oqd('C\ttalk\t\tg', 'N\tg\t\t\t\t\t\tx', 'O\t\t\tz'))).toMatchObject({ line: 4 })
  })

  it('rejects a choice before any node', () => {
    expect(caught(oqd('C\ttalk\t\tg', 'O\t\t\t\t\t\tx'))).toMatchObject({ line: 3 })
  })

  it('reports a condition syntax error on the choice line', () => {
    const error = caught(oqd('C\ttalk\t\tg', 'N\tg\t\t\t\t\t\tx', 'O\t\tflag.met and\t\t\t\ty'))
    expect(error.line).toBe(4)
  })
})

describe('extensions', () => {
  it('attaches an X line to the conversation, the node and the choice above it', () => {
    const doc = parseOqd(
      oqd(
        'C\ttalk\t\tg',
        'X\teditor\tpos\tx=1;y=2',
        'N\tg\t\t\t\t\t\tx',
        'X\tcozycoast\tcamera\twide',
        'O\t\t\t\t\t\ty',
        'X\tcozycoast\tsfx\tcoins',
      ),
    )
    const conversation = doc.conversations[0]
    expect(conversation.ext).toEqual({ 'x-editor.pos': { x: 1, y: 2 } })
    expect(conversation.nodes[0].ext).toEqual({ 'x-cozycoast.camera': 'wide' })
    expect(conversation.nodes[0].choices?.[0].ext).toEqual({ 'x-cozycoast.sfx': 'coins' })
  })

  it('types a scalar extension value', () => {
    const doc = parseOqd(oqd('C\ttalk\t\tg', 'X\tcozycoast\tchapter\t3'))
    expect(doc.conversations[0].ext).toEqual({ 'x-cozycoast.chapter': 3 })
  })

  it('rejects an invalid namespace or key', () => {
    expect(caught(oqd('C\ttalk\t\tg', 'X\tNope\tkey\t1'))).toMatchObject({ line: 3 })
    expect(caught(oqd('C\ttalk\t\tg', 'X\tok\tno key\t1'))).toMatchObject({ line: 3 })
  })

  it('rejects an extension line before any conversation', () => {
    expect(caught(oqd('X\teditor\tpos\t1'))).toMatchObject({ line: 2 })
  })
})

describe('forward compatibility', () => {
  it('parks extra cells on a conversation under x-oqf.extra', () => {
    const doc = parseOqd(oqd('C\ttalk\t\tg\tTitle\tfuture\tcells'))
    expect(doc.conversations[0].ext).toEqual({ 'x-oqf.extra': 'future\tcells' })
  })

  it('parks extra cells on a node and a choice', () => {
    const doc = parseOqd(
      oqd('C\ttalk\t\tg', 'N\tg\t\t\t\t\t\tx\tmore', 'O\t\t\t\t\t\ty\tmore\tstill'),
    )
    expect(doc.conversations[0].nodes[0].ext).toEqual({ 'x-oqf.extra': 'more' })
    expect(doc.conversations[0].nodes[0].choices?.[0].ext).toEqual({
      'x-oqf.extra': 'more\tstill',
    })
  })

  it('accepts a record shorter than the frozen column order', () => {
    expect(parseOqd(oqd('C\ttalk\t\tg', 'N\tg')).conversations[0].nodes[0]).toEqual({
      id: 'g',
      text: '',
    })
  })
})

describe('lexical rules', () => {
  it('decodes the four cell escapes and nothing else', () => {
    const doc = parseOqd(node('only\t\t\t\t\t\ta\\tb\\nc\\\\d\\re\\q'))
    expect(doc.conversations[0].nodes[0].text).toBe('a\tb\nc\\d\re\\q')
  })

  it('ignores blank lines, comments and carriage returns', () => {
    const doc = parseOqd('OQD1\r\n\r\n# note\r\nC\ttalk\t\tg\r\n')
    expect(doc.conversations[0].id).toBe('talk')
  })

  it('rejects an unknown record type', () => {
    expect(caught(oqd('Z\tsomething'))).toMatchObject({ line: 2 })
  })
})
