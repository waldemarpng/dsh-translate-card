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

test('google response shape yields translation and detected language', async () => {
  calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => [[['Hello', 'hello text', null, null, 'en']], null, 'en'],
    }
  }
  const { googleProvider, googleTranslate } = await import('../lib/google.js')
  const result = await googleTranslate('hello text', 'ru', undefined)
  assert.deepEqual(result, { translation: 'Hello', detected: 'en' })
  assert.equal(calls[0].url, 'https://translate.googleapis.com/translate_a/single')
  assert.equal(calls[0].init.method, 'POST')
  const body = new URLSearchParams(calls[0].init.body)
  assert.equal(body.get('tl'), 'ru')
  assert.equal(body.get('q'), 'hello text')
  const events = await collect(googleProvider('hello text', 'ru', undefined))
  assert.deepEqual(events, [
    { meta: { provider: 'google' } },
    { translation: 'Hello', detected: 'en' },
  ])
})

test('zh targets map to google codes', async () => {
  calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => [[['Ni', 'hi', null, null, 'en']]] }
  }
  const { googleTranslate } = await import('../lib/google.js')
  await googleTranslate('hi', 'zh-hant', undefined)
  const body = new URLSearchParams(calls[0].init.body)
  assert.equal(body.get('tl'), 'zh-TW')
})

test('http 429 throws with status', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) })
  const { googleTranslate } = await import('../lib/google.js')
  await assert.rejects(() => googleTranslate('hi', 'ru', undefined), /HTTP 429/)
})

test('unexpected response shape throws', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ detail: 'nope' }) })
  const { googleTranslate } = await import('../lib/google.js')
  await assert.rejects(() => googleTranslate('hi', 'ru', undefined), /unexpected response shape/)
})

test('empty translation throws', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [[['', 'hi', null, null, 'en']]] })
  const { googleTranslate } = await import('../lib/google.js')
  await assert.rejects(() => googleTranslate('hi', 'ru', undefined), /empty translation/)
})
