import { openaiTranslate } from '../lib/openai.js'
import { googleProvider } from '../lib/google.js'
import { webTranslate } from '../lib/web.js'

const CYRILLIC_RE = /[\u0400-\u04ff]/
const TIMEOUT_MS = 180000
const OPENAI_SAMPLE = 'Hello, world. This is a live smoke test of the translation plugin.'
const GOOGLE_SAMPLE = 'Good evening. Live smoke test of the google backend.'
const BING_SAMPLE = 'Good morning. Live smoke test of the bing backend.'

const results = []

function clip(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length > 90 ? flat.slice(0, 90) + '...' : flat
}

async function withRetry(fn, attempts = 2) {
  let lastError = null
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  throw lastError
}

async function runCheck(name, required, fn) {
  try {
    const detail = await fn()
    console.log('PASS ' + name + ': ' + clip(detail))
    results.push({ name, required, ok: true })
  } catch (err) {
    const message = (err && err.message) || String(err)
    const skip = !required && /HTTP 429/.test(message)
    if (skip) {
      console.log('SKIP ' + name + ': rate limited, ' + clip(message))
      results.push({ name, required, ok: true })
    } else {
      console.log('FAIL ' + name + ': ' + clip(message))
      results.push({ name, required, ok: false })
    }
  }
}

async function checkOpenAi() {
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1').replace(/\/+$/, '')
  const model = process.env.OLLAMA_MODEL || 'qwen3:1.7b'
  let translation = ''
  for await (const ev of openaiTranslate({ baseUrl, model }, OPENAI_SAMPLE, 'ru', AbortSignal.timeout(TIMEOUT_MS))) {
    if (ev.delta) translation += ev.delta
    if (ev.translation) translation = ev.translation
  }
  if (!CYRILLIC_RE.test(translation)) {
    throw new Error('no cyrillic in output: ' + clip(translation))
  }
  return model + ' en-ru: ' + translation
}

async function checkGoogle() {
  let translation = ''
  for await (const ev of googleProvider(GOOGLE_SAMPLE, 'ru', AbortSignal.timeout(TIMEOUT_MS))) {
    if (ev.translation) translation = ev.translation
  }
  if (!CYRILLIC_RE.test(translation)) {
    throw new Error('no cyrillic in output: ' + clip(translation))
  }
  return 'en-ru: ' + translation
}

async function checkBing() {
  const result = await withRetry(() => webTranslate(BING_SAMPLE, { to: 'ru' }))
  if (!CYRILLIC_RE.test(result.translation)) {
    throw new Error('no cyrillic in output: ' + clip(result.translation))
  }
  return result.provider + ' en-ru: ' + result.translation
}

if (process.env.SMOKE !== '1') {
  console.error('refusing to run live checks: set SMOKE=1 to allow network calls')
  process.exit(1)
}

await runCheck('openai', true, checkOpenAi)
if (process.env.SMOKE_GOOGLE === '1') {
  await runCheck('google', false, checkGoogle)
} else {
  console.log('SKIP google: set SMOKE_GOOGLE=1 to include')
}
await runCheck('bing', true, checkBing)

const failed = results.filter((r) => r.required && !r.ok)
if (failed.length > 0) {
  console.error('smoke failed: ' + failed.map((r) => r.name).join(', '))
  process.exit(1)
}
console.log('smoke ok: ' + results.filter((r) => r.ok).length + ' of ' + results.length + ' checks passed')
