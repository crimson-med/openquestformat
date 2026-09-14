/**
 * The reward inspector. A reward with an outcome is granted when the quest ends
 * that way; the rest are picked up by steps.
 */
import { type Quest, REWARD_KINDS, type Reward } from '@oqf/core'
import { formatPayloadText, parsePayloadText } from '../lib/values'
import { useDispatch } from '../store/context'
import { rewardPatch } from '../store/patch'
import { outcomeNames } from '../store/selectors'
import { NumberField, RequiredField, Section, SelectField, TextField } from './fields'

export function RewardForm({ quest, reward }: { quest: Quest; reward: Reward }) {
  const dispatch = useDispatch()
  const set = <K extends keyof Reward>(field: K, value: Reward[K]) =>
    dispatch(rewardPatch(quest.id, reward.id, field, value))
  const outcomes = outcomeNames(quest)

  return (
    <div className="form">
      <Section title="Reward">
        <RequiredField
          label="Id"
          value={reward.id}
          mono
          hint="Steps reference this id. Renaming updates them."
          onChange={(value) => set('id', value)}
        />
        <SelectField
          label="Kind"
          value={reward.kind}
          options={REWARD_KINDS.map((kind) => ({ value: kind, label: kind }))}
          onChange={(value) => set('kind', (value ?? 'item') as Reward['kind'])}
        />
        <TextField
          label="Reference"
          value={reward.ref}
          mono
          hint="Item id, currency, reputation track, flag or event name."
          onChange={(value) => set('ref', value ?? '')}
        />
        <NumberField
          label="Amount"
          value={reward.amount}
          placeholder="1"
          hint="Negative allowed for currency and reputation."
          onChange={(value) => set('amount', value)}
        />
        <SelectField
          label="Granted on outcome"
          value={reward.outcome}
          empty="Step reward"
          options={outcomes.map((name) => ({ value: name, label: name }))}
          hint="Quest-level rewards are keyed to an outcome instead of a step."
          onChange={(value) => set('outcome', value)}
        />
        <TextField
          label="Payload"
          value={formatPayloadText(reward.payload)}
          mono
          placeholder="feature=catch_log;achievement=ledger_restored"
          hint="Sent along with the emitted event."
          onChange={(value) =>
            set('payload', value === undefined ? undefined : parsePayloadText(value))
          }
        />
      </Section>
    </div>
  )
}
