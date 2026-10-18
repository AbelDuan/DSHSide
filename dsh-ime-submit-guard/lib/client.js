window.__ModuleLoader__.load({ id: "dsh-ime-submit-guard", factory: (require) => {
"use strict";

/*
 * dsh-ime-submit-guard - client-side guard for the DSH web composer.
 *
 *   A. Submit guard - the dictation IME auto-sends the message, and truncates it.
 *   B. Focus guard  - the soft keyboard should appear only when the user taps the
 *                     composer; switching chats / pressing send must not raise it.
 *
 * ══ Why the code looks like this ══
 *
 * 1. load() must be called at TOP LEVEL and nothing may throw while this script
 *    runs. The host is a queue loader (window.__ModuleLoader__): if this script
 *    throws, or registers in a way the host does not observe, the queue never
 *    drains, the `dsh web: ...?token=` line is never printed, the folk app never
 *    gets a token and the WebUI never opens - a blank screen. (Observed
 *    2026-10-17; an IIFE-wrapped registration did exactly this.)
 *
 * 2. NO MutationObserver. A callback that writes DOM retriggers its own childList
 *    observation - an endless microtask loop that starves "Loading plugins...".
 *    setInterval polling is safe.
 *
 * 3. apply() must never throw. A degraded guard beats a WebUI that will not open.
 *
 * ══ A. Measured IME behaviour (Xiaomi foldable / HyperOS, 2026-10-17) ══
 *
 *   -Dictation is a normal composition: many insertCompositionText events, then
 *     ONE compositionend.
 *   -compositionend.data ends with U+200B segment markers plus "\n\n" (tail
 *     codes 8203,10,10).
 *   -insertCompositionText.data carries the WHOLE dictated text (e.g. 62 chars);
 *     compositionend.data carries only the LAST SEGMENT (e.g. 20 chars).
 *   -The host commits using compositionend.data and sends by itself when that
 *     value ends with a newline - one event both truncates and sends.
 *
 *   Fix: in the CAPTURE phase rewrite compositionend.data with the whole captured
 *   text minus trailing markers. Object.defineProperty is what works here; plain
 *   assignment does not. A moment later, if the composer holds only a truncated
 *   tail of the dictation, it is replaced by the full text.
 *
 * ══ B. Focus guard, and why it needs inputmode ══
 *
 *   The keyboard is summoned by the composer receiving focus. Simply calling
 *   blur() inside a focus handler is NOT enough on this device: by the time the
 *   handler runs, the WebView has already told the IME to show (measured: the
 *   keyboard still appeared when switching chats).
 *
 *   So the guard works from the other end. The composer is kept with
 *   inputmode="none", which removes its ability to raise a virtual keyboard at
 *   all, and the attribute is dropped only for a real tap on the composer:
 *
 *       tap composer            -> allow keyboard, focus follows -> keyboard OK
 *       switch chat / send      -> programmatic focus -> no keyboard at all
 *
 *   The tap test uses the touch's START POINT: a tap on the Send button is also a
 *   touch, and the app re-focuses the composer right after it, so marking on any
 *   touch would let that focus through.
 *
 *   blur() is kept as a second line of defence, and the polling loop re-arms the
 *   attribute if React remounts the composer.
 */

var NAME = 'dsh-ime-submit-guard';
var COMPOSER_SELECTOR = '[data-composer-input]';
var LEXICAL_SELECTOR = '[data-lexical-editor]';

var SETTLE_MS = 260;             /* let the browser finish its composition commit */
var GUARD_MS = 2500;             /* window in which a null-payload ENTER is the IME's */
var SCAN_INTERVAL_MS = 900;

var USER_TAP_MS = 900;           /* a focus this soon after a tap on the composer is the user's */
var BLUR_COOLDOWN_MS = 350;      /* debounce so focus/blur cannot oscillate */

/*
 * 正式版本：关闭调试角标。
 *
 * 调试期间需要它，是因为本设备上 WebView 的 console.log 不会转发到 logcat
 * （adb logcat | grep 拿不到），页面上可见的角标是当时唯一能观测守卫行为的载体。
 * 功能已验证完毕，这里置回 false；如需再排查，改 true 即可恢复。
 */
var DEBUG_BADGE = false;

var state = {
  started: false,
  timer: null,
  composeUntil: 0,
  fullText: '',
  handled: false,
  lastComposerTap: 0,
  blurUntil: 0,
  armed: false,
  stats: { suppressed: 0, allowed: 0 },
  badgeEl: null,
  badgeText: ''
};

function doc() {
  try {
    return typeof document !== 'undefined' ? document : null;
  } catch (e) {
    return null;
  }
}

/*
 * 正式版本不再输出调试日志。
 *
 * 有意保留这个空函数（而不是删掉所有调用点）：正式版与调试版的差异因此只剩
 * DEBUG_BADGE 与这里两处，最大限度降低改动已验证产物的风险。
 */
function log() {
  /* 有意为空 */
}

/* Wrap so a callback can never throw outwards. */
function safe(fn, label) {
  return function () {
    try {
      return fn.apply(this, arguments);
    } catch (error) {
      try { console.warn('[' + NAME + '] ' + label + ': ' + error); } catch (e) { /* ignore */ }
      return undefined;
    }
  };
}

function findComposer() {
  var d = doc();
  if (!d) return null;
  try {
    return d.querySelector(COMPOSER_SELECTOR) || d.querySelector(LEXICAL_SELECTOR);
  } catch (e) {
    return null;
  }
}

function isInComposer(node) {
  var el = findComposer();
  if (!el || !node) return false;
  try {
    return node === el || el.contains(node);
  } catch (e) {
    return false;
  }
}

function textOf(el) {
  try {
    return el && typeof el.textContent === 'string' ? el.textContent : '';
  } catch (e) {
    return '';
  }
}

/* ══ A. submit / truncation guard ══ */

/* Drop trailing newlines and trailing zero-width segment markers. */
function trimTail(data) {
  return typeof data === 'string'
    ? data.replace(/[\u200b\u200c\u200d\ufeff\r\n\s]+$/, '')
    : '';
}

/* Strip markers the IME leaves BETWEEN segments, plus the trailing newline. */
function normalise(data) {
  return typeof data === 'string'
    ? data.replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/[\r\n\s]+$/, '')
    : '';
}

/* Overwrite event.data - defineProperty is the form that works on this host. */
function setEventData(event, value) {
  try {
    event.data = value;
    if (event.data === value) return true;
  } catch (e) { /* ignore */ }
  try {
    Object.defineProperty(event, 'data', {
      value: value, configurable: true, enumerable: true, writable: true
    });
    return event.data === value;
  } catch (e) {
    return false;
  }
}

/* Paste plain text into the composer (the only channel that really writes here). */
function pasteText(el, text) {
  try {
    var dt = null;
    try {
      dt = new DataTransfer();
      dt.setData('text/plain', text);
    } catch (e) { dt = null; }
    el.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt
    }));
    return true;
  } catch (e) {
    return false;
  }
}

/* Delete characters via synthetic Backspace keys (core Lexical key handling). */
function deleteBackwards(el, count) {
  var n = Math.min(count, 400);
  for (var i = 0; i < n; i++) {
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8,
        bubbles: true, cancelable: true
      }));
      el.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true
      }));
    } catch (e) {
      return;
    }
  }
}

/*
 * Repair a truncated dictation - only when what is on screen is recognisably the
 * tail of the full text, so ordinary typing is never touched.
 */
function repairIfTruncated() {
  if (state.handled) return;
  state.handled = true;

  var want = normalise(state.fullText);
  state.fullText = '';
  if (!want) return;

  var el = findComposer();
  if (!el) return;
  var cur = textOf(el);

  if (cur === want) return;                       /* already complete */
  if (!cur) return;                               /* composer was emptied */
  if (cur.length >= want.length) return;          /* nothing lost */
  if (cur.length > want.length) return;           /* safety: never grow it */

  var probe = cur.length > 8 ? cur.slice(-8) : cur;
  if (want.indexOf(probe) === -1) return;

  deleteBackwards(el, cur.length + 2);

  setTimeout(safe(function () {
    if (textOf(el).length !== 0) return;          /* clearing failed - leave it alone */
    pasteText(el, want);

    setTimeout(safe(function () {
      if (textOf(el) !== want) {
        deleteBackwards(el, textOf(el).length + 2);
        setTimeout(safe(function () {
          pasteText(el, want);
        }, 'retry'), SETTLE_MS);
      }
    }, 'verify'), SETTLE_MS);
  }, 'clear'), SETTLE_MS);
}

/* Capture phase: rewrite the trailing newline away so the host does not send. */
function onCompositionEnd(event) {
  try {
    var own = event && typeof event.data === 'string' ? event.data : '';
    var full = state.fullText && state.fullText.length >= own.length ? state.fullText : own;
    var replacement = trimTail(full);
    if (replacement !== own) setEventData(event, replacement);
    state.composeUntil = Date.now() + GUARD_MS;
    setTimeout(safe(repairIfTruncated, 'repair'), SETTLE_MS);
  } catch (e) { /* ignore */ }
}

/* insertCompositionText.data is the live full text - remember it. */
function onBeforeInput(event) {
  try {
    if (!event || typeof event.data !== 'string' || !event.data.length) return;
    var t = typeof event.inputType === 'string' ? event.inputType : '';
    if (t === 'insertCompositionText' || t === 'insertText') {
      state.fullText = event.data;
      state.handled = false;
    }
  } catch (e) { /* ignore */ }
}

/* ══ B. focus guard ══ */

/*
 * inputmode must sit on the element that is actually editable - [data-composer-input]
 * may only be an outer wrapper around it. Collect every plausible target.
 */
function keyboardTargets() {
  var d = doc();
  var out = [];
  if (!d) return out;
  try {
    var el = d.querySelector(COMPOSER_SELECTOR);
    if (el) {
      out.push(el);
      var inner = el.querySelector('[contenteditable="true"]');
      if (inner) out.push(inner);
    }
    var lex = d.querySelector(LEXICAL_SELECTOR);
    if (lex) {
      out.push(lex);
      var innerLex = lex.querySelector('[contenteditable="true"]');
      if (innerLex) out.push(innerLex);
    }
  } catch (e) { /* ignore */ }
  return out;
}

/* Remove the composer's ability to raise a virtual keyboard. */
function blockKeyboard() {
  var targets = keyboardTargets();
  if (!targets.length) return false;
  for (var i = 0; i < targets.length; i++) {
    try {
      if (targets[i].getAttribute('inputmode') !== 'none') {
        targets[i].setAttribute('inputmode', 'none');
      }
    } catch (e) { /* ignore */ }
  }
  state.armed = true;
  return true;
}

/* Restore normal keyboard behaviour for a real tap on the composer. */
function allowKeyboard() {
  var targets = keyboardTargets();
  for (var i = 0; i < targets.length; i++) {
    try {
      if (targets[i].hasAttribute('inputmode')) targets[i].removeAttribute('inputmode');
    } catch (e) { /* ignore */ }
  }
  state.armed = false;
}

function onPointerDown(event) {
  try {
    if (isInComposer(event && event.target)) {
      state.lastComposerTap = Date.now();
      allowKeyboard();
    }
  } catch (e) { /* ignore */ }
}

function onFocusIn(event) {
  try {
    var node = event && event.target;
    if (!isInComposer(node)) return;

    var composer = findComposer();

    if (Date.now() - state.lastComposerTap < USER_TAP_MS) {
      state.stats.allowed++;
      allowKeyboard();
      drawBadge();
      return;                                   /* the user tapped it - keyboard is fine */
    }

    /* Programmatic focus: block the keyboard AND drop focus as a fallback. */
    state.stats.suppressed++;
    blockKeyboard();

    if (Date.now() >= state.blurUntil) {
      state.blurUntil = Date.now() + BLUR_COOLDOWN_MS;
      try { if (node.blur) node.blur(); } catch (e) { /* ignore */ }
    }
    drawBadge();
  } catch (e) { /* ignore */ }
}

function onFocusOut() {
  /* Once focus leaves the composer, re-arm the block. */
  setTimeout(safe(function () {
    var d = doc();
    if (d && !isInComposer(d.activeElement)) blockKeyboard();
  }, 'focusout'), 60);
}

/* ══ status badge (verification only) ══ */

function drawBadge() {
  if (!DEBUG_BADGE) return;
  try {
    var text = 'S' + state.stats.suppressed + ' A' + state.stats.allowed +
      (state.armed ? ' armed' : ' open');
    if (text === state.badgeText && state.badgeEl && state.badgeEl.isConnected) return;
    var d = doc();
    if (!d) return;
    var host = d.documentElement || d.body;
    if (!host) return;
    if (!state.badgeEl || !state.badgeEl.isConnected) {
      var el = d.createElement('div');
      el.setAttribute('style',
        'position:fixed;right:3px;bottom:3px;z-index:2147483647;background:#013;color:#7f7;' +
        'font:9px/1.2 monospace;padding:2px 4px;border-radius:4px;opacity:.9;pointer-events:none');
      host.appendChild(el);
      state.badgeEl = el;
    }
    state.badgeEl.textContent = text;
    state.badgeText = text;
  } catch (e) { /* ignore */ }
}

function start() {
  if (state.started) return;
  var d = doc();
  if (!d) return;
  state.started = true;

  try {
    d.addEventListener('compositionend', onCompositionEnd, true);
    d.addEventListener('beforeinput', onBeforeInput, true);
    d.addEventListener('pointerdown', onPointerDown, true);
    d.addEventListener('touchstart', onPointerDown, true);
    d.addEventListener('mousedown', onPointerDown, true);
    d.addEventListener('focusin', onFocusIn, true);
    d.addEventListener('focusout', onFocusOut, true);
  } catch (e) { /* ignore */ }

  /* Arm the block immediately, then keep it armed across React remounts. */
  blockKeyboard();
  drawBadge();

  /*
   * Polling only - no MutationObserver (see the header note). Besides re-arming
   * the keyboard block, it clears the per-composition flag.
   */
  try {
    state.timer = setInterval(safe(function () {
      if (Date.now() > state.composeUntil) state.handled = false;
      var el = findComposer();
      if (el) {
        var d2 = doc();
        var active = d2 && d2.activeElement;
        if (!state.armed && !isInComposer(active)) blockKeyboard();
        else if (state.armed && Date.now() - state.lastComposerTap < USER_TAP_MS) allowKeyboard();
      }
      drawBadge();
    }, 'timer'), SCAN_INTERVAL_MS);
  } catch (e) { /* ignore */ }

  log('started');
}

var apply = safe(function (ctx) {
  if (!doc()) return;
  var bound = false;
  try {
    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(function () {
        try { start(); } catch (e) { /* ignore */ }
      });
      bound = true;
    }
  } catch (e) { /* ignore */ }
  if (!bound) {
    try { start(); } catch (e) { /* ignore */ }
  }
}, 'apply');

return {
  name: NAME,
  inject: [],
  apply: apply
};
} });


