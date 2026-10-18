/**
 * dsh-ime-submit-guard —— 纯函数判定层（无 DOM 依赖，便于单测与探针复用）。
 *
 * 与 lib/client.js 里的对应实现必须保持一致（lib 为手工维护真源）。
 */

/** 宿主要拦的那个命令的类型名（打包后变量名不稳定，但 .type 是稳定字面量）。 */
export const KEY_ENTER_COMMAND_TYPE = 'KEY_ENTER_COMMAND'

/** 命令对象形状是 `{ type: string }`。 */
export function isKeyEnterCommand(command: unknown): boolean {
  return (
    typeof command === 'object' &&
    command !== null &&
    (command as { type?: unknown }).type === KEY_ENTER_COMMAND_TYPE
  )
}

/** 是否为「无事件」派发——宿主合成收尾的特征（dispatchCommand(cmd, null)）。 */
export function isNullPayload(payload: unknown): boolean {
  return payload === null || payload === undefined
}

/**
 * 这次 dispatchCommand 是否具备「输入法触发」的形状。
 *
 * 注意：**还必须叠加时间窗**才算真正的输入法触发，见 effects 层。
 * 单独用它会把「用户点发送按钮」也可能吞掉。
 */
export function shouldSwallowEnterDispatch(command: unknown, payload: unknown): boolean {
  return isKeyEnterCommand(command) && isNullPayload(payload)
}

/** 原文是否以换行结尾（输入法「换行 + 重排版」收尾的判定）。 */
export function endsWithNewline(data: unknown): boolean {
  return typeof data === 'string' && /[\r\n]+\s*$/.test(data)
}

/** 修剪结尾的换行与空白——补回收时用，避免再次命中宿主的换行分支。 */
export function trimTrailingNewlines(data: unknown): string {
  return typeof data === 'string' ? data.replace(/[\r\n\s]+$/, '') : ''
}
