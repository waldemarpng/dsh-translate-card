import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const noop = () => undefined

function makeElement() {
  const element = {
    style: new Object(),
    children: [],
    listeners: new Object(),
    textContent: '',
    innerHTML: '',
    className: '',
    type: '',
    isConnected: true,
    offsetWidth: 120,
    offsetHeight: 26,
    setAttribute(name, value) {
      element[name] = value
    },
    removeAttribute(name) {
      delete element[name]
    },
    appendChild(child) {
      element.children.push(child)
      return child
    },
    addEventListener(type, fn) {
      element.listeners[type] = fn
    },
    querySelector() {
      return makeElement()
    },
    contains() {
      return false
    },
    closest() {
      return null
    },
  }
  return element
}

function boot(options = {}) {
  const src = fs.readFileSync(path.join(REPO, 'assets', 'translate.js'), 'utf8')
  const listeners = new Object()
  const created = []
  const requests = []
  const document = {
    head: makeElement(),
    body: makeElement(),
    documentElement: { getAttribute: () => '', className: '' },
    getElementById: () => null,
    createElement: () => {
      const element = makeElement()
      created.push(element)
      return element
    },
    addEventListener: (type, fn) => {
      listeners[type] = fn
    },
    getSelection: () => ({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => options.selection || 'Hello world',
      getRangeAt: () => ({
        startContainer: { nodeType: 1, closest: () => null },
        getClientRects: () => [{ left: 10, top: 10, right: 90, bottom: 30, width: 80, height: 20 }],
        getBoundingClientRect: () => ({ left: 10, top: 10, right: 90, bottom: 30, width: 80, height: 20 }),
      }),
    }),
  }
  const platform = options.mac ? 'MacIntel' : 'Win32'
  const ctx = {
    window: {
      addEventListener: noop,
      matchMedia: () => ({ matches: false, addEventListener: noop }),
      innerWidth: 1000,
      innerHeight: 800,
      getSelection: () => document.getSelection(),
    },
    document,
    navigator: { platform, userAgent: platform === 'MacIntel' ? 'Macintosh' : 'Windows' },
    AbortController,
    TextDecoder,
    fetch: (url) => {
      const target = String(url)
      if (target.endsWith('/dsh-translate-card/config')) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, config: options.config || {} }) })
      }
      requests.push(target)
      return new Promise(noop)
    },
    setTimeout: (fn) => {
      fn()
      return 1
    },
    clearTimeout: noop,
  }
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  const settled = new Promise((resolve) => setTimeout(resolve, 0))
  return { listeners, requests, created, document, settled }
}

function translateRequests(requests) {
  return requests.filter((url) => url.endsWith('/dsh-translate-card/translate'))
}

function triggerOf(app) {
  return app.created.find((element) => element.className === 'dsh-tr-trigger')
}

function hintOf(app) {
  return app.created.find((element) => element.className === 'dsh-tr-trigger-hint')
}

test('selecting text alone never requests a translation', () => {
  const app = boot()
  app.listeners.mouseup({ target: null })
  assert.equal(translateRequests(app.requests).length, 0)
  const trigger = triggerOf(app)
  assert.ok(trigger, 'trigger element should be created')
  assert.notEqual(trigger.style.display, 'none')
})

test('clicking the trigger requests exactly one translation', () => {
  const app = boot()
  app.listeners.mouseup({ target: null })
  assert.equal(translateRequests(app.requests).length, 0)
  triggerOf(app).listeners.click({ preventDefault: noop, stopPropagation: noop })
  assert.equal(translateRequests(app.requests).length, 1)
})

test('the configured hotkey requests a translation', () => {
  const { listeners, requests } = boot()
  listeners.mouseup({ target: null })
  listeners.keydown({
    code: 'KeyT',
    key: 't',
    altKey: true,
    shiftKey: true,
    preventDefault: noop,
    stopPropagation: noop,
    target: null,
  })
  assert.equal(translateRequests(requests).length, 1)
})

test('a wrong hotkey chord does nothing', () => {
  const { listeners, requests } = boot()
  listeners.mouseup({ target: null })
  listeners.keydown({
    code: 'KeyT',
    key: 't',
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
    preventDefault: noop,
    stopPropagation: noop,
    target: null,
  })
  assert.equal(translateRequests(requests).length, 0)
})

test('copy chord hides the trigger without translating', () => {
  const app = boot()
  app.listeners.mouseup({ target: null })
  app.listeners.keydown({ key: 'c', metaKey: true, preventDefault: noop, stopPropagation: noop, target: null })
  assert.equal(translateRequests(app.requests).length, 0)
  assert.equal(triggerOf(app).style.display, 'none')
})

test('auto mode keeps the old immediate behaviour', async () => {
  const app = boot({ config: { trigger: 'auto' } })
  await app.settled
  app.listeners.mouseup({ target: null })
  assert.equal(translateRequests(app.requests).length, 1)
})

test('trigger hint is platform specific', async () => {
  const mac = boot({ mac: true })
  await mac.settled
  mac.listeners.mouseup({ target: null })
  assert.equal(hintOf(mac).textContent, 'Option+Shift+T')

  const win = boot({ mac: false })
  await win.settled
  win.listeners.mouseup({ target: null })
  assert.equal(hintOf(win).textContent, 'Alt+Shift+T')
})
