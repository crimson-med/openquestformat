# @oqf/editor

The Open Quest Format editor. A graph of steps, a form for every field, live
validation, a dialogue editor, a playtest of the quest and the dialogue, a
strings table, and import and export in every format OQF speaks. Vite, React
and `@xyflow/react`, no other UI dependencies.

## Run it

```
pnpm install
pnpm editor          # from the repo root, or pnpm --filter @oqf/editor dev
```

Open the printed URL and pick a template from "New", or "Load reference quest"
(in the empty canvas and under the More menu) to get the Harbormaster's Ledger
fixture, quest and dialogue both.

## What it does

- **Quest graph.** One node per step, edges from `stepGraph`, dagre auto layout
  top to bottom or left to right; the direction toggle sits on both canvases
  and is remembered in local storage. Positions are written back to each step
  as `x-editor.pos`, so a laid out quest keeps its shape in the file and in
  git. Steps are colored by role (start, step, optional, repeat, ending,
  failed) with a glyph, and show the playtest state when one is running.
- **Dependencies on the canvas.** Dragging from one step's handle to another
  adds `step.<from>` to the target's `unlock`. Deleting the edge removes every
  read of that step from the target's conditions. Hand-written conditions stay
  as they are otherwise: the graph and the inspector edit the same text.
- **Inspector.** Every field of a quest, step, reward, outcome, conversation,
  node and choice. Conditions are edited as infix text, parsed on every
  keystroke for the inline message, and committed on blur or Enter. Condition
  and completion fields offer suggestions from the pack's own vocabulary
  (steps, flags, outcomes, quests, actors, items, locations, conversations,
  events). Objective and condition share one `complete` cell, the same way the
  file writes them. Quests and conversations have a File field for multi-file
  packs.
- **Validation.** `validatePack` and `validateDialogue` run on every change.
  Click a finding to select what it is about.
- **Source.** The live compact text, and the JSON and markdown forms, read only.
- **Play.** A Quest | Dialogue switch. Quest play runs the pack through
  `@oqf/runtime`: one button per step objective fires the event it listens
  for, any other event can be typed in with a payload, flags and game variables
  make up the world the conditions read, and a step board and transcript show
  what the runtime did. Dialogue play drives the built-in provider against a
  flags map you toggle by hand, prints the events it emits, and feeds them to
  the running quest session.
- **Strings.** Every player-facing text in the pack beside its translation in
  a chosen language. Extract literals to keys, inject a language back, import
  and export tables as JSON, CSV, PO or XLIFF, see missing and orphan keys, and
  preview a language on the graphs. Tables live in local storage, not in the
  documents.
- **Dialogue.** A second graph, edges labelled with choice text, with the same
  layout controls as the quest graph.
- **Files.** Open one file, several files or a folder; `.oqf`, `.oqd` and
  either JSON form, the kind read from the magic line, not the extension. A
  pack of files is merged into one document, and each quest and conversation
  remembers its file in `x-editor.file`. Export the whole pack as files (split
  back the way it came in), or the quests as `.oqf`, `.json` or `.md` and the
  dialogue as `.oqd` or `.json`. Work autosaves to local storage.
- **New.** A menu of templates, one per pattern the model supports, plus the
  reference quest.

Shortcuts: undo and redo with cmd or ctrl Z, delete the selected step or node
with Delete, export the quests with cmd or ctrl S, a command palette on cmd or
ctrl K, `n` to add a step or node. Fit view keeps a readable zoom, and the
minimap hides when the canvas is narrow.

## Templates

`packages/examples/quests/templates/` holds the quests behind the New menu:
linear, branching (with dialogue), repeatable, loop, recurring step, parallel,
failure, chain and engine hooks. Each isolates one pattern, is valid and
warning free, and is the same fixture the other packages test against, so a
template never drifts from what the validator accepts.

## Embedding

```tsx
import { QuestEditor } from '@oqf/editor'

<QuestEditor initialQuests={doc} initialDialogues={dialogue} onChange={save} />
```

The store is a plain reducer (`src/store`) with no React in it, so the actions,
selectors and findings are usable on their own. `mergePack` and `splitPack`
are exported too, for hosts that keep a folder of files rather than one
document.
