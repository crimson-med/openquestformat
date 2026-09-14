# @oqf/dialogue

Dialogue for Open Quest Format: a small conversation model, the bridge a quest runtime talks to, the `.oqd` compact and JSON formats, a validator, and a provider that runs the model. Depends only on `@oqf/core`.

## Model

A `DialogueDocument` is a speakers dictionary plus conversations.

| Entity | Fields |
|--------|--------|
| `Conversation` | `id`, `actor` (default speaker), `title`, `start` (node id), `nodes`, `ext` |
| `DialogueNode` | `id`, `speaker`, `text`, `next`, `choices`, `set`, `emit`, `lore`, `ext` |
| `Choice` | `text`, `next`, `condition`, `show`, `set`, `emit`, `once`, `ext` |

A node with `choices` ignores `next`. A node with neither ends the conversation. `set` is a list of `flag = value`, `emit` a list of event names with optional flat payloads. A false `condition` hides a choice unless `show: 'disabled'` lists it greyed out. `once` hides a choice after it has been picked in this save. `lore: true` promises that nothing in the subtree from that node sets a flag or emits, and the validator checks it.

## Provider

```ts
import { OqfDialogueProvider, parseOqd } from '@oqf/dialogue'

const provider = new OqfDialogueProvider([parseOqd(text)])
const session = provider.start('ines_intro', {
  resolve: (path) => runtime.resolve(path),
  emit: (event) => runtime.emit(event),
  once: saveGame.onceStore,
})

const view = session.current() // speaker, text, choices, linear
session.choose(view.choices[0].index) // or session.advance() on a linear node
```

`start` emits `dialogue.started { actor, node }`, showing a node applies its `set` then its `emit` once per visit, choosing applies the choice's `set` and `emit` then emits `dialogue.choice { node, choice }`, and the end emits `dialogue.ended { actor, node }` where `node` is the conversation id. A quest step with a `talk` objective completes on that last event. Choice conditions go through `resolve` every time `current()` is called, so `count.*` and `flag.*` are always current.

## Formats

`parseOqd` and `toOqd` read and write the TAB separated `.oqd` form; `parseDialogueJson`, `toDialogueJson` and `fromDialogueJsonValue`, `toDialogueJsonValue` read and write the JSON form, with `OQD_JSON_SCHEMA` and `dialogueSchemaJson()` for the draft 2020-12 schema. Both forms normalize the same way, so `toOqd(parseOqd(text))` reproduces the file byte for byte and both parsers produce deep-equal models. `validateDialogue(docs, { strict, quests })` returns `@oqf/core` findings, including the lore-node check and the binding checks against the quests that name these conversations.

See `docs/13-dialogue-spec.md` for the frozen record and cell encodings, and `packages/examples/quests/harbormasters-ledger.oqd` for the reference conversations.
