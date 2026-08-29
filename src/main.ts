// STAGE 01 — bootstrapping and wiring; owns the theme <style>.
import './style.css'
import './motion.css'

const app = document.getElementById('app')
if (!app) throw new Error('STAGE 01: #app missing')

if (new URLSearchParams(location.search).has('selftest')) {
  const { selfTest } = await import('./selftest.ts')
  const results = await selfTest()
  const passed = results.filter(r => r.pass).length
  const pre = document.createElement('pre')
  pre.textContent =
    results.map(r => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : ' — ' + r.detail}`).join('\n') +
    `\n\n${passed}/${results.length}`
  pre.dataset['selftest'] = passed === results.length ? 'pass' : 'fail'
  app.replaceChildren(pre)
} else {
  app.textContent = 'Bramwell — stage 01'
}
