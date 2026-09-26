/**
 * The dialogue canvas. Edges follow `next` and every choice that has a target,
 * labelled with the choice text so a branch is readable at a glance.
 */
import type { Conversation } from '@oqf/dialogue'
import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type NodeChange,
  ReactFlow,
  applyNodeChanges,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Direction } from '../lib/direction'
import { conversationPositions, dialogueEdges } from '../lib/layout'
import { useDispatch, useEditorState } from '../store/context'
import { findingsForNode, worstLevel } from '../store/selectors'
import { type DialogueFlowNode, DialogueNodeCard } from './DialogueNodeCard'
import { FloatingEdge } from './FloatingEdge'
import { useStringResolver } from './StringsContext'
import '../styles/dialogue.css'

const NODE_TYPES = { dialogue: DialogueNodeCard }
const EDGE_TYPES = { floating: FloatingEdge }

/**
 * The arrowhead every dialogue edge ends with, colored from the stylesheet.
 * React Flow wraps this in `url(#...)` itself, so it is the bare marker id.
 */
const ARROW = 'oqf-dialogue-arrow'

/** The add, layout and direction controls live in the canvas header above, not here. */
export function DialogueGraph({
  conversation,
  direction,
}: {
  conversation: Conversation
  direction: Direction
}) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const resolve = useStringResolver()
  const selection = state.selection
  const selected =
    selection.kind === 'node' || selection.kind === 'choice' ? selection.node : undefined

  const build = useCallback((): DialogueFlowNode[] => {
    const positions = conversationPositions(conversation, { direction })
    return conversation.nodes.map((node) => {
      const choices = node.choices ?? []
      return {
        id: node.id,
        type: 'dialogue',
        position: positions[node.id] ?? { x: 0, y: 0 },
        data: {
          nodeId: node.id,
          speaker: node.speaker,
          text: resolve(String(node.text)),
          choices: choices.map((choice) => resolve(String(choice.text))),
          lore: node.lore === true,
          start: node.id === conversation.start,
          ends: choices.length === 0 && node.next === undefined,
          level: worstLevel(findingsForNode(state.findings, conversation.id, node.id)),
          picked: node.id === selected,
          direction,
        },
      }
    })
  }, [conversation, state.findings, selected, direction, resolve])

  const [nodes, setNodes] = useState<DialogueFlowNode[]>(build)
  useEffect(() => {
    setNodes(build())
  }, [build])

  const edges = useMemo<Edge[]>(
    () =>
      dialogueEdges(conversation).map((edge, index) => ({
        id: `${edge.from}->${edge.to}-${index}`,
        type: 'floating',
        source: edge.from,
        target: edge.to,
        label: edge.label,
        className: edge.kind,
        markerEnd: ARROW,
      })),
    [conversation],
  )

  const onNodesChange = useCallback((changes: NodeChange<DialogueFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
  }, [])

  return (
    <ReactFlow<DialogueFlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_, node) =>
        dispatch({
          type: 'node/position',
          conversation: conversation.id,
          node: node.id,
          position: node.position,
        })
      }
      onNodeClick={(_, node) =>
        dispatch({
          type: 'select',
          selection: { kind: 'node', conversation: conversation.id, node: node.id },
        })
      }
      onPaneClick={() =>
        dispatch({
          type: 'select',
          selection: { kind: 'conversation', conversation: conversation.id },
        })
      }
      fitView
      fitViewOptions={{ minZoom: 0.55, maxZoom: 1 }}
      panOnScroll
      colorMode="light"
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
    >
      {/* One arrowhead for every edge, so its color follows the stylesheet. */}
      <svg className="edge-markers" aria-hidden="true">
        <title>Edge markers</title>
        <defs>
          <marker
            id="oqf-dialogue-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" />
          </marker>
        </defs>
      </svg>
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  )
}
