import { readFileSync } from 'node:fs'
let captured = null
globalThis.window = { __ModuleLoader__: { load: (def) => { captured = def } } }
const code = readFileSync(process.argv[2], 'utf8')
;(0, eval)(code)
if (!captured) { console.error('FAIL: __ModuleLoader__.load() ?????'); process.exit(1) }
if (captured.id !== 'dsh-ime-submit-guard') { console.error('FAIL: id =', captured.id); process.exit(1) }
let mod
try { mod = captured.factory((n) => { throw new Error('unexpected require(' + n + ')') }) }
catch (e) { console.error('FAIL: factory ???:', e.message); process.exit(1) }
console.log('factory ok  -> name =', mod.name, '| inject =', JSON.stringify(mod.inject), '| apply =', typeof mod.apply)
const missing = ['name','inject','apply'].filter((k) => !(k in mod))
if (missing.length) { console.error('FAIL: ????', missing); process.exit(1) }
let threw = null
try { mod.apply({}, {}) } catch (e) { threw = e }
console.log('apply(non-DOM ctx) threw =', threw ? threw.message : 'no')
try { mod.apply(null, { debug: true, badge: false, enabled: true }) } catch (e) { threw = e }
console.log('apply(null ctx)    threw =', threw ? threw.message : 'no')
// ? ctx.effect ???????
try { mod.apply({ effect: undefined }, {}) } catch (e) { threw = e }
console.log('apply(no effect)   threw =', threw ? threw.message : 'no')
process.exit(threw ? 1 : 0)
