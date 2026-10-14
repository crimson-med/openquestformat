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
warning free, in `.oqf` and `.json` pairs. Every template with a `talk` step also ships its
conversations as an `.oqd` and `.dialogue.json` pair, one conversation per talk step, bound from the
step's `dialogue` cell; `engine-hooks` is the only template without dialogue. Every `talk` objective
names the conversation its step is bound to, so replaying an earlier conversation cannot complete a
later step. The editor offers them under "New from template".

| Template | Pattern | Dialogue |
|----------|---------|----------|
| `linear` | One step after another, a step reward and a quest-level reward. | Maren asks for her net, then takes it back. |
| `branching` | A decision tree with four endings, one failed. Choices are dialogue exits (`talk actor conversation#node`), and the two choices fail each other's exit, so picking one rules the other out. | The keeper's question and the smuggler's offer, each choice a bound exit. |
| `repeatable` | A quest flagged `r`, gated by a quest `unlock`, retaken after every outcome. | The cook places the order, then takes the sardines. |
| `loop` | Two `repeat` steps that unlock each other: a failed cast sends the player to mend the line, and the loop exits when the cast succeeds. | Wen tells of the eel, then sees it landed. |
| `recurring-step` | One `repeat` step with no cycle, re-armed whenever its flag goes false and true again. | Ines offers bell duty, then takes it back. |
| `parallel` | Several steps active at once, an `and` join, an optional bonus, and a step unlocked by another step's counter. | Pim lists what the square needs, Suli agrees to play, Pim opens the festival. |
| `failure` | An `activate` gate, fail objectives on the road and on a timer, and three failed outcomes. | Tobin's offer sets `escort_accepted` or `escort_declined` from a choice, so the gate and the refusal come from the dialogue alone; Lysa closes the sale. |
| `chain` | Three quests in one file: unlocked by another quest's outcome, by its status, and a step reading a step of another quest. | Rosa asks about the voyage, then signs the log. |
| `engine-hooks` | What the engine owns: `var.*` reads, a `custom` objective, `unlock`, `flag`, `event` and `custom` rewards, payloads and extension keys. | None, there is no talk step. |
| `daily` | A repeatable quest with `cooldown` `day` and `expire` `P1D` in the last two `Q` columns: offered once a day, gone a day after it starts. | Odile places the morning order, then takes the driftwood. |
| `weekly` | A repeatable bounty with `cooldown` `week`, so `streak.weekly_bounty` counts the weeks in a row. | Pell posts the bounty, then counts the gulls. |
| `deadline` | A step with a `deadline` in `S` column 14 that fails on its own after ten minutes, with a failed outcome on the other side. | Brann points at the sandbar. |
| `templated` | Two `P` parameters, `$fish` and `$n`, bound by the game when the quest is offered, used in `collect $fish $n` and as `{n}` and `{fish}` in text. | Hesper names the fish, then counts the catch. |

To add a fixture, write the file into `quests/` (or `quests/broken/` for an invalid one), then add an
entry to `EXAMPLES` in `src/index.ts` so tests can reach it by name. Use real TAB characters between
cells, LF line endings, and a trailing newline. Follow the normalization rules: dictionary entries in
first-use order with unreferenced entries last, `R` lines before `S` lines within a quest, conditions
in canonical spelling, no trailing empty cells, and `X` lines sorted by namespace then key. When a
fixture is valid in both forms, add the `.oqf` and the `.json` together and keep them describing the
identical model. Check column positions before committing with
`awk -F'\t' '{print $1, NF}' quests/<name>.oqf`: a `Q` record carries 7 cells after the type cell, an
`R` record 6, an `S` record 13, minus any trailing empty cells that were trimmed.
