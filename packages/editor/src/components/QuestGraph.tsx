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
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type EdgeSpec, edgeLabels, edgeSpec } from '../lib/connections'
import type { Direction } from '../lib/direction'
import { questPositions } from '../lib/layout'
import { useDispatch, useEditorState } from '../store/context'
import { findingsForStep, worstLevel } from '../store/selectors'
import '../styles/connections.css'
import { EdgePopover } from './EdgePopover'
import { usePlaytest } from './PlaytestContext'
import { type StepFlowNode, StepNode } from './StepNode'
import { useStringResolver } from './StringsContext'

const NODE_TYPES = { step: StepNode }

/** A dependency being drawn (add) or looked at (edit) in the popover. */
type PendingEdge =
  | { mode: 'add'; from: string; to: string }
  | { mode: 'edit'; from: string; to: string; spec: EdgeSpec }

const DEFAULT_SPEC: EdgeSpec = { field: 'unlock', state: 'done' }

/** The add, layout and direction controls live in the canvas header above, not here. */
export function QuestGraph({ quest, direction }: { quest: Quest; direction: Direction }) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const resolve = useStringResolver()
  const selected = state.selection.kind === 'step' ? state.selection.step : undefined
  const playtest = usePlaytest()
  // The session mutates in place; its version says when to read it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version drives the reread
  const runState = useMemo(
    () => playtest.session?.stepStates(quest.id),
    [playtest.session, playtest.version, quest.id],
  )

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
          title: resolve(String(step.title)),
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
          runState: runState?.[step.id],
        },
      }
    })
  }, [quest, state.findings, selected, direction, resolve, runState])

  const [nodes, setNodes] = useState<StepFlowNode[]>(build)
  useEffect(() => {
    setNodes(build())
  }, [build])

  const buildEdges = useCallback((): Edge[] => {
    const labels = edgeLabels(quest)
    return stepGraph(quest).edges.map(([from, to]) => {
      const id = `${from}->${to}`
      const label = labels[id] ?? ''
      const spec = edgeSpec(quest, from, to) ?? DEFAULT_SPEC
      return {
        id,
        source: from,
        target: to,
        animated: false,
        label: label === '' ? undefined : label,
        className: `dep-${spec.field}`,
      }
    })
  }, [quest])

  const [edges, setEdges] = useState<Edge[]>(buildEdges)
  useEffect(() => {
    setEdges(buildEdges())
  }, [buildEdges])

  const [pending, setPending] = useState<PendingEdge | undefined>(undefined)
  const pendingTarget = pending === undefined ? undefined : nodes.find((n) => n.id === pending.to)
  const pendingFrom = pending === undefined ? undefined : nodes.find((n) => n.id === pending.from)
  const popover =
    pending === undefined || pendingTarget === undefined || pendingFrom === undefined ? null : (
      <EdgePopover
        key={`${pending.mode}:${pending.from}->${pending.to}`}
        mode={pending.mode}
        from={pending.from}
        to={pending.to}
        anchor={{
          x: pendingTarget.position.x + (pendingTarget.measured?.width ?? 0) + 12,
          y: pendingTarget.position.y,
        }}
        initial={pending.mode === 'edit' ? pending.spec : DEFAULT_SPEC}
        onSubmit={(spec) => {
          const edge = { quest: quest.id, from: pending.from, to: pending.to, ...spec }
          if (pending.mode === 'add') dispatch({ type: 'step/link', ...edge })
          else dispatch({ type: 'step/relink', ...edge })
          setPending(undefined)
        }}
        onRemove={
          pending.mode === 'edit'
            ? () => {
                dispatch({
                  type: 'step/unlink',
                  quest: quest.id,
                  from: pending.from,
                  to: pending.to,
                })
                setPending(undefined)
              }
            : undefined
        }
        onCancel={() => setPending(undefined)}
      />
    )

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
        setPending({ mode: 'add', from: connection.source, to: connection.target })
      }
      onEdgesDelete={(removed) => {
        for (const edge of removed) {
          dispatch({ type: 'step/unlink', quest: quest.id, from: edge.source, to: edge.target })
        }
        setPending(undefined)
      }}
      onEdgeClick={(_, edge) => {
        // The quest stays selected so the Delete key never removes a step.
        dispatch({ type: 'select', selection: { kind: 'quest', quest: quest.id } })
        const spec = edgeSpec(quest, edge.source, edge.target)
        if (spec !== undefined) {
          setPending({ mode: 'edit', from: edge.source, to: edge.target, spec })
        }
      }}
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
      onPaneClick={() => {
        dispatch({ type: 'select', selection: { kind: 'quest', quest: quest.id } })
        setPending(undefined)
      }}
      fitView
      fitViewOptions={{ minZoom: 0.55, maxZoom: 1 }}
      panOnScroll
      colorMode="light"
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
      {popover}
    </ReactFlow>
  )
}
