;(function () {
  'use strict'
  if (window.__dshTranslateCard) return
  window.__dshTranslateCard = true

  var API = '/dsh-translate-card/translate'
  var CONFIG_API = '/dsh-translate-card/config'

  var MIN_CHARS = 2
  var MAX_CHARS = 20000
  var MAX_OUTPUT_CHARS = 200000
  var DEBOUNCE_MS = 200
  var CACHE_MAX = 200

  var CSS = [
    '.dsh-tr-card{',
    '  --tr-bg:rgba(255,255,255,.93);--tr-fg:#1f2328;--tr-muted:#6b7280;',
    '  --tr-border:rgba(15,23,42,.10);--tr-hover:rgba(15,23,42,.06);',
    '  --tr-accent:#2563eb;--tr-skel:rgba(15,23,42,.07);--tr-err:#dc2626;',
    '  --tr-shadow:0 12px 32px -10px rgba(15,23,42,.28),0 2px 8px -2px rgba(15,23,42,.12);',
    '  position:fixed;z-index:2147483000;box-sizing:border-box;',
    '  width:max-content;min-width:260px;max-width:min(620px,calc(100vw - 24px));',
    '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif;',
    '  font-size:13.5px;line-height:1.62;text-align:left;',
    '  color:var(--tr-fg);background:var(--tr-bg);border:1px solid var(--tr-border);',
    '  border-radius:14px;box-shadow:var(--tr-shadow);overflow:hidden;',
    '  -webkit-backdrop-filter:blur(16px) saturate(180%);backdrop-filter:blur(16px) saturate(180%);',
    '  animation:dshTrIn .16s cubic-bezier(.2,.8,.2,1);',
    '}',
    '.dsh-tr-card[data-theme="dark"]{',
    '  --tr-bg:rgba(28,31,38,.93);--tr-fg:#e6e8eb;--tr-muted:#98a1ae;',
    '  --tr-border:rgba(255,255,255,.10);--tr-hover:rgba(255,255,255,.08);',
    '  --tr-accent:#7aa2f7;--tr-skel:rgba(255,255,255,.09);--tr-err:#f87171;',
    '  --tr-shadow:0 16px 40px -12px rgba(0,0,0,.62),0 2px 10px -2px rgba(0,0,0,.42);',
    '}',
    '@keyframes dshTrIn{from{opacity:0;transform:translateY(-5px) scale(.985)}to{opacity:1;transform:none}}',
    '@keyframes dshTrShimmer{0%{background-position:100% 0}100%{background-position:0 0}}',
    '@keyframes dshTrPop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.dsh-tr-card{animation:none}.dsh-tr-skel i{animation:none}}',
    '.dsh-tr-head{display:flex;align-items:center;gap:8px;padding:7px 8px 7px 12px;border-bottom:1px solid var(--tr-border)}',
    '.dsh-tr-badge{',
    '  flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;',
    '  width:24px;height:19px;border-radius:6px;font-size:10.5px;font-weight:700;line-height:1;',
    '  letter-spacing:.04em;color:#fff;background:linear-gradient(135deg,#3b82f6,#6366f1);',
    '  box-shadow:0 1px 3px rgba(59,130,246,.4);',
    '}',
    '.dsh-tr-meta{font-size:11.5px;color:var(--tr-muted);letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dsh-tr-grow{flex:1 1 auto;min-width:4px}',
    '.dsh-tr-btn{',
    '  flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:4px;',
    '  height:24px;min-width:24px;padding:0 6px;border:0;border-radius:7px;cursor:pointer;',
    '  background:transparent;color:var(--tr-muted);font-size:11.5px;font-family:inherit;',
    '  transition:background .14s ease,color .14s ease;',
    '}',
    '.dsh-tr-btn:hover{background:var(--tr-hover);color:var(--tr-fg)}',
    '.dsh-tr-btn:active{transform:translateY(.5px)}',
    '.dsh-tr-btn svg{width:13px;height:13px;display:block}',
    '.dsh-tr-btn[data-done="1"]{color:#16a34a}',
    '.dsh-tr-card[data-theme="dark"] .dsh-tr-btn[data-done="1"]{color:#4ade80}',
    '.dsh-tr-btn[data-done="1"] svg{animation:dshTrPop .28s ease}',
    '.dsh-tr-body{padding:10px 14px 11px;max-height:min(46vh,380px);overflow:auto;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}',
    '.dsh-tr-body::-webkit-scrollbar{width:8px;height:8px}',
    '.dsh-tr-body::-webkit-scrollbar-thumb{background:var(--tr-hover);border-radius:4px}',
    '.dsh-tr-body::-webkit-scrollbar-track{background:transparent}',
    '.dsh-tr-err{color:var(--tr-err)}',
    '.dsh-tr-err b{font-weight:600}',
    '.dsh-tr-hint{display:block;margin-top:6px;color:var(--tr-muted);font-size:11.5px}',
    '.dsh-tr-skel{display:flex;flex-direction:column;gap:9px;padding:1px 0}',
    '.dsh-tr-skel i{',
    '  display:block;height:9px;border-radius:5px;',
    '  background:linear-gradient(90deg,var(--tr-skel) 25%,transparent 37%,var(--tr-skel) 63%);',
    '  background-size:400% 100%;animation:dshTrShimmer 1.25s ease-in-out infinite;',
    '}',
    '.dsh-tr-foot{display:flex;align-items:center;gap:6px;padding:0 12px 9px;font-size:11px;color:var(--tr-muted)}',
    '.dsh-tr-dot{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.55;flex:0 0 auto}',
    '.dsh-tr-trigger{',
    '  --tr-bg:rgba(255,255,255,.94);--tr-fg:#1f2328;--tr-muted:#6b7280;',
    '  --tr-border:rgba(15,23,42,.12);--tr-hover:rgba(15,23,42,.06);',
    '  position:fixed;z-index:2147483000;box-sizing:border-box;display:none;',
    '  align-items:center;gap:6px;height:26px;padding:0 9px 0 5px;border-radius:8px;',
    '  border:1px solid var(--tr-border);background:var(--tr-bg);color:var(--tr-fg);',
    '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:11.5px;',
    '  line-height:1;cursor:pointer;user-select:none;-webkit-user-select:none;',
    '  box-shadow:0 6px 18px -8px rgba(15,23,42,.35);',
    '  -webkit-backdrop-filter:blur(16px) saturate(180%);backdrop-filter:blur(16px) saturate(180%);',
    '}',
    '.dsh-tr-trigger[data-theme="dark"]{',
    '  --tr-bg:rgba(28,31,38,.94);--tr-fg:#e6e8eb;--tr-muted:#98a1ae;',
    '  --tr-border:rgba(255,255,255,.12);--tr-hover:rgba(255,255,255,.08);',
    '  box-shadow:0 8px 22px -10px rgba(0,0,0,.7);',
    '}',
    '.dsh-tr-trigger:hover{background:var(--tr-hover)}',
    '.dsh-tr-trigger-badge{',
    '  display:inline-flex;align-items:center;justify-content:center;width:22px;height:16px;',
    '  border-radius:5px;font-size:9.5px;font-weight:700;letter-spacing:.04em;color:#fff;',
    '  background:linear-gradient(135deg,#3b82f6,#6366f1);',
    '}',
    '.dsh-tr-trigger-hint{color:var(--tr-muted);font-size:10.5px;letter-spacing:.02em}',
  ].join('\n')

  function ensureStyle() {
    if (document.getElementById('dsh-tr-style')) return
    var st = document.createElement('style')
    st.id = 'dsh-tr-style'
    st.textContent = CSS
    ;(document.head || document.documentElement).appendChild(st)
  }

  function isDark() {
    try {
      var el = document.documentElement
      var attr = String(el.getAttribute('data-theme') || '').toLowerCase()
      if (attr.indexOf('dark') >= 0) return true
      if (attr.indexOf('light') >= 0) return false
      var cls = el.className || ''
      if (typeof cls === 'string') {
        if (/(^|\s)(dark|theme-dark)(\s|$)/.test(cls)) return true
        if (/(^|\s)(light|theme-light)(\s|$)/.test(cls)) return false
      }
      var bd = document.body && document.body.className
      if (typeof bd === 'string' && /(^|\s)(dark|theme-dark)(\s|$)/.test(bd)) return true
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    } catch (err) {
      return false
    }
  }

  function countMatches(text, re) {
    var m = text.match(re)
    return m ? m.length : 0
  }

  var CYRILLIC_TARGETS = { ru: true, uk: true, be: true, bg: true, sr: true, mk: true }

  function isAlreadyTarget(text, to) {
    var t = String(to || 'ru').toLowerCase()
    if (t.indexOf('zh') === 0) {
      var letters = countMatches(text, /\p{L}/gu)
      if (letters === 0) return true
      var kana = countMatches(text, /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
      if (kana > 0) return false
      var han = countMatches(text, /\p{Script=Han}/gu)
      return han / letters >= 0.8
    }
    if (CYRILLIC_TARGETS[t]) {
      var all = countMatches(text, /\p{L}/gu)
      if (all === 0) return true
      var cyr = countMatches(text, /[\p{Script=Cyrillic}]/gu)
      return cyr / all >= 0.5
    }
    return false
  }

  var LANG_NAMES = {
    en: 'English', ja: 'Japanese', ko: 'Korean', fr: 'French', de: 'German', es: 'Spanish',
    ru: 'Russian', pt: 'Portuguese', it: 'Italian', ar: 'Arabic', th: 'Thai',
    vi: 'Vietnamese', id: 'Indonesian', nl: 'Dutch', pl: 'Polish', tr: 'Turkish',
    hi: 'Hindi', sv: 'Swedish', uk: 'Ukrainian', cs: 'Czech', el: 'Greek',
    he: 'Hebrew', fa: 'Persian', ms: 'Malay', da: 'Danish', fi: 'Finnish',
    no: 'Norwegian', hu: 'Hungarian', ro: 'Romanian', bg: 'Bulgarian',
  }

  function langName(code) {
    if (!code) return ''
    var c = String(code).toLowerCase()
    return LANG_NAMES[c] || c.toUpperCase()
  }

  function targetName(to) {
    if (!to) return 'Russian'
    if (/^zh-hans/i.test(to)) return 'Simplified Chinese'
    if (/^zh-hant/i.test(to)) return 'Traditional Chinese'
    return langName(to)
  }

  function targetBadge(to) {
    var t = String(to || 'ru').toUpperCase()
    return t === 'ZH-HANS' || t === 'ZH-HANT' ? 'ZH' : t.slice(0, 2)
  }

  var SVG = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  }

  var card = null
  var els = null
  var state = {
    text: '',
    to: 'ru',
    skipTargetLanguage: true,
    mode: 'button',
    hotkeySpec: 'alt+shift+t',
    hotkey: null,
    meta: null,
    partial: null,
    result: null,
    error: '',
    visible: false,
    token: 0,
  }
  var trigger = null
  var triggerEls = null
  var pending = null
  state.hotkey = parseHotkey(state.hotkeySpec)
  var cache = new Map()
  var inflight = null
  var hideTimer = null

  function isMacPlatform() {
    try {
      var platform = navigator.platform || ''
      if (/mac|iphone|ipad|ipod/i.test(platform)) return true
      var ua = navigator.userAgent || ''
      return /mac os x|iphone|ipad/i.test(ua)
    } catch (err) {
      return false
    }
  }

  function parseHotkey(spec) {
    if (!spec || spec === 'off') return null
    var tokens = String(spec).toLowerCase().split('+')
    var mac = isMacPlatform()
    var parsed = { ctrl: false, alt: false, shift: false, meta: false, key: '' }
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i]
      if (token === 'mod') {
        if (mac) parsed.meta = true
        else parsed.ctrl = true
      } else if (token === 'ctrl' || token === 'control') parsed.ctrl = true
      else if (token === 'alt' || token === 'option') parsed.alt = true
      else if (token === 'shift') parsed.shift = true
      else if (token === 'meta' || token === 'cmd' || token === 'command' || token === 'win') parsed.meta = true
      else parsed.key = token
    }
    if (!parsed.key) return null
    var key = parsed.key
    if (/^[a-z]$/.test(key)) parsed.code = 'Key' + key.toUpperCase()
    else if (/^[0-9]$/.test(key)) parsed.code = 'Digit' + key
    else if (/^f([1-9]|1[0-2])$/.test(key)) parsed.code = 'F' + key.slice(1)
    else return null
    return parsed
  }

  function hotkeyLabel(spec) {
    if (!spec || spec === 'off') return ''
    var mac = isMacPlatform()
    var parts = []
    var tokens = String(spec).toLowerCase().split('+')
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i]
      if (token === 'mod') parts.push(mac ? 'Cmd' : 'Ctrl')
      else if (token === 'ctrl' || token === 'control') parts.push('Ctrl')
      else if (token === 'alt' || token === 'option') parts.push(mac ? 'Option' : 'Alt')
      else if (token === 'shift') parts.push('Shift')
      else if (token === 'meta' || token === 'cmd' || token === 'command' || token === 'win') parts.push(mac ? 'Cmd' : 'Win')
      else if (/^f([1-9]|1[0-2])$/.test(token)) parts.push(token.toUpperCase())
      else parts.push(token.toUpperCase())
    }
    return parts.join('+')
  }

  function selectionPrintable(event) {
    var target = event.target
    if (!target || !target.closest) return false
    return !!target.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')
  }

  function hotkeyMatches(event) {
    var hotkey = state.hotkey
    if (!hotkey) return false
    if (event.repeat) return false
    var code = event.code || ''
    if (code !== hotkey.code) return false
    return (
      !!event.ctrlKey === hotkey.ctrl &&
      !!event.altKey === hotkey.alt &&
      !!event.shiftKey === hotkey.shift &&
      !!event.metaKey === hotkey.meta
    )
  }

  function buildTrigger() {
    ensureStyle()
    trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'dsh-tr-trigger'
    trigger.setAttribute('tabindex', '-1')
    trigger.setAttribute('aria-label', 'Translate selection')
    var badge = document.createElement('span')
    badge.className = 'dsh-tr-trigger-badge'
    var label = document.createElement('span')
    label.className = 'dsh-tr-trigger-label'
    label.textContent = 'Translate'
    var hint = document.createElement('span')
    hint.className = 'dsh-tr-trigger-hint'
    trigger.appendChild(badge)
    trigger.appendChild(label)
    trigger.appendChild(hint)
    triggerEls = { badge: badge, hint: hint }
    trigger.addEventListener('mousedown', function (e) {
      e.preventDefault()
      e.stopPropagation()
    })
    trigger.addEventListener('pointerdown', function (e) {
      e.preventDefault()
      e.stopPropagation()
    })
    trigger.addEventListener('click', function (e) {
      e.preventDefault()
      e.stopPropagation()
      activate()
    })
    trigger.style.display = 'none'
    document.body.appendChild(trigger)
    return trigger
  }

  function ensureTrigger() {
    if (trigger && trigger.isConnected) return trigger
    trigger = null
    triggerEls = null
    return buildTrigger()
  }

  function placeTrigger(rect) {
    if (!trigger) return
    var vw = window.innerWidth
    var vh = window.innerHeight
    var gap = 6
    trigger.style.visibility = 'hidden'
    trigger.style.display = 'inline-flex'
    var w = trigger.offsetWidth || 0
    var h = trigger.offsetHeight || 0
    var top = rect.bottom + gap
    if (top + h > vh - 8) {
      var above = rect.top - h - gap
      top = above >= 8 ? above : Math.max(8, vh - h - 8)
    }
    var left = rect.right - w
    left = Math.min(Math.max(8, left), Math.max(8, vw - w - 8))
    trigger.style.top = Math.round(top) + 'px'
    trigger.style.left = Math.round(left) + 'px'
    trigger.style.visibility = ''
  }

  function showTrigger(selection) {
    ensureTrigger()
    pending = { text: selection.text, rect: selection.rect }
    trigger.setAttribute('data-theme', isDark() ? 'dark' : 'light')
    triggerEls.badge.textContent = targetBadge(state.to)
    triggerEls.hint.textContent = hotkeyLabel(state.hotkeySpec)
    trigger.style.display = 'inline-flex'
    placeTrigger(selection.rect)
  }

  function hideTrigger() {
    pending = null
    if (!trigger) return
    trigger.style.display = 'none'
  }

  function triggerVisible() {
    return !!(trigger && trigger.style.display !== 'none')
  }

  function activate() {
    var selection = readSelection() || pending
    if (!selection) {
      hideTrigger()
      return
    }
    hideTrigger()
    show(selection.text, selection.rect)
    run(selection.text, {})
  }

  function buildCard() {
    ensureStyle()
    card = document.createElement('div')
    card.className = 'dsh-tr-card'
    card.setAttribute('data-state', 'loading')
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-label', 'Translation')
    card.innerHTML =
      '<div class="dsh-tr-head">' +
      '<span class="dsh-tr-badge">RU</span>' +
      '<span class="dsh-tr-meta"></span>' +
      '<span class="dsh-tr-grow"></span>' +
      '<button class="dsh-tr-btn" data-act="copy" title="Copy translation">' + SVG.copy + '</button>' +
      '<button class="dsh-tr-btn" data-act="retry" title="Retry translation">' + SVG.retry + '</button>' +
      '<button class="dsh-tr-btn" data-act="close" title="Close (Esc)">' + SVG.close + '</button>' +
      '</div>' +
      '<div class="dsh-tr-body"></div>' +
      '<div class="dsh-tr-foot"></div>'
    els = {
      badge: card.querySelector('.dsh-tr-badge'),
      meta: card.querySelector('.dsh-tr-meta'),
      body: card.querySelector('.dsh-tr-body'),
      foot: card.querySelector('.dsh-tr-foot'),
      copy: card.querySelector('[data-act="copy"]'),
      retry: card.querySelector('[data-act="retry"]'),
      close: card.querySelector('[data-act="close"]'),
    }
    card.addEventListener('mousedown', function (e) {
      e.stopPropagation()
    })
    card.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null
      if (!btn) return
      var act = btn.getAttribute('data-act')
      if (act === 'close') hide()
      else if (act === 'retry') run(state.text, { force: true })
      else if (act === 'copy') doCopy()
    })
    card.style.display = 'none'
    document.body.appendChild(card)
    return card
  }

  function ensureCard() {
    if (card && card.isConnected) return card
    card = null
    els = null
    return buildCard()
  }

  function renderSkeleton() {
    var rows = [['62%'], ['96%'], ['84%'], ['45%']]
    var html = '<div class="dsh-tr-skel">'
    for (var i = 0; i < rows.length; i++) {
      html += '<i style="width:' + rows[i][0] + '"></i>'
    }
    return html + '</div>'
  }

  function currentText() {
    if (state.result) return state.result.translation
    if (state.partial !== null) return state.partial
    return ''
  }

  function render() {
    if (!card) return
    card.setAttribute('data-theme', isDark() ? 'dark' : 'light')
    card.setAttribute('data-state', state.error ? 'error' : state.result || state.partial !== null ? 'done' : 'loading')
    els.badge.textContent = targetBadge(state.to)

    if (state.error) {
      els.meta.textContent = 'Translation failed'
      els.body.innerHTML =
        '<div class="dsh-tr-err"><b>Failed:</b>' + escapeHtml(state.error) + '</div>' +
        '<span class="dsh-tr-hint">Use \u27f3 to retry. If it keeps failing, the backend may be unavailable or misconfigured.</span>'
      els.foot.textContent = ''
      els.copy.style.display = 'none'
      return
    }
    els.copy.style.display = ''

    if (state.result) {
      var r = state.result
      var from = langName(r.detected)
      els.meta.textContent = (from ? from + ' \u2192 ' : '') + targetName(state.to)
      els.body.textContent = r.translation
      var parts = []
      if (r.provider) parts.push(r.provider)
      if (r.model) parts.push(r.model)
      if (r.chars) parts.push(r.chars + ' chars')
      if (r.cached) parts.push('cached')
      parts.push('Esc to close')
      els.foot.innerHTML = parts
        .filter(Boolean)
        .map(function (p) {
          return escapeHtml(p)
        })
        .join('<span class="dsh-tr-dot"></span>')
      return
    }

    if (state.partial !== null) {
      els.meta.textContent = 'Translating\u2026'
      els.body.textContent = state.partial
      els.foot.textContent = ''
      return
    }

    els.meta.textContent = 'Translating\u2026'
    els.body.innerHTML = renderSkeleton()
    els.foot.textContent = ''
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function place(rect) {
    if (!card) return
    var vw = window.innerWidth
    var vh = window.innerHeight
    var gap = 8
    card.style.visibility = 'hidden'
    card.style.display = 'block'
    var w = card.offsetWidth || 0
    var h = card.offsetHeight || 0
    var top = rect.bottom + gap
    if (top + h > vh - 8) {
      var above = rect.top - h - gap
      top = above >= 8 ? above : Math.max(8, vh - h - 8)
    }
    var left = rect.left
    left = Math.min(Math.max(8, left), Math.max(8, vw - w - 8))
    card.style.top = Math.round(top) + 'px'
    card.style.left = Math.round(left) + 'px'
    card.style.visibility = ''
  }

  function show(text, rect) {
    ensureCard()
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
    if (text !== state.text) {
      state.result = null
      state.partial = null
      state.error = ''
      state.meta = null
    }
    state.visible = true
    card.style.display = 'block'
    render()
    place(rect)
  }

  function hide() {
    hideTrigger()
    if (!card) return
    state.visible = false
    state.text = ''
    state.result = null
    state.partial = null
    state.meta = null
    state.error = ''
    state.token++
    if (inflight) {
      try {
        inflight.abort()
      } catch (err) {}
      inflight = null
    }
    card.style.display = 'none'
  }

  function doCopy() {
    var text = currentText()
    if (!text) return
    var done = function () {
      els.copy.setAttribute('data-done', '1')
      els.copy.innerHTML = SVG.check
      setTimeout(function () {
        if (!els) return
        els.copy.removeAttribute('data-done')
        els.copy.innerHTML = SVG.copy
      }, 1100)
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback)
    } else {
      fallback()
    }
    function fallback() {
      try {
        var ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        done()
      } catch (err) {}
    }
  }

  function finish(text, meta) {
    if (!text) {
      state.error = 'empty translation'
      render()
      return
    }
    state.partial = null
    state.result = {
      translation: text,
      detected: (meta && meta.detected) || '',
      provider: (meta && meta.provider) || '',
      model: (meta && meta.model) || '',
      chars: state.text.length,
      cached: false,
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
    cache.set(state.to + '\u0000' + state.text, state.result)
    render()
  }

  function run(text, opts) {
    opts = opts || {}
    state.text = text
    state.error = ''
    state.result = null
    state.partial = null
    state.meta = null

    if (!opts.force) {
      var hit = cache.get(state.to + '\u0000' + text)
      if (hit) {
        state.result = Object.assign({}, hit, { cached: true })
        render()
        return
      }
    }

    render()
    if (inflight) {
      try {
        inflight.abort()
      } catch (err) {}
    }
    var ac = typeof AbortController === 'function' ? new AbortController() : null
    inflight = ac
    var token = ++state.token

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, force: !!opts.force }),
      signal: ac ? ac.signal : undefined,
      credentials: 'same-origin',
    })
      .then(function (res) {
        if (!res.ok || !res.body || !res.body.getReader) {
          return res
            .json()
            .catch(function () {
              return { error: 'HTTP ' + res.status }
            })
            .then(function (j) {
              if (token !== state.token) return
              state.error = (j && j.error) || 'HTTP ' + res.status
              render()
            })
        }
        var reader = res.body.getReader()
        var dec = new TextDecoder()
        var buf = ''
        var acc = ''
        var meta = {}
        function apply(ev) {
          if (ev.meta) {
            meta = Object.assign({}, meta, ev.meta)
            if (meta.model) state.meta = meta
          }
          if (ev.delta) {
            acc += ev.delta
            if (acc.length > MAX_OUTPUT_CHARS) {
              state.partial = null
              state.error = 'translation too large'
              render()
              try {
                if (inflight) inflight.abort()
              } catch (err) {}
              return
            }
            state.partial = acc
            render()
          }
          if (ev.translation) {
            acc = ev.translation
            meta.detected = ev.detected || meta.detected
            meta.provider = ev.provider || meta.provider
            meta.cached = ev.cached || meta.cached
            finish(acc, meta)
          }
          if (ev.done && !state.result) finish(acc, meta)
          if (ev.error) {
            state.partial = null
            state.error = ev.error
            render()
          }
        }
        function pump() {
          return reader.read().then(function (r) {
            if (token !== state.token) return
            if (r.done) {
              if (!state.result && !state.error) {
                state.error = 'unexpected end of stream'
                render()
              }
              return
            }
            buf += dec.decode(r.value, { stream: true })
            var lines = buf.split('\n')
            buf = lines.pop()
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim()
              if (!line) continue
              var ev
              try {
                ev = JSON.parse(line)
              } catch (err) {
                continue
              }
              apply(ev)
            }
            return pump()
          })
        }
        return pump().catch(function (err) {
          if (token !== state.token) return
          if (err && err.name === 'AbortError') return
          state.partial = null
          state.error = (err && err.message) || 'network error'
          render()
        })
      })
      .catch(function (err) {
        if (token !== state.token) return
        if (err && err.name === 'AbortError') return
        state.error = (err && err.message) || 'network error'
        render()
      })
  }

  var timer = null

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(check, DEBOUNCE_MS)
  }

  function inEditable(el) {
    if (!el || !el.closest) return false
    return !!el.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],.dsh-tr-card')
  }

  function readSelection() {
    var sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    var raw = sel.toString()
    if (!raw) return null
    var text = raw.replace(/^\s+|\s+$/g, '')
    if (text.length < MIN_CHARS) return null
    if (text.length > MAX_CHARS) return null

    var range = sel.getRangeAt(0)
    var node = range.startContainer
    var el = node && node.nodeType === 1 ? node : node && node.parentElement
    if (inEditable(el)) return null
    if (state.skipTargetLanguage && isAlreadyTarget(text, state.to)) return null

    try {
      var bodyText = (document.body && document.body.innerText ? document.body.innerText : '').replace(/^\s+|\s+$/g, '')
      if (bodyText && text === bodyText) return null
    } catch (err) {}

    var rects = range.getClientRects ? range.getClientRects() : null
    var rect = null
    if (rects && rects.length) rect = rects[rects.length - 1]
    if (!rect || (!rect.width && !rect.height)) rect = range.getBoundingClientRect()
    if (!rect || (!rect.width && !rect.height)) return null

    return { text: text, rect: rect }
  }

  function check() {
    var selection = readSelection()
    if (!selection) {
      hideTrigger()
      return
    }
    if (state.mode === 'auto') {
      hideTrigger()
      show(selection.text, selection.rect)
      run(selection.text, {})
      return
    }
    showTrigger(selection)
  }

  document.addEventListener(
    'mouseup',
    function (e) {
      if (card && card.contains(e.target)) return
      schedule()
    },
    true,
  )

  document.addEventListener(
    'keyup',
    function (e) {
      if (e.key === 'Shift' || e.shiftKey || (e.ctrlKey && (e.key === 'a' || e.key === 'A'))) schedule()
    },
    true,
  )

  document.addEventListener(
    'mousedown',
    function (e) {
      if (trigger && trigger.contains(e.target)) return
      if (card && card.contains(e.target)) return
      if (triggerVisible()) hideTrigger()
      if (state.visible) hide()
    },
    true,
  )

  document.addEventListener(
    'keydown',
    function (e) {
      if (hotkeyMatches(e)) {
        if (!selectionPrintable(e)) {
          e.preventDefault()
          e.stopPropagation()
          activate()
        }
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
        if (triggerVisible()) hideTrigger()
        return
      }
      if (e.key === 'Escape') {
        if (triggerVisible() || state.visible) {
          hide()
          hideTrigger()
        }
      }
    },
    true,
  )

  window.addEventListener(
    'scroll',
    function (e) {
      if (card && e.target && card.contains(e.target)) return
      if (triggerVisible()) hideTrigger()
      if (state.visible) hide()
    },
    true,
  )
  window.addEventListener('resize', function () {
    if (triggerVisible()) hideTrigger()
    if (state.visible) hide()
  })

  if (window.matchMedia) {
    try {
      var mq = window.matchMedia('(prefers-color-scheme: dark)')
      var onTheme = function () {
        if (state.visible) render()
        if (triggerVisible() && trigger) trigger.setAttribute('data-theme', isDark() ? 'dark' : 'light')
      }
      if (mq.addEventListener) mq.addEventListener('change', onTheme)
      else if (mq.addListener) mq.addListener(onTheme)
    } catch (err) {}
  }

  try {
    fetch(CONFIG_API, { credentials: 'same-origin' })
      .then(function (r) {
        return r.json()
      })
      .then(function (j) {
        if (j && j.ok && j.config) {
          if (j.config.to) state.to = j.config.to
          if (j.config.skipTargetLanguage === false) state.skipTargetLanguage = false
          if (j.config.trigger === 'auto') state.mode = 'auto'
          if (j.config.hotkey) state.hotkeySpec = j.config.hotkey
          state.hotkey = state.mode === 'auto' ? null : parseHotkey(state.hotkeySpec)
          if (state.visible && !state.result) render()
        }
      })
      .catch(function () {})
  } catch (err) {}
})()
