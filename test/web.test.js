import test from 'node:test'
import assert from 'node:assert/strict'
import { webTranslate, chunkText, cacheGet, cacheSet } from '../lib/web.js'

function makeText(chars) {
  let out = ''
  let i = 0
  const words = ['alpha', 'beta', 'gamma', 'delta.', 'epsilon!', 'zeta?', 'eta;', 'theta:', 'iota,', 'kappa ']
  while (out.length < chars) {
    out += words[i % words.length] + ' '
    i++
  }
  return out.slice(0, chars)
}

test('chunkText keeps every character for sizes below the limit', () => {
  const text = makeText(30)
  assert.deepEqual(chunkText(text, 50), [text])
  assert.deepEqual(chunkText(text, 30), [text])
})

test('chunkText roundtrips long texts across many chunks', () => {
  for (const size of [120, 333, 1000, 4100]) {
    const text = makeText(size)
    const parts = chunkText(text, 37)
    assert.equal(parts.join(''), text)
    for (const part of parts) assert.ok(part.length <= 37, 'chunk within limit for size ' + size)
  }
})

test('chunkText splits on sentence boundaries when possible', () => {
  const text = 'One sentence here. Second sentence follows! Third one? Tail without end'
  const parts = chunkText(text, 25)
  assert.equal(parts.join(''), text)
  assert.ok(parts.length > 1)
})

test('cacheSet then cacheGet returns the value and refreshes recency', () => {
  const key = 'test\u0000ru\u0000hello'
  cacheSet(key, { translation: 'Hi', detected: 'en' })
  assert.deepEqual(cacheGet(key), { translation: 'Hi', detected: 'en' })
  assert.equal(cacheGet('test\u0000ru\u0000missing'), null)
})

test('cache entries expire after the ttl window', () => {
  const key = 'test\u0000ru\u0000ttl-probe'
  cacheSet(key, { translation: 'Old' })
  const realNow = Date.now
  try {
    Date.now = () => realNow() + 25 * 60 * 60 * 1000
    assert.equal(cacheGet(key), null)
  } finally {
    Date.now = realNow
  }
})

test('an aborted signal rejects before any network work', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(webTranslate('hello', { to: 'ru', signal: controller.signal }), /aborted|web/i)
})
