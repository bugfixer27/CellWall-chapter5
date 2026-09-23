/* "Selectively permeable" — the sentence does what it says. Each word is a
   rigid body that falls onto a drawn bilayer. Small non-polar molecules
   (marked data-pass) fall straight through it; ions and polar molecules land
   on it and pile up. Scroll on and they spring back into the sentence. The
   cursor shoves whatever it touches. */
import { scroll } from '../core/scroll'

type Body = { el: HTMLElement; pass: boolean; hx: number; hy: number; w: number; h: number; x: number; y: number; vx: number; vy: number; a: number; va: number; delay: number }

export function buildSieve() {
  const root = document.querySelector<HTMLElement>('[data-sieve]')
  const line = root?.querySelector<HTMLElement>('.sv-line')
  const mem = root?.querySelector<HTMLElement>('.sv-mem')
  if (!root || !line || !mem) return () => {}
  const bodies: Body[] = Array.from(line.querySelectorAll<HTMLElement>('span')).map((s, i) => {
    s.classList.add('sv-word')
    const pass = s.hasAttribute('data-pass')
    if (pass) s.classList.add('pass')
    return { el: s, pass, hx: 0, hy: 0, w: 0, h: 0, x: 0, y: 0, vx: 0, vy: 0, a: 0, va: 0, delay: i * 0.012 + ((i * 37) % 7) * 0.004 }
  })
  let memY = 0
  let width = 0
  let height = 0
  const measure = () => {
    for (const b of bodies) b.el.style.transform = ''
    const r = root.getBoundingClientRect()
    memY = mem.offsetTop
    width = r.width
    height = r.height
    for (const b of bodies) {
      b.hx = b.el.offsetLeft
      b.hy = b.el.offsetTop
      b.w = b.el.offsetWidth
      b.h = b.el.offsetHeight
    }
  }
  measure()
  addEventListener('resize', measure)
  document.fonts?.ready.then(measure)

  let mx = -1e4, my = -1e4, mvx = 0, mvy = 0
  addEventListener('pointermove', (e) => {
    const r = root.getBoundingClientRect()
    const nx = e.clientX - r.left
    const ny = e.clientY - r.top
    mvx = nx - mx
    mvy = ny - my
    mx = nx
    my = ny
  })

  return (dt: number) => {
    const sec = scroll.sections.find((s) => s.id === 'int2')
    if (!sec || sec.vis < 0.02) return
    const u = sec.p
    dt = Math.min(dt, 1 / 30)
    const home = u < 0.18 || u > 0.86
    mem.style.transform = `scaleX(${Math.max(0, Math.min(1, (u - 0.04) / 0.14)).toFixed(3)})`
    for (const b of bodies) {
      const active = !home && u > 0.18 + b.delay
      if (active) {
        b.vy += 2400 * dt
        const bottom = b.hy + b.y + b.h
        if (!b.pass && bottom > memY) {
          // stopped by the bilayer
          b.y = memY - b.h - b.hy
          if (b.vy > 0) b.vy *= -0.32
          b.vx *= 0.96
          b.va *= 0.8
        }
        if (b.pass && bottom > height) {
          // through the bilayer and into the cell: they settle on the floor
          b.y = height - b.h - b.hy
          if (b.vy > 0) b.vy *= -0.3
          b.vx *= 0.96
          b.va *= 0.8
        }
        b.va += (Math.random() - 0.5) * 16 * dt
      } else {
        const k = 90
        const c = 2 * Math.sqrt(k) * 0.72
        b.vx += (-b.x * k - b.vx * c) * dt
        b.vy += (-b.y * k - b.vy * c) * dt
        b.va += (-b.a * k - b.va * c) * dt
      }
      const cx = b.hx + b.x + b.w / 2
      const cy = b.hy + b.y + b.h / 2
      const dx = cx - mx, dy = cy - my
      const d2 = dx * dx + dy * dy
      if (d2 < 140 * 140) {
        const f = (1 - Math.sqrt(d2) / 140) * 2400
        const inv = 1 / Math.max(Math.sqrt(d2), 1)
        b.vx += (dx * inv * f + mvx * 18) * dt
        b.vy += (dy * inv * f + mvy * 18) * dt
        b.va += dx * inv * 4 * dt * 60
      }
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.a += b.va * dt
      const left = b.hx + b.x
      if (left < 0) ((b.x = -b.hx), (b.vx = Math.abs(b.vx) * 0.5))
      if (left + b.w > width) ((b.x = width - b.w - b.hx), (b.vx = -Math.abs(b.vx) * 0.5))
    }
    // the stopped words stack on the membrane instead of passing through each other
    if (!home) {
      for (let it = 0; it < 3; it++)
        for (let i = 0; i < bodies.length; i++)
          for (let j = i + 1; j < bodies.length; j++) {
            const A = bodies[i], B = bodies[j]
            if (A.pass !== B.pass) continue
            const ax = A.hx + A.x, ay = A.hy + A.y, bx = B.hx + B.x, by = B.hy + B.y
            const ox = Math.min(ax + A.w, bx + B.w) - Math.max(ax, bx)
            const oy = Math.min(ay + A.h * 0.8, by + B.h * 0.8) - Math.max(ay + A.h * 0.12, by + B.h * 0.12)
            if (ox <= 0 || oy <= 0) continue
            if (oy < ox) {
              const up = ay < by ? A : B
              const dn = up === A ? B : A
              up.y -= oy
              if (up.vy > 0) up.vy = dn.vy * 0.5
            } else {
              const l = ax < bx ? A : B
              const r = l === A ? B : A
              l.x -= ox * 0.5
              r.x += ox * 0.5
              const v = (l.vx + r.vx) * 0.5
              l.vx = v - 30
              r.vx = v + 30
            }
          }
    }
    for (const b of bodies) b.el.style.transform = `translate3d(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px, 0) rotate(${(b.a * 0.4).toFixed(2)}deg)`
    mvx *= 0.8
    mvy *= 0.8
  }
}
