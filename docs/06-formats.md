# Formats

One canonical model, several serializations. The compact line format is the repository form. JSON is a first-class export with a published schema. Markdown is a read-only export for docs and review.

## Compact format

Line-oriented, LF-separated. Cells within a line are TAB-separated. The first cell of every line is a single character that names the record type. No closing delimiters, no repeated keys.

This sketch shows the intent. The frozen column order is in [12-compact-spec.md](12-compact-spec.md), which wins where the two differ.

```
OQF1                                              magic + major version
# comment                                         ignored
A  harbormaster  otter  gull_feeder               actors dictionary (interned)
L  harbor  otter_den  smuggler_cove               locations dictionary
I  fish.rare  ledger  lure.golden                 items dictionary
T  main  harbor                                   tags dictionary
Q  id  version  flags  tagRefs  title  summary    quest header, starts a quest
R  id  kind  ref  amount  payload                 reward, belongs to current quest
S  id  flags  unlock  activate  complete  fail  outcome  rewardRefs  dialogue  location  title  journal
X  ns  key  value                                 extension on the preceding record
```

Notes:

- Dictionaries (`A`, `L`, `I`, `T`) are file-scoped and come before the first `Q`. References into them are indices. An index that names something not in the dictionary is a parse error.
- `Q` starts a quest. Everything until the next `Q` belongs to it. A file may contain many quests.
- `R` lines define rewards. `S` lines reference them by index in `rewardRefs`. Quest-level rewards keyed by outcome use `R` lines with the outcome name in the payload cell; exact encoding to be settled.
- Step `flags` is a short string of letters: `s` start, `o` optional, `r` repeat. Empty cell means none.
- `unlock`, `activate`, `complete`, `fail` are condition strings from [02-conditions.md](02-conditions.md). Empty cell means absent.
- `outcome` is `name` or `!name` for a failed outcome. Empty means not an ending.
- `dialogue` is `provider:ref`.
- `X` lines attach to whichever `Q`, `R` or `S` line preceded them.
- Text cells escape backslash, TAB, CR and LF, the same rule as NWF.
- New columns are appended at the end of a record so older files keep parsing.

Why this stays readable: steps are flat and reference each other by ID, conditions are one cell of infix text, and everything repeated is interned. A quest with ten steps is about fifteen lines.

The dialogue model has its own compact form with the same conventions (`C` conversation, `N` node, `O` choice, `X` extension), in a separate `.oqd` file. See [13-dialogue-spec.md](13-dialogue-spec.md). A later minor version may allow both in one file.

## JSON

A direct mapping of the model. Dictionaries are not interned; references are written inline as `{ "id": "harbormaster", "name": "Harbormaster Ines" }` or as a bare id string. Conditions are written as JSON Logic trees, not strings. A JSON Schema is published and the validator ships with it.

The JSON form is what engine importers target first because every engine has a JSON parser. It is also what the editor holds in memory.

## Markdown

Read-only. One heading per quest, a table of steps, a list of rewards per outcome, and a mermaid graph of the step transitions. Meant for design review and for pasting into a doc.

## Round-tripping

compact -> model -> compact is byte-stable after normalization (sorted dictionaries, canonical condition spelling). compact -> json -> compact is lossless including extensions. Markdown is one way.
