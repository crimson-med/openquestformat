# Conditions

A condition is a boolean expression over quest and world state. It has two forms: a canonical tree and an authoring string. Both are equivalent and convert both ways.

## Why not a scripting language

Scripts cannot be statically checked. A validator cannot tell whether a Lua snippet can ever be true, so it cannot tell whether a quest is completable, and neither can an AI reading the file. Engines also do not share a scripting language. The condition language is deliberately not Turing complete.

## Canonical tree: JSON Logic subset

The tree is a [JSON Logic](https://jsonlogic.com) expression restricted to this operator whitelist:

| Operator | Meaning |
|----------|---------|
| `and`, `or`, `not` | boolean |
| `==`, `!=`, `<`, `<=`, `>`, `>=` | comparison on numbers and strings |
| `in` | membership in a list literal |
| `var` | read a variable |
| literals | number, string, boolean |

Anything outside the whitelist is a validation error. JSON Logic has maintained implementations in JavaScript, C#, Python, Go, Rust, PHP, Ruby, Java and Lua; a GDScript port is small. The TypeScript runtime ships its own strict evaluator for the whitelist (see decision D16) so `@oqf/core` stays dependency-free; the tree stays JSON Logic compatible for everyone else.

## Variables

Variables are dotted paths. The first segment is the namespace.

| Path | Type | Meaning |
|------|------|---------|
| `flag.<name>` | boolean | A flag set by a reward, a dialogue, or the game. Unset reads false. |
| `count.<stepId>` | number | The objective counter of a step in this quest. |
| `step.<stepId>` | string | State of a step in this quest: `locked`, `available`, `active`, `done`, `failed`, `skipped`. |
| `step.<questId>#<stepId>` | string | Same, for a step in another quest. |
| `outcome.<questId>.<name>` | boolean | Whether that quest reached that outcome. |
| `quest.<questId>` | string | `unseen`, `offered`, `open` or `closed`. |
| `var.<name>` | any | Game-provided. The engine supplies a resolver. Unknown reads null. |
| `param.<name>` | string or number | A parameter bound on this quest's instance. Written `$name` in the authoring string. See [D28](00-decisions.md). |
| `time.now` | number | Milliseconds since the epoch, from the runtime clock. |
| `time.day` | number | Calendar day index. Rolls over at `dayStartsAt` in the calendar's zone. |
| `time.week` | number | Calendar week index. Weeks begin on `weekStart`. |
| `time.weekday` | number | 0 to 6, where 0 is `weekStart`. |
| `time.hour` | number | 0 to 23, wall clock in the calendar's zone. Not shifted by `dayStartsAt`. |
| `time.minute` | number | 0 to 59. |
| `runs.<questId>` | number | Outcomes reached across every instance of that quest, `expired` included. |
| `runs.<questId>.<name>` | number | The same, for one outcome. |
| `streak.<questId>` | number | Consecutive calendar periods ending in an outcome, per [D30](00-decisions.md). Only valid on a quest with a calendar `cooldown` (`day`, `week`, `month`). |

Everything except `var.*` is owned by the runtime and resolvable without the engine. That is what makes the validator useful: it can reason about every namespace except `var`, and it treats `var` as unknown.

`param.*`, `time.*`, `runs.*` and `streak.*` are owned by the runtime but their values are not known
until play: the validator checks their types (`time.*`, `runs.*` and `streak.*` are numbers; a
`param` has the type its declaration gives it) and otherwise treats them as unknown, like `var.*`.
The `time.*` indices are defined in [14-recurrence.md](14-recurrence.md); `runs.*` and `streak.*`
read the quest record in [05-state.md](05-state.md).

## Authoring string

The compact format and the editor use an infix string that parses to the tree. Grammar, informally:

```
expr     := or
or       := and ( "or" and )*
and      := not ( "and" not )*
not      := "not" not | cmp
cmp      := value ( ("==" | "!=" | "<" | "<=" | ">" | ">=" | "in") value )?
value    := number | string | boolean | path | param | "(" expr ")" | list
path     := segment ( "." segment )*     -- the variable forms above
param    := "$" name                      -- sugar for the path param.<name>
list     := "[" value ("," value)* "]"
```

Bare `flag.x` in boolean position means `flag.x == true`. Bare `step.x` in boolean position means `step.x == "done"`. Strings use double quotes. Whitespace is free. `$n` parses to the same tree as `param.n` and the canonical printer always writes `$n`, so the tree stays plain JSON Logic.

Examples:

```
flag.met_harbormaster
count.catch_rare >= 5
step.steal == "done" or step.trade == "done"
outcome.old_lighthouse.restored and not flag.banned_from_harbor
var.season in ["spring", "summer"]
count.catch >= $n
time.hour >= 20 or time.hour < 6
streak.gus_daily >= 7 and runs.gus_daily.done > runs.gus_daily.expired
```

The parser is a small Pratt or precedence-climbing parser, or `jsep` with its operator table restricted. Either way it emits the JSON Logic tree; nothing else in the system sees the string.

## Objectives inside conditions

A step's `complete` field accepts an objective (see [01-model.md](01-model.md)) optionally followed by `and <condition>`. The objective contributes the counter; the condition is evaluated on top of it.

```
collect fish.rare 5
collect fish.rare 5 and flag.otter_agreed
talk harbormaster
```

## Evaluation rules

- Conditions are re-evaluated whenever quest state changes or a relevant event arrives. They are pure and cheap.
- A step's `fail` is checked before `complete` when both hold in the same tick.
- `unlock` is only evaluated while the step is `locked`. Once available, an unlock condition turning false does not re-lock it.
- Time is evaluated first. On every entry point (`emit`, `offer`, `accept`, `tick`, `resolve` and state load) the runtime applies expiry, deadlines and cooldowns against its clock before it looks at the event or the question. Nothing else reads a `time.*` value the runtime has not reconciled.
