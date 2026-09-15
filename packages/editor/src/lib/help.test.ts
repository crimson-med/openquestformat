import { describe, expect, it } from 'vitest'
import { DIALOGUE_LEGEND, EDGE_LEGEND, HELP_VIEWS, QUEST_LEGEND, SHORTCUTS, helpText } from './help'
import { ROLE_GLYPHS } from './playtest'

describe('help', () => {
  it('describes every view, including play', () => {
    expect(HELP_VIEWS.map((view) => view.id)).toEqual([
      'quests',
      'dialogue',
      'strings',
      'dictionaries',
      'play',
    ])
    for (const view of HELP_VIEWS) expect(view.text.length).toBeGreaterThan(0)
  })

  it('covers every step role once, with the glyph the card shows', () => {
    expect(QUEST_LEGEND.map((entry) => entry.id).sort()).toEqual(Object.keys(ROLE_GLYPHS).sort())
    for (const entry of QUEST_LEGEND) {
      expect(entry.glyph).toBe(ROLE_GLYPHS[entry.color])
    }
  })

  it('keeps the dialogue legend to the four card looks', () => {
    expect(DIALOGUE_LEGEND.map((entry) => entry.id)).toEqual(['start', 'node', 'lore', 'ends'])
  })

  it('covers every dependency field with one stroke each', () => {
    expect(EDGE_LEGEND.map((entry) => entry.id)).toEqual(['unlock', 'activate', 'complete', 'fail'])
    expect(EDGE_LEGEND.find((entry) => entry.id === 'fail')?.red).toBe(true)
    expect(EDGE_LEGEND.filter((entry) => entry.red === true)).toHaveLength(1)
  })

  it('lists a key for every shortcut', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.length).toBeGreaterThan(0)
      expect(shortcut.text.length).toBeGreaterThan(0)
    }
    expect(SHORTCUTS.some((entry) => entry.keys.endsWith('K'))).toBe(true)
    expect(SHORTCUTS.some((entry) => entry.keys.endsWith('P'))).toBe(true)
  })

  it('never uses a dash where a comma or a period will do', () => {
    for (const line of helpText()) {
      expect(line).not.toMatch(/[–—]/)
    }
  })
})
