import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  type OqfDocument,
  type Quest,
  type Reward,
  type Step,
  emptyDocument,
  parseCompact,
  validatePack,
} from '@oqf/core'
import { type DialogueDocument, emptyDialogueDocument, validateDialogue } from '@oqf/dialogue'
import { describe, expect, it } from 'vitest'
import type { EditorFinding } from '../store/findings'
import { createState, reducer } from '../store/reducer'
import type { EditorState } from '../store/types'
import { type Fix, fixAction, fixesFor } from './fixes'

function fixture(name: string): OqfDocument {
  const text = readFileSync(
    fileURLToPath(new URL(`../../../examples/quests/broken/${name}`, import.meta.url)),
    'utf8',
  )
  return parseCompact(text)
}

function step(id: string, extra: Partial<Step> = {}): Step {
  return { id, title: id, rewards: [], actors: [], ...extra }
}

function quest(steps: Step[], rewards: Reward[] = [], extra: Partial<Quest> = {}): OqfDocument {
  const document = emptyDocument()
  document.quests.push({ id: 'q', version: 1, title: 'Q', tags: [], steps, rewards, ...extra })
  return document
}

function dialogues(conversations: DialogueDocument['conversations']): DialogueDocument {
  return { ...emptyDialogueDocument(), conversations }
}

function stateOf(quests: OqfDocument, dialogue?: DialogueDocument): EditorState {
  return createState(quests, dialogue)
}

/** The first finding with that code, which must exist. */
function finding(state: EditorState, code: string, step?: string): EditorFinding {
  const found = state.findings.find(
    (entry) => entry.code === code && (step === undefined || entry.step === step),
  )
  if (found === undefined)
    throw new Error(`no ${code} finding in ${JSON.stringify(state.findings)}`)
  return found
}

function apply(state: EditorState, fix: Fix): EditorState {
  return reducer(state, fixAction(fix))
}

/** True when a finding with the same code and message is still reported. */
function remains(state: EditorState, target: EditorFinding): boolean {
  return state.findings.some(
    (entry) => entry.code === target.code && entry.message === target.message,
  )
}

function strictQuestFindings(state: EditorState): EditorFinding[] {
  return validatePack([state.quests], { strict: true }).findings.map((raw) => ({
    ...raw,
    source: 'quests' as const,
  }))
}

function strictDialogueFindings(state: EditorState): EditorFinding[] {
  return validateDialogue([state.dialogues], { strict: true, quests: [state.quests] }).findings.map(
    (raw) => ({ ...raw, source: 'dialogue' as const }),
  )
}

const questOf = (state: EditorState) => state.quests.quests[0]

describe('fixesFor', () => {
  it('offers nothing for codes without a fix', () => {
    const state = stateOf(
      quest(
        [
          step('a', { start: true, rewards: ['coins'] }),
          step('b', { unlock: { var: 'step.a' }, rewards: ['coins'], outcome: { name: 'done' } }),
        ],
        [{ id: 'coins', kind: 'currency', ref: 'coins' }],
      ),
    )
    const reused = finding(state, 'reward-id-reused')
    expect(fixesFor(reused, state)).toEqual([])
    expect(fixesFor({ ...reused, code: 'validator-crashed' }, state)).toEqual([])
  })

  it('marks a step in a cycle repeat', () => {
    const state = stateOf(fixture('cycle-without-repeat.oqf'))
    const target = finding(state, 'cycle-without-repeat', 'ferry_out')
    const fixes = fixesFor(target, state)
    expect(fixes.map((fix) => fix.title)).toEqual(['Mark ferry_out repeat'])
    const after = apply(state, fixes[0])
    expect(remains(after, target)).toBe(false)
    expect(after.past).toHaveLength(1)
  })

  it('adds an outcome to a dead end', () => {
    const state = stateOf(fixture('outcome-with-dependents.oqf'))
    const target = finding(state, 'dead-end', 'brag')
    const fixes = fixesFor(target, state)
    expect(fixes.map((fix) => fix.title)).toEqual(['Add outcome'])
    const after = apply(state, fixes[0])
    expect(remains(after, target)).toBe(false)
    expect(questOf(after).steps[2].outcome).toEqual({ name: 'brag' })
  })

  it('derives an outcome name that no other ending uses', () => {
    const state = stateOf(
      quest([step('a', { start: true, outcome: { name: 'b' } }), step('b', { start: true })]),
    )
    const after = apply(state, fixesFor(finding(state, 'dead-end', 'b'), state)[0])
    expect(questOf(after).steps[1].outcome).toEqual({ name: 'b_2' })
  })

  it('adds an outcome to the single sink when no ending is reachable', () => {
    const state = stateOf(
      quest([
        step('a', { start: true }),
        step('b', { unlock: { var: 'step.a' } }),
        step('c', { unlock: { var: 'step.b' } }),
      ]),
    )
    const target = finding(state, 'no-ending-reachable')
    const fixes = fixesFor(target, state)
    expect(fixes.map((fix) => fix.title)).toEqual(['Add outcome to c'])
    const after = apply(state, fixes[0])
    expect(remains(after, target)).toBe(false)
  })

  it('offers no ending when several steps could carry it', () => {
    const state = stateOf(
      quest([
        step('a', { start: true }),
        step('b', { unlock: { var: 'step.a' } }),
        step('c', { unlock: { var: 'step.a' } }),
      ]),
    )
    expect(fixesFor(finding(state, 'no-ending-reachable'), state)).toEqual([])
  })

  it('marks an unreachable step start or removes it', () => {
    const state = stateOf(fixture('unreachable-step.oqf'))
    const target = finding(state, 'unreachable-step')
    const fixes = fixesFor(target, state)
    expect(fixes.map((fix) => fix.title)).toEqual(['Mark start', 'Remove step'])
    const started = apply(state, fixes[0])
    expect(remains(started, target)).toBe(false)
    expect(questOf(started).steps[1].start).toBe(true)
    const removed = apply(state, fixes[1])
    expect(remains(removed, target)).toBe(false)
    expect(questOf(removed).steps.map((entry) => entry.id)).toEqual(['greet', 'leave'])
  })

  it('adds a missing dictionary entry', () => {
    const state = stateOf(
      quest(
        [step('a', { start: true, outcome: { name: 'done' }, actors: ['ines'], location: 'pier' })],
        [],
        { tags: ['main'] },
      ),
    )
    const findings = state.findings.filter((entry) => entry.code === 'unknown-dictionary-ref')
    expect(findings).toHaveLength(3)
    let after = state
    for (const target of findings) {
      const fixes = fixesFor(target, after)
      expect(fixes).toHaveLength(1)
      after = apply(after, fixes[0])
      expect(remains(after, target)).toBe(false)
    }
    expect(fixesFor(findings[0], state)[0].title).toBe('Add main to tags')
    expect(after.quests.dictionaries).toEqual({
      tags: [{ id: 'main' }],
      actors: [{ id: 'ines' }],
      locations: [{ id: 'pier' }],
      items: [],
    })
  })

  it('adds a missing reward or drops the reference', () => {
    const state = stateOf(
      quest([step('a', { start: true, outcome: { name: 'done' }, rewards: ['coins'] })]),
    )
    const target = finding(state, 'unknown-reward-ref')
    const fixes = fixesFor(target, state)
    expect(fixes.map((fix) => fix.title)).toEqual(['Add reward coins', 'Drop the reference'])
    const added = apply(state, fixes[0])
    expect(remains(added, target)).toBe(false)
    expect(questOf(added).rewards.map((reward) => reward.id)).toEqual(['coins'])
    const dropped = apply(state, fixes[1])
    expect(remains(dropped, target)).toBe(false)
    expect(questOf(dropped).steps[0].rewards).toEqual([])
  })

  it('removes a reference to an unknown step from every condition field', () => {
    const state = stateOf(
      quest([
        step('a', { start: true }),
        step('b', {
          unlock: { and: [{ var: 'step.a' }, { var: 'step.ghost' }] },
          fail: { '>': [{ var: 'count.ghost' }, 2] },
          outcome: { name: 'done' },
        }),
      ]),
    )
    const targets = state.findings.filter((entry) => entry.code === 'unknown-step-ref')
    expect(targets).toHaveLength(2)
    const fixes = fixesFor(targets[0], state)
    expect(fixes.map((fix) => fix.title)).toEqual(['Remove the reference'])
    expect(fixes[0].actions).toHaveLength(2)
    const after = apply(state, fixes[0])
    for (const target of targets) expect(remains(after, target)).toBe(false)
    expect(questOf(after).steps[1].unlock).toEqual({ var: 'step.a' })
    expect(questOf(after).steps[1].fail).toBeUndefined()
    expect(after.past).toHaveLength(1)
  })

  it('removes a reference to a step of another quest', () => {
    const document = quest([
      step('a', { start: true }),
      step('b', { unlock: { var: 'step.other#c' }, outcome: { name: 'done' } }),
    ])
    document.quests.push({
      id: 'other',
      version: 1,
      title: 'Other',
      tags: [],
      steps: [step('x', { start: true, outcome: { name: 'done' } })],
      rewards: [],
    })
    const state = stateOf(document)
    const target = finding(state, 'unknown-step-ref')
    expect(target.message).toBe('step "c" is not a step of quest "other"')
    const after = apply(state, fixesFor(target, state)[0])
    expect(remains(after, target)).toBe(false)
    expect(questOf(after).steps[1].unlock).toBeUndefined()
  })

  it('removes a reference to an unknown step from the quest unlock', () => {
    const state = stateOf(
      quest([step('a', { start: true, outcome: { name: 'done' } })], [], {
        unlock: { var: 'step.ghost' },
      }),
    )
    const target = finding(state, 'unknown-step-ref')
    expect(target.step).toBeUndefined()
    const after = apply(state, fixesFor(target, state)[0])
    expect(remains(after, target)).toBe(false)
    expect(questOf(after).unlock).toBeUndefined()
  })

  it('clears the outcome of a reward keyed to an outcome no step reaches', () => {
    const state = stateOf(
      quest(
        [step('a', { start: true, outcome: { name: 'done' } })],
        [{ id: 'bonus', kind: 'xp', ref: 'xp', amount: 5, outcome: 'ghost' }],
      ),
    )
    const target = finding(state, 'unknown-outcome-ref')
    const fixes = fixesFor(target, state)
    expect(fixes.map((fix) => fix.title)).toEqual(['Clear the outcome'])
    const after = apply(state, fixes[0])
    expect(remains(after, target)).toBe(false)
    expect(questOf(after).rewards[0].outcome).toBeUndefined()
  })

  it('offers nothing for an outcome variable that resolves to nothing', () => {
    const state = stateOf(
      quest([step('a', { start: true, outcome: { name: 'done' }, unlock: { var: 'outcome.q' } })]),
    )
    expect(fixesFor(finding(state, 'unknown-outcome-ref'), state)).toEqual([])
  })

  it('removes an outcome that has dependents', () => {
    const state = stateOf(fixture('outcome-with-dependents.oqf'))
    const target = finding(state, 'outcome-with-dependents')
    const fixes = fixesFor(target, state)
    expect(fixes.map((fix) => fix.title)).toEqual(['Remove the outcome'])
    const after = apply(state, fixes[0])
    expect(remains(after, target)).toBe(false)
    expect(questOf(after).steps[1].outcome).toBeUndefined()
  })

  it('renames the second occurrence of a duplicate step id', () => {
    const state = stateOf(fixture('duplicate-step-id.oqf'))
    const target = finding(state, 'duplicate-step-id')
    expect(target.path).toBe('quests[0].steps[1]')
    const fixes = fixesFor(target, state)
    expect(fixes.map((fix) => fix.title)).toEqual(['Rename to greet_2'])
    const after = apply(state, fixes[0])
    expect(remains(after, target)).toBe(false)
    expect(questOf(after).steps.map((entry) => entry.id)).toEqual(['greet', 'greet_2'])
    expect(after.findings.filter((entry) => entry.level === 'error')).toEqual([])
  })

  it('clears a constant condition on a step or the quest', () => {
    const state = stateOf(
      quest([step('a', { start: true, outcome: { name: 'done' }, activate: true })], [], {
        unlock: false,
      }),
    )
    const targets = state.findings.filter((entry) => entry.code === 'condition-constant')
    expect(targets).toHaveLength(2)
    let after = state
    for (const target of targets) {
      const fixes = fixesFor(target, after)
      expect(fixes.map((fix) => fix.title)).toEqual(['Clear the condition'])
      after = apply(after, fixes[0])
      expect(remains(after, target)).toBe(false)
    }
    expect(questOf(after).unlock).toBeUndefined()
    expect(questOf(after).steps[0].activate).toBeUndefined()
  })

  it('adds a flag reward for a flag nothing sets', () => {
    const state = stateOf(
      quest([step('a', { start: true, outcome: { name: 'done' }, unlock: { var: 'flag.met' } })]),
    )
    const target = strictQuestFindings(state).find((entry) => entry.code === 'unknown-flag')
    if (target === undefined) throw new Error('expected an unknown-flag finding')
    const fixes = fixesFor(target, state)
    expect(fixes.map((fix) => fix.title)).toEqual(['Add a flag reward met'])
    const after = apply(state, fixes[0])
    expect(strictQuestFindings(after).some((entry) => entry.code === 'unknown-flag')).toBe(false)
    expect(questOf(after).rewards).toEqual([{ id: 'met', kind: 'flag', ref: 'met' }])
    expect(after.past).toHaveLength(1)
  })

  it('binds an unbound conversation to a talk step without dialogue', () => {
    const talk = (id: string, bound?: string) =>
      step(id, {
        start: true,
        outcome: { name: id },
        objective: { kind: 'talk', actor: 'ines' },
        dialogue: bound === undefined ? undefined : { provider: 'oqf', ref: bound },
      })
    const state = stateOf(
      quest([talk('one'), talk('two', 'other'), talk('three'), talk('four'), talk('five')]),
      dialogues([
        { id: 'chat', start: 's', nodes: [{ id: 's', text: 'Hi' }] },
        { id: 'other', start: 's', nodes: [{ id: 's', text: 'Hi' }] },
      ]),
    )
    const target = strictDialogueFindings(state).find(
      (entry) => entry.code === 'unbound-conversation',
    )
    if (target === undefined) throw new Error('expected an unbound-conversation finding')
    const fixes = fixesFor(target, state)
    expect(fixes.map((fix) => fix.title)).toEqual(['Bind to one', 'Bind to three', 'Bind to four'])
    const after = apply(state, fixes[1])
    expect(
      strictDialogueFindings(after).some((entry) => entry.code === 'unbound-conversation'),
    ).toBe(false)
    expect(questOf(after).steps[2].dialogue).toEqual({ provider: 'oqf', ref: 'chat' })
  })

  it('clears a next that points at a missing node', () => {
    const state = stateOf(
      quest([]),
      dialogues([
        {
          id: 'chat',
          start: 'a',
          nodes: [
            { id: 'a', text: 'Hi', next: 'ghost' },
            { id: 'b', text: 'Pick', choices: [{ text: 'x' }, { text: 'y', next: 'ghost' }] },
          ],
        },
      ]),
    )
    const targets = state.findings.filter((entry) => entry.code === 'unknown-next')
    expect(targets).toHaveLength(2)
    let after = state
    for (const target of targets) {
      const fixes = fixesFor(target, after)
      expect(fixes.map((fix) => fix.title)).toEqual(['Clear next'])
      after = apply(after, fixes[0])
      expect(remains(after, target)).toBe(false)
    }
    const nodes = after.dialogues.conversations[0].nodes
    expect(nodes[0].next).toBeUndefined()
    expect(nodes[1].choices?.[1].next).toBeUndefined()
  })

  it('points a missing start at the first node', () => {
    const state = stateOf(
      quest([]),
      dialogues([{ id: 'chat', start: 'ghost', nodes: [{ id: 'a', text: 'Hi' }] }]),
    )
    const target = finding(state, 'unknown-start')
    const fixes = fixesFor(target, state)
    expect(fixes.map((fix) => fix.title)).toEqual(['Point start at a'])
    const after = apply(state, fixes[0])
    expect(remains(after, target)).toBe(false)
    expect(after.dialogues.conversations[0].start).toBe('a')
  })

  it('offers no start when the conversation has no nodes', () => {
    const state = stateOf(quest([]), dialogues([{ id: 'chat', start: 'ghost', nodes: [] }]))
    expect(fixesFor(finding(state, 'unknown-start'), state)).toEqual([])
  })
})

describe('fixAction', () => {
  it('wraps several actions in one batch and passes a single one through', () => {
    const one: Fix = { id: 'x', title: 'x', actions: [{ type: 'quest/add' }] }
    expect(fixAction(one)).toEqual({ type: 'quest/add' })
    const two: Fix = {
      id: 'y',
      title: 'y',
      actions: [{ type: 'quest/add' }, { type: 'quest/add' }],
    }
    expect(fixAction(two)).toEqual({ type: 'batch', actions: two.actions })
  })
})
