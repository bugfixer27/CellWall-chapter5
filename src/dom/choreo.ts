/* The DOM half of the film: which copy block is on screen, which instrument
   is lit, the chrome, the paper swap. Everything is a function of film time,
   so it reverses exactly on scroll-up. */
import { film, band, smooth, CHAPTERS } from '../core/film'
import { scroll, scrollToF } from '../core/scroll'

type Beat = { el: HTMLElement; a: number; b: number; last: number }
type Chapter = { n: number; beats: Beat[]; inst: HTMLElement | null; lastInst: number }

export function buildChoreo(scaleText: () => string) {
  const chapters: Chapter[] = []
  document.querySelectorAll<HTMLElement>('section.chapter').forEach((sec) => {
    const n = parseFloat(sec.dataset.f0!)
    const beats: Beat[] = []
    sec.querySelectorAll<HTMLElement>('.beat').forEach((el) => {
      const [a, b] = el.dataset.at!.split(',').map(Number)
      beats.push({ el, a, b, last: -1 })
    })
    chapters.push({ n, beats, inst: sec.querySelector('.inst'), lastInst: -1 })
  })

  const scaleEl = document.querySelector('[data-scale-bar]')
  const chnum = document.querySelector('[data-chnum]')
  const chname = document.querySelector('[data-chname]')
  const fill = document.querySelector<HTMLElement>('.rail-fill')
  const hero = document.querySelector<HTMLElement>('#hero .sticky')
  const megas = Array.from(document.querySelectorAll<HTMLElement>('.mega, .sv-line'))
  const junctions = document.querySelector<SVGElement>('[data-junctions]')
  const summary = document.querySelector<HTMLElement>('[data-summary]')
  const root = document.documentElement

  const rail = document.querySelector('.rail-line')!
  const ticks = CHAPTERS.map((name, i) => {
    const b = document.createElement('button')
    b.className = 'rail-tick'
    b.dataset.label = `${String(i).padStart(2, '0')} ${name}`
    b.setAttribute('aria-label', `Go to ${name}`)
    b.addEventListener('click', () => (i === 0 ? scroll.lenis?.scrollTo(0, { duration: 2.2 }) : scrollToF(i + 0.001)))
    rail.appendChild(b)
    return b
  })
  const placeTicks = () => {
    for (let i = 0; i < ticks.length; i++) {
      const s = scroll.sections.find((q) => q.f0 === i && q.el.classList.contains(i === 0 ? 'hero' : 'chapter'))
      if (s) ticks[i].style.top = `${((s.top / scroll.max) * 100).toFixed(2)}%`
    }
  }
  placeTicks()
  addEventListener('resize', () => requestAnimationFrame(placeTicks))
  document.fonts?.ready.then(placeTicks)
  document.querySelectorAll<HTMLElement>('[data-to]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      scroll.lenis?.scrollTo(0, { duration: 3 })
    }),
  )

  let lastPaper = -1
  let lastCh = -1
  let skew = 0
  let lastScale = ''
  let frame = 0
  return () => {
    const F = film.F
    frame++
    for (const c of chapters) {
      const u = F - c.n
      if (u < -0.3 || u > 1.3) {
        for (const b of c.beats) if (b.last !== 0) ((b.last = 0), (b.el.style.opacity = '0'), (b.el.style.visibility = 'hidden'))
        if (c.inst && c.lastInst !== 0) ((c.lastInst = 0), (c.inst.style.opacity = '0'), (c.inst.style.visibility = 'hidden'))
        continue
      }
      for (const b of c.beats) {
        const a0 = b.a <= 0.001 ? -0.2 : b.a
        const b1 = b.b >= 0.999 ? 1.2 : b.b
        const al = band(a0, a0 + 0.03, b1 - 0.03, b1, u)
        const q = Math.round(al * 200) / 200
        if (q === b.last) continue
        b.last = q
        const dir = u < (b.a + b.b) / 2 ? 1 : -1
        b.el.style.opacity = String(q)
        b.el.style.visibility = q < 0.005 ? 'hidden' : 'visible'
        b.el.style.transform = `translate3d(0, ${((1 - q) * 22 * dir).toFixed(1)}px, 0)`
      }
      if (c.inst) {
        let al = band(-0.12, 0.04, 0.96, 1.08, u)
        // the tonicity chapter hands the screen to its cells while they are close up
        if (c.n === 9) al *= 1 - 0.85 * band(0.42, 0.45, 0.61, 0.64, u)
        const q = Math.round(al * 200) / 200
        if (q !== c.lastInst) {
          c.lastInst = q
          c.inst.style.opacity = String(q)
          c.inst.style.visibility = q < 0.005 ? 'hidden' : 'visible'
          c.inst.style.setProperty('--ix', `${((1 - q) * 24).toFixed(1)}px`)
        }
      }
    }

    /* chrome */
    if (frame % 6 === 0 && scaleEl) {
      const t = scaleText()
      if (t !== lastScale) scaleEl.textContent = lastScale = t
    }
    if (film.chapter !== lastCh) {
      lastCh = film.chapter
      if (chnum) chnum.textContent = String(film.chapter).padStart(2, '0')
      if (chname) chname.textContent = CHAPTERS[film.chapter]
      ticks.forEach((t, i) => t.classList.toggle('on', i === film.chapter))
    }
    if (fill) fill.style.transform = `scaleY(${(scroll.y / scroll.max).toFixed(4)})`
    if (hero) hero.style.opacity = (1 - smooth(0.28, 0.5, F)).toFixed(3)

    /* paper plates turn the page itself to paper */
    const p = Math.round(film.paper * 100) / 100
    if (p !== lastPaper) {
      lastPaper = p
      root.style.setProperty('--paper', String(p))
      document.body.style.background = p > 0 ? `color-mix(in oklab, #ece7dc ${p * 100}%, #07080a)` : ''
    }
    if (junctions) junctions.style.opacity = band(2.5, 2.58, 2.84, 2.9, F).toFixed(3)
    if (summary) {
      const a = band(13.06, 13.12, 13.42, 13.5, F)
      summary.style.opacity = a.toFixed(3)
      summary.style.visibility = a < 0.01 ? 'hidden' : 'visible'
    }

    skew += (Math.max(-1, Math.min(1, scroll.velN)) * -3 - skew) * 0.12
    const s = skew.toFixed(2)
    for (const m of megas) m.style.transform = `skewY(${s}deg)`
  }
}
