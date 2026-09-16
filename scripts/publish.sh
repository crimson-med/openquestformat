#!/usr/bin/env bash
#
# Publish every public @oqf package to npm, without an OTP prompt.
#
#   pnpm release        full run, needs NPM_TOKEN
#   pnpm release:dry    everything up to the tarball listing, publishes nothing
#
# The token is a fine grained npm automation token. Automation tokens bypass
# two factor authentication, so nothing here ever waits for a one time password.
# It is read from the environment, or from a gitignored .env in the repo root.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Publish order. Dependencies first, so a fresh install of a later package can
# always resolve the one before it. pnpm sorts recursive commands topologically
# on its own; this list is what the per package tarball check walks, and it
# documents the order for a human reading the script.
PACKAGES=(core dialogue runtime i18n examples cli editor)

REGISTRY="//registry.npmjs.org/"
NPMRC="$ROOT/.npmrc"

DRY_RUN=0
FORCE=0

usage() {
  cat <<'USAGE'
Usage: bash scripts/publish.sh [--dry-run] [--force]

  --dry-run  Run every check and build, then list what each tarball would
             contain with `npm pack --dry-run`. Nothing is published and no
             token is needed.
  --force    Skip the clean tree and main branch guards. Ignored by --dry-run,
             which never touches the registry and so is never guarded.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "publish: unknown argument '$arg'" >&2
      usage >&2
      exit 2
      ;;
  esac
done

say() { printf '\n==> %s\n' "$1"; }

# Load the local .env if there is one. `set -a` exports everything it defines,
# which is how NPM_TOKEN reaches npm below.
if [ -f "$ROOT/.env" ]; then
  say "loading .env"
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

if [ "$DRY_RUN" -eq 0 ]; then
  if [ -z "${NPM_TOKEN:-}" ]; then
    cat >&2 <<'MISSING'
publish: NPM_TOKEN is not set.

Create a fine grained automation token at https://www.npmjs.com/settings/~/tokens
with read and write access to the @oqf scope, then put it in a local .env:

    cp .env.example .env
    # edit .env and paste the token after NPM_TOKEN=

.env is gitignored. Never commit a token.
MISSING
    exit 1
  fi

  if [ "$FORCE" -eq 0 ]; then
    branch="$(git rev-parse --abbrev-ref HEAD)"
    if [ "$branch" != "main" ]; then
      echo "publish: on branch '$branch', expected 'main'. Pass --force to override." >&2
      exit 1
    fi
    if [ -n "$(git status --porcelain)" ]; then
      echo "publish: the working tree is dirty. Commit or stash first, or pass --force." >&2
      exit 1
    fi
  fi
fi

say "install"
pnpm install --frozen-lockfile

say "lint"
pnpm lint

say "typecheck"
pnpm typecheck

say "test"
pnpm test

say "build"
pnpm -r build

if [ "$DRY_RUN" -eq 1 ]; then
  for name in "${PACKAGES[@]}"; do
    say "pack --dry-run: @oqf/$name"
    (cd "$ROOT/packages/$name" && npm pack --dry-run)
  done
  say "dry run complete, nothing was published"
  exit 0
fi

# Auth without touching the user's global npm config.
#
# A repo local .npmrc is used rather than an environment variable because the
# npm config key is literally `//registry.npmjs.org/:_authToken`, and a shell
# cannot assign to a variable whose name holds slashes and a colon without an
# `env` prefix on every single command. pnpm 10 reads the project .npmrc, so
# one temporary file covers `pnpm -r publish` and every package under it. The
# file is written with owner only permissions and removed on any exit path.
if [ -e "$NPMRC" ]; then
  echo "publish: $NPMRC already exists. Move it aside; this script owns that path." >&2
  exit 1
fi

cleanup() {
  rm -f "$NPMRC"
}
trap cleanup EXIT INT TERM

(
  umask 077
  printf '%s:_authToken=%s\n' "$REGISTRY" "$NPM_TOKEN" >"$NPMRC"
)

say "publish"
# Every package here is public, the editor included. pnpm rewrites every
# `workspace:*` range to the real version as it packs, and orders the workspace
# topologically. `--no-git-checks` is safe here: the branch and clean
# tree guards above already ran.
pnpm -r publish --access public --no-git-checks

say "published"
