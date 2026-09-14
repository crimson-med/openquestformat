# @oqf/examples

Reference fixtures for Open Quest Format. `quests/harbormasters-ledger.oqf` and
`quests/harbormasters-ledger.json` are the same document in the two canonical serializations: the
reference quest from `docs/11-reference-quest.md`, written by hand against the frozen column order in
`docs/12-compact-spec.md`. `quests/minimal.oqf` and `quests/minimal.json` are the smallest valid
document, one quest with one step. `quests/broken/` holds deliberately invalid compact files, one
defect per file, each opening with a `#` comment that states the error a validator is expected to
report. These files are the shared truth for every package: a parser must produce the same model from
the compact and the JSON form, and a serializer must reproduce the compact bytes exactly after
normalization. Nothing here is generated, so edits are deliberate and reviewable.

`quests/templates/` holds small quests that each isolate one pattern the model supports, valid and
warning free, in `.oqf` and `.json` pairs. The editor offers them under "New from template".

| Template | Pattern |
|----------|---------|
| `linear` | One step after another, a step reward and a quest-level reward. |
| `branching` | A decision tree with four endings, one failed. Choices are dialogue exits (`talk actor conversation#node`), with `branching.oqd` and `branching.dialogue.json` holding the conversations. |
| `repeatable` | A quest flagged `r`, gated by a quest `unlock`, retaken after every outcome. |
| `loop` | Two `repeat` steps that unlock each other: a failed cast sends the player to mend the line, and the loop exits when the cast succeeds. |
| `recurring-step` | One `repeat` step with no cycle, re-armed whenever its flag goes false and true again. |
| `parallel` | Several steps active at once, an `and` join, an optional bonus, and a step unlocked by another step's counter. |
| `failure` | An `activate` gate, fail objectives on the road and on a timer, and three failed outcomes. |
| `chain` | Three quests in one file: unlocked by another quest's outcome, by its status, and a step reading a step of another quest. |
| `engine-hooks` | What the engine owns: `var.*` reads, a `custom` objective, `unlock`, `flag`, `event` and `custom` rewards, payloads and extension keys. |

To add a fixture, write the file into `quests/` (or `quests/broken/` for an invalid one), then add an
entry to `EXAMPLES` in `src/index.ts` so tests can reach it by name. Use real TAB characters between
cells, LF line endings, and a trailing newline. Follow the normalization rules: dictionary entries in
first-use order with unreferenced entries last, `R` lines before `S` lines within a quest, conditions
in canonical spelling, no trailing empty cells, and `X` lines sorted by namespace then key. When a
fixture is valid in both forms, add the `.oqf` and the `.json` together and keep them describing the
identical model. Check column positions before committing with
`awk -F'\t' '{print $1, NF}' quests/<name>.oqf`: a `Q` record carries 7 cells after the type cell, an
`R` record 6, an `S` record 13, minus any trailing empty cells that were trimmed.
