/**
 * A dialogue bridge provider backed by an Ink story.
 *
 * `inkjs` is an optional peer dependency and this module never imports it, not
 * even for types. It talks to the tiny structural `StoryLike` interface below,
 * which a real `inkjs` `Story` satisfies as it stands, so the module loads and
 * type checks in a project that has no Ink runtime at all. The story itself is
 * injected: `stories` maps a conversation ref to either a compiled story JSON or
 * an already built story, and `createStory` turns the JSON into a story when the
 * host hands over JSON.
 *
 * What it translates:
 *
 * | Ink | Bridge |
 * |-----|--------|
 * | a variable observer on `flag__*` | `flag.set { flag, value }` |
 * | the `oqf_emit(event, payload)` external | the event, with the payload decoded |
 * | the `# node:` tag `toInk` writes | `DialogueView.node` |
 * | `currentChoices` | `DialogueView.choices` |
 * | entering the conversation | `dialogue.started { actor, node: ref }` |
 * | the story running out of content | `dialogue.ended { actor, node: ref, at }` |
 *
 * Only `flag.*` is observed, because that is the only namespace a dialogue
 * owns. Ink variables that mirror `count.*`, `step.*`, `outcome.*`, `quest.*`
 * or `var.*` belong to the quest runtime and are pushed in by the host, so
 * reporting them back as flags would be wrong.
 *
 * A ref is `<story key>#<knot path>`. Without a `#` the whole ref is used as
 * both, and when the ref is not a story key and exactly one story is
 * registered, that story is used and the ref is the knot path.
 */
import type { Scalar } from '@oqf/core'
import {
  DIALOGUE_CHOICE,
  DIALOGUE_ENDED,
  DIALOGUE_STARTED,
  type DialogueContext,
  type DialogueProvider,
  type DialogueSession,
  type DialogueView,
  FLAG_SET,
} from '../bridge.js'
import { decodePayload, decodeTagValue, fromIdentifier } from './naming.js'

/** One entry of `Story.currentChoices`. */
export interface StoryChoiceLike {
  readonly index: number
  readonly text: string
}

/** The slice of the inkjs `Story` surface this provider uses. */
export interface StoryLike {
  readonly canContinue: boolean
  readonly currentChoices: StoryChoiceLike[]
  readonly currentTags: string[] | null
  Continue(): string | null
  ChooseChoiceIndex(index: number): void
  ChoosePathString(path: string, resetCallstack?: boolean, args?: unknown[]): void
  ObserveVariable(name: string, observer: (name: string, value: unknown) => void): void
  BindExternalFunction(
    name: string,
    fn: (...args: never[]) => unknown,
    lookaheadSafe?: boolean,
  ): void
  readonly state?: { readonly currentPathString?: string | null }
  readonly variablesState?: unknown
}

export interface InkProviderOptions {
  /** Compiled story JSON or a built story, by conversation ref or story key. */
  stories: Record<string, unknown>
  /** Turns compiled story JSON into a story. Required when `stories` holds JSON. */
  createStory?: (json: unknown) => StoryLike
  /** Variables to observe when the story cannot list its own. */
  variables?: string[]
  /** Conversation actor per ref, reported on `dialogue.started` and `dialogue.ended`. */
  actors?: Record<string, string>
}

function isStory(value: unknown): value is StoryLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoryLike).ChoosePathString === 'function'
  )
}

function scalar(value: unknown): Scalar {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  return value === null || value === undefined ? '' : String(value)
}

/**
 * The variables to observe: the explicit list, plus whatever the story can tell
 * us about itself. inkjs 2.4 exposes its globals as a private map rather than
 * an iterable, so both shapes are probed and a story that offers neither simply
 * relies on `options.variables`.
 */
function variableNames(story: StoryLike, extra: string[] | undefined): string[] {
  const names: string[] = [...(extra ?? [])]
  const add = (value: unknown): void => {
    const text = String(value)
    if (text !== '' && !names.includes(text)) names.push(text)
  }
  const state = story.variablesState
  if (state === null || typeof state !== 'object') return names
  if (
    Symbol.iterator in state &&
    typeof (state as Iterable<unknown>)[Symbol.iterator] === 'function'
  ) {
    for (const name of state as Iterable<unknown>) add(name)
    return names
  }
  const globals = (state as { _globalVariables?: { keys?: () => Iterable<unknown> } })
    ._globalVariables
  if (globals !== undefined && typeof globals.keys === 'function') {
    for (const name of globals.keys()) add(name)
  }
  return names
}

function tagValue(tags: string[], name: string): string | undefined {
  const prefix = `${name}:`
  for (const tag of tags) {
    const text = tag.trim()
    if (text.toLowerCase().startsWith(prefix))
      return decodeTagValue(text.slice(prefix.length).trim())
  }
  return undefined
}

class InkSession implements DialogueSession {
  private readonly story: StoryLike
  private readonly context: DialogueContext
  private readonly ref: string
  private readonly actor: string | undefined
  private view: DialogueView | null = null
  private lastPath: string | undefined
  private done = false

  constructor(story: StoryLike, context: DialogueContext, ref: string, actor: string | undefined) {
    this.story = story
    this.context = context
    this.ref = ref
    this.actor = actor
  }

  get ended(): boolean {
    return this.done
  }

  current(): DialogueView | null {
    return this.done ? null : this.view
  }

  advance(): void {
    if (this.done) return
    if (this.view !== null && this.view.choices.length > 0) return
    if (this.story.canContinue) {
      this.step()
      return
    }
    this.finish()
  }

  choose(index: number): void {
    if (this.done || this.view === null) throw new Error('the conversation has ended')
    const choice = this.view.choices.find((item) => item.index === index)
    if (choice === undefined) throw new Error(`unknown choice index ${index}`)
    if (choice.disabled) throw new Error(`choice ${index} is disabled`)
    this.context.emit({ name: DIALOGUE_CHOICE, payload: { node: this.view.node, choice: index } })
    this.story.ChooseChoiceIndex(index)
    this.step()
  }

  private nodeId(path?: string): string {
    const value = path ?? this.story.state?.currentPathString ?? this.lastPath
    if (typeof value !== 'string' || value === '') return this.ref
    const parts = value.split('.')
    const candidate = parts.length > 1 ? parts[1] : parts[0]
    return /^[0-9]+$/.test(candidate) ? parts[0] : candidate
  }

  private step(): void {
    let text: string | undefined
    let path: string | undefined
    const tags: string[] = []
    while (this.story.canContinue) {
      const line = (this.story.Continue() ?? '').trim()
      const current = this.story.state?.currentPathString
      if (typeof current === 'string' && current !== '') {
        path = current
        this.lastPath = current
      }
      for (const tag of this.story.currentTags ?? []) if (!tags.includes(tag)) tags.push(tag)
      if (line !== '') {
        text = line
        break
      }
    }
    const choices = this.story.currentChoices
    if (text === undefined && choices.length === 0) {
      this.finish()
      return
    }
    this.view = {
      conversation: this.ref,
      node: tagValue(tags, 'node') ?? this.nodeId(path),
      speaker: tagValue(tags, 'speaker'),
      text: text ?? '',
      choices: choices.map((choice) => ({
        index: choice.index,
        text: choice.text,
        disabled: false,
      })),
      linear: choices.length === 0,
    }
  }

  private finish(): void {
    if (this.done) return
    const at = this.view?.node ?? this.nodeId()
    this.done = true
    this.view = null
    this.context.emit({ name: DIALOGUE_ENDED, payload: { ...this.envelope(), at } })
  }

  private envelope(): Record<string, Scalar> {
    return this.actor === undefined ? { node: this.ref } : { actor: this.actor, node: this.ref }
  }

  /** Emit `dialogue.started` and show the first node. */
  begin(): void {
    this.context.emit({ name: DIALOGUE_STARTED, payload: this.envelope() })
    this.step()
  }
}

/** Runs an Ink story behind the dialogue bridge. */
export class InkProvider implements DialogueProvider {
  readonly name = 'ink'

  private readonly options: InkProviderOptions
  private readonly built = new Map<string, StoryLike>()
  private readonly wired = new Set<StoryLike>()
  private active: DialogueContext | undefined

  constructor(options: InkProviderOptions) {
    this.options = options
  }

  private resolve(ref: string): { story: StoryLike; path: string } {
    const hash = ref.indexOf('#')
    let key = hash === -1 ? ref : ref.slice(0, hash)
    let path = hash === -1 ? ref : ref.slice(hash + 1)
    if (this.options.stories[key] === undefined) {
      const keys = Object.keys(this.options.stories)
      if (keys.length !== 1) throw new Error(`no ink story registered for ref "${ref}"`)
      key = keys[0]
      path = hash === -1 ? ref : path
    }
    const cached = this.built.get(key)
    if (cached !== undefined) return { story: cached, path }
    const source = this.options.stories[key]
    if (isStory(source)) {
      this.built.set(key, source)
      return { story: source, path }
    }
    if (this.options.createStory === undefined) {
      throw new Error(`ink story "${key}" is compiled JSON but no createStory factory was given`)
    }
    const story = this.options.createStory(source)
    this.built.set(key, story)
    return { story, path }
  }

  private wire(story: StoryLike): void {
    if (this.wired.has(story)) return
    this.wired.add(story)
    story.BindExternalFunction(
      'oqf_emit',
      (...args: never[]) => {
        const event = String(args[0] ?? '')
        const payload = decodePayload(String(args[1] ?? ''))
        if (event !== '') this.active?.emit({ name: event, payload })
        return 0
      },
      true,
    )
    for (const name of variableNames(story, this.options.variables)) {
      const path = fromIdentifier(name)
      if (!path.startsWith('flag.')) continue
      const flag = path.slice(5)
      story.ObserveVariable(name, (_observed, value) => {
        this.active?.emit({ name: FLAG_SET, payload: { flag, value: scalar(value) } })
      })
    }
  }

  start(ref: string, context: DialogueContext): DialogueSession {
    const { story, path } = this.resolve(ref)
    this.active = context
    this.wire(story)
    story.ChoosePathString(path)
    const actor = this.options.actors?.[ref]
    const session = new InkSession(story, context, ref, actor)
    session.begin()
    return session
  }
}
