# dsh-ime-submit-guard

手机端 DSH（folk app 内的 `dsh web`）的**输入法守卫**插件。解决两个实测问题：

1. **语音输入会自动发送消息**，并同时**丢掉大部分文字**；
2. **不该弹键盘的时候弹键盘**（切换会话、发送消息之后）。

本插件是 DSH 的浏览器侧（client）插件。

---

## 一、实测到的输入法行为

在小米 Xiaomi foldable / HyperOS 上实测（2026-10-17）：

| 现象 | 实测数据 |
|---|---|
| 提交方式 | 标准合成：多次 `insertCompositionText`，最后 **1 次** `compositionend` |
| `compositionend.data` | **只带最后一段**（例如 20 字），结尾是 `U+200B` 段标记 + `\n\n`（tail 码 `8203,10,10`） |
| `insertCompositionText.data` | **携带全部语音文本**（例如 62 字） |
| 宿主行为 | 用 `compositionend.data` 提交；当它以换行结尾时**自动发送** |

**同一个事件同时造成两个症状**：自动发送 + 文字只剩最后一段。

> 注意：早期曾把 `insertCompositionText.data` 的原始长度当成"全文长度"（读到 148/154），
> 那是**假象**——里面混着大量零宽标记。去掉标记后真实文本只有 38～62 字。

---

## 二、提交守卫（解决自动发送）

在**捕获阶段**（宿主自己的监听器之前）改写 `compositionend.data`：

- 写入捕获到的**完整文本**，并去掉尾部的段标记与换行；
- 宿主不再看到"以换行结尾"的值 → **不自动发送**。

**关键点**：此宿主上 **`Object.defineProperty` 才能生效，普通赋值 `event.data = x` 无效**。

## 三、焦点守卫（解决乱弹键盘）

**先试过、并确认无效的做法**：在 `focusin` 里调用 `blur()`。
原因是 `focus` 到达 JS 时，WebView **已经通知过输入法**，此时撤销已经来不及——
实测"切换会话仍会弹出输入法"。

**现在有效的做法**：从源头剥夺弹键盘的能力。

- 给输入框常驻 `inputmode="none"` → 它**不具备**唤起虚拟键盘的条件；
- 只有**触摸起点落在输入框内**时，才临时移除该属性；
- `blur()` 保留为第二道防线；轮询会在 React 重挂输入框后**重新武装**。

打标必须限定"触摸起点在输入框内"：点**发送按钮**同样是一次触摸，
而宿主发送后会**重新聚焦**输入框——若按任意触摸打标，那次聚焦会被误判成"用户主动"而放行。

> `inputmode` 必须设在**真正可编辑的元素**上。`[data-composer-input]` 可能只是外层容器，
> 所以代码会遍历所有候选元素（含内层 `contenteditable`）。

---

## 四、⚠️ 三条硬约束（改代码前务必先读）

违反任意一条都会让 DSH **整个 WebUI 打不开**（白屏）。这是实际踩过的坑：

1. **`load()` 必须在顶层调用**，且脚本执行期**不得抛异常**。
   宿主是队列式加载器（`window.__ModuleLoader__`），一旦抛异常或注册方式宿主观察不到，
   队列永不排空 → 不打印 `dsh web:` token 行 → folk app 拿不到 token → 不打开 WebUI。
   （曾用 IIFE 包一层注册，就是这个后果。）
2. **禁止使用 `MutationObserver`**。回调里写 DOM 会重新触发自身的 `childList` 观察
   → 无限微任务循环 → 卡在宿主的 `Loading plugins...`。轮询请用 `setInterval`。
3. **`apply()` 不得抛异常**。守卫失效可以接受，打不开 WebUI 不行。

---

## 五、写入通道实测结论（想改输入框内容的人别重复踩）

要把文字写回此宿主的 Lexical 编辑区，各通道实测结果：

| 通道 | 结果 |
|---|---|
| `document.execCommand('insertText')` | ❌ 返回 `true` 但被回滚 |
| Lexical 命令 `SELECT_ALL_COMMAND` / `INSERT_TEXT_COMMAND` | ❌ 不在该宿主的命令集内，静默忽略 |
| `el.textContent = …` | ❌ 被 reconciler 当输入吸收后重渲染 → **叠加**（曾一路涨到 200） |
| `ClipboardEvent('paste')` | ✅ **唯一真正写入的通道**，但是**追加**语义 |
| 合成 `Backspace` keydown | 可用于清空（`KEY_BACKSPACE_COMMAND` 是 Lexical 核心命令） |

因此补文本策略是「**先清空，再粘贴**」，而不是「选中替换」。

**⚠️ 当前状态**：截断修复（清空 + 粘贴）**在此宿主上尚未验证成功**。
目前**可靠的是"不自动发送"与"不乱弹键盘"**；丢字问题仍可能存在。

---

## 六、安装位置

作为**本地插件**安装：

- 插件源：`/root/.dsh/plugins/dsh-ime-submit-guard/`（设备 rootfs 内，权威源）
- profile 依赖：`dsh-ime-submit-guard: file:./node_modules/dsh-ime-submit-guard`
- profile bundles：`dsh-ime-submit-guard`
- 生效路径（真正被加载的）：`…/profiles/web/node_modules/dsh-ime-submit-guard/lib/client.js`

> 部署时**两个位置都要更新**，且 `chown 10372:10372`。

启用 / 停用：在 profile 的 `cordis.patch.yml` 里加

```yaml
- id: dsh-ime-submit-guard
  disabled: true     # 停用
```

改完需要重启 `dsh web`（改 patch 不会热更）。

---

## 七、文件

```
lib/client.js        浏览器侧产物 —— 唯一权威，真正生效的就是它
lib/index.js         宿主侧空实现，只为让 profile 里有一行可解析的插件记录
cordis.patch.yml     bundle patch：插入一行插件声明
package.json         声明 dsh.bundle.patch 与 dsh.client
verify.mjs           本地运行时验证：伪造 __ModuleLoader__，断言 factory 结构，
                     并验证 apply() 在 {} / null / 无 effect 三种恶劣 ctx 下都不抛异常
src/                 早期 TypeScript 版本，已不再参与构建（见 src/README.md）
```

## 八、开发提示

- **不要运行 `scripts/build.mjs`**，它已随仓库移除：它生成的是**早期有缺陷的产物**，
  会重新引入 `MutationObserver` 自触发死循环，直接把 WebUI 打不开。
- **`lib/client.js` 是手工维护的唯一源头**，改它即可，不需要构建步骤。
- 改完务必跑：

```bash
node --check lib/client.js
node verify.mjs lib/client.js
```

- **调试手段**：此设备上 WebView 的 `console.log` **不会**转发到 logcat
  （`adb logcat | grep` 拿不到），所以验证只能靠页面角标或 `document.title` 之类可见载体。

---

## 九、正式版与调试版的差异

正式版已关闭全部调试输出。与调试版的差异**只有两处**，都在 `lib/client.js`：

| 位置 | 正式版 | 调试版 | 作用 |
|---|---|---|---|
| `DEBUG_BADGE` | `false` | `true` | 右下角状态角标（`S<拦截次数> A<放行次数> armed/open`） |
| `log()` | 空函数 | `console.log` | 启动时输出一行 `started` |

之所以保留空的 `log()` 函数而不删掉调用点，是为了让两个版本的差异尽可能小 ——
这样切换时不会碰到已验证过的功能逻辑。

需要重新排查时，把这两处改回调试版即可；**功能逻辑本身没有任何差异**。
