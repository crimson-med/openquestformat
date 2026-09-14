import { Compiler, Story } from 'inkjs/full'
import { describe, expect, it } from 'vitest'
import type { DialogueContext, DialogueEvent } from '../bridge.js'
import type { DialogueDocument } from '../model.js'
import { InkProvider, type StoryChoiceLike, type StoryLike } from './adapter.js'
import { toInk } from './export.js'

function recorder(): { context: DialogueContext; events: DialogueEvent[] } {
  const events: DialogueEvent[] = []
  return {
    events,
    context: {
      resolve: () => undefined,
      emit: (event) => {
        events.push(event)
      },
    },
  }
}

const doc: DialogueDocument = {
  speakers: [{ id: 'ines', name: 'Harbormaster Ines' }],
  conversations: [
    {
      id: 'ines_intro',
      actor: 'ines',
      start: 'greet',
      nodes: [
        {
          id: 'greet',
          speaker: 'ines',
          text: 'The ledger is gone.',
          set: [{ flag: 'met_ines' }],
          emit: [{ event: 'quest.offered', payload: { id: 'ledger', tier: 2 } }],
          choices: [
            { text: 'I will find it.', next: 'help', set: [{ flag: 'agreed', value: 'yes' }] },
            { text: 'Not now.' },
          ],
        },
        { id: 'help', text: 'Thank you.' },
      ],
    },
  ],
}

describe('InkProvider against a real inkjs story', () => {
  function compiled(): StoryLike {
    return new Compiler(toInk(doc)).Compile() as unknown as StoryLike
  }

  it('walks a conversation and reports every bridge event', () => {
    const { context, events } = recorder()
    const provider = new InkProvider({
      stories: { ines: compiled() },
      actors: { 'ines#ines_intro.greet': 'ines' },
    })
    const session = provider.start('ines#ines_intro.greet', context)

    const view = session.current()
    expect(view).toMatchObject({
      conversation: 'ines#ines_intro.greet',
      node: 'greet',
      speaker: 'ines',
      text: 'The ledger is gone.',
      linear: false,
    })
    expect(view?.choices).toEqual([
      { index: 0, text: 'I will find it.', disabled: false },
      { index: 1, text: 'Not now.', disabled: false },
    ])

    session.choose(0)
    expect(session.current()).toMatchObject({ node: 'help', text: 'Thank you.', linear: true })

    session.advance()
    expect(session.ended).toBe(true)
    expect(session.current()).toBeNull()

    // inkjs runs an external call inline and notifies variable observers when
    // the batch of content is done, so the emit lands before the flag.
    expect(events.map((event) => event.name)).toEqual([
      'dialogue.started',
      'quest.offered',
      'flag.set',
      'dialogue.choice',
      'flag.set',
      'dialogue.ended',
    ])
    expect(events[0].payload).toEqual({ actor: 'ines', node: 'ines#ines_intro.greet' })
    expect(events[1].payload).toEqual({ id: 'ledger', tier: 2 })
    expect(events[2].payload).toEqual({ flag: 'met_ines', value: true })
    expect(events[3].payload).toEqual({ node: 'greet', choice: 0 })
    expect(events[4].payload).toEqual({ flag: 'agreed', value: 'yes' })
    expect(events[5].payload).toEqual({
      actor: 'ines',
      node: 'ines#ines_intro.greet',
      at: 'help',
    })
  })

  it('ends when a choice has no next', () => {
    const { context, events } = recorder()
    const provider = new InkProvider({ stories: { ines: compiled() } })
    const session = provider.start('ines#ines_intro.greet', context)
    session.choose(1)
    expect(session.ended).toBe(true)
    expect(events[events.length - 1].name).toBe('dialogue.ended')
  })

  it('builds a story from compiled JSON through the factory', () => {
    const json = (compiled() as unknown as { ToJson(): string }).ToJson()
    const { context } = recorder()
    const provider = new InkProvider({
      stories: { ines: json },
      createStory: (source) => new Story(source as string) as unknown as StoryLike,
    })
    expect(provider.start('ines#ines_intro.greet', context).current()?.node).toBe('greet')
  })

  it('rejects a ref with no story and JSON with no factory', () => {
    const { context } = recorder()
    expect(() => new InkProvider({ stories: {} }).start('missing', context)).toThrow(
      /no ink story registered/,
    )
    expect(() => new InkProvider({ stories: { a: '{}', b: '{}' } }).start('a', context)).toThrow(
      /createStory/,
    )
  })
})

/** A hand rolled story, to prove the provider needs nothing but StoryLike. */
class FakeStory implements StoryLike {
  private readonly script: (string | StoryChoiceLike[])[]
  private index = 0
  private observers = new Map<string, (name: string, value: unknown) => void>()
  private externals = new Map<string, (...args: never[]) => unknown>()
  readonly variablesState = ['flag__met', 'count__trade']
  readonly state = { currentPathString: 'fake.only' }

  constructor(script: (string | StoryChoiceLike[])[]) {
    this.script = script
  }

  get canContinue(): boolean {
    return typeof this.script[this.index] === 'string'
  }

  get currentChoices(): StoryChoiceLike[] {
    const next = this.script[this.index]
    return Array.isArray(next) ? next : []
  }

  get currentTags(): string[] | null {
    return ['speaker: fake']
  }

  Continue(): string | null {
    const line = this.script[this.index]
    this.index += 1
    return typeof line === 'string' ? line : null
  }

  ChooseChoiceIndex(index: number): void {
    this.index += 1
    this.script.push(`picked ${index}`)
  }

  ChoosePathString(): void {
    this.index = 0
  }

  ObserveVariable(name: string, observer: (name: string, value: unknown) => void): void {
    this.observers.set(name, observer)
  }

  BindExternalFunction(name: string, fn: (...args: never[]) => unknown): void {
    this.externals.set(name, fn)
  }

  fire(name: string, value: unknown): void {
    this.observers.get(name)?.(name, value)
  }

  call(name: string, ...args: unknown[]): void {
    this.externals.get(name)?.(...(args as never[]))
  }
}

describe('InkProvider against a fake story', () => {
  it('needs nothing from inkjs beyond the StoryLike surface', () => {
    const story = new FakeStory(['Hello.', [{ index: 0, text: 'Go' }]])
    const { context, events } = recorder()
    const provider = new InkProvider({ stories: { only: story }, actors: { only: 'fake' } })
    const session = provider.start('only', context)
    expect(session.current()).toMatchObject({ node: 'only', speaker: 'fake', text: 'Hello.' })
    expect(events[0]).toEqual({
      name: 'dialogue.started',
      payload: { actor: 'fake', node: 'only' },
    })
  })

  it('turns a flag__ observer into flag.set and ignores other namespaces', () => {
    const story = new FakeStory(['Hello.'])
    const { context, events } = recorder()
    new InkProvider({ stories: { only: story } }).start('only', context)
    story.fire('flag__met', true)
    story.fire('count__trade', 4)
    expect(events.filter((event) => event.name === 'flag.set')).toEqual([
      { name: 'flag.set', payload: { flag: 'met', value: true } },
    ])
  })

  it('turns the oqf_emit external into an event with a decoded payload', () => {
    const story = new FakeStory(['Hello.'])
    const { context, events } = recorder()
    new InkProvider({ stories: { only: story } }).start('only', context)
    story.call('oqf_emit', 'quest.offered', 'id=ledger,tier=2,ok=true')
    expect(events.find((event) => event.name === 'quest.offered')?.payload).toEqual({
      id: 'ledger',
      tier: 2,
      ok: true,
    })
  })

  it('observes the variables the host names when the story lists none', () => {
    const story = new FakeStory(['Hello.'])
    Object.defineProperty(story, 'variablesState', { value: undefined })
    const { context, events } = recorder()
    new InkProvider({ stories: { only: story }, variables: ['flag__loud'] }).start('only', context)
    story.fire('flag__loud', 'yes')
    expect(events.at(-1)).toEqual({ name: 'flag.set', payload: { flag: 'loud', value: 'yes' } })
  })

  it('refuses an unknown choice index', () => {
    const story = new FakeStory(['Hello.', [{ index: 0, text: 'Go' }]])
    const { context } = recorder()
    const session = new InkProvider({ stories: { only: story } }).start('only', context)
    expect(() => session.choose(9)).toThrow(/unknown choice index/)
  })

  it('ends when the script runs out and stays ended', () => {
    const story = new FakeStory(['Hello.'])
    const { context, events } = recorder()
    const session = new InkProvider({ stories: { only: story } }).start('only', context)
    session.advance()
    expect(session.ended).toBe(true)
    session.advance()
    expect(events.filter((event) => event.name === 'dialogue.ended')).toHaveLength(1)
    expect(() => session.choose(0)).toThrow(/ended/)
  })
})
