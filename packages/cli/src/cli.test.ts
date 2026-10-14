import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDialogueJson, parseOqd } from '@oqf/dialogue'
import { describe, expect, it } from 'vitest'
import { run } from './cli.js'
import type { FileFinding } from './format.js'
import type { Io } from './load.js'

const QUESTS = fileURLToPath(new URL('../../examples/quests/', import.meta.url))
const HARBOR_OQF = `${QUESTS}harbormasters-ledger.oqf`
const HARBOR_OQD = `${QUESTS}harbormasters-ledger.oqd`
const BROKEN = `${QUESTS}broken`
const MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url))

/**
 * An io that records what the CLI writes and serves written files back, so a
 * convert round trip never touches the real filesystem.
 */
function createIo() {
  const out: string[] = []
  const err: string[] = []
  const written = new Map<string, string>()

  const io: Io = {
    stdout: (text) => {
      out.push(text)
    },
    stderr: (text) => {
      err.push(text)
    },
    readFile: (path) => written.get(path) ?? readFileSync(path, 'utf8'),
    writeFile: (path, text) => {
      written.set(path, text)
    },
    readDir: (path) => readdirSync(path),
    stat: (path) => ({ isDirectory: statSync(path).isDirectory() }),
  }

  return {
    io,
    written,
    get out() {
      return out.join('')
    },
    get err() {
      return err.join('')
    },
  }
}

/** An io that really touches the disk, for the commands that rewrite sources. */
function createDiskIo() {
  const out: string[] = []
  const err: string[] = []

  const io: Io = {
    stdout: (text) => {
      out.push(text)
    },
    stderr: (text) => {
      err.push(text)
    },
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, text) => {
      writeFileSync(path, text)
    },
    readDir: (path) => readdirSync(path),
    stat: (path) => ({ isDirectory: statSync(path).isDirectory() }),
  }

  return {
    io,
    get out() {
      return out.join('')
    },
    get err() {
      return err.join('')
    },
  }
}

/**
 * Run a body against copies of the fixtures in a fresh temporary directory.
 * packages/examples is owned elsewhere and is never written to.
 */
async function withCopies(
  names: string[],
  body: (directory: string, copies: string[]) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'oqf-cli-'))
  try {
    const copies = names.map((name) => {
      const copy = join(directory, name)
      copyFileSync(`${QUESTS}${name}`, copy)
      return copy
    })
    await body(directory, copies)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** The same, for files written from scratch rather than copied from the fixtures. */
async function withFiles(
  files: Record<string, string>,
  body: (directory: string, paths: string[]) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'oqf-cli-'))
  try {
    const paths = Object.entries(files).map(([name, text]) => {
      const path = join(directory, name)
      writeFileSync(path, text)
      return path
    })
    await body(directory, paths)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

interface Report {
  findings: FileFinding[]
  ok: boolean
}

describe('validate', () => {
  it('accepts the reference quest', async () => {
    const capture = createIo()
    const code = await run(['validate', HARBOR_OQF], capture.io)
    expect(code).toBe(0)
    expect(capture.out.trimEnd()).toBe('0 errors, 0 warnings')
  })

  it('accepts the reference quest in its JSON form', async () => {
    const capture = createIo()
    const code = await run(['validate', `${QUESTS}harbormasters-ledger.json`], capture.io)
    expect(code).toBe(0)
  })

  it('accepts the reference quest in strict mode', async () => {
    const capture = createIo()
    expect(await run(['validate', HARBOR_OQF, '--strict'], capture.io)).toBe(0)
  })

  it('accepts the whole examples directory, quests and dialogue together', async () => {
    const capture = createIo()
    const code = await run(['validate', QUESTS], capture.io)
    expect(code).toBe(0)
    expect(capture.out.trimEnd()).toBe('0 errors, 0 warnings')
  })

  it('leaves the broken subdirectory out, because expansion does not recurse', async () => {
    const capture = createIo()
    await run(['validate', QUESTS, '--json'], capture.io)
    const report = JSON.parse(capture.out) as Report
    expect(report.findings).toEqual([])
    // The fixtures that would have failed are one level down and never read.
    expect(readdirSync(BROKEN).length).toBeGreaterThan(0)
    const nested = createIo()
    expect(await run(['validate', BROKEN], nested.io)).toBe(1)
  })

  it('reports a dialogue parse error the way it reports a quest one', async () => {
    await withFiles({ 'torn.oqd': 'nope\n' }, async (_directory, [path]) => {
      const capture = createDiskIo()
      expect(await run(['validate', path, '--json'], capture.io)).toBe(1)
      const report = JSON.parse(capture.out) as Report
      expect(report.findings).toHaveLength(1)
      expect(report.findings[0].code).toBe('parse-error')
      expect(report.findings[0].file).toBe(path)
      expect(report.findings[0].path).toBe('line 1')
    })
  })

  it('reports what the dialogue validator finds, in a sniffed JSON file', async () => {
    const dialogue = JSON.stringify({
      oqd: 1,
      speakers: [],
      conversations: [
        { id: 'talk', start: 'start', nodes: [{ id: 'start', text: 'Hello', next: 'nowhere' }] },
      ],
    })
    await withFiles({ 'dangling.json': dialogue }, async (_directory, [path]) => {
      const capture = createDiskIo()
      expect(await run(['validate', path, '--json'], capture.io)).toBe(1)
      const report = JSON.parse(capture.out) as Report
      expect(report.findings.map((finding) => finding.code)).toContain('unknown-next')
      expect(report.findings.every((finding) => finding.file === path)).toBe(true)
    })
  })

  it('does not ask for dialogue a quest only pack was never given', async () => {
    const capture = createIo()
    // The reference quest binds six conversations. On its own that is silence,
    // not six warnings about conversations the CLI was never shown.
    expect(await run(['validate', HARBOR_OQF, '--json'], capture.io)).toBe(0)
    const report = JSON.parse(capture.out) as Report
    expect(report.findings).toEqual([])
  })

  it('cross checks a quest against the dialogue it binds', async () => {
    const capture = createIo()
    const code = await run(['validate', HARBOR_OQF, HARBOR_OQD, '--json'], capture.io)
    expect(code).toBe(0)
    const report = JSON.parse(capture.out) as Report
    expect(report.findings).toEqual([])
  })

  it('reports one line per finding and a summary', async () => {
    const capture = createIo()
    await run(['validate', `${BROKEN}/outcome-with-dependents.oqf`], capture.io)
    const lines = capture.out.trimEnd().split('\n')
    expect(lines[0]).toContain(
      'outcome-with-dependents.oqf: error outcome-with-dependents: ending "return_ledger"',
    )
    expect(lines[0]).toContain('(quest outcome_with_dependents, step return_ledger)')
    // Errors come before warnings.
    expect(lines[1]).toContain('warning dead-end')
    expect(lines[2]).toBe('1 errors, 1 warnings')
  })

  it('prints findings and ok with --json', async () => {
    const capture = createIo()
    const code = await run(['validate', `${QUESTS}minimal.oqf`, '--json'], capture.io)
    expect(code).toBe(0)
    const report = JSON.parse(capture.out) as Report
    expect(report.ok).toBe(true)
    expect(report.findings).toEqual([])
  })
})

/**
 * The code each broken fixture's leading comment claims, and the code the
 * toolchain actually raises when the two differ. Mismatches are recorded here,
 * never fixed in the fixture: packages/examples is owned elsewhere.
 */
const BROKEN_FIXTURES: Array<{ file: string; expected: string; actual?: string }> = [
  // The comment describes a malformed condition, which the compact parser
  // rejects before the validator ever sees the document.
  { file: 'bad-condition-syntax.oqf', expected: 'condition-invalid', actual: 'parse-error' },
  { file: 'cooldown-without-repeat.oqf', expected: 'cooldown-without-repeat' },
  { file: 'cycle-without-repeat.oqf', expected: 'cycle-without-repeat' },
  { file: 'deadline-after-expire.oqf', expected: 'deadline-after-expire' },
  { file: 'dictionary-index-out-of-range.oqf', expected: 'parse-error' },
  { file: 'duplicate-param-name.oqf', expected: 'duplicate-param-name' },
  { file: 'duplicate-step-id.oqf', expected: 'duplicate-step-id' },
  { file: 'duration-invalid.oqf', expected: 'duration-invalid' },
  // The comment describes a non-namespaced extension key, which the compact
  // parser rejects before the validator's ext-key-invalid check can run.
  { file: 'ext-without-namespace.oqf', expected: 'ext-key-invalid', actual: 'parse-error' },
  { file: 'outcome-reserved.oqf', expected: 'outcome-reserved' },
  { file: 'outcome-with-dependents.oqf', expected: 'outcome-with-dependents' },
  { file: 'param-type-mismatch.oqf', expected: 'param-type-mismatch' },
  { file: 'streak-without-calendar-cooldown.oqf', expected: 'streak-without-calendar-cooldown' },
  { file: 'time-not-number.oqf', expected: 'time-not-number' },
  { file: 'unknown-objective-kind.oqf', expected: 'parse-error' },
  { file: 'unknown-param-ref.oqf', expected: 'unknown-param-ref' },
  // The comment describes an unknown reward reference. In the compact form a
  // reward reference is an index, so an out of range one is a parse error.
  { file: 'unknown-reward-ref.oqf', expected: 'unknown-reward-ref', actual: 'parse-error' },
  { file: 'unreachable-step.oqf', expected: 'unreachable-step' },
  { file: 'unused-param.oqf', expected: 'unused-param' },
  { file: 'wrong-magic.oqf', expected: 'parse-error' },
]

describe('validate on the broken directory', () => {
  it('exits 1', async () => {
    const capture = createIo()
    expect(await run(['validate', BROKEN], capture.io)).toBe(1)
  })

  it('covers every broken fixture', () => {
    const files = readdirSync(BROKEN)
      .filter((name) => name.endsWith('.oqf'))
      .sort()
    expect(files).toEqual(BROKEN_FIXTURES.map((entry) => entry.file))
  })

  for (const entry of BROKEN_FIXTURES) {
    it(`raises ${entry.actual ?? entry.expected} for ${entry.file}`, async () => {
      const capture = createIo()
      await run(['validate', BROKEN, '--json'], capture.io)
      const report = JSON.parse(capture.out) as Report
      const codes = report.findings
        .filter((finding) => basename(finding.file) === entry.file)
        .map((finding) => finding.code)
      expect(codes.length).toBeGreaterThan(0)
      expect(codes).toContain(entry.actual ?? entry.expected)
    })
  }
})

describe('convert', () => {
  it('round trips compact to JSON and back, byte for byte', async () => {
    const first = createIo()
    expect(
      await run(['convert', HARBOR_OQF, '--to', 'json', '--out', '/virtual/harbor.json'], first.io),
    ).toBe(0)

    const second = createIo()
    second.written.set('/virtual/harbor.json', first.written.get('/virtual/harbor.json') ?? '')
    expect(await run(['convert', '/virtual/harbor.json', '--to', 'oqf'], second.io)).toBe(0)
    expect(second.out).toBe(readFileSync(HARBOR_OQF, 'utf8'))
  })

  it('writes JSON to stdout', async () => {
    const capture = createIo()
    expect(await run(['convert', `${QUESTS}minimal.oqf`, '--to', 'json'], capture.io)).toBe(0)
    expect(capture.out).toBe(readFileSync(`${QUESTS}minimal.json`, 'utf8'))
  })

  it('writes Markdown with a mermaid block', async () => {
    const capture = createIo()
    expect(await run(['convert', HARBOR_OQF, '--to', 'md'], capture.io)).toBe(0)
    expect(capture.out).toContain('```mermaid')
    expect(capture.out).toContain('flowchart TD')
    expect(capture.out).toContain("# The Harbormaster's Ledger")
  })

  it('round trips the compact dialogue form to JSON and back, byte for byte', async () => {
    const first = createIo()
    expect(
      await run(
        ['convert', HARBOR_OQD, '--to', 'json', '--out', '/virtual/harbor.dialogue.json'],
        first.io,
      ),
    ).toBe(0)
    expect(first.written.get('/virtual/harbor.dialogue.json')).toBe(
      readFileSync(`${QUESTS}harbormasters-ledger.dialogue.json`, 'utf8'),
    )

    const second = createIo()
    second.written.set(
      '/virtual/harbor.dialogue.json',
      first.written.get('/virtual/harbor.dialogue.json') ?? '',
    )
    expect(await run(['convert', '/virtual/harbor.dialogue.json', '--to', 'oqd'], second.io)).toBe(
      0,
    )
    expect(second.out).toBe(readFileSync(HARBOR_OQD, 'utf8'))
  })

  it('writes Ink', async () => {
    const capture = createIo()
    expect(await run(['convert', HARBOR_OQD, '--to', 'ink'], capture.io)).toBe(0)
    expect(capture.out).toContain('=== ines_intro')
  })

  it('writes Yarn Spinner', async () => {
    const capture = createIo()
    expect(await run(['convert', HARBOR_OQD, '--to', 'yarn'], capture.io)).toBe(0)
    expect(capture.out).toContain('title:')
    expect(capture.out).toContain('===')
  })

  it('rejects an unknown target', async () => {
    const capture = createIo()
    expect(await run(['convert', HARBOR_OQF, '--to', 'yaml'], capture.io)).toBe(2)
    expect(capture.err).toContain('unknown target: yaml')
  })

  it('refuses a target the file does not have', async () => {
    const quest = createIo()
    expect(await run(['convert', HARBOR_OQF, '--to', 'ink'], quest.io)).toBe(2)
    expect(quest.err).toContain('cannot convert quests to ink, expected oqf, json or md')

    const dialogue = createIo()
    expect(await run(['convert', HARBOR_OQD, '--to', 'md'], dialogue.io)).toBe(2)
    expect(dialogue.err).toContain('cannot convert dialogue to md, expected oqd, json, ink or yarn')
  })

  it('needs a target', async () => {
    const capture = createIo()
    expect(await run(['convert', HARBOR_OQF], capture.io)).toBe(2)
  })
})

/**
 * Ink and Yarn Spinner are the two round trips that leave the model, so both are
 * driven end to end: convert out, import back, compare against the fixture the
 * export started from.
 */
describe('import', () => {
  for (const [target, extension] of [
    ['ink', 'ink'],
    ['yarn', 'yarn'],
  ] as const) {
    it(`round trips the reference dialogue through ${target}`, async () => {
      const exported = createIo()
      const file = `/virtual/harbor.${extension}`
      expect(await run(['convert', HARBOR_OQD, '--to', target, '--out', file], exported.io)).toBe(0)

      const imported = createIo()
      imported.written.set(file, exported.written.get(file) ?? '')
      expect(await run(['import', file, '--to', 'json'], imported.io)).toBe(0)
      expect(imported.err).toBe('')
      expect(parseDialogueJson(imported.out)).toEqual(parseOqd(readFileSync(HARBOR_OQD, 'utf8')))
    })
  }

  it('writes the compact form to a file', async () => {
    const exported = createIo()
    expect(
      await run(['convert', HARBOR_OQD, '--to', 'ink', '--out', '/virtual/h.ink'], exported.io),
    ).toBe(0)

    const imported = createIo()
    imported.written.set('/virtual/h.ink', exported.written.get('/virtual/h.ink') ?? '')
    expect(
      await run(
        ['import', '/virtual/h.ink', '--to', 'oqd', '--out', '/virtual/h.oqd'],
        imported.io,
      ),
    ).toBe(0)
    expect(imported.written.get('/virtual/h.oqd')).toBe(readFileSync(HARBOR_OQD, 'utf8'))
  })

  it('prints a warning per construct it could not carry over', async () => {
    const capture = createIo()
    const source = '=== talk ===\nTODO: rewrite this\nCONST answer = 42\nHello.\n-> END\n'
    capture.written.set('/virtual/odd.ink', source)
    expect(await run(['import', '/virtual/odd.ink', '--to', 'json'], capture.io)).toBe(0)
    const lines = capture.err.trimEnd().split('\n')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).toMatch(/^\/virtual\/odd\.ink:\d+: [^:]+: .+$/)
    }
    expect(capture.err).toContain('/virtual/odd.ink:2: todo:')
    // The document is still written: an import is a starting point to review.
    expect(capture.out).toContain('"oqd"')
  })

  it('rejects an extension it cannot import', async () => {
    const capture = createIo()
    expect(await run(['import', HARBOR_OQD, '--to', 'json'], capture.io)).toBe(2)
    expect(capture.err).toContain('expected .ink or .yarn')
  })

  it('rejects an unknown target', async () => {
    const capture = createIo()
    capture.written.set('/virtual/a.ink', '')
    expect(await run(['import', '/virtual/a.ink', '--to', 'oqf'], capture.io)).toBe(2)
  })

  it('needs a path and a target', async () => {
    expect(await run(['import'], createIo().io)).toBe(2)
    expect(await run(['import', '/virtual/a.ink'], createIo().io)).toBe(2)
  })
})

describe('extract and inject', () => {
  const FIXTURES = ['harbormasters-ledger.oqf', 'harbormasters-ledger.oqd']

  it('extracts quests and dialogue into one table and leaves the sources alone', async () => {
    await withCopies(FIXTURES, async (directory, copies) => {
      const table = join(directory, 'strings.json')
      const capture = createDiskIo()
      expect(await run(['extract', ...copies, '--out', table], capture.io)).toBe(0)

      const strings = JSON.parse(readFileSync(table, 'utf8')) as Record<string, string>
      const keys = Object.keys(strings)
      // Quest keys are `<questId>.…`, dialogue keys `<conversationId>.…`.
      const questKeys = keys.filter((key) => key.startsWith('harbormasters_ledger.'))
      expect(questKeys).toHaveLength(15)
      expect(keys.length).toBeGreaterThan(questKeys.length)
      expect(keys.some((key) => key.startsWith('ines_intro.'))).toBe(true)
      expect(strings['harbormasters_ledger.title']).toBe("The Harbormaster's Ledger")

      // Without --write the sources are untouched.
      for (const [index, copy] of copies.entries()) {
        expect(readFileSync(copy, 'utf8')).toBe(readFileSync(`${QUESTS}${FIXTURES[index]}`, 'utf8'))
      }
    })
  })

  it('rewrites the sources with --write and restores them with inject', async () => {
    await withCopies(FIXTURES, async (directory, copies) => {
      const table = join(directory, 'strings.json')
      const originals = FIXTURES.map((name) => readFileSync(`${QUESTS}${name}`, 'utf8'))

      const extract = createDiskIo()
      expect(await run(['extract', ...copies, '--out', table, '--write'], extract.io)).toBe(0)
      // The quest file gets quest keys, the dialogue file conversation keys.
      const prefixes = ['@harbormasters_ledger.', '@ines_intro.']
      for (const [index, copy] of copies.entries()) {
        const text = readFileSync(copy, 'utf8')
        expect(text).not.toBe(originals[index])
        expect(text).toContain(prefixes[index])
      }

      const inject = createDiskIo()
      expect(await run(['inject', ...copies, '--table', table], inject.io)).toBe(0)
      for (const [index, copy] of copies.entries()) {
        expect(readFileSync(copy, 'utf8')).toBe(originals[index])
      }
    })
  })

  it('takes a directory and writes every table form', async () => {
    await withCopies(FIXTURES, async (directory) => {
      // The table goes outside the pack, so the next run does not read it back
      // in as a source. A directory with no known extension is skipped.
      const out = join(directory, 'tables')
      mkdirSync(out)
      for (const extension of ['json', 'csv', 'po', 'xliff']) {
        const table = join(out, `strings.${extension}`)
        const capture = createDiskIo()
        expect(await run(['extract', directory, '--out', table], capture.io)).toBe(0)
        expect(readFileSync(table, 'utf8').length).toBeGreaterThan(0)
      }
    })
  })

  it('round trips through every table form', async () => {
    await withCopies(FIXTURES, async (directory, copies) => {
      const originals = FIXTURES.map((name) => readFileSync(`${QUESTS}${name}`, 'utf8'))
      for (const extension of ['json', 'csv', 'po', 'xliff']) {
        const table = join(directory, `strings.${extension}`)
        expect(
          await run(['extract', ...copies, '--out', table, '--write'], createDiskIo().io),
        ).toBe(0)
        expect(await run(['inject', ...copies, '--table', table], createDiskIo().io)).toBe(0)
        for (const [index, copy] of copies.entries()) {
          expect(readFileSync(copy, 'utf8'), extension).toBe(originals[index])
        }
      }
    })
  })

  it('honours --missing empty', async () => {
    await withCopies(['harbormasters-ledger.oqf'], async (directory, copies) => {
      const table = join(directory, 'strings.json')
      expect(await run(['extract', ...copies, '--out', table, '--write'], createDiskIo().io)).toBe(
        0,
      )
      writeFileSync(table, '{}\n')
      expect(
        await run(['inject', ...copies, '--table', table, '--missing', 'empty'], createDiskIo().io),
      ).toBe(0)
      expect(readFileSync(copies[0], 'utf8')).not.toContain('@harbormasters_ledger.')
    })
  })

  it('rejects a table extension it does not know', async () => {
    const capture = createIo()
    expect(await run(['extract', HARBOR_OQF, '--out', 'strings.yaml'], capture.io)).toBe(2)
    expect(capture.err).toContain('unsupported table extension')
  })

  it('rejects a bad missing strategy', async () => {
    const capture = createIo()
    const code = await run(
      ['inject', HARBOR_OQF, '--table', 't.json', '--missing', 'loud'],
      capture.io,
    )
    expect(code).toBe(2)
    expect(capture.err).toContain('unknown missing strategy: loud')
  })

  it('needs a path, an --out and a --table', async () => {
    expect(await run(['extract'], createIo().io)).toBe(2)
    expect(await run(['extract', HARBOR_OQF], createIo().io)).toBe(2)
    expect(await run(['extract', HARBOR_OQF, '--out'], createIo().io)).toBe(2)
    expect(await run(['inject'], createIo().io)).toBe(2)
    expect(await run(['inject', HARBOR_OQF], createIo().io)).toBe(2)
    expect(await run(['extract', HARBOR_OQF, '--out', 't.json', '--loud'], createIo().io)).toBe(2)
    expect(await run(['inject', HARBOR_OQF, '--table', 't.json', '--loud'], createIo().io)).toBe(2)
  })
})

describe('graph', () => {
  it('prints the steps of the reference quest', async () => {
    const capture = createIo()
    expect(await run(['graph', HARBOR_OQF], capture.io)).toBe(0)
    const lines = capture.out.trimEnd().split('\n')
    expect(lines[0]).toBe('flowchart TD')
    expect(lines).toContain('  talk_ines["Speak with Harbormaster Ines"]')
    // Endings take the double bracket shape.
    expect(lines).toContain('  return_ledger[["Return the ledger to Ines"]]')
    expect(lines).toContain('  talk_ines --> find_otter')
    expect(lines).toContain('  have_ledger --> sell_ledger')
    // ask_gulls is the one optional step.
    expect(lines).toContain('  style ask_gulls stroke-dasharray: 5 5')
  })

  it('takes a single quest', async () => {
    const capture = createIo()
    const code = await run(['graph', HARBOR_OQF, '--quest', 'harbormasters_ledger'], capture.io)
    expect(code).toBe(0)
    expect(capture.out.split('flowchart TD')).toHaveLength(2)
  })

  it('reports a quest that is not in the file', async () => {
    const capture = createIo()
    expect(await run(['graph', HARBOR_OQF, '--quest', 'nope'], capture.io)).toBe(1)
    expect(capture.err).toContain('no quest "nope"')
  })
})

describe('schema', () => {
  it('prints parsable JSON Schema', async () => {
    const capture = createIo()
    expect(await run(['schema'], capture.io)).toBe(0)
    const schema = JSON.parse(capture.out) as { $schema?: string; title?: string }
    expect(typeof schema.$schema).toBe('string')
    expect(typeof schema.title).toBe('string')
  })

  it('prints the dialogue schema with --dialogue', async () => {
    const capture = createIo()
    expect(await run(['schema', '--dialogue'], capture.io)).toBe(0)
    const schema = JSON.parse(capture.out) as {
      $schema?: string
      title?: string
      $defs?: Record<string, unknown>
    }
    expect(typeof schema.$schema).toBe('string')
    expect(typeof schema.title).toBe('string')
    expect(Object.keys(schema.$defs ?? {}).length).toBeGreaterThan(0)
  })

  it('takes no arguments', async () => {
    const capture = createIo()
    expect(await run(['schema', 'extra'], capture.io)).toBe(2)
  })

  it('rejects an unknown option', async () => {
    const capture = createIo()
    expect(await run(['schema', '--quests'], capture.io)).toBe(2)
    expect(capture.err).toContain('unknown option for schema: --quests')
  })
})

describe('help and version', () => {
  it('prints the usage', async () => {
    const capture = createIo()
    expect(await run(['--help'], capture.io)).toBe(0)
    expect(capture.out).toContain('oqf <command> [options]')
    for (const command of [
      'validate',
      'convert',
      'import',
      'graph',
      'extract',
      'inject',
      'schema',
    ]) {
      expect(capture.out, command).toContain(command)
    }
  })

  it('prints the usage of every command', async () => {
    for (const command of [
      'validate',
      'convert',
      'import',
      'graph',
      'extract',
      'inject',
      'schema',
    ]) {
      const capture = createIo()
      expect(await run([command, '--help'], capture.io)).toBe(0)
      expect(capture.out, command).toContain(`oqf ${command}`)
      expect(capture.err, command).toBe('')
    }
  })

  it('prints the usage of one command', async () => {
    const capture = createIo()
    expect(await run(['validate', '--help'], capture.io)).toBe(0)
    expect(capture.out).toContain('oqf validate <paths...>')
    expect(capture.err).toBe('')
  })

  it('prints the version from package.json', async () => {
    const capture = createIo()
    expect(await run(['--version'], capture.io)).toBe(0)
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { version: string }
    expect(capture.out.trimEnd()).toBe(manifest.version)
  })
})

describe('bad usage', () => {
  it('exits 2 with no command', async () => {
    const capture = createIo()
    expect(await run([], capture.io)).toBe(2)
    expect(capture.err).toContain('oqf <command> [options]')
  })

  it('exits 2 on an unknown command', async () => {
    const capture = createIo()
    expect(await run(['flatline'], capture.io)).toBe(2)
    expect(capture.err).toContain('unknown command: flatline')
  })

  it('exits 2 on an unknown flag', async () => {
    const capture = createIo()
    expect(await run(['validate', HARBOR_OQF, '--loud'], capture.io)).toBe(2)
    expect(capture.err).toContain('unknown option for validate: --loud')
  })

  it('exits 2 without a path', async () => {
    const capture = createIo()
    expect(await run(['validate'], capture.io)).toBe(2)
  })

  it('exits 2 on a path that is not there', async () => {
    const capture = createIo()
    expect(await run(['validate', `${QUESTS}nope.oqf`], capture.io)).toBe(2)
    expect(capture.err).toContain('no such file or directory')
  })

  it('exits 2 on an extension no command reads', async () => {
    const capture = createIo()
    expect(await run(['validate', `${QUESTS}../README.md`], capture.io)).toBe(2)
    expect(capture.err).toContain('unsupported extension')
  })

  it('exits 2 when graph is pointed at dialogue', async () => {
    const capture = createIo()
    expect(await run(['graph', HARBOR_OQD], capture.io)).toBe(2)
    expect(capture.err).toContain('holds dialogue, expected quests')
  })
})
