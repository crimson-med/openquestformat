# @oqf/editor

The Open Quest Format editor. A graph of steps, a form for every field, live
validation, a dialogue editor, and import and export in every format OQF
speaks. Vite, React and `@xyflow/react`, no other UI dependencies.

## Run it

```
pnpm install
pnpm editor          # from the repo root, or pnpm --filter @oqf/editor dev
```

Open the printed URL and press "Load reference quest" to get the Harbormaster's
Ledger fixture, quest and dialogue both.

## What it does

- **Quest graph.** One node per step, edges from `stepGraph`, dagre auto layout.
  Positions are written back to each step as `x-editor.pos`, so a laid out quest
  keeps its shape in the file and in git. Ending steps are tinted, failures red.
- **Inspector.** Every field of a quest, step, reward, outcome, conversation,
  node and choice. Conditions are edited as infix text and parsed on blur, with
  the parser's message shown inline. Objective and condition share one
  `complete` cell, the same way the file writes them.
- **Validation.** `validatePack` and `validateDialogue` run on every change.
  Click a finding to select what it is about.
- **Source.** The live compact text, and the JSON and markdown forms, read only.
- **Dialogue.** A second graph, edges labelled with choice text, and a Play panel
  that drives the built-in provider against a flags map you toggle by hand and
  prints the events it emits.
- **Files.** Open `.oqf`, `.oqd` and either JSON form; the kind is read from the
  magic line, not the extension. Export quests as `.oqf`, `.json` or `.md` and
  dialogue as `.oqd` or `.json`. Work autosaves to local storage.

Shortcuts: undo and redo with cmd or ctrl Z, delete the selected step or node
with Delete, export the quests with cmd or ctrl S.

## Embedding

```tsx
import { QuestEditor } from '@oqf/editor'

<QuestEditor initialQuests={doc} initialDialogues={dialogue} onChange={save} />
```

The store is a plain reducer (`src/store`) with no React in it, so the actions,
selectors and findings are usable on their own.
