/**
 * A conversation played through the built-in provider, without React.
 *
 * The play holds one provider session and records what crossed the bridge:
 * every line shown, every choice taken and every event the provider emitted.
 * Events also go to the caller's `emit`, which is how a quest playtest hears
 * them. Errors the provider throws are recorded on the play instead of thrown,
 * the way `PlaytestSession` does it, so a component can show them inline.
 */
import type { Scalar } from '@oqf/core'
import {
  type DialogueDocument,
  type DialogueEvent,
  type DialogueSession,
  type DialogueView,
  type OnceStore,
  OqfDialogueProvider,
} from '@oqf/dialogue'
import { formatPayload } from './playtest'

export interface DialogueTranscriptEntry {
  kind: 'line' | 'choice' | 'event'
  text: string
  /** The speaker of a line, or the payload of an event. */
  detail?: string
}

export interface DialoguePlayContext {
  /** Resolves condition variables: a flags map, or a quest runtime's resolve. */
  resolve: (path: string) => unknown
  /** Hears every event the provider emits, after the play recorded it. */
  emit?: (event: DialogueEvent) => void
  /** Remembers `once` choices across plays. Defaults to a fresh store per play. */
  once?: OnceStore
}

/** A `once` store that lives as long as the caller holds it. */
export function memoryOnce(): OnceStore {
  const taken = new Set<string>()
  return {
    has: (key) => taken.has(key),
    add: (key) => {
      taken.add(key)
    },
  }
}

/**
 * A resolver over a flags map the author toggles by hand. `flag.x` and bare
 * `x` both read `x`; an unset flag reads false, so a gated choice hides or
 * disables until the author turns its flag on.
 */
export function flagsResolver(flags: () => Record<string, Scalar>): (path: string) => unknown {
  return (path) => {
    const key = path.startsWith('flag.') ? path.slice(5) : path
    return flags()[key] ?? false
  }
}

export class DialoguePlay {
  readonly conversation: string
  /** Shared with the provider context's emit, which appends the events it hears. */
  readonly transcript: DialogueTranscriptEntry[]
  /** The last error the provider threw, cleared by the next successful step. */
  error: string | undefined = undefined
  private readonly session: DialogueSession

  constructor(
    session: DialogueSession,
    conversation: string,
    transcript: DialogueTranscriptEntry[],
  ) {
    this.session = session
    this.conversation = conversation
    this.transcript = transcript
    this.recordLine()
  }

  get ended(): boolean {
    return this.session.ended
  }

  /** What the stage renders, null once the conversation ended. */
  current(): DialogueView | null {
    return this.session.current()
  }

  /** Continue past a node without choices. */
  advance(): void {
    this.run(() => this.session.advance())
  }

  /** Pick a choice from the current view, recorded with its text. */
  choose(index: number): void {
    const view = this.session.current()
    const choice = view?.choices.find((entry) => entry.index === index)
    if (choice !== undefined) this.transcript.push({ kind: 'choice', text: String(choice.text) })
    this.run(() => this.session.choose(index))
  }

  private run(work: () => void): void {
    try {
      work()
      this.error = undefined
      this.recordLine()
    } catch (failure) {
      this.error = failure instanceof Error ? failure.message : String(failure)
    }
  }

  private recordLine(): void {
    const view = this.session.current()
    if (view === null) return
    this.transcript.push({ kind: 'line', text: String(view.text), detail: view.speaker })
  }
}

/**
 * Start a conversation from the editor's dialogue document. Throws when the
 * conversation is unknown or its start node is missing, the way the provider
 * does; everything after that is recorded on the play.
 */
export function startConversation(
  document: DialogueDocument,
  conversationId: string,
  context: DialoguePlayContext,
): DialoguePlay {
  const provider = new OqfDialogueProvider([document])
  // The provider emits `dialogue.started` and the start node's sets and emits
  // before it hands the session back, so the transcript exists before the play.
  const transcript: DialogueTranscriptEntry[] = []
  const session = provider.start(conversationId, {
    resolve: context.resolve,
    once: context.once ?? memoryOnce(),
    emit: (event) => {
      transcript.push({
        kind: 'event',
        text: event.name,
        ...(Object.keys(event.payload).length === 0
          ? {}
          : { detail: formatPayload(event.payload) }),
      })
      context.emit?.(event)
    },
  })
  return new DialoguePlay(session, conversationId, transcript)
}
