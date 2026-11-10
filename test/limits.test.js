import test from 'node:test'
import assert from 'node:assert/strict'
import { readBodyCapped, readJsonCapped } from '../lib/limits.js'

function streamResponse(chunks) {
  let i = 0
  const events = { cancelled: 0, released: 0 }
  return {
    events,
    body: {
      getReader() {
        return {
          read: async () =>
            i < chunks.length ? { done: false, value: new TextEncoder().encode(chunks[i++]) } : { done: true },
          cancel: async () => {
            events.cancelled += 1
          },
          releaseLock: () => {
            events.released += 1
          },
        }
      },
    },
  }
}

test('body under the cap is returned whole', async () => {
  assert.equal(await readBodyCapped(streamResponse(['ab', 'cd']), 10), 'abcd')
})

test('body over the cap is rejected and the stream is cancelled', async () => {
  const res = streamResponse(['abcdef', 'ghijkl'])
  await assert.rejects(readBodyCapped(res, 8), /response too large/)
  assert.equal(res.events.cancelled, 1)
  assert.equal(res.events.released, 1)
})

test('capped json parse works on a split body', async () => {
  assert.deepEqual(await readJsonCapped(streamResponse(['{"a":', '1}']), 100), { a: 1 })
})
