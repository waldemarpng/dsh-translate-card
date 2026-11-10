import { readBodyCapped, readJsonCapped } from './limits.js'

function readApiKey(endpoint) {
  if (!endpoint.apiKeyEnv) return null
  const key = process.env[endpoint.apiKeyEnv]
  if (!key || !key.trim()) {
    throw new Error(`environment variable ${endpoint.apiKeyEnv} is not set`)
  }
  return key.trim()
}

function normalizeTarget(to) {
  const t = String(to || 'ru').toLowerCase()
  if (t === 'zh-hans') return 'zh'
  if (t === 'zh-hant') return 'zh-TW'
  return t
}

export async function libreTranslateRequest(endpoint, text, to, signal) {
  const payload = {
    q: text,
    source: 'auto',
    target: normalizeTarget(to),
    format: 'text',
  }
  const apiKey = readApiKey(endpoint)
  if (apiKey) payload.api_key = apiKey
  let res
  try {
    res = await fetch(endpoint.baseUrl + '/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
      redirect: 'error',
    })
  } catch (err) {
    if (signal && signal.aborted) throw new Error('aborted')
    throw new Error('libretranslate unreachable or refused a redirect: check baseUrl')
  }
  if (!res.ok) {
    const detail = await readBodyCapped(res, 4096).catch(() => '')
    throw new Error(`HTTP ${res.status}${detail ? ': ' + detail.slice(0, 180) : ''}`)
  }
  const json = await readJsonCapped(res)
  const translation = json && typeof json.translatedText === 'string' ? json.translatedText : ''
  if (!translation.trim()) throw new Error('empty translation')
  return { translation, detected: '' }
}

export async function* libreProvider(endpoint, text, to, signal) {
  const { translation, detected } = await libreTranslateRequest(endpoint, text, to, signal)
  yield { meta: { provider: 'libretranslate' } }
  yield { translation, detected }
}
