/**
 * Auto layout for both graphs.
 *
 * Dagre lays the step graph out top to bottom and the result is written back
 * into each entity's extension bag, so a laid-out quest keeps its shape when it
 * is saved and reopened. Positions already in the file win until the author
 * asks for a relayout.
 */
import { Graph, layout } from '@dagrejs/dagre'
import { type Quest, stepGraph } from '@oqf/core'
import type { Conversation } from '@oqf/dialogue'
import { type Position, readPosition } from './position'

export const NODE_WIDTH = 230
export const NODE_HEIGHT = 96
export const DIALOGUE_NODE_WIDTH = 260
export const DIALOGUE_NODE_HEIGHT = 120

export interface LayoutOptions {
  width?: number
  height?: number
  /** `TB` top to bottom, `LR` left to right. */
  direction?: 'TB' | 'LR'
  /** Gap between ranks and between nodes in a rank. */
  rankSeparation?: number
  nodeSeparation?: number
}

export type Positions = Record<string, Position>

/** Dagre over a plain node and edge list. Returns top left corners. */
export function layoutGraph(
  nodes: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>,
  options: LayoutOptions = {},
): Positions {
  const width = options.width ?? NODE_WIDTH
  const height = options.height ?? NODE_HEIGHT
  const graph = new Graph({ directed: true, multigraph: true, compound: false })
  graph.setGraph({
    rankdir: options.direction ?? 'TB',
    ranksep: options.rankSeparation ?? 90,
    nodesep: options.nodeSeparation ?? 60,
    marginx: 40,
    marginy: 40,
  })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const node of nodes) graph.setNode(node, { width, height })
  for (const [from, to] of edges) {
    if (!graph.hasNode(from) || !graph.hasNode(to)) continue
    graph.setEdge(from, to, {}, `${from}->${to}`)
  }
  layout(graph)
  const positions: Positions = {}
  for (const node of nodes) {
    const placed = graph.node(node)
    if (placed === undefined) continue
    positions[node] = {
      x: Math.round(placed.x - width / 2),
      y: Math.round(placed.y - height / 2),
    }
  }
  return positions
}

/** Fresh positions for every step of a quest, ignoring what is stored. */
export function layoutQuest(quest: Quest, options: LayoutOptions = {}): Positions {
  const graph = stepGraph(quest)
  return layoutGraph(graph.nodes, graph.edges, options)
}

/** Stored positions where present, dagre for the steps that have none. */
export function questPositions(quest: Quest, options: LayoutOptions = {}): Positions {
  const stored: Positions = {}
  let missing = false
  for (const step of quest.steps) {
    const position = readPosition(step.ext)
    if (position === undefined) missing = true
    else stored[step.id] = position
  }
  if (!missing) return stored
  return { ...layoutQuest(quest, options), ...stored }
}

export interface DialogueEdge {
  from: string
  to: string
  /** Choice text, absent on a plain `next` edge. */
  label?: string
  kind: 'next' | 'choice'
  choice?: number
}

/** Every edge of a conversation: one per `next`, one per choice with a target. */
export function dialogueEdges(conversation: Conversation): DialogueEdge[] {
  const known = new Set(conversation.nodes.map((node) => node.id))
  const edges: DialogueEdge[] = []
  for (const node of conversation.nodes) {
    const choices = node.choices ?? []
    if (choices.length === 0) {
      if (node.next !== undefined && known.has(node.next)) {
        edges.push({ from: node.id, to: node.next, kind: 'next' })
      }
      continue
    }
    choices.forEach((choice, index) => {
      if (choice.next === undefined || !known.has(choice.next)) return
      edges.push({
        from: node.id,
        to: choice.next,
        label: typeof choice.text === 'string' ? choice.text : '',
        kind: 'choice',
        choice: index,
      })
    })
  }
  return edges
}

export function layoutConversation(
  conversation: Conversation,
  options: LayoutOptions = {},
): Positions {
  return layoutGraph(
    conversation.nodes.map((node) => node.id),
    dialogueEdges(conversation).map((edge) => [edge.from, edge.to] as const),
    {
      width: DIALOGUE_NODE_WIDTH,
      height: DIALOGUE_NODE_HEIGHT,
      ...options,
    },
  )
}

export function conversationPositions(
  conversation: Conversation,
  options: LayoutOptions = {},
): Positions {
  const stored: Positions = {}
  let missing = false
  for (const node of conversation.nodes) {
    const position = readPosition(node.ext)
    if (position === undefined) missing = true
    else stored[node.id] = position
  }
  if (!missing) return stored
  return { ...layoutConversation(conversation, options), ...stored }
}
