/* Plate: four ways cells are joined (§4.6), drawn as an engraving. Each
   membrane is drawn as a bilayer, a pair of lines. */
const NS = 'http://www.w3.org/2000/svg'

export function buildJunctions() {
  const svg = document.querySelector<SVGSVGElement>('[data-junctions]')
  if (!svg) return
  const el = (tag: string, a: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(NS, tag)
    for (const k in a) e.setAttribute(k, String(a[k]))
    if (text) e.textContent = text
    svg.appendChild(e)
    return e
  }
  const bilayer = (x: number, y0: number, y1: number) => {
    el('line', { x1: x - 2.5, x2: x - 2.5, y1: y0, y2: y1, class: 'm' })
    el('line', { x1: x + 2.5, x2: x + 2.5, y1: y0, y2: y1, class: 'm' })
  }
  const panel = (ox: number, oy: number, title: string, sub: string) => {
    el('text', { x: ox, y: oy + 212 }, title)
    el('text', { x: ox, y: oy + 226, class: 't2' }, sub)
  }
  const hatch = (x: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y += 6) el('line', { x1: x, x2: x + w, y1: y, y2: y + 6, class: 'f' })
  }

  /* tight junction */
  {
    const ox = 20, oy = 10, a = ox + 110, b = ox + 150
    bilayer(a, oy + 10, oy + 190)
    bilayer(b, oy + 10, oy + 190)
    for (let i = 0; i < 6; i++) {
      const y = oy + 50 + i * 20
      el('ellipse', { cx: (a + b) / 2, cy: y, rx: (b - a) / 2 + 2, ry: 4, class: 'h' })
    }
    el('text', { x: ox + 12, y: oy + 30, class: 't2' }, 'cell 1')
    el('text', { x: b + 16, y: oy + 30, class: 't2' }, 'cell 2')
    panel(ox, oy, 'Tight junction', 'Claudin strands seal the gap watertight')
  }
  /* desmosome */
  {
    const ox = 330, oy = 10, a = ox + 110, b = ox + 150
    bilayer(a, oy + 10, oy + 190)
    bilayer(b, oy + 10, oy + 190)
    el('rect', { x: a - 16, y: oy + 60, width: 10, height: 80, class: 'h' })
    el('rect', { x: b + 6, y: oy + 60, width: 10, height: 80, class: 'h' })
    for (let i = 0; i < 7; i++) el('line', { x1: a + 3, x2: b - 3, y1: oy + 66 + i * 11, y2: oy + 70 + i * 11, class: 'f' })
    for (let i = 0; i < 4; i++) {
      el('path', { d: `M${a - 16} ${oy + 72 + i * 18} C ${a - 60} ${oy + 40 + i * 30}, ${a - 90} ${oy + 120 - i * 10}, ${a - 100} ${oy + 60 + i * 25}`, class: 'f' })
      el('path', { d: `M${b + 16} ${oy + 72 + i * 18} C ${b + 60} ${oy + 40 + i * 30}, ${b + 90} ${oy + 120 - i * 10}, ${b + 100} ${oy + 60 + i * 25}`, class: 'f' })
    }
    el('text', { x: a - 100, y: oy + 180, class: 't2' }, 'intermediate filaments')
    el('text', { x: b + 22, y: oy + 56, class: 't2' }, 'cadherins')
    panel(ox, oy, 'Desmosome', 'Spot welds: cadherins anchored to intermediate filaments')
  }
  /* gap junction */
  {
    const ox = 20, oy = 270, a = ox + 116, b = ox + 144
    bilayer(a, oy + 10, oy + 190)
    bilayer(b, oy + 10, oy + 190)
    for (let i = 0; i < 4; i++) {
      const y = oy + 40 + i * 38
      el('rect', { x: a - 7, y, width: 16, height: 22, rx: 3, class: 'h' })
      el('rect', { x: b - 9, y, width: 16, height: 22, rx: 3, class: 'h' })
      el('line', { x1: a - 7, x2: b + 7, y1: y + 11, y2: y + 11, class: 'f', 'stroke-dasharray': '2 3' })
    }
    el('circle', { cx: a - 30, cy: oy + 51, r: 3, class: 'h' })
    el('path', { d: `M${a - 24} ${oy + 51} L${b + 26} ${oy + 51}`, class: 'f' })
    el('path', { d: `M${b + 20} ${oy + 47} L${b + 26} ${oy + 51} L${b + 20} ${oy + 55}`, class: 'f' })
    el('text', { x: b + 30, y: oy + 54, class: 't2' }, 'ions, small molecules')
    panel(ox, oy, 'Gap junction', 'Connexons: channels straight from cell to cell')
  }
  /* plasmodesma */
  {
    const ox = 330, oy = 270, a = ox + 100, b = ox + 160
    el('rect', { x: a, y: oy + 10, width: b - a, height: 70, fill: 'none', class: 'f' })
    el('rect', { x: a, y: oy + 120, width: b - a, height: 70, fill: 'none', class: 'f' })
    hatch(a, oy + 10, b - a, 64)
    hatch(a, oy + 120, b - a, 64)
    bilayer(a - 5, oy + 10, oy + 80)
    bilayer(a - 5, oy + 120, oy + 190)
    bilayer(b + 5, oy + 10, oy + 80)
    bilayer(b + 5, oy + 120, oy + 190)
    // the membrane-lined channel through both walls
    el('path', { d: `M${a - 7} ${oy + 80} L${b + 7} ${oy + 80} M${a - 7} ${oy + 120} L${b + 7} ${oy + 120}`, class: 'm' })
    el('path', { d: `M${a - 3} ${oy + 85} L${b + 3} ${oy + 85} M${a - 3} ${oy + 115} L${b + 3} ${oy + 115}`, class: 'm' })
    el('rect', { x: a - 20, y: oy + 96, width: b - a + 40, height: 8, rx: 4, class: 'h' })
    el('text', { x: a + 2, y: oy + 6, class: 't2' }, 'cell walls')
    el('text', { x: b + 16, y: oy + 103, class: 't2' }, 'desmotubule (ER)')
    panel(ox, oy, 'Plasmodesma', 'Plant cells: cytoplasm joined through the walls')
  }
}
