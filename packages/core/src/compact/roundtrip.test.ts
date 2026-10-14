import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseJson } from '../json/index.js'
import { parseCompact } from './parse.js'
import { toCompact } from './serialize.js'

const FIXTURES = [
  'harbormasters-ledger',
  'minimal',
  'templates/linear',
  'templates/branching',
  'templates/repeatable',
  'templates/loop',
  'templates/recurring-step',
  'templates/parallel',
  'templates/failure',
  'templates/chain',
  'templates/engine-hooks',
  'templates/daily',
  'templates/weekly',
  'templates/deadline',
  'templates/templated',
] as const

function read(name: string): string {
  return readFileSync(new URL(`../../../examples/quests/${name}`, import.meta.url), 'utf8')
}

describe.each(FIXTURES)('fixture %s', (name) => {
  const compact = read(`${name}.oqf`)
  const json = read(`${name}.json`)

  it('reserializes byte for byte', () => {
    expect(toCompact(parseCompact(compact))).toBe(compact)
  })

  it('parses to the same model as the JSON form', () => {
    expect(parseCompact(compact)).toEqual(parseJson(json))
  })

  it('serializes the JSON model back to the compact fixture', () => {
    expect(toCompact(parseJson(json))).toBe(compact)
  })
})
