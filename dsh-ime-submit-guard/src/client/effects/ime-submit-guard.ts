/**
 * dsh-ime-submit-guard —— DOM 层。
 *
 * ⚠️ 本文件的每一条防御都不是可选的，2026-10-17 的白屏事故换来的：
 *   一个 client 插件在脚本执行期或 apply 期抛异常，会让宿主队列式加载器
 *   （window.__ModuleLoader__ 的 pendingQueue）排不空，loader 永不 settle，
 *   于是 `dsh web:` token 行不打印、folk app 不打开 WebUI、DshWebUiActivity 白屏。
 *   所以：**任何对外入口与回调都不得抛出异常**，只能静默降级。
 *
 * 逻辑主体必须与 lib/client.js 保持一致。
 */

import {
  endsWithNewline,
  shouldSwallowEnterDispatch,
  trimTrailingNewlines,
} from '../core/ime-submit-core.ts'

/** composer 的编辑面选择器。 */
const COMPOSER_SELECTOR = '[data-composer-input]'
/** Lexical root 的备用选择器。 */
const LEXICAL_SELECTOR = '[data-lexical-editor]'
/** 合成收尾后，多长窗口内的 null-payload ENTER 才算输入法触发。 */
const COMPOSE_WINDOW_MS = 2000
/** 扫描 editor 的兜底间隔（编辑面会被 React 重新挂载）。 */
const SCAN_INTERVAL_MS = 1200
/** 左下角调试角标 id。 */
const BADGE_ID = 'dsh-ime-guard-badge'
/** 已包装过的 editor 标记（幂等）。 */
const PATCHED = Symbol.for('dsh-ime-submit-guard.patched')

/** 可选配置。 */
export interface ImeSubmitGuardOptions {
  /** 在控制台打印每次干预（默认关，避免刷屏）。 */
  readonly debug?: (message: string) => void
  /** 是否显示左下角调试角标（默认开）。 */
  readonly badge?: boolean
}

/** 全部可变状态。 */
const state = {
  started: false,
  observer: null as MutationObserver | null,
  timer: null as number | null,
  badgeEl: null as HTMLElement | null,
  composeUntil: 0,
  pending: null as { data: string; at: number } | null,
  debug: null as ((message: string) => void) | null,
  badge: true,
  stats: { scan: 0, found: 0, patched: 0, swallowed: 0, recovered: 0, lastError: '' },
}

/** 安全取 document。 */
function doc(): Document | null {
  try {
    return typeof document !== 'undefined' ? document : null
  } catch {
    return null
  }
}

/** 记录最后一条错误（只进角标，不外抛）。 */
function noteError(error: unknown): void {
  try {
    state.stats.lastError = error instanceof Error ? error.message : String(error)
  } catch {
    /* 忽略 */
  }
}

/** 统一的「绝不外抛」包装。 */
function safe<A extends unknown[], R>(fn: (...args: A) => R, label: string) {
  return function (this: unknown, ...args: A): R | undefined {
    try {
      return fn.apply(this, args)
    } catch (error) {
      noteError(`${label}: ${String(error)}`)
      return undefined
    }
  }
}

/** 找 composer 编辑面元素。 */
function findComposerElement(): HTMLElement | null {
  const d = doc()
  if (!d) return null
  try {
    return (d.querySelector(COMPOSER_SELECTOR) || d.querySelector(LEXICAL_SELECTOR)) as HTMLElement | null
  } catch {
    return null
  }
}

/** 找 Lexical editor 实例（多条途径，任一条成功即可）。 */
function findEditor(): { dispatchCommand?: unknown; [k: symbol]: unknown } | null {
  const composer = findComposerElement() as unknown as { __lexicalEditor?: unknown } | null
  if (composer && composer.__lexicalEditor) {
    return composer.__lexicalEditor as { dispatchCommand?: unknown; [k: symbol]: unknown }
  }
  const d = doc()
  if (!d) return null
  try {
    const editables = d.querySelectorAll('[contenteditable="true"]')
    for (const el of Array.from(editables) as unknown as { __lexicalEditor?: unknown }[]) {
      if (el.__lexicalEditor) {
        return el.__lexicalEditor as { dispatchCommand?: unknown; [k: symbol]: unknown }
      }
    }
  } catch {
    /* 忽略 */
  }
  return null
}

/**
 * 把被宿主跳过的文本补回编辑器。
 *
 * 为什么需要：宿主的 to() 在尾随换行分支里 `return ... !1`，**跳过了 insertText**，
 * 所以那段内容根本没上屏（“丢失大部分文字”）。
 * 补回走 document.execCommand('insertText')：它派发 beforeinput，由 Lexical 正常处理，
 * 不经过会 submit 的换行分支。失败则静默放弃——绝不硬改 DOM（会破坏 Lexical 受控状态）。
 */
function recoverText(rawText: string): void {
  const text = trimTrailingNewlines(rawText)
  if (!text) return
  const d = doc()
  if (!d) return
  setTimeout(
    safe(() => {
      const el = findComposerElement()
      if (!el) return
      try {
        el.focus()
      } catch {
        /* 忽略 */
      }
      let ok = false
      try {
        ok = d.execCommand('insertText', false, text)
      } catch (error) {
        noteError(`execCommand: ${String(error)}`)
      }
      if (ok) state.stats.recovered++
    }, 'recoverText'),
    0,
  )
}

/** 给一个 editor 装守卫（幂等）。 */
function patchEditor(editor: { dispatchCommand?: unknown; [k: symbol]: unknown }): boolean {
  if (!editor || editor[PATCHED] === true) return false
  const original = editor.dispatchCommand
  if (typeof original !== 'function') return false

  const wrapped = function (this: unknown, command: unknown, payload?: unknown) {
    try {
      // 必须同时满足「命令形状 + 无 payload + 在合成收尾窗口内」才吞，
      // 否则可能误伤用户点发送按钮（若它同样以 payload=null 派发）。
      if (shouldSwallowEnterDispatch(command, payload) && state.composeUntil && Date.now() <= state.composeUntil) {
        const pending = state.pending
        state.pending = null
        state.composeUntil = 0
        state.stats.swallowed++
        if (pending && pending.data) recoverText(pending.data)
        // true = 命令已消费，宿主不会继续走 submit。
        return true
      }
    } catch (error) {
      noteError(`dispatch: ${String(error)}`)
    }
    return (original as (...a: unknown[]) => unknown).apply(this, [command, payload])
  }

  editor.dispatchCommand = wrapped
  editor[PATCHED] = true
  return true
}

/** 扫描并包装当前 DOM 上的 editor。 */
function scan(): void {
  state.stats.scan++
  const editor = findEditor()
  if (!editor) return
  state.stats.found++
  if (patchEditor(editor)) state.stats.patched++
}

/** compositionend 捕获期：记录「尾随换行」的合成提交并开启判定窗口。 */
function onCompositionEnd(event: CompositionEvent): void {
  try {
    if (!event || event.isTrusted === false) return
    const data = typeof event.data === 'string' ? event.data : null
    if (!data || !endsWithNewline(data)) return
    state.pending = { data, at: Date.now() }
    state.composeUntil = Date.now() + COMPOSE_WINDOW_MS
  } catch (error) {
    noteError(`compositionend: ${String(error)}`)
  }
}

/** 左下角调试角标（出错绝不影响主体）。 */
function renderBadge(): void {
  try {
    if (!state.badge) return
    const d = doc()
    if (!d) return
    const host = d.documentElement
    if (!host) return
    if (!state.badgeEl || !state.badgeEl.isConnected) {
      const el = d.createElement('div')
      el.id = BADGE_ID
      el.setAttribute(
        'style',
        'position:fixed;left:4px;bottom:4px;z-index:2147483647;background:#123;color:#8f8;' +
          'font:10px/1.3 monospace;padding:4px 6px;border-radius:6px;opacity:.85;pointer-events:none',
      )
      host.appendChild(el)
      state.badgeEl = el
    }
    const s = state.stats
    state.badgeEl.textContent =
      `IME守卫 扫${s.scan} 找${s.found} 装${s.patched} 拦${s.swallowed} 补${s.recovered}` +
      (s.lastError ? ` ERR:${s.lastError}` : '')
  } catch {
    /* 角标失败无所谓 */
  }
}

/** 卸载（幂等，永不外抛）。 */
function dispose(): void {
  try {
    const d = doc()
    if (d) d.removeEventListener('compositionend', onCompositionEnd, true)
  } catch {
    /* 忽略 */
  }
  try {
    state.observer?.disconnect()
  } catch {
    /* 忽略 */
  }
  state.observer = null
  try {
    if (state.timer !== null) clearInterval(state.timer)
  } catch {
    /* 忽略 */
  }
  state.timer = null
  try {
    state.badgeEl?.parentNode?.removeChild(state.badgeEl)
  } catch {
    /* 忽略 */
  }
  state.badgeEl = null
  state.started = false
  state.composeUntil = 0
  state.pending = null
}

/** 安装守卫（幂等）。返回 cleanup。 */
function start(): () => void {
  if (state.started) return dispose
  const d = doc()
  if (!d) return dispose
  state.started = true

  try {
    // 捕获期监听：一定早于宿主挂在 Lexical root 上的非捕获期监听。
    d.addEventListener('compositionend', onCompositionEnd as EventListener, true)
  } catch (error) {
    noteError(`addEventListener: ${String(error)}`)
  }

  scan()
  renderBadge()

  try {
    const host = d.documentElement
    if (host && typeof MutationObserver !== 'undefined') {
      state.observer = new MutationObserver(
        safe(() => {
          scan()
          renderBadge()
        }, 'observer'),
      )
      // 观察 documentElement 而不是 document.body：body 在 DOM 就绪前可能为 null。
      state.observer.observe(host, { childList: true, subtree: true })
    }
  } catch (error) {
    noteError(`observer: ${String(error)}`)
  }

  try {
    state.timer = setInterval(
      safe(() => {
        scan()
        renderBadge()
      }, 'timer'),
      SCAN_INTERVAL_MS,
    ) as unknown as number
  } catch (error) {
    noteError(`interval: ${String(error)}`)
  }

  return dispose
}

/**
 * 安装「输入法自动发送守卫」。
 *
 * @param ctx - client 根上下文（只用于借用 effect 生命周期，缺了也能工作）。
 * @param options - 可调参数。
 */
export function installImeSubmitGuard(ctx: unknown, options: ImeSubmitGuardOptions = {}): void {
  if (options.badge === false) state.badge = false
  state.debug = options.debug ?? null

  if (!doc()) return

  // 优先借用 ctx.effect 的生命周期；不可用（或签名不同）也不影响功能。
  let bound = false
  try {
    const effect = (ctx as { effect?: unknown } | null | undefined)?.effect
    if (typeof effect === 'function') {
      ;(effect as (fn: () => () => void) => void).call(ctx, () => {
        try {
          return start()
        } catch (error) {
          noteError(`effect-start: ${String(error)}`)
          return dispose
        }
      })
      bound = true
    }
  } catch (error) {
    noteError(`ctx.effect: ${String(error)}`)
  }

  if (!bound) {
    // 没有 ctx.effect 就自己装：功能一致，只是不由宿主统一卸载。
    try {
      start()
    } catch (error) {
      noteError(`start: ${String(error)}`)
    }
  }
}
