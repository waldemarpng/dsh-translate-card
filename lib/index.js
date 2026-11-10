import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { webTranslate, cacheGet, cacheSet } from './web.js'
import { llmTranslate } from './llm.js'
import { openaiTranslate } from './openai.js'
import { googleProvider } from './google.js'
import { libreProvider } from './libre.js'
import { readConfig, fastTimeoutMs, ConfigError } from './config.js'
import { runChain } from './chain.js'

const PLUGIN_NAME = 'dsh-translate-card'
const ROUTE_PREFIX = '/dsh-translate-card'
const CLIENT_PATH = ROUTE_PREFIX + '/client.js'
const API_PATH = ROUTE_PREFIX + '/translate'
const CONFIG_PATH = ROUTE_PREFIX + '/config'
const MAX_CHARS = 20000
const BODY_LIMIT = 64 * 1024
const CACHE_PREFIXES = {
  llm: 'llm',
  openai: 'openai',
  google: 'google',
  libretranslate: 'libretranslate',
  bing: 'web',
}
const SLOW_BACKENDS = new Set(['llm', 'openai'])
const TIMEOUT = Symbol('entry timeout')

const HERE = path.dirname(fileURLToPath(import.meta.url))

const CLIENT_FILE_CANDIDATES = [path.join(HERE, '..', 'assets', 'translate.js'), path.join(HERE, 'translate.js')]

let clientCache = null
function loadClientJs() {
  for (const p of CLIENT_FILE_CANDIDATES) {
    try {
      const st = fs.statSync(p)
      if (clientCache && clientCache.mtimeMs === st.mtimeMs) return clientCache.text
      const text = fs.readFileSync(p, 'utf8')
      clientCache = { text, mtimeMs: st.mtimeMs }
      return text
    } catch (err) {}
  }
  return clientCache ? clientCache.text : ''
}

const INJECT_TEXT =
  '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;' +
  'if(window.__dshTranslateCard)return;' +
  'var s=document.createElement("script");s.src="' + CLIENT_PATH + '";' +
  's.onerror=function(){};d.appendChild(s)}catch(e){}})()'

function makeFence(ctx) {
  const trusted = String(process.env.DSH_TRANSLATE_TRUSTED_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  function isLoopbackHostname(hn) {
    const h = String(hn || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
    if (!h) return false
    if (h === 'localhost' || h.endsWith('.localhost')) return true
    if (h === '::1') return true
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
    if (!m || Number(m[1]) !== 127) return false
    return [m[2], m[3], m[4]].every((x) => Number(x) <= 255)
  }

  function connectionFence() {
    try {
      const conn = ctx.get('connection') || ctx.connection
      return conn && typeof conn.requestRejection === 'function' ? conn : null
    } catch (err) {
      return null
    }
  }

  return function rejection(req, strict) {
    try {
      const headers = (req && req.headers) || {}
      if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return 403
      let hostUrl = null
      try {
        hostUrl = new URL('http://' + String(headers.host || ''))
      } catch (err) {
        return 403
      }
      const authority = hostUrl.host.toLowerCase()
      const origin = headers.origin
      if (typeof origin === 'string' && origin && origin !== 'null') {
        let originUrl = null
        try {
          originUrl = new URL(origin)
        } catch (err) {
          return 403
        }
        if (originUrl.host.toLowerCase() !== authority) return 403
      }
      const conn = connectionFence()
      if (!conn) {
        if (origin === 'null') return 403
        if (strict && !origin && !headers['sec-fetch-site']) return 403
        if (!isLoopbackHostname(hostUrl.hostname)) {
          const ok = trusted.some((e) =>
            e.indexOf(':') >= 0 ? e === authority : e === hostUrl.hostname.toLowerCase(),
          )
          if (!ok) return 403
        }
        return 0
      }
      let code
      try {
        code = conn.requestRejection(req)
      } catch (err) {
        return 403
      }
      if (code === undefined || code === null || code === false) return 0
      return typeof code === 'number' ? code : 403
    } catch (err) {
      return 403
    }
  }
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function* bingEntry(text, to, force, signal) {
  const result = await webTranslate(text, { to, force, signal })
  yield { meta: { provider: result.provider } }
  yield { translation: result.translation, detected: result.detected, provider: result.provider, cached: !!result.cached }
  yield { done: true, translation: result.translation, detected: result.detected || '' }
}

function backendStarter(id, config, ctx, text, to, force) {
  if (id === 'llm') return (signal) => llmTranslate(ctx, text, to, signal, config.llm)
  if (id === 'openai') return (signal) => openaiTranslate(config.openai, text, to, signal)
  if (id === 'google') return (signal) => googleProvider(text, to, signal)
  if (id === 'libretranslate') return (signal) => libreProvider(config.libretranslate, text, to, signal)
  if (id === 'bing') return (signal) => bingEntry(text, to, force, signal)
  return null
}

function attachOuterSignal(outer, ac) {
  if (!outer) return null
  if (outer.aborted) {
    ac.abort()
    return null
  }
  const onAbort = () => ac.abort()
  outer.addEventListener('abort', onAbort, { once: true })
  return () => outer.removeEventListener('abort', onAbort)
}

function timedEntry(id, start, timeoutMs, outerSignal, state) {
  return async function* () {
    const ac = new AbortController()
    let timedOut = false
    let onTimeout = null
    const timeoutHit = new Promise((resolve) => {
      onTimeout = resolve
    })
    const timer = setTimeout(() => {
      timedOut = true
      ac.abort()
      onTimeout(TIMEOUT)
    }, timeoutMs)
    const releaseOuter = attachOuterSignal(outerSignal, ac)
    const gen = start(ac.signal)
    try {
      for (;;) {
        const next = gen.next().then(
          (step) => ({ step }),
          (err) => ({ err }),
        )
        const winner = await Promise.race([next, timeoutHit])
        if (winner === TIMEOUT) {
          next.then((outcome) => {
            if (!outcome.err && outcome.step && !outcome.step.done) {
              try {
                gen.return(undefined)
              } catch (err) {}
            }
          })
          throw new Error('translation timed out')
        }
        if (winner.err) {
          if (timedOut) throw new Error('translation timed out')
          throw winner.err
        }
        const step = winner.step
        if (step.done) return
        const ev = step.value
        if (ev && (ev.done !== undefined || ev.translation !== undefined)) state.successId = id
        yield ev
        if (ev && ev.done) return
      }
    } finally {
      clearTimeout(timer)
      try {
        ac.abort()
      } catch (err) {}
      if (releaseOuter) releaseOuter()
    }
  }
}

function publicConfig(config) {
  return {
    to: config.to,
    enabled: config.enabled,
    backends: config.backends,
    skipTargetLanguage: config.skipTargetLanguage,
    trigger: config.trigger,
    hotkey: config.hotkey,
  }
}

function isConfigError(err) {
  return err instanceof ConfigError || (err && err.name === 'ConfigError')
}

export default {
  name: PLUGIN_NAME,
  apply(root) {
    const rowDisposers = []
    root.effect(() => () => {
      for (const d of rowDisposers) {
        try {
          d()
        } catch (err) {}
      }
    })

    rowDisposers.push(
      root.on('webserver/index-inject', (table) => {
        try {
          if (!Array.isArray(table)) return
          for (const row of table) {
            if (!row) continue
            if (row.kind === 'script-src' && row.src === CLIENT_PATH) return
            if (row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf(CLIENT_PATH) >= 0) return
          }
          table.push({ kind: 'script', placement: 'body', text: INJECT_TEXT })
        } catch (err) {}
      }),
    )

    root.inject(['webServer'], (ctx) => {
      const rejection = makeFence(ctx)
      const disposers = []

      function registerRoute(route) {
        const inner = route && route.handler
        const strict = route.strict === true
        const spec = Object.assign({}, route)
        delete spec.strict
        return ctx.webServer.register(
          Object.assign({}, spec, {
            handler: async (req, res) => {
              const code = rejection(req, strict)
              if (code) {
                try {
                  res.statusCode = code
                  res.end()
                } catch (err) {}
                return
              }
              return inner(req, res)
            },
          }),
        )
      }

      disposers.push(
        registerRoute({
          kind: 'exact',
          path: CLIENT_PATH,
          handler: (req, res) => {
            res.writeHead(200, {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-store',
            })
            res.end(loadClientJs())
          },
        }),
      )

      disposers.push(
        registerRoute({
          kind: 'exact',
          path: CONFIG_PATH,
          handler: (req, res) => {
            try {
              sendJson(res, 200, { ok: true, config: publicConfig(readConfig()) })
            } catch (err) {
              if (isConfigError(err)) {
                sendJson(res, 400, { ok: false, error: err.message })
                return
              }
              sendJson(res, 500, { ok: false, error: 'config read failed' })
            }
          },
        }),
      )

      disposers.push(
        registerRoute({
          kind: 'exact',
          path: API_PATH,
          strict: true,
          handler: async (req, res) => {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') {
              sendJson(res, 405, { ok: false, error: 'POST only' })
              return
            }
            let payload = null
            try {
              payload = JSON.parse(await readBody(req))
            } catch (err) {
              sendJson(res, 400, { ok: false, error: 'body is not valid JSON' })
              return
            }
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
              sendJson(res, 400, { ok: false, error: 'body must be a JSON object' })
              return
            }
            const text = typeof payload.text === 'string' ? payload.text : ''
            if (!text.trim()) {
              sendJson(res, 400, { ok: false, error: 'no text to translate' })
              return
            }
            if (text.length > MAX_CHARS) {
              sendJson(res, 413, { ok: false, error: 'selection too long, limit is ' + MAX_CHARS + ' chars' })
              return
            }
            let config
            try {
              config = readConfig()
            } catch (err) {
              if (isConfigError(err)) {
                sendJson(res, 400, { ok: false, error: err.message })
                return
              }
              sendJson(res, 500, { ok: false, error: 'config read failed' })
              return
            }
            if (!config.enabled) {
              sendJson(res, 200, { ok: false, error: 'plugin disabled in config', disabled: true })
              return
            }
            const to = config.to || 'ru'
            const force = !!payload.force

            res.writeHead(200, {
              'Content-Type': 'application/x-ndjson; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Accel-Buffering': 'no',
            })
            let closed = false
            const requestAbort = new AbortController()
            req.on('close', () => {
              closed = true
              requestAbort.abort()
            })
            const write = (obj) => {
              if (closed || res.destroyed) return false
              res.write(JSON.stringify(obj) + '\n')
              return true
            }

            const keyFor = (id) => CACHE_PREFIXES[id] + '\u0000' + to + '\u0000' + text
            if (!force) {
              for (const id of config.backends) {
                const hit = cacheGet(keyFor(id))
                if (hit) {
                  write({ translation: hit.translation, detected: hit.detected || '', provider: hit.provider, cached: true })
                  write({ done: true })
                  res.end()
                  return
                }
              }
            }

            const fastMs = fastTimeoutMs(config)
            const state = { successId: null }
            const entries = []
            for (const id of config.backends) {
              const start = backendStarter(id, config, ctx, text, to, force)
              if (!start) continue
              const timeoutMs = SLOW_BACKENDS.has(id) ? config.timeoutMs : fastMs
              entries.push({ id, run: timedEntry(id, start, timeoutMs, requestAbort.signal, state) })
            }

            let lastProvider = ''
            try {
              for await (const ev of runChain(entries)) {
                if (!write(ev)) break
                if (ev && ev.meta && ev.meta.provider) lastProvider = ev.meta.provider
                if (ev && ev.done) {
                  const successId = state.successId || entries[0].id
                  cacheSet(keyFor(successId), {
                    translation: ev.translation,
                    detected: ev.detected || '',
                    provider: lastProvider || successId,
                    chars: text.length,
                  })
                  break
                }
              }
            } catch (err) {
              write({ error: (err && err.message) || String(err) })
            }
            res.end()
          },
        }),
      )

      disposers.push(
        ctx.webServer.tapIndex((html) => {
          if (typeof html !== 'string' || html.indexOf(CLIENT_PATH) !== -1) return html
          const tag = '<script defer src="' + CLIENT_PATH + '"></script>'
          if (html.indexOf('</body>') !== -1) return html.replace('</body>', tag + '</body>')
          return html + tag
        }),
      )

      ctx.effect(() => () => {
        for (const d of disposers) {
          try {
            d()
          } catch (err) {}
        }
      })
    })
  },
}
