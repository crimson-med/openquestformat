#!/usr/bin/env node
/**
 * Serve the built Open Quest Format editor over http.
 *
 *   npx @oqf/editor
 *
 * A static file server over the package's own `dist/app`, with nothing beyond
 * Node built-ins behind it. Everything it can serve was produced by the site
 * build, so there is no configuration and no state.
 */
import { spawn } from 'node:child_process'
import { createReadStream, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', 'dist', 'app')
const PACKAGE = resolve(HERE, '..', 'package.json')

const DEFAULT_PORT = 4600
const DEFAULT_HOST = '127.0.0.1'
/** How many ports after the requested one to try before giving up. */
const PORT_ATTEMPTS = 10

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
])

function contentType(file) {
  return TYPES.get(extname(file).toLowerCase()) ?? 'application/octet-stream'
}

function version() {
  try {
    return JSON.parse(readFileSync(PACKAGE, 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

const HELP = `oqf-editor: serve the Open Quest Format editor from this machine.

Usage
  npx @oqf/editor [options]

Options
  --port <n>   Port to listen on (default ${DEFAULT_PORT}). If it is busy, the
               next ${PORT_ATTEMPTS} ports are tried before giving up.
  --host <h>   Address to bind (default ${DEFAULT_HOST}). Pass 0.0.0.0 to reach
               the editor from another machine on the network.
  --open       Open the URL in the default browser.
  --help       Print this text.
  --version    Print the package version.

The editor runs entirely in the browser. Documents are read and written through
the file picker and autosaved to the browser's local storage; this server only
hands out the static files.
`

/** Reads argv into options, or into an error message the caller prints. */
function parseArgs(argv) {
  const options = {
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    open: false,
    help: false,
    version: false,
  }
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    i += 1
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--version' || arg === '-v') options.version = true
    else if (arg === '--open') options.open = true
    else if (arg === '--port' || arg === '-p') {
      const given = argv[i]
      i += 1
      const value = Number(given)
      if (!Number.isInteger(value) || value < 1 || value > 65535) {
        return { error: `--port wants a number between 1 and 65535, got '${given ?? ''}'` }
      }
      options.port = value
    } else if (arg === '--host') {
      const given = argv[i]
      i += 1
      if (given === undefined || given.startsWith('-')) return { error: '--host wants an address' }
      options.host = given
    } else {
      return { error: `unknown argument '${arg}'. Try --help.` }
    }
  }
  return { options }
}

/**
 * Maps a request path to a file inside the served root, or undefined when the
 * request tries to leave it. A `..` segment is refused outright rather than
 * collapsed, and the resolved path is checked against the root as well.
 */
function resolveRequest(root, requestPath) {
  let decoded
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return undefined
  }
  if (decoded.includes('\0')) return undefined
  const segments = decoded.split('/').filter((part) => part !== '' && part !== '.')
  if (segments.some((part) => part === '..')) return undefined
  const target = resolve(root, ...segments)
  if (target !== root && !target.startsWith(root + sep)) return undefined
  return target
}

function notFound(response, message) {
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(`${message}\n`)
}

function send(request, response, file) {
  response.writeHead(200, {
    'content-type': contentType(file),
    'cache-control': file.includes(`${sep}assets${sep}`)
      ? 'max-age=31536000, immutable'
      : 'no-cache',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  const stream = createReadStream(file)
  stream.on('error', () => response.destroy())
  stream.pipe(response)
}

async function fileAt(path) {
  try {
    const info = await stat(path)
    return info.isDirectory() ? undefined : path
  } catch {
    return undefined
  }
}

async function handle(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' })
    response.end()
    return
  }
  const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname
  const target = resolveRequest(ROOT, requestPath)
  if (target === undefined) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('forbidden\n')
    return
  }

  const direct = await fileAt(target)
  if (direct !== undefined) {
    send(request, response, direct)
    return
  }

  // A directory, or a route the single page app owns, both answer with the
  // index. A request that named a file extension does not: that is a miss.
  if (extname(target) === '') {
    const index =
      (await fileAt(join(target, 'index.html'))) ?? (await fileAt(join(ROOT, 'index.html')))
    if (index !== undefined) {
      send(request, response, index)
      return
    }
    notFound(response, 'the editor build is missing its index.html')
    return
  }
  notFound(response, `not found: ${requestPath}`)
}

/** Opens a URL in the platform browser. Never throws, never fails the server. */
function openBrowser(url) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Opening a browser is a convenience. A headless machine is not an error.
  }
}

function listen(server, port, host) {
  return new Promise((done, fail) => {
    const onError = (error) => {
      server.removeListener('listening', onListening)
      fail(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      done(port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

async function main() {
  const { options, error } = parseArgs(process.argv.slice(2))
  if (error !== undefined) {
    process.stderr.write(`oqf-editor: ${error}\n`)
    process.exit(2)
  }
  if (options.help) {
    process.stdout.write(HELP)
    return
  }
  if (options.version) {
    process.stdout.write(`${version()}\n`)
    return
  }

  if ((await fileAt(join(ROOT, 'index.html'))) === undefined) {
    process.stderr.write(
      `oqf-editor: no built editor at ${ROOT}.\nReinstall @oqf/editor, or run 'pnpm --filter @oqf/editor build' in a checkout.\n`,
    )
    process.exit(1)
  }

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })

  let bound
  const last = options.port + PORT_ATTEMPTS
  for (let port = options.port; port <= last; port += 1) {
    try {
      bound = await listen(server, port, options.host)
      break
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || port === last) {
        const why = error.code === 'EADDRINUSE' ? 'every port is in use' : error.message
        process.stderr.write(
          `oqf-editor: could not listen on ${options.host}:${options.port} to ${last} (${why}).\nPick another range with --port.\n`,
        )
        process.exit(1)
      }
    }
  }

  const shown = options.host === '0.0.0.0' || options.host === '::' ? 'localhost' : options.host
  const url = `http://${shown.includes(':') ? `[${shown}]` : shown}:${bound}/`
  process.stdout.write(`OQF editor on ${url}\nPress ctrl c to stop.\n`)
  if (options.open) openBrowser(url)

  const stop = () => {
    process.stdout.write('\nstopping\n')
    server.close(() => process.exit(0))
    // A browser keeps sockets open; do not wait on them forever.
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

await main()
