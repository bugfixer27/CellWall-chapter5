import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(ScrollTrigger, SplitText)

/* Typographic motion. Reveals are masked (overflow-clipped lines, chars that
   rise into place), all reversible; the one scrubbed effect is the variable
   weight of "Buoyancy takes over", which thickens as you scroll through it. */
export function buildType() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

  /* chapter titles: characters rise out of a hairline mask */
  document.querySelectorAll<HTMLElement>('[data-chars]').forEach((h) => {
    const split = SplitText.create(h, { type: 'chars,words', charsClass: 'char', mask: 'words' })
    const section = h.closest('section')!
    if (reduce) return
    gsap.set(split.chars, { yPercent: 110 })
    gsap.to(split.chars, {
      yPercent: 0,
      duration: 1.1,
      ease: 'expo.out',
      stagger: 0.028,
      scrollTrigger: { trigger: section, start: 'top 55%', end: 'bottom top', toggleActions: 'play reverse play reverse' },
    })
  })

  /* the hero line: lines wipe up on load */
  document.querySelectorAll<HTMLElement>('[data-lines]').forEach((p) => {
    const split = SplitText.create(p, { type: 'lines', mask: 'lines', linesClass: 'ln' })
    if (reduce) return
    gsap.from(split.lines, { yPercent: 105, duration: 1.4, ease: 'expo.out', stagger: 0.09, delay: 0.5 })
  })

  /* interlude headlines */
  document.querySelectorAll<HTMLElement>('[data-mega]').forEach((m) => {
    const split = SplitText.create(m, { type: 'lines,words', mask: 'lines', linesClass: 'line' })
    if (reduce) return
    gsap.from(split.words, {
      yPercent: 115,
      rotate: 4,
      duration: 1.3,
      ease: 'expo.out',
      stagger: 0.06,
      scrollTrigger: { trigger: m, start: 'top 82%', toggleActions: 'play none none reverse' },
    })
  })

  /* buoyancy: the letters gain weight as the parcel gains speed */
  document.querySelectorAll<HTMLElement>('[data-weight]').forEach((m) => {
    const split = SplitText.create(m, { type: 'chars,lines', mask: 'lines', linesClass: 'line' })
    const section = m.closest('section')!
    const state = { w: 110, t: 0 }
    const apply = () => {
      split.chars.forEach((c, i) => {
        // a wave of weight travels up through the word, like a thermal
        const local = Math.max(0, Math.min(1, state.t * 1.6 - (i / split.chars.length) * 0.6))
        const w = 110 + local * 780
        ;(c as HTMLElement).style.fontVariationSettings = `'wght' ${w.toFixed(0)}`
        ;(c as HTMLElement).style.transform = `translateY(${((1 - local) * 0.08).toFixed(3)}em)`
      })
    }
    apply()
    if (reduce) return
    ScrollTrigger.create({
      trigger: section,
      start: 'top 70%',
      end: 'bottom 40%',
      scrub: 0.6,
      onUpdate: (st) => {
        state.t = st.progress
        apply()
      },
    })
  })
}
