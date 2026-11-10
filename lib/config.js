import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CONFIG_DIR = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_FILE = path.join(CONFIG_DIR, '.dsh-translate-card.json')

const BACKEND_IDS = new Set(['llm', 'openai', 'google', 'libretranslate', 'bing'])
const TOP_LEVEL_KEYS = new Set(['to', 'enabled', 'backends', 'backend', 'llm', 'openai', 'libretranslate', 'timeoutMs', 'skipTargetLanguage', 'trigger', 'hotkey'])
const LLM_KEYS = new Set(['provider', 'model'])
const ENDPOINT_KEYS = new Set(['baseUrl', 'model', 'apiKeyEnv'])
const API_KEY_ENV_RE = /^[A-Z][A-Z0-9_]*_API_KEY$/
const TRIGGER_VALUES = new Set(['button', 'auto'])
const HOTKEY_MODIFIERS = new Set(['mod', 'ctrl', 'control', 'alt', 'option', 'shift', 'meta', 'cmd', 'command', 'win'])
const HOTKEY_KEYS = new Set()
for (let c = 97; c <= 122; c++) HOTKEY_KEYS.add(String.fromCharCode(c))
for (let d = 0; d <= 9; d++) HOTKEY_KEYS.add(String(d))
for (let f = 1; f <= 12; f++) HOTKEY_KEYS.add('f' + f)
const DEFAULT_TIMEOUT_MS = 45000
const FAST_TIMEOUT_MS = 15000

const DEFAULT_CONFIG = {
  to: 'ru',
  enabled: true,
  backends: ['llm'],
  skipTargetLanguage: true,
  trigger: 'button',
  hotkey: 'alt+shift+t',
}

export class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
  }
}

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw new ConfigError('config file is not valid JSON: ' + (err && err.message))
  }
}

function checkKeys(value, allowed, where) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ConfigError(`config ${where}: unknown key "${key}"`)
  }
}

function nonEmptyString(value, where) {
  if (typeof value !== 'string' || value.trim() === '') throw new ConfigError(`config ${where}: non-empty string required`)
  return value.trim()
}

function normalizeBackends(raw) {
  if (raw.backends !== undefined && raw.backend !== undefined) {
    throw new ConfigError('config: "backends" and "backend" are mutually exclusive')
  }
  if (raw.backends !== undefined) {
    if (!Array.isArray(raw.backends) || raw.backends.length === 0) {
      throw new ConfigError('config "backends": non-empty array required')
    }
    const ids = raw.backends.map((id, i) => {
      if (typeof id !== 'string' || !BACKEND_IDS.has(id)) {
        throw new ConfigError(`config "backends[${i}]": expected one of ${[...BACKEND_IDS].join(', ')}`)
      }
      return id
    })
    return ids
  }
  if (raw.backend !== undefined) {
    if (raw.backend === 'auto') return [...DEFAULT_CONFIG.backends]
    if (raw.backend === 'llm' || raw.backend === 'bing') return [raw.backend]
    throw new ConfigError(`config "backend": expected auto, llm or bing, got "${raw.backend}"`)
  }
  return [...DEFAULT_CONFIG.backends]
}

function normalizeHotkey(raw) {
  const spec = raw === undefined ? DEFAULT_CONFIG.hotkey : nonEmptyString(raw, '"hotkey"')
  const normalized = spec.toLowerCase().replace(/\s+/g, '')
  if (normalized === 'off') return 'off'
  const tokens = normalized.split('+').filter(Boolean)
  if (tokens.length !== normalized.split('+').length) {
    throw new ConfigError('config "hotkey": empty token, expected a form like alt+shift+t or off')
  }
  const modifiers = tokens.filter((token) => HOTKEY_MODIFIERS.has(token))
  const keys = tokens.filter((token) => !HOTKEY_MODIFIERS.has(token))
  if (keys.length !== 1) {
    throw new ConfigError('config "hotkey": exactly one key required (a-z, 0-9 or f1-f12)')
  }
  if (!HOTKEY_KEYS.has(keys[0])) {
    throw new ConfigError(`config "hotkey": unsupported key "${keys[0]}", use a-z, 0-9 or f1-f12`)
  }
  const realModifiers = modifiers.filter((token) => token !== 'shift')
  if (realModifiers.length === 0) {
    throw new ConfigError('config "hotkey": at least one modifier other than shift is required')
  }
  if (new Set(modifiers).size !== modifiers.length) {
    throw new ConfigError('config "hotkey": duplicate modifier')
  }
  return modifiers.concat(keys).join('+')
}

function normalizeTrigger(raw) {
  if (raw === undefined) return DEFAULT_CONFIG.trigger
  const value = nonEmptyString(raw, '"trigger"').toLowerCase()
  if (!TRIGGER_VALUES.has(value)) {
    throw new ConfigError(`config "trigger": expected one of ${[...TRIGGER_VALUES].join(', ')}`)
  }
  return value
}

function normalizeLlm(raw) {
  if (raw === undefined) return undefined
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError('config "llm": object required')
  }
  checkKeys(raw, LLM_KEYS, '"llm"')
  const hasProvider = raw.provider !== undefined
  const hasModel = raw.model !== undefined
  if (hasProvider !== hasModel) throw new ConfigError('config "llm": provider and model must be supplied together')
  if (!hasProvider) return undefined
  return { provider: nonEmptyString(raw.provider, '"llm.provider"'), model: nonEmptyString(raw.model, '"llm.model"') }
}

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!h) return false
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m || Number(m[1]) !== 127) return false
  return [m[2], m[3], m[4]].every((x) => Number(x) <= 255)
}

function normalizeEndpoint(raw, where, modelRequired) {
  if (raw === undefined) return undefined
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(`config ${where}: object required`)
  }
  checkKeys(raw, ENDPOINT_KEYS, `"${where}"`)
  const baseUrl = nonEmptyString(raw.baseUrl, `"${where}.baseUrl"`)
  let parsed = null
  try {
    parsed = new URL(baseUrl)
  } catch (err) {
    throw new ConfigError(`config ${where}.baseUrl: valid http(s) URL required`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ConfigError(`config ${where}.baseUrl: http(s) URL required`)
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    throw new ConfigError(`config ${where}.baseUrl: https is required for non-loopback hosts`)
  }
  if (parsed.username || parsed.password) {
    throw new ConfigError(`config ${where}.baseUrl: userinfo is not allowed`)
  }
  const value = { baseUrl: baseUrl.replace(/\/+$/, '') }
  if (raw.model !== undefined) value.model = nonEmptyString(raw.model, `"${where}.model"`)
  if (raw.apiKeyEnv !== undefined) {
    const name = nonEmptyString(raw.apiKeyEnv, `"${where}.apiKeyEnv"`)
    if (!API_KEY_ENV_RE.test(name)) {
      throw new ConfigError(`config ${where}.apiKeyEnv: must be an upper-case name ending in _API_KEY`)
    }
    value.apiKeyEnv = name
  }
  if (modelRequired && value.model === undefined) {
    throw new ConfigError(`config ${where}.model: required for this backend`)
  }
  return value
}

export function readConfig() {
  const raw = readRaw()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError('config: top-level object required')
  }
  checkKeys(raw, TOP_LEVEL_KEYS, 'top level')
  const config = {
    to: raw.to !== undefined ? nonEmptyString(raw.to, '"to"') : DEFAULT_CONFIG.to,
    enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : DEFAULT_CONFIG.enabled,
    skipTargetLanguage:
      raw.skipTargetLanguage !== undefined ? Boolean(raw.skipTargetLanguage) : DEFAULT_CONFIG.skipTargetLanguage,
    trigger: normalizeTrigger(raw.trigger),
    hotkey: normalizeHotkey(raw.hotkey),
    backends: normalizeBackends(raw),
    llm: normalizeLlm(raw.llm),
    openai: normalizeEndpoint(raw.openai, '"openai"', false),
    libretranslate: normalizeEndpoint(raw.libretranslate, '"libretranslate"', false),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }
  if (raw.timeoutMs !== undefined) {
    if (!Number.isInteger(raw.timeoutMs) || raw.timeoutMs < 1000 || raw.timeoutMs > 300000) {
      throw new ConfigError('config "timeoutMs": integer between 1000 and 300000 required')
    }
    config.timeoutMs = raw.timeoutMs
  }
  if (config.openai && config.openai.model === undefined) {
    throw new ConfigError('config: backend "openai" requires an "openai" section with baseUrl and model')
  }
  for (const id of config.backends) {
    if (id === 'openai' && (!config.openai || config.openai.model === undefined)) {
      throw new ConfigError('config: backend "openai" requires an "openai" section with baseUrl and model')
    }
    if (id === 'libretranslate' && !config.libretranslate) {
      throw new ConfigError('config: backend "libretranslate" requires a "libretranslate" section with baseUrl')
    }
  }
  return config
}

export function fastTimeoutMs(config) {
  return Math.min(config.timeoutMs, FAST_TIMEOUT_MS)
}
