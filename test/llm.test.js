import test from 'node:test'
import assert from 'node:assert/strict'
import { llmTranslate, llmAvailable, buildPrompt } from '../lib/llm.js'

function makeCtx({ stream, selection }) {
  return {
    get(name) {
      if (name === 'llm') return stream === undefined ? null : { stream }
      if (name === 'agentDefaultModel') {
        return selection === undefined ? undefined : { currentSelection: () => selection }
      }
      return undefined
    },
  }
}

async function collect(gen) {
  const out = []
  for await (const ev of gen) out.push(ev)
  return out
}

test('stub stream yields meta, deltas and done with full text', async () => {
  let captured = null
  const stream = async function* (params) {
    captured = params
    yield { type: 'text-delta', text: 'Hel' }
    yield { type: 'text-delta', text: 'lo' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const ctx = makeCtx({ stream, selection: { provider: 'p1', model: 'm1' } })
  const events = await collect(llmTranslate(ctx, 'Hello', 'ru', undefined))
  assert.deepEqual(events, [
    { meta: { provider: 'llm', model: 'm1' } },
    { delta: 'Hel' },
    { delta: 'lo' },
    { done: true, translation: 'Hello', detected: '' },
  ])
  assert.equal(captured.provider, 'p1')
  assert.equal(captured.model, 'm1')
  assert.match(captured.messages[0].content[0].text, /into Russian/)
})

test('override wins over agentDefaultModel selection', async () => {
  let captured = null
  const stream = async function* (params) {
    captured = params
    yield { type: 'text-delta', text: 'Hi' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const ctx = makeCtx({ stream, selection: { provider: 'p1', model: 'm1' } })
  const override = { provider: 'p2', model: 'm2' }
  const events = await collect(llmTranslate(ctx, 'Hi', 'ru', undefined, override))
  assert.equal(events[0].meta.model, 'm2')
  assert.equal(captured.provider, 'p2')
  assert.equal(captured.model, 'm2')
})

test('finish reason error throws the failure message', async () => {
  const stream = async function* () {
    yield { type: 'text-delta', text: 'par' }
    yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom quota' } } }
  }
  const ctx = makeCtx({ stream, selection: { provider: 'p1', model: 'm1' } })
  await assert.rejects(
    async () => {
      for await (const ev of llmTranslate(ctx, 'x', 'ru', undefined)) void ev
    },
    /boom quota/,
  )
})

test('missing llm service throws before any event', async () => {
  const ctx = makeCtx({ stream: undefined, selection: { provider: 'p1', model: 'm1' } })
  await assert.rejects(
    async () => {
      for await (const ev of llmTranslate(ctx, 'x', 'ru', undefined)) void ev
    },
    /llm service unavailable/,
  )
})

test('missing model route throws with a hint', async () => {
  const stream = async function* () {
    yield { type: 'text-delta', text: 'Hi' }
  }
  const ctx = makeCtx({ stream, selection: undefined })
  await assert.rejects(
    async () => {
      for await (const ev of llmTranslate(ctx, 'x', 'ru', undefined)) void ev
    },
    /no model route/,
  )
})

test('empty model output throws', async () => {
  const stream = async function* () {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const ctx = makeCtx({ stream, selection: { provider: 'p1', model: 'm1' } })
  await assert.rejects(
    async () => {
      for await (const ev of llmTranslate(ctx, 'x', 'ru', undefined)) void ev
    },
    /no translation/,
  )
})

test('llmAvailable reflects service and route presence', () => {
  const stream = async function* () {}
  assert.equal(llmAvailable(makeCtx({ stream, selection: { provider: 'p', model: 'm' } })), true)
  assert.equal(llmAvailable(makeCtx({ stream, selection: undefined })), false)
  assert.equal(llmAvailable(makeCtx({ stream: undefined, selection: { provider: 'p', model: 'm' } })), false)
  assert.equal(
    llmAvailable(makeCtx({ stream, selection: undefined }), { provider: 'p2', model: 'm2' }),
    true,
  )
})

test('buildPrompt names the target language', () => {
  assert.match(buildPrompt('Hello', 'ru'), /into Russian/)
  assert.match(buildPrompt('Hello', 'de'), /into German/)
  assert.match(buildPrompt('Hello', 'xx'), /into xx/)
  assert.match(buildPrompt('Hello', 'ru'), /Hello/)
})
