/**
 * The built-in dialogue provider: runs an OQD conversation and emits the bridge
 * events a quest runtime listens to.
 *
 * The behaviour is frozen in docs/13-dialogue-spec.md. Showing a node applies
 * its `set` and then its `emit`, once per visit. Choosing applies the choice's
 * `set` and `emit`, emits `dialogue.choice`, records `once`, then moves on.
 * Ending emits `dialogue.ended` with the conversation actor and id plus `at`,
 * the node the conversation ended on, so a step can bind one ending rather than
 * the whole conversation. Choice conditions are evaluated through the context
 * resolver every time the view is built, so a view is always current.
 */
import { evaluateCondition } from '@oqf/core'
import {
  DIALOGUE_CHOICE,
  DIALOGUE_ENDED,
  DIALOGUE_STARTED,
  type DialogueChoiceView,
  type DialogueContext,
  type DialogueProvider,
  type DialogueSession,
  type DialogueView,
  FLAG_SET,
  flagPayload,
  onceKey,
} from '../bridge.js'
import type {
  Choice,
  Conversation,
  DialogueDocument,
  DialogueNode,
  EmitSpec,
  FlagSet,
} from '../model.js'

/** The provider name a quest's dialogue binding uses to reach this provider. */
export const OQF_PROVIDER = 'oqf'

/**
 * How many times one session may advance before it is called a runaway loop.
 * A linear cycle with no choices would otherwise spin forever.
 */
export const MAX_ADVANCES = 10000

class OqfDialogueSession implements DialogueSession {
  private readonly conversation: Conversation
  private readonly context: DialogueContext
  private readonly nodes: Map<string, DialogueNode>
  private node: DialogueNode | undefined
  private finished = false
  private advances = 0

  constructor(conversation: Conversation, context: DialogueContext) {
    this.conversation = conversation
    this.context = context
    this.nodes = new Map()
    for (const node of conversation.nodes) {
      if (!this.nodes.has(node.id)) this.nodes.set(node.id, node)
    }
  }

  get ended(): boolean {
    return this.finished
  }

  /** Emits `dialogue.started`, then shows the start node. */
  begin(): void {
    this.context.emit({ name: DIALOGUE_STARTED, payload: this.conversationPayload() })
    this.enter(this.conversation.start)
  }

  current(): DialogueView | null {
    if (this.finished || this.node === undefined) return null
    const node = this.node
    const all = node.choices ?? []
    const choices: DialogueChoiceView[] = []
    for (const [index, choice] of all.entries()) {
      const visible = this.visibility(node, choice, index)
      if (visible === 'hidden') continue
      choices.push({ index, text: choice.text, disabled: visible === 'disabled' })
    }
    const speaker = node.speaker ?? this.conversation.actor
    return {
      conversation: this.conversation.id,
      node: node.id,
      ...(speaker === undefined ? {} : { speaker }),
      text: node.text,
      choices,
      linear: all.length === 0,
    }
  }

  advance(): void {
    if (this.finished || this.node === undefined) {
      throw new Error(`cannot advance conversation "${this.conversation.id}": it has ended`)
    }
    const node = this.node
    // A node with choices waits for choose(). Advancing past it is a no-op.
    if ((node.choices ?? []).length > 0) return
    this.advances += 1
    if (this.advances > MAX_ADVANCES) {
      throw new Error(
        `conversation "${this.conversation.id}" advanced more than ${MAX_ADVANCES} times, it is looping`,
      )
    }
    if (node.next === undefined) {
      this.end(node.id)
      return
    }
    this.enter(node.next)
  }

  choose(index: number): void {
    if (this.finished || this.node === undefined) {
      throw new Error(`cannot choose in conversation "${this.conversation.id}": it has ended`)
    }
    const node = this.node
    const all = node.choices ?? []
    const where = `node "${node.id}" of conversation "${this.conversation.id}"`
    if (!Number.isInteger(index) || index < 0 || index >= all.length) {
      throw new Error(`unknown choice ${index} on ${where}, it has ${all.length} choices`)
    }
    const choice = all[index]
    const visible = this.visibility(node, choice, index)
    if (visible === 'hidden') throw new Error(`choice ${index} on ${where} is hidden`)
    if (visible === 'disabled') throw new Error(`choice ${index} on ${where} is disabled`)

    this.applySets(choice.set)
    this.applyEmits(choice.emit)
    this.context.emit({
      name: DIALOGUE_CHOICE,
      payload: { node: node.id, choice: index },
    })
    if (choice.once === true) this.context.once?.add(onceKey(this.conversation.id, node.id, index))
    if (choice.next === undefined) {
      this.end(node.id)
      return
    }
    this.enter(choice.next)
  }

  /** Hidden, disabled or offered, for one choice as things stand right now. */
  private visibility(
    node: DialogueNode,
    choice: Choice,
    index: number,
  ): 'hidden' | 'disabled' | 'offered' {
    if (
      choice.once === true &&
      this.context.once?.has(onceKey(this.conversation.id, node.id, index)) === true
    ) {
      return 'hidden'
    }
    if (choice.condition === undefined) return 'offered'
    if (evaluateCondition(choice.condition, this.context.resolve)) return 'offered'
    return choice.show === 'disabled' ? 'disabled' : 'hidden'
  }

  private conversationPayload(): { actor: string; node: string } {
    return { actor: this.conversation.actor ?? '', node: this.conversation.id }
  }

  private enter(id: string): void {
    const node = this.nodes.get(id)
    if (node === undefined) {
      throw new Error(`conversation "${this.conversation.id}" has no node "${id}"`)
    }
    this.node = node
    this.applySets(node.set)
    this.applyEmits(node.emit)
  }

  private applySets(sets: FlagSet[] | undefined): void {
    for (const entry of sets ?? []) {
      this.context.emit({
        name: FLAG_SET,
        payload: flagPayload(entry.flag, entry.value ?? true),
      })
    }
  }

  private applyEmits(emits: EmitSpec[] | undefined): void {
    for (const entry of emits ?? []) {
      this.context.emit({ name: entry.event, payload: { ...(entry.payload ?? {}) } })
    }
  }

  /** `at` is the node the conversation ended on, so a step can bind one ending. */
  private end(at: string): void {
    this.finished = true
    this.node = undefined
    this.context.emit({ name: DIALOGUE_ENDED, payload: { ...this.conversationPayload(), at } })
  }
}

/** Runs conversations from one or more OQD documents. */
export class OqfDialogueProvider implements DialogueProvider {
  readonly name = OQF_PROVIDER
  private readonly conversations: Map<string, Conversation>

  constructor(docs: DialogueDocument[]) {
    this.conversations = new Map()
    for (const document of docs) {
      for (const conversation of document.conversations) {
        if (!this.conversations.has(conversation.id)) {
          this.conversations.set(conversation.id, conversation)
        }
      }
    }
  }

  /** True when this provider knows the conversation. */
  has(conversationId: string): boolean {
    return this.conversations.has(conversationId)
  }

  /** Every conversation id this provider can start, in document order. */
  ids(): string[] {
    return [...this.conversations.keys()]
  }

  start(conversationId: string, context: DialogueContext): DialogueSession {
    const conversation = this.conversations.get(conversationId)
    if (conversation === undefined) {
      throw new Error(`unknown conversation "${conversationId}"`)
    }
    const session = new OqfDialogueSession(conversation, context)
    session.begin()
    return session
  }
}
