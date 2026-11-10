export async function* runChain(entries) {
  if (!entries || entries.length === 0) {
    yield { error: 'no backends configured' }
    return
  }
  const failures = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (failures.length > 0) yield { meta: { fallback: entry.id } }
    let streamed = false
    let translationEvent = null
    try {
      for await (const ev of entry.run()) {
        if (ev === null || ev === undefined) continue
        if (ev.error !== undefined) {
          yield ev
          return
        }
        if (ev.delta !== undefined) streamed = true
        if (ev.translation !== undefined) {
          streamed = true
          translationEvent = ev
        }
        yield ev
        if (ev.done) return
      }
    } catch (err) {
      if (streamed) {
        yield { error: (err && err.message) || String(err) }
        return
      }
      failures.push(entry.id + ': ' + ((err && err.message) || String(err)))
      continue
    }
    if (translationEvent) {
      yield { done: true, translation: translationEvent.translation, detected: translationEvent.detected || '' }
      return
    }
    if (streamed) {
      yield { error: entry.id + ': stream ended without a translation' }
      return
    }
    failures.push(entry.id + ': stream ended without a translation')
  }
  yield { error: failures.join('; ') }
}
