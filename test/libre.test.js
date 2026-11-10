import test from 'node:test'
import assert from 'node:assert/strict'

const realFetch = globalThis.fetch
let calls = []

test.after(() => {
  globalThis.fetch = realFetch
})

async function collect(gen) {
  const out = []
  for await (const ev of gen) out.push(ev)
  return out
}

test('translatedText is returned as translation', async () => {
  calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => ({ translatedText: 'Hello' }) }
  }
  const { libreProvider, libreTranslateRequest } = await import('../lib/libre.js')
  const endpoint = { baseUrl: 'http://127.0.0.1:5000' }
  const result = await libreTranslateRequest(endpoint, 'hi', 'ru', undefined)
  assert.deepEqual(result, { translation: 'Hello', detected: '' })
  assert.equal(calls[0].url, 'http://127.0.0.1:5000/translate')
  const payload = JSON.parse(calls[0].init.body)
  assert.deepEqual(
    { q: payload.q, source: payload.source, target: payload.target, format: payload.format },
    { q: 'hi', source: 'auto', target: 'ru', format: 'text' },
  )
  assert.equal(payload.api_key, undefined)
  const events = await collect(libreProvider(endpoint, 'hi', 'ru', undefined))
  assert.deepEqual(events, [
    { meta: { provider: 'libretranslate' } },
    { translation: 'Hello', detected: '' },
  ])
})

test('api_key is included when apiKeyEnv is set', async () => {
  calls = []
  process.env.DSH_TRANSLATE_TEST_LIBRE_KEY = 'libre-secret'
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => ({ translatedText: 'Hello' }) }
  }
  const { libreTranslateRequest } = await import('../lib/libre.js')
  const endpoint = { baseUrl: 'http://127.0.0.1:5000', apiKeyEnv: 'DSH_TRANSLATE_TEST_LIBRE_KEY' }
  await libreTranslateRequest(endpoint, 'hi', 'ru', undefined)
  const payload = JSON.parse(calls[0].init.body)
  assert.equal(payload.api_key, 'libre-secret')
  delete process.env.DSH_TRANSLATE_TEST_LIBRE_KEY
})

test('missing api key env throws', async () => {
  delete process.env.DSH_TRANSLATE_TEST_LIBRE_MISSING_KEY
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ translatedText: 'x' }) })
  const { libreTranslateRequest } = await import('../lib/libre.js')
  const endpoint = { baseUrl: 'http://127.0.0.1:5000', apiKeyEnv: 'DSH_TRANSLATE_TEST_LIBRE_MISSING_KEY' }
  await assert.rejects(
    () => libreTranslateRequest(endpoint, 'hi', 'ru', undefined),
    /DSH_TRANSLATE_TEST_LIBRE_MISSING_KEY is not set/,
  )
})

test('http error throws with detail', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom body' })
  const { libreTranslateRequest } = await import('../lib/libre.js')
  await assert.rejects(
    () => libreTranslateRequest({ baseUrl: 'http://127.0.0.1:5000' }, 'hi', 'ru', undefined),
    /HTTP 500: boom body/,
  )
})

test('empty translatedText throws', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ translatedText: ' ' }) })
  const { libreTranslateRequest } = await import('../lib/libre.js')
  await assert.rejects(
    () => libreTranslateRequest({ baseUrl: 'http://127.0.0.1:5000' }, 'hi', 'ru', undefined),
    /empty translation/,
  )
})
