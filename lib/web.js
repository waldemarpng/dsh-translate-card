import https from 'node:https'
import { MAX_OUTPUT_CHARS, MAX_BODY_BYTES } from './limits.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const BING_HOST = 'cn.bing.com'
const DEFAULT_TIMEOUT = 15000
const MEMORY_CONTACT = String(process.env.DSH_TRANSLATE_CONTACT || '').trim()

function httpRequestOnce(urlStr, { method = 'GET', headers = {}, body = null, timeout = DEFAULT_TIMEOUT, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    let u
    try {
      u = new URL(urlStr)
    } catch (err) {
      reject(new Error('invalid URL'))
      return
    }
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers,
      },
      (res) => {
        const chunks = []
        let size = 0
        res.on('data', (c) => {
          size += c.length
          if (size > MAX_BODY_BYTES) {
            res.destroy()
            reject(new Error('response too large'))
            return
          }
          chunks.push(c)
        })
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }),
        )
        res.on('aborted', () => reject(new Error('response aborted')))
      },
    )
    req.on('error', reject)
    req.setTimeout(timeout, () => req.destroy(new Error('request timed out')))
    if (signal) {
      const onAbort = () => req.destroy(new Error('aborted'))
      signal.addEventListener('abort', onAbort, { once: true })
      req.on('close', () => signal.removeEventListener('abort', onAbort))
    }
    if (body) req.write(body)
    req.end()
  })
}

function mergeCookies(existing, setCookies) {
  const byName = new Map()
  for (const pair of existing) {
    const eq = pair.indexOf('=')
    if (eq > 0) byName.set(pair.slice(0, eq), pair)
  }
  for (const raw of setCookies) {
    const pair = String(raw).split(';')[0]
    const eq = pair.indexOf('=')
    if (eq > 0) byName.set(pair.slice(0, eq), pair)
  }
  return [...byName.values()]
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])

async function httpRequest(urlStr, options = {}) {
  const { redirects = 3 } = options
  let current = urlStr
  let cookiePairs = []
  const initial = options.headers && options.headers.cookie
  if (typeof initial === 'string' && initial) {
    cookiePairs = initial.split(';').map((s) => s.trim()).filter(Boolean)
  }
  for (let hop = 0; ; hop++) {
    const headers = Object.assign({}, options.headers)
    if (cookiePairs.length) headers.cookie = cookiePairs.join('; ')
    const res = await httpRequestOnce(current, Object.assign({}, options, { headers }))
    const setCookies = res.headers['set-cookie'] || []
    if (setCookies.length) cookiePairs = mergeCookies(cookiePairs, setCookies)
    if (REDIRECTS.has(res.status) && res.headers.location && hop < redirects) {
      current = new URL(res.headers.location, current).toString()
      if (res.status === 303) {
        options = Object.assign({}, options, { method: 'GET', body: null })
        if (options.headers) {
          const cleaned = Object.assign({}, options.headers)
          delete cleaned['content-type']
          delete cleaned['content-length']
          options.headers = cleaned
        }
      }
      continue
    }
    res.finalUrl = current
    res.cookiePairs = cookiePairs
    return res
  }
}

export function chunkText(text, max) {
  if (text.length <= max) return [text]
  const out = []
  let i = 0
  while (i < text.length) {
    let end = Math.min(i + max, text.length)
    if (end < text.length) {
      const slice = text.slice(i, end)
      const m = slice.match(/[\s\S]*[.!?\u3002\uff01\uff1f;\uff1b:\uff1a\n]/)
      if (m && m[0].length > max * 0.5) end = i + m[0].length
    }
    out.push(text.slice(i, end))
    i = end
  }
  return out
}

let bingSession = null

async function getBingSession(force = false, signal = null) {
  if (!force && bingSession && Date.now() < bingSession.expires) return bingSession
  const res = await httpRequest(`https://${BING_HOST}/translator`, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
    signal,
  })
  if (res.status !== 200) throw new Error(`bing page HTTP ${res.status}`)
  const html = res.text
  const abuse = html.match(/params_AbusePreventionHelper\s*=\s*(\[[\s\S]*?\])/)
  if (!abuse) throw new Error('bing token not found, page layout may have changed')
  let key, token, ttl
  try {
    ;[key, token, ttl] = JSON.parse(abuse[1])
  } catch (err) {
    throw new Error('bing token parse failed')
  }
  const ig = html.match(/IG:"([^"]+)"/)
  const iid = html.match(/data-iid="([^"]+)"/)
  bingSession = {
    key,
    token,
    host: new URL(res.finalUrl).hostname,
    ig: ig ? ig[1] : '',
    iid: iid ? iid[1] : '',
    cookie: res.cookiePairs.join('; '),
    expires: Date.now() + Math.max(60000, Math.min(Number(ttl) || 3600000, 3600000) - 120000),
  }
  return bingSession
}

async function bingTranslateChunk(text, to, signal = null, allowRetry = true) {
  const s = await getBingSession(false, signal)
  const form =
    'fromLang=auto-detect&text=' +
    encodeURIComponent(text) +
    '&to=' +
    to +
    '&token=' +
    encodeURIComponent(s.token) +
    '&key=' +
    s.key
  const res = await httpRequest(
    `https://${s.host}/ttranslatev3?isVertical=1&&IG=${encodeURIComponent(s.ig)}&IID=${encodeURIComponent(s.iid)}`,
    {
      method: 'POST',
      headers: {
        'user-agent': UA,
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(form),
        referer: `https://${s.host}/translator`,
        cookie: s.cookie,
      },
      body: form,
      signal,
    },
  )
  let json = null
  try {
    json = JSON.parse(res.text)
  } catch (err) {}
  if (Array.isArray(json) && json[0] && Array.isArray(json[0].translations) && json[0].translations[0]) {
    return {
      text: json[0].translations.map((t) => t.text).join(''),
      detected: (json[0].detectedLanguage && json[0].detectedLanguage.language) || '',
    }
  }
  if (allowRetry) {
    await getBingSession(true, signal)
    return bingTranslateChunk(text, to, signal, false)
  }
  const detail =
    json && (json.errorMessage || json.statusCode) ? JSON.stringify(json).slice(0, 180) : `HTTP ${res.status}`
  throw new Error(detail)
}

const bingProvider = { label: 'bing', maxChunk: 4000, translate: bingTranslateChunk }

function guessSource(text) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja'
  if (/[\uac00-\ud7af]/.test(text)) return 'ko'
  if (/[\u0400-\u04ff]/.test(text)) return 'ru'
  if (/[\u0600-\u06ff]/.test(text)) return 'ar'
  if (/[\u0e00-\u0e7f]/.test(text)) return 'th'
  return 'en'
}

async function myMemoryTranslateChunk(text, to, signal = null) {
  const src = guessSource(text)
  const tgt = to === 'zh-Hans' || to === 'zh-CN' ? 'zh-CN' : to
  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}` +
    `&langpair=${encodeURIComponent(src + '|' + tgt)}` +
    (MEMORY_CONTACT ? '&de=' + encodeURIComponent(MEMORY_CONTACT) : '')
  const res = await httpRequest(url, { headers: { 'user-agent': UA }, signal })
  let json = null
  try {
    json = JSON.parse(res.text)
  } catch (err) {
    throw new Error(`mymemory HTTP ${res.status}`)
  }
  const out = json && json.responseData && json.responseData.translatedText
  if (!out) throw new Error(`mymemory HTTP ${res.status}`)
  if (/MYMEMORY WARNING/i.test(out)) throw new Error('mymemory daily quota exhausted')
  return { text: out, detected: src }
}

const myMemoryProvider = { label: 'mymemory', maxChunk: 480, translate: myMemoryTranslateChunk }

const PROVIDERS = [bingProvider, myMemoryProvider]

const CACHE_MAX = 500
const CACHE_TTL = 24 * 60 * 60 * 1000
const cache = new Map()

export function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  cache.delete(key)
  cache.set(key, hit)
  return hit.value
}

export function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value })
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
}

export async function webTranslate(text, { to, force = false, signal = null } = {}) {
  const key = 'web\u0000' + to + '\u0000' + text
  if (!force) {
    const hit = cacheGet(key)
    if (hit) return Object.assign({}, hit, { cached: true })
  }
  const errors = []
  for (const provider of PROVIDERS) {
    try {
      const parts = chunkText(text, provider.maxChunk)
      const outs = []
      let detected = ''
      let total = 0
      for (const part of parts) {
        if (signal && signal.aborted) throw new Error('aborted')
        const r = await provider.translate(part, to, signal)
        total += r.text.length
        if (total > MAX_OUTPUT_CHARS) throw new Error('translation too large')
        outs.push(r.text)
        if (!detected && r.detected) detected = r.detected
      }
      const result = {
        translation: outs.join(''),
        detected,
        provider: provider.label,
        chars: text.length,
        parts: parts.length,
      }
      cacheSet(key, result)
      return result
    } catch (err) {
      errors.push(`${provider.label}: ${(err && err.message) || err}`)
    }
  }
  throw new Error(errors.join('; '))
}
