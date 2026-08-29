// scripts/selftest.ts — node runner; not part of the bundle.
import { selfTest } from '../src/selftest.ts'

const results = selfTest()
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : ' — ' + r.detail}`)
const failed = results.filter(r => !r.pass).length
console.log(`${results.length - failed}/${results.length}`)
process.exit(failed ? 1 : 0)
