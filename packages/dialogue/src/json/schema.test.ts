import { describe, expect, it } from 'vitest'
import { OQD_MAJOR } from '../model.js'
import { fullDialogue, minimalDialogue } from './fixtures.js'
import { OQD_JSON_SCHEMA, dialogueSchemaJson } from './schema.js'
import { toDialogueJsonValue } from './serialize.js'

type Schema = Record<string, unknown>

const defs = OQD_JSON_SCHEMA.$defs as Record<string, Schema>

/** Every `$ref` in the tree, so no definition can go missing. */
function refs(node: unknown, found: Set<string>): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) refs(item, found)
    return found
  }
  if (node === null || typeof node !== 'object') return found
  for (const [key, item] of Object.entries(node)) {
    if (key === '$ref' && typeof item === 'string') found.add(item)
    else refs(item, found)
  }
  return found
}

describe('OQD_JSON_SCHEMA', () => {
  it('declares draft 2020-12 and a stable id', () => {
    expect(OQD_JSON_SCHEMA.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(OQD_JSON_SCHEMA.$id).toBe('https://openquestformat.org/schema/oqd-1.schema.json')
  })

  it('pins the version to the one the model carries', () => {
    const properties = OQD_JSON_SCHEMA.properties as Record<string, Schema>
    expect(properties.oqd.const).toBe(OQD_MAJOR)
  })

  it('resolves every $ref it uses', () => {
    for (const ref of refs(OQD_JSON_SCHEMA, new Set())) {
      expect(ref.startsWith('#/$defs/')).toBe(true)
      expect(defs[ref.slice('#/$defs/'.length)]).toBeDefined()
    }
  })

  it('defines the shared sub-schemas the quest schema also defines', () => {
    for (const name of ['Scalar', 'Text', 'Ext', 'Payload', 'Ref', 'Condition']) {
      expect(defs[name]).toBeDefined()
    }
  })

  it('defines every entity of the dialogue model', () => {
    for (const name of ['FlagSet', 'EmitSpec', 'Choice', 'DialogueNode', 'Conversation']) {
      expect(defs[name]).toBeDefined()
    }
  })

  it('closes every entity object so a typo is caught', () => {
    // Payload and Ext are open maps by design, everything else is a fixed shape.
    for (const [name, definition] of Object.entries(defs)) {
      if (definition.type !== 'object' || name === 'Payload' || name === 'Ext') continue
      expect(
        definition.additionalProperties === false || definition.propertyNames !== undefined,
        `${name} should be closed`,
      ).toBe(true)
    }
  })

  it('allows only the two show values', () => {
    const choice = defs.Choice.properties as Record<string, Schema>
    expect(choice.show.enum).toEqual(['hidden', 'disabled'])
  })
})

describe('the serialized form against the schema', () => {
  /** A small structural check: every key written must be declared. */
  function check(value: unknown, definition: Schema, path: string): void {
    const properties = definition.properties as Record<string, Schema> | undefined
    if (properties === undefined) return
    for (const key of Object.keys(value as Record<string, unknown>)) {
      expect(properties[key], `${path}.${key} is not in the schema`).toBeDefined()
    }
  }

  it('writes only keys the schema declares', () => {
    for (const doc of [minimalDialogue(), fullDialogue()]) {
      const value = toDialogueJsonValue(doc) as Record<string, unknown>
      check(value, OQD_JSON_SCHEMA, '')
      for (const conversation of value.conversations as Record<string, unknown>[]) {
        check(conversation, defs.Conversation, 'conversations[]')
        for (const node of conversation.nodes as Record<string, unknown>[]) {
          check(node, defs.DialogueNode, 'conversations[].nodes[]')
          for (const choice of (node.choices ?? []) as Record<string, unknown>[]) {
            check(choice, defs.Choice, 'conversations[].nodes[].choices[]')
          }
        }
      }
    }
  })
})

describe('dialogueSchemaJson', () => {
  it('pretty prints the schema with two spaces', () => {
    const text = dialogueSchemaJson()
    expect(JSON.parse(text)).toEqual(OQD_JSON_SCHEMA)
    expect(text.split('\n')[1]).toBe('  "$schema": "https://json-schema.org/draft/2020-12/schema",')
  })
})
