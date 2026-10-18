import { readFileSync } from 'node:fs'

const code = readFileSync(process.argv[2], 'utf8')
const EXPECT_ID = 'dsh-sidebar-tweaks'

let failures = 0
function check(ok, msg) {
  if (ok) { console.log('  ok   ' + msg) } else { console.error('  FAIL ' + msg); failures++ }
}

/* ── 定时器可控：interval 只登记，timeout 同步执行 ───────────────────────── */
const timers = { intervals: [] }
globalThis.setInterval = (fn) => { timers.intervals.push(fn); return timers.intervals.length }
globalThis.clearInterval = () => {}
globalThis.setTimeout = (fn) => { fn(); return 0 }

/* ── 假元素 ─────────────────────────────────────────────────────────────── */
function el(className, parent) {
  const node = {
    className: className || '',
    style: {},
    parentElement: parent || null,
    clicks: 0,
    attrs: {},
    writes: 0,
    textContent: '',
    children: [],
    click() { node.clicks++ },
    addEventListener() {},
    setAttribute(k, v) { node.attrs[k] = v; node.writes++ },
    getAttribute(k) { return k in node.attrs ? node.attrs[k] : null },
    hasAttribute(k) { return k in node.attrs },
    appendChild(n) { node.children.push(n); return n },
    querySelector() { return null },
    querySelectorAll() { return [] },
    contains() { return false }
  }
  return node
}

/*
 * 侧边栏骨架。注意多了一层 frame 祖先 —— findFrame() 就是从侧边栏根往上
 * 找类名含 _frame 的祖先。
 */
function buildSidebar() {
  const frame = el('pI_x6G_frame')
  const root = el('hHd-Xa_root', frame)
  const child = {
    logoRow: el('hHd-Xa_logoRow', root),
    newSession: el('hHd-Xa_newSession', root),
    panelList: el('hHd-Xa_panelList', root),
    regionArea: el('hHd-Xa_regionArea', root),
    footArea: el('hHd-Xa_footArea', root)
  }
  const toggle = el('hHd-Xa_toggle', child.logoRow)
  child.logoRow.querySelector = () => toggle
  root.querySelectorAll = () => []
  root.querySelector = (sel) => {
    if (sel === 'button[class*="_toggle"]') return toggle
    if (sel === '[class*="_logoRow"]') return child.logoRow
    if (sel === '[class*="_newSession"]') return child.newSession
    if (sel === '[class*="_panelList"]') return child.panelList
    if (sel === '[class*="_regionArea"]') return child.regionArea
    if (sel === '[class*="_footArea"]') return child.footArea
    return null
  }
  return { frame, root, child, toggle }
}

function fakeDocument(sidebar, collapsed, opts) {
  const o = opts || {}
  const viewportMeta = el('meta')
  viewportMeta.attrs.content = o.viewportContent === undefined
    ? 'width=device-width, initial-scale=1'
    : o.viewportContent
  const themeMeta = el('meta')
  themeMeta.attrs.name = 'theme-color'
  const head = el('head')

  const doc = {
    viewportMeta,
    themeMeta,
    head,
    documentElement: { style: {} },
    body: {},
    createElement(tag) { const n = el(tag); n.tagName = tag; return n },
    querySelector(sel) {
      if (sel === '[class*="_logoRow"]') return sidebar ? sidebar.child.logoRow : null
      if (sel === '[data-sidebar-collapsed]') return collapsed ? { getAttribute: () => 'true' } : null
      if (sel === 'meta[name="viewport"]') return viewportMeta
      if (sel === 'meta[name="theme-color"]') return o.hasThemeMeta === false ? null : themeMeta
      if (sel === 'style[data-dshsb]') return head.children.find((n) => n.attrs['data-dshsb'] === '1') || null
      if (sel === '[class*="_frame"]') return sidebar ? sidebar.frame : null
      return null
    },
    addEventListener() {}
  }
  return doc
}

function loadModule(opts) {
  const o = opts || {}
  let captured = null
  const listeners = {}
  timers.intervals.length = 0

  globalThis.window = {
    __ModuleLoader__: { load: (def) => { captured = def } },
    addEventListener(type, fn) { listeners['win:' + type] = fn },
    matchMedia(q) {
      if (q.indexOf('portrait') !== -1) return { matches: !!o.portrait }
      if (q.indexOf('landscape') !== -1) return { matches: !o.portrait }
      return { matches: false }
    },
    getComputedStyle() { return { backgroundColor: o.bodyBg || 'rgb(20, 20, 20)' } },
    visualViewport: { height: 900, offsetTop: 0, addEventListener() {} },
    innerWidth: o.portrait ? 400 : 900,
    innerHeight: 900
  }

  if (o.document === null) delete globalThis.document
  else if (o.document) {
    const doc = o.document
    doc.addEventListener = (type, fn) => { listeners[type] = fn }
    globalThis.document = doc
  } else delete globalThis.document

  const warns = []
  const realWarn = console.warn
  console.warn = (...a) => { warns.push(a.join(' ')) }
  try {
    ;(0, eval)(code)
    if (!captured) throw new Error('__ModuleLoader__.load() 未被调用')
    if (captured.id !== EXPECT_ID) throw new Error('id 不对: ' + captured.id)
  } finally {
    console.warn = realWarn
  }
  if (!captured) throw new Error('__ModuleLoader__.load() 未被调用')
  if (captured.id !== EXPECT_ID) throw new Error('id 不对: ' + captured.id)
  return { mod: captured.factory(() => { throw new Error('unexpected require') }), listeners }
}

/* ═══ 1. 加载器契约 ═══════════════════════════════════════════════════════ */
console.log('\n[1] 加载器契约')
let loaded = loadModule({ document: null })
check(loaded.mod.name === EXPECT_ID, 'name = ' + EXPECT_ID)
check(Array.isArray(loaded.mod.inject), 'inject 是数组')
check(typeof loaded.mod.apply === 'function', 'apply 是函数')

/* ═══ 2. apply 健壮性 ═════════════════════════════════════════════════════ */
console.log('\n[2] apply() 健壮性（任一抛异常都会让 WebUI 白屏）')
function noThrow(label, fn) {
  try { fn(); check(true, label) } catch (e) { check(false, label + ' -> ' + e.message) }
}
noThrow('无 document', () => loaded.mod.apply({}, {}))
noThrow('ctx = null', () => loaded.mod.apply(null, {}))
noThrow('ctx.effect = undefined', () => loaded.mod.apply({ effect: undefined }, {}))

const bare = fakeDocument(null, false, { hasThemeMeta: false })
loaded = loadModule({ document: bare })
noThrow('有 document 但无侧边栏', () => loaded.mod.apply({ effect: (fn) => fn() }, {}))

/* ═══ 3. 侧边栏排序 ═══════════════════════════════════════════════════════ */
console.log('\n[3] 侧边栏排序（鲸鱼最底、新建会话紧贴其上）')
const sb = buildSidebar()
loaded = loadModule({ document: fakeDocument(sb, false) })
loaded.mod.apply({ effect: (fn) => fn() }, {})
const poll = timers.intervals[0]

const order = {
  panelList: sb.child.panelList.style.order,
  regionArea: sb.child.regionArea.style.order,
  logoRow: sb.child.logoRow.style.order,
  newSession: sb.child.newSession.style.order,
  footArea: sb.child.footArea.style.order
}
console.log('  order =', JSON.stringify(order))
check(order.panelList === '92', '面板列表 order = 92')
check(order.regionArea === '10', '展开态：工作区区块提前 order = 10')
check(order.logoRow === '80', '鲸鱼/侧边展开 order = 80')
check(order.newSession === '90', '新建会话 order = 90')
check(order.footArea === '100', '设置 order = 100')
check(Number(order.logoRow) < Number(order.panelList), '面板图标在鲸鱼之下')
check(Number(order.logoRow) < Number(order.newSession), '新建会话在鲸鱼之下')
check(Number(order.newSession) < Number(order.panelList), '面板图标在新建会话之下')
check(Number(order.regionArea) < Number(order.logoRow), '工作区区块在图标之上（图标沉底）')
check(Number(order.regionArea) < Number(order.footArea), '设置在图标组之下（最底）')
check(Number(order.logoRow) < Number(order.newSession) &&
      Number(order.newSession) < Number(order.panelList) &&
      Number(order.panelList) < Number(order.footArea), '展开态底部顺序：鲸鱼 → 新会话 → 面板图标 → 设置')
check((loaded.warns || []).length === 0, '运行期无内部异常（safe 未吞掉错误）')
check(typeof poll === 'function', '注册了轮询（无 MutationObserver）')

/* ═══ 5. 点击会话折叠 ═════════════════════════════════════════════════════ */
console.log('\n[5] 点击会话自动收起')
const sessionRow = { closest: (sel) => (sel === '[data-row-key^="session:"]' ? {} : null) }
const otherRow = { closest: () => null }

function clickTest(label, opts) {
  const s = buildSidebar()
  const m = loadModule({ document: fakeDocument(s, opts.collapsed), portrait: opts.portrait })
  m.mod.apply({ effect: (fn) => fn() }, {})
  const handler = m.listeners.click
  if (typeof handler !== 'function') { check(false, label + ' 未注册 click 监听'); return -1 }
  handler({ target: opts.row })
  return s.toggle.clicks
}

check(clickTest('竖屏', { portrait: true, collapsed: false, row: sessionRow }) === 1,
  '竖屏点会话 -> 触发折叠 1 次')
check(clickTest('横屏', { portrait: false, collapsed: false, row: sessionRow }) === 0,
  '横屏点会话 -> 不折叠')
check(clickTest('已收起', { portrait: true, collapsed: true, row: sessionRow }) === 0,
  '已收起时点会话 -> 不再点（否则会展开）')
check(clickTest('非会话行', { portrait: true, collapsed: false, row: otherRow }) === 0,
  '点非会话行 -> 不折叠')

/* ═══ 汇总 ═══════════════════════════════════════════════════════════════ */
console.log('')
if (failures > 0) {
  console.error('❌ ' + failures + ' 项校验失败')
  process.exit(1)
}
console.log('✅ 全部校验通过')
process.exit(0)
