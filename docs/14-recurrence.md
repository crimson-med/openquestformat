# Recurrence: cooldowns, expiry, deadlines and templated quests

Status: agreed for v0.2, implementation pending. Additive: every v0.1 file stays valid, and
compact columns are only appended (D18).

This document is the overview and the worked example. The normative text lives in the numbered
docs: D24 to D29 in [00-decisions.md](00-decisions.md), the fields and the duration encoding in
[01-model.md](01-model.md), the new namespaces in [02-conditions.md](02-conditions.md), the
instance fields and the quest record in [05-state.md](05-state.md), text arguments in
[07-i18n.md](07-i18n.md), the rules in [08-validation.md](08-validation.md) and the columns in
[12-compact-spec.md](12-compact-spec.md). Where the two disagree, the numbered doc wins.

## Problem

v0.1 says whether a quest can be taken again (`repeat`), never when. A game cannot say "once a
day", "once a week", "this one ran out at midnight" or "today's request asks for a different fish"
without fields of its own outside the format. Every game with recurring quests hits this. Timers
and templated quests are already on the v2 list in `10-roadmap.md`; this document makes them
concrete.

## D24. A retaken quest is a new instance, never reopened for the player

After an outcome, a `repeat` quest's instance is closed and kept in history, and a fresh instance
starts `unseen`. It is offered again when its `unlock` holds (and, from D25, its cooldown has
passed), or when the game calls `offer`. The runtime never moves it to `open` on the player's
behalf.

This is what the v0.1 runtime already does. The decision pins it so engines that re-implement OQF
do not auto-reopen, which hides every quest a giver would offer after a repeatable one.

## D25. `cooldown` on Quest

A `repeat` quest may carry a `cooldown`. A new instance is offerable only when `unlock` holds and
the cooldown has passed since the last outcome.

| Value | Meaning |
|-------|---------|
| ISO 8601 duration (`PT20H`, `P3D`) | measured from `lastOutcomeAt` |
| `day` | from the next calendar day boundary |
| `week` | from the next calendar week boundary |
| `month` | from the next calendar month boundary |

Clock-jump guard (normative): a `lastOutcomeAt` in the future is read as now, and one more than a
whole cooldown in the future counts as passed. A clock moved backwards never locks a player out for
longer than one cooldown, and a clock that is wildly off does not cost even that.

`cooldown` without `repeat` is a validation error.

## D26. `expire` on Quest

Same encoding as `cooldown`, measured from the instance's `startedAt`. When it passes, an open
instance reaches the built-in failed outcome `expired`: every other step is skipped, the flag
`outcome.<questId>.expired` is set, `quest.<questId>.outcome` fires with `failed: true`, and for a
`repeat` quest the cooldown starts as after any outcome. `expired` is reserved: an author cannot
declare an outcome with that name.

## D27. `deadline` on Step

Same encoding as `cooldown`, measured from the step's `enteredAt`. When it passes while the step
is `active` or `available`, the step takes its `fail` transition (marked `failed`, D23 applies).
A step with a deadline and no `fail` rule still fails on the deadline.

## D28. Templated quests (parameters)

A quest may declare parameters. The engine binds their values when an instance is offered, and
the instance document stores them, so a reload restores the same quest.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Unique in the quest. Referenced as `$name`. |
| `type` | `item`, `actor`, `location`, `number`, `string` | |
| `constraint` | string | Optional. A tag id for ref types; `min..max` for `number`. |

- `$name` may appear wherever an id or a number may appear in an objective (`collect $fish $n`)
  and as a value in conditions, where it is sugar for the variable `param.<name>`, so the tree
  stays plain JSON Logic.
- The runtime takes a `bind(questId, instance, params)` hook that returns a value per parameter.
  A missing value, or one that breaks its constraint, means the instance is not offered; it is
  never a crash.
- A quest with parameters and no bind hook is never offered.

## D29. Text arguments

Text keys receive arguments: the bound parameters, plus `count` and `target` for the step being
shown. A string may then read `Catch {n} {fish}`. OQF passes the arguments along; formatting and
plural rules stay the game's.

## Clock and calendar

`QuestRuntimeOptions.clock` stays as it is. It is now required to return milliseconds since the
epoch whenever any of D25 to D27 is in use; the default counter is only valid without them. A new
option describes the calendar:

```ts
calendar?: {
  timeZone?: string     // IANA zone, default: host local time
  weekStart?: number    // 0 Sunday .. 6 Saturday, default 1 (Monday)
  dayStartsAt?: number  // hour the day rolls over, default 0
}
```

Time passes without events, so the runtime gains `tick()`, which re-evaluates cooldowns, expiry
and deadlines against the clock. Games call it on a timer or on resume. Every other entry point
also evaluates time first.

## New variables (runtime owned)

| Path | Type | Meaning |
|------|------|---------|
| `time.now` | number | ms since epoch |
| `time.day` | number | calendar day index, after `dayStartsAt` |
| `time.week` | number | calendar week index, from `weekStart` |
| `time.weekday` | number | 0 to 6, where 0 is `weekStart` |
| `time.hour` | number | 0 to 23, local |
| `time.minute` | number | 0 to 59, local |
| `runs.<questId>` | number | outcomes reached across all instances |
| `runs.<questId>.<outcome>` | number | the same, for one outcome |
| `streak.<questId>` | number | consecutive cooldown periods ending in an outcome (calendar cooldowns only) |

`time.*` replaces the `var.time.*` the roadmap sketched. Being runtime owned means the validator
can type check it.

How the indices are computed, with `local` the clock shifted into the calendar's zone:

- `time.day` is `floor((local - dayStartsAt hours) / 24 hours)`, counted from the epoch.
- `time.weekday` is `(time.day + 4 - weekStart) mod 7`, always in 0 to 6; day 0 of the epoch was
  a Thursday, which is 4 when Sunday is 0.
- `time.week` is `floor((time.day + 4 - weekStart) / 7)`.
- `time.hour` and `time.minute` are the wall clock in the zone, unshifted.

A `day` boundary is where `time.day` changes, a `week` boundary where `time.week` changes, and a
`month` boundary is the first day of the next month at `dayStartsAt`.

## State

The instance document gains `startedAt` (set when it becomes `open`), `outcomeAt`, `instance`
(1 based, the record's `runs` plus one when created) and `params` (a map of name to value).
`expire` is only evaluated while the instance is `open`; an offer that is never accepted does not
run out.

A **quest record**, one per quest id, outlives instances. It is the persistable summary that
`runs.*` and `streak.*` read, so a game does not have to store every past instance:

```
record:
  runs:          number
  outcomes:      map outcome name -> count
  lastOutcome:   name | null
  lastOutcomeAt: clock value | null
  streak:        number
```

The in-memory instance history stays as it is; games may cap or drop it.

## Compact format

| Record | Change |
|--------|--------|
| `Q` | append column 8 `cooldown`, column 9 `expire` |
| `S` | append column 14 `deadline` |
| `P` | new record: `P  name  type  constraint`, attached to the latest `Q`, written after `Q` and before its `R` lines |

Duration cells hold an ISO 8601 duration, or `day`, `week` or `month`.

## Validation

| Rule | Severity |
|------|----------|
| `cooldown` without `repeat` | error |
| `streak.<id>` on a quest without a calendar cooldown | error |
| `$name` not declared by a `P` | error |
| `P` declared and never used | warning |
| duplicate parameter name | error |
| `time.*` compared with a non number | error |
| unparseable duration | error |
| an author outcome named `expired` | error |
| a step `deadline` longer than the quest's `expire` | warning |

## Example: a daily request

```
OQF1
A	gus|Gus Barnacle
T	fish.catchable
Q	gus_daily	1	r		outcome.gus_intro.done	@quest.gus_daily.title	@quest.gus_daily.desc	day	P1D
P	fish	item	fish.catchable
P	n	number	1..40
R	coins	currency	coins	30	done
S	catch	s			collect $fish $n							@quest.gus_daily.catch
S	turn_in		step.catch		talk gus gus_turn_in		done				0	@quest.gus_daily.title
```

It is offered once a day after the intro, asks for `n` of one fish chosen by the game, and is gone
a day after it was started.

## Out of scope

- NPC schedules and "once per visit": whether a giver is present belongs to the game. Use `unlock`
  with a `var.*` the engine resolves (`var.giver_present.milo`).
- How parameter values are chosen: that is the bind hook, so the engine's.
- Catching up time while the game is closed: the runtime evaluates against the clock it is given,
  when asked.

## Resolved questions

Each was open in the proposal. The first is folded into D25, the other two are D30.

- **Merge `cooldown` and `expire` into one `cycle`?** No. They measure from different anchors (the
  last outcome and the instance start), so one field would need a flag and a third encoding, and a
  daily that must be gone at the boundary already reads `day` in both cells. Two cells cost one tab.
- **Is `streak` worth a core variable?** Yes. The record holds everything needed, but turning it
  into a number means applying `dayStartsAt`, `weekStart` and the zone, which the runtime already
  owns. Deriving it in each engine would copy that logic, and authors could not write
  `streak.gus_daily >= 7` in an `unlock` without engine code.
- **What breaks a streak?** A calendar period with no outcome, or whose only outcome is `expired`.
  Any author-declared outcome, failed or not, keeps it alive: the player showed up and finished, and
  "failed" is the author's verdict on the route, not on attendance. The read rule in
  [05-state.md](05-state.md) applies the break lazily, so the record is only written on outcomes.
