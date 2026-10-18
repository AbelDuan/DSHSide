/*
 * dsh-mobile-tweaks 本地自检 —— 不依赖设备、不联网，纯 Node 跑。
 *
 *   node dsh-mobile-tweaks/verify.mjs dsh-mobile-tweaks/lib/client.js
 *
 * 覆盖三类检查：
 *   A. 装载协议（宿主三条硬约束）
 *   B. PART A 侧边栏：order 层级、状态栏/挖孔 padding 覆盖规则
 *   C. PART B 输入法：原子写入优先、旧的删除+粘贴只做兜底
 */
import { readFileSync } from 'node:fs'

const code = readFileSync(process.argv[2] ?? 'dsh-mobile-tweaks/lib/client.js', 'utf8')
const EXPECT_ID = 'dsh-mobile-tweaks'

let failures = 0
function check(ok, msg) {
  if (ok) { console.log('  ok   ' + msg) } else { console.error('  FAIL ' + msg); failures++ }
}
function section(t) { console.log('\n' + t) }

/* ── 定时器可控：interval 只登记，timeout 同步执行 ───────────────────────── */
const timers = { intervals: [] }
globalThis.setInterval = (fn) => { timers.intervals.push(fn); return timers.intervals.length }
globalThis.clearInterval = () => {}
globalThis.setTimeout = (fn) => { try { fn() } catch (e) { /* ignore */ } return 0 }

/* ── 假元素 ─────────────────────────────────────────────────────────────── */
function el(className, parent) {
  const node = {
    className: className || '', style: {}, parentElement: parent || null,
    attrs: {}, children: [], textContent: '', clicks: 0,
    click() { node.clicks++ },
    addEventListener() {},
    setAttribute(k, v) { node.attrs[k] = v },
    getAttribute(k) { return k in node.attrs ? node.attrs[k] : null },
    hasAttribute(k) { return k in node.attrs },
    appendChild(n) { node.children.push(n); return n },
    querySelector() { return null },
    querySelectorAll() { return [] },
    contains() { return false },
    getBoundingClientRect() { return { width: 1096, left: 0, top: 0, height: 775 } }
  }
  return node
}

/* ── 样式表：记录插件注入的 CSS ─────────────────────────────────────────── */
const head = el('head')
const styleTags = []
head.appendChild = (n) => { styleTags.push(n); return n }

/* ── 文档骨架 ───────────────────────────────────────────────────────────── */
const frame = el('pI_x6G_frame')
const rootEl = el('hHd-Xa_root', frame)      // 侧边栏根
const logoRow = el('hHd-Xa_logoRow', rootEl)
const newSession = el('hHd-Xa_newSession', rootEl)
const panelList = el('hHd-Xa_panelList', rootEl)
const regionArea = el('hHd-Xa_regionArea', rootEl)
const footArea = el('hHd-Xa_footArea', rootEl)

const viewportMeta = el('meta')
viewportMeta.attrs.content = 'width=device-width, initial-scale=1'

const body = el('body')
const rootDiv = el('div', body); rootDiv.id = 'root'

const doc = {
  head, body,
  documentElement: { dataset: {}, style: {} },
  styleSheets: [],
  addEventListener() {}, removeEventListener() {},
  createElement: (t) => el(t),
  createRange: () => ({ selectNodeContents() {} }),
  execCommand: () => false,
  getElementById: (id) => (id === 'root' ? rootDiv : null),
  querySelector: (sel) => {
    if (String(sel).includes('viewport')) return viewportMeta
    if (String(sel).includes('_frame')) return frame
    if (String(sel).includes('_logoRow')) return logoRow
    if (String(sel).includes('_newSession')) return newSession
    if (String(sel).includes('_panelList')) return panelList
    if (String(sel).includes('_regionArea')) return regionArea
    if (String(sel).includes('_footArea')) return footArea
    return null
  },
  querySelectorAll: () => [],
  contains() { return false }
}

/* ── window ─────────────────────────────────────────────────────────────── */
let loaded = null
globalThis.window = {
  __ModuleLoader__: { load(m) { loaded = m } },
  innerWidth: 1096, innerHeight: 775,
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
  visualViewport: { height: 775, width: 1096, offsetLeft: 0, offsetTop: 0, scale: 1, addEventListener() {} },
  getComputedStyle: () => ({ gridTemplateColumns: '280px 816px 0px', overflowY: 'hidden',
                             paddingTop: '65px', paddingRight: '0px', paddingBottom: '20px', paddingLeft: '0px' }),
  requestAnimationFrame: (f) => f(0)
}
globalThis.document = doc

/* ═══ A. 装载协议 ═══════════════════════════════════════════════════════ */
section('A. 装载协议（宿主硬约束）')

let topLevelThrew = false
try {
  new Function('window', 'document', 'setInterval', 'setTimeout', 'clearInterval', 'Image',
    code)(globalThis.window, doc, globalThis.setInterval, globalThis.setTimeout,
          globalThis.clearInterval, function () {})
} catch (e) { topLevelThrew = true; console.error('    ' + e.message) }

check(!topLevelThrew, '① 顶层执行不抛异常（否则加载队列永不排空、WebUI 白屏）')
check(loaded !== null, '② load() 在顶层被调用')
check(loaded && loaded.id === EXPECT_ID, `③ 注册 id 为 ${EXPECT_ID}`)

const mod = loaded ? loaded.factory(() => ({})) : null
check(mod !== null, '④ factory 可执行')
check(mod && mod.name === EXPECT_ID, '⑤ name 正确')
check(mod && Array.isArray(mod.inject), '⑥ inject 是数组')
check(mod && typeof mod.apply === 'function', '⑦ apply 是函数')

let applyThrew = false
try { mod.apply({}) } catch (e) { applyThrew = true }
check(!applyThrew, '⑧ apply({}) 不抛异常')
let applyThrew2 = false
try { mod.apply({ effect(fn) { fn() } }) } catch (e) { applyThrew2 = true }
check(!applyThrew2, '⑨ apply({effect}) 不抛异常')

check(!/MutationObserver/.test(code.replace(/^\s*(\*|\/\/).*$/gm, '')),
      '⑩ 未使用 MutationObserver（会造成无限微任务循环）')

/* ═══ B. PART A 侧边栏 ═════════════════════════════════════════════════ */
section('B. PART A —— 侧边栏重排与避让')

const css = styleTags.map((t) => t.textContent).join('')

/* order 层级：CSS 里是 '[class*="_logoRow"]{order:80 !important}' 这种形式。
   注意 class* 里的 * 必须转义，否则正则失配。 */
const orderOf = (name) => {
  const re = new RegExp('class\\*=\"_' + name + '\"\\]\\{order:(-?\\d+)')
  const m = re.exec(css)
  return m ? Number(m[1]) : NaN
}
check(orderOf('logoRow') === 80, '鲸鱼沉底 order:80')
check(orderOf('newSession') === 90, '新建会话 order:90')
check(orderOf('regionArea') === 10, '工作区区块 order:10')
check(orderOf('footArea') === 100, '设置 order:100')
/* 自动化任务在 panelList 的第二个 panelRow 上 */
check(/panelRow"\]:nth-child\(2\)\{order:92/.test(css), '自动化任务 order:92')
check(orderOf('logoRow') < orderOf('newSession'), '鲸鱼在新建会话之上')

/* 挖孔避让覆盖：特异性必须高于 App 外壳的 #root */
check(/html body #root\{padding-left:0[^}]*padding-right:0/.test(css.replace(/\s+/g, ' '))
      || /html body #root\{padding-left:0[^}]*!important/.test(css.replace(/\s+/g, ' ')),
      '水平 padding 清零（修「左右横跳」，特异性 html body #root 压过外壳）')
check(/html body #root\{padding-bottom:20px/.test(css.replace(/\s+/g, ' ')),
      '底部 padding 钉死 20px（修「图标上下跳」）')
check(/html body #root\{padding-top:max\(65px,env\(safe-area-inset-top/.test(css.replace(/\s+/g, ' ')),
      '顶部 padding 钉住（修「会话页首帧压状态栏」）')

/* 状态栏 meta */
check(String(viewportMeta.attrs.content).includes('viewport-fit'), 'viewport meta 认领 viewport-fit=cover')

/* 键盘期间不写 DOM 的冻结逻辑仍在 */
check(/isKeyboardOpen/.test(code), '键盘判定函数仍在')
check(/maxViewportH/.test(code), '键盘判定用「历史最大高度」基准')

/* ═══ C. PART B 输入法 ═════════════════════════════════════════════════ */
section('C. PART B —— 听写提交与截断修复')

check(/compositionend/.test(code), '监听 compositionend（提交拦截）')
check(/insertCompositionText/.test(code), '记录 insertCompositionText 的全文')
check(/function setComposerText/.test(code), '存在原子写入函数 setComposerText')
check(/function lexicalEditorOf/.test(code), '存在 Lexical 编辑器定位函数')
check(/execCommand\('insertText'/.test(code), '原子写入含 execCommand 回退路径')
check(/function legacyDeleteAndPaste/.test(code), '旧「删除+粘贴」降级为独立函数')

/*
 * 关键回归断言：修复前是「先 deleteBackwards 再 pasteText」，
 * 那会「删掉却贴不回来」→ 内容净丢失。现在必须先尝试原子写入。
 */
const repair = /function repairIfTruncated\(\)[\s\S]*?\n}/.exec(code)
check(repair !== null, 'repairIfTruncated 存在')
if (repair) {
  const bodyCode = repair[0]
  const iAtomic = bodyCode.indexOf('setComposerText(')
  const iLegacy = bodyCode.indexOf('legacyDeleteAndPaste')
  check(iAtomic !== -1, '截断修复首选原子写入')
  check(iLegacy === -1 || (iAtomic !== -1 && iAtomic < iLegacy),
        '原子写入在旧的删除+粘贴之前（顺序即优先级）')
}

/* 三条硬约束在 PART B 侧同样满足 */
check(/function pasteText/.test(code), '保留 pasteText（兜底路径仍可用）')
check(/function deleteBackwards/.test(code), '保留 deleteBackwards（兜底路径仍可用）')

/* ═══ 汇总 ═════════════════════════════════════════════════════════════ */
section('结果')
if (failures === 0) {
  console.log('  全部通过 ✅')
  process.exit(0)
} else {
  console.error(`  ${failures} 项失败 ❌`)
  process.exit(1)
}
