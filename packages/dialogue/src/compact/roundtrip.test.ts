import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDialogueJson } from '../json/parse.js'
import { toDialogueJson } from '../json/serialize.js'
import { parseOqd } from './parse.js'
import { toOqd } from './serialize.js'

const FIXTURES = [
  'harbormasters-ledger',
  'templates/linear',
  'templates/branching',
  'templates/repeatable',
  'templates/loop',
  'templates/recurring-step',
  'templates/parallel',
  'templates/failure',
  'templates/chain',
] as const

function read(name: string): string {
  return readFileSync(new URL(`../../../examples/quests/${name}`, import.meta.url), 'utf8')
}

describe.each(FIXTURES)('fixture %s', (name) => {
  const compact = read(`${name}.oqd`)
  const json = read(`${name}.dialogue.json`)

  it('reserializes byte for byte', () => {
    expect(toOqd(parseOqd(compact))).toBe(compact)
  })

  it('parses to the same model as the JSON form', () => {
    expect(parseOqd(compact)).toEqual(parseDialogueJson(json))
  })

  it('serializes the JSON model back to the compact fixture', () => {
    expect(toOqd(parseDialogueJson(json))).toBe(compact)
  })

  it('reserializes the JSON form byte for byte', () => {
    expect(toDialogueJson(parseDialogueJson(json))).toBe(json)
  })

  it('serializes the compact model back to the JSON fixture', () => {
    expect(toDialogueJson(parseOqd(compact))).toBe(json)
  })
})
