import { describe, expect, it } from 'vitest'
import type { EditorFinding } from './findings'
import { sampleDialogues, sampleQuests } from './fixtures'
import { createState } from './reducer'
import {
  activeConversationId,
  activeQuestId,
  conversationIds,
  findChoice,
  findConversation,
  findNode,
  findQuest,
  findReward,
  findStep,
  findingsForNode,
  findingsForStep,
  isEndingStep,
  outcomeNames,
  selectedQuest,
  selectedReward,
  selectedStep,
  worstLevel,
} from './selectors'

const state = createState(sampleQuests(), sampleDialogues())

function finding(partial: Partial<EditorFinding>): EditorFinding {
  return {
    level: 'warning',
    code: 'test',
    message: 'test',
    source: 'quests',
    ...partial,
  }
}

describe('lookups', () => {
  it('finds entities by id and gives up quietly', () => {
    expect(findQuest(state, 'ledger')?.title).toBe('The ledger')
    expect(findQuest(state, 'missing')).toBeUndefined()
    expect(findQuest(state, undefined)).toBeUndefined()
    expect(findStep(state, 'ledger', 'talk_ines')?.title).toBe('Speak with Ines')
    expect(findStep(state, 'ledger', 'missing')).toBeUndefined()
    expect(findReward(state, 'ledger', 'coins')?.kind).toBe('currency')
    expect(findConversation(state, 'ines_intro')?.start).toBe('greet')
    expect(findNode(state, 'ines_intro', 'thanks')?.text).toBe('Thank you. Ask around the pier.')
    expect(findChoice(state, 'ines_intro', 'greet', 0)?.next).toBe('thanks')
    expect(findChoice(state, 'ines_intro', 'greet', 9)).toBeUndefined()
  })

  it('falls back to the first quest and conversation', () => {
    expect(activeQuestId(state)).toBe('ledger')
    expect(activeConversationId(state)).toBe('ines_intro')
  })

  it('reads the selection when there is one', () => {
    const picked = createState(sampleQuests(), sampleDialogues(), {
      kind: 'step',
      quest: 'ledger',
      step: 'find_it',
    })
    expect(activeQuestId(picked)).toBe('ledger')
    expect(selectedStep(picked)?.id).toBe('find_it')
    expect(selectedQuest(picked)).toBeUndefined()
    expect(selectedReward(picked)).toBeUndefined()
  })

  it('reads a selected quest and reward', () => {
    const quest = createState(sampleQuests(), sampleDialogues(), {
      kind: 'quest',
      quest: 'ledger',
    })
    expect(selectedQuest(quest)?.id).toBe('ledger')
    const reward = createState(sampleQuests(), sampleDialogues(), {
      kind: 'reward',
      quest: 'ledger',
      reward: 'coins',
    })
    expect(selectedReward(reward)?.id).toBe('coins')
  })
})

describe('derived views', () => {
  it('lists outcome names once each', () => {
    expect(outcomeNames(findQuest(state, 'ledger'))).toEqual(['returned'])
    expect(outcomeNames(undefined)).toEqual([])
  })

  it('lists conversation ids for the binding picker', () => {
    expect(conversationIds(state)).toEqual(['ines_intro'])
  })

  it('knows an ending step', () => {
    const ending = findStep(state, 'ledger', 'find_it')
    const middle = findStep(state, 'ledger', 'talk_ines')
    expect(ending === undefined ? undefined : isEndingStep(ending)).toBe(true)
    expect(middle === undefined ? undefined : isEndingStep(middle)).toBe(false)
  })

  it('filters findings by what they point at', () => {
    const findings = [
      finding({ quest: 'ledger', step: 'talk_ines' }),
      finding({ quest: 'ledger' }),
      finding({ source: 'dialogue', conversation: 'ines_intro', node: 'greet', level: 'error' }),
    ]
    expect(findingsForStep(findings, 'ledger', 'talk_ines')).toHaveLength(1)
    expect(findingsForNode(findings, 'ines_intro', 'greet')).toHaveLength(1)
    expect(worstLevel(findings)).toBe('error')
    expect(worstLevel([finding({})])).toBe('warning')
    expect(worstLevel([])).toBeUndefined()
  })
})
