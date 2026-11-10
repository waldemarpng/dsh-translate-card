import { MAX_OUTPUT_CHARS } from './limits.js'

const LANG_LABELS = {
  ru: 'Russian',
  en: 'English',
  uk: 'Ukrainian',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  pl: 'Polish',
  nl: 'Dutch',
  tr: 'Turkish',
  ja: 'Japanese',
  ko: 'Korean',
  'zh-hans': 'Simplified Chinese',
  'zh-hant': 'Traditional Chinese',
  zh: 'Chinese',
  ar: 'Arabic',
  hi: 'Hindi',
}

export function service(ctx, name) {
  try {
    const value = ctx.get(name)
    return value === undefined || value === null ? null : value
  } catch (err) {
    return null
  }
}

export function llmRoute(ctx, override) {
  if (override && override.provider && override.model) return override
  const adm = service(ctx, 'agentDefaultModel')
  if (!adm || typeof adm.currentSelection !== 'function') return null
  try {
    const selection = adm.currentSelection()
    if (!selection || !selection.provider || !selection.model) return null
    return selection
  } catch (err) {
    return null
  }
}

export function llmAvailable(ctx, override) {
  return service(ctx, 'llm') !== null && llmRoute(ctx, override) !== null
}

function targetLabel(to) {
  return LANG_LABELS[String(to || '').toLowerCase()] || String(to || 'Russian')
}

export function buildPrompt(text, to) {
  return (
    'Translate the user text into ' +
    targetLabel(to) +
    '. Output only the translation, preserve line breaks. No notes, no transliteration.\n\n' +
    text
  )
}

export async function* llmTranslate(ctx, text, to, signal, override) {
  const llm = service(ctx, 'llm')
  const route = llmRoute(ctx, override)
  if (!llm || typeof llm.stream !== 'function') throw new Error('llm service unavailable')
  if (!route) throw new Error('no model route, configure llm provider and model or pick a model in the GUI')
  yield { meta: { provider: 'llm', model: route.model } }
  let out = ''
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt(text, to) }] }],
    signal,
  })) {
    if (signal && signal.aborted) throw new Error('aborted')
    if (chunk.type === 'text-delta' && chunk.text) {
      out += chunk.text
      if (out.length > MAX_OUTPUT_CHARS) throw new Error('translation too large')
      yield { delta: chunk.text }
    } else if (chunk.type === 'finish') {
      const reason = chunk.reason
      if (reason && (reason.kind === 'error' || reason.kind === 'aborted')) {
        throw new Error((reason.failure && reason.failure.message) || 'model stream ' + reason.kind)
      }
    }
  }
  if (!out.trim()) throw new Error('model returned no translation')
  yield { done: true, translation: out, detected: '' }
}
