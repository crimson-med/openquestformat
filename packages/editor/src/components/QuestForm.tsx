/**
 * The quest inspector, plus the lists that own steps and rewards: adding,
 * removing and reordering happen here so the graph stays about shape.
 */
import { type Condition, PARAMETER_TYPES, type Parameter, type Quest } from '@oqf/core'
import { clearFile, readFile, writeFile } from '../lib/pack'
import { buildVocabulary, suggest } from '../lib/suggest'
import { useDispatch, useEditorState } from '../store/context'
import { questPatch } from '../store/patch'
import { findingsForStep, packFiles } from '../store/selectors'
import { FileField } from './FileField'
import { FindingList } from './FindingList'
import {
  CheckField,
  ConditionField,
  ManageButton,
  NumberField,
  PickerField,
  RequiredField,
  Section,
  SelectField,
  TextField,
} from './fields'

const PARAMETER_OPTIONS = PARAMETER_TYPES.map((type) => ({ value: type, label: type }))

/** A parameter name nothing in the quest uses yet. */
function nextParameterName(params: Parameter[]): string {
  const taken = new Set(params.map((parameter) => parameter.name))
  let index = 1
  while (taken.has(`p${index}`)) index += 1
  return `p${index}`
}

export function QuestForm({ quest }: { quest: Quest }) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const set = <K extends keyof Quest>(field: K, value: Quest[K]) =>
    dispatch(questPatch(quest.id, field, value))
  const findings = state.findings.filter(
    (finding) => finding.quest === quest.id && finding.step === undefined,
  )
  const vocabulary = buildVocabulary(state, quest.id)

  return (
    <div className="form">
      <Section title="Quest">
        <RequiredField
          label="Id"
          value={quest.id}
          mono
          hint="Never renamed once shipped."
          onChange={(value) => set('id', value)}
        />
        <TextField
          label="Title"
          value={typeof quest.title === 'string' ? quest.title : undefined}
          onChange={(value) => set('title', value ?? '')}
        />
        <TextField
          label="Summary"
          value={typeof quest.summary === 'string' ? quest.summary : undefined}
          multiline
          onChange={(value) => set('summary', value)}
        />
        <NumberField
          label="Version"
          value={quest.version}
          min={1}
          hint="Bumped when steps are added, removed or renamed."
          onChange={(value) => set('version', value ?? 1)}
        />
        <CheckField
          label="Repeatable"
          value={quest.repeat}
          hint="may be taken again after an outcome"
          onChange={(value) => set('repeat', value)}
        />
        <ConditionField
          label="Unlock"
          value={quest.unlock}
          hint="When the quest becomes offerable. Empty means always."
          onChange={(value: Condition | undefined) => set('unlock', value)}
          suggest={(text, caret) => suggest(text, caret, vocabulary, 'condition')}
        />
        <TextField
          label="Cooldown"
          value={quest.cooldown}
          mono
          placeholder="day, week, month or PT20H"
          hint="How long after an outcome a repeatable quest may be offered again."
          onChange={(value) => set('cooldown', value)}
        />
        <TextField
          label="Expire"
          value={quest.expire}
          mono
          placeholder="day or P1D"
          hint="How long after an instance starts it reaches the built-in expired outcome."
          onChange={(value) => set('expire', value)}
        />
        <PickerField
          label="Tags"
          selected={quest.tags}
          options={state.quests.dictionaries.tags.map((ref) => ({
            value: ref.id,
            label: ref.name ?? ref.id,
          }))}
          emptyNote="No tags in this file's dictionary yet."
          action={<ManageButton />}
          onChange={(values) => set('tags', values)}
        />
        <FileField
          what="quest"
          value={readFile(quest.ext)}
          files={packFiles(state)}
          onChange={(value) =>
            set('ext', value === undefined ? clearFile(quest.ext) : writeFile(quest.ext, value))
          }
        />
      </Section>

      <Section
        title={`Parameters (${quest.params?.length ?? 0})`}
        action={
          <button
            type="button"
            className="ghost"
            onClick={() => {
              const params = quest.params ?? []
              set('params', [...params, { name: nextParameterName(params), type: 'item' }])
            }}
          >
            Add parameter
          </button>
        }
      >
        {quest.params === undefined || quest.params.length === 0 ? (
          <p className="field-hint">
            Values the game binds when the quest is offered. Reference them as $name in objectives
            and conditions, and as {'{name}'} in text.
          </p>
        ) : (
          <div className="param-list">
            {quest.params.map((parameter, index) => {
              const replace = (next: Parameter) =>
                set(
                  'params',
                  (quest.params ?? []).map((entry, position) =>
                    position === index ? next : entry,
                  ),
                )
              return (
                <div key={`${index}-${parameter.name}`} className="param-row">
                  <div className="param-head">
                    <span className="mono">${parameter.name}</span>
                    <button
                      type="button"
                      className="icon danger"
                      title="Remove parameter"
                      onClick={() => {
                        const params = (quest.params ?? []).filter(
                          (_entry, position) => position !== index,
                        )
                        set('params', params.length === 0 ? undefined : params)
                      }}
                    >
                      remove
                    </button>
                  </div>
                  <RequiredField
                    label="Name"
                    value={parameter.name}
                    mono
                    onChange={(value) => replace({ ...parameter, name: value })}
                  />
                  <SelectField
                    label="Type"
                    value={parameter.type}
                    options={PARAMETER_OPTIONS}
                    onChange={(value) =>
                      replace({ ...parameter, type: (value ?? 'item') as Parameter['type'] })
                    }
                  />
                  <TextField
                    label="Constraint"
                    value={parameter.constraint}
                    mono
                    placeholder={parameter.type === 'number' ? '1..40' : 'tag id'}
                    hint={
                      parameter.type === 'number'
                        ? 'min..max, either side optional.'
                        : 'A tag the bound reference must carry.'
                    }
                    onChange={(value) =>
                      replace({
                        name: parameter.name,
                        type: parameter.type,
                        ...(value === undefined ? {} : { constraint: value }),
                        ...(parameter.ext === undefined ? {} : { ext: parameter.ext }),
                      })
                    }
                  />
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section
        title={`Steps (${quest.steps.length})`}
        action={
          <button
            type="button"
            className="ghost"
            onClick={() => dispatch({ type: 'step/add', quest: quest.id })}
          >
            Add step
          </button>
        }
      >
        <ul className="row-list">
          {quest.steps.map((step, index) => (
            <li key={step.id}>
              <button
                type="button"
                className="row-main"
                onClick={() =>
                  dispatch({
                    type: 'select',
                    selection: { kind: 'step', quest: quest.id, step: step.id },
                  })
                }
              >
                <span className="row-title">{String(step.title)}</span>
                <span className="row-id mono">{step.id}</span>
              </button>
              <span className="row-actions">
                <button
                  type="button"
                  className="icon"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() =>
                    dispatch({ type: 'step/move', quest: quest.id, step: step.id, to: index - 1 })
                  }
                >
                  up
                </button>
                <button
                  type="button"
                  className="icon"
                  title="Move down"
                  disabled={index === quest.steps.length - 1}
                  onClick={() =>
                    dispatch({ type: 'step/move', quest: quest.id, step: step.id, to: index + 1 })
                  }
                >
                  down
                </button>
                <button
                  type="button"
                  className="icon danger"
                  title="Remove step"
                  onClick={() => dispatch({ type: 'step/remove', quest: quest.id, step: step.id })}
                >
                  remove
                </button>
              </span>
              {findingsForStep(state.findings, quest.id, step.id).length > 0 ? (
                <span className="row-flag" />
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={`Rewards (${quest.rewards.length})`}
        action={
          <button
            type="button"
            className="ghost"
            onClick={() => dispatch({ type: 'reward/add', quest: quest.id })}
          >
            Add reward
          </button>
        }
      >
        <ul className="row-list">
          {quest.rewards.map((reward, index) => (
            <li key={reward.id}>
              <button
                type="button"
                className="row-main"
                onClick={() =>
                  dispatch({
                    type: 'select',
                    selection: { kind: 'reward', quest: quest.id, reward: reward.id },
                  })
                }
              >
                <span className="row-title">
                  {reward.kind} {reward.ref}
                  {reward.outcome === undefined ? '' : ` on ${reward.outcome}`}
                </span>
                <span className="row-id mono">{reward.id}</span>
              </button>
              <span className="row-actions">
                <button
                  type="button"
                  className="icon"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() =>
                    dispatch({
                      type: 'reward/move',
                      quest: quest.id,
                      reward: reward.id,
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
                  disabled={index === quest.rewards.length - 1}
                  onClick={() =>
                    dispatch({
                      type: 'reward/move',
                      quest: quest.id,
                      reward: reward.id,
                      to: index + 1,
                    })
                  }
                >
                  down
                </button>
                <button
                  type="button"
                  className="icon danger"
                  title="Remove reward"
                  onClick={() =>
                    dispatch({ type: 'reward/remove', quest: quest.id, reward: reward.id })
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
