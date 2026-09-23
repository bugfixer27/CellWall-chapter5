/* The instruments: hairline panels whose readings come from the same model
   and the same molecules as the scene. */
import { film, smooth, clamp01 } from '../core/film'
import { COMPOSITION, FILAMENTS, HISTORY, ION, V_REST, carrierFlux, dGin } from '../science/membrane'
import type { Engine } from '../gl/engine'
import { SP } from '../gl/molecules'
import { SYN_W, SYN_T0 } from '../gl/proteins'

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s) as T | null
const $$ = <T extends Element = HTMLElement>(s: string) => Array.from(document.querySelectorAll<T>(s))
const NS = 'http://www.w3.org/2000/svg'
const svgEl = (tag: string, attrs: Record<string, string | number>, parent?: Element) => {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) e.setAttribute(k, String(attrs[k]))
  parent?.appendChild(e)
  return e
}
const setText = (el: Element | null, t: string) => {
  if (el && el.textContent !== t) el.textContent = t
}

export function buildInstruments(engine: Engine | null) {
  /* ---- ch2 fibres ---- */
  const fib = $('[data-fibres]')
  const fibCols = ['#ff6b2e', '#b886ff', '#c4ff4d']
  if (fib)
    FILAMENTS.forEach((f, i) => {
      const d = (f.d[0] + f.d[1]) / 2
      fib.insertAdjacentHTML(
        'beforeend',
        `<div class="fibre" style="--c:${fibCols[i]};--d:${(d / 25) * 16 + 1}px"><span class="n mono">${f.name} · ${f.prot}</span><span class="d mono">${f.d[0] === f.d[1] ? '≈ ' + f.d[0] : f.d[0] + '–' + f.d[1]} nm</span><i class="fbar"></i><span class="r mono">${f.role}</span></div>`,
      )
    })

  /* ---- ch3 composition ---- */
  const comp = $('[data-comp]')
  const compRows: HTMLElement[] = []
  if (comp)
    COMPOSITION.forEach((c) => {
      comp.insertAdjacentHTML(
        'beforeend',
        `<div class="comp-row"><span class="n mono"><span>${c.name}</span><span>${c.p} / ${c.l}${c.c ? ' / ' + c.c : ''}</span></span><div class="comp-bar"><i class="p" style="flex-grow:${c.p}"></i><i class="l" style="flex-grow:${c.l}"></i><i class="c" style="flex-grow:${Math.max(c.c, 0.001)}"></i></div></div>`,
      )
      compRows.push(comp.lastElementChild as HTMLElement)
    })

  /* ---- ch4 phospholipid anatomy (drawn like an engraving) ---- */
  const an = $<SVGSVGElement>('[data-anatomy]')
  if (an) {
    svgEl('circle', { cx: 150, cy: 38, r: 22, class: 'hd' }, an)
    svgEl('text', { x: 150, y: 41, 'text-anchor': 'middle' }, an).textContent = 'PO₄⁻'
    svgEl('rect', { x: 128, y: 66, width: 44, height: 18, rx: 3, class: 'hd' }, an)
    svgEl('text', { x: 150, y: 78, 'text-anchor': 'middle' }, an).textContent = 'Glycerol'
    svgEl('path', { d: 'M150 60 L150 66', class: 'ln' }, an)
    // saturated tail: straight zig-zag
    let d1 = 'M140 84'
    for (let i = 0; i < 12; i++) d1 += ` L${i % 2 ? 140 : 134} ${92 + i * 11}`
    svgEl('path', { d: d1, class: 'ln' }, an)
    // unsaturated: zig-zag with a cis kink
    let d2 = 'M160 84'
    for (let i = 0; i < 6; i++) d2 += ` L${i % 2 ? 160 : 166} ${92 + i * 11}`
    for (let i = 0; i < 6; i++) d2 += ` L${166 + (i + 1) * 5 + (i % 2 ? 0 : 6)} ${148 + i * 10}`
    svgEl('path', { d: d2, class: 'ln' }, an)
    svgEl('path', { d: 'M163 145 l6 3', class: 'ln', 'stroke-width': 2.4 }, an)
    const lab = (x: number, y: number, t: string, anchor = 'start', cls = '') => (svgEl('text', { x, y, 'text-anchor': anchor, class: cls }, an).textContent = t)
    lab(182, 34, 'Hydrophilic head')
    lab(182, 46, 'polar · phosphate group', 'start', 'dim')
    lab(182, 78, 'Carbons 1, 2, 3')
    lab(118, 150, 'Saturated', 'end')
    lab(118, 162, 'straight tail', 'end', 'dim')
    lab(206, 180, 'Unsaturated')
    lab(206, 192, 'cis double bond · kink', 'start', 'dim')
    lab(118, 222, 'Hydrophobic tails', 'end')
    svgEl('path', { d: 'M122 38 L108 38 M120 219 L134 205', class: 'ln' }, an)
  }
  const hist = $('[data-history]')
  const histItems: HTMLElement[] = []
  if (hist)
    HISTORY.forEach((h) => {
      hist.insertAdjacentHTML('beforeend', `<li><b>${h.y}</b><span>${h.t}</span></li>`)
      histItems.push(hist.lastElementChild as HTMLElement)
    })

  /* ---- ch5 fluidity chart ---- */
  const fc = $<SVGSVGElement>('[data-fluid-chart]')
  let tempLine: SVGElement | null = null
  const X0 = 30, X1 = 290, Y0 = 150, Y1 = 14
  const tx = (T: number) => X0 + ((T + 5) / 50) * (X1 - X0)
  if (fc) {
    svgEl('path', { d: `M${X0} ${Y1} L${X0} ${Y0} L${X1} ${Y0}`, class: 'ax' }, fc)
    const curve = (fn: (T: number) => number, color: string, dash = '') => {
      let d = ''
      for (let T = -5; T <= 45; T += 1) d += `${d ? 'L' : 'M'}${tx(T).toFixed(1)} ${(Y0 - fn(T) * (Y0 - Y1)).toFixed(1)}`
      svgEl('path', { d, class: 'ln', stroke: color, 'stroke-dasharray': dash }, fc)
    }
    const sig = (c: number, w: number) => (T: number) => 0.08 + 0.84 / (1 + Math.exp(-(T - c) / w))
    curve(sig(24, 2.2), '#ff9b4a')
    curve(sig(-2, 2.6), '#ffe066')
    curve((T) => 0.25 + 0.5 * clamp01((T + 5) / 50) + 0.1 * Math.tanh((T - 20) / 20), '#f2eaff', '4 3')
    for (const T of [0, 20, 40]) svgEl('text', { x: tx(T), y: 164, 'text-anchor': 'middle' }, fc).textContent = `${T} °C`
    svgEl('text', { x: X0 + 4, y: Y1 + 2 }, fc).textContent = 'More fluid'
    svgEl('text', { x: X0 + 4, y: Y0 - 4 }, fc).textContent = 'Gel'
    tempLine = svgEl('line', { x1: tx(37), x2: tx(37), y1: Y1, y2: Y0, stroke: '#59e1ff', 'stroke-width': 1 }, fc)
  }

  /* ---- ch7 diffusion chart: counted once from the molecules' own paths ---- */
  const dc = $<SVGSVGElement>('[data-diff-chart]')
  const samples: { o2: number; co2: number }[] = []
  let o2Path: SVGElement | null = null
  let co2Path: SVGElement | null = null
  const DX0 = 24, DX1 = 292, DY0 = 136, DY1 = 10
  if (dc && engine) {
    for (let i = 0; i <= 80; i++) {
      const tau = (i / 80) * 40
      samples.push({ o2: engine.mol.fractionUp('diff', SP.O2, tau), co2: engine.mol.fractionUp('diff', SP.CO2, tau) })
    }
    svgEl('path', { d: `M${DX0} ${DY1} L${DX0} ${DY0} L${DX1} ${DY0}`, class: 'ax' }, dc)
    svgEl('path', { d: `M${DX0} ${(DY0 + DY1) / 2} L${DX1} ${(DY0 + DY1) / 2}`, class: 'ax', 'stroke-dasharray': '2 3' }, dc)
    svgEl('text', { x: DX1, y: (DY0 + DY1) / 2 - 4, 'text-anchor': 'end' }, dc).textContent = 'Equal on both sides'
    svgEl('text', { x: DX0 + 4, y: DY1 + 8 }, dc).textContent = '100% outside'
    svgEl('text', { x: DX0 + 4, y: DY0 - 4 }, dc).textContent = '0%'
    svgEl('text', { x: DX1, y: DY0 + 12, 'text-anchor': 'end' }, dc).textContent = 'Time →'
    o2Path = svgEl('path', { d: '', class: 'ln', stroke: '#ff5d73' }, dc)
    co2Path = svgEl('path', { d: '', class: 'ln', stroke: '#dfe6f0' }, dc)
  }
  const factors = $('[data-factors]')

  /* ---- ch8 rate chart ---- */
  const fcc = $<SVGSVGElement>('[data-fac-chart]')
  let facDot: SVGElement | null = null
  if (fcc) {
    svgEl('path', { d: `M${X0} ${Y1} L${X0} ${Y0} L${X1} ${Y0}`, class: 'ax' }, fcc)
    let d = ''
    for (let i = 0; i <= 50; i++) {
      const c = i / 50
      d += `${d ? 'L' : 'M'}${(X0 + c * (X1 - X0)).toFixed(1)} ${(Y0 - carrierFlux(c, 0.82, 0.18) * (Y0 - Y1)).toFixed(1)}`
    }
    svgEl('path', { d: `M${X0} ${Y0} L${X1} ${Y1 + 10}`, class: 'ln', stroke: '#ff4fa3' }, fcc)
    svgEl('path', { d, class: 'ln', stroke: '#b77bff' }, fcc)
    svgEl('path', { d: `M${X0} ${Y0 - 0.82 * (Y0 - Y1)} L${X1} ${Y0 - 0.82 * (Y0 - Y1)}`, class: 'ax', 'stroke-dasharray': '2 3' }, fcc)
    svgEl('text', { x: X1, y: Y0 - 0.82 * (Y0 - Y1) - 5, 'text-anchor': 'end' }, fcc).textContent = 'Saturated'
    svgEl('text', { x: X0 + 78, y: Y0 - 10, 'text-anchor': 'start', fill: '#ff4fa3' }, fcc).textContent = 'Channel · simple diffusion'
    svgEl('text', { x: X1, y: Y0 - 0.66 * (Y0 - Y1), 'text-anchor': 'end', fill: '#b77bff' }, fcc).textContent = 'Carrier'
    svgEl('text', { x: X1, y: 164, 'text-anchor': 'end' }, fcc).textContent = 'Concentration gradient →'
    svgEl('text', { x: X0 + 4, y: Y1 + 2 }, fcc).textContent = 'Rate'
    facDot = svgEl('circle', { r: 4, fill: '#b77bff', cx: X0, cy: Y0 }, fcc)
  }

  /* ---- ch9 U-tube ---- */
  const ut = $<SVGSVGElement>('[data-utube]')
  const utWrap = $('[data-utube-wrap]')
  let lvlL: SVGElement | null = null
  let lvlR: SVGElement | null = null
  if (ut) {
    // the tube: two arms joined at the bottom, a membrane across the join
    svgEl('path', { d: 'M70 20 L70 160 Q70 186 96 186 L204 186 Q230 186 230 160 L230 20 M110 20 L110 146 L190 146 L190 20', fill: 'none', stroke: 'currentColor', class: 'ax', 'stroke-width': 1.4 }, ut)
    lvlL = svgEl('path', { d: '', fill: 'rgba(89,225,255,0.18)', stroke: '#59e1ff' }, ut)
    lvlR = svgEl('path', { d: '', fill: 'rgba(255,179,71,0.2)', stroke: '#ffb347' }, ut)
    svgEl('path', { d: 'M150 146 L150 186', stroke: '#edebe6', 'stroke-width': 2, 'stroke-dasharray': '3 2' }, ut)
    svgEl('text', { x: 150, y: 198, 'text-anchor': 'middle' }, ut).textContent = 'Semipermeable membrane'
    svgEl('text', { x: 90, y: 14, 'text-anchor': 'middle' }, ut).textContent = 'Water'
    svgEl('text', { x: 210, y: 14, 'text-anchor': 'middle' }, ut).textContent = 'Sugar solution'
    for (let i = 0; i < 14; i++) svgEl('circle', { cx: 196 + (i % 3) * 13 + (i % 2) * 4, cy: 60 + Math.floor(i / 3) * 24 + (i % 2) * 6, r: 3.2, fill: '#ffb347', class: 'sug' }, ut)
  }

  /* ---- ch10 ions ---- */
  const ions = $('[data-ions]')
  if (ions) {
    const row = (name: string, mM: number, max: number, c: string) =>
      `<div class="ion" style="--c:${c}"><span class="n mono"><span>${name}</span><b>${mM} mM</b></span><i class="b" style="transform:scaleX(${(mM / max).toFixed(3)})"></i></div>`
    ions.innerHTML =
      row('Na⁺ outside', ION.Na.out, 145, '#ffc64a') + row('Na⁺ inside', ION.Na.in, 145, '#ffc64a') + row('K⁺ outside', ION.K.out, 145, '#b18cff') + row('K⁺ inside', ION.K.in, 145, '#b18cff')
  }
  const steps = $$('[data-steps] li')

  /* ---- ch11 porter glyphs ---- */
  const po = $<SVGSVGElement>('[data-porters]')
  if (po) {
    const glyph = (x: number, label: string, a: [number, string][]) => {
      svgEl('rect', { x: x - 16, y: 26, width: 32, height: 40, rx: 6, fill: 'rgba(255,179,71,0.12)', stroke: '#ffb347' }, po)
      a.forEach(([dir, c], i) => {
        const ox = x - 7 + i * 14
        svgEl('path', { d: dir > 0 ? `M${ox} 18 L${ox} 74 M${ox - 4} 68 L${ox} 74 L${ox + 4} 68` : `M${ox} 74 L${ox} 18 M${ox - 4} 24 L${ox} 18 L${ox + 4} 24`, stroke: c, fill: 'none', 'stroke-width': 1.5 }, po)
      })
      svgEl('text', { x, y: 88, 'text-anchor': 'middle' }, po).textContent = label
    }
    glyph(50, 'Uniporter', [[1, '#fff0c8']])
    glyph(150, 'Symporter', [[1, '#ffc64a'], [1, '#fff0c8']])
    glyph(250, 'Antiporter', [[-1, '#ffc64a'], [1, '#b18cff']])
  }

  /* ---- readouts ---- */
  const q = (s: string) => $(s)
  const R = {
    route: $$('[data-route] li'),
    temp: q('[data-temp]'),
    parts: $$('[data-parts] > div'),
    sugar: q('[data-sugar]'),
    o2: q('[data-diff="o2"]'),
    co2: q('[data-diff="co2"]'),
    ions: q('[data-diff="ions"]'),
    facK: q('[data-fac="k"]'),
    facV: q('[data-fac="v"]'),
    t: Object.fromEntries($$('[data-t]').map((e) => [e.dataset.t!, e])),
    pna: q('[data-pump="na"]'),
    pk: q('[data-pump="k"]'),
    patp: q('[data-pump="atp"]'),
    dgna: q('[data-pump="dgna"]'),
    dgk: q('[data-pump="dgk"]'),
    vm: q('[data-pump="vm"]'),
    copump: q('[data-co="pump"]'),
    cona: q('[data-co="na"]'),
    coglu: q('[data-co="glu"]'),
    coh: q('[data-co="h"]'),
    coturns: q('[data-co="turns"]'),
    coatp: q('[data-co="atp"]'),
    bulk: $$('[data-bulk] > div'),
  }
  const lit = (els: HTMLElement[], on: (i: number, el: HTMLElement) => boolean) => els.forEach((e, i) => e.classList.toggle('on', on(i, e)))

  return (_dt: number) => {
    const F = film.F
    const ch = film.chapter
    const u = film.u

    if (ch === 1) {
      // the route lights up behind the ridden vesicle
      const t = film.heroT
      const at = u < 0.28 ? 0 : t < 0.02 ? 1 : t < 0.3 ? 2 : t < 0.5 ? 3 : t < 0.96 ? 4 : 5
      lit(R.route, (i) => i <= at)
    }
    if (ch === 4) histItems.forEach((e, i) => e.classList.toggle('on', u > 0.78 && i <= Math.floor(((u - 0.78) / 0.11) * 5)))
    if (ch === 3) compRows.forEach((e, i) => (e.style.opacity = u > 0.74 ? '1' : i === 0 ? '1' : '0.35'))
    if (ch === 5) {
      setText(R.temp, `${Math.round(film.temp)} °C`)
      tempLine?.setAttribute('x1', tx(film.temp).toFixed(1))
      tempLine?.setAttribute('x2', tx(film.temp).toFixed(1))
    }
    if (ch === 6) {
      lit(R.parts, (i) => (u < 0.3 ? i === 2 : u < 0.5 ? i === 3 : i === 4))
      R.sugar?.classList.toggle('on', u > 0.5)
    }
    if (ch === 7 && engine) {
      const st = engine.mol.stats
      setText(R.o2, `${st.up[SP.O2]} / ${st.down[SP.O2]}`)
      setText(R.co2, `${st.up[SP.CO2]} / ${st.down[SP.CO2]}`)
      setText(R.ions, '0 · the lipids stop them')
      const n = Math.max(0, Math.min(80, Math.round((film.tau / 40) * 80)))
      let a = ''
      let b = ''
      for (let i = 0; i <= n; i++) {
        const x = (DX0 + (i / 80) * (DX1 - DX0)).toFixed(1)
        a += `${i ? 'L' : 'M'}${x} ${(DY0 - samples[i].o2 * (DY0 - DY1)).toFixed(1)}`
        b += `${i ? 'L' : 'M'}${x} ${(DY0 - samples[i].co2 * (DY0 - DY1)).toFixed(1)}`
      }
      o2Path?.setAttribute('d', a)
      co2Path?.setAttribute('d', b)
      factors?.classList.toggle('on', u > 0.8)
    }
    if (ch === 8 && engine) {
      const which = u < 0.34 ? ['Water through aquaporin', SP.H2O] : u < 0.64 ? ['K⁺ out through the channel', SP.K] : ['Glucose via the carrier', SP.GLU]
      setText(R.facK, which[0] as string)
      setText(R.facV, String(engine.mol.crossed('fac', which[1] as number, film.tau)))
      const c = smooth(0.7, 0.92, u)
      if (facDot) {
        facDot.setAttribute('cx', (X0 + c * (X1 - X0)).toFixed(1))
        facDot.setAttribute('cy', (Y0 - carrierFlux(c, 0.82, 0.18) * (Y0 - Y1)).toFixed(1))
      }
    }
    if (ch === 9 && engine) {
      utWrap?.classList.toggle('on', u < 0.29)
      if (lvlL && lvlR) {
        const k = smooth(0.06, 0.26, u) * 34
        const L = 60 + k
        const Rr = 60 - k
        lvlL.setAttribute('d', `M70 ${L} L110 ${L} L110 146 L150 146 L150 186 L96 186 Q70 186 70 160 Z`)
        lvlR.setAttribute('d', `M190 ${Rr} L230 ${Rr} L230 160 Q230 186 204 186 L150 186 L150 146 L190 146 Z`)
      }
      engine.tonicState().slice(0, 3).forEach((s, i) => {
        setText(R.t['o' + i], String(Math.round(s.mosm)))
        setText(R.t['v' + i], s.lysis > 0.02 ? 'burst' : `${Math.round(s.V * 100)}%`)
        setText(R.t['w' + i], s.mosm > 301 ? 'out ↑' : s.mosm < 299 ? 'in ↓' : 'none')
        setText(R.t['s' + i], s.lysis > 0.02 ? 'Lysed' : s.V > 1.02 ? 'Swelling' : s.V < 0.98 ? 'Crenated' : 'Normal')
      })
    }
    if (ch === 10) {
      const s = film.pumpStep
      steps.forEach((e, i) => {
        e.classList.toggle('on', s > i && s <= i + 1 && s < 6)
        e.classList.toggle('done', s > i + 1 || s >= 6)
      })
      setText(R.pna, s >= 3 ? '3' : '0')
      setText(R.pk, s >= 6 ? '2' : '0')
      setText(R.patp, s >= 2 ? '1' : '0')
      // the landscape switches the membrane potential on as a teaching step; the real cell always has it
      const volt = F < 10.7 ? 1 : film.landVolt
      const vm = V_REST * volt
      const kj = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} kJ/mol`
      setText(R.dgna, kj(dGin(ION.Na.out, ION.Na.in, 1, vm)))
      setText(R.dgk, kj(dGin(ION.K.out, ION.K.in, 1, vm)))
      setText(R.vm, `${Math.round(vm) === 0 ? '0' : '−' + Math.abs(Math.round(vm))} mV`)
    }
    if (ch === 11 && engine) {
      const tau = film.tau
      const cyc = film.F < 11.21 ? 0 : engine.land.cotransported + (film.F > 11.42 ? 3 - engine.land.cotransported : 0)
      setText(R.copump, String(film.F < 11.16 ? engine.land.pumped : 2))
      setText(R.cona, String(cyc * 2))
      setText(R.coglu, String(cyc))
      setText(R.coh, String(engine.mol.crossed('co', SP.H, tau)))
      const turns = Math.max(0, tau - SYN_T0) * (SYN_W / (Math.PI * 2))
      setText(R.coturns, turns.toFixed(1))
      setText(R.coatp, String(Math.floor(turns * 3)))
    }
    if (ch === 12) lit(R.bulk, (_i, e) => Number(e.dataset.k) === (u < 0.33 ? 0 : u < 0.56 ? 1 : u < 0.81 ? 2 : 3))
    void F
  }
}
