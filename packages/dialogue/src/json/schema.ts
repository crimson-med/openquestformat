/**
 * JSON Schema (draft 2020-12) for the JSON form of a DialogueDocument.
 *
 * Hand written on purpose, like the quest schema in `@oqf/core`: the package has
 * no dependencies, so nothing here is generated from or validated by a schema
 * library. The Condition, Ext, Payload, Ref and Scalar sub-schemas keep the same
 * shape as the ones in packages/core/src/json/schema.ts so a tool can treat them
 * as the same types. The shapes must be kept in step with model.ts by hand.
 */
import { OQD_MAJOR } from '../model.js'

/** Loose type for the schema tree. Keeps callers from depending on its literal shape. */
export type JsonSchemaObject = Record<string, unknown>

/** Extension keys are `x-<namespace>.<key>`. */
export const EXT_KEY_PATTERN_SOURCE = '^x-[a-z0-9-]+\\.[A-Za-z0-9_.-]+$'

export const OQD_JSON_SCHEMA: JsonSchemaObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://openquestformat.org/schema/oqd-1.schema.json',
  title: 'Open Quest Format dialogue document',
  description: 'One .oqd file: a speakers dictionary plus one or more conversations.',
  type: 'object',
  required: ['oqd', 'conversations'],
  additionalProperties: false,
  properties: {
    oqd: {
      const: OQD_MAJOR,
      description: 'Dialogue format major version.',
    },
    speakers: {
      description: 'File-scoped display names for the actor ids the conversations reference.',
      type: 'array',
      items: { $ref: '#/$defs/Ref' },
    },
    conversations: {
      type: 'array',
      items: { $ref: '#/$defs/Conversation' },
    },
  },
  $defs: {
    Scalar: {
      description: 'A scalar value allowed in extension bags, payloads and conditions.',
      type: ['string', 'number', 'boolean'],
    },

    Text: {
      description: 'A player-facing string. Either a literal or an i18n key prefixed with @.',
      type: 'string',
    },

    Ext: {
      description: 'Namespaced extension data. Preserved, never read by OQF itself.',
      type: 'object',
      propertyNames: { pattern: EXT_KEY_PATTERN_SOURCE },
      additionalProperties: {
        anyOf: [{ $ref: '#/$defs/Scalar' }, { $ref: '#/$defs/Payload' }],
      },
    },

    Payload: {
      description: 'A flat map of scalars.',
      type: 'object',
      additionalProperties: { $ref: '#/$defs/Scalar' },
    },

    Ref: {
      description: 'An engine reference. An object, or a bare id string when there is no name.',
      anyOf: [
        { type: 'string' },
        {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
        },
      ],
    },

    Condition: {
      description:
        'A JSON Logic tree restricted to the operator whitelist. A scalar, a list of scalars, or an object with exactly one operator key.',
      anyOf: [
        { $ref: '#/$defs/Scalar' },
        { type: 'array', items: { $ref: '#/$defs/Scalar' } },
        {
          type: 'object',
          minProperties: 1,
          maxProperties: 1,
          additionalProperties: false,
          properties: {
            and: { type: 'array', minItems: 1, items: { $ref: '#/$defs/Condition' } },
            or: { type: 'array', minItems: 1, items: { $ref: '#/$defs/Condition' } },
            '!': {
              type: 'array',
              minItems: 1,
              maxItems: 1,
              items: { $ref: '#/$defs/Condition' },
            },
            '==': {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: { $ref: '#/$defs/Condition' },
            },
            '!=': {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: { $ref: '#/$defs/Condition' },
            },
            '<': {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: { $ref: '#/$defs/Condition' },
            },
            '<=': {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: { $ref: '#/$defs/Condition' },
            },
            '>': {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: { $ref: '#/$defs/Condition' },
            },
            '>=': {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: { $ref: '#/$defs/Condition' },
            },
            in: {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: { $ref: '#/$defs/Condition' },
            },
            var: { type: 'string' },
          },
        },
      ],
    },

    FlagSet: {
      description:
        'Sets a flag when a node is shown or a choice is picked. Value defaults to true.',
      type: 'object',
      required: ['flag'],
      additionalProperties: false,
      properties: {
        flag: { type: 'string' },
        value: { $ref: '#/$defs/Scalar' },
      },
    },

    EmitSpec: {
      description: 'Emits an event when a node is shown or a choice is picked.',
      type: 'object',
      required: ['event'],
      additionalProperties: false,
      properties: {
        event: { type: 'string' },
        payload: { $ref: '#/$defs/Payload' },
      },
    },

    Choice: {
      description:
        'One option on a node. Hidden while its condition is false unless show is "disabled".',
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: {
        text: { $ref: '#/$defs/Text' },
        next: { type: 'string' },
        condition: { $ref: '#/$defs/Condition' },
        show: { enum: ['hidden', 'disabled'] },
        set: { type: 'array', items: { $ref: '#/$defs/FlagSet' } },
        emit: { type: 'array', items: { $ref: '#/$defs/EmitSpec' } },
        once: { type: 'boolean' },
        ext: { $ref: '#/$defs/Ext' },
      },
    },

    DialogueNode: {
      description: 'One line of dialogue. With choices, next is ignored.',
      type: 'object',
      required: ['id', 'text'],
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        speaker: { type: 'string' },
        text: { $ref: '#/$defs/Text' },
        next: { type: 'string' },
        choices: { type: 'array', items: { $ref: '#/$defs/Choice' } },
        set: { type: 'array', items: { $ref: '#/$defs/FlagSet' } },
        emit: { type: 'array', items: { $ref: '#/$defs/EmitSpec' } },
        lore: { type: 'boolean' },
        ext: { $ref: '#/$defs/Ext' },
      },
    },

    Conversation: {
      description: 'One conversation: an actor, a start node and the nodes it reaches.',
      type: 'object',
      required: ['id', 'start', 'nodes'],
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        actor: { type: 'string' },
        title: { $ref: '#/$defs/Text' },
        start: { type: 'string' },
        nodes: { type: 'array', items: { $ref: '#/$defs/DialogueNode' } },
        ext: { $ref: '#/$defs/Ext' },
      },
    },
  },
}

/** The schema pretty printed with two spaces, ready to write to a .schema.json file. */
export function dialogueSchemaJson(): string {
  return JSON.stringify(OQD_JSON_SCHEMA, null, 2)
}
