# @oqf/core

The canonical Open Quest Format model and everything that reads or writes it: the compact (`.oqf`)
and JSON parsers and serializers, the condition language, Markdown export, the JSON Schema and the
validator. No I/O and no runtime dependencies, so it runs unchanged in a browser, in Node and in a
build step.

Every other package converts to or from the model defined here, never around it.

## Install

```
pnpm add @oqf/core
```

## Usage

```ts
import { parseCompact, toCompact, toJson, toMarkdown, validateDocument } from '@oqf/core'

const doc = parseCompact(source) // an .oqf file, OQF1 on line 1
const check = validateDocument(doc, { strict: true })

for (const finding of check.findings) {
  console.log(`${finding.level} ${finding.code} ${finding.path ?? ''}: ${finding.message}`)
}

if (check.ok) {
  toCompact(doc) // reproduces `source` byte for byte after normalization
  toJson(doc) // the JSON form, same model
  toMarkdown(doc) // a readable brief, export only
}
```

## What it exports

| Area | Exports |
|------|---------|
| Model | `OqfDocument`, `Quest`, `Step`, `Reward`, `Outcome`, `Objective`, `Condition`, `Dictionaries`, `emptyDocument`, `stepRef`, `outcomeFlag`, `OQF_MAGIC`, `OQF_MAJOR` |
| Compact | `parseCompact`, `toCompact`, `CompactFormatError` |
| JSON | `parseJson`, `toJson`, `fromJsonValue`, `toJsonValue`, `JsonFormatError`, `OQF_JSON_SCHEMA`, `schemaJson` |
| Markdown | `toMarkdown` |
| Conditions | `parseCondition`, `formatCondition`, `evaluateCondition`, `checkCondition`, `conditionVariables`, `parseObjective`, `formatObjective`, `parseCompletion`, `formatCompletion`, `ConditionSyntaxError` |
| Validation | `validateDocument`, `validatePack`, `Finding`, `ValidationResult`, `VALIDATION_CODES`, `stepGraph`, `findCycles`, `reachableSteps` |

## Notes

- The two serializations describe the identical model. Both parsers produce deep-equal documents and
  both serializers reproduce their input byte for byte after normalization. The fixtures in
  `@oqf/examples` are the shared truth for that claim.
- Conditions are a non-Turing-complete infix language over a fixed operator whitelist, stored as a
  JSON Logic subset. `evaluateCondition` takes a resolver, `(path: string) => unknown`, and never
  touches the world itself.
- `validatePack` treats several documents as one pack, so ids and cross-quest references resolve
  across files. `validateDocument` is the pack of one.
- Extension keys are `x-<namespace>.<key>`. Core preserves them through every format and never reads
  them.

## Documentation

The model is [docs/01-model.md](../../docs/01-model.md), the condition language
[docs/02-conditions.md](../../docs/02-conditions.md), the formats
[docs/06-formats.md](../../docs/06-formats.md) with the frozen column order in
[docs/12-compact-spec.md](../../docs/12-compact-spec.md), and what the validator proves is
[docs/08-validation.md](../../docs/08-validation.md). The project overview is the
[root README](../../README.md).
