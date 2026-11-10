import { buildPrompt } from './llm.js'
import { MAX_OUTPUT_CHARS, MAX_SSE_LINE_CHARS, readBodyCapped } from './limits.js'

function readApiKey(endpoint) {
  if (!endpoint.apiKeyEnv) return null
  const key = process.env[endpoint.apiKeyEnv]
  if (!key || !key.trim()) {
    throw new Error(`environment variable ${endpoint.apiKeyEnv} is not set`)
  }
  return key.trim()
}

async function* sseLines(res, signal) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  function* emit(line) {
    const trimmed = line.trim()
    if (trimmed.startsWith('data:')) yield trimmed.slice(5).trim()
  }
  try {
    for (;;) {
      if (signal && signal.aborted) throw new Error('aborted')
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      if (buffer.length > MAX_SSE_LINE_CHARS) throw new Error('stream line too large')
      for (const line of lines) yield* emit(line)
    }
    buffer += decoder.decode()
    for (const line of buffer.split('\n')) yield* emit(line)
  } finally {
    try {
      await reader.cancel()
    } catch (err) {}
    try {
      reader.releaseLock()
    } catch (err) {}
  }
}

export async function* openaiTranslate(endpoint, text, to, signal) {
  const apiKey = readApiKey(endpoint)
  const model = endpoint.model
  const url = endpoint.baseUrl + '/chat/completions'
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey
  const body = JSON.stringify({
    model,
    stream: true,
    temperature: 0,
    messages: [{ role: 'user', content: buildPrompt(text, to) }],
  })
  let res
  try {
    res = await fetch(url, { method: 'POST', headers, body, signal, redirect: 'error' })
  } catch (err) {
    if (signal && signal.aborted) throw new Error('aborted')
    throw new Error('endpoint unreachable or refused a redirect: check baseUrl')
  }
  if (!res.ok || !res.body) {
    const detail = await readBodyCapped(res, 4096).catch(() => '')
    throw new Error(`HTTP ${res.status}${detail ? ': ' + detail.slice(0, 180) : ''}`)
  }
  yield { meta: { provider: 'openai', model } }
  let out = ''
  for await (const data of sseLines(res, signal)) {
    if (data === '[DONE]') break
    let json
    try {
      json = JSON.parse(data)
    } catch (err) {
      continue
    }
    if (json.error) throw new Error(json.error.message || 'provider error')
    const choice = json.choices && json.choices[0]
    const piece = choice && choice.delta && choice.delta.content
    if (piece) {
      out += piece
      if (out.length > MAX_OUTPUT_CHARS) throw new Error('translation too large')
      yield { delta: piece }
    }
  }
  if (!out.trim()) throw new Error('model returned no translation')
  yield { done: true, translation: out, detected: '' }
}
