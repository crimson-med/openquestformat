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
import chainDialogue from '../../../examples/quests/templates/chain.oqd?raw'
import chainQuest from '../../../examples/quests/templates/chain.oqf?raw'
import dailyDialogue from '../../../examples/quests/templates/daily.oqd?raw'
import dailyQuest from '../../../examples/quests/templates/daily.oqf?raw'
import deadlineDialogue from '../../../examples/quests/templates/deadline.oqd?raw'
import deadlineQuest from '../../../examples/quests/templates/deadline.oqf?raw'
import engineHooksQuest from '../../../examples/quests/templates/engine-hooks.oqf?raw'
import failureDialogue from '../../../examples/quests/templates/failure.oqd?raw'
import failureQuest from '../../../examples/quests/templates/failure.oqf?raw'
import linearDialogue from '../../../examples/quests/templates/linear.oqd?raw'
import linearQuest from '../../../examples/quests/templates/linear.oqf?raw'
import loopDialogue from '../../../examples/quests/templates/loop.oqd?raw'
import loopQuest from '../../../examples/quests/templates/loop.oqf?raw'
import parallelDialogue from '../../../examples/quests/templates/parallel.oqd?raw'
import parallelQuest from '../../../examples/quests/templates/parallel.oqf?raw'
import recurringStepDialogue from '../../../examples/quests/templates/recurring-step.oqd?raw'
import recurringStepQuest from '../../../examples/quests/templates/recurring-step.oqf?raw'
import repeatableDialogue from '../../../examples/quests/templates/repeatable.oqd?raw'
import repeatableQuest from '../../../examples/quests/templates/repeatable.oqf?raw'
import templatedDialogue from '../../../examples/quests/templates/templated.oqd?raw'
import templatedQuest from '../../../examples/quests/templates/templated.oqf?raw'
import weeklyDialogue from '../../../examples/quests/templates/weekly.oqd?raw'
import weeklyQuest from '../../../examples/quests/templates/weekly.oqf?raw'

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
    dialogue: linearDialogue,
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
    dialogue: repeatableDialogue,
  },
  {
    id: 'loop',
    title: 'Looped quest',
    description: 'Two repeat steps that cycle until the player succeeds.',
    quest: loopQuest,
    dialogue: loopDialogue,
  },
  {
    id: 'recurring-step',
    title: 'Recurring step',
    description: 'One repeat step that re-arms whenever its flag toggles.',
    quest: recurringStepQuest,
    dialogue: recurringStepDialogue,
  },
  {
    id: 'parallel',
    title: 'Parallel objectives',
    description: 'Steps active at once, an and join, an optional bonus and a counter milestone.',
    quest: parallelQuest,
    dialogue: parallelDialogue,
  },
  {
    id: 'failure',
    title: 'Fail states',
    description: 'An accept gate, fail objectives and several failed outcomes.',
    quest: failureQuest,
    dialogue: failureDialogue,
  },
  {
    id: 'chain',
    title: 'Quest chain',
    description: 'Three quests unlocked by outcomes, status and steps of each other.',
    quest: chainQuest,
    dialogue: chainDialogue,
  },
  {
    id: 'daily',
    title: 'Daily quest',
    description: 'A repeatable quest with a day cooldown that expires a day after it starts.',
    quest: dailyQuest,
    dialogue: dailyDialogue,
  },
  {
    id: 'weekly',
    title: 'Weekly quest',
    description: 'A repeatable bounty with a week cooldown, so streak.* counts the weeks.',
    quest: weeklyQuest,
    dialogue: weeklyDialogue,
  },
  {
    id: 'deadline',
    title: 'Timed step',
    description: 'A step with a deadline that fails on its own when time runs out.',
    quest: deadlineQuest,
    dialogue: deadlineDialogue,
  },
  {
    id: 'templated',
    title: 'Templated quest',
    description: 'Parameters the game binds when the quest is offered: $fish and $n in one quest.',
    quest: templatedQuest,
    dialogue: templatedDialogue,
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
