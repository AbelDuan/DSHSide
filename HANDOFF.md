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
| 语音输入**丢字**修复 | ⚠️ 未完成 | 唯一可用的写入通道 `ClipboardEvent('paste')` 是**追加**语义，截断修复未验证成功 |
| 侧边栏图标层级重排 | ✅ 已实现 | 纯 CSS 驱动，见 §4 |
| 状态栏安全区自适应 | ✅ 已实现 | 实测 `pad = max(0, envTop − frameTop)` |
| 竖屏点会话自动收起侧边栏 | ✅ 已实现 | 横屏不收起 |
| 切换侧边栏不跳变 | ✅ 已实现 | 三条根因均已消除，见 §3 |
| 输入法唤起时侧边栏不弹跳 | ✅ 已实现 | 不再覆盖宿主的 viewport meta |

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

### 3.5 其它实测结论

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

1. **语音输入丢字**（唯一未完成项）。方向：`ClipboardEvent('paste')` 是追加语义，
   需要"先清空再粘贴"或找到能替换全文的通道。宿主基于 Lexical，
   可考虑直接操作 Lexical 的 editor state（注意此宿主缺少标准 command 常量）。
2. 补一条**收起/展开两态的截图回归**，避免以后改动再次引入跳变。
3. `verify.mjs` 的假 DOM 目前不含 rail 子树，rail 分支只有设备侧验证覆盖；
   可补一个含 `panelList` / `searchButton` / `iconButton` 的假树，让排序逻辑也进单测。

## 8. 开发工具链教训（写给接手的人）

- **不要用 PowerShell 做代码文本替换**。本项目因此两次改坏文件、
  一次留下大面积编码乱码。用 **Node 脚本 + 行级定位**，可靠得多。
- **清理乱码时不要用"宽字符集"**：`涓 / 釜 / 板 / 逛 / 浠` 等**本来就是正常汉字**，
  当成乱码会误伤正常文本。只用**确证是乱码的序列**（如 `閳光偓` / `鍏夊亾`）。
- 定位数组边界时注意结尾可能是 `].join('')` 而不是 `];`，别匹配错位置。
