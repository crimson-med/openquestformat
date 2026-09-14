# Yarn Spinner interop

`@oqf/dialogue` exports and imports Yarn Spinner source text. It does not ship a
Yarn runtime provider, and that is deliberate.

## Why there is no `YarnProvider`

Yarn Spinner's runtime is a C# library. The engine integrations (Unity, Godot,
Unreal, the standalone C# package) own the virtual machine, the variable
storage and the command dispatcher. There is no maintained JavaScript Yarn
runtime with a stable API to wrap, so a provider in this package would either be
a shim around something that does not exist, or a second half finished Yarn
implementation. Either one would be worse than nothing: the quest runtime would
appear to support Yarn while the real dialogue ran somewhere else.

So the split is: OQF owns the file format, the engine owns the runtime, and the
host writes roughly thirty lines of glue. The glue is the same shape as
`ink/adapter.ts`, which you can read as a worked example.

## What the host has to translate

The quest runtime needs four things from a conversation. Everything else stays
inside Yarn.

| Yarn side | Bridge event | Payload |
|-----------|--------------|---------|
| the conversation starts | `dialogue.started` | `{ actor, node: <conversation id> }` |
| `<<set $flag__name to value>>` | `flag.set` | `{ flag, value }` |
| `<<oqf_emit "event" "k=v,k=v">>` | the event itself | the decoded payload |
| the player picks an option | `dialogue.choice` | `{ node, choice }` (the option index) |
| the conversation stops | `dialogue.ended` | `{ actor, node: <conversation id> }` |

`actor` is the `oqf_actor:` header on the node tagged `oqf_start`, and the
conversation id is the `oqf_conversation=` tag every node of the group carries.

### Variables

`toYarn` writes OQF variable paths as Yarn variables with the dots replaced:
`flag.met_ines` is `$flag__met_ines`, `count.trade` is `$count__trade`,
`step.harbor#deliver` is `$step__harbor_s_deliver`. The full rule, including the
`-` and literal `_` cases, is in `../ink/naming.ts`.

Two directions to wire:

- **Out.** Watch the Yarn variable storage for changes to `$flag__*` and turn
  each into `flag.set { flag, value }`. In Unity this is a custom
  `VariableStorageBehaviour` that forwards its setter. Only `flag.*` belongs to
  the dialogue, so forward nothing else.
- **In.** `count.*`, `step.*`, `outcome.*`, `quest.*` and `var.*` are owned by
  the quest runtime. Before a conversation starts, and whenever the runtime
  state changes during one, push the current value into the matching Yarn
  variable. A node that reads `$count__trade` without that mirror reads zero and
  the option guard silently fails.

### Commands

Register one command, `oqf_emit`, taking two strings:

```
<<oqf_emit "quest.offered" "id=ledger,tier=2">>
```

The second argument is the flat payload: `k=v` pairs joined by commas, with
`\`, `,` and `=` backslash escaped inside a key or a value, and a value typed as
a number when it looks like one, as a boolean for `true` and `false`, and as a
string otherwise. `decodePayload` in `../ink/naming.ts` is the reference
implementation; it is about twenty lines to port.

`<<oqf_ext "...">>` carries OQF extension data on an option. It is metadata for
tooling, it never affects play, and a host that does not care can register it as
a no-op.

### Options

`fromYarn` and `toYarn` map an OQF choice to a Yarn option:

- the option text is the choice text
- `<<if cond>>` on the option line is the choice condition
- `#oqf_disabled` means the choice stays listed but unselectable when the
  condition is false; without it a false condition hides the choice
- `<<once>>` ... `<<endonce>>` around an option is `once: true`, so the option
  disappears after it has been taken in this save

Yarn already reports an option's availability to the game, so `#oqf_disabled` is
the flag that tells the UI to grey the option out instead of hiding it.

### Conditions

Conditions render with `and`, `or`, `not`, `==`, `!=`, `<`, `<=`, `>` and `>=`,
which Yarn evaluates as they stand. One operator has no Yarn spelling: OQF `in`
renders as `$var__season in ["spring", "summer"]`. Yarn has no inline list, so a
host that wants to run an exported file unchanged should expand that into
`$var__season == "spring" or $var__season == "summer"`. `fromYarn` reads both
spellings, but only the `in` form round trips back to `in`.

## Round tripping

`fromYarn(toYarn(doc))` reproduces `doc` with no warnings. Four spellings the
model allows are canonicalized, because Yarn cannot tell them from the default:
`value: true` on a `set` comes back as an omitted value, and `show: 'hidden'`,
`once: false`, `lore: false` and empty arrays come back as absent.

A conversation with no nodes has nothing to write and is dropped, since a Yarn
file is a list of nodes and nothing else.
