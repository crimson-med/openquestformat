# @oqf/editor

The Open Quest Format editor. A graph of steps, a form for every field, live
validation, a dialogue editor, a playtest of the quest and the dialogue, a
strings table, and import and export in every format OQF speaks. Vite, React
and `@xyflow/react`, no other UI dependencies.

## Run it

```
npx @oqf/editor
```

A local static server over the built editor, no install and no configuration.
It prints the URL; everything runs in the browser, and the editor reads and
writes files through the browser's file picker.

| Flag | What it does |
|------|--------------|
| `--port <n>` | Port to listen on, default 4600. If it is busy the next ten ports are tried. |
| `--host <h>` | Address to bind, default `127.0.0.1`. Pass `0.0.0.0` to reach it from another machine. |
| `--open` | Open the URL in the default browser. |
| `--help` | Print the usage text. |
| `--version` | Print the package version. |

`dist/app` in the package is that same build as plain files, so any static host
serves it as it is. The site uses relative asset paths and works from any path
under a domain.

## Embed it

```
npm install @oqf/editor react react-dom
```

`react` and `react-dom` are peer dependencies (`>=18`); the host app provides
them, and `@oqf/core`, `@oqf/dialogue`, `@oqf/i18n` and `@oqf/runtime` are
external too, so the host and the editor share one copy of the model.

```tsx
import { QuestEditor } from '@oqf/editor'
import '@oqf/editor/styles.css'

export function Editor({ quests }: { quests: OqfDocument }) {
  return <QuestEditor initialQuests={quests} onChange={(next) => save(next.quests)} />
}
```

The stylesheet is a separate entry point, so importing it is the host's choice.
Autosave is on unless documents are passed in: a host that owns the documents
should own persistence too. The store is a plain reducer (`src/store`) with no
React in it, so the actions, selectors and findings are usable on their own,
and `mergePack` and `splitPack` are exported for hosts that keep a folder of
files rather than one document.

## Develop it

```
pnpm install
pnpm editor          # from the repo root, or pnpm --filter @oqf/editor dev
```

Open the printed URL. The empty canvas is the onboarding screen: start from a
template, open a file, or begin a blank quest. The "New" menu holds the same
templates, the last of them the Harbormaster's Ledger fixture, quest and
dialogue both. The `?` button (and Help under the More menu) opens a summary
of the views, the graph legend and the shortcuts.

`pnpm --filter @oqf/editor build` writes both builds: `dist/lib` for the
library entry (Vite library mode, declarations from `tsconfig.lib.json`) and
`dist/app` for the static site. The library build needs the sibling packages
built first, which `pnpm -r build` does in order.

## What it does

- **Toolbar.** The brand, the four view pills, Play, and the file actions (New,
  Open, Export) with the More menu at the end. It holds together down to 720px
  without wrapping or scrolling sideways: the header drops one group at a time
  as the window narrows, least important first, and the More menu picks up the
  same commands, so the view pills, Play, New, Open and Export stay on the bar
  at every width. Unsaved work shows as a pill beside the brand, and as a dot on
  the OQF mark once the bar is too narrow for the pill.
- **Quest graph.** One node per step, edges from `stepGraph`, dagre auto layout
  top to bottom or left to right. The bar above each canvas holds Add, Auto
  layout, the direction toggle (remembered in local storage), the quest or
  conversation picker and a legend of the role colors. Positions are written back to each step
  as `x-editor.pos`, so a laid out quest keeps its shape in the file and in
  git. Steps are colored by role (start, step, optional, repeat, ending,
  failed) with a glyph, and show the playtest state when one is running.
- **Dependencies on the canvas.** Dragging from one step's handle to another
  opens a small popover to pick the field (unlock, activate, complete, fail)
  and the state the target waits for (done, failed, active, available,
  skipped), then writes that read into the target's condition. Edges are
  labelled and styled by field, clicking one edits or removes it, and deleting
  it removes every read of that step from the target's conditions.
  Hand-written conditions stay as they are otherwise: the graph and the
  inspector edit the same text.
- **Inspector.** Every field of a quest, step, reward, outcome, conversation,
  node and choice. Conditions are edited as infix text, parsed on every
  keystroke for the inline message, and committed on blur or Enter. Condition
  and completion fields offer suggestions from the pack's own vocabulary
  (steps, flags, outcomes, quests, actors, items, locations, conversations,
  events). Objective and condition share one `complete` cell, the same way the
  file writes them. Quests and conversations have a File field for multi-file
  packs.
- **Validation.** `validatePack` and `validateDialogue` run on every change.
  The drawer's Validation tab carries the count, red for errors and amber for
  warnings, and a closed drawer shows a red dot while there are errors.
  Click a finding to select what it is about. Most findings carry one-click
  fixes (mark repeat, add an outcome, add a missing dictionary entry or reward,
  remove a dangling reference, bind a conversation), each a single undo step.
  The Strict switch beside the tabs runs both validators in strict mode: it adds
  the checks that only mean something once the whole pack is loaded (flags no
  reward sets, unknown extension namespaces, mixed keyed and literal text,
  unbound conversations) and turns an unreachable ending into an error. A line
  above the list says how many of the findings came from strict, so the jump in
  the count is never a mystery. The choice is remembered in local storage beside
  the layout direction; it changes no document, so it neither dirties the pack
  nor pushes an undo entry.
- **Source.** The live compact text, and the JSON and markdown forms, read only.
- **Play.** A mode, entered from the toolbar's Play button or cmd or ctrl P,
  that replaces the inspector while the graph stays live: the quest playtest
  on the Quests view, the conversation player on the Dialogue view. The
  quest playtest runs the pack through `@oqf/runtime`. Next lists only the events
  that can move the quest right now, one button per objective of an active
  step, with the rest under Other events beside a free-form event form. World
  holds the flags and game variables the conditions read. Timeline groups what
  the runtime did under the event that caused it, with a chip per step that
  has moved, and the graph shows the same states on the nodes. A step with a
  bound conversation gets a Talk button that plays it inline against the
  running quest, so ending the talk completes the right step. On the Dialogue
  view, Play runs the current conversation against a flags map you toggle by
  hand and lists the events it emits.
- **Strings.** A top-level view, next to Quests and Dialogue: every
  player-facing text in the pack beside its translation in a chosen language. Extract literals to keys, inject a language back, import
  and export tables as JSON, CSV, PO or XLIFF, see missing and orphan keys, and
  preview a language on the graphs. Tables live in local storage, not in the
  documents.
- **Dictionaries.** A top-level view for actors, locations, items, tags and
  speakers: add, rename and remove entries, see where each is used and jump
  there. A rename rewrites every usage, and an entry in use cannot be removed.
  Typing an unknown actor, item or location in a completion field offers to
  create it, and the pickers in the inspector link here with Manage.
- **Dialogue.** A second graph, edges labelled with choice text, with the same
  layout controls as the quest graph.
- **Files.** Open one file or several at once; `.oqf`, `.oqd` and either JSON
  form, the kind read from the magic line, not the extension. A pack of files
  is merged into one document, and each quest and conversation remembers its
  file in `x-editor.file`. Export the whole pack as files (split back the way
  it came in), or the quests as `.oqf`, `.json` or `.md` and the dialogue as
  `.oqd` or `.json`. Work autosaves to local storage. Reset, under the More
  menu, asks before it clears the editor.
- **New.** A menu of templates, one per pattern the model supports, plus the
  reference quest.

Shortcuts: undo and redo with cmd or ctrl Z, delete the selected step or node
with Delete, export the quests with cmd or ctrl S, a command palette on cmd or
ctrl K, play or stop playing with cmd or ctrl P, `n` to add a step or node,
Escape to close a menu or a dialog. Fit view keeps a readable zoom, and the
minimap and the legend hide when the canvas is narrow.

## Templates

`packages/examples/quests/templates/` holds the quests behind the New menu:
linear, branching, repeatable, loop, recurring step, parallel, failure, chain
and engine hooks. Each isolates one pattern, is valid and warning free, ships
dialogue for its talk steps (engine hooks has none), and is the same fixture
the other packages test against, so a template never drifts from what the
validator accepts.

## Props

`QuestEditor` takes `initialQuests`, `initialDialogues`, `onChange`, `persist`
(autosave, defaulting to off once documents are passed in) and `storage` (where
autosave writes, defaulting to `window.localStorage`). All of them are
optional: mounted bare, the editor owns its own document and its own autosave,
which is what the app entry point and `npx @oqf/editor` do.
