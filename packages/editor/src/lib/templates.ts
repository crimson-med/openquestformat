/**
 * Quest templates, compiled into the bundle.
 *
 * Every file comes straight from `packages/examples/quests`, so a template is
 * always the fixture the other packages test against, not a copy that can drift.
 */
import type { OqfDocument } from '@oqf/core'
import { parseCompact } from '@oqf/core'
import type { DialogueDocument } from '@oqf/dialogue'
import { emptyDialogueDocument, parseOqd } from '@oqf/dialogue'
import ledgerDialogue from '../../../examples/quests/harbormasters-ledger.oqd?raw'
import ledgerQuest from '../../../examples/quests/harbormasters-ledger.oqf?raw'
import branchingDialogue from '../../../examples/quests/templates/branching.oqd?raw'
import branchingQuest from '../../../examples/quests/templates/branching.oqf?raw'
import chainQuest from '../../../examples/quests/templates/chain.oqf?raw'
import engineHooksQuest from '../../../examples/quests/templates/engine-hooks.oqf?raw'
import failureQuest from '../../../examples/quests/templates/failure.oqf?raw'
import linearQuest from '../../../examples/quests/templates/linear.oqf?raw'
import loopQuest from '../../../examples/quests/templates/loop.oqf?raw'
import parallelQuest from '../../../examples/quests/templates/parallel.oqf?raw'
import recurringStepQuest from '../../../examples/quests/templates/recurring-step.oqf?raw'
import repeatableQuest from '../../../examples/quests/templates/repeatable.oqf?raw'

export interface QuestTemplate {
  id: string
  title: string
  description: string
  quest: string
  dialogue?: string
}

export const TEMPLATES: QuestTemplate[] = [
  {
    id: 'linear',
    title: 'Simple linear quest',
    description: 'One step after another, ending in a single outcome.',
    quest: linearQuest,
  },
  {
    id: 'branching',
    title: 'Decision tree, multiple endings',
    description: 'Dialogue choices split the quest into four endings, one of them a failure.',
    quest: branchingQuest,
    dialogue: branchingDialogue,
  },
  {
    id: 'repeatable',
    title: 'Repeatable quest',
    description: 'A daily quest, gated by a quest unlock, taken again after every outcome.',
    quest: repeatableQuest,
  },
  {
    id: 'loop',
    title: 'Looped quest',
    description: 'Two repeat steps that cycle until the player succeeds.',
    quest: loopQuest,
  },
  {
    id: 'recurring-step',
    title: 'Recurring step',
    description: 'One repeat step that re-arms whenever its flag toggles.',
    quest: recurringStepQuest,
  },
  {
    id: 'parallel',
    title: 'Parallel objectives',
    description: 'Steps active at once, an and join, an optional bonus and a counter milestone.',
    quest: parallelQuest,
  },
  {
    id: 'failure',
    title: 'Fail states',
    description: 'An accept gate, fail objectives and several failed outcomes.',
    quest: failureQuest,
  },
  {
    id: 'chain',
    title: 'Quest chain',
    description: 'Three quests unlocked by outcomes, status and steps of each other.',
    quest: chainQuest,
  },
  {
    id: 'engine-hooks',
    title: 'Engine hooks',
    description: 'Game variables, a custom objective, custom rewards and extension data.',
    quest: engineHooksQuest,
  },
  {
    id: 'harbormasters-ledger',
    title: "The Harbormaster's Ledger",
    description: 'The reference quest: every v1 feature once, with dialogue.',
    quest: ledgerQuest,
    dialogue: ledgerDialogue,
  },
]

export function findTemplate(id: string): QuestTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id)
}

/** Parse a template. A template without dialogue loads an empty dialogue document. */
export function loadTemplate(template: QuestTemplate): {
  quests: OqfDocument
  dialogues: DialogueDocument
} {
  return {
    quests: parseCompact(template.quest),
    dialogues:
      template.dialogue === undefined ? emptyDialogueDocument() : parseOqd(template.dialogue),
  }
}
