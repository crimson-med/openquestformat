# Contributing to Open Quest Format

OQF is a format first and a toolchain second. A change that makes the tools nicer but the files
harder to read, diff or reimplement is the wrong trade. Read [docs/00-decisions.md](docs/00-decisions.md)
before changing anything structural: it records what was decided and why, and most questions are
already answered there.

## Running the repo

pnpm workspace, TypeScript strict, ESM only, Node 24.

```
pnpm install
pnpm test          # vitest, from the repo root, every package at once
pnpm typecheck     # tsc --noEmit in every package
pnpm lint          # biome check
pnpm build         # tsup in every package
pnpm editor        # the web editor on the printed Vite port
```

The CLI runs from source:

```
pnpm cli validate packages/examples/quests
pnpm cli convert packages/examples/quests/harbormasters-ledger.oqd --to ink
```

`pnpm cli` needs `pnpm --filter @oqf/core build` once, because tsx resolves the workspace link to
`dist`. Everything else works without a build: packages that depend on `@oqf/core` map it to
`packages/core/src` through tsconfig `paths` and a vitest alias.

All four commands must pass before a pull request is ready. CI runs exactly those.

## Fixtures

`packages/examples/quests/` is the shared truth for every package.

- `harbormasters-ledger.oqf` and `.json` are the reference quest, `.oqd` and `.dialogue.json` its
  conversations. The two forms of each pair describe the identical model.
- `minimal.oqf` and `.json` are the smallest valid document.
- `broken/` holds one defect per file. The leading `#` comment names the finding the validator is
  expected to report.
- `templates/` holds small quests that each isolate one pattern, valid and warning free. The
  editor's New menu loads them.

**Every serializer must reproduce these files byte for byte after normalization.** That is not a
nice-to-have, it is the property that lets two independent implementations agree. A parser change
that alters a single byte of output is a breaking change to the format, not a refactor, and needs a
decision recorded in `docs/00-decisions.md` before it lands.

Adding a fixture means writing the file and adding an entry to `EXAMPLES` in
`packages/examples/src/index.ts`. Use real TAB characters between cells, LF line endings and a
trailing newline. `packages/examples/README.md` has the normalization rules and the column counts.

## Format changes

Compact columns are appended at the end of a record, never reordered and never removed. The frozen
column order is [docs/12-compact-spec.md](docs/12-compact-spec.md) for quests and
[docs/13-dialogue-spec.md](docs/13-dialogue-spec.md) for dialogue. Anything else breaks every file
ever written, and the whole point of the project is that it does not do that.

Extension keys are `x-<namespace>.<key>`. OQF preserves them through every format and never reads
them. If you need the toolchain to understand something, it belongs in the model, not in an
extension.

## Code

- Tests live next to the code as `*.test.ts`.
- Editor logic goes in `packages/editor/src/store` or `src/lib`, with DOM-free tests. Components
  stay thin.
- Biome settings are in `biome.json`: single quotes, no semicolons, two spaces, width 100. Run
  `pnpm format` rather than arguing with it.

## Writing

Never use em-dashes or en-dashes anywhere: code, comments, docs, error messages, commit messages.
Use a comma, a period, a colon or parentheses. If a sentence wants a dash, restructure it.

## Commits

A gitmoji followed by a Conventional Commit header, then an optional body. No attribution trailers.

```
✨ feat(core): add fail objectives to steps
🐛 fix(runtime): skip active steps when an outcome is reached
📝 docs: record decision on reward catalog
```

Common pairs: ✨ feat, 🐛 fix, 📝 docs, ♻️ refactor, ✅ test, 🔧 chore. The scope is the package
name without the `@oqf/` prefix, or omitted for a cross-cutting change.

## Releasing

Maintainers only. Bump every package together, tag, and let the release workflow publish:

```
pnpm version:set 0.2.0    # every package in packages/, all to the same version
pnpm release:dry          # checks, builds, lists every tarball, publishes nothing
```

`version:set` does not touch the root manifest, which is private and never published. Edit its
`version` by hand if you want the two to match. `workspace:*` ranges are rewritten to the real
version as each tarball is packed, so nothing else needs updating.

`pnpm release` publishes from a local machine and needs `NPM_TOKEN` in a gitignored `.env`. See
[.env.example](.env.example) and [scripts/publish.sh](scripts/publish.sh). `@oqf/editor` is private
and is never published.

## License

By contributing you agree that your contribution is licensed under
[Apache License 2.0](LICENSE), the same as the rest of the project.
