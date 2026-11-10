import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-translate-card-routes-'))
fs.writeFileSync(path.join(home, '.dsh-translate-card.json'), JSON.stringify({ backends: ['llm'] }))
process.env.DSH_HOME = home

const plugin = (await import('../lib/index.js')).default

function startHost() {
  const routes = new Map()
  const ctx = {
    get: () => undefined,
    effect: () => undefined,
    webServer: {
      register: (route) => {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
      tapIndex: () => () => undefined,
    },
  }
  const root = {
    effect: () => undefined,
    on: () => () => undefined,
    inject: (deps, fn) => fn(ctx),
  }
  plugin.apply(root)
  const server = http.createServer((req, res) => {
    const handler = routes.get(req.url)
    if (!handler) {
      res.statusCode = 404
      res.end()
      return
    }
    handler(req, res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function send(server, headers, body) {
  const port = server.address().port
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/dsh-translate-card/translate', method: 'POST', headers },
      (res) => {
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => resolve({ status: res.statusCode, text }))
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

const server = await startHost()
const host = '127.0.0.1:' + server.address().port

test.after(() => {
  server.close()
  fs.rmSync(home, { recursive: true, force: true })
})

test('request without origin or fetch metadata is rejected by the fallback fence', async () => {
  const res = await send(server, { host, 'content-type': 'application/json' }, JSON.stringify({ text: 'hi' }))
  assert.equal(res.status, 403)
})

test('opaque null origin is rejected', async () => {
  const res = await send(server, { host, origin: 'null', 'content-type': 'application/json' }, JSON.stringify({ text: 'hi' }))
  assert.equal(res.status, 403)
})

test('cross-site request is rejected', async () => {
  const res = await send(
    server,
    { host, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
    JSON.stringify({ text: 'hi' }),
  )
  assert.equal(res.status, 403)
})

test('mismatched origin is rejected', async () => {
  const res = await send(server, { host, origin: 'http://127.0.0.1:1', 'content-type': 'application/json' }, JSON.stringify({ text: 'hi' }))
  assert.equal(res.status, 403)
})

test('same-origin request reaches the handler and null body gets a clean 400', async () => {
  const res = await send(server, { host, origin: 'http://' + host, 'sec-fetch-site': 'same-origin' }, 'null')
  assert.equal(res.status, 400)
  assert.match(res.text, /body must be a JSON object/)
})

test('same-origin request with llm-only chain never falls back to a public service', async () => {
  const res = await send(
    server,
    { host, origin: 'http://' + host, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    JSON.stringify({ text: 'Hello' }),
  )
  assert.equal(res.status, 200)
  const events = res.text.trim().split('\n').map((l) => JSON.parse(l))
  assert.ok(events.every((ev) => !(ev.meta && ev.meta.fallback)))
  assert.match(events[events.length - 1].error, /llm/)
})

function getRaw(server, pathname, headers) {
  const port = server.address().port
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET', headers }, (res) => {
      let text = ''
      res.on('data', (c) => (text += c))
      res.on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('script and config GETs survive without fetch metadata but the translate POST does not', async () => {
  const host = '127.0.0.1:' + server.address().port
  const script = await getRaw(server, '/dsh-translate-card/client.js', { host })
  assert.equal(script.status, 200)
  assert.match(script.text, /dshTranslateCard/)
  const config = await getRaw(server, '/dsh-translate-card/config', { host })
  assert.equal(config.status, 200)
  const payload = JSON.parse(config.text)
  assert.equal(payload.config.trigger, 'button')
  assert.equal(payload.config.hotkey, 'alt+shift+t')
  const translate = await send(server, { host, 'content-type': 'application/json' }, JSON.stringify({ text: 'hi' }))
  assert.equal(translate.status, 403)
})
