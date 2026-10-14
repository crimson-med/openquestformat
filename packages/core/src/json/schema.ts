/**
 * JSON Schema (draft 2020-12) for the JSON form of an OqfDocument.
 *
 * Hand written on purpose: `@oqf/core` has no dependencies, so nothing here is
 * generated from or validated by a schema library. The shapes must be kept in
 * step with model.ts by hand; the enums are imported so they cannot drift.
 */
import {
  DURATION_KEYWORDS,
  EXPIRED_OUTCOME,
  OQF_MAJOR,
  PARAMETER_TYPES,
  REWARD_KINDS,
} from '../model.js'

/** Loose type for the schema tree. Keeps callers from depending on its literal shape. */
export type JsonSchemaObject = Record<string, unknown>

/** Extension keys are `x-<namespace>.<key>`. */
export const EXT_KEY_PATTERN_SOURCE = '^x-[a-z0-9-]+\\.[A-Za-z0-9_.-]+$'

/** A `$name` parameter reference. */
export const PARAM_REF_PATTERN_SOURCE = '^\\$[A-Za-z_][A-Za-z0-9_]*$'

/**
 * A calendar keyword or an ISO 8601 span of weeks, days, hours, minutes and
 * seconds. The pattern cannot rule out a zero span; the validator does.
 */
export const DURATION_PATTERN_SOURCE = `^(?:${DURATION_KEYWORDS.join('|')}|P(?:\\d+W)?(?:\\d+D)?(?:T(?:\\d+H)?(?:\\d+M)?(?:\\d+S)?)?)$`

export const OQF_JSON_SCHEMA: JsonSchemaObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://openquestformat.org/schema/oqf-1.schema.json',
  title: 'Open Quest Format document',
  description: 'One OQF file: shared dictionaries plus one or more quests.',
  type: 'object',
  required: ['oqf', 'quests'],
  additionalProperties: false,
  properties: {
    oqf: {
      const: OQF_MAJOR,
      description: 'Format major version.',
    },
    dictionaries: { $ref: '#/$defs/Dictionaries' },
    quests: {
      type: 'array',
      items: { $ref: '#/$defs/Quest' },
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

    Duration: {
      description:
        'An ISO 8601 span restricted to weeks, days, hours, minutes and seconds, or one of the calendar keywords day, week and month.',
      type: 'string',
      pattern: DURATION_PATTERN_SOURCE,
    },

    ParamRef: {
      description: 'A reference to a quest parameter, written $name.',
      type: 'string',
      pattern: PARAM_REF_PATTERN_SOURCE,
    },

    Count: {
      description: 'An objective count: a positive integer or a $name parameter reference.',
      anyOf: [{ type: 'integer', minimum: 1 }, { $ref: '#/$defs/ParamRef' }],
    },

    Parameter: {
      description: 'A value the engine binds when an instance of the quest is offered.',
      type: 'object',
      required: ['name', 'type'],
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        type: { enum: [...PARAMETER_TYPES] },
        constraint: { type: 'string' },
        ext: { $ref: '#/$defs/Ext' },
      },
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

    Dictionaries: {
      description: 'File-scoped display names for the ids the quests reference.',
      type: 'object',
      additionalProperties: false,
      properties: {
        actors: { type: 'array', items: { $ref: '#/$defs/Ref' } },
        locations: { type: 'array', items: { $ref: '#/$defs/Ref' } },
        items: { type: 'array', items: { $ref: '#/$defs/Ref' } },
        tags: { type: 'array', items: { $ref: '#/$defs/Ref' } },
      },
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

    Objective: {
      description: 'Sugar for an event driven counter. Discriminated by kind.',
      oneOf: [
        {
          type: 'object',
          required: ['kind', 'actor'],
          additionalProperties: false,
          properties: {
            kind: { const: 'kill' },
            actor: { type: 'string' },
            count: { $ref: '#/$defs/Count' },
          },
        },
        {
          type: 'object',
          required: ['kind', 'item'],
          additionalProperties: false,
          properties: {
            kind: { const: 'collect' },
            item: { type: 'string' },
            count: { $ref: '#/$defs/Count' },
          },
        },
        {
          type: 'object',
          required: ['kind', 'location'],
          additionalProperties: false,
          properties: {
            kind: { const: 'reach' },
            location: { type: 'string' },
          },
        },
        {
          type: 'object',
          required: ['kind', 'actor'],
          additionalProperties: false,
          properties: {
            kind: { const: 'talk' },
            actor: { type: 'string' },
            dialogue: { type: 'string' },
          },
        },
        {
          type: 'object',
          required: ['kind', 'object'],
          additionalProperties: false,
          properties: {
            kind: { const: 'interact' },
            object: { type: 'string' },
          },
        },
        {
          type: 'object',
          required: ['kind', 'event'],
          additionalProperties: false,
          properties: {
            kind: { const: 'event' },
            event: { type: 'string' },
            count: { $ref: '#/$defs/Count' },
          },
        },
        {
          type: 'object',
          required: ['kind', 'custom', 'args'],
          additionalProperties: false,
          properties: {
            kind: { const: 'custom' },
            custom: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
          },
        },
      ],
    },

    Reward: {
      description:
        'An entry in the quest reward catalog. Entries with outcome set are quest-level.',
      type: 'object',
      required: ['id', 'kind', 'ref'],
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        kind: { enum: [...REWARD_KINDS] },
        ref: { type: 'string' },
        amount: { type: 'number' },
        outcome: { type: 'string' },
        payload: { $ref: '#/$defs/Payload' },
        ext: { $ref: '#/$defs/Ext' },
      },
    },

    Outcome: {
      description: `Present on ending steps only. The name ${EXPIRED_OUTCOME} is reserved for the built-in outcome a quest with expire reaches.`,
      type: 'object',
      required: ['name'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', not: { const: EXPIRED_OUTCOME } },
        failed: { type: 'boolean' },
        title: { $ref: '#/$defs/Text' },
      },
    },

    DialogueBinding: {
      description: 'Binds a step to a conversation in some dialogue provider.',
      type: 'object',
      required: ['provider', 'ref'],
      additionalProperties: false,
      properties: {
        provider: { type: 'string' },
        ref: { type: 'string' },
      },
    },

    Step: {
      type: 'object',
      required: ['id', 'title'],
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        title: { $ref: '#/$defs/Text' },
        journal: { $ref: '#/$defs/Text' },
        start: { type: 'boolean' },
        unlock: { $ref: '#/$defs/Condition' },
        activate: { $ref: '#/$defs/Condition' },
        objective: { $ref: '#/$defs/Objective' },
        complete: { $ref: '#/$defs/Condition' },
        failObjective: { $ref: '#/$defs/Objective' },
        fail: { $ref: '#/$defs/Condition' },
        deadline: { $ref: '#/$defs/Duration' },
        optional: { type: 'boolean' },
        repeat: { type: 'boolean' },
        outcome: { $ref: '#/$defs/Outcome' },
        rewards: { type: 'array', items: { type: 'string' } },
        dialogue: { $ref: '#/$defs/DialogueBinding' },
        location: { type: 'string' },
        actors: { type: 'array', items: { type: 'string' } },
        ext: { $ref: '#/$defs/Ext' },
      },
    },

    Quest: {
      type: 'object',
      required: ['id', 'version', 'title', 'steps'],
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        version: { type: 'integer', minimum: 1 },
        title: { $ref: '#/$defs/Text' },
        summary: { $ref: '#/$defs/Text' },
        tags: { type: 'array', items: { type: 'string' } },
        repeat: { type: 'boolean' },
        unlock: { $ref: '#/$defs/Condition' },
        cooldown: { $ref: '#/$defs/Duration' },
        expire: { $ref: '#/$defs/Duration' },
        params: { type: 'array', items: { $ref: '#/$defs/Parameter' } },
        steps: { type: 'array', items: { $ref: '#/$defs/Step' } },
        rewards: { type: 'array', items: { $ref: '#/$defs/Reward' } },
        ext: { $ref: '#/$defs/Ext' },
      },
    },
  },
}

/** The schema pretty printed with two spaces, ready to write to a .schema.json file. */
export function schemaJson(): string {
  return JSON.stringify(OQF_JSON_SCHEMA, null, 2)
}
