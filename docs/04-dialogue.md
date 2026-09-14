# Dialogue

Dialogue is a sibling model, not part of the quest model. A quest binds to a dialogue node by reference and observes what the dialogue sets. This keeps the quest spec small and lets any dialogue system plug in.

## The bridge

Any dialogue provider implements one interface. Names are provisional.

```
start(ref)            begin the conversation at node ref
   -> emits           flag.set { flag, value }
   -> emits           dialogue.choice { node, choice }
   -> emits           <custom events the dialogue declares>
   -> emits           dialogue.ended { actor, node }
```

That is everything a quest needs: a node to start, flags set along the way, events fired, and the moment it ended. The quest does not see lines, speakers or choices.

## Binding from a step

```
dialogue:
  provider: oqf | ink | yarn | <custom>
  ref:      node id in that provider's terms
```

A step with a `talk` objective and a dialogue binding completes on `dialogue.ended` for that node. A step without a `talk` objective can still bind a dialogue for tooling, so the editor can jump between the two.

## oqf-dialogue model

The dialogue OQF ships. Small on purpose.

| Entity | Fields |
|--------|--------|
| conversation | `id`, `actor` (default speaker), `start` (node id), `nodes`, `ext` |
| node | `id`, `speaker` (actor ref, optional), `text`, `next` (node id, optional), `choices` (list), `set` (flags), `emit` (events), `lore` (boolean), `ext` |
| choice | `text`, `next` (node id), `condition`, `set`, `emit`, `once` (boolean), `ext` |

Rules:

- A node with `choices` ignores `next`. A node with neither ends the conversation.
- `condition` on a choice uses the same condition language as quests. Hidden choices are omitted, not disabled, unless the choice sets `show: disabled`.
- `set` is a list of `flag = value`. `emit` is a list of event names with optional flat payloads.
- `lore: true` on a node declares that the subtree from it has no `set` and no `emit`. The validator checks this. It is how "learn more about the quest" branches are marked as safe, and how tooling can hide them when showing only quest-affecting paths.
- `once` on a choice hides it after it has been picked in this save.

Text fields follow [07-i18n.md](07-i18n.md).

## Ink and Yarn Spinner

Export from oqf-dialogue is lossless. Our model is a strict subset of both.

| oqf-dialogue | Ink | Yarn Spinner |
|--------------|-----|--------------|
| conversation | knot | node group (tagged) |
| node | stitch | node |
| `text` | line | line |
| `speaker` | tag `# speaker:` | `Speaker:` prefix |
| `next` | divert `->` | `<<jump>>` |
| `choices` | `*` / `+` choices | `->` options |
| `once` | `*` (once) vs `+` (sticky) | `<<once>>` block |
| `condition` | `{ cond }` guard | `<<if>>` guard |
| `set` | `~ var = value` | `<<set $var to value>>` |
| `emit` | external function call | `<<command>>` |
| `lore` | tag `# lore` | tag `#lore` |
| end | `-> END` | `<<stop>>` |

Import is best effort. Constructs with no home (Ink tunnels, threads, inline logic, weave gathers beyond simple joins; Yarn custom functions, shadow nodes) are dropped with a warning that names the node and the construct. The importer never silently loses content: it either maps it, warns, or refuses the file.

Running Ink or Yarn at runtime is the game's business. The bridge for each is a thin adapter: an Ink provider wraps `inkjs` and translates variable observers into `flag.set`; a Yarn provider wraps a Yarn runtime and translates commands into events. Both live in `@oqf/dialogue` behind optional peer dependencies.
