# dsh-mobile-tweaks

给 **DSH Folk**（安卓端 WebView 容器）用的手机端适配插件。
跑在 DSH 的 Web 前端里，**不需要改宿主、不需要 root**。

> 本插件由 `dsh-sidebar-tweaks` + `dsh-ime-submit-guard` **合并而成**（2026-10-19）。
> 合并原因见 [§ 为什么合并](#为什么合并)。两个旧插件的目录仍保留在本仓库中，
> 作为历史参考，但**不再随 profile 加载**。

## 功能

插件内部是两个互不干扰的 PART，各自独立 `try/catch`：

### PART A —— 侧边栏

| 能力 | 说明 |
|---|---|
| 图标重排 | 插件 / 工作区 / 空白 / **鲸鱼** / 新建会话 / 自动化任务 / 设置，自上而下 |
| 鲸鱼沉底 | `order:80`，新建会话 `90` 紧随其后 |
| 竖屏自动收起 | 竖屏点选会话后收起侧边栏；横屏不收起 |
| 状态栏避让 | 认领 `viewport-fit=cover`，顶部 padding 钉住 |
| **挖孔跳变修复** | 中和 App 外壳注入的 `#root` 水平/底部 padding |
| 键盘冻结 | 软键盘可见期间不写 DOM，避免重排跳动 |

### PART B —— 输入法

| 能力 | 说明 |
|---|---|
| 阻止自动发送 | 拦 `compositionend`，合成收尾时不再自己发出去 |
| 键盘按需唤起 | 只在手动点击输入框时弹出；新建会话 / 点发送都不唤醒 |
| **听写不丢字** | 用原子写入补全被截断的听写文本，不再「删掉却贴不回来」 |

## 安装

插件在 DSH profile 里必须以**真实文件**存在（**不要用符号链接**）：

```
~/.dsh/plugins/dsh-mobile-tweaks/               # 权威源
~/.dsh/profiles/web/node_modules/dsh-mobile-tweaks/   # 生效路径（必须是真实文件）
```

并在 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 里加一行：

```json
"dsh-mobile-tweaks"
```

改动后**必须重启 DSH Web 进程**才生效（客户端插件没有热重载）。

## 自检

不依赖设备、不联网，纯 Node：

```sh
node dsh-mobile-tweaks/verify.mjs dsh-mobile-tweaks/lib/client.js
```

覆盖 33 项断言：装载协议、侧边栏 order 层级、避让覆盖规则、听写修复优先级。

## 三条硬约束（改动时务必保持）

DSH 的客户端插件通过 `window.__ModuleLoader__` 注册：

1. **`load()` 必须在顶层调用**，且脚本执行期间**不得抛异常** ——
   宿主是队列加载器，一抛队列就永不排空，`dsh web: ...?token=` 不打印，
   App 拿不到 token，**WebUI 白屏**。
2. **禁止 `MutationObserver`** —— 回调里写 DOM 会重新触发自己的 childList 观察，
   形成无限微任务循环，界面卡在 `Loading plugins...`。用 `setInterval` 轮询是安全的。
3. **`apply()` 永不抛异常** —— 降级的功能好过打不开的 WebUI。

## 为什么合并

两个原插件各自定义了 **7 个同名的顶层标识符**：

```
NAME / SCAN_INTERVAL_MS / apply / doc / safe / start / state
```

其中 `start` / `state` / `apply` 的实现**完全不同**。直接拼接会让后定义者覆盖先定义者，
功能**静默失效**。因此合并时各自包进 IIFE，独立作用域：

```js
var PART_A = (function () { /* 侧边栏 */ return {...}; })();
var PART_B = (function () { /* 输入法 */ return {...}; })();
function apply(ctx) {
  try { PART_A.apply(ctx); } catch (e) {}
  try { PART_B.apply(ctx); } catch (e) {}   // 互不牵连
}
```

## 已知坑（改动前请先读）

- **App 外壳会改写 `#root` 的 padding**（`<style id="__dsh_folk_insets__">`）。
  它是**原生代码注入**，DSH 与插件都碰不到定义处，只能**覆盖**，
  且覆盖规则的特异性必须 ≥ 它（用 `html body #root`，`(1,0,2)` > `(1,0,0)`）。
  详见 [HANDOFF.md](HANDOFF.md) §界面跳变。
- **Lexical 没有全局暴露**：`window.__lexical` **恒为 undefined**。
  取编辑器实例要走元素上的 `__lexicalEditor`，节点构造器从 `ed._nodes` 取。
- **合成事件的可靠性**：合成 `KeyboardEvent(Backspace)` 与
  `ClipboardEvent('paste')` 在 Lexical 上**都不保证被接受**，
  所以不能把「删除 + 粘贴」当作主路径，只能当兜底。

## 许可证

MIT
