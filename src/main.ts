import './styles/main.css'
import { gsap } from 'gsap'
import { initScroll, tickScroll, measure, scroll, yForF } from './core/scroll'
import { film, updateFilm } from './core/film'
import { fillNumbers } from './science/derived'
import { buildChoreo } from './dom/choreo'
import { buildInstruments } from './dom/instruments'
import { buildType } from './dom/type'
import { buildSieve } from './dom/sieve'
import { buildCursor } from './dom/cursor'
import { buildJunctions } from './dom/junctions'

/* Surface anything that escapes the render loop: a throw inside rAF would
   otherwise just freeze the film silently. */
function trap(msg: string) {
  let el = document.getElementById('err')
  if (!el) {
    el = document.createElement('pre')
    el.id = 'err'
    el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99;max-width:60vw;font:11px/1.4 ui-monospace,monospace;color:#ff8a6a;white-space:pre-wrap;pointer-events:none'
    document.body.appendChild(el)
  }
  el.textContent = (el.textContent || '') + msg + '\n'
}
addEventListener('error', (e) => trap('ERR ' + e.message))
addEventListener('unhandledrejection', (e) => trap('REJ ' + String((e as PromiseRejectionEvent).reason)))

async function boot() {
  await document.fonts?.ready
  buildJunctions()
  buildType()
  initScroll()
  const sieve = buildSieve()
  const cursor = buildCursor()

  const canvas = document.getElementById('gl') as HTMLCanvasElement
  const gl2 = document.createElement('canvas').getContext('webgl2')
  let frame: ((dt: number) => void) | null = null
  let engine: import('./gl/engine').Engine | null = null
  let labels: (() => void) | null = null
  if (gl2) {
    const { Engine } = await import('./gl/engine')
    const { buildLabels } = await import('./dom/labels')
    engine = new Engine(canvas)
    fillNumbers(engine.bil.count)
    await engine.warmup()
    const e = engine
    frame = (dt) => e.frame(dt)
    labels = buildLabels(e)
    // dev handle: __m.go(5.5) jumps straight to a moment of the film
    ;(window as any).__m = { engine, film, go: (F: number) => scroll.lenis?.scrollTo(yForF(F), { immediate: true, force: true }), to: (y: number) => scroll.lenis?.scrollTo(y, { immediate: true, force: true }) }
    const qF = new URLSearchParams(location.search).get('f')
    if (qF) requestAnimationFrame(() => (window as any).__m.go(parseFloat(qF)))
    canvas.style.opacity = '0'
    canvas.style.transition = 'opacity 1.6s cubic-bezier(.2,.7,.1,1)'
    addEventListener('resize', () => requestAnimationFrame(() => e.plates.measure(scroll.y)))
    measure()
    e.plates.measure(scroll.y)
    requestAnimationFrame(() => requestAnimationFrame(() => (canvas.style.opacity = '1')))
  } else {
    fillNumbers()
    document.body.classList.add('no-gl')
  }
  const choreo = buildChoreo(() => (engine ? engine.scaleText() : ''))
  const instruments = buildInstruments(engine)

  let last = performance.now()
  gsap.ticker.add(() => {
    const now = performance.now()
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    tickScroll()
    if (!frame) updateFilm(scroll.F)
    frame?.(dt)
    choreo()
    instruments(dt)
    labels?.()
    sieve(dt)
    cursor(dt)
  })
}

boot()
