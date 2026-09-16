/**
 * Remove side effect CSS imports from the emitted declarations.
 *
 * `tsc` keeps `import './styles.css'` in the `.d.ts` it writes, because a side
 * effect import can carry a module augmentation. A consumer's TypeScript cannot
 * resolve a stylesheet as a module, so every one of those lines is an error in
 * their build for no gain: the stylesheet is a separate entry point
 * (`@oqf/editor/styles.css`) and the declarations say nothing about it.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'lib')
const CSS_IMPORT = /^import\s+['"][^'"]+\.css['"];?\s*$\n?/gm

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else if (entry.name.endsWith('.d.ts')) files.push(path)
  }
  return files
}

let stripped = 0
for (const file of await walk(ROOT)) {
  const before = await readFile(file, 'utf8')
  const after = before.replace(CSS_IMPORT, '')
  if (after !== before) {
    await writeFile(file, after)
    stripped += 1
  }
}
process.stdout.write(`strip-css-imports: cleaned ${stripped} declaration files\n`)
