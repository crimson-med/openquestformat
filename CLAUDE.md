# Open Quest Format: agent guide

OQF is an open, engine-neutral quest format: a spec, a canonical TypeScript model, parsers and serializers, a validator, a runtime, a CLI and an editor. Read `docs/README.md` for the plan and `docs/00-decisions.md` for why things are the way they are before changing anything structural.

## Layout

| Package | Role |
|---------|------|
| `@oqf/core` | Canonical model (`src/model.ts`), condition language, compact (`.oqf`) and JSON formats, markdown export, JSON Schema, validator. No I/O, no dependencies. |
| `@oqf/dialogue` | Dialogue model (`.oqd`), bridge interface, built-in provider, Ink and Yarn Spinner export and import. |
| `@oqf/runtime` | Engine-agnostic state machine: events in, quest state and events out. Runs in browsers and Node. |
| `@oqf/i18n` | Extract inline strings to a table and inject them back. |
| `@oqf/cli` | `oqf validate`, `convert`, `import`, `graph`, `schema`, `extract`, `inject`. |
| `@oqf/editor` | Web editor, Vite and React. |
| `@oqf/examples` | Reference quest fixtures used by every package's tests. |

Every package converts to or from the model in `core`, never around it.

## State

Core, dialogue (with Ink and Yarn Spinner interop), runtime, i18n, CLI and editor are built and tested. Not started: engine exporters (Godot, Unity, Unreal), MCP server, tabletop. Not yet integrated into a shipping game; Cozy Coast (`~/Personal/taskbar-fishing`, Phaser 4 + Electron) is the first target. Open design items live at the bottom of `docs/00-decisions.md`.

## Fixtures

`packages/examples/quests/` holds the Harbormaster's Ledger in every form: `harbormasters-ledger.oqf` and `.json` (quest), `.oqd` and `.dialogue.json` (dialogue), `minimal.oqf` and `.json`, and `broken/` (one defect per file, leading comment names the expected finding). The `.oqf`/`.json` and `.oqd`/`.dialogue.json` pairs describe identical models and must stay byte-stable through every serializer. `packages/runtime/src/integration.test.ts` drives the quest through the dialogue provider on every route; if a model change breaks a route, that test says where. `templates/` holds small quests that each isolate one pattern (linear, branching, repeatable, loop, recurring-step, parallel, failure, chain, engine-hooks), valid and warning free, as `.oqf` and `.json` pairs, with `.oqd` and `.dialogue.json` for every template that has a talk step (all but `engine-hooks`); the editor's New menu loads them.

## Conventions

- pnpm workspace, TypeScript strict, ESM only, Node 24. Build with tsup, test with vitest from the repo root, lint and format with Biome (single quotes, no semicolons, 2 spaces, width 100).
- Tests live next to the code as `*.test.ts`. Fixtures live in `packages/examples/quests`. Every serializer must reproduce the fixtures byte for byte after normalization.
- Packages that depend on `@oqf/core` map it to `packages/core/src` through tsconfig `paths` and a vitest alias, so tests and typecheck run without a build. `pnpm cli` needs `pnpm --filter @oqf/core build` once because tsx resolves the workspace link to `dist`.
- Compact-format columns are appended at the end of a record, never reordered or removed. See `docs/12-compact-spec.md`.
- Extension keys are `x-<namespace>.<key>`. OQF code preserves them and never reads them.
- Never use em-dashes or en-dashes anywhere: code, comments, docs, error messages, commit messages. Use a comma, a period, a colon or parentheses.

## Commits

Gitmoji followed by a Conventional Commit header, then an optional body. No attribution trailers.

```
✨ feat(core): add fail objectives to steps
🐛 fix(runtime): skip active steps when an outcome is reached
📝 docs: record decision on reward catalog
```

Common pairs: ✨ feat, 🐛 fix, 📝 docs, ♻️ refactor, ✅ test, 🔧 chore, 🎉 initial. Scope is the package name without the `@oqf/` prefix, or omitted for cross-cutting changes.

## Commands

```
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm cli validate packages/examples/quests
pnpm cli convert packages/examples/quests/harbormasters-ledger.oqd --to ink
pnpm editor
```

## Editor

`pnpm editor` starts Vite on the printed port (the `.claude/launch.json` entry `editor` pins 5179 for the browser tools). Load a quest from the New menu (templates and the reference quest) or "Open" one or more `.oqf`, `.json` or `.oqd` files; several files merge into one document. The editor depends on `@oqf/core`, `@oqf/dialogue`, `@oqf/runtime` and `@oqf/i18n`, all mapped to their `src` through tsconfig `paths` and vite aliases. The store is pure TypeScript under `packages/editor/src/store` with DOM-free tests; keep new editor logic there (or in `src/lib`) and leave components thin. The toolbar switches between four views (Quests, Dialogue, Strings, Dictionaries); the drawer holds Validation and Source; Play is a mode that replaces the inspector with the quest playtest or the conversation player, depending on the view. Playtest and strings state live in React contexts (`PlaytestContext`, `StringsContext`), not in the store, so they are never part of the document or the undo stack; language tables persist in local storage beside the autosave, a playtest session is discarded on any edit. Step positions persist in step ext `x-editor.pos`; `x-editor.file` tags the source file of a quest or conversation in a multi-file pack and is stripped on export.
