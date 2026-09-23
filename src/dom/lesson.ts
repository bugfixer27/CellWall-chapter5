/* The lesson layer: what turns the film into something you learn from.
     vocab       bold key terms light up one after another as a card is read,
                 and point the spotlight at the thing they name (labels.ts)
     takeaways   each chapter ends on three lines that assemble from nothing
     graph       the tonicity graph's axes and curves (the cells are 3-D)
     map         Table 5.2 laid over the unrolled membrane
   All of it is a function of film time, so it reverses on scroll-up. */
import * as THREE from 'three'
import { SplitText } from 'gsap/SplitText'
import { film, band, smooth, clamp01, MAP } from '../core/film'
import { AX, toWorld, plantVolume } from '../core/graph'
import { rbcVolume, RBC_LYSE, lyseMosm, ISO_MOSM } from '../science/membrane'
import type { Engine } from '../gl/engine'

/** the key term being read now, and how firmly (read by the labels) */
export const vocab = { active: '' as string, strength: 0 }

const NS = 'http://www.w3.org/2000/svg'
const svg = (tag: string, attrs: Record<string, string | number>, parent: Element) => {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) e.setAttribute(k, String(attrs[k]))
  parent.appendChild(e)
  return e
}

export function buildLesson(engine: Engine | null) {
  /* ---- vocab: terms per beat, lit in reading order ---- */
  type Term = { el: HTMLElement; key: string }
  type Card = { el: HTMLElement; n: number; a: number; b: number; terms: Term[] }
  const cards: Card[] = []
  let hover: Term | null = null
  document.querySelectorAll<HTMLElement>('section.chapter').forEach((sec) => {
    const n = parseFloat(sec.dataset.f0!)
    sec.querySelectorAll<HTMLElement>('.beat').forEach((el) => {
      const [a, b] = el.dataset.at!.split(',').map(Number)
      const terms = Array.from(el.querySelectorAll<HTMLElement>('b.k')).map((t) => ({ el: t, key: t.dataset.k || '' }))
      terms.forEach((t) => {
        t.el.addEventListener('pointerenter', () => (hover = t))
        t.el.addEventListener('pointerleave', () => hover === t && (hover = null))
      })
      if (terms.length) cards.push({ el, n, a, b, terms })
    })
  })

  /* ---- takeaways: words drift in from scattered positions ---- */
  type Take = { el: HTMLElement; n: number; a: number; b: number; words: { el: HTMLElement; dx: number; dy: number; r: number; d: number }[]; last: number }
  const takes: Take[] = []
  document.querySelectorAll<HTMLElement>('[data-take]').forEach((el, k) => {
    const sec = el.closest('section')!
    const n = parseFloat(sec.dataset.f0!)
    const [a, b] = el.dataset.take!.split(',').map(Number)
    const split = SplitText.create(el.querySelectorAll('li > span, .tk-h'), { type: 'words' })
    const words = (split.words as HTMLElement[]).map((w, i) => {
      const h = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
      const f = h - Math.floor(h)
      const g = (Math.sin(i * 4.1 + k) + 1) / 2
      return { el: w, dx: (f - 0.5) * 520, dy: (g - 0.5) * 360, r: (f - 0.5) * 50, d: (i / Math.max(1, split.words.length)) * 0.5 }
    })
    takes.push({ el, n, a, b, words, last: -1 })
  })

  /* ---- the tonicity graph ---- */
  const gs = document.querySelector<SVGSVGElement>('[data-graph]')
  const G = gs
    ? {
        ax: svg('path', { class: 'g-ax' }, gs),
        grid: svg('path', { class: 'g-grid' }, gs),
        iso: svg('path', { class: 'g-iso' }, gs),
        rbc: svg('path', { class: 'g-rbc', pathLength: 1 }, gs),
        plant: svg('path', { class: 'g-plant', pathLength: 1 }, gs),
        lyse: svg('path', { class: 'g-lyse' }, gs),
        ticks: svg('g', { class: 'g-ticks' }, gs),
      }
    : null
  const tickEls: { el: SVGElement; m?: number; v?: number; text: string; anchor: string }[] = []
  if (G) {
    for (const m of [0, 150, 300, 450, 600]) tickEls.push({ el: svg('text', { 'text-anchor': 'middle' }, G.ticks), m, text: String(m), anchor: 'x' })
    for (const v of [0.5, 1.0, 1.5]) tickEls.push({ el: svg('text', { 'text-anchor': 'end' }, G.ticks), v, text: `${Math.round(v * 100)}%`, anchor: 'y' })
    tickEls.push({ el: svg('text', { 'text-anchor': 'middle', class: 'g-t' }, G.ticks), m: 300, v: -1, text: 'Solute outside the cell (mOsm/L) →', anchor: 'xt' })
    tickEls.push({ el: svg('text', { 'text-anchor': 'start', class: 'g-t' }, G.ticks), m: -1, v: 1.8, text: 'Cell volume', anchor: 'yt' })
    tickEls.push({ el: svg('text', { 'text-anchor': 'middle', class: 'g-z' }, G.ticks), m: 90, v: 0.5, text: '← hypotonic', anchor: 'z' })
    tickEls.push({ el: svg('text', { 'text-anchor': 'middle', class: 'g-z' }, G.ticks), m: 470, v: 0.5, text: 'hypertonic →', anchor: 'z' })
    tickEls.push({ el: svg('text', { 'text-anchor': 'start', class: 'g-z' }, G.ticks), m: 306, v: 1.74, text: 'isotonic · 300', anchor: 'z' })
    tickEls.push({ el: svg('text', { 'text-anchor': 'end', class: 'g-c', fill: '#ff5d73' }, G.ticks), m: 590, v: 0.88, text: 'Red cell', anchor: 'z' })
    tickEls.push({ el: svg('text', { 'text-anchor': 'start', class: 'g-c', fill: '#8dff7a' }, G.ticks), m: 40, v: 1.13, text: 'Plant cell: the wall caps it', anchor: 'plant' })
  }
  const V3 = new THREE.Vector3()
  const scr = (m: number, v: number): [number, number] => {
    if (!engine) return [0, 0]
    const [x, y] = toWorld(m, v, engine.camA.aspect)
    const [sx, sy] = engine.project('tonic', V3.set(x, y, 0))
    return [sx, sy]
  }
  const pathOf = (fn: (m: number) => number, m0: number, m1: number) => {
    let d = ''
    for (let i = 0; i <= 60; i++) {
      const m = m0 + ((m1 - m0) * i) / 60
      const [x, y] = scr(m, fn(m))
      d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    }
    return d
  }

  /* ---- the membrane map ---- */
  const map = document.querySelector<HTMLElement>('[data-map]')
  const mapRows = map ? Array.from(map.querySelectorAll<HTMLElement>('[data-row]')) : []
  const mapCols = map ? Array.from(map.querySelectorAll<HTMLElement>('.map-col')) : []

  let lastMap = -1
  let lastGraph = -1
  return () => {
    const F = film.F

    /* vocab */
    let best: Term | null = null
    let strength = 0
    for (const c of cards) {
      const u = F - c.n
      const vis = band(c.a, c.a + 0.02, c.b - 0.02, c.b, u)
      if (vis < 0.02) {
        for (const t of c.terms) t.el.classList.remove('on', 'seen')
        continue
      }
      // read in order: the first term lights as the card arrives, the last before it leaves
      const p = clamp01((u - c.a - 0.01) / Math.max(0.02, c.b - c.a - 0.05))
      const i = Math.min(c.terms.length - 1, Math.floor(p * c.terms.length))
      c.terms.forEach((t, k) => {
        t.el.classList.toggle('on', k === i)
        t.el.classList.toggle('seen', k < i)
      })
      if (vis > strength) ((best = c.terms[i]), (strength = vis))
    }
    if (hover) ((best = hover), (strength = 1))
    vocab.active = best?.key ?? ''
    vocab.strength = strength

    /* takeaways */
    for (const t of takes) {
      const u = F - t.n
      const p = band(t.a, t.a + 0.035, 1.5, 1.6, u)
      const q = Math.round(p * 300) / 300
      if (q === t.last) continue
      t.last = q
      t.el.style.opacity = String(Math.min(1, q * 3))
      t.el.style.visibility = q < 0.003 ? 'hidden' : 'visible'
      for (const w of t.words) {
        const k = smooth(w.d, w.d + 0.5, q)
        w.el.style.transform = `translate3d(${(w.dx * (1 - k)).toFixed(1)}px, ${(w.dy * (1 - k)).toFixed(1)}px, 0) rotate(${(w.r * (1 - k)).toFixed(1)}deg)`
        w.el.style.opacity = k.toFixed(3)
      }
    }

    /* the graph */
    if (gs && G) {
      const g = film.tonicG
      const on = g > 0.01 && film.outer === 'tonic' && film.portal < 0.02
      const q = on ? Math.round(g * 400) / 400 : 0
      gs.style.opacity = on ? String(smooth(0.3, 1, g)) : '0'
      if (on) {
        const [x0, y0] = scr(AX.m0, AX.v0)
        const [x1, y1] = scr(AX.m1, AX.v1)
        G.ax.setAttribute('d', `M${x0} ${y1} L${x0} ${y0} L${x1} ${y0}`)
        let gd = ''
        for (const v of [0.5, 1.0, 1.5]) {
          const [, y] = scr(0, v)
          gd += `M${x0} ${y} L${x1} ${y}`
        }
        G.grid.setAttribute('d', gd)
        const [ix, iy0] = scr(ISO_MOSM, AX.v0)
        const [, iy1] = scr(ISO_MOSM, AX.v1)
        G.iso.setAttribute('d', `M${ix} ${iy0} L${ix} ${iy1}`)
        G.rbc.setAttribute('d', pathOf((m) => rbcVolume(m), lyseMosm, AX.m1))
        G.rbc.setAttribute('stroke-dashoffset', String(1 - smooth(0.35, 1, q)))
        G.plant.setAttribute('d', pathOf((m) => plantVolume(m), 40, AX.m1))
        G.plant.setAttribute('stroke-dashoffset', String(1 - film.plantA))
        const [lx, ly] = scr(lyseMosm, RBC_LYSE)
        G.lyse.setAttribute('d', `M${lx - 7} ${ly - 7} L${lx + 7} ${ly + 7} M${lx - 7} ${ly + 7} L${lx + 7} ${ly - 7}`)
        for (const t of tickEls) {
          let x = 0, y = 0
          if (t.anchor === 'x') ([x, y] = scr(t.m!, AX.v0)), (y += 22)
          else if (t.anchor === 'y') ([x, y] = scr(AX.m0, t.v!)), (x -= 10), (y += 4)
          else if (t.anchor === 'xt') ([x, y] = scr(t.m!, AX.v0)), (y += 46)
          else if (t.anchor === 'yt') ([x, y] = scr(AX.m0, t.v!)), (y -= 12)
          else [x, y] = scr(t.m!, t.v!)
          t.el.setAttribute('x', x.toFixed(1))
          t.el.setAttribute('y', y.toFixed(1))
          if (t.el.textContent !== t.text) t.el.textContent = t.text
          if (t.anchor === 'plant') t.el.setAttribute('opacity', String(film.plantA))
        }
      }
      if (q !== lastGraph) {
        lastGraph = q
        gs.style.visibility = q > 0 ? 'visible' : 'hidden'
      }
    }

    /* the membrane map */
    if (map && engine) {
      const k = smooth(0.85, 1, film.peel) * (film.outer === 'cell' ? 1 : 0)
      const q = Math.round(k * 200) / 200
      if (q !== lastMap) {
        lastMap = q
        map.style.opacity = String(q)
        map.style.visibility = q < 0.01 ? 'hidden' : 'visible'
      }
      if (q > 0) {
        const hw = Math.PI * 10 * MAP.s
        const hh = (Math.PI / 2) * 10 * MAP.s
        const [ax, ay] = engine.project('cell', V3.set(MAP.x - hw, MAP.y + hh, 0))
        const [bx, by] = engine.project('cell', V3.set(MAP.x + hw, MAP.y - hh, 0))
        map.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0)`
        map.style.width = `${(bx - ax).toFixed(1)}px`
        map.style.height = `${(by - ay).toFixed(1)}px`
        mapRows.forEach((r, i) => {
          const a = smooth(13.34 + i * 0.012, 13.36 + i * 0.012, F)
          r.style.opacity = a.toFixed(3)
          r.style.transform = `translate3d(0, ${((1 - a) * 12).toFixed(1)}px, 0)`
        })
        // the column the copy is talking about
        const col = F < 13.44 ? 0 : F < 13.53 ? 1 : 2
        mapCols.forEach((c, i) => c.classList.toggle('on', i === col && F > 13.36))
      }
    }
  }
}
