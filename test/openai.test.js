import test from 'node:test'
import assert from 'node:assert/strict'

const realFetch = globalThis.fetch
let calls = []

function sseResponse(chunks, status = 200) {
  let i = 0
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader() {
        return {
          read: async () =>
            i < chunks.length ? { done: false, value: new TextEncoder().encode(chunks[i++]) } : { done: true },
          releaseLock() {},
        }
      },
    },
    text: async () => chunks.join(''),
  }
}

test.after(() => {
  globalThis.fetch = realFetch
})

async function collect(gen) {
  const out = []
  for await (const ev of gen) out.push(ev)
  return out
}

test('sse stub streams deltas and done', async () => {
  calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
    ])
  }
  const { openaiTranslate } = await import('../lib/openai.js')
  const endpoint = { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:1.7b' }
  const events = await collect(openaiTranslate(endpoint, 'Hello', 'ru', undefined))
  assert.deepEqual(events, [
    { meta: { provider: 'openai', model: 'qwen3:1.7b' } },
    { delta: 'Hel' },
    { delta: 'lo' },
    { done: true, translation: 'Hello', detected: '' },
  ])
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/v1/chat/completions')
  assert.equal(calls[0].init.headers.Authorization, undefined)
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.model, 'qwen3:1.7b')
  assert.equal(body.stream, true)
})

test('http 500 throws with status detail', async () => {
  globalThis.fetch = async () => sseResponse(['nope'], 500)
  const { openaiTranslate } = await import('../lib/openai.js')
  await assert.rejects(
    async () => {
      for await (const ev of openaiTranslate({ baseUrl: 'http://127.0.0.1:9/v1', model: 'm' }, 'x', 'ru', undefined)) {
        void ev
      }
    },
    /HTTP 500/,
  )
})

test('missing api key env throws before any request', async () => {
  let fetched = false
  globalThis.fetch = async () => {
    fetched = true
    return sseResponse([])
  }
  const { openaiTranslate } = await import('../lib/openai.js')
  const endpoint = { baseUrl: 'http://127.0.0.1:9/v1', model: 'm', apiKeyEnv: 'DSH_TRANSLATE_TEST_MISSING_KEY' }
  delete process.env.DSH_TRANSLATE_TEST_MISSING_KEY
  await assert.rejects(
    async () => {
      for await (const ev of openaiTranslate(endpoint, 'x', 'ru', undefined)) void ev
    },
    /DSH_TRANSLATE_TEST_MISSING_KEY is not set/,
  )
  assert.equal(fetched, false)
})

test('api key env is sent as bearer header', async () => {
  calls = []
  process.env.DSH_TRANSLATE_TEST_PRESENT_KEY = 'secret-value'
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return sseResponse(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n'])
  }
  const { openaiTranslate } = await import('../lib/openai.js')
  const endpoint = {
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'm',
    apiKeyEnv: 'DSH_TRANSLATE_TEST_PRESENT_KEY',
  }
  const events = await collect(openaiTranslate(endpoint, 'Hello', 'ru', undefined))
  assert.equal(events[events.length - 1].translation, 'Hi')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-value')
  delete process.env.DSH_TRANSLATE_TEST_PRESENT_KEY
})

test('provider error payload mid stream throws', async () => {
  globalThis.fetch = async () => sseResponse(['data: {"error":{"message":"quota spent"}}\n\n'])
  const { openaiTranslate } = await import('../lib/openai.js')
  await assert.rejects(
    async () => {
      for await (const ev of openaiTranslate({ baseUrl: 'http://127.0.0.1:9/v1', model: 'm' }, 'x', 'ru', undefined)) {
        void ev
      }
    },
    /quota spent/,
  )
})

test('final sse data line without trailing newline is not dropped', async () => {
  globalThis.fetch = async () =>
    sseResponse(['data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}'])
  const { openaiTranslate } = await import('../lib/openai.js')
  const events = await collect(openaiTranslate({ baseUrl: 'http://127.0.0.1:9/v1', model: 'm' }, 'Hello', 'ru', undefined))
  assert.deepEqual(events, [
    { meta: { provider: 'openai', model: 'm' } },
    { delta: 'Hel' },
    { delta: 'lo' },
    { done: true, translation: 'Hello', detected: '' },
  ])
})

test('final done marker without trailing newline ends the stream cleanly', async () => {
  globalThis.fetch = async () => sseResponse(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]'])
  const { openaiTranslate } = await import('../lib/openai.js')
  const events = await collect(openaiTranslate({ baseUrl: 'http://127.0.0.1:9/v1', model: 'm' }, 'Hello', 'ru', undefined))
  assert.equal(events[events.length - 1].translation, 'Hi')
})

test('runaway output is cut off instead of growing memory', async () => {
  const big = 'x'.repeat(60000)
  globalThis.fetch = async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"' + big + '"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"' + big + '"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"' + big + '"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"' + big + '"}}]}\n\n',
    ])
  const { openaiTranslate } = await import('../lib/openai.js')
  await assert.rejects(
    async () => {
      for await (const ev of openaiTranslate({ baseUrl: 'http://127.0.0.1:9/v1', model: 'm' }, 'x', 'ru', undefined)) {
        void ev
      }
    },
    /translation too large/,
  )
})
