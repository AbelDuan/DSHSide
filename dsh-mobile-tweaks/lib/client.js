window.__ModuleLoader__.load({ id: "dsh-mobile-tweaks", factory: (require) => {
"use strict";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  dsh-mobile-tweaks —— 手机端 DSH 适配层（两个插件合并而成）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  合并来源（2026-10-18，按用户要求「合成一个插件」）：
 *    · PART A  dsh-sidebar-tweaks    —— 侧边栏重排 / 状态栏避让 / 挖孔跳变修复
 *    · PART B  dsh-ime-submit-guard  —— 输入法（听写）提交保护 / 焦点保护
 *
 *  两块各自包在一个 IIFE 里。**这不是风格问题，是必须的**：
 *  两个原插件各自定义了 7 个同名的顶层标识符 ——
 *      NAME / SCAN_INTERVAL_MS / apply / doc / safe / start / state
 *  直接拼接会让后定义者覆盖先定义者（safe/doc 实现虽相同，但 start/state/apply
 *  完全不同），功能会静默失效。IIFE 给各自独立作用域，彻底消除冲突。
 *
 * ── 三条硬约束（两个原插件都有，合并后必须继续满足）──────────────────────
 *
 * 1. load() 必须在**顶层**调用，且本次脚本运行期间不得抛任何异常。
 *    宿主是队列加载器（window.__ModuleLoader__）：脚本一抛，或注册方式宿主
 *    观察不到，队列就永不排空，`dsh web: ...?token=` 那行永远不打印，
 *    DSH-Folk 拿不到 token，WebUI 打不开 —— 直接黑屏。（2026-10-17 实测）
 *
 * 2. 禁止 MutationObserver。回调里写 DOM 会触发自己的 childList 观察 ——
 *    无限微任务循环饿死「Loading plugins...」。setInterval 轮询是安全的。
 *
 * 3. apply() 永不抛异常。降级的功能好过打不开的 WebUI。
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * PART A —— 侧边栏重排 / 状态栏避让 / 挖孔跳变修复
 *            （原 dsh-sidebar-tweaks，业务代码原样搬入，未作任何逻辑改动）
 *
 *  功能清单：
 *    · 小鲸鱼（品牌行）移至侧边栏底部
 *    · 「新建会话」按钮固定在其上
 *    · 竖屏选中会话后自动收起侧边栏
 *    · 状态栏/刘海避让（viewport-fit=cover）
 *    · 键盘/输入法弹起时冻结重排，避免跳动
 *    · 【挖孔跳变修复】中和 DSH-Folk 外壳注入的 #root 水平内边距与底部内边距
 *      —— 外壳会在摄像头转到左/右时改写 #root 的 padding，导致内容在
 *      1096px ↔ 1031px 之间反复跳。详见该规则处的长注释。
 * ═══════════════════════════════════════════════════════════════════════════ */
var PART_A = (function () {
"use strict";

/*
 * dsh-sidebar-tweaks —— 手机端 DSH 的三处调整：
 *
 *   1) 把「小鲸鱼」（品牌行）挪到侧边栏最底部，并让「新建会话」紧贴在它上面；
 *   2) 竖屏下点击会话列表里的任意会话后，自动收起侧边栏（横屏不动）；
 *   3) 状态栏避让：顶部内容不被状态栏压住（自校准，见下方说明）。
 *
 * ══ 三条硬约束（改代码前务必先读；违反任意一条都会让 WebUI 白屏）══════════
 *
 * 1. load() 必须在顶层调用，且脚本执行期不得抛异常。宿主是队列式加载器
 *    （window.__ModuleLoader__）：一旦抛异常或注册方式宿主观察不到，队列永不排空，
 *    就不打印 `dsh web:` token 行，folk app 拿不到 token，WebUI 直接打不开。
 * 2. 禁止 MutationObserver：回调里写 DOM 会重新触发自身观察，形成无限微任务循环，
 *    卡在 "Loading plugins..."。用 setInterval 轮询。
 * 3. apply() 不得抛异常。调整失效可以接受，打不开 WebUI 不行。
 *
 * ══ 侧边栏真实结构（读 dsh-client-ui-sidebar/lib/client.js 得到）══════════
 *
 *   div.root                    display:flex; flex-direction:column   ← 关键
 *    ├ div._logoRow             ← 鲸鱼在这里：brand > brandIdentity > brandMark(FishLogo)
 *    │                           折叠时同一行内 toggle 按钮里还有 railMark（同样是鲸鱼）
 *    │                           ⚠ 折叠按钮也在这个 logoRow 内，所以它会同鲸鱼一起移动
 *    ├ button._newSession       ← 「新建会话」(IconNewChat)
 *    ├ nav._panelList           ← 面板图标（条件渲染）
 *    ├ div._regionArea          ← 会话列表（flex:1，负责把后面的元素顶到底部）
 *    └ div._footArea
 *       └ div._settingsArea     ← 齿轮（底部固定）
 *
 * 因为根容器本身就是纵向 flex，用 order 重排即可 —— 不需要移动 DOM，
 * 所以 React 重渲染不会把它改回去。_regionArea 保持 flex:1，
 * order 比它大的元素自然被顶到底部。
 *
 * ⚠ 类名带构建哈希（如 hHd-Xa_logoRow），换版本会变。因此一律用
 *   `[class*="_logoRow"]` 这种后缀匹配，而不是写死完整类名。
 *
 * ══ 为什么「收起」要复用应用自己的按钮 ═════════════════════════════════════
 *
 * 折叠状态由 ui-layout 的 store 拥有（sidebar 只是接收 collapsed 属性），外部改不了。
 * 但 layout 的 toggleSidebar 在窄屏下就是翻转 narrowExpanded：
 *
 *     const narrow = viewport < 1024;
 *     toggleSidebar: (d) => {
 *       if (d.layoutInfo.viewportWidth < 1024) d.layoutInfo.narrowExpanded = !d.layoutInfo.narrowExpanded;
 *       else d.layoutInfo.sidebar = d.layoutInfo.sidebar === 0 ? 280 : 0;
 *     }
 *
 * 且 layout 里已有先例：openRightbar 打开右栏时会把 narrowExpanded 置回 false
 * （窄屏自动收起）。但「选择会话」没有这个待遇 —— 这正是本插件补的缺口。
 *
 */

var NAME = 'dsh-sidebar-tweaks';

/* 侧边栏根容器通过「内含 _logoRow」定位，不依赖哈希类名。 */
var LOGO_ROW = '[class*="_logoRow"]';

/*
 * 子元素排序权重（数字越大越靠下）。
 * 顺序由用户指定：鲸鱼与设置对调；顶部图标组下移到「新建会话」与「设置」之间。
 * 自上而下：logoRow(鲸鱼/侧边展开) → newSession(新建会话) → panelList(面板图标) → regionArea(工作区/会话) → footArea(设置)。
 */
var ORDER = [
  [LOGO_ROW, 80],
  ['[class*="_newSession"]', 90],
  ['[class*="_panelList"]', 92],
  ['[class*="_regionArea"]', 10],
  ['[class*="_footArea"]', 100]
];

/* ── 状态栏避让（自校准） ───────────────────────────────────────────────────
 *
 * 背景（都是实测结论，别再靠猜）：
 *   · DSH 自带包里 safe-area-inset / viewport-fit 命中都是 0 —— 宿主不做安全区适配。
 *   · 不加补偿时，会话页标题会压到状态栏下面（截图实测：标题 y≈50，状态栏时钟 y≈88）。
 *   · 无条件按 env(safe-area-inset-top) 补全量时，顶部又会空出一大块 ——
 *     说明 app 其实已经让开了一部分，env() 报的是状态栏全高，直接照补就补多了。
 *
 * 所以这里自校准：只补「env 报的高度」减去「app 已经让开的高度」的差额，
 * 并把结果夹在 [0, env] 区间内 —— 最坏情况退化成"不补"或"补全量"，
 * 不会再出现第三种更糟的结果。
 *
 * app 已让开的高度 ≈ 整屏高 - 视口高 - 底部 inset：
 *   app 完全让开 → chrome ≈ 顶+底 inset → 差额 ≈ 0（不补）
 *   app 完全不让 → chrome ≈ 0            → 差额 = 全量（补满）
 *
 * 另：env() 只有在 viewport meta 带 viewport-fit=cover 时才非 0，故仍需认领 meta。
 */
var VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, viewport-fit=cover';
/*
 * 收起（rail）态的精确重排 —— 层级全部来自 2026-10-18 的 DOM 探针实测：
 *
 *   regionArea > div > root.rail
 *     ├ sectionHeader > headerActions > iconButton    ← 新项目文件夹（5 层）
 *     ├ search > searchButton                          ← 搜索（4 层）
 *     └ listArea 36x665                                ← 吃掉空间的空白块
 *   panelList > panelRow x2                            ← 面板图标
 *
 * 容器级 order 只能整块移动，做不到交错；逐层 display:contents 后叶子成为
 * 根 flex 容器的项，各自 order 才生效。listArea 保持独立并 flex:1 → 空白留在
 * 上方，所有图标自然落到最底部。
 *
 * ⚠ 仅作用于收起态；展开态完全不碰。
 */
var RAIL_CSS = [
  /*
   * 侧边栏重排 —— 全部写在 CSS 里：零 JS 时序、零状态分支。
   *
   * 两条原则（都是踩坑换来的）：
   * 1) 排序必须由 CSS 驱动。JS 走轮询（最多 SCAN_INTERVAL_MS 延迟），状态切换时
   *    会先按旧值渲染一帧再改回来 —— 这就是「切换侧边栏时跳变」的成因。
   * 2) 不按收起/展开做结构性切换。之前只在收起态给 regionArea 打平
   *    (display:contents)，切换时整棵子树从「容器」变「打平」，同样会跳变。
   *    现在只打平 panelList（内部只有 panelRow，两态打平都安全），
   *    regionArea 始终是普通容器 → 切换时结构不变。
   *
   * 层级（自上而下）：
   *   插件(-10) → 工作区区块(10：项目/搜索，顺序跟随系统不干预)
   *   → 空白 → 鲸鱼(80) → 新会话(90) → 自动化任务(92) → 设置(100)
   */
  '[class*="_logoRow"]{order:80 !important}',
  '[class*="_newSession"]{order:90 !important}',
  '[class*="_regionArea"]{order:10 !important}',
  '[class*="_footArea"]{order:100 !important}',
  /* panelList 打平后 panelRow 才是根 flex 项，才能与工作区区块交错排序 */
  '[class*="_panelList"]{display:contents !important}',
  /* 直接子元素即 panelRow；先后由系统注册次序决定 */
  '[class*="_panelList"] > [class*="_panelRow"]:nth-child(1){order:-10 !important}',
  '[class*="_panelList"] > [class*="_panelRow"]:nth-child(2){order:92 !important}',

  /*
   * ── 键盘弹出时内容左右横跳（2026-10-18 用户报告）──────────────────────
   *
   * 背景：横屏下给 viewport 钉了 maximum-scale=1 之后，侧边栏不再跳了
   * （narrow 不再跨 1024 翻转），但会话内容开始左右横跳。
   *
   * 机制：WebView 为了让「获得焦点的输入框」可见，在不能缩放时会改用
   *   横向/纵向平移（pan）整个 visualViewport。页面本身的横向滚动是被
   *   dsh-web-mobile 的 touch-action 限制的，但那套 CSS 只在
   *   (max-width:1023px) 武装 —— 横屏 1096dp 不在其内，于是横屏没有任何
   *   横向约束，WebView 一 pan 内容就左右移动。
   *
   * 这里补两条与断点无关的约束：
   *   ① html/body 彻底禁止横向溢出与滚动，pan 无处可去；
   *   ② 输入框字号抬到 16px —— 那是 WebView「聚焦自动缩放」的阈值，
   *      字号够大就不会触发缩放，也就不会再有缩放/平移的连锁反应
   *      （dsh-web-mobile 只在 iOS 上做了这道 16px 防线，Android 没有，
   *       而其 composer 实际是 --dsh-content-font-size 的 14px）。
   */
  'html,body{overflow-x:hidden !important;max-width:100% !important}',

  /*
   * ════ 根因修复：中和 DSH-Folk 外壳的挖孔避让（2026-10-18 定稿）════════
   *
   * 真正的元凶不是插件、不是 DSH、不是键盘、不是输入法，而是 **App 外壳**
   * 注入的一个 <style id="__dsh_folk_insets__">，它在反复改写 #root 的
   * padding（上右下左）：
   *      padding: 0px
   *      padding: 65px 0px 0px
   *      padding: 65px 0px 20px
   *      padding: 65px 65px 0px 0px        ← 右 65：内容左移
   *      padding: 65px 65px 20px 0px
   * #root 是 border-box，宽度恒为 1096 不变，padding 却从内部吃掉空间，
   * 于是右侧内容列在 816px ↔ 751px 之间来回跳（实测 cw 1096 ↔ 1031）。
   *
   * 证据链（容器内 :3099 事件上报 + raw 像素比对）：
   *   · cw=1031 与「右 65px」100% 对应，cw=1096 与「右 0px」100% 对应；
   *   · 全程 kb=0（键盘根本没弹出）→ 与键盘无关；
   *   · 抖动只在横屏发生（竖屏 0 次、横屏 20 次）；
   *   · 用户实测：摄像头在左下 → 界面「往上右」跳；在右上 → 「往右下」跳；
   *     与 dumpsys 的 ROTATION_90 左 126px / ROTATION_270 右 126px 完全吻合。
   *
   * 用户明确要求「不需要页面避让摄像头」，故这里把水平方向的内边距清零。
   * 只清 left/right，**保留上/下** —— 顶部 65px 是状态栏、底部 20px 是
   * 手势条，那两条是必要的（本插件「状态栏避让」功能也依赖它）。
   *
   * 特异性说明：#root 是 id 选择器（特异性 1,0,0），与外壳规则同级，
   * 靠「后注入者胜出」——本插件的 <style> 在 App 注入之后挂载，因此生效。
   */
  'html body #root{padding-left:0 !important;padding-right:0 !important}',
  /*
   * ── 底部 padding 也必须钉死（2026-10-18 第四轮）────────────────────────
   *
   * 用户报告：底部栏（输入法/工具条）弹出时，侧边栏底部的图标组
   * （小鲸鱼、新规划、自动化任务、设置）会「上下跳一下」。
   *
   * 实测因果（容器 :3099 上报）：
   *     ih=775（底栏收起）→ padding-bottom: 20px
   *     ih=750（底栏弹出）→ padding-bottom:  0px
   * 外壳在底栏开合时改写 #root 的 padding-bottom，内容整体上下平移 20px。
   *
   * 钉成恒定 20px：图标位置永不移动。代价是底栏弹出时多 20px 间距，
   * 但视觉上就是一段正常留白，不会突兀（方案 A，用户选定）。
   *
   * 顶部保留外壳的 65px（状态栏），本插件的「状态栏避让」依赖它。
   */
  'html body #root{padding-bottom:20px !important}',
  /*
   * ── 顶部状态栏避让：必须由插件自己钉住（2026-10-19 第五轮）──────────────
   *
   * 用户报告：**会话页刚打开时会和状态栏重叠，唤出输入法后才正常。**
   *
   * 根因：状态栏避让原本 100% 依赖 App 外壳注入的 <style id="__dsh_folk_insets__">
   * （它往 #root 写 padding: 65px ...）。但外壳的 insets 是异步算出来的 ——
   * 首帧还没算完，#root 的 padding-top 仍是 0，标题就压到状态栏下面；
   * 一旦唤出输入法触发 resize，外壳重算并补上 65px，于是「突然就正常了」。
   * 本插件的轮询（SCAN_INTERVAL_MS=600ms）只重排侧边栏，从不写 padding-top，
   * 所以补不上这个首帧缺口。
   *
   * 修法：插件主动、立即钉住顶部，不给外壳延迟的机会。
   *
   * 取值为什么是 65px 而不是 env(safe-area-inset-top)：
   *   · env() 需要 viewport-fit=cover，已在 assertViewport() 里认领；
   *   · 但本机实测 env(safe-area-inset-top) 与外壳实际用的 65px 并不相等
   *     （外壳算的是「状态栏高度 + 自留边距」），直接照 env 补会补多或补少；
   *   · 65px 是本机外壳的实测值（容器 :3099 上报 65px/0px/20px/0px，
   *     1794 条采样中恒定），与它保持一致才不会在首帧和次帧之间跳一下。
   *
   * 兜底：max() 取 env 与 65px 的较大者 —— 换到状态栏更高的设备/方向时，
   * env() 会自然接管，不会出现「补不够」。
   */
  'html body #root{padding-top:max(65px,env(safe-area-inset-top,0px)) !important}',


  /*
   * ── 终极压制：键盘期间禁用 frame 的 grid 过渡 ─────────────────────────
   *
   * 实测（2026-10-18 第二轮 raw 像素比对）：键盘前后侧边栏边界恒为 603、
   * 输入框卡片恒为 708..2245，**静态布局完全没有变化**。所以用户看到的
   * 「左右横跳」只可能出现在键盘动画那 200–300ms 里 —— 而 frame 的
   * grid-template-columns 带 transition（data-animating 时生效），
   * 任何一次列宽重算都会被渲染成一段横向滑动。
   *
   * 这里在 data-animating 期间直接掐掉过渡：列宽即使变了也是瞬切，
   * 不再有「滑过去再滑回来」的观感。代价是失去侧边栏开合的滑动动画
   * —— 用户要的是「不跳」，这个取舍是划算的。
   */
  '[class*="_frame"][data-animating]{transition:none !important}',
  '@media (pointer:coarse){',
  'textarea,',
  '[contenteditable]:not([contenteditable="false"]),',
  '[data-composer-input]{font-size:16px !important}',
  '}'
].join('');

/*
 * 收起态两个面板图标的 order。
 *
 * 「搜索 / 工作区文件夹」**故意不设 order**：它们属于工作区浏览器，展开态下必然
 * 位于顶部（regionArea 区块内）。若在收起态把它们排到底部，切换侧边栏开关时这两
 * 个按钮就会在顶部/底部之间跳变 —— 这是用户明确要求消除的问题。
 * 保持不干预后，它们两个状态都在顶部，且 rail 里的 DOM 顺序天然就是
 * 「工作区文件夹 → 搜索」，正好符合用户期望的上下关系。
 */
var RAIL_PANEL_SECOND = '92';   /* panelRow[1] = 自动化任务 */
var RAIL_PANEL_FIRST = '94';    /* panelRow[0] = 插件 */

var SCAN_INTERVAL_MS = 600;
var COLLAPSE_DELAY_MS = 60;

/* ── 软键盘（输入法）判定 ───────────────────────────────────────────────────
 *
 * 背景（2026-10-18 实测）：
 *   输入法弹出 → 可视区域变化 → 触达 window 的 resize：
 *     · 本插件的 resize 回调会重跑 applyOrder()/assertViewport()，写 DOM；
 *     · app 自己的 ui-layout 用 ResizeObserver 测 frame 宽度并写 store。
 *   两者在同一批布局变化里竞争，侧边栏（grid 第一列）在「280px ↔ 56px」
 *   之间来回渲染 —— 表现为侧边栏往右跳、左边留白、再跳回最左。
 *
 * 处理：键盘可见期间不写任何 DOM（重排/样式/meta 全部跳过），
 *   键盘收起后再补跑一次，保证最终态正确。
 *
 * 判定用 visualViewport 高度差：软键盘不改变 layout viewport 的 innerHeight，
 *   但会显著压缩 visualViewport.height。差值超过阈值即视为键盘可见。
 *   visualViewport 不可用时退回 innerHeight（老内核/桌面浏览器）。
 */
var KEYBOARD_MIN_SHRINK = 120;   /* 可视高度比布局高度少这么多 → 认定键盘可见 */


var state = {
  startedAt: 0,
  started: false,
  timer: null,
  viewportOriginal: null,
  cssInjected: false,
  keyboardOpen: false,         /* 软键盘可见期间为 true，此时冻结所有 DOM 写入 */
  maxViewportH: 0,             /* 见过的最大可视高度 = 「无键盘」基准 */
  lastPortrait: null           /* 上次的方向，用于旋转时作废旧基准 */
};

/*
 * 软键盘判定 —— 2026-10-18 重写。
 *
 * 旧写法是 `innerHeight - visualViewport.height >= 120`，**从写出来那天起
 * 就没生效过**：WebView 在 adjustResize 模式下连 innerHeight 一起缩
 * （dsh-web-mobile 的注释记录了实测「layout viewport 754→471」），
 * 两个值同步变小、差值恒 ≈ 0，于是永远判定「无键盘」，
 * 依赖它的「键盘期间冻结 DOM」也就从来没执行过。
 *
 * 现在的判据：键盘只会让可视高度变小，所以把「见过的最大高度」当无键盘基准，
 * 当前高度比基准矮出一个键盘的高度即为键盘可见。基准只增不减，
 * 并在方向变化时作废（横屏 775 比竖屏 1096 矮，不作废就会误判成键盘）。
 */
function isKeyboardOpen() {
  try {
    if (typeof window === 'undefined') return false;
    var vv = window.visualViewport;
    var h = (vv && vv.height) ? vv.height : (window.innerHeight || 0);
    if (!h) return false;
    if (state.maxViewportH === 0 || h > state.maxViewportH) {
      state.maxViewportH = h;
      return false;                 /* 刷新了最大高度：此刻必然没有键盘 */
    }
    return (state.maxViewportH - h) >= KEYBOARD_MIN_SHRINK;
  } catch (e) {
    return false;
  }
}

/*
 * 方向一变，旧的「最大高度」就失去可比性（竖 1096 / 横 775），必须清零。
 *
 * ⚠ 方向必须用 matchMedia('(orientation: portrait)') 判定，**不能**用
 * `innerHeight >= innerWidth`：键盘升起时 innerHeight 会跟着缩
 * （adjustResize），那个比较会从「竖屏」翻成「横屏」，于是把键盘弹出
 * 误当成旋转、把基准清零 —— 键盘判定当场失效（2026-10-18 测试抓到的真 bug）。
 * matchMedia 跟的是设备方向，不受键盘影响。
 */
function syncOrientationBaseline() {
  try {
    if (typeof window === 'undefined') return;
    var portraitNow;
    if (typeof window.matchMedia === 'function') {
      portraitNow = window.matchMedia('(orientation: portrait)').matches;
    } else {
      portraitNow = (window.innerHeight || 0) >= (window.innerWidth || 0);
    }
    if (state.lastPortrait !== null && state.lastPortrait !== portraitNow) {
      state.maxViewportH = 0;
    }
    state.lastPortrait = portraitNow;
  } catch (e) { /* ignore */ }
}

function doc() {
  try {
    return typeof document !== 'undefined' ? document : null;
  } catch (e) {
    return null;
  }
}

/* 包一层，保证回调永远不向外抛。 */
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

/* ── 需求 1：侧边栏排序 ───────────────────────────────────────────────────── */

/* 侧边栏根 = logoRow 的父元素。 */
function findRoot() {
  var d = doc();
  if (!d) return null;
  try {
    var logo = d.querySelector(LOGO_ROW);
    return logo ? logo.parentElement : null;
  } catch (e) {
    return null;
  }
}

/* 向上追溯到 root 的直接子元素（Tooltip 之类可能包一层）。 */
function directChildOf(root, el) {
  var node = el;
  var guard = 0;
  while (node && node.parentElement !== root && guard++ < 8) node = node.parentElement;
  return node && node.parentElement === root ? node : null;
}

/*
 * 用行内 order 重排。行内样式不会被 React 覆盖（它不写这些子元素的 style），
 * 且元素被重建时轮询会重新补上。只在取值不同时才写，避免无意义的样式失效。
 */
function applyOrder() {
  /* 软键盘可见期间冻结重排：此时写 order 会与 app 的 ResizeObserver 竞争，
     导致侧边栏在收起/展开之间来回渲染（跳变 + 左侧留白）。 */
  if (state.keyboardOpen) return false;
  var root = findRoot();
  if (!root) return false;
  var i;
  for (i = 0; i < ORDER.length; i++) {
    var found = null;
    try {
      found = root.querySelector(ORDER[i][0]);
    } catch (e) {
      found = null;
    }
    if (!found) continue;
    var target = directChildOf(root, found);
    if (!target || !target.style) continue;
    var order = String(ORDER[i][1]);
    if (target.style.order !== order) target.style.order = order;
  }
  return true;
}

/* ── 需求 2：竖屏点会话后收起 ─────────────────────────────────────────────── */

function isPortrait() {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(orientation: portrait)').matches) return true;
      /* matchMedia 已给出明确答案时不再用尺寸兜底，避免与它矛盾。 */
      if (window.matchMedia('(orientation: landscape)').matches) return false;
    }
    if (typeof window !== 'undefined') {
      return window.innerHeight >= window.innerWidth;
    }
  } catch (e) { /* ignore */ }
  return false;
}


/*
 * ui-layout 渲染 data-sidebar-collapsed={sidebarCollapsed || undefined}：
 * 收起时属性存在（="true"），展开时属性被省略。
 */
function isCollapsed() {
  var d = doc();
  if (!d) return true;
  try {
    var el = d.querySelector('[data-sidebar-collapsed]');
    if (!el) return false;
    return el.getAttribute('data-sidebar-collapsed') !== 'false';
  } catch (e) {
    return true;
  }
}

/* 侧边栏自带的折叠按钮（在 logoRow 内）。 */
function findToggle() {
  var d = doc();
  if (!d) return null;
  try {
    var logo = d.querySelector(LOGO_ROW);
    var root = logo ? logo.parentElement : null;
    if (root) {
      var btn = root.querySelector('button[class*="_toggle"]');
      if (btn) return btn;
    }
    return d.querySelector('button[class*="_iconButton"][class*="_toggle"]');
  } catch (e) {
    return null;
  }
}

/*
 * dsh-web-mobile 的移动抽屉是否已接管侧边栏。
 *
 * ── 为什么必须让路（2026-10-18 定位，侧边栏跳变的真正成因）────────────
 * dsh-web-mobile 在窄屏下把侧边栏列改成绝对定位抽屉
 * （layout.css.ts：`[data-mobile-nav="frame"] > :first-child`
 *   position:absolute + transform:translateX(-110%) + .28s transition），
 * 并且它**自己**实现了「点会话行后关抽屉」（drawer-close.ts）。
 *
 * 那套关闭走 closeDrawerAnimated：**动画落地才翻转 marker**
 * （drawer-close.ts 注释：「flips the host marker only once it has landed」）。
 * 而本插件的收起判断在 COLLAPSE_DELAY_MS(60ms) 后读 marker ——
 * 此时 .28s 的关闭动画远未结束，`data-sidebar-collapsed` 还没加上，
 * isCollapsed() 必然返回 false，于是本插件又 click 一次 toggle：
 * narrowExpanded 被翻回去 → **抽屉关了又开**。
 *
 * 视觉上就是：侧边栏右跳、左侧露出抽屉滑走后的一片空白、再弹回来。
 *
 * 功能不丢：mobile 的 drawer-close 已覆盖同一行为，本插件在移动端让路即可；
 * 桌面/未启用 mobile 时仍由本插件负责（行为与过去完全一致）。
 */
function mobileDrawerActive() {
  var d = doc();
  if (!d) return false;
  try {
    return d.querySelector('[data-mobile-nav="frame"]') !== null;
  } catch (e) {
    return false;
  }
}

/*
 * 点击会话后收起侧边栏。
 *
 * 用冒泡阶段挂在 document 上 —— React 的委托监听挂在根容器（document 内部），
 * 所以本监听器在其之后执行，不会抢掉应用自己的「打开会话」处理。
 */
function onDocumentClick(event) {
  try {
    var target = event && event.target;
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest('[data-row-key^="session:"]')) return;   /* 只认会话行 */
    /* 移动抽屉已由 dsh-web-mobile 接管：它自己会关，再动一次就是「关了又开」。 */
    if (mobileDrawerActive()) return;
    if (!isPortrait()) return;                                    /* 横屏不动 */
    if (isCollapsed()) return;                                    /* 已收起，再点会展开 */

    setTimeout(safe(function () {
      if (!isPortrait() || isCollapsed()) return;
      var btn = findToggle();
      if (!btn) return;
      btn.click();
    }, 'collapse'), COLLAPSE_DELAY_MS);
  } catch (e) { /* ignore */ }
}

/* ── 状态栏避让 ───────────────────────────────────────────────────────────── */

function viewportMeta() {
  var d = doc();
  if (!d) return null;
  try { return d.querySelector('meta[name="viewport"]'); } catch (e) { return null; }
}

/*
 * viewport meta 的两件事，都只做「缺什么补什么」，绝不整段覆盖 app 的设置
 * （整段覆盖会与 app 形成「它改回、我再改」的反复写入，而布局视口语义反复
 *  变化本身就会让侧边栏在输入法唤起时弹一下再收回）。
 *
 * ① viewport-fit=cover —— 否则 env(safe-area-inset-*) 恒为 0。
 *
 * ② （已停用）横屏时 maximum-scale=1 —— 曾经用它修「横屏时侧边栏跳变」。
 *   实测（2026-10-18，本机）：
 *     · 竖屏 CSS 视口 w775dp，横屏 w1096dp；
 *     · dsh-client-ui-layout 的判定是 `narrow = viewportWidth < 1024`；
 *       —— 竖屏 775 恒小于 1024，narrow 永远是 true，怎么变都不翻转；
 *       —— 横屏 1096 只比阈值高 72，一旦视口被挤到 1024 以下，narrow 翻转，
 *          侧边栏的宽度来源就从「宽屏 grid 列(280/0)」换成「narrowExpanded」，
 *          两套状态一换，视觉上就是侧边栏右跳、左侧露白、再弹回。
 *     · 谁把 1096 挤下去：composer 的卡片刻意用 --dsh-content-font-size 14px，
 *       而 dsh-web-mobile 的 16px 防线只挂在 html[data-mobile-nav-ios] 上
 *       —— Android 没有这道防线。WebView 聚焦小字号输入框会放大页面，
 *       1096 / 1.07 ≈ 1022 < 1024，正好跨过去。
 *   当时钉了 maximum-scale=1 掐断缩放，侧边栏确实不跳了，但随后出现
 *   「会话内容闪烁/左右跳」（2026-10-18 第二轮），且实测 oL/w/s/iw 与
 *   raw 像素逐行比对全部正常 —— 判断是禁缩放本身引起的补偿性重排。
 *   现改用「输入框字号 ≥16px」从根上消除自动缩放，不再钉 maximum-scale。
 *   横屏时 dsh-web-mobile 的 MOBILE_QUERY(max-width:1023px) 不匹配、不武装，
 *   它那套「重写 meta 的所有权」不会运行，这里的写入不会打架；竖屏由它管，
 *   而竖屏本来就不跳，无需我们插手。
 */
function assertViewport() {
  var meta = viewportMeta();
  if (!meta) return;
  var current = meta.getAttribute('content') || '';
  var want = current || VIEWPORT_CONTENT;
  if (want.indexOf('viewport-fit') === -1) {
    want = current ? current + ', viewport-fit=cover' : VIEWPORT_CONTENT;
  }
  /*
   * ── 键盘不 resize 布局视口（2026-10-18 第四轮，最终方向）──────────────
   *
   * 事件上报实测：键盘弹出后 iw 恒为 1096，但 **ih 从 775 掉到 445** ——
   * 说明布局视口高度被改变了，也就是 WebView 在 resize。布局视口一变，
   * 整页重排（官方自己也记录了「写 :root 变量会让整个文档样式失效重算」），
   * 键盘升降各一次，视觉上就是「闪/跳」。
   *
   * interactive-widget 是 Chrome 108+ 的标准属性，专治这件事：
   *   resizes-visual   → 只缩视觉视口，**布局视口不动**，浏览器自行处理
   *                      焦点可见性（我们又有 16px 字号挡住缩放）
   *   resizes-content  → 连布局视口一起缩（当前行为，重排之源）
   *   overlays-content → 两个视口都不动，键盘盖住内容（会把输入框埋掉，太险）
   *
   * 选 resizes-visual：既止住重排，又不像 overlays-content 那样让输入框
   * 沉到键盘底下。WebView 不支持时该属性被忽略，无副作用。
   */
  if (want.indexOf('interactive-widget') === -1) {
    want += ', interactive-widget=resizes-visual';
  }
  /*
   * ⚠ maximum-scale=1 已停用（2026-10-18 第二轮）。
   *
   * 它确实治好「侧边栏跳变」（narrow 不再跨 1024），但用户随即报告会话
   * 内容「左右闪烁」。实测 oL/w/s/iw 全部正常、raw 像素逐行比对也一致，
   * 静态布局没有任何位移 —— 剩下的解释就是：WebView 在「不允许缩放」时
   * 会在键盘升降时多做一轮补偿性重排，表现出来就是闪。
   *
   * 而那条「输入框字号抬到 16px」的规则已经从根上消除了自动缩放
   * （WebView 只在焦点元素字号 <16px 时才放大页面），所以钉死
   * maximum-scale 已经没有收益，只剩副作用。
   *
   * 若移除后侧边栏又跳，说明 16px 那条没吃住，届时再考虑 user-scalable=no
   * （比 maximum-scale 更硬，但也更容易引起重排问题）。
   */
  if (want === current) return;
  try {
    meta.setAttribute('content', want);
  } catch (e) { /* ignore */ }
}


/* 布局 frame：侧边栏根之上、类名含 _frame 的祖先；它是承载内边距的正确元素。 */
function findFrame() {
  var d = doc();
  if (!d) return null;
  try {
    var logo = d.querySelector(LOGO_ROW);
    var node = logo ? logo.parentElement : null;
    var guard = 0;
    while (node && guard++ < 12) {
      if (typeof node.className === 'string' && node.className.indexOf('_frame') !== -1) return node;
      node = node.parentElement;
    }
    return d.querySelector('[class*="_frame"]');
  } catch (e) { return null; }
}

function injectCss() {
  var d = doc();
  if (!d || !d.head || typeof d.createElement !== 'function') return;
  try {
    if (d.querySelector('style[data-dshsb]')) return;
    var tag = d.createElement('style');
    tag.setAttribute('data-dshsb', '1');
    tag.textContent = RAIL_CSS;
    d.head.appendChild(tag);
  } catch (e) { /* ignore */ }
}


function applyStatusBar() {
  /* 同 applyOrder：键盘期间不碰 meta，避免改变布局视口语义触发 app 重算。 */
  if (state.keyboardOpen) return;
  injectCss();
  assertViewport();
}

function onViewportChanged() {
  /* 先处理方向变化：横竖切换会让「最大高度」基准失效，必须清零。 */
  safe(syncOrientationBaseline, 'orient')();
  /* 再刷新键盘状态：键盘弹出/收起都会走 resize，这里是唯一可靠的时机。 */
  state.keyboardOpen = isKeyboardOpen();
  /*
   * 键盘可见期间不写任何 DOM（apply* 内部也会再查一次，这里提前返回省事）。
   * 键盘收起后的那一次 resize 会走到下面，把冻结期间欠下的重排补上 ——
   * 否则侧边栏会停在中间态（正是「左边留白」）。
   */
  if (state.keyboardOpen) return;
  safe(applyOrder, 'order')();
  safe(applyStatusBar, 'status')();
}
/* ── 启动 ─────────────────────────────────────────────────────────────────── */

function start() {
  if (!state.startedAt) state.startedAt = Date.now();
  if (state.started) return;
  var d = doc();
  if (!d) return;
  state.started = true;

  try {
    d.addEventListener('click', onDocumentClick, false);
    if (typeof window !== 'undefined') {
      /* 旋转 / 软键盘 / 分屏都汇到这里：isPortrait 每次现判，不缓存。 */
      window.addEventListener('resize', safe(onViewportChanged, 'resize'), false);
      window.addEventListener('orientationchange', safe(onViewportChanged, 'rotate'), false);
      /*
       * 移动端软键盘主要改变 visualViewport 而非 innerHeight，
       * 只监听 window.resize 会漏掉「键盘弹出但 innerHeight 不变」的机型。
       * 补两个 visualViewport 监听；不支持时静默跳过。
       */
      try {
        var vv = window.visualViewport;
        if (vv && typeof vv.addEventListener === 'function') {
          vv.addEventListener('resize', safe(onViewportChanged, 'vv-resize'), false);
          vv.addEventListener('scroll', safe(onViewportChanged, 'vv-scroll'), false);
        }
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }

  /* 初始化方向基准与键盘状态，避免首帧就误判为「键盘可见」而冻死重排。 */
  safe(syncOrientationBaseline, 'orient')();
  state.keyboardOpen = isKeyboardOpen();

  /*
   * 立即生效一次，之后靠轮询兜底（无 MutationObserver，见文件头说明）。
   */
  /* 逐个包 safe：任何一个内部抛异常都不能中断 start()，否则轮询注册不上。 */
  safe(applyOrder, 'order')();
  safe(applyStatusBar, 'status')();
  try {
    state.timer = setInterval(function () {
      /*
       * 轮询兜底：双向同步键盘状态。
       * 必须两个方向都纠正 —— 只处理「弹出」的话，一旦某次「收起」没触发
       * resize（部分机型如此），keyboardOpen 会永久停在 true，
       * 侧边栏从此再也不重排（比跳变更糟）。
       * 同步后照常调用 apply*：它们内部按最新状态决定写不写，
       * 收起的那一轮自然会补跑，无需在这里另开分支。
       */
      safe(syncOrientationBaseline, 'orient')();
      state.keyboardOpen = isKeyboardOpen();
      safe(applyOrder, 'order')();
      safe(applyStatusBar, 'status')();
    }, SCAN_INTERVAL_MS);
  } catch (e) { /* ignore */ }
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
})();

/* ═══════════════════════════════════════════════════════════════════════════
 * PART B —— 输入法（听写）提交保护 / 焦点保护
 *            （原 dsh-ime-submit-guard，业务代码原样搬入，未作任何逻辑改动）
 *
 *  功能清单：
 *    · 提交保护：听写会「截断 + 自动发送」，这里在捕获阶段重写
 *      compositionend.data，把完整文本交回宿主，避免只发出最后一小段。
 *    · 焦点保护：软键盘只在用户主动点输入框时升起；切换会话、按发送键
 *      都不得唤起键盘。
 * ═══════════════════════════════════════════════════════════════════════════ */
var PART_B = (function () {
"use strict";

/*
 * dsh-ime-submit-guard - client-side guard for the DSH web composer.
 *
 *   A. Submit guard - the dictation IME auto-sends the message, and truncates it.
 *   B. Focus guard  - the soft keyboard should appear only when the user taps the
 *                     composer; switching chats / pressing send must not raise it.
 *
 * 閳光偓閳光偓 Why the code looks like this 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
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
 * 閳光偓閳光偓 A. Measured IME behaviour (Xiaomi 2608BPX34C / HyperOS, 2026-10-17) 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
 *
 *   璺?Dictation is a normal composition: many insertCompositionText events, then
 *     ONE compositionend.
 *   璺?compositionend.data ends with U+200B segment markers plus "\n\n" (tail
 *     codes 8203,10,10).
 *   璺?insertCompositionText.data carries the WHOLE dictated text (e.g. 62 chars);
 *     compositionend.data carries only the LAST SEGMENT (e.g. 20 chars).
 *   璺?The host commits using compositionend.data and sends by itself when that
 *     value ends with a newline - one event both truncates and sends.
 *
 *   Fix: in the CAPTURE phase rewrite compositionend.data with the whole captured
 *   text minus trailing markers. Object.defineProperty is what works here; plain
 *   assignment does not. A moment later, if the composer holds only a truncated
 *   tail of the dictation, it is replaced by the full text.
 *
 * 閳光偓閳光偓 B. Focus guard, and why it needs inputmode 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
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

/* 閳光偓閳光偓 A. submit / truncation guard 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

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

/*
 * ── 原子写入：优先 Lexical / execCommand（2026-10-19 修「语音输入被修剪」）──
 *
 * 背景（用户实测）：语音听写后内容会**先完整显示、再突然变短**，即
 * 「偶尔自动修剪」。这是旧 repairIfTruncated 的产物：
 *      deleteBackwards(el, N)   ← 先连发 N 个合成 Backspace
 *      pasteText(el, want)      ← 再发一个合成 paste
 * 这两个合成事件在 Lexical 上都不保证被接受：
 *   · 合成 KeyboardEvent('keydown', Backspace) 常被忽略 → 删不干净；
 *   · 合成 ClipboardEvent('paste') 也常被忽略 → 贴不回来；
 *   而中间那句 `if (textOf(el).length !== 0) return` 一旦放行，
 *   就成了「删掉了、没贴回来」→ **内容净丢失**。
 *
 * 新策略：**不做破坏性的删除+重贴**，改为一次原子写入：
 *   ① Lexical 官方 API  —— 直接改编辑器状态，无中间态、无闪烁（最优）
 *   ② execCommand('insertText') —— 浏览器原生，通常被接受（次优）
 *   ③ 两者都不可用 → 返回 false，由调用方决定是否退回旧路径（兜底）
 *
 * 返回 true = 已成功原子写入，调用方不必再做任何补偿。
 */
function lexicalEditorOf(el) {
  try {
    var node = el;
    for (var i = 0; i < 4 && node; i++) {
      if (node.__lexicalEditor) return node.__lexicalEditor;
      node = node.parentElement;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function setComposerText(el, text) {
  var d = doc();

  /*
   * ① Lexical 官方 API。
   *
   * ⚠ 不要假设 window.__lexical 存在 —— 2026-10-19 实测：官方包里
   *   **没有任何 Lexical 全局暴露**，`window.__lexical` 恒为 undefined，
   *   所以旧写法那段 `if (... && lex && ...)` 永远进不去，等于空转。
   *
   * 改用「编辑器实例自己暴露的东西」：Lexical 的 editor 对象上有
   * `_nodes`（节点注册表），可以从 root 节点的构造器上取到
   * `$createParagraphNode` / 文本节点构造器。这些不需要全局变量。
   */
  try {
    var ed = lexicalEditorOf(el);
    if (ed && typeof ed.update === 'function' && ed._nodes && typeof ed._nodes.get === 'function') {
      var ok = false;
      ed.update(function () {
        try {
          /* $getRoot 的等价物：从节点表里取 'root'。 */
          var root = ed._nodes.get('root');
          /* root 是「节点的构造器（class）」，实例要用当前 editorState 取。 */
          var st = ed._editorState;
          var rootNode = st && st._nodeMap ? st._nodeMap.get('root') : null;
          if (!rootNode || typeof rootNode.clear !== 'function') return;

          /* 文本节点构造器：ed._nodes 里注册着 'text'。 */
          var TextNode = ed._nodes.get('text');
          var ParaNode = ed._nodes.get('paragraph');
          if (typeof TextNode !== 'function' || typeof ParaNode !== 'function') return;

          rootNode.clear();
          var p = new ParaNode();
          p.append(new TextNode(text));
          rootNode.append(p);
          ok = true;
        } catch (e2) { /* ignore */ }
      }, { discrete: true });
      if (ok) return true;
    }
  } catch (e) { /* ignore */ }

  /* ② execCommand('insertText')：先全选，再插入，等于整段替换。 */
  try {
    if (d && typeof d.execCommand === 'function') {
      var sel = (typeof window !== 'undefined' && window.getSelection) ? window.getSelection() : null;
      if (sel && typeof d.createRange === 'function') {
        var r = d.createRange();
        r.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(r);
        if (d.execCommand('insertText', false, text)) return true;
      }
    }
  } catch (e) { /* ignore */ }

  return false;
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
 *
 * ⚠ 2026-10-19 重写：旧实现「先删光、再粘贴」正是用户报告的
 * 「先完整显示、再突然变短」的成因 —— 合成 Backspace/paste 在 Lexical 上
 * 不保证被接受，删掉却贴不回来就是净丢失。现在优先走原子写入。
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

  /* ── 首选：原子写入（Lexical API → execCommand）─────────────────────────
   * 一步替换整段文本，没有「删空」的中间态，因此不可能出现
   * 「删掉了却没贴回来」的丢失窗口。
   */
  if (setComposerText(el, want)) {
    /* 原子写入后再验一次；不符才考虑兜底，避免无谓的第二轮扰动。 */
    setTimeout(safe(function () {
      var now = textOf(el);
      if (now === want) return;
      /* 原子写入没吃住 → 退回旧的删除+粘贴（保留最后的兜底能力）。 */
      safe(legacyDeleteAndPaste, 'legacy')(el, want);
    }, 'verify-atomic'), SETTLE_MS);
    return;
  }

  /* ── 兜底：原子写入不可用时，才用旧的删除+粘贴 ────────────────────────
   * 保留它是因为部分宿主确实只吃合成事件；但在支持的宿主上永远不会走到这。
   */
  safe(legacyDeleteAndPaste, 'legacy-nosupport')(el, want);
}

/*
 * 旧的「删除 + 粘贴」路径。
 *
 * 只在原子写入不可用（或未吃住）时才调用 —— 它是丢失内容的元凶，
 * 所以必须放在最后，并且每一步都做校验，宁可不修也不要修坏。
 */
function legacyDeleteAndPaste(el, want) {
  try {
    deleteBackwards(el, textOf(el).length + 2);
    setTimeout(safe(function () {
      if (textOf(el).length !== 0) return;        /* clearing failed - leave it alone */
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
  } catch (e) { /* ignore */ }
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

/* 閳光偓閳光偓 B. focus guard 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

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

/* 閳光偓閳光偓 status badge (verification only) 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

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
})();

/*
 * 顶层导出。
 *
 * apply 依次驱动两个 PART，各自独立 try/catch —— PART A 抛异常不会阻止
 * PART B 运行（反之亦然）。两条注册路径都覆盖：
 *   · 有 ctx.effect  → 走 effect 绑定（正常宿主路径）
 *   · 无 ctx.effect  → 立即执行（降级，确保功能仍然生效）
 */
function apply(ctx) {
  try { PART_A.apply(ctx); } catch (e) {
    try { console.warn('[dsh-mobile-tweaks] PART A apply: ' + e); } catch (e2) { /* ignore */ }
  }
  try { PART_B.apply(ctx); } catch (e) {
    try { console.warn('[dsh-mobile-tweaks] PART B apply: ' + e); } catch (e2) { /* ignore */ }
  }
}

return {
  name: 'dsh-mobile-tweaks',
  inject: [],
  apply: apply
};
} });
