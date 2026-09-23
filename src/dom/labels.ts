/* In-place labels: DOM tags pinned to points in the 3-D sets, fading in and
   out with film time, like the callouts on a textbook figure. */
import * as THREE from 'three'
import { film, band, type SetName } from '../core/film'
import type { Engine } from '../gl/engine'
import { ANCHORS, GOLGI } from '../gl/cell'
import { SAMPLES, SOLO, HEAD_Y } from '../gl/bilayer'

type L = { set: SetName; r: [number, number, number, number]; at: () => THREE.Vector3; text: () => string; c?: string; el?: HTMLElement; sub?: HTMLElement; last?: number }
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

export function buildLabels(engine: Engine) {
  const root = document.querySelector<HTMLElement>('[data-labels]')
  if (!root) return () => {}
  const P = engine.prot.where
  const tonic = () => engine.tonicState()
  const fix = (v: THREE.Vector3) => () => v
  const cellR: [number, number, number, number] = [1.02, 1.08, 1.93, 1.98]
  const list: L[] = [
    /* the cell */
    { set: 'cell', r: cellR, at: fix(ANCHORS.nucleus), text: () => 'Nucleus', c: '#4a6bff' },
    { set: 'cell', r: [1.05, 1.12, 1.4, 1.46], at: fix(ANCHORS.nucleolus), text: () => 'Nucleolus', c: '#4a6bff' },
    { set: 'cell', r: [1.05, 1.12, 1.4, 1.46], at: fix(ANCHORS.pore), text: () => 'Nuclear pore', c: '#4a6bff' },
    { set: 'cell', r: cellR, at: fix(ANCHORS.rer), text: () => 'Rough ER', c: '#44ff7a' },
    { set: 'cell', r: [1.05, 1.12, 1.9, 1.96], at: fix(ANCHORS.ser), text: () => 'Smooth ER', c: '#80f2c0' },
    { set: 'cell', r: cellR, at: fix(ANCHORS.golgi), text: () => 'Golgi apparatus', c: '#ffa82e' },
    { set: 'cell', r: [1.36, 1.42, 1.9, 1.96], at: fix(ANCHORS.cis), text: () => 'cis face', c: '#ffa82e' },
    { set: 'cell', r: [1.36, 1.42, 1.9, 1.96], at: fix(ANCHORS.trans), text: () => 'trans face → vesicles', c: '#ffa82e' },
    { set: 'cell', r: cellR, at: fix(ANCHORS.mito), text: () => 'Mitochondrion', c: '#ff3d85' },
    { set: 'cell', r: cellR, at: fix(ANCHORS.lyso), text: () => 'Lysosome', c: '#ff4d33' },
    { set: 'cell', r: [1.05, 1.12, 2.86, 2.9], at: fix(ANCHORS.pm), text: () => 'Plasma membrane', c: '#8cf2ff' },
    { set: 'cell', r: [2.04, 2.1, 2.46, 2.5], at: fix(ANCHORS.centrosome), text: () => 'Centrosome', c: '#c4ff4d' },
    { set: 'cell', r: [2.04, 2.1, 2.46, 2.5], at: fix(ANCHORS.mt), text: () => 'Microtubule · 25 nm', c: '#c4ff4d' },
    { set: 'cell', r: [2.04, 2.1, 2.46, 2.5], at: fix(ANCHORS.actin), text: () => 'Actin cortex · 7 nm', c: '#ff6b2e' },
    { set: 'cell', r: [2.04, 2.1, 2.46, 2.5], at: fix(ANCHORS.ifil), text: () => 'Intermediate filament · 8–10 nm', c: '#b886ff' },
    { set: 'cell', r: [13.46, 13.52, 13.72, 13.78], at: fix(ANCHORS.pm), text: () => 'Plasma membrane · 5–10 nm', c: '#8cf2ff' },

    /* the fluid mosaic */
    { set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: fix(SAMPLES.head), text: () => 'Phospholipid', c: '#59e1ff' },
    { set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: fix(SAMPLES.chol), text: () => 'Cholesterol', c: '#f2eaff' },
    { set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: fix(SAMPLES.gly), text: () => 'Glycolipid', c: '#8dff7a' },
    { set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: () => P('channel').clone().add(V(0, 3.8, 0)), text: () => 'Channel protein', c: '#ff4fa3' },
    { set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: () => P('pump').clone().add(V(0, 4.2, 0)), text: () => 'Integral protein', c: '#e05cff' },
    { set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: () => engine.prot.glyco[3].group.position.clone().add(V(0.4, 7.6, 0)), text: () => 'Glycoprotein · carbohydrate', c: '#8dff7a' },
    { set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: () => engine.prot.peri[3].position.clone().add(V(0, 1.6, 0)), text: () => 'Peripheral protein', c: '#ffe36e' },

    /* one phospholipid */
    { set: 'mem', r: [4.06, 4.11, 4.26, 4.3], at: () => V(SOLO.x, HEAD_Y + 0.5, SOLO.y), text: () => 'Phosphate head · hydrophilic', c: '#59e1ff' },
    { set: 'mem', r: [4.07, 4.12, 4.26, 4.3], at: () => V(SOLO.x, HEAD_Y - 0.45, SOLO.y), text: () => 'Glycerol', c: '#59e1ff' },
    { set: 'mem', r: [4.08, 4.13, 4.26, 4.3], at: () => V(SOLO.x - 0.2, 0.9, SOLO.y), text: () => 'Saturated tail', c: '#ff9b4a' },
    { set: 'mem', r: [4.09, 4.14, 4.26, 4.3], at: () => V(SOLO.x + 0.6, 0.5, SOLO.y), text: () => 'Unsaturated tail · cis kink', c: '#ffe066' },
    { set: 'mem', r: [4.6, 4.64, 4.76, 4.8], at: () => V(-13, 13.2, -2), text: () => 'Liposome', c: '#59e1ff' },
    { set: 'mem', r: [4.6, 4.64, 4.76, 4.8], at: () => V(8.4, 11.6, -4), text: () => 'Micelles', c: '#59e1ff' },
    { set: 'mem', r: [4.6, 4.64, 4.76, 4.8], at: () => V(12, -12.5, -8), text: () => 'Bilayer sheet', c: '#59e1ff' },

    /* cross-section */
    { set: 'mem', r: [5.08, 5.14, 5.9, 5.96], at: () => V(-9, HEAD_Y + 0.4, 20.3), text: () => 'Heads · hydrophilic', c: '#59e1ff' },
    { set: 'mem', r: [5.08, 5.14, 5.9, 5.96], at: () => V(-7, 0.2, 20.3), text: () => 'Tails · hydrophobic core', c: '#ffb347' },
    { set: 'mem', r: [5.08, 5.14, 5.9, 5.96], at: () => V(-5, -HEAD_Y - 0.4, 20.3), text: () => 'Cytoplasmic leaflet', c: '#6a8dff' },

    /* proteins */
    { set: 'mem', r: [6.04, 6.1, 6.26, 6.3], at: () => engine.prot.peri[0].position.clone().add(V(0, -1.8, 0)), text: () => 'Peripheral protein', c: '#ffe36e' },
    { set: 'mem', r: [6.04, 6.1, 6.26, 6.3], at: () => engine.prot.peri[4].position.clone().add(V(0, -1.8, 0)), text: () => 'Peripheral protein', c: '#ffe36e' },
    { set: 'mem', r: [6.3, 6.35, 6.46, 6.5], at: () => P('channel').clone().add(V(0, 3.8, 0)), text: () => 'Multi-pass · channel', c: '#ff4fa3' },
    { set: 'mem', r: [6.3, 6.35, 6.46, 6.5], at: () => P('carrier').clone().add(V(0, 3.8, 0)), text: () => '12 helices · carrier', c: '#b77bff' },
    { set: 'mem', r: [6.5, 6.55, 6.62, 6.66], at: () => engine.prot.glyco[3].group.position.clone().add(V(0.4, 8, 0)), text: () => 'Sugar chain', c: '#8dff7a' },
    { set: 'mem', r: [6.5, 6.55, 6.62, 6.66], at: () => engine.prot.glyco[3].group.position.clone().add(V(0.2, 0, 0)), text: () => 'Single pass · 20–25 aa helix', c: '#ff6f91' },
    { set: 'mem', r: [6.7, 6.76, 6.9, 6.95], at: () => V(2, 13, 3), text: () => 'CD4 receptor', c: '#ff8a3d' },
    { set: 'mem', r: [6.76, 6.82, 6.9, 6.95], at: () => V(-8, 22, 3), text: () => 'HIV envelope · gp120 spikes', c: '#4de1c1' },

    /* transport stages */
    { set: 'mem', r: [8.03, 8.08, 8.95, 8.99], at: () => P('aquaporin').clone().add(V(-1.4, 5.2, 1.45)), text: () => 'Aquaporin', c: '#3fb6ff' },
    { set: 'mem', r: [8.28, 8.33, 8.95, 8.99], at: () => P('channel').clone().add(V(0, 5.2, 0)), text: () => (film.gate > 0.5 ? 'K⁺ channel · open' : 'K⁺ channel · closed'), c: '#ff4fa3' },
    { set: 'mem', r: [8.64, 8.69, 8.95, 8.99], at: () => P('carrier').clone().add(V(0, 5.2, 0)), text: () => 'Carrier · GLUT', c: '#b77bff' },
    { set: 'mem', r: [10.28, 10.32, 10.95, 10.99], at: () => P('pump').clone().add(V(0, 5.6, 0.5)), text: () => 'Na⁺/K⁺-ATPase', c: '#e05cff' },
    { set: 'mem', r: [11.08, 11.14, 11.48, 11.52], at: () => P('symporter').clone().add(V(0, 5.2, 0)), text: () => 'Na⁺–glucose symporter', c: '#ffb347' },
    { set: 'mem', r: [11.56, 11.6, 11.97, 12.0], at: () => P('synthase').clone().add(V(0, -14.8, 2)), text: () => 'ATP synthase · F₁ head', c: '#ffd36b' },
    { set: 'mem', r: [11.56, 11.6, 11.97, 12.0], at: () => P('synthase').clone().add(V(-2.4, 3.2, 2)), text: () => 'Rotor ring', c: '#ff7b54' },
    { set: 'mem', r: [11.56, 11.6, 11.97, 12.0], at: () => P('synthase').clone().add(V(-9, 7, 2)), text: () => 'Intermembrane space · high H⁺', c: '#ff4b7d' },
    { set: 'mem', r: [11.56, 11.6, 11.97, 12.0], at: () => P('synthase').clone().add(V(-9, -8, 2)), text: () => 'Matrix · low H⁺', c: '#ff4b7d' },

    /* tonicity */
    ...[0, 1, 2].map(
      (i): L => ({
        set: 'tonic',
        r: [9.4, 9.44, 9.97, 10.0],
        at: () => V([-9, 0, 9][i], -4.9, 0),
        text: () => {
          if (film.tonicMode > 0.5) return ['Hypertonic · plasmolysed', 'Isotonic · flaccid', 'Hypotonic · turgid'][i]
          const s = tonic()[i]
          return `${['Hypertonic', 'Isotonic', 'Hypotonic'][i]} · ${Math.round(s.mosm)} mOsm/L`
        },
        c: ['#ffb347', '#59e1ff', '#ff5d73'][i],
      }),
    ),

    /* bulk */
    { set: 'bulk', r: [12.06, 12.1, 12.3, 12.34], at: () => V(-2, 7.5 - 11 * Math.max(0, (film.phago - 0.55) / 0.45), 1), text: () => 'Bacterium', c: '#44ff7a' },
    { set: 'bulk', r: [12.1, 12.14, 12.22, 12.26], at: () => V(4.5, 3.5, 0), text: () => 'Pseudopod', c: '#59e1ff' },
    { set: 'bulk', r: [12.25, 12.28, 12.32, 12.35], at: () => V(6.5, -8.5, 1), text: () => 'Lysosome', c: '#ff4d33' },
    { set: 'bulk', r: [12.42, 12.46, 12.55, 12.58], at: () => V(20.6, -1.5, 0), text: () => 'Pinocytic vesicle', c: '#59e1ff' },
    { set: 'bulk', r: [12.48, 12.5, 12.55, 12.58], at: () => V(23.4, -0.8, 0.2), text: () => 'Caveola · caveolin', c: '#d19bff' },
    { set: 'bulk', r: [12.64, 12.68, 12.78, 12.81], at: () => V(34.8, -1.2, 0), text: () => 'Clathrin coat', c: '#ffd88a' },
    { set: 'bulk', r: [12.62, 12.66, 12.78, 12.81], at: () => V(33.4, 0.5, 0), text: () => 'LDL · receptors', c: '#ffb347' },
    { set: 'bulk', r: [12.84, 12.87, 12.93, 12.96], at: () => V(46.4, -1.2, 0), text: () => 'Secretory vesicle', c: '#ffe066' },
  ]
  for (const l of list) {
    const el = document.createElement('div')
    el.className = 'lab'
    if (l.c) el.style.setProperty('--c', l.c)
    el.innerHTML = '<i></i><span></span>'
    root.appendChild(el)
    l.el = el
    l.sub = el.querySelector('span')!
    l.last = -1
  }
  void GOLGI
  return () => {
    const F = film.F
    for (const l of list) {
      let a = band(l.r[0], l.r[1], l.r[2], l.r[3], F)
      if (a < 0.005 || film.paper > 0.5 && l.set === 'cell') {
        if (l.last !== 0) ((l.el!.style.opacity = '0'), (l.last = 0))
        continue
      }
      const [x, y, ok] = engine.project(l.set, l.at())
      if (!ok || x < -50 || y < -50 || x > innerWidth + 50 || y > innerHeight + 50) a = 0
      l.el!.style.opacity = a.toFixed(3)
      l.last = a
      l.el!.style.transform = `translate3d(${(x - 2.5).toFixed(1)}px, ${(y - 2.5).toFixed(1)}px, 0)`
      const t = l.text()
      if (l.sub!.textContent !== t) l.sub!.textContent = t
    }
  }
}
