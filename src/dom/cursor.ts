/* A quiet cursor: a ring that trails the pointer and stretches with its
   speed, a dot that doesn't. It opens wide over the plates. */
export function buildCursor() {
  const c = document.querySelector<HTMLElement>('.cursor')
  if (!c || matchMedia('(hover: none), (pointer: coarse)').matches) return () => {}
  const ring = c.querySelector<HTMLElement>('.cursor-ring')!
  const dot = c.querySelector<HTMLElement>('.cursor-dot')!
  let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y
  addEventListener('pointermove', (e) => {
    x = e.clientX
    y = e.clientY
    const t = e.target as HTMLElement
    c.classList.toggle('big', !!t.closest?.('[data-plate], .replay, .rail'))
  })
  return (dt: number) => {
    const k = 1 - Math.exp(-dt * 14)
    const px = rx, py = ry
    rx += (x - rx) * k
    ry += (y - ry) * k
    const vx = rx - px, vy = ry - py
    const sp = Math.min(Math.hypot(vx, vy) / 30, 0.6)
    const ang = Math.atan2(vy, vx)
    ring.style.transform = `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0) rotate(${ang.toFixed(3)}rad) scale(${(1 + sp).toFixed(3)}, ${(1 - sp * 0.5).toFixed(3)})`
    dot.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }
}
