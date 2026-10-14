# The quest model

This is the canonical model every parser produces and every serializer consumes. Field names are provisional until the spec is written. Types are described informally.

## Pack

A pack is a directory of OQF files. IDs (quests, steps, rewards, dialogue nodes) are unique across the pack. A file may contain one or many quests and holds the interned dictionaries its quests reference.

## Quest

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Stable, unique in the pack. Never renamed once shipped (see [05-state.md](05-state.md)). |
| `version` | integer | Content version. Bumped when steps are added, removed or renamed. |
| `title` | text | Player-facing. |
| `summary` | text | Player-facing journal summary. |
| `tags` | tag refs | For filtering and grouping. Free-form. |
| `repeat` | boolean | Whole quest may be taken again after an outcome. |
| `start` | step ids | Steps that begin `available` when the quest is offered. Defaults to steps with no `unlock` condition. |
| `unlock` | condition | When the quest itself becomes offerable. Optional. |
| `cooldown` | duration | Optional, requires `repeat`. How long after an outcome a new instance may be offered. See [D25](00-decisions.md). |
| `expire` | duration | Optional. How long after an instance starts it reaches the reserved `expired` outcome. See [D26](00-decisions.md). |
| `params` | list of parameter | Optional. Values the engine binds when an instance is offered. See below and [D28](00-decisions.md). |
| `steps` | list of step | Flat. Order is authoring order, not execution order. |
| `rewards` | list of reward | The quest's reward catalog. Entries with `outcome` set are quest-level and granted on that outcome; the rest are referenced by steps. |
| `ext` | extension bag | See below. |

## Step

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique in the quest. Referenced as `questId#stepId` from outside. |
| `title` | text | Short objective line shown in a tracker. |
| `journal` | text | Longer entry written to the journal when the step becomes active. Optional. |
| `unlock` | condition | Moves `locked` to `available`. Absent means the step is in `start`. |
| `activate` | condition | Moves `available` to `active`. Absent means it activates immediately on unlock. Use for "player accepted" or "player reached the area". |
| `complete` | condition or objective | Moves `active` to `done`. |
| `fail` | condition or objective | Moves `active` or `available` to `failed`. Optional. Takes the same `<objective> [and <condition>]` form as `complete`; the objective part is stored as `failObjective`. |
| `deadline` | duration | Optional. How long after the step is entered (its `enteredAt`) it takes its `fail` transition, while `active` or `available`. Works without a `fail` rule. See [D27](00-decisions.md). |
| `optional` | boolean | UI hint only. The validator derives optionality independently. |
| `repeat` | boolean | Allows this step to be re-entered. Required for any cycle in the graph. |
| `outcome` | outcome | Present on ending steps only. See below. |
| `rewards` | reward ids | Ids into the quest's reward catalog, granted on `done`. |
| `dialogue` | dialogue binding | Optional. See [04-dialogue.md](04-dialogue.md). |
| `location` | location ref | Optional marker for the tracker. |
| `actors` | actor refs | Optional, who is involved. For tooling and markers. |
| `ext` | extension bag | |

### Step states

```
locked -> available -> active -> done
                  \        \-> failed
                   \-> skipped
```

- `locked`: unlock condition not yet met.
- `available`: unlocked, waiting for `activate` (or immediately `active` if none).
- `active`: objective is live, counters run.
- `done`: complete condition met, rewards granted.
- `failed`: fail condition met. A failed step never reaches an outcome, even when it is an ending.
- `skipped`: the runtime marks a step skipped when an ending is reached and the step is not `done` or `failed`, so the route the player did not take is crossed out. Never set by a condition.

Several steps may be `active` at once.

### Objective sugar

`complete` may be an objective instead of a bare condition. An objective desugars to a counter driven by an event plus a threshold.

| Objective | Desugars to |
|-----------|-------------|
| `kill <actor> [n]` | count `actor.killed` where `actor == ref`, complete at `n` (default 1) |
| `collect <item> [n]` | count `item.collected` where `item == ref`, complete at `n` |
| `reach <location>` | first `location.entered` where `location == ref` |
| `talk <actor> [dialogue]` | first `dialogue.ended` where `actor == ref`. `dialogue` may be a conversation id (matches `node`) or `conversation#node` (also requires `at` to equal the node, so only one exit of the conversation counts) |
| `interact <object>` | first `object.interacted` where `object == ref` |
| `event <name> [n]` | count any event `name`, complete at `n` |
| `custom <kind> ...` | passed through untouched; engine decides |

Objectives may be combined with a condition: `collect fish.rare 5 and flag:met_harbormaster`.

A parameter reference `$name` may stand in for any id or number in an objective: `collect $fish $n`,
`talk $giver`, `reach $where`. The model stores the reference as the string `$name` in that field;
the runtime substitutes the bound value when it evaluates the step. The parameter's type must fit
the slot: an `item` parameter where an item id goes, a `number` where a count goes.

Exact event names the sugar listens to are listed in [03-events.md](03-events.md). Engines that use different names map them once in the runtime.

## Duration

`cooldown`, `expire` and `deadline` are typed `duration`. A duration is one of:

| Value | Meaning |
|-------|---------|
| ISO 8601 duration | A fixed span, measured from its anchor: `PT20H`, `P3D`, `P1W`, `P1DT12H`. Only `W`, `D`, `H`, `M` and `S` components with integer values are accepted; years and months are not, since a month has no fixed length (use `month`). `W` is seven days and `D` is twenty four hours, so a fixed span ignores daylight saving. |
| `day` | Until the next calendar day boundary after the anchor, at `dayStartsAt` in the calendar's zone. |
| `week` | Until the next week boundary after the anchor: the next `weekStart` day at `dayStartsAt`. |
| `month` | Until the first day of the next month after the anchor, at `dayStartsAt`. |

The anchor is the last outcome for `cooldown`, the instance's `startedAt` for `expire` and the
step's `enteredAt` for `deadline`. The calendar (`timeZone`, `weekStart`, `dayStartsAt`) is a
runtime option, so a file never carries a time zone; see [14-recurrence.md](14-recurrence.md).

## Parameter

A quest with parameters is a template. Each instance binds every parameter to a value before it is
offered, and the instance document keeps the values (see [05-state.md](05-state.md)).

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Unique in the quest. Referenced as `$name` in objectives and conditions, and as `{name}` in text. |
| `type` | enum | `item`, `actor`, `location`, `number`, `string`. |
| `constraint` | string | Optional. For `item`, `actor` and `location`: a tag id the bound reference must carry. For `number`: `min..max`, inclusive, either side optional (`1..40`, `5..`). Ignored for `string`. |
| `ext` | extension bag | |

The engine binds values through the runtime's `bind` hook when an instance would be offered. The
hook returns a value per parameter: an id for the reference types, a number or a string. A value
that is missing or breaks its constraint means the instance is not offered, and the runtime asks
again next time it would offer. A quest with parameters and no bind hook is never offered.

## Reward

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique in the quest. Referenced from steps and used for deduplication in state. |
| `kind` | enum | `item`, `currency`, `xp`, `reputation`, `unlock`, `flag`, `event`, `custom`. |
| `ref` | string | Item id, currency id, reputation track, unlock id, flag name, event name, or custom kind. |
| `amount` | number | Optional. Default 1. Negative allowed for `reputation` and `currency`. |
| `outcome` | string | Present on quest-level rewards only. Names the outcome that grants it. |
| `payload` | flat map | Optional. Sent along with the emitted event. |
| `ext` | extension bag | |

Granting a reward always emits `reward.granted` (see [03-events.md](03-events.md)). Kind `event` emits the named event instead, with the payload. Kind `flag` sets the flag in quest state and emits.

## Outcome

Present on ending steps.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Unique among the quest's outcomes. |
| `failed` | boolean | The outcome is a failure. Default false. |
| `title` | text | Player-facing, optional. |

The name `expired` is reserved: it is the built-in failed outcome a quest with `expire` reaches
when its time runs out, and an author cannot declare an outcome with that name. It behaves as any
failed outcome below, except that no step completes: every step that is not `done` or `failed` is
skipped.

A step reaches its outcome by completing. A step that fails through `fail` or `failObjective` only marks that step `failed`, whatever the outcome's `failed` flag says: the quest stays open and every other step carries on. An ending with a fail rule is how an author rules that route out, not how a quest ends. See [D23](00-decisions.md).

Reaching an outcome:

1. Marks the step `done` (or `failed` if the outcome is failed).
2. Marks every other step that is not `done` or `failed` as `skipped`, including active ones.
3. Sets the world flag `outcome.<questId>.<name>`.
4. Grants quest-level rewards keyed to that outcome.
5. Emits `quest.<questId>.outcome` with `name` and `failed` in the payload.

A quest without `repeat` is closed after any outcome. A `repeat` quest closes the instance, keeps
it in history and starts a fresh instance `unseen`, which is offerable once its `cooldown` has
passed ([D24](00-decisions.md), [D25](00-decisions.md)).

## References

Actors, items, locations, objects and tags are opaque engine IDs. Each may carry an optional display name for tooling. They are interned per file in the compact format and written inline in JSON.

References never define the thing. OQF does not know what an item is beyond its ID.

## Text

Any field typed `text` is either a literal string or a key of the form `@some.key`. See [07-i18n.md](07-i18n.md).

## Extension bag

Every entity carries an extension bag. Keys are namespaced: `x-<namespace>.<key>`. Values are strings, numbers, booleans, or flat maps of those. The validator preserves them, tools round-trip them, and no OQF feature ever reads them.

Typical namespaces: `x-unity`, `x-godot`, `x-cozycoast`, `x-editor` (layout positions in the editor).
