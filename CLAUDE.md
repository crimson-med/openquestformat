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
pnpm cli validate packages/examples/quests/harbormasters-ledger.oqf
```
