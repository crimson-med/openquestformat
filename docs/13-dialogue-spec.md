# Dialogue format, v0.1 frozen

The dialogue model lives in `packages/dialogue/src/model.ts`. This document freezes its compact and JSON forms. Dialogue files are separate from quest files in v0.1 (`.oqd` next to `.oqf`); a later minor version may allow both in one file.

## Compact form (`.oqd`)

Same lexical rules as [12-compact-spec.md](12-compact-spec.md): TAB cells, one-character record type, `\\ \t \n \r` escapes, empty cell means absent, trailing empty cells omitted, extra cells preserved under `x-oqf.extra`.

```
OQD1                                            line 1, exactly
#  comment
A  ref  ref  ...                                speakers dictionary, at most one line, before the first C
C  id  actorRef  start  title                   conversation header, starts a conversation
N  id  speakerRef  flags  next  set  emit  text  node, belongs to the current C
O  next  condition  flags  set  emit  text      choice, belongs to the most recent N
X  ns  key  value                               extension on the preceding C, N or O
```

| Cell | Encoding |
|------|----------|
| `actorRef`, `speakerRef` | zero-based index into `A`. Empty for none. |
| `flags` on `N` | `l` lore. |
| `flags` on `O` | `o` once, `d` show disabled (listed but not selectable when the condition is false). Without `d`, a false condition hides the choice. |
| `next` | node id. Empty means end the conversation (on `N`, only when the node has no `O` lines). |
| `condition` | condition infix text per docs/02-conditions.md. |
| `set` | `flag=value;flag=value`. A bare `flag` means `flag=true`. Values typed like payloads: number, `true`/`false`, else string. Escape `;` and `=` with a backslash. |
| `emit` | `event;event`. An event may carry a payload as `event:k=v,k=v`. Escape `;`, `:`, `,` and `=` with a backslash. |
| `text` | player-facing text, literal or `@key`. |

Order rules: `OQD1`, then `A`, then conversations. Within a conversation, `N` lines in authoring order; each `O` line attaches to the `N` above it; `X` attaches to the most recent `C`, `N` or `O`.

Normalization for byte-stable round trips: speakers in first-use order (conversation actor, then node speakers), unreferenced after in original order; nodes in `Conversation.nodes` order; choices in `choices` order; conditions through `formatCondition`; `set` and `emit` in model order; `X` lines sorted by `ns` then `key`; no trailing empty cells; trailing LF.

## JSON form

```
{ "oqd": 1, "speakers": [Ref], "conversations": [Conversation] }
```

Key order follows the declaration order in `model.ts`: Conversation `id, actor, title, start, nodes, ext`; DialogueNode `id, speaker, text, next, choices, set, emit, lore, ext`; Choice `text, next, condition, show, set, emit, once, ext`; FlagSet `flag, value`; EmitSpec `event, payload`. Omit undefined fields, false booleans, empty arrays and empty ext. Refs as `{ "id", "name" }` objects; bare strings accepted on read.

## Runtime behaviour of the built-in provider

- `start(ref)` emits `dialogue.started { actor, node: conversationId }`, then shows `start`.
- Showing a node applies its `set` (emit `flag.set { flag, value }` each) and `emit` in that order, once per visit.
- Choosing applies the choice's `set` and `emit`, emits `dialogue.choice { node, choice }` (choice index), records `once`, then moves to `next` or ends.
- Ending emits `dialogue.ended { actor, node: conversationId, at }`, where `at` is the id of the node the conversation ended on: the node whose picked choice had no `next`, or the linear node with no `next`. The quest runtime's `talk` objective matches on `actor` and `node`, and on `at` as well when the binding is spelled `conversationId#nodeId`.
- Choice conditions are evaluated with the context resolver each time the view is built.

## Example

```
OQD1
A	harbormaster|Harbormaster Ines
C	ines_intro	0	greet	Ines asks for help
N	greet						The ledger is gone. Will you help me find it?
O	lighthouse					Tell me about the old lighthouse.
O	help			met_ines		I will find it.
N	lighthouse		l	greet			It has been dark since the storm of '09.
N	help						Thank you. Ask around the pier first.
```

Cell by cell for the `help` choice: next `help`, condition (empty), flags (empty), set `met_ines`, emit (empty), text. The `greet` node has choices, so its `next` cell is empty.
