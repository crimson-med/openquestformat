import type { Condition } from '@oqf/core'
/**
 * Inspectors for the dialogue side: a conversation, one of its nodes, and one
 * choice of a node. Flag sets and emitted events are edited in the same
 * spelling the file uses.
 */
import type { Choice, Conversation, DialogueNode } from '@oqf/dialogue'
import { buildVocabulary, suggest } from '../lib/suggest'
import { formatEmits, formatFlagSets, parseEmits, parseFlagSets } from '../lib/values'
import { useDispatch, useEditorState } from '../store/context'
import { choicePatch, conversationPatch, nodePatch } from '../store/patch'
import { activeQuestId, findingsForNode } from '../store/selectors'
import { FindingList } from './FindingList'
import {
  CheckField,
  ConditionField,
  RequiredField,
  Section,
  SelectField,
  TextField,
} from './fields'

export function ConversationForm({ conversation }: { conversation: Conversation }) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const set = <K extends keyof Conversation>(field: K, value: Conversation[K]) =>
    dispatch(conversationPatch(conversation.id, field, value))

  return (
    <div className="form">
      <Section title="Conversation">
        <RequiredField
          label="Id"
          value={conversation.id}
          mono
          hint="What a step's dialogue binding points at."
          onChange={(value) => set('id', value)}
        />
        <TextField
          label="Title"
          value={typeof conversation.title === 'string' ? conversation.title : undefined}
          hint="Tooling only. Players never see it."
          onChange={(value) => set('title', value)}
        />
        <SelectField
          label="Default speaker"
          value={conversation.actor}
          empty="None"
          options={state.dialogues.speakers.map((ref) => ({
            value: ref.id,
            label: ref.name ?? ref.id,
          }))}
          onChange={(value) => set('actor', value)}
        />
        <SelectField
          label="Start node"
          value={conversation.start}
          options={conversation.nodes.map((node) => ({ value: node.id, label: node.id }))}
          onChange={(value) => set('start', value ?? '')}
        />
      </Section>

      <Section
        title={`Nodes (${conversation.nodes.length})`}
        action={
          <button
            type="button"
            className="ghost"
            onClick={() => dispatch({ type: 'node/add', conversation: conversation.id })}
          >
            Add node
          </button>
        }
      >
        <ul className="row-list">
          {conversation.nodes.map((node, index) => (
            <li key={node.id}>
              <button
                type="button"
                className="row-main"
                onClick={() =>
                  dispatch({
                    type: 'select',
                    selection: { kind: 'node', conversation: conversation.id, node: node.id },
                  })
                }
              >
                <span className="row-title">{String(node.text) || 'empty line'}</span>
                <span className="row-id mono">{node.id}</span>
              </button>
              <span className="row-actions">
                <button
                  type="button"
                  className="icon"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() =>
                    dispatch({
                      type: 'node/move',
                      conversation: conversation.id,
                      node: node.id,
                      to: index - 1,
                    })
                  }
                >
                  up
                </button>
                <button
                  type="button"
                  className="icon"
                  title="Move down"
                  disabled={index === conversation.nodes.length - 1}
                  onClick={() =>
                    dispatch({
                      type: 'node/move',
                      conversation: conversation.id,
                      node: node.id,
                      to: index + 1,
                    })
                  }
                >
                  down
                </button>
                <button
                  type="button"
                  className="icon danger"
                  title="Remove node"
                  onClick={() =>
                    dispatch({
                      type: 'node/remove',
                      conversation: conversation.id,
                      node: node.id,
                    })
                  }
                >
                  remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

export function NodeForm({
  conversation,
  node,
}: {
  conversation: Conversation
  node: DialogueNode
}) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const set = <K extends keyof DialogueNode>(field: K, value: DialogueNode[K]) =>
    dispatch(nodePatch(conversation.id, node.id, field, value))
  const choices = node.choices ?? []
  const findings = findingsForNode(state.findings, conversation.id, node.id)

  return (
    <div className="form">
      <Section title="Node">
        <RequiredField label="Id" value={node.id} mono onChange={(value) => set('id', value)} />
        <TextField
          label="Text"
          value={typeof node.text === 'string' ? node.text : undefined}
          multiline
          onChange={(value) => set('text', value ?? '')}
        />
        <SelectField
          label="Speaker"
          value={node.speaker}
          empty="Conversation default"
          options={state.dialogues.speakers.map((ref) => ({
            value: ref.id,
            label: ref.name ?? ref.id,
          }))}
          onChange={(value) => set('speaker', value)}
        />
        <SelectField
          label="Next"
          value={node.next}
          empty={choices.length > 0 ? 'Ignored, the node has choices' : 'End the conversation'}
          options={conversation.nodes
            .filter((entry) => entry.id !== node.id)
            .map((entry) => ({ value: entry.id, label: entry.id }))}
          onChange={(value) => set('next', value)}
        />
        <CheckField
          label="Lore"
          value={node.lore}
          hint="nothing below this node sets a flag or emits"
          onChange={(value) => set('lore', value)}
        />
      </Section>

      <Section title="Effects">
        <TextField
          label="Set"
          value={formatFlagSets(node.set)}
          mono
          placeholder="met_ines;coins=10"
          hint="Flags set when the node is shown. A bare name means true."
          onChange={(value) => set('set', value === undefined ? undefined : parseFlagSets(value))}
        />
        <TextField
          label="Emit"
          value={formatEmits(node.emit)}
          mono
          placeholder="harbor.greeted;ledger.hint:source=ines"
          hint="Events emitted when the node is shown."
          onChange={(value) => set('emit', value === undefined ? undefined : parseEmits(value))}
        />
      </Section>

      <Section
        title={`Choices (${choices.length})`}
        action={
          <button
            type="button"
            className="ghost"
            onClick={() =>
              dispatch({ type: 'choice/add', conversation: conversation.id, node: node.id })
            }
          >
            Add choice
          </button>
        }
      >
        <ul className="row-list">
          {choices.map((choice, index) => (
            <li key={`${node.id}-${index}`}>
              <button
                type="button"
                className="row-main"
                onClick={() =>
                  dispatch({
                    type: 'select',
                    selection: {
                      kind: 'choice',
                      conversation: conversation.id,
                      node: node.id,
                      choice: index,
                    },
                  })
                }
              >
                <span className="row-title">{String(choice.text) || 'empty choice'}</span>
                <span className="row-id mono">{choice.next ?? 'end'}</span>
              </button>
              <span className="row-actions">
                <button
                  type="button"
                  className="icon"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() =>
                    dispatch({
                      type: 'choice/move',
                      conversation: conversation.id,
                      node: node.id,
                      choice: index,
                      to: index - 1,
                    })
                  }
                >
                  up
                </button>
                <button
                  type="button"
                  className="icon"
                  title="Move down"
                  disabled={index === choices.length - 1}
                  onClick={() =>
                    dispatch({
                      type: 'choice/move',
                      conversation: conversation.id,
                      node: node.id,
                      choice: index,
                      to: index + 1,
                    })
                  }
                >
                  down
                </button>
                <button
                  type="button"
                  className="icon danger"
                  title="Remove choice"
                  onClick={() =>
                    dispatch({
                      type: 'choice/remove',
                      conversation: conversation.id,
                      node: node.id,
                      choice: index,
                    })
                  }
                >
                  remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {findings.length > 0 ? (
        <Section title="Findings">
          <FindingList findings={findings} compact />
        </Section>
      ) : null}
    </div>
  )
}

export function ChoiceForm({
  conversation,
  node,
  index,
  choice,
}: {
  conversation: Conversation
  node: DialogueNode
  index: number
  choice: Choice
}) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const set = <K extends keyof Choice>(field: K, value: Choice[K]) =>
    dispatch(choicePatch(conversation.id, node.id, index, field, value))
  const vocabulary = buildVocabulary(state, activeQuestId(state))

  return (
    <div className="form">
      <Section title={`Choice ${index + 1} of ${node.id}`}>
        <TextField
          label="Text"
          value={typeof choice.text === 'string' ? choice.text : undefined}
          multiline
          onChange={(value) => set('text', value ?? '')}
        />
        <SelectField
          label="Next"
          value={choice.next}
          empty="End the conversation"
          options={conversation.nodes.map((entry) => ({ value: entry.id, label: entry.id }))}
          onChange={(value) => set('next', value)}
        />
        <ConditionField
          label="Condition"
          value={choice.condition}
          hint="Hidden when false, unless shown disabled."
          onChange={(value: Condition | undefined) => set('condition', value)}
          suggest={(text, caret) => suggest(text, caret, vocabulary, 'condition')}
        />
        <SelectField
          label="When the condition fails"
          value={choice.show}
          empty="Hide the choice"
          options={[
            { value: 'hidden', label: 'Hide the choice' },
            { value: 'disabled', label: 'List it, not selectable' },
          ]}
          onChange={(value) => set('show', value as Choice['show'])}
        />
        <CheckField
          label="Once"
          value={choice.once}
          hint="hidden after it has been picked"
          onChange={(value) => set('once', value)}
        />
        <TextField
          label="Set"
          value={formatFlagSets(choice.set)}
          mono
          placeholder="otter_agreed"
          onChange={(value) => set('set', value === undefined ? undefined : parseFlagSets(value))}
        />
        <TextField
          label="Emit"
          value={formatEmits(choice.emit)}
          mono
          placeholder="otter.deal:price=5"
          onChange={(value) => set('emit', value === undefined ? undefined : parseEmits(value))}
        />
      </Section>
    </div>
  )
}
