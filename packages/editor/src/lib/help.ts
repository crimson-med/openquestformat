/**
 * What the Help dialog says, as data: the views, the graph legend and the
 * shortcuts. The canvas headers draw their legends from the same lists, so the
 * help never describes a color the graph does not use.
 */
import { ROLE_GLYPHS, type StepRole } from './playtest'

export interface HelpView {
  id: string
  title: string
  text: string
}

/** One row of a canvas legend: a role color, a label and what it means. */
export interface LegendEntry {
  id: string
  label: string
  /** Which `--role-*` token colors the dot. */
  color: StepRole
  /** The glyph the step card shows, when the card has one. */
  glyph?: string
  text: string
}

export interface EdgeLegendEntry {
  id: string
  label: string
  style: 'solid' | 'dashed' | 'dotted'
  /** True for the edge drawn in the error color. */
  red?: boolean
  text: string
}

export interface Shortcut {
  keys: string
  text: string
}

export const HELP_VIEWS: readonly HelpView[] = [
  {
    id: 'quests',
    title: 'Quests',
    text: 'The step graph and the inspector: steps, their dependencies, outcomes and rewards.',
  },
  {
    id: 'dialogue',
    title: 'Dialogue',
    text: 'One graph per conversation: nodes, choices and the flags and events they set.',
  },
  {
    id: 'strings',
    title: 'Strings',
    text: 'Every player-facing text beside its translation, with extract, inject, import and export.',
  },
  {
    id: 'dictionaries',
    title: 'Dictionaries',
    text: 'Actors, locations, items, tags and speakers, with where each one is used.',
  },
  {
    id: 'play',
    title: 'Play',
    text: 'Runs the quest or the conversation in place of the inspector while the graph stays live.',
  },
]

export const QUEST_LEGEND: readonly LegendEntry[] = [
  {
    id: 'start',
    label: 'start',
    color: 'start',
    glyph: ROLE_GLYPHS.start,
    text: 'Available as soon as the quest opens.',
  },
  {
    id: 'step',
    label: 'step',
    color: 'step',
    glyph: ROLE_GLYPHS.step,
    text: 'Unlocked by the steps that point at it.',
  },
  {
    id: 'optional',
    label: 'optional',
    color: 'optional',
    glyph: ROLE_GLYPHS.optional,
    text: 'Dashed border. Not required to finish the quest.',
  },
  {
    id: 'repeat',
    label: 'repeat',
    color: 'repeat',
    glyph: ROLE_GLYPHS.repeat,
    text: 'Can be entered again after it is done.',
  },
  {
    id: 'ending',
    label: 'ending',
    color: 'ending',
    glyph: ROLE_GLYPHS.ending,
    text: 'Reaching it closes the quest with its outcome.',
  },
  {
    id: 'failed',
    label: 'failed',
    color: 'failed',
    glyph: ROLE_GLYPHS.failed,
    text: 'An ending whose outcome is a failure.',
  },
]

export const DIALOGUE_LEGEND: readonly LegendEntry[] = [
  { id: 'start', label: 'start', color: 'start', text: 'The node the conversation opens on.' },
  { id: 'node', label: 'node', color: 'step', text: 'A line, with its choices listed under it.' },
  {
    id: 'lore',
    label: 'lore',
    color: 'optional',
    text: 'Dashed border. Nothing below it sets a flag or emits an event.',
  },
  {
    id: 'ends',
    label: 'ends',
    color: 'ending',
    text: 'Thick bottom edge. No next node and no choices.',
  },
]

export const EDGE_LEGEND: readonly EdgeLegendEntry[] = [
  { id: 'unlock', label: 'unlock', style: 'solid', text: 'The target unlocks on the source.' },
  {
    id: 'activate',
    label: 'activate',
    style: 'dashed',
    text: 'The target activates on the source.',
  },
  {
    id: 'complete',
    label: 'complete',
    style: 'dotted',
    text: 'The target completes on the source.',
  },
  { id: 'fail', label: 'fail', style: 'solid', red: true, text: 'The target fails on the source.' },
]

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: 'Cmd or Ctrl Z', text: 'Undo' },
  { keys: 'Shift Cmd or Ctrl Z', text: 'Redo' },
  { keys: 'Cmd or Ctrl S', text: 'Export the quests as .oqf' },
  { keys: 'Cmd or Ctrl K', text: 'Open the command palette' },
  { keys: 'Cmd or Ctrl P', text: 'Play or stop playing' },
  { keys: 'N', text: 'Add a step or a node to the open graph' },
  { keys: 'Delete', text: 'Remove the selected step or node' },
  { keys: 'Escape', text: 'Close a menu, a dialog or the palette' },
]

/** Every line of help as plain text, for search and for tests. */
export function helpText(): string[] {
  return [
    ...HELP_VIEWS.flatMap((view) => [view.title, view.text]),
    ...QUEST_LEGEND.flatMap((entry) => [entry.label, entry.text]),
    ...DIALOGUE_LEGEND.flatMap((entry) => [entry.label, entry.text]),
    ...EDGE_LEGEND.flatMap((entry) => [entry.label, entry.text]),
    ...SHORTCUTS.flatMap((entry) => [entry.keys, entry.text]),
  ]
}
