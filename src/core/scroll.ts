/* Single scroll authority. Lenis owns the wheel; GSAP's ticker drives Lenis;
   ScrollTrigger is told about every Lenis frame. Section geometry is cached
   on resize so the per-frame path never reads layout. */

import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export type SectionInfo = {
  el: HTMLElement
  id: string
  top: number
  height: number
  f0: number
  f1: number
  /** 0..1 progress of the section's own scroll range (sticky range for tall sections) */
  p: number
  /** how much of the section is on screen, 0..1 */
  vis: number
}

export const scroll = {
  y: 0,
  vel: 0, // px per frame, smoothed, signed
  velN: 0, // normalised −1..1
  F: 0,
  vh: innerHeight,
  vw: innerWidth,
  max: 1,
  sections: [] as SectionInfo[],
  lenis: null as Lenis | null,
}

let keys: [number, number][] = []

export function measure() {
  scroll.vh = innerHeight
  scroll.vw = innerWidth
  scroll.max = Math.max(1, document.documentElement.scrollHeight - innerHeight)
  const list: SectionInfo[] = []
  document.querySelectorAll<HTMLElement>('[data-f0]').forEach((el) => {
    const r = el.getBoundingClientRect()
    list.push({
      el,
      id: el.id,
      top: r.top + scrollY,
      height: r.height,
      f0: parseFloat(el.dataset.f0!),
      f1: parseFloat(el.dataset.f1 ?? el.dataset.f0!),
      p: 0,
      vis: 0,
    })
  })
  scroll.sections = list
  // film-time keypoints: each section holds [f0 → f1] across its own scroll
  // range; between sections F interpolates across the one-screen hand-off.
  keys = []
  for (const s of list) {
    const span = Math.max(1, s.height - scroll.vh)
    keys.push([s.top, s.f0], [s.top + span, s.f1])
  }
  keys.sort((a, b) => a[0] - b[0])
}

function filmAt(y: number) {
  if (!keys.length) return 0
  if (y <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (y <= keys[i][0]) {
      const [y0, f0] = keys[i - 1]
      const [y1, f1] = keys[i]
      return y1 === y0 ? f1 : f0 + ((f1 - f0) * (y - y0)) / (y1 - y0)
    }
  }
  return keys[keys.length - 1][1]
}

export function initScroll() {
  const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, touchMultiplier: 1.4, smoothWheel: true })
  scroll.lenis = lenis
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)

  measure()
  let raf = 0
  const onResize = () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      measure()
      ScrollTrigger.refresh()
    })
  }
  addEventListener('resize', onResize)
  document.fonts?.ready.then(onResize)
  return lenis
}

let lastY = 0
/** call once per frame, before anything reads scroll */
export function tickScroll() {
  const y = scroll.lenis ? scroll.lenis.scroll : scrollY
  const raw = y - lastY
  lastY = y
  scroll.y = y
  scroll.vel += (raw - scroll.vel) * 0.18
  scroll.velN = Math.max(-1, Math.min(1, scroll.vel / 60))
  scroll.F = filmAt(y + 0.0001)
  const vh = scroll.vh
  for (const s of scroll.sections) {
    const span = Math.max(1, s.height - vh)
    s.p = Math.max(0, Math.min(1, (y - s.top) / span))
    const top = s.top - y
    const bottom = top + s.height
    s.vis = Math.max(0, Math.min(vh, bottom) - Math.max(0, top)) / vh
  }
}

export const section = (id: string) => scroll.sections.find((s) => s.id === id)

/** scroll position (px) at which film time equals F */
export function yForF(F: number) {
  for (let i = 1; i < keys.length; i++) {
    const [y0, f0] = keys[i - 1]
    const [y1, f1] = keys[i]
    if (F >= Math.min(f0, f1) && F <= Math.max(f0, f1) && f1 !== f0) return y0 + ((F - f0) / (f1 - f0)) * (y1 - y0)
  }
  return 0
}

export function scrollToF(F: number) {
  // inverse of filmAt, used by the chapter index
  for (let i = 1; i < keys.length; i++) {
    const [y0, f0] = keys[i - 1]
    const [y1, f1] = keys[i]
    if (F >= Math.min(f0, f1) && F <= Math.max(f0, f1) && f1 !== f0) {
      const y = y0 + ((F - f0) / (f1 - f0)) * (y1 - y0)
      scroll.lenis?.scrollTo(y, { duration: 2.2 })
      return
    }
  }
}
