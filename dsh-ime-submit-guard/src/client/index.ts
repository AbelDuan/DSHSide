/**
 * dsh-ime-submit-guard，浏览器侧入口。
 *
 * ⚠️ apply 必须**永不抛异常**。宿主是队列式加载器（window.__ModuleLoader__），
 * 任何从 client 插件逃逸的异常都可能让队列排不空、loader 永不 settle，
 * 最终表现为「DSH 白屏、没有 web token」（2026-10-17 事故）。见 effects 层文件头。
 *
 * 刻意不 inject 任何宿主服务 —— 守卫只包装 editor.dispatchCommand 并读 DOM，
 * 因此对宿主版本不敏感，宿主升级也不会因为缺服务而拒绝加载。
 */

import { installImeSubmitGuard } from './effects/ime-submit-guard.ts'

/** 不注入任何宿主服务：守卫只需要 DOM 上的 editor 引用。 */
export const inject: string[] = []

/** 插件名（与 package.json / cordis.patch.yml 的 id 保持一致）。 */
export const name = 'dsh-ime-submit-guard'

/** 供 cordis 配置项透传的可调参数（全部可选）。 */
export interface ImeSubmitGuardConfig {
  /** 置 false 可完全停用守卫。 */
  readonly enabled?: boolean
  /** true 时在控制台打印每次干预。 */
  readonly debug?: boolean
  /** 置 false 可隐藏左下角调试角标。 */
  readonly badge?: boolean
}

/**
 * 应用插件。
 *
 * @param ctx - client 根上下文。
 * @param config - 来自 profile patch 的可选配置。
 */
export function apply(ctx: unknown, config: ImeSubmitGuardConfig = {}): void {
  try {
    if (config.enabled === false) return
    installImeSubmitGuard(ctx, {
      // 角标默认开：左下角一眼看出「扫/找/装/拦/补」，是排查时唯一的眼睛。
      badge: config.badge !== false,
      debug:
        config.debug === true
          ? (message: string) => {
              try {
                console.info(`[dsh-ime-submit-guard] ${message}`)
              } catch {
                /* 忽略 */
              }
            }
          : undefined,
    })
  } catch (error) {
    // 绝不允许异常逃逸到宿主加载器。
    try {
      console.warn('[dsh-ime-submit-guard] apply failed:', error)
    } catch {
      /* 连告警都失败就算了 */
    }
  }
}
