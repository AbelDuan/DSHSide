# dsh-sidebar-tweaks

手机端 DSH（folk app 内的 `dsh web`）侧边栏的三处调整：

1. **重排侧边栏**：鲸鱼在最上、新建会话其次、面板图标与工作区/会话区居中、设置在最底；
2. **竖屏**下点击会话列表里的任意会话后，**自动收起侧边栏**；**横屏不收起**；
3. **状态栏避让**（自校准）：顶部内容不被状态栏压住，且不会多补出一块空隙。

纯浏览器侧（client）插件，不改动 DSH 自带的任何包。已在 **dsh 0.2.1-rc.2** 上验证。

> ⚠️ **重要修复（2026-10-18）：状态栏补白曾导致侧边栏启动时"跳一下再回来"。**
> 原因与证据见下方「启动跳变的根因」，**这段 CSS 在稳定态本就不该生效**。

---

## 一、侧边栏的真实结构

读 `@deepseek-ai/dsh-client-ui-sidebar/lib/client.js` 得到：

```
div.root                     display:flex; flex-direction:column   ← 关键
 ├ div._logoRow              ← 鲸鱼在这里
 │                            · 展开态：button.brand > brandIdentity > brandMark (FishLogo)
 │                            · 折叠态：同一行内 toggle 按钮里的 railMark（同样是鲸鱼）
 │                            ⚠ 折叠按钮也在 logoRow 内 → 它会跟着鲸鱼一起移动
 ├ button._newSession        ← 「新建会话」(IconNewChat)
 ├ nav._panelList            ← 面板图标（条件渲染）
 ├ div._regionArea           ← 会话列表；flex:1，负责把后面的元素顶到底部
 └ div._footArea
    └ div._settingsArea      ← 齿轮（底部固定）
```

**因为根容器本身就是纵向 flex，用 `order` 重排即可** —— 不需要移动 DOM，
所以 React 重渲染不会把它改回去。`_regionArea` 保持 `flex:1`，
`order` 比它大的元素自然被顶到底部。

| 元素 | order | 备注 |
|---|---|---|
| `panelRow[0]`（插件） | **-10** | 位于工作区区块**之上**（用户指定） |
| `_regionArea`（工作区区块：搜索 / 项目） | 10 | **顺序跟随系统，不干预**；区块自带 `flex:1` 吸收空白 |
| `_logoRow`（鲸鱼 / 侧边展开） | 80 | |
| `_newSession`（新建会话） | 90 | |
| `panelRow[1]`（自动化任务） | 92 | |
| `_footArea`（设置 / 账户） | 100 | |
| `_panelList` | `display:contents` | 两态一致：打平后 `panelRow` 才是根 flex 项 |

**层级（自上而下）**：插件 → 工作区区块（搜索 / 项目）→ 空白 → 鲸鱼 → 新会话 → 自动化任务 → 设置
### 三条踩坑结论（都写进代码注释了）

**① 排序必须由 CSS 驱动，不能靠 JS 轮询。**
JS 轮询最多延迟 SCAN_INTERVAL_MS，状态切换时会先按旧值渲染一帧、再被改回来 —— 这就是「切换侧边栏时跳变」的成因。现在全部排序都在 CSS 里，随 DOM 状态同步生效。

**② 不按收起/展开做结构性切换。**
早期只在收起态给 egionArea 打平（display:contents），切换时整棵子树从「容器」变「打平」，同样会跳变。现在只打平 panelList（内部只有 panelRow，两态打平都安全），egionArea 始终是普通容器 —— **切换时结构完全不变**。

**③ 不要覆盖 app 的 viewport meta。**
早期强制把 meta 改写成完整内容，会与 app 形成「它改回、我再改」的反复写入，布局视口宽度语义反复变化 —— app 据此判断窄/宽，于是**输入法唤起（触发 resize）时侧边栏会往外弹一下再收回**。现在只在缺少 iewport-fit 时补上，绝不整段覆盖。

### 搜索 / 项目 为何不排序

这两个按钮属于工作区浏览器（`regionArea` 区块内），展开态下**必然位于区块顶部**。
如果在收起态把它们排到底部，切换侧边栏开关时它们就会在顶部/底部之间**跳变** ✗ ——
这是用户明确要求消除的问题。

因此**不干预**它们的 order：两个状态下都留在工作区区块顶部，且 rail 里的 DOM 顺序
天然就是 **「工作区文件夹 → 搜索」**，正好是用户期望的上下关系 ✓

两态一致的行为（自上而下）：**工作区文件夹 → 搜索** 留在侧边栏顶部（不跳变）；
**鲸鱼 → 新建会话 → 自动化任务 → 插件 → 设置** 沉在侧边栏底部（空白由 listArea / egionArea 的 lex:1 吸收在上方）。

> 收起态额外做逐层打平（display:contents）以实现面板图标的逐个排序；展开态不动内部结构，只把工作区区块整体提前。

> 顺序由用户分两次指定（2026-10-18）：先设置与鲸鱼对调，再把顶部的图标组下移到「新建会话」与「设置」之间。

### ⚠️ 类名带构建哈希，不要写死

类名形如 `hHd-Xa_logoRow`，`hHd-Xa` 是构建哈希，**换版本就会变**。因此一律用后缀匹配：

```js
'[class*="_logoRow"]'      // ✅ 哈希变了仍匹配
'.hHd-Xa_logoRow'          // ❌ 版本升级即失效
```

> 已在 0.2.0-rc.2 → 0.2.1-rc.2 的升级中验证：`_logoRow` / `_newSession` /
> `_panelList` / `_regionArea` / `_footArea` / `data-row-key="session:` /
> `data-sidebar-collapsed` / `_frame` **全部仍然存在**，sidebar 客户端包从
> 31997 → 31995 字节，结构几乎未变。

---

## 二、点击会话后收起：为什么复用应用自己的按钮

折叠状态由 **ui-layout 的 store** 拥有（sidebar 只是接收 `collapsed` 属性），插件改不了。
但 layout 里的 `toggleSidebar` 在窄屏下就是翻转 `narrowExpanded`：

```js
const narrow = viewport < 1024;                    // SIDEBAR_AUTO_COLLAPSE = 1024
toggleSidebar: (d) => {
  if (d.layoutInfo.viewportWidth < 1024) d.layoutInfo.narrowExpanded = !d.layoutInfo.narrowExpanded;
  else d.layoutInfo.sidebar = d.layoutInfo.sidebar === 0 ? 280 : 0;
}
```

而且 **layout 里已有同类先例**：`openRightbar` 打开右栏时会把 `narrowExpanded` 置回
`false`（窄屏自动收起）：

```js
if (!d.layoutInfo.rightbarShown && d.layoutInfo.viewportWidth < 1024) d.layoutInfo.narrowExpanded = false;
```

但**「选择会话」没有这个待遇** —— 这正是本插件补的缺口。

所以做法是：点会话后，若竖屏且当前是**展开**状态，就**点击侧边栏自带的折叠按钮**，
完全走应用自身逻辑，不自己造状态。

### 判定用的都是语义标记

| 用途 | 选择器 |
|---|---|
| 会话行 | `[data-row-key^="session:"]`（行本身带 `data-row-key="session:<id>"`） |
| 是否已收起 | `[data-sidebar-collapsed]`（收起时存在、展开时属性被省略） |
| 折叠按钮 | 侧边栏根内 `button[class*="_toggle"]` |

### 三个必须守住的边界

- **只在竖屏动作**（`matchMedia('(orientation: portrait)')`，尺寸兜底）：横屏保持展开。
- **已收起时不再点**：再点折叠按钮会把它**展开**，必须跳过。
- **只认会话行**：工作区行是 `workspace:`，还有 `empty` / `overflow:`，不能误触发。

---

## 三、状态栏避让：为什么必须自校准

### 实测数据（2026-10-18，设备 1672x2364 / 覆盖密度 345dpi / dpr 2.15625）

用临时探针从页面里读出：

```
envT=65  envB=20  dpr=2.15625  iH=1096  sH=1097  fT=65  c1T=130  pad=65px
```

- `envT=65` —— `env(safe-area-inset-top)` = 65 CSS px（状态栏高度）
- **`fT=65` —— `frame.getBoundingClientRect().top` 也是 65** → **app 本来就把 WebView
  让开了状态栏**
- `sH=1097` 与 `iH=1096` 几乎相等 → **`screen.height` 在 Android WebView 里不含系统栏**，
  不能用它推 app 的让开量（会算出 0，退化成"永远补全量"）

### 结论：`pad = max(0, envT − fT)`

| 情形 | fT | 差额 | 结果 |
|---|---|---|---|
| app 正常让开（实测常态） | 65 | 0 | **不补** ✓ 不会多出空隙 |
| app 偶发未让开（用户报的"进 dsh 时被状态栏压住、要唤起输入法才恢复"） | 0 | 65 | **补满** ✓ 重叠当场消除 |
| app 让开得比状态栏还多 | >65 | 负数 | 夹到 0 ✓ |

给 frame 加 `padding-top` **不会改变它自身的 top**，所以不存在自我反馈。
补偿量还额外夹在 `[0, envT]` 内 —— 最坏情况退化成"不补"或"补全量"，
不会出现第三种更糟的结果。

### 两个必须成对的点

1. **`env()` 只有在 viewport meta 带 `viewport-fit=cover` 时才非 0**，所以要认领 meta。
   但**不能只加 cover 不加补偿**：宿主（DSH 自带包）里 `safe-area-inset` 与
   `viewport-fit` 命中都是 **0**，它完全不提供安全区适配；只加 cover 会让 WebView
   真的画到状态栏下面而无人补偿 → 偶发重叠变永久重叠。
2. **padding 必须与 `box-sizing:border-box` 同时存在**，否则 padding 是在 100% 高度
   之外再加，会把底部输入区顶出屏幕（上游 pitfalls §safe-area 记过这个坑）。

> 结论依据：全 rootfs grep 显示只有 `dsh-web-mobile` 引用 `safe-area-inset`，
> 且它被手动禁用；`--dsha-mobile-*` 变量也只有它自己在用。

---

## 四、⚠️ 三条硬约束（改代码前务必先读）

违反任意一条都会让 DSH **整个 WebUI 打不开**（白屏）。这是实际踩过的坑：

1. **`load()` 必须在顶层调用**，且脚本执行期**不得抛异常**。宿主是队列式加载器
   （`window.__ModuleLoader__`），一旦抛异常或注册方式宿主观察不到，队列永不排空
   → 不打印 `dsh web:` token 行 → folk app 拿不到 token → WebUI 打不开。
2. **禁止 `MutationObserver`**：回调里写 DOM 会重新触发自身观察 → 无限微任务循环
   → 卡在 `Loading plugins...`。本插件用 `setInterval` 轮询兜底。
3. **`apply()` 不得抛异常**。调整失效可以接受，打不开 WebUI 不行。

---

## 五、部署：⚠️ 这里有个会打死 DSH 的地雷

### 地雷：pnpm 重跑会把插件文件换成容器内读不到的符号链接

**根因（2026-10-18 实测确认，最要紧的一条）**

folk 运行时不支持硬链接（启动日志：`硬链接: 不支持 ... · 启用 l2s 模拟`），
于是它用 `.l2s/` 影子目录把硬链接**模拟成绝对路径符号链接**。而 **pnpm 正是用硬链接
把包铺进 node_modules 的**，所以**任何一次 pnpm 重跑之后**，插件目录里的文件会变成：

```
node_modules/dsh-sidebar-tweaks/package.json
  -> /data/user/0/top.funcun.dshfolk/files/rootfs/.l2s/.l2s.package.json0002
node_modules/dsh-ime-submit-guard/lib/client.js
  -> /data/user/0/top.funcun.dshfolk/files/rootfs/.l2s/.l2s.client.js0001
```

⚠ **那个目标路径是「宿主机」路径。** 宿主机侧 `wc -c` 能读、字节数也对，看起来一切正常；
但**容器里 `/` 就是 rootfs，这个路径不存在** —— 容器内的 dsh 读不到插件的
`package.json` / `cordis.patch.yml`，于是 bundle 的 `insert` 不生效，插件被**静默忽略**
（连 `skipping profile bundle` 都不会打印）。

**表现**：侧边栏排序失效、小鲸鱼回到顶部、输入法守卫失效 —— 而文件"看起来"是对的。
**这就是 2026-10-18 两个插件同时失效的真正原因**，触发点是插件管理器批量升级插件
（`.plugin-manager/logs/` 下 182 次 pnpm 操作）。

> 对照：正常工作的第三方插件（`dsh-opencode-session`、`dshmarket`）都是**真实文件**。

**所以判据不能是"可读"**（宿主机侧一律可读），**必须是"目录里有没有符号链接"**。

### 一键修复

```sh
su -c 'sh /root/.dsh/plugins/restore-plugin-dirs.sh'
```

脚本幂等：目录里没有任何符号链接就什么都不做；发现符号链接才从
`/root/.dsh/plugins/<name>/`（那里是真实文件）重建。跑完重启 folk app。

**什么时候必须跑**：装了/卸了任何插件、跑过插件管理器、或发现自建插件突然失效。
### 一键修复

```sh
su -c 'sh /root/.dsh/plugins/restore-plugin-dirs.sh'
```

脚本幂等：可读就什么都不做；不可读才从 `/root/.dsh/plugins/<name>/` 重建为真实目录。
跑完重启 folk app。

### 正确的手工部署姿势

```sh
# 1) 写插件源（权威副本）
cat new-client.js > /root/.dsh/plugins/dsh-sidebar-tweaks/lib/client.js

# 2) 写生效路径 —— 若它是符号链接，必须先删掉再写真文件
#    （直接 cat > 到指向 store 的链接会改坏 store 的内容寻址文件）
DST=/root/.dsh/profiles/web/node_modules/dsh-sidebar-tweaks/lib/client.js
[ -L "$DST" ] && rm -f "$DST"
cat new-client.js > "$DST"
chown 10372:10372 "$DST"
```

**必须用「写临时文件 + mv」而不是「先删后写」** —— 中途被打断会留下文件缺失，
插件加载失败、侧边栏静默回落到默认（已踩过一次）。

**只改文件、不要动 `package.json`**：改它会触发 pnpm 重跑，也就是上面那颗地雷。

---

## 六、文件

```
lib/client.js        浏览器侧产物 —— 真正生效的就是它
lib/index.js         宿主侧空实现，只为让 profile 里有一行可解析的插件记录
cordis.patch.yml     bundle patch：插入一行插件声明
package.json         声明 dsh.bundle.patch 与 dsh.client
verify.mjs           本地校验：加载器契约、apply 健壮性、排序权重、
                     「竖屏折叠 / 横屏不折叠 / 已收起不再点 / 非会话行忽略」
restore-plugin-dirs.sh  设备侧一键修复（见第五节）
```

校验方式：

```bash
node --check lib/client.js
node verify.mjs lib/client.js
```

## 七、已知边界

- **折叠按钮会跟着鲸鱼一起移动**：它和鲸鱼同在 `_logoRow` 内，无法只移动其一。
- **轮询间隔 600ms**：元素被 React 重建后，排序最迟 600ms 内恢复。
- **搜索结果行**（`.searchResultRow`，位于搜索面板）**不在处理范围内**：它没有
  `data-row-key`，且需求是「左侧列表里的会话」。
- **状态栏避让的"app 未让开"那一支没有实测复现过**：常态（fT=65）已实测确认补 0；
  fT=0 的情形只在截图里观察到过一次重叠，规则按差额补齐，但未在真实故障时刻量过。

## 八、启动跳变的根因（2026-10-18 实测，已修）

**症状**：手机重启后打开 DSH，侧边栏「往一边跳一下，然后再回到左贴边」。

**定位手段**：在 `start()` 里挂一个临时时间线探针，在 0/30/80/160/320/640/1200/2000/3000/5000ms
记录侧边栏宽度 `sb`、frame 宽度 `fw`、frame 左偏移 `fx`、`innerWidth`、frame 标记 `mk`、
CSS 是否注入。冷启动后一张截图即可看清哪一帧在变。

**修复前的实测**：

```
 706ms  sb=280 fw=1096 fx=0  mk=-   ← 正常
2001ms  sb=280 fw=1096 fx=0  mk=1   ← frame 标记被加上
3001ms  sb=280 fw=1031 fx=65 mk=1   ← frame 缩小 65px、右移 65px = 「跳一下」
5001ms  sb=280 fw=1096 fx=0  mk=-   ← 标记移除 = 「回到左贴边」
```

`fw` 从 1096 → **1031（正好 −65）**、`fx` 从 0 → **65** —— 而 65 正是状态栏 inset 高度，
并且**精确地跟着 frame 标记出现和消失**。→ 就是本插件的 frame 补白干的。

**机制**：启动瞬间 frame 还在顶部（`frameTop=0`），而状态栏 inset 已有值（65），
公式 `max(0, min(envTop, envTop - frameTop))` **误判为需要补白 65px**；
约 3 秒后 app 自己把 frame 内缩好（`frameTop=65`），`pad` 归零、标记移除 → 又弹回来。

**稳定态 `pad` 恒为 0** —— 这段 CSS 本就不该在启动时生效。

**修法**（两层）：
1. `markFrame(need)` 改为**按需**：`pad = 0` 时**主动移除** frame 标记，
   保证 frame 上不残留任何本插件的盒模型改动；
2. 启动后 **5 秒内一律不补白**，避开启动瞬间的误判；5 秒后仍可对真正的异常兜底。

**修复后的实测**：九个时间点 `fw=1096 fx=0 mk=-` **全程不变** ✓

> 教训：**app 的 frame 是 CSS grid 容器，侧边栏收起靠 grid track 滑动**，
> app 自己的注释明确写着 "nothing reflows mid-slide"。在 grid 容器上改
> `box-sizing` / `padding` 会扰动轨道尺寸 —— 任何对 frame 的盒模型改动都必须
> 有实测依据，且默认应当**什么都不做**。

## 九、输入法唤起时的跳动 —— **是 app 自身行为，不是本插件**（已用桩实验证明）

**症状**：唤起 / 收起输入法时，侧边栏往右跳一下再跳回。

**定位过程**：把插件换成**只保留探针、零业务逻辑**的桩，重新测一遍。
现象**完全相同**：

```
桩环境下（插件无任何逻辑）
vv/rs +100ms  fw=1031 fx=65  logoX=77  logoW=256  col=null
vv/rs +200ms  fw=1031 fx=65  logoX=77  logoW=256  col=null
vv/rs +400ms  fw=1031 fx=65  logoX=77  logoW=256  col=null
vv/rs +800ms  fw=1096 fx=0   logoX=12  logoW=256  col=null   ← 恢复
```

| 读数 | 含义 |
|---|---|
| `logoX` 12 → 77（**正好 +65px**） | 侧边栏内容整体右移 65px = 用户看到的"往右跳" |
| `logoW=256` 不变 | 不是宽度变化 |
| `col=null` | app 的收起状态**从未翻转**（排除 narrow/wide 判定） |
| `fw` 1096 → 1031、`fx` 0 → 65 | **frame 被内缩 65px**；约 400~800ms 后恢复 |

**结论**：`resize`（输入法唤起/收起都会触发）时，**app 自己**把 frame 内缩 65px
（65 正是该方向的 safe-area / 状态栏 inset 值），随后自行恢复。**与本插件无关。**

> 排查提示：`phone-chrome.ts` 只负责 status bar 混色与 `env(safe-area-inset-top)`；
> 本地拿到的 bundle 里搜不到 `safe-area-inset` 的 frame 内缩规则，说明那段逻辑在
> 未归档的 frame / ui-layout 包里。**不要在本插件里加补偿** —— 内缩是瞬时的
> （400~800ms），而插件轮询是 600ms，补偿只会更抖。


