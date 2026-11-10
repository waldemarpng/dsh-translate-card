export const MAX_OUTPUT_CHARS = 200000
export const MAX_BODY_BYTES = 1048576
export const MAX_SSE_LINE_CHARS = 262144

export async function readBodyCapped(res, limit = MAX_BODY_BYTES) {
  if (!res.body || typeof res.body.getReader !== 'function') return res.text()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let out = ''
  let failed = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        failed = true
        throw new Error('response too large')
      }
      out += decoder.decode(value, { stream: true })
    }
    return out + decoder.decode()
  } finally {
    try {
      if (failed) await reader.cancel()
    } catch (err) {}
    try {
      reader.releaseLock()
    } catch (err) {}
  }
}

export async function readJsonCapped(res, limit = MAX_BODY_BYTES) {
  if (!res.body || typeof res.body.getReader !== 'function') return res.json()
  return JSON.parse(await readBodyCapped(res, limit))
}
