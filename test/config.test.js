import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP_ROOT = path.join(REPO, '.tmp', 'config-fixtures')
fs.mkdirSync(TMP_ROOT, { recursive: true })

let counter = 0

async function loadConfigModule(jsonText, fileName = '.dsh-translate-card.json') {
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'case-'))
  if (jsonText !== null) fs.writeFileSync(path.join(dir, fileName), jsonText)
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const mod = await import(pathToFileURL(path.join(REPO, 'lib', 'config.js')).href + '?case=' + counter++)
    return mod
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
  }
}

test.after(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

test('skipTargetLanguage defaults to true and accepts false', async () => {
  const { readConfig } = await loadConfigModule(null)
  assert.equal(readConfig().skipTargetLanguage, true)
  const { readConfig: readFalse } = await loadConfigModule(JSON.stringify({ skipTargetLanguage: false }))
  assert.equal(readFalse().skipTargetLanguage, false)
})

test('missing config file yields defaults', async () => {
  const { readConfig, fastTimeoutMs } = await loadConfigModule(null)
  const config = readConfig()
  assert.equal(config.to, 'ru')
  assert.equal(config.enabled, true)
  assert.deepEqual(config.backends, ['llm'])
  assert.equal(config.timeoutMs, 45000)
  assert.equal(config.llm, undefined)
  assert.equal(config.openai, undefined)
  assert.equal(config.libretranslate, undefined)
  assert.equal(fastTimeoutMs(config), 15000)
})

test('legacy backend auto maps to the private default chain', async () => {
  const { readConfig } = await loadConfigModule(JSON.stringify({ backend: 'auto' }))
  assert.deepEqual(readConfig().backends, ['llm'])
})

test('legacy single backend values map to one entry chains', async () => {
  const llmOnly = await loadConfigModule(JSON.stringify({ backend: 'llm' }))
  assert.deepEqual(llmOnly.readConfig().backends, ['llm'])
  const bingOnly = await loadConfigModule(JSON.stringify({ backend: 'bing' }))
  assert.deepEqual(bingOnly.readConfig().backends, ['bing'])
})

test('backends and backend are mutually exclusive', async () => {
  const { readConfig, ConfigError } = await loadConfigModule(
    JSON.stringify({ backend: 'auto', backends: ['llm'] }),
  )
  assert.throws(() => readConfig(), (err) => err instanceof ConfigError && /mutually exclusive/.test(err.message))
})

test('unknown top level key fails fast', async () => {
  const { readConfig, ConfigError } = await loadConfigModule(JSON.stringify({ to: 'ru', banan: true }))
  assert.throws(() => readConfig(), (err) => err instanceof ConfigError && /unknown key "banan"/.test(err.message))
})

test('unknown backend id in backends fails', async () => {
  const { readConfig } = await loadConfigModule(JSON.stringify({ backends: ['llm', 'yandex'] }))
  assert.throws(() => readConfig(), /expected one of/)
})

test('empty backends array fails', async () => {
  const { readConfig } = await loadConfigModule(JSON.stringify({ backends: [] }))
  assert.throws(() => readConfig(), /non-empty array required/)
})

test('openai backend without section fails', async () => {
  const { readConfig } = await loadConfigModule(JSON.stringify({ backends: ['openai'] }))
  assert.throws(() => readConfig(), /requires an "openai" section/)
})

test('openai backend without model fails', async () => {
  const { readConfig } = await loadConfigModule(
    JSON.stringify({ backends: ['openai'], openai: { baseUrl: 'http://127.0.0.1:11434/v1' } }),
  )
  assert.throws(() => readConfig(), /requires an "openai" section with baseUrl and model/)
})

test('openai section with baseUrl and model is accepted and trimmed', async () => {
  const { readConfig } = await loadConfigModule(
    JSON.stringify({
      backends: ['openai'],
      openai: { baseUrl: 'http://127.0.0.1:11434/v1/', model: 'qwen3:1.7b', apiKeyEnv: 'OLLAMA_API_KEY' },
    }),
  )
  const config = readConfig()
  assert.equal(config.openai.baseUrl, 'http://127.0.0.1:11434/v1')
  assert.equal(config.openai.model, 'qwen3:1.7b')
  assert.equal(config.openai.apiKeyEnv, 'OLLAMA_API_KEY')
})

test('openai section requires an http url', async () => {
  const { readConfig } = await loadConfigModule(
    JSON.stringify({ openai: { baseUrl: 'ftp://host', model: 'm' } }),
  )
  assert.throws(() => readConfig(), /http\(s\) URL required/)
})

test('libretranslate backend without section fails', async () => {
  const { readConfig } = await loadConfigModule(JSON.stringify({ backends: ['libretranslate'] }))
  assert.throws(() => readConfig(), /requires a "libretranslate" section/)
})

test('libretranslate section with baseUrl only is accepted', async () => {
  const { readConfig } = await loadConfigModule(
    JSON.stringify({ backends: ['libretranslate'], libretranslate: { baseUrl: 'http://127.0.0.1:5000' } }),
  )
  assert.equal(readConfig().libretranslate.baseUrl, 'http://127.0.0.1:5000')
})

test('llm section needs provider and model together', async () => {
  const half = await loadConfigModule(JSON.stringify({ llm: { provider: 'deepseek' } }))
  assert.throws(() => half.readConfig(), /provider and model must be supplied together/)
  const full = await loadConfigModule(
    JSON.stringify({ llm: { provider: ' deepseek ', model: ' chat-model ' } }),
  )
  const config = full.readConfig()
  assert.deepEqual(config.llm, { provider: 'deepseek', model: 'chat-model' })
})

test('timeoutMs bounds are enforced', async () => {
  const tooSmall = await loadConfigModule(JSON.stringify({ timeoutMs: 999 }))
  assert.throws(() => tooSmall.readConfig(), /between 1000 and 300000/)
  const tooBig = await loadConfigModule(JSON.stringify({ timeoutMs: 300001 }))
  assert.throws(() => tooBig.readConfig(), /between 1000 and 300000/)
  const notInt = await loadConfigModule(JSON.stringify({ timeoutMs: 1500.5 }))
  assert.throws(() => notInt.readConfig(), /between 1000 and 300000/)
  const lowerEdge = await loadConfigModule(JSON.stringify({ timeoutMs: 1000 }))
  assert.equal(lowerEdge.readConfig().timeoutMs, 1000)
  const upperEdge = await loadConfigModule(JSON.stringify({ timeoutMs: 300000 }))
  assert.equal(upperEdge.readConfig().timeoutMs, 300000)
})

test('fastTimeoutMs is capped at 15000', async () => {
  const { readConfig, fastTimeoutMs } = await loadConfigModule(JSON.stringify({ timeoutMs: 120000 }))
  assert.equal(fastTimeoutMs(readConfig()), 15000)
  const small = await loadConfigModule(JSON.stringify({ timeoutMs: 3000 }))
  assert.equal(small.fastTimeoutMs(small.readConfig()), 3000)
})

test('invalid json config file raises ConfigError', async () => {
  const { readConfig, ConfigError } = await loadConfigModule('{ not json')
  assert.throws(() => readConfig(), (err) => err instanceof ConfigError && /not valid JSON/.test(err.message))
})

test('custom chain order is preserved', async () => {
  const { readConfig } = await loadConfigModule(
    JSON.stringify({ backends: ['google', 'openai', 'llm', 'libretranslate', 'bing'], openai: { baseUrl: 'http://127.0.0.1:9/v1', model: 'm' }, libretranslate: { baseUrl: 'http://127.0.0.1:5000' } }),
  )
  assert.deepEqual(readConfig().backends, ['google', 'openai', 'llm', 'libretranslate', 'bing'])
})

test('openai section without model fails even when not in backends', async () => {
  const { readConfig } = await loadConfigModule(
    JSON.stringify({ backends: ['bing'], openai: { baseUrl: 'http://127.0.0.1:11434/v1' } }),
  )
  assert.throws(() => readConfig(), /requires an "openai" section with baseUrl and model/)
})

test('remote http baseUrl is rejected to keep api keys off plaintext transports', async () => {
  const { readConfig } = await loadConfigModule(
    JSON.stringify({ backends: ['openai'], openai: { baseUrl: 'http://api.example.com/v1', model: 'm' } }),
  )
  assert.throws(() => readConfig(), /https is required for non-loopback hosts/)
})

test('https remote baseUrl is accepted', async () => {
  const { readConfig } = await loadConfigModule(
    JSON.stringify({ backends: ['openai'], openai: { baseUrl: 'https://api.example.com/v1', model: 'm' } }),
  )
  assert.equal(readConfig().openai.baseUrl, 'https://api.example.com/v1')
})

test('loopback http baseUrl is accepted', async () => {
  const { readConfig } = await loadConfigModule(
    JSON.stringify({ backends: ['libretranslate'], libretranslate: { baseUrl: 'http://127.0.0.1:5000' } }),
  )
  assert.equal(readConfig().libretranslate.baseUrl, 'http://127.0.0.1:5000')
})

test('localhost and ::1 count as loopback', async () => {
  const a = await loadConfigModule(
    JSON.stringify({ backends: ['libretranslate'], libretranslate: { baseUrl: 'http://localhost:5000' } }),
  )
  assert.equal(a.readConfig().libretranslate.baseUrl, 'http://localhost:5000')
  const b = await loadConfigModule(
    JSON.stringify({ backends: ['libretranslate'], libretranslate: { baseUrl: 'http://[::1]:5000' } }),
  )
  assert.equal(b.readConfig().libretranslate.baseUrl, 'http://[::1]:5000')
})

test('apiKeyEnv must look like a key variable name', async () => {
  const bad = await loadConfigModule(
    JSON.stringify({ backends: ['openai'], openai: { baseUrl: 'https://api.example.com/v1', model: 'm', apiKeyEnv: 'HOME' } }),
  )
  assert.throws(() => bad.readConfig(), /must be an upper-case name ending in _API_KEY/)
  const lower = await loadConfigModule(
    JSON.stringify({ backends: ['openai'], openai: { baseUrl: 'https://api.example.com/v1', model: 'm', apiKeyEnv: 'openai_api_key' } }),
  )
  assert.throws(() => lower.readConfig(), /must be an upper-case name/)
  const good = await loadConfigModule(
    JSON.stringify({ backends: ['openai'], openai: { baseUrl: 'https://api.example.com/v1', model: 'm', apiKeyEnv: 'OPENROUTER_API_KEY' } }),
  )
  assert.equal(good.readConfig().openai.apiKeyEnv, 'OPENROUTER_API_KEY')
})

test('trigger defaults to button and accepts auto', async () => {
  const defaults = await loadConfigModule(null)
  assert.equal(defaults.readConfig().trigger, 'button')
  const auto = await loadConfigModule(JSON.stringify({ trigger: 'auto' }))
  assert.equal(auto.readConfig().trigger, 'auto')
  const bad = await loadConfigModule(JSON.stringify({ trigger: 'hover' }))
  assert.throws(() => bad.readConfig(), /config "trigger": expected one of button, auto/)
})

test('hotkey defaults, accepts mod and function keys, rejects invalid specs', async () => {
  const defaults = await loadConfigModule(null)
  assert.equal(defaults.readConfig().hotkey, 'alt+shift+t')

  const mod = await loadConfigModule(JSON.stringify({ hotkey: 'MOD+Shift+T' }))
  assert.equal(mod.readConfig().hotkey, 'mod+shift+t')

  const fn = await loadConfigModule(JSON.stringify({ hotkey: 'ctrl+alt+f9' }))
  assert.equal(fn.readConfig().hotkey, 'ctrl+alt+f9')

  const off = await loadConfigModule(JSON.stringify({ hotkey: 'off' }))
  assert.equal(off.readConfig().hotkey, 'off')

  const shiftOnly = await loadConfigModule(JSON.stringify({ hotkey: 'shift+t' }))
  assert.throws(() => shiftOnly.readConfig(), /at least one modifier other than shift/)

  const noKey = await loadConfigModule(JSON.stringify({ hotkey: 'alt+shift' }))
  assert.throws(() => noKey.readConfig(), /exactly one key required/)

  const badKey = await loadConfigModule(JSON.stringify({ hotkey: 'alt+shift+space' }))
  assert.throws(() => badKey.readConfig(), /unsupported key/)

  const unknownMod = await loadConfigModule(JSON.stringify({ hotkey: 'hyper+t' }))
  assert.throws(() => unknownMod.readConfig(), /exactly one key required/)
})

test('baseUrl with userinfo is rejected', async () => {
  const at = String.fromCharCode(64)
  const remote = await loadConfigModule(
    JSON.stringify({ backends: ['openai'], openai: { baseUrl: 'https://user:secret' + at + 'api.example.com/v1', model: 'm' } }),
  )
  assert.throws(() => remote.readConfig(), /userinfo is not allowed/)
  const loopback = await loadConfigModule(
    JSON.stringify({ backends: ['libretranslate'], libretranslate: { baseUrl: 'http://user' + at + '127.0.0.1:5000' } }),
  )
  assert.throws(() => loopback.readConfig(), /userinfo is not allowed/)
  const sneaky = await loadConfigModule(
    JSON.stringify({ backends: ['openai'], openai: { baseUrl: 'http://127.0.0.1' + at + 'evil.example/v1', model: 'm' } }),
  )
  assert.throws(() => sneaky.readConfig())
})

test('apiKeyEnv only accepts names ending in _API_KEY', async () => {
  for (const name of ['GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'HOME']) {
    const mod = await loadConfigModule(
      JSON.stringify({ backends: ['openai'], openai: { baseUrl: 'https://api.example.com/v1', model: 'm', apiKeyEnv: name } }),
    )
    assert.throws(() => mod.readConfig(), /must be an upper-case name ending in _API_KEY/, name + ' should be rejected')
  }
  const ok = await loadConfigModule(
    JSON.stringify({ backends: ['openai'], openai: { baseUrl: 'https://api.example.com/v1', model: 'm', apiKeyEnv: 'OPENROUTER_API_KEY' } }),
  )
  assert.equal(ok.readConfig().openai.apiKeyEnv, 'OPENROUTER_API_KEY')
})
