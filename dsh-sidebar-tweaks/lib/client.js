window.__ModuleLoader__.load({ id: "dsh-sidebar-tweaks", factory: (require) => {
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
var FRAME_ATTR = 'data-dshsb-frame';
var PAD_VAR = '--dshsb-pad-top';
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
  '[class*="_panelList"] > [class*="_panelRow"]:nth-child(2){order:92 !important}'
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

var STATUS_BAR_CSS = '[' + FRAME_ATTR + '="1"]{' +
  'box-sizing:border-box !important;' +
  'padding-top:var(' + PAD_VAR + ',0px) !important;' +
  '}';
var SCAN_INTERVAL_MS = 600;
var COLLAPSE_DELAY_MS = 60;

var state = {
  started: false,
  timer: null,
  viewportOriginal: null,
  cssInjected: false
};

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
 * 让 viewport meta 常驻 viewport-fit=cover —— 否则 env(safe-area-inset-*) 恒为 0，
 * 后面整套测量都失去意义。相等即返回，反复调用也不会反复写 DOM。
 */
function assertViewport() {
  var meta = viewportMeta();
  if (!meta) return;
  var current = meta.getAttribute('content') || '';
  /*
   * 只在缺少 viewport-fit 时补上，绝不整段覆盖 app 自己的 viewport 设置。
   * 之前强制改写成完整内容，会与 app 形成「它改回、我再改」的反复写入，
   * 布局视口宽度语义反复变化 —— app 据此判断窄/宽，于是侧边栏会在
   * 输入法唤起（触发 resize）时往外弹一下再收回。
   */
  if (current.indexOf('viewport-fit') !== -1) return;
  try {
    meta.setAttribute('content', current ? current + ', viewport-fit=cover' : VIEWPORT_CONTENT);
  } catch (e) { /* ignore */ }
}

/* 用隐藏探针把 env() 读成像素值 —— JS 无法直接取 env()，只能借计算样式。 */
function measureInsets() {
  var d = doc();
  if (!d || !d.body || typeof d.createElement !== 'function' || typeof window === 'undefined') {
    return { top: 0, bottom: 0 };
  }
  var probe = null;
  var top = 0;
  var bottom = 0;
  try {
    probe = d.createElement('div');
    probe.setAttribute('data-dshsb-probe', '1');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;' +
      'padding-top:env(safe-area-inset-top,0px);' +
      'padding-bottom:env(safe-area-inset-bottom,0px);';
    d.body.appendChild(probe);
    var cs = window.getComputedStyle(probe);
    top = parseFloat(cs.paddingTop) || 0;
    bottom = parseFloat(cs.paddingBottom) || 0;
  } catch (e) { /* ignore */ }
  try { if (probe && probe.parentElement) probe.parentElement.removeChild(probe); } catch (e) { /* ignore */ }
  return { top: top, bottom: bottom };
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

function markFrame() {
  var frame = findFrame();
  if (!frame || typeof frame.setAttribute !== 'function') return;
  try {
    if (frame.getAttribute(FRAME_ATTR) !== '1') frame.setAttribute(FRAME_ATTR, '1');
  } catch (e) { /* ignore */ }
}

function injectCss() {
  var d = doc();
  if (!d || !d.head || typeof d.createElement !== 'function') return;
  try {
    if (d.querySelector('style[data-dshsb]')) return;
    var tag = d.createElement('style');
    tag.setAttribute('data-dshsb', '1');
    tag.textContent = STATUS_BAR_CSS + RAIL_CSS;
    d.head.appendChild(tag);
  } catch (e) { /* ignore */ }
}

/*
 * 自校准：只补「env 报的状态栏高度」减去「frame 顶距」的差额。
 *
 * 实测数据（2026-10-18，设备 1672x2364 / 覆盖密度 345dpi / dpr 2.15625）：
 *     envT=65  envB=20  iH=1096  sH=1097  fT=65  c1T=130
 *
 * 结论：
 *   · app 正常工作时会把 WebView 让开状态栏，此时 fT == envT（65 == 65）→ 差额 0 → 不补。
 *     之前无条件按 env 补全量，就多补了 65px，表现为"顶部离状态栏很远"。
 *   · app 偶发未能让开时（用户报的"进 dsh 时顶部被状态栏压住、要唤起输入法才恢复"），
 *     fT 会变成 0 而 envT 仍是 65 → 差额 65 → 正好补上，重叠当场消除。
 *
 * 注意不要用 screen.height - innerHeight 推 app 的让开量：实测 sH=1097 与 iH=1096
 * 几乎相等（Android WebView 的 screen.height 不含系统栏），算出来恒为 0，会退化成全量补。
 * frame.getBoundingClientRect().top 才是可信信号 —— 而且给 frame 加 padding 不会
 * 改变它自身的 top，所以不存在自我反馈。
 */
function syncSafeArea() {
  var d = doc();
  if (!d || !d.documentElement || !d.documentElement.style) return;
  var insets = measureInsets();
  var pad = 0;
  if (insets.top > 0) {
    var frame = findFrame();
    var frameTop = 0;
    try {
      frameTop = frame ? (frame.getBoundingClientRect().top || 0) : 0;
    } catch (e) { frameTop = 0; }
    /* 夹在 [0, envT] 内：最坏退化成"不补"或"补全量"，不会出现第三种更糟的结果。 */
    pad = Math.max(0, Math.min(insets.top, insets.top - frameTop));
  }
  try {
    d.documentElement.style.setProperty(PAD_VAR, pad + 'px');
  } catch (e) { /* ignore */ }
}
function applyStatusBar() {
  injectCss();
  assertViewport();
  markFrame();
  syncSafeArea();
}

function onViewportChanged() {
  safe(applyOrder, 'order')();
  safe(applyStatusBar, 'status')();
}
/* ── 启动 ─────────────────────────────────────────────────────────────────── */

function start() {
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
    }
  } catch (e) { /* ignore */ }

  /*
   * 立即生效一次，之后靠轮询兜底（无 MutationObserver，见文件头说明）。
   */
  /* 逐个包 safe：任何一个内部抛异常都不能中断 start()，否则轮询注册不上。 */
  safe(applyOrder, 'order')();
  safe(applyStatusBar, 'status')();
  try {
    state.timer = setInterval(function () {
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
} });
