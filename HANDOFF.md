# 交接文档：DSH 移动端插件

> 面向"换设备 / 换人继续做"。读完这份就能接上，不必重走弯路。
> 最近更新：2026-10-18

## 1. 项目目标

给 **DSH Folk**（安卓 WebView 容器，包名 `top.funcun.dshfolk`）写客户端插件，
解决两个实际使用中的痛点：

1. **语音输入会把消息自动发出去，还丢文字**（输入法合成收尾时宿主自行提交）
2. **侧边栏布局不符合使用习惯**（图标位置、状态栏遮挡、切换时跳变）

## 2. 当前状态一览

| 能力 | 状态 | 说明 |
|---|---|---|
| 阻止输入法自动发送 | ✅ 已实现 | 拦 `compositionend`，宿主不再自动发送 |
| 键盘只在点击输入框时唤起 | ✅ 已实现 | 用 `inputmode="none"`，仅在 touch **起始点**落在输入框内时移除 |
| 语音输入**丢字**修复 | 🔧 已重写待验证 | 旧路径「先删光再粘贴」是丢字的元凶（合成事件不可靠，删掉却贴不回来）。已改为**原子写入优先**（Lexical 内部 API → `execCommand`），旧的删除+粘贴降级为兜底 |
| 侧边栏图标层级重排 | ✅ 已实现 | 纯 CSS 驱动，见 §4 |
| 状态栏安全区自适应 | ✅ 已实现 | 实测 `pad = max(0, envTop − frameTop)` |
| 竖屏点会话自动收起侧边栏 | ✅ 已实现 | 横屏不收起 |
| 切换侧边栏不跳变 | ✅ 已实现 | 三条根因均已消除，见 §3 |
| 输入法唤起时侧边栏不弹跳 | ✅ 已实现 | 不再覆盖宿主的 viewport meta |
| **App 外壳挖孔避让导致的跳变** | ✅ 已修复 | 外壳注入 `#__dsh_folk_insets__` 反复改写 `#root` padding；插件用 `html body #root` 覆盖，见 §界面跳变 |
| **会话页首帧压状态栏** | ✅ 已修复 | 外壳 insets 是异步算的，首帧还没补上；插件主动钉住顶部 padding |

## 3. 已证实的结论（含死路，别重走）

### 3.1 运行时与文件系统：`.l2s` 悬空符号链接 ⚠️ 最重要的坑

folk 的容器运行时有两个模式：**`proroot`（可用）** 和 **`proot`（回退，会坏）**。

在 `proot` 下，运行时的 **l2s 影子机制**会把「硬链接 / 原子写入」模拟成
**指向 `/data/user/0/<pkg>/files/rootfs/.l2s/` 的宿主机绝对路径符号链接**。
容器里 `/` 就是 rootfs，这个路径**解析不到**；而 `.l2s/` 目录还会被清空，
于是所有链接**全部悬空**。

**统一症状**（一个根因，三种表现）：

| 现象 | 机制 |
|---|---|
| 插件被静默忽略（无 `skipping profile bundle` 日志） | 插件的 `package.json` / `cordis.patch.yml` 是悬空链接，容器内读不到 |
| 会话报 `ENOENT ... session.v4.jsonl.zstd` | 会话文件是悬空链接（宿主原子写入被模拟成链接） |
| 反复误判"文件正常" | **宿主机侧**这些链接能解析、字节数也对 —— 只有在容器里才失效 |

**判定与修复**：

```sh
sh ~/.dsh/plugins/restore-after-runtime-change.sh   # 第一件事就是检查运行时
```

- 运行时必须是 **`proroot`**（看进程名：`libproroot.so` 才对，`libproot.so` 就是坏的）
- 配置在 `shared_prefs/dshfolk.xml` 的 `container_runtime`
- 改它必须**保留 inode 与 SELinux context**（用 `cat > file` 就地写，不要 `mv` 覆盖）
- 已经悬空的链接：内容已丢失，只能删除对应会话

### 3.2 布局排序：必须 CSS 驱动，不能靠 JS 轮询

**死路**：用 `setInterval` 轮询去设置 `element.style.order`。
JS 最多延迟 `SCAN_INTERVAL_MS`，状态切换时会**先按旧值渲染一帧、再被改回来**
—— 这就是「切换侧边栏时跳变」的成因。

**正解**：容器级与元素级顺序**全部写进注入的 `<style>`**，CSS 随 DOM 状态同步生效。

### 3.3 布局重排：不要按状态做结构性切换

**死路**：只在收起态给 `regionArea` 加 `display:contents` 打平。
切换时整棵子树从「容器」变「打平」，结构突变 → 同样跳变。

**正解**：只打平 `panelList`（它内部只有 `panelRow`，两个状态下打平都安全），
`regionArea` 始终是普通容器 → **切换时结构完全不变**。

### 3.4 不要覆盖宿主的 viewport meta

**死路**：`assertViewport()` 强制把 `meta[name=viewport]` 改写成完整内容。
会与宿主形成「它改回、我再改」的反复写入，**布局视口宽度语义反复变化**，
宿主据此判断窄/宽 → **输入法唤起（触发 resize）时侧边栏往外弹一下再收回**。

**正解**：只在缺少 `viewport-fit` 时补上，**绝不整段覆盖**。

### 3.5 不要动 AppFrame 的盒模型（状态栏补白的坑）

**症状**：手机重启后打开 DSH，侧边栏「往一边跳一下，再回到左贴边」。

**根因**：状态栏补白公式在**启动瞬间误判**。启动时 frame 还在顶部（`frameTop=0`）
而状态栏 inset 已有值（65），`max(0, min(envTop, envTop - frameTop))` 算出 65 →
给 frame 加了 `box-sizing:border-box` + `padding-top:65px` → **frame 缩小 65px、右移 65px**
→ 约 3 秒后 app 自己把 frame 内缩好，`pad` 归零、标记移除 → 又弹回来。

**证据**（时间线探针，冷启动后截图）：

```
 706ms  fw=1096 fx=0  mk=-     正常
2001ms  fw=1096 fx=0  mk=1     标记被加上
3001ms  fw=1031 fx=65 mk=1     ← 缩小 65px、右移 65px
5001ms  fw=1096 fx=0  mk=-     ← 标记移除
```

`fw` 恰好 −65、`fx` 恰好 +65，且**精确跟随 frame 标记**。

**修法**：① `pad = 0` 时**主动移除** frame 标记，不留任何盒模型改动；
② 启动后 **5 秒内一律不补白**。修复后九个时间点 `fw=1096 fx=0 mk=-` 全程不变。

> **铁律**：app 的 frame 是 **CSS grid 容器**，侧边栏收起靠 **grid track 滑动**，
> app 自己的注释写着 "nothing reflows mid-slide"。对 frame 的任何盒模型改动
> 都会扰动轨道尺寸 —— 默认什么都不做，要改必须有实测依据。

**后续发现（同样是实测）**：输入法唤起/收起时侧边栏「往右跳一下再跳回」，
**是 app 自身行为，与本插件无关** —— 已用「桩实验」证明：把插件换成
只保留探针、零业务逻辑的桩，现象完全相同：

```
桩环境下   fw=1031 fx=65  logoX=77  logoW=256  col=null   （持续 ~400ms）
           fw=1096 fx=0   logoX=12  logoW=256  col=null   （恢复）
```

`logoX` 正好 +65px、`logoW` 不变、`col=null` → `resize` 时 **app 自己把 frame
内缩 65px**（该方向的 safe-area inset），随后恢复。

⚠️ **不要在本插件里加补偿**：内缩是瞬时的（400~800ms），而插件轮询是 600ms，
补偿只会更抖。这是 app 侧的问题。

### 3.6 其它实测结论

- **WebView 的 `console.log` 不会进 logcat**。验证只能靠页面可见载体
  （角标 / `document.title` / 屏幕截图）。
- **读 DOM 结构不要靠猜**：写一个临时探针把元素树（类名 / `order` / 尺寸）
  铺在屏幕上，截图读回来，一次就能定位。本项目两次"靠猜"都失败、两次"上探针"都一次成功。
- **类名带构建哈希**（如 `hHd-Xa_logoRow`），换版本就变 → 一律用后缀匹配 `[class*="_logoRow"]`。
- **侧边栏 DOM 结构**（0.2.1-rc.2 实测）：

  ```
  root.collapsed
    ├ logoRow            > iconButton.toggle > railMark      ← 鲸鱼（同时是展开按钮）
    ├ newSession                                             ← 新建会话
    ├ panelList          > panelRow ×2                       ← 面板图标
    ├ regionArea (flex:1)
    │   └ div > root.rail
    │       ├ sectionHeader > headerActions > iconButton     ← 项目（工作区文件夹）
    │       ├ search > searchButton                          ← 搜索
    │       └ listArea                                       ← 会话列表 / 空白
    └ footArea           > settingsArea > triggerRow         ← 设置
  ```

- **输入法写入通道**（逐个实测，别重复试）：
  `execCommand('insertText')` ❌ 被回滚；Lexical 的 `SELECT_ALL_COMMAND` /
  `INSERT_TEXT_COMMAND` 在此宿主**不存在**；`el.textContent = …` ❌ 被吞掉且累积；
  `ClipboardEvent('paste')` ✅ 唯一真实可用，但**追加**语义。

## 3.5 界面跳变的真因：App 外壳的挖孔避让注入（2026-10-19 定稿）

> **这是耗时最长、弯路最多的一段。结论已用数据钉死，别再从这个方向以外的路找。**

### 症状

横屏下界面内容（会话区、侧边栏图标）会**「右下左上」跳一次**，或**左右横跳**、**上下跳一下**。

### 真因

**不是 DSH、不是插件、不是键盘、不是输入法** —— 是 **DSH Folk App 外壳**注入的：

```html
<style id="__dsh_folk_insets__">   <!-- App 原生代码注入；DSH 与插件都碰不到定义处 -->
  #root { box-sizing: border-box !important; padding: 65px 65px 20px 0px !important; }
```

它按**「上右下左」**反复改写 `#root` 的 padding：

| padding（上 右 下 左） | 视觉效果 |
|---|---|
| `0px` | 正常 |
| `65px 0 0` | 下移 65 |
| `65px 0 20px` | 下移 65、上移 20 |
| **`65px 65px 0 0`** | **下移 65、左移 65** ← 摄像头在右 |
| **`65px 65px 20px 0`** | **下移 65、左移 65、上移 20** |

`#root` 是 `border-box`，**宽度恒为 1096 不变**，padding 从内部吃掉空间
→ 内容列在 **816px ↔ 751px** 之间跳（实测 `cw` 1096 ↔ 1031）。

### 一眼判据

- **摄像头转到左下** → 界面「**往上右**」跳
- **摄像头转到右上** → 界面「**往右下**」跳
- 与 `dumpsys window displays` 的 `ROTATION_90 左 126px / ROTATION_270 右 126px` 完全吻合

### 修复：覆盖，且特异性必须压过它

```css
/* ⚠ 必须用 html body 前缀把特异性抬到 (1,0,2)，压过外壳的 (1,0,0)，
      否则「谁后注入谁赢」，结果随加载顺序漂移 */
html body #root{padding-left:0 !important;padding-right:0 !important}   /* 不避让摄像头 */
html body #root{padding-bottom:20px !important}                          /* 底栏开合不上下跳 */
html body #root{padding-top:max(65px,env(safe-area-inset-top,0px)) !important}  /* 首帧不压状态栏 */
```

| 规则 | 为什么 |
|---|---|
| 左右清零 | 用户明确「**不需要页面避让摄像头**」 |
| 底部钉 20px | 实测 `ih=775→750`（底栏弹出）时外壳把 `padding-bottom` 从 `20` 改 `0` → 图标上下跳 |
| 顶部钉住 | 外壳 insets 是**异步**算的，首帧 `padding-top` 还是 0 → 会话页刚打开压状态栏；唤输入法触发 resize 后才补上 |

### ❌ 走过的弯路（记录以免重蹈）

| 曾经的错误方向 | 实际 |
|---|---|
| 怪 `dsh-sidebar-tweaks` 插件 | ❌ A/B 停用后**照样跳** |
| 怪 `dsh-web-mobile` | ❌ 停用后**照样跳** |
| 怪键盘高度变化（`ih` 775→445） | ❌ 悬浮键盘也跳；实测 `kb=0` 时也跳 |
| 怪输入法（微信输入法工具栏） | ❌ 换成小米输入法照样跳 |
| 怪视口跨 1024 阈值 | ❌ 实测 `iw` 恒为 1096，从未跨过 |
| 加 `maximum-scale=1` | ⚠️ 治标，且引入新问题，后已移除 |
| 加 `overflow-x:hidden` | ⚠️ 无效（横向本来就没溢出） |
| 全量禁动画 | ⚠️ 无效（不是动画问题） |

### 🎯 排查这类问题的正确顺序（血泪教训）

1. **先做 A/B 隔离**（停用插件看现象是否消失），**不要先改代码**
2. **拿运行时数据**：容器内起 HTTP 收集服务 + 插件用 `new Image().src` 上报
3. **沿 DOM 祖先链逐层测宽度**，找出**第一个变化的元素**
4. **扫 `document.styleSheets` 找命中该元素的规则**，读 `ownerNode.id` 指认注入者
   （这一步直接抓出 `#__dsh_folk_insets__`）
5. 确认根因后再改，改完**用同一套采集复验**（数值不变才算修好）

### 📡 数据采集链路（容器连不上 WebView CDP 时的唯一出路）

本机 `/proc/net/unix` **没有 `webview_devtools_remote`**（调试未开），
**logcat 也不收 WebView console**，容器内**无 ffmpeg / PIL / numpy**
（apt 因 proot 拿不到 dpkg 锁装不上）。

**可行替代** —— 容器内起服务，让页面主动上报：

```bash
cd /tmp && cat > collector.js <<'EOF'
const http=require('http'),fs=require('fs');
http.createServer((q,r)=>{fs.appendFileSync('/tmp/kb_events.log',
  new Date().toISOString()+' '+q.url+'\n');
  r.writeHead(200,{'access-control-allow-origin':'*'});r.end('ok');}).listen(3099,'0.0.0.0');
EOF
setsid nohup node collector.js >/tmp/collector.out 2>&1 </dev/null &
```

插件侧 `new Image().src = 'http://127.0.0.1:3099/log?...'`，
**只在数值变化时发**（否则刷屏）。用完记得关掉、删掉临时上报代码。

> ⚠️ App 能访问 `127.0.0.1:3080`（DSH 自身），说明**容器端口对 WebView 可见**。

## 3.6 听写丢字的真因与修法（2026-10-19）

### 症状

语音输入说完一段话，输入框内容**先完整显示、再突然变短**（用户原话：「偶尔会自动修剪」）。

### 真因

旧 `repairIfTruncated` 的「先删光、再粘贴」：

```js
deleteBackwards(el, cur.length + 2);   // 连发 N 个合成 Backspace
setTimeout(function () {
  if (textOf(el).length !== 0) return; // 校验一旦放行就往下走
  pasteText(el, want);                 // 再发一个合成 paste
}, SETTLE_MS);
```

三个失败点叠加：

| 步骤 | 问题 |
|---|---|
| `deleteBackwards` | 合成 `KeyboardEvent('keydown', Backspace)` —— **Lexical 常忽略** |
| 清空校验 | `length !== 0 → return`，一旦通过就继续 |
| `pasteText` | 合成 `ClipboardEvent('paste')` —— **同样常被忽略**，且语义是**追加**不是替换 |

**结果：删掉了、贴不回来 → 内容净丢失。**

### 修法：原子写入优先，删除+粘贴降级为兜底

```js
if (setComposerText(el, want)) {   // 一步替换整段，无「删空」中间态
  ...验证...; return;
}
legacyDeleteAndPaste(el, want);    // 仅在原子写入不可用时
```

`setComposerText` 的两条路：

1. **Lexical 内部 API** —— 从元素上的 `__lexicalEditor` 取实例，
   节点构造器从 `ed._nodes` 取（`'root'` / `'paragraph'` / `'text'`），
   在 `ed.update(fn, {discrete:true})` 里 `root.clear()` 后重建段落
2. **`execCommand('insertText')`** —— 先 `selectNodeContents` 全选，再插入 = 整段替换

### ⚠️ 两个反直觉点（都实测过）

- **`window.__lexical` 恒为 undefined** —— 官方包**没有任何 Lexical 全局暴露**。
  按 `window.__lexical` 写的那段代码**永远进不去、等于空转**。必须走元素上的 `__lexicalEditor`。
- **`ClipboardEvent('paste')` 是「追加」语义**，不是替换 ——
  这也是它不能当主路径的原因之一。

## 4. 最终布局方案（纯 CSS，零 JS 时序）

```css
[class*="_logoRow"]{order:80 !important;}
[class*="_newSession"]{order:90 !important;}
[class*="_regionArea"]{order:10 !important;}
[class*="_footArea"]{order:100 !important;}
[class*="_panelList"]{display:contents !important;}                 /* 打平后才能跨容器交错 */
[class*="_panelList"] > [class*="_panelRow"]:nth-child(1){order:-10 !important;}  /* 插件 */
[class*="_panelList"] > [class*="_panelRow"]:nth-child(2){order:92 !important;}   /* 自动化任务 */
```

**层级（自上而下）**：插件 → 工作区区块（搜索 / 项目，**顺序跟随宿主不干预**）
→ 空白 → 鲸鱼 → 新建会话 → 自动化任务 → 设置

> 「搜索 / 项目」**故意不设 order**：它们属于工作区浏览器，展开态必然在区块顶部；
> 若在收起态把它们排到底部，切换开关时这两个按钮就会上下跳变。

## 5. 代码与工具地图

```
dsh-ime-submit-guard/
  lib/client.js         ★ 构建产物（顶层 load，正式版已关调试输出）
  lib/index.js            服务端入口（空实现）
  src/                    TypeScript 源码（历史版本，已不参与构建，见 src/README.md）
  verify.mjs              本地校验：加载器契约 / apply 健壮性 / 点击折叠边界
  README.md               完整行为说明与实测数据

dsh-sidebar-tweaks/
  lib/client.js         ★ 构建产物（排序 + 状态栏安全区 + 点击折叠）
  lib/index.js            服务端入口（空实现）
  verify.mjs              本地校验（含"运行期无内部异常"检查）
  restore-after-runtime-change.sh   ★ 运行时自检 + 插件目录/工作区修复
  restore-plugin-dirs.sh   仅修复插件目录
  README.md               完整设计说明与踩坑记录
```

## 6. 设备约束（必读）

- ⚠️ **运行时必须是 `proroot`**。切到 `proot` 会引发 §3.1 的全部症状。
- ⚠️ **插件必须以真实文件部署**（两处：`~/.dsh/plugins/<name>/` 与
  `~/.dsh/profiles/web/node_modules/<name>/`）。**不要用符号链接**。
  如果生效路径是符号链接，先 `rm` 再写。
- ⚠️ **部署用「临时文件 + `mv`」原子替换**，避免中断留下空文件。
- ⚠️ **不要改 `profiles/web/package.json` 的依赖声明** —— 会触发 pnpm 重链，
  进而产生 §3.1 的符号链接。
- ⚠️ **重要文件放 `/sdcard`（bind mount，能扛 rootfs 重写）或 `~/.dsh`（跨运行时更新保留），
  不要放 `/root/*`** —— rootfs 重写会清掉 `/root` 下的非点目录。
- **设备可能锁屏**，锁屏时截图看不到 WebUI；`am start` 会重载页面。
- **不要盲点屏幕**：本项目一次盲点误触「更新运行时」，引发了一整条故障链。
  要点就先用截图确认坐标。

## 7. 下一步 TODO

按优先级：

1. **语音输入丢字** —— 🔧 **已重写，待设备验证**（见 §3.6）。
   已按原 TODO 的建议改为操作 Lexical editor state（`setComposerText` 原子写入），
   旧的「先删光再粘贴」降级为兜底。
   **待办**：真机用微信输入法说一段话，确认内容不再被修剪。
   若仍丢字，下一步查 `ed._nodes` 的节点构造器签名是否与预期一致
   （当前按 `new ParaNode()` / `new TextNode(text)` 调用）。
2. 补一条**收起/展开两态的截图回归**，避免以后改动再次引入跳变。
3. `verify.mjs` 的假 DOM 目前不含 rail 子树，rail 分支只有设备侧验证覆盖；
   可补一个含 `panelList` / `searchButton` / `iconButton` 的假树，让排序逻辑也进单测。

## 8. 开发工具链教训（写给接手的人）

- **不要用 PowerShell 做代码文本替换**。本项目因此两次改坏文件、
  一次留下大面积编码乱码。用 **Node 脚本 + 行级定位**，可靠得多。
- **清理乱码时不要用"宽字符集"**：`涓 / 釜 / 板 / 逛 / 浠` 等**本来就是正常汉字**，
  当成乱码会误伤正常文本。只用**确证是乱码的序列**（如 `閳光偓` / `鍏夊亾`）。
- 定位数组边界时注意结尾可能是 `].join('')` 而不是 `];`，别匹配错位置。
