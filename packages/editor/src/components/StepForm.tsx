/**
 * The step inspector: every field a step carries, in the order the file writes
 * them. Ids are editable because a quest is not shipped until it is, and the
 * validator says loudly when a rename breaks a reference.
 */
import type { Condition, Objective, Quest, Step } from '@oqf/core'
import { readPosition } from '../lib/position'
import { buildVocabulary, suggest } from '../lib/suggest'
import { useDispatch, useEditorState } from '../store/context'
import { outcomePatch, stepPatch } from '../store/patch'
import { conversationIds, findingsForStep } from '../store/selectors'
import { FindingList } from './FindingList'
import {
  CheckField,
  CompletionField,
  ConditionField,
  Field,
  ManageButton,
  PickerField,
  RequiredField,
  Section,
  SelectField,
  TextField,
} from './fields'

const PROVIDERS = [
  { value: 'oqf', label: 'oqf' },
  { value: 'ink', label: 'ink' },
  { value: 'yarn', label: 'yarn' },
]

export function StepForm({ quest, step }: { quest: Quest; step: Step }) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const position = readPosition(step.ext)
  const findings = findingsForStep(state.findings, quest.id, step.id)
  const conversations = conversationIds(state)
  const vocabulary = buildVocabulary(state, quest.id)
  const suggestCondition = (text: string, caret: number) =>
    suggest(text, caret, vocabulary, 'condition')
  const suggestCompletion = (text: string, caret: number) =>
    suggest(text, caret, vocabulary, 'completion')
  const binding = step.dialogue
  const set = <K extends keyof Step>(field: K, value: Step[K]) =>
    dispatch(stepPatch(quest.id, step.id, field, value))

  return (
    <div className="form">
      <Section title="Step">
        <RequiredField
          label="Id"
          value={step.id}
          mono
          hint="Referenced as questId#stepId from outside."
          onChange={(value) => set('id', value)}
        />
        <TextField
          label="Title"
          value={step.title}
          onChange={(value) => set('title', value ?? '')}
        />
        <TextField
          label="Journal"
          value={step.journal}
          multiline
          hint="Written to the journal when the step becomes active."
          onChange={(value) => set('journal', value)}
        />
        <div className="field-row">
          <CheckField
            label="Start"
            value={step.start}
            hint="available when the quest opens"
            onChange={(value) => set('start', value)}
          />
          <CheckField
            label="Optional"
            value={step.optional}
            hint="tracker hint"
            onChange={(value) => set('optional', value)}
          />
          <CheckField
            label="Repeat"
            value={step.repeat}
            hint="may be re-entered"
            onChange={(value) => set('repeat', value)}
          />
        </div>
      </Section>

      <Section title="Transitions">
        <ConditionField
          label="Unlock"
          value={step.unlock}
          hint="locked to available. Empty means the step starts available."
          onChange={(value: Condition | undefined) => set('unlock', value)}
          suggest={suggestCondition}
        />
        <ConditionField
          label="Activate"
          value={step.activate}
          hint="available to active. Empty means immediate."
          onChange={(value: Condition | undefined) => set('activate', value)}
          suggest={suggestCondition}
        />
        <CompletionField
          label="Complete"
          objective={step.objective}
          condition={step.complete}
          hint="objective, condition, or both joined by and."
          onChange={(parts: { objective?: Objective; condition?: Condition }) => {
            set('objective', parts.objective)
            set('complete', parts.condition)
          }}
          suggest={suggestCompletion}
        />
        <CompletionField
          label="Fail"
          objective={step.failObjective}
          condition={step.fail}
          hint="Same shape as complete. Moves the step to failed."
          onChange={(parts: { objective?: Objective; condition?: Condition }) => {
            set('failObjective', parts.objective)
            set('fail', parts.condition)
          }}
          suggest={suggestCompletion}
        />
        <TextField
          label="Deadline"
          value={step.deadline}
          mono
          placeholder="PT10M, P1D or day"
          hint="How long after the step is entered it fails. Works without a fail rule."
          onChange={(value) => set('deadline', value)}
        />
      </Section>

      <Section title="Outcome">
        <CheckField
          label="Ending step"
          value={step.outcome === undefined ? undefined : true}
          hint="reaching it closes the quest"
          onChange={(value) => set('outcome', value === true ? { name: 'ending' } : undefined)}
        />
        {step.outcome !== undefined ? (
          <>
            <RequiredField
              label="Outcome name"
              value={step.outcome.name}
              mono
              hint="Sets the world flag outcome.questId.name"
              onChange={(value) => dispatch(outcomePatch(quest.id, step.id, 'name', value))}
            />
            <TextField
              label="Outcome title"
              value={typeof step.outcome.title === 'string' ? step.outcome.title : undefined}
              onChange={(value) => dispatch(outcomePatch(quest.id, step.id, 'title', value))}
            />
            <CheckField
              label="Failure"
              value={step.outcome.failed}
              hint="the quest ends badly"
              onChange={(value) => dispatch(outcomePatch(quest.id, step.id, 'failed', value))}
            />
          </>
        ) : null}
      </Section>

      <Section title="Rewards">
        <PickerField
          label="Granted on done"
          selected={step.rewards}
          options={quest.rewards
            .filter((reward) => reward.outcome === undefined)
            .map((reward) => ({ value: reward.id, label: `${reward.id} (${reward.kind})` }))}
          emptyNote="This quest has no step rewards yet. Add one from the quest inspector."
          onChange={(values) => set('rewards', values)}
        />
      </Section>

      <Section title="World">
        <SelectField
          label="Location"
          value={step.location}
          empty="None"
          options={state.quests.dictionaries.locations.map((ref) => ({
            value: ref.id,
            label: ref.name === undefined ? ref.id : `${ref.name} (${ref.id})`,
          }))}
          action={<ManageButton />}
          onChange={(value) => set('location', value)}
        />
        <PickerField
          label="Actors"
          selected={step.actors}
          options={state.quests.dictionaries.actors.map((ref) => ({
            value: ref.id,
            label: ref.name ?? ref.id,
          }))}
          emptyNote="No actors in this file's dictionary yet."
          action={<ManageButton />}
          onChange={(values) => set('actors', values)}
        />
      </Section>

      <Section title="Dialogue">
        <SelectField
          label="Provider"
          value={binding?.provider}
          empty="Not bound"
          options={PROVIDERS}
          onChange={(value) =>
            set(
              'dialogue',
              value === undefined ? undefined : { provider: value, ref: binding?.ref ?? '' },
            )
          }
        />
        {binding !== undefined ? (
          binding.provider === 'oqf' && conversations.length > 0 ? (
            <SelectField
              label="Conversation"
              value={binding.ref === '' ? undefined : binding.ref}
              empty="Pick a conversation"
              options={conversations.map((id) => ({ value: id, label: id }))}
              onChange={(value) =>
                set('dialogue', { provider: binding.provider, ref: value ?? '' })
              }
            />
          ) : (
            <TextField
              label="Reference"
              value={binding.ref === '' ? undefined : binding.ref}
              mono
              hint="Node id in that provider's terms."
              onChange={(value) =>
                set('dialogue', { provider: binding.provider, ref: value ?? '' })
              }
            />
          )
        ) : null}
      </Section>

      <Section title="Extensions">
        <Field label="Graph position" hint="Stored as x-editor.pos so it round-trips.">
          <p className="note mono">
            {position === undefined ? 'not placed yet' : `x=${position.x};y=${position.y}`}
          </p>
        </Field>
        <ExtList ext={step.ext} />
      </Section>

      {findings.length > 0 ? (
        <Section title="Findings">
          <FindingList findings={findings} compact />
        </Section>
      ) : null}
    </div>
  )
}

function ExtList({ ext }: { ext: Step['ext'] }) {
  const entries = Object.entries(ext ?? {}).filter(([key]) => key !== 'x-editor.pos')
  if (entries.length === 0) return <p className="note">No other extension keys.</p>
  return (
    <ul className="ext-list">
      {entries.map(([key, value]) => (
        <li key={key}>
          <code>{key}</code>
          <span className="mono">
            {typeof value === 'object'
              ? Object.entries(value)
                  .map(([name, item]) => `${name}=${String(item)}`)
                  .join(';')
              : String(value)}
          </span>
        </li>
      ))}
    </ul>
  )
}
