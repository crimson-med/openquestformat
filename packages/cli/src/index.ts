/** The `oqf` entry point: real io in, exit code out. All logic lives in cli.ts. */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { run } from './cli.js'

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => {
    process.stdout.write(text)
  },
  stderr: (text) => {
    process.stderr.write(text)
  },
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, text) => {
    writeFileSync(path, text)
  },
  readDir: (path) => readdirSync(path),
  stat: (path) => ({ isDirectory: statSync(path).isDirectory() }),
})
