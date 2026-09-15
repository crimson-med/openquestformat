import { validateDocument } from '@oqf/core'
import { validateDialogue } from '@oqf/dialogue'
import { describe, expect, it } from 'vitest'
import { TEMPLATES, findTemplate, loadTemplate } from './templates'

describe('TEMPLATES', () => {
  it('has unique ids', () => {
    const ids = TEMPLATES.map((template) => template.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(TEMPLATES.map((template) => [template.id, template] as const))(
    '%s loads without validation findings',
    (_id, template) => {
      const { quests, dialogues } = loadTemplate(template)
      expect(quests.quests.length).toBeGreaterThan(0)
      expect(validateDocument(quests).findings).toEqual([])
      expect(validateDialogue([dialogues], { quests: [quests] }).findings).toEqual([])
    },
  )

  it('attaches dialogue only where the template has it', () => {
    const conversations = (id: string): number | undefined => {
      const template = findTemplate(id)
      return template && loadTemplate(template).dialogues.conversations.length
    }
    expect(conversations('linear')).toBe(2)
    expect(conversations('branching')).toBe(2)
    expect(conversations('repeatable')).toBe(2)
    expect(conversations('loop')).toBe(2)
    expect(conversations('recurring-step')).toBe(2)
    expect(conversations('parallel')).toBe(3)
    expect(conversations('failure')).toBe(2)
    expect(conversations('chain')).toBe(2)
    expect(conversations('engine-hooks')).toBe(0)
  })
})
