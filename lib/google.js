import { readJsonCapped } from './limits.js'

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function normalizeTarget(to) {
  const t = String(to || 'ru').toLowerCase()
  if (t === 'zh-hans') return 'zh-CN'
  if (t === 'zh-hant') return 'zh-TW'
  return t
}

export async function googleTranslate(text, to, signal) {
  const body = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: normalizeTarget(to),
    dt: 't',
    q: text,
  }).toString()
  let res
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'user-agent': UA,
      },
      body,
      signal,
      redirect: 'error',
    })
  } catch (err) {
    if (signal && signal.aborted) throw new Error('aborted')
    throw new Error('google endpoint unreachable or refused a redirect')
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await readJsonCapped(res)
  if (!Array.isArray(json) || !Array.isArray(json[0])) throw new Error('unexpected response shape')
  const parts = []
  let detected = ''
  if (typeof json[2] === 'string' && json[2]) detected = json[2]
  for (const row of json[0]) {
    if (Array.isArray(row) && typeof row[0] === 'string') parts.push(row[0])
    if (!detected && Array.isArray(row) && typeof row[2] === 'string' && row[2]) detected = row[2]
  }
  const translation = parts.join('')
  if (!translation.trim()) throw new Error('empty translation')
  return { translation, detected }
}

export async function* googleProvider(text, to, signal) {
  const { translation, detected } = await googleTranslate(text, to, signal)
  yield { meta: { provider: 'google' } }
  yield { translation, detected }
}
