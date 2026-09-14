/**
 * The quest canvas.
 *
 * Nodes are steps, edges come from the core step graph, and positions are the
 * ones stored on each step. Dragging writes the new position back to the
 * document, so the layout is part of the file rather than editor-only state.
 */
import { type Quest, formatCompletion, stepGraph } from '@oqf/core'
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  MiniMap,
  type NodeChange,
  Panel,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react'
import { useCallback, useEffect, useState } from 'react'
import type { Direction } from '../lib/direction'
import { layoutQuest, questPositions } from '../lib/layout'
import { useDispatch, useEditorState } from '../store/context'
import { findingsForStep, worstLevel } from '../store/selectors'
import '../styles/connections.css'
import { DirectionToggle } from './DirectionToggle'
import { type StepFlowNode, StepNode } from './StepNode'

const NODE_TYPES = { step: StepNode }

export function QuestGraph({
  quest,
  direction,
  onDirection,
}: {
  quest: Quest
  direction: Direction
  onDirection: (direction: Direction) => void
}) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const selected = state.selection.kind === 'step' ? state.selection.step : undefined

  const relayout = (next: Direction) =>
    dispatch({
      type: 'step/positions',
      quest: quest.id,
      positions: layoutQuest(quest, { direction: next }),
    })

  const build = useCallback((): StepFlowNode[] => {
    const positions = questPositions(quest, { direction })
    return quest.steps.map((step) => {
      const badges: string[] = []
      if (step.start === true || step.unlock === undefined) badges.push('start')
      if (step.optional === true) badges.push('optional')
      if (step.repeat === true) badges.push('repeat')
      if (step.outcome !== undefined) badges.push(step.outcome.name)
      const objective = formatCompletion({ objective: step.objective, condition: step.complete })
      return {
        id: step.id,
        type: 'step',
        position: positions[step.id] ?? { x: 0, y: 0 },
        // Steps are removed through the store, never by React Flow's delete key.
        deletable: false,
        data: {
          stepId: step.id,
          title: String(step.title),
          objective: objective === '' ? undefined : objective,
          badges,
          ending: step.outcome !== undefined,
          failed: step.outcome?.failed === true,
          optional: step.optional === true,
          start: step.start === true || step.unlock === undefined,
          repeat: step.repeat === true,
          level: worstLevel(findingsForStep(state.findings, quest.id, step.id)),
          picked: step.id === selected,
          direction,
        },
      }
    })
  }, [quest, state.findings, selected, direction])

  const [nodes, setNodes] = useState<StepFlowNode[]>(build)
  useEffect(() => {
    setNodes(build())
  }, [build])

  const buildEdges = useCallback(
    (): Edge[] =>
      stepGraph(quest).edges.map(([from, to]) => ({
        id: `${from}->${to}`,
        source: from,
        target: to,
        animated: false,
      })),
    [quest],
  )

  const [edges, setEdges] = useState<Edge[]>(buildEdges)
  useEffect(() => {
    setEdges(buildEdges())
  }, [buildEdges])

  const onNodesChange = useCallback((changes: NodeChange<StepFlowNode>[]) => {
    const kept = changes.filter((change) => change.type !== 'remove')
    setNodes((current) => applyNodeChanges(kept, current))
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current))
  }, [])

  const isValidConnection = useCallback(
    (connection: Edge | Connection) => connection.source !== connection.target,
    [],
  )

  return (
    <ReactFlow<StepFlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={(connection) =>
        dispatch({
          type: 'step/link',
          quest: quest.id,
          from: connection.source,
          to: connection.target,
        })
      }
      onEdgesDelete={(removed) => {
        for (const edge of removed) {
          dispatch({ type: 'step/unlink', quest: quest.id, from: edge.source, to: edge.target })
        }
      }}
      onEdgeClick={() =>
        dispatch({ type: 'select', selection: { kind: 'quest', quest: quest.id } })
      }
      isValidConnection={isValidConnection}
      deleteKeyCode={['Delete', 'Backspace']}
      onNodeDragStop={(_, node) =>
        dispatch({
          type: 'step/position',
          quest: quest.id,
          step: node.id,
          position: node.position,
        })
      }
      onNodeClick={(_, node) =>
        dispatch({
          type: 'select',
          selection: { kind: 'step', quest: quest.id, step: node.id },
        })
      }
      onPaneClick={() =>
        dispatch({ type: 'select', selection: { kind: 'quest', quest: quest.id } })
      }
      fitView
      colorMode="light"
      proOptions={{ hideAttribution: false }}
      minZoom={0.2}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
      <Panel position="top-left" className="canvas-actions">
        <button type="button" onClick={() => dispatch({ type: 'step/add', quest: quest.id })}>
          Add step
        </button>
        <button type="button" onClick={() => relayout(direction)}>
          Auto layout
        </button>
        <DirectionToggle
          direction={direction}
          onChange={(next) => {
            relayout(next)
            onDirection(next)
          }}
        />
      </Panel>
    </ReactFlow>
  )
}
