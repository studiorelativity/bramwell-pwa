// STAGE 01 — bootstrapping and wiring; owns the theme <style>.
import './style.css'
import './motion.css'

const app = document.getElementById('app')
if (!app) throw new Error('STAGE 01: #app missing')
app.textContent = 'Bramwell — stage 01'
