/**
 * The command palette's model: a flat list of commands and a matcher over it.
 *
 * Matching is forgiving on purpose. A query that appears verbatim in a title
 * or keyword ranks first; one whose letters appear in order, with gaps, still
 * matches but ranks after. Within a rank the original order is kept, so the
 * caller decides which commands come first.
 */

export interface Command {
  id: string
  title: string
  /** Header the palette shows above a run of commands sharing it. */
  group: string
  keywords?: string[]
  /** Hint shown beside the title, for commands that also have a key. */
  shortcut?: string
  run: () => void
}

/** How many rows the palette shows at most. */
export const MAX_RESULTS = 40

/** True when every character of `query` appears in `text`, in order. */
function isSubsequence(query: string, text: string): boolean {
  let at = 0
  for (const char of text) {
    if (char === query[at]) at += 1
    if (at === query.length) return true
  }
  return at === query.length
}

/** 0 for a substring hit, 1 for a subsequence hit, undefined for no match. */
function rank(command: Command, query: string): number | undefined {
  const fields = [command.title, ...(command.keywords ?? [])].map((field) => field.toLowerCase())
  if (fields.some((field) => field.includes(query))) return 0
  if (fields.some((field) => isSubsequence(query, field))) return 1
  return undefined
}

/**
 * The commands matching `query`, best first, at most `MAX_RESULTS`. An empty
 * query returns the head of the list unchanged.
 */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return commands.slice(0, MAX_RESULTS)
  const ranked: { command: Command; rank: number }[] = []
  for (const command of commands) {
    const score = rank(command, needle)
    if (score !== undefined) ranked.push({ command, rank: score })
  }
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.command)
}
