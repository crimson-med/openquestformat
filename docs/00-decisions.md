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

## D16. Own evaluator, JSON Logic compatible tree, no dependency

The condition tree is JSON Logic shaped so other languages can use their existing JSON Logic library. The TypeScript runtime does not depend on `json-logic-js`: the whitelist is eleven operators and a strict evaluator is under a hundred lines. This keeps `@oqf/core` dependency-free and gives strict equality semantics instead of JSON Logic's loose `==`.

## D17. Rewards are a per-quest catalog, steps reference by id

`Quest.rewards` holds every reward the quest can grant. A step lists reward ids. A reward with `outcome` set is quest-level and granted when that outcome is reached. One definition, one place to sum, one `R` record type in the compact format.

## D18. Compact column order frozen for v0.1

See [12-compact-spec.md](12-compact-spec.md). Columns may only be appended.

## D19. `fail` takes an objective too

`Step.failObjective` mirrors `Step.objective`. The compact `fail` cell uses the same `<objective> [and <condition>]` grammar as `complete`. Needed so "the guard catches you" can be an event, not a flag the game has to set by hand.

## Open items

- **One objective per step.** The reference quest wants `trade` to require both "collect five koi" and "talk to the otter". v0.1 holds one objective per step; the talk half rides on the dialogue binding and a flag. A list of objectives is a candidate for v0.2 once the runtime has shipped in Cozy Coast and the need is confirmed.
