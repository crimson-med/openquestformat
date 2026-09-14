import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { run } from './cli.js'
import type { FileFinding } from './format.js'
import type { Io } from './load.js'

const QUESTS = fileURLToPath(new URL('../../examples/quests/', import.meta.url))
const HARBOR_OQF = `${QUESTS}harbormasters-ledger.oqf`
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
  { file: 'cycle-without-repeat.oqf', expected: 'cycle-without-repeat' },
  { file: 'dictionary-index-out-of-range.oqf', expected: 'parse-error' },
  { file: 'duplicate-step-id.oqf', expected: 'duplicate-step-id' },
  // The comment describes a non-namespaced extension key, which the compact
  // parser rejects before the validator's ext-key-invalid check can run.
  { file: 'ext-without-namespace.oqf', expected: 'ext-key-invalid', actual: 'parse-error' },
  { file: 'outcome-with-dependents.oqf', expected: 'outcome-with-dependents' },
  { file: 'unknown-objective-kind.oqf', expected: 'parse-error' },
  // The comment describes an unknown reward reference. In the compact form a
  // reward reference is an index, so an out of range one is a parse error.
  { file: 'unknown-reward-ref.oqf', expected: 'unknown-reward-ref', actual: 'parse-error' },
  { file: 'unreachable-step.oqf', expected: 'unreachable-step' },
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

  it('rejects an unknown target', async () => {
    const capture = createIo()
    expect(await run(['convert', HARBOR_OQF, '--to', 'yaml'], capture.io)).toBe(2)
    expect(capture.err).toContain('unknown target: yaml')
  })

  it('needs a target', async () => {
    const capture = createIo()
    expect(await run(['convert', HARBOR_OQF], capture.io)).toBe(2)
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

  it('takes no arguments', async () => {
    const capture = createIo()
    expect(await run(['schema', 'extra'], capture.io)).toBe(2)
  })
})

describe('help and version', () => {
  it('prints the usage', async () => {
    const capture = createIo()
    expect(await run(['--help'], capture.io)).toBe(0)
    expect(capture.out).toContain('oqf <command> [options]')
    expect(capture.out).toContain('validate')
    expect(capture.out).toContain('convert')
    expect(capture.out).toContain('graph')
    expect(capture.out).toContain('schema')
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
})
