import test from 'node:test'
import assert from 'node:assert/strict'
import { runChain } from '../lib/chain.js'

async function collect(gen) {
  const out = []
  for await (const ev of gen) out.push(ev)
  return out
}

function entry(id, steps) {
  const state = { started: false }
  return {
    state,
    id,
    run: async function* () {
      state.started = true
      for (const step of steps) {
        if (step.throw) throw new Error(step.throw)
        yield step.yield
      }
    },
  }
}

test('success passes events through and stops the chain', async () => {
  const second = entry('second', [{ yield: { done: true, translation: 'nope' } }])
  const first = entry('first', [
    { yield: { meta: { provider: 'first', model: 'm1' } } },
    { yield: { delta: 'He' } },
    { yield: { delta: 'llo' } },
    { yield: { done: true, translation: 'Hello', detected: '' } },
  ])
  const events = await collect(runChain([first, second]))
  assert.deepEqual(events, [
    { meta: { provider: 'first', model: 'm1' } },
    { delta: 'He' },
    { delta: 'llo' },
    { done: true, translation: 'Hello', detected: '' },
  ])
  assert.equal(second.state.started, false)
})

test('failure before first streaming event falls back with meta', async () => {
  const first = entry('first', [{ throw: 'boom before stream' }])
  const second = entry('second', [
    { yield: { meta: { provider: 'second' } } },
    { yield: { translation: 'Hello', detected: 'en' } },
    { yield: { done: true, translation: 'Hello', detected: 'en' } },
  ])
  const events = await collect(runChain([first, second]))
  assert.equal(events[0].meta.fallback, 'second')
  assert.equal(second.state.started, true)
  assert.equal(events[events.length - 1].done, true)
})

test('failure after meta but before streaming still falls back', async () => {
  const first = entry('first', [{ yield: { meta: { provider: 'first' } } }, { throw: 'dead before tokens' }])
  const second = entry('second', [{ yield: { translation: 'Hi', detected: 'en' } }])
  const events = await collect(runChain([first, second]))
  assert.ok(events.some((ev) => ev.meta && ev.meta.fallback === 'second'))
  const last = events[events.length - 1]
  assert.equal(last.done, true)
  assert.equal(last.translation, 'Hi')
})

test('failure after first delta is terminal and stops the chain', async () => {
  const second = entry('second', [{ yield: { translation: 'never' } }])
  const first = entry('first', [
    { yield: { meta: { provider: 'first' } } },
    { yield: { delta: 'par' } },
    { throw: 'mid stream failure' },
  ])
  const events = await collect(runChain([first, second]))
  assert.deepEqual(events, [
    { meta: { provider: 'first' } },
    { delta: 'par' },
    { error: 'mid stream failure' },
  ])
  assert.equal(second.state.started, false)
})

test('exhausted chain yields a single error listing every failure', async () => {
  const first = entry('first', [{ throw: 'e-one' }])
  const second = entry('second', [{ throw: 'e-two' }])
  const events = await collect(runChain([first, second]))
  const errors = events.filter((ev) => ev.error !== undefined)
  assert.deepEqual(errors, [{ error: 'first: e-one; second: e-two' }])
  assert.ok(events.some((ev) => ev.meta && ev.meta.fallback === 'second'))
})

test('single failing entry yields error without fallback meta', async () => {
  const only = entry('only', [{ throw: 'e-single' }])
  const events = await collect(runChain([only]))
  assert.deepEqual(events, [{ error: 'only: e-single' }])
})

test('generator ending after translation event gets a synthesized done', async () => {
  const only = entry('only', [
    { yield: { meta: { provider: 'only' } } },
    { yield: { translation: 'Hello there', detected: 'en' } },
  ])
  const events = await collect(runChain([only]))
  assert.deepEqual(events, [
    { meta: { provider: 'only' } },
    { translation: 'Hello there', detected: 'en' },
    { done: true, translation: 'Hello there', detected: 'en' },
  ])
})

test('generator ending without translation or done counts as failure', async () => {
  const first = entry('first', [{ yield: { meta: { provider: 'first' } } }])
  const second = entry('second', [{ yield: { translation: 'Hi', detected: '' } }])
  const events = await collect(runChain([first, second]))
  assert.ok(events.some((ev) => ev.meta && ev.meta.fallback === 'second'))
  assert.equal(events[events.length - 1].done, true)
})

test('empty chain yields an error', async () => {
  const events = await collect(runChain([]))
  assert.deepEqual(events, [{ error: 'no backends configured' }])
})

test('sync throw in run is treated as pre-stream failure', async () => {
  const first = {
    id: 'first',
    run: () => {
      throw new Error('sync blow up')
    },
  }
  const second = entry('second', [{ yield: { translation: 'Hi', detected: '' } }])
  const events = await collect(runChain([first, second]))
  assert.equal(events[0].meta.fallback, 'second')
  assert.equal(events[events.length - 1].translation, 'Hi')
})

test('generator ending after delta is a terminal error without fallback', async () => {
  const second = entry('second', [{ yield: { done: true, translation: 'never' } }])
  const first = entry('first', [{ yield: { meta: { provider: 'first' } } }, { yield: { delta: 'par' } }])
  const events = await collect(runChain([first, second]))
  assert.deepEqual(events, [
    { meta: { provider: 'first' } },
    { delta: 'par' },
    { error: 'first: stream ended without a translation' },
  ])
  assert.equal(second.state.started, false)
})
