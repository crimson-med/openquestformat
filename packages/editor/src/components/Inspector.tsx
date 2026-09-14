/**
 * The right pane. One form per kind of selection, and a prompt when nothing is
 * selected yet.
 */
import { useEditorState } from '../store/context'
import {
  findChoice,
  findConversation,
  findNode,
  findQuest,
  findReward,
  findStep,
} from '../store/selectors'
import { ChoiceForm, ConversationForm, NodeForm } from './DialogueForms'
import { QuestForm } from './QuestForm'
import { RewardForm } from './RewardForm'
import { StepForm } from './StepForm'

function Empty({ message }: { message: string }) {
  return (
    <div className="inspector-empty">
      <p>{message}</p>
    </div>
  )
}

export function Inspector() {
  const state = useEditorState()
  const selection = state.selection

  switch (selection.kind) {
    case 'quest': {
      const quest = findQuest(state, selection.quest)
      return quest === undefined ? (
        <Empty message="That quest is gone." />
      ) : (
        <QuestForm quest={quest} />
      )
    }
    case 'step': {
      const quest = findQuest(state, selection.quest)
      const step = findStep(state, selection.quest, selection.step)
      return quest === undefined || step === undefined ? (
        <Empty message="That step is gone." />
      ) : (
        <StepForm quest={quest} step={step} />
      )
    }
    case 'reward': {
      const quest = findQuest(state, selection.quest)
      const reward = findReward(state, selection.quest, selection.reward)
      return quest === undefined || reward === undefined ? (
        <Empty message="That reward is gone." />
      ) : (
        <RewardForm quest={quest} reward={reward} />
      )
    }
    case 'conversation': {
      const conversation = findConversation(state, selection.conversation)
      return conversation === undefined ? (
        <Empty message="That conversation is gone." />
      ) : (
        <ConversationForm conversation={conversation} />
      )
    }
    case 'node': {
      const conversation = findConversation(state, selection.conversation)
      const node = findNode(state, selection.conversation, selection.node)
      return conversation === undefined || node === undefined ? (
        <Empty message="That node is gone." />
      ) : (
        <NodeForm conversation={conversation} node={node} />
      )
    }
    case 'choice': {
      const conversation = findConversation(state, selection.conversation)
      const node = findNode(state, selection.conversation, selection.node)
      const choice = findChoice(state, selection.conversation, selection.node, selection.choice)
      return conversation === undefined || node === undefined || choice === undefined ? (
        <Empty message="That choice is gone." />
      ) : (
        <ChoiceForm
          conversation={conversation}
          node={node}
          index={selection.choice}
          choice={choice}
        />
      )
    }
    default:
      return (
        <Empty message="Select a step to edit it. Click the canvas background to come back here." />
      )
  }
}
