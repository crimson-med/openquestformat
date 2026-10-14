# Decisions

Each entry: the question, the decision, the reason. Numbering matches the order the questions were raised in.

## D1. Dialogue is a sibling model, not part of the quest model

OQF ships its own dialogue model (`oqf-dialogue`) and a bridge interface. A quest binds to a dialogue node by provider and reference only, and observes the flags and events the dialogue sets. Ink and Yarn Spinner are supported through exporters (lossless, our model is smaller than theirs) and importers (best effort, with warnings for constructs that have no home in our model).

Reason: keeps the quest spec small, lets teams keep the dialogue tool they already use, and makes oqf+ink, oqf+yarn and oqf+oqf-dialogue equivalent from the quest's point of view.

## D2. Steps are state machine nodes in a flat list

States: `locked`, `available`, `active`, `done`, `failed`, `skipped`. Three data-driven transitions per step: `unlock`, `complete`, `fail`. Several steps may be active in parallel. Two routes to the same step are two steps that unlock from a common parent, with the next step unlocking on either. Optional is derived by the validator (not on any path to an ending) and may be flagged explicitly for UI. Cycles are only allowed on steps marked `repeat`.

Reason: covers the Skyrim, Witcher 3 and Baldur's Gate 3 patterns discussed (parallel objectives, optional objectives, kill-or-steal, repeatable quests) with one mechanism.

## D3. Conditions use a JSON Logic subset, written as infix text

No Lua, no embedded scripting, no invented AST. The canonical form of a condition is a JSON Logic tree restricted to a whitelist of operators. The compact format writes conditions as one infix string that parses to that tree.

Reason: JSON Logic has parsers in JavaScript, C#, Python, Go, Rust, Lua and GDScript. A whitelist keeps conditions statically analysable, which is the whole selling point of logic-as-data. Infix text keeps the line format flat.

## D4. Objectives are events with sugar on top

The core mechanism is: a step completes when a counter driven by a world event reaches a threshold. Objective kinds (`kill`, `collect`, `reach`, `talk`, `interact`) are shorthand that desugars to that. Unknown kinds pass through as `custom`.

Reason: one mechanism instead of two, and open for expansion.

## D5. Events flow both ways

Quests consume world events to advance and emit events as they move. Emitted names are namespaced under the quest ID. Payloads are flat key-value maps.

## D6. Rewards are first-class and also emit events

Reward kinds: `item`, `currency`, `xp`, `reputation`, `unlock`, `flag`, `event`, `custom`. Every grant emits `reward.granted`. Rewards carry an ID and are deduplicated in runtime state so re-entering a step never double-credits unless the step is `repeat`. The `event` kind is how a quest emits an arbitrary custom event.

Reason: tooling needs to sum rewards per branch, which opaque events cannot give. Emitting on grant means the engine credits with one listener.

## D7. Endings are terminal steps with an outcome

A step with an `outcome` field is an ending. Outcomes become world flags named `outcome.<questId>.<name>`, so they cannot collide across quests. Failures are outcomes marked `failed`. Runtime state keeps an ordered log of step transitions so any outcome can be traced back.

## D8. Strings are inline by default, keys optional

Any text field may be a literal string or a key prefixed with `@`. An extractor moves inline strings to a table with stable generated keys and rewrites the file to use them. The operation is reversible.

Reason: speed for indies, a studio path for everyone else.

## D9. Runtime state is a specified document

The spec defines a small versioned state document per quest: step states, counters, flags, outcome, transition log, and an extension bag. The runtime owns it, the game persists it however it likes.

Reason: portable content with unspecified save state is only half portable.

## D10. Actors, items, locations are references

OQF does not define actors, items or locations. It references them by engine ID with an optional display name, interned in per-file dictionaries.

## D11. One file may hold many quests, a pack is a directory

Shared dictionaries sit at the top of a file. Each quest header starts a new quest. IDs are unique across a pack, so cross references are `questId` or `questId#stepId`. No manifest file.

## D12. Extensions are namespaced and always preserved

JSON: keys of the form `x-<namespace>.<key>`. Compact: an `X` line attached to the preceding entity. The validator never strips them and warns on unknown namespaces only in strict mode. They round-trip through every format.

## D13. Compact format is canonical, JSON is an export

The repo form is the compact line format. Anyone who wants JSON runs the converter or opens the editor.

## D14. First target is a TypeScript runtime, shipping in Cozy Coast

Cozy Coast is Phaser 4 on Electron in TypeScript. `@oqf/runtime` is the day-one loader and the proof the format works. Engine exporters (Godot, Unity, Unreal) come after.

## D15. Timers, factions, radiant quests and tabletop are v2

Planned for, listed as non-goals for v1, designed so v1 files stay valid when they land.

Superseded for timers and radiant quests by D25 to D28, which bring them forward to v0.2.
Factions and tabletop stay v2.

## D16. Own evaluator, JSON Logic compatible tree, no dependency

The condition tree is JSON Logic shaped so other languages can use their existing JSON Logic library. The TypeScript runtime does not depend on `json-logic-js`: the whitelist is eleven operators and a strict evaluator is under a hundred lines. This keeps `@oqf/core` dependency-free and gives strict equality semantics instead of JSON Logic's loose `==`.

## D17. Rewards are a per-quest catalog, steps reference by id

`Quest.rewards` holds every reward the quest can grant. A step lists reward ids. A reward with `outcome` set is quest-level and granted when that outcome is reached. One definition, one place to sum, one `R` record type in the compact format.

## D18. Compact column order frozen for v0.1

See [12-compact-spec.md](12-compact-spec.md). Columns may only be appended.

## D19. `fail` takes an objective too

`Step.failObjective` mirrors `Step.objective`. The compact `fail` cell uses the same `<objective> [and <condition>]` grammar as `complete`. Needed so "the guard catches you" can be an event, not a flag the game has to set by hand.

## D20. A `talk` objective can bind to one exit of a conversation

`dialogue.ended` carries `at`, the node the conversation ended on. A `talk` objective's dialogue ref may be `conversation#node`, in which case only that exit completes the step. Found by the integration test: with conversation-level matching, backing out of the smuggler deal sold the ledger.

## D21. `runtime.resolve` works outside an evaluation

Dialogue providers call the runtime's resolver from outside a quest evaluation. Unqualified `count.<step>` and `step.<step>` search every loaded quest; the qualified `quest#step` form is accepted everywhere.

## D22. Editor-only data lives in the `x-editor` namespace, and a pack is edited as one document

The editor writes what only it needs into extension keys under `x-editor`, which every format already round-trips: `x-editor.pos` holds a step's or node's position on the canvas, `x-editor.file` holds the file a quest or conversation came from. Opening several files or a folder merges them into one quest document and one dialogue document, tagging each quest and conversation with its file; exporting as a pack groups by tag, gives each file only the dictionary entries it references, and strips the tag so it never lands in a file. Positions stay in the file on purpose.

Reason: the store stays one document with one dictionary set, which is what every selector, validator pass and cross-reference already expects, and the editor needs no format change or side file to remember layout or provenance. D12 guarantees other tools carry the keys through untouched.

## D23. A failed step never reaches its own outcome

Only completing an ending step reaches its outcome. A step that fails through `fail` or `failObjective` transitions to `failed` and stops there, whatever the outcome's `failed` flag says. The quest stays open and the remaining steps carry on. An outcome marked `failed` is still reached by completing its step, which is how `caught` closes the reference quest on `confiscated`.

Reason: a fail rule on an ending is how an author rules that branch out, not how the quest ends. "Sell the contents" with a fail objective for the player refusing means the sale did not happen, so closing the quest on the `sold` outcome is exactly wrong. A failed ending is a route that closed, and the player still has the other routes. Endings and fail rules stay independent: one field says where a route leads, the other says when the route is off the table.

## D24. A retaken quest is a new instance, never reopened for the player

After an outcome, a `repeat` quest's instance is closed and kept in history, and a fresh instance
starts `unseen`. It is offered again when its `unlock` holds and its cooldown (D25) has passed, or
when the game calls `offer`. The runtime never moves it to `open` on the player's behalf.

Reason: this is what the v0.1 runtime already does. Pinning it stops engines that re-implement OQF
from auto-reopening, which would hide every quest a giver offers after a repeatable one.

## D25. `cooldown` on Quest

A `repeat` quest may carry a `cooldown`: an ISO 8601 duration measured from the last outcome, or
`day`, `week` or `month`, which wait for the next calendar boundary. A new instance is offerable
only when `unlock` holds and the cooldown has passed. `cooldown` without `repeat` is a validation
error.

Clock-jump guard: a `lastOutcomeAt` in the future is read as now, and one more than a whole
cooldown in the future counts as passed. A clock moved backwards therefore never locks a player
out for longer than one cooldown, and a clock that is wildly off does not cost even that.

`cooldown` and `expire` (D26) stay two fields rather than one `cycle`: they measure from different
anchors (the last outcome and the instance start), and a daily quest that must be gone at the day
boundary already reads `day` in both cells.

Reason: "once a day" is the most common recurring quest and v0.1 could not say it. Calendar
keywords exist because `PT24H` from the last outcome drifts later every day, which is not what a
daily means.

## D26. `expire` on Quest

Same encoding as `cooldown`, measured from the instance's `startedAt`. When it passes, an open
instance reaches the built-in failed outcome `expired`: every other step is skipped, the flag
`outcome.<questId>.expired` is set, `quest.<questId>.outcome` fires with `failed: true`, and for a
`repeat` quest the cooldown starts as after any outcome. `expired` is reserved: an author cannot
declare an outcome with that name.

Reason: an outcome is already how a quest closes, so expiry needs no new state, event or flag
shape. Reserving the name keeps `outcome.<questId>.expired` meaningful in every quest.

## D27. `deadline` on Step

Same encoding as `cooldown`, measured from the step's `enteredAt`. When it passes while the step is
`active` or `available`, the step takes its `fail` transition and D23 applies: the step is
`failed`, the quest stays open. A step with a deadline and no `fail` rule still fails on the
deadline. `enteredAt` is set on every transition, so a step with an `activate` condition gets the
full deadline from the moment it activates.

Reason: a timed objective is a step that fails when time runs out, which the fail transition
already models. Keeping it on the step rather than the quest lets one timed leg sit inside an
untimed quest.

## D28. Templated quests (parameters)

A quest may declare parameters: a name, a type (`item`, `actor`, `location`, `number`, `string`)
and an optional constraint (a tag id for reference types, `min..max` for numbers). `$name` may
stand wherever an id or a number may appear in an objective, and as a value in a condition, where
it is sugar for the runtime-owned variable `param.<name>`. The engine binds values through a `bind`
hook when an instance is offered; the instance document stores them so a reload restores the same
quest. A missing or out-of-constraint value means the instance is not offered, never a crash, and a
quest with parameters and no bind hook is never offered.

Reason: a daily "catch n of this fish" is one quest with two parameters, not a quest per fish.
Binding at offer time keeps the choice (random, weighted, by season) in the game, and storing the
values on the instance keeps the promise that state is a document. Encoding `$name` as a `var`
read keeps the condition tree JSON Logic compatible.

## D29. Text arguments

Text keys receive arguments: the bound parameters, plus `count` and `target` for the step being
shown. A string may then read `Catch {n} {fish}`. OQF passes the arguments along; formatting and
plural rules stay the game's.

Reason: templated quests are unreadable without it, and the smallest thing that works is a map of
name to value. Plural rules differ per language and per localization library, so OQF does not pick
one.

## Open items

- **One objective per step.** The reference quest wants `trade` to require both "collect five koi" and "talk to the otter". v0.1 holds one objective per step; the talk half rides on the dialogue binding and a flag. A list of objectives is a candidate for v0.2 once the runtime has shipped in Cozy Coast and the need is confirmed.
- **Recurrence, pending confirmation.** The numbered docs already follow these three recommendations from [14-recurrence.md](14-recurrence.md): keep `cooldown` and `expire` as two fields rather than one `cycle` (folded into D25); keep `streak.<questId>` as a core variable, because deriving it in every engine would reimplement the calendar rules the runtime already owns; a streak is broken by a calendar period with no outcome or whose only outcome is `expired`, while any author-declared outcome, failed or not, keeps it alive, since the player showed up.
