/* In-place labels: DOM tags pinned to points in the 3-D sets, fading in and
   out with film time, like the callouts on a textbook figure. Numbered ones
   are a sequence (the route of a membrane protein, the tour of the cell).

   The labels also aim the spotlight. At each moment of the film one subject
   is the thing being taught (SPOTS below); when the reader's eye is on a
   bold key term in the copy, that term's label wins instead. Everything
   else on screen dims and softens (engine.spot → the final pass). */
import * as THREE from 'three'
import { film, band, smooth, DIAG, type SetName } from '../core/film'
import type { Engine } from '../gl/engine'
import { ANCHORS, heroAt } from '../gl/cell'
import { SAMPLES, SOLO, HEAD_Y } from '../gl/bilayer'
import { landHeights } from '../gl/land'
import { vocab } from './lesson'
import { plantMarks } from '../core/graph'

type L = {
  id?: string
  n?: number
  set: SetName
  r: [number, number, number, number]
  at: () => THREE.Vector3
  text: () => string
  c?: string
  /** text to the left of the dot, for things near the right edge */
  left?: boolean
  /** shown on paper plates too */
  paper?: boolean
  el?: HTMLElement
  sub?: HTMLElement
  last?: number
  x?: number
  y?: number
  vis?: number
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const D = (x: number, y: number) => V(DIAG.x + x, DIAG.y + y, 0)
const kj = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} kJ/mol`

/* what is being taught, moment by moment: [F band], label id, radius in px */
const SPOTS: { r: [number, number, number, number]; id: string; rad: number }[] = [
  { r: [1.3, 1.33, 1.58, 1.61], id: 'ves', rad: 230 },
  { r: [4.06, 4.1, 4.26, 4.3], id: 'glycerol', rad: 300 },
  { r: [6.7, 6.76, 6.9, 6.95], id: 'cd4', rad: 320 },
  { r: [8.04, 8.08, 8.32, 8.36], id: 'aqp', rad: 260 },
  { r: [8.36, 8.4, 8.62, 8.66], id: 'kchan', rad: 260 },
  { r: [8.68, 8.72, 8.95, 8.99], id: 'glut', rad: 260 },
  { r: [9.44, 9.46, 9.5, 9.52], id: 'rbc0', rad: 330 },
  { r: [9.545, 9.56, 9.61, 9.63], id: 'rbc2', rad: 330 },
  { r: [9.75, 9.76, 9.79, 9.8], id: 'rider', rad: 190 },
  { r: [10.2, 10.23, 10.6, 10.63], id: 'pump', rad: 330 },
  { r: [11.02, 11.04, 11.15, 11.17], id: 'gate', rad: 300 },
  { r: [11.22, 11.24, 11.4, 11.42], id: 'gate', rad: 320 },
  { r: [11.62, 11.66, 11.95, 11.99], id: 'rotor', rad: 320 },
  { r: [12.07, 12.1, 12.3, 12.34], id: 'bact', rad: 340 },
  { r: [12.43, 12.46, 12.55, 12.58], id: 'pino', rad: 260 },
  { r: [12.65, 12.68, 12.78, 12.81], id: 'clathrin', rad: 280 },
  { r: [12.85, 12.87, 12.93, 12.96], id: 'secves', rad: 260 },
]

export function buildLabels(engine: Engine) {
  const root = document.querySelector<HTMLElement>('[data-labels]')
  if (!root) return () => {}
  const P = engine.prot.where
  const land = engine.land
  const marks = () => engine.tonicState()
  const fix = (v: THREE.Vector3) => () => v
  const hv = new THREE.Vector3()
  const list: L[] = [
    /* the cell: a numbered tour */
    { id: 'nucleus', n: 1, set: 'cell', r: [1.02, 1.07, 1.26, 1.3], at: fix(ANCHORS.nucleus), text: () => 'Nucleus', c: '#4a6bff' },
    { id: 'rer', n: 2, set: 'cell', r: [1.04, 1.09, 1.26, 1.3], at: fix(ANCHORS.rer), text: () => 'Rough ER', c: '#44ff7a' },
    { id: 'golgi', n: 3, set: 'cell', r: [1.06, 1.11, 1.26, 1.3], at: fix(ANCHORS.golgi), text: () => 'Golgi apparatus', c: '#ffa82e' },
    { id: 'mito', n: 4, set: 'cell', r: [1.08, 1.13, 1.26, 1.3], at: fix(ANCHORS.mito), text: () => 'Mitochondrion', c: '#ff3d85' },
    { id: 'lyso', n: 5, set: 'cell', r: [1.1, 1.15, 1.26, 1.3], at: fix(ANCHORS.lyso), text: () => 'Lysosome', c: '#ff4d33' },
    { id: 'pm', n: 6, set: 'cell', r: [1.12, 1.17, 1.26, 1.3], at: fix(ANCHORS.pm), text: () => 'Plasma membrane', c: '#8cf2ff' },
    { id: 'ser', set: 'cell', r: [1.12, 1.17, 1.26, 1.3], at: fix(ANCHORS.ser), text: () => 'Smooth ER', c: '#80f2c0' },
    { set: 'cell', r: [1.12, 1.17, 1.26, 1.3], at: fix(ANCHORS.pore), text: () => 'Nuclear pore', c: '#4a6bff' },

    /* the ride */
    {
      id: 'ves',
      set: 'cell',
      r: [1.3, 1.32, 1.585, 1.6],
      at: () => heroAt(film.heroT, hv).clone().add(V(0, 0.32, 0)),
      text: () => (film.heroT < 0.3 ? 'Transport vesicle · leaving the rough ER' : film.heroT < 0.5 ? 'Inside the Golgi · sugars trimmed and added' : 'Secretory vesicle · to the surface'),
      c: '#fff0a0',
    },
    { set: 'cell', r: [1.34, 1.37, 1.44, 1.47], at: fix(ANCHORS.cis), text: () => 'cis face', c: '#ffa82e', left: true },
    { set: 'cell', r: [1.42, 1.45, 1.5, 1.53], at: fix(ANCHORS.trans), text: () => 'trans face', c: '#ffa82e' },
    { set: 'cell', r: [1.54, 1.56, 1.62, 1.66], at: () => ANCHORS.ves0.clone().multiplyScalar(1.02), text: () => 'Plasma membrane · fusion', c: '#8cf2ff' },

    /* the flow map (paper) */
    { id: 'd-nuc', n: 1, paper: true, set: 'cell', r: [1.745, 1.76, 1.9, 1.92], at: () => D(-5.6, 2.9), text: () => 'Nucleus · DNA → mRNA', c: '#4a6bff' },
    { id: 'd-rer', n: 2, paper: true, set: 'cell', r: [1.75, 1.765, 1.9, 1.92], at: () => D(-2.24, 3.56), text: () => 'Rough ER · protein made, sugar added inside', c: '#44ff7a' },
    { id: 'd-tv', n: 3, paper: true, set: 'cell', r: [1.755, 1.77, 1.9, 1.92], at: () => D(0.45, 1.25), text: () => 'Transport vesicle', c: '#fff0a0' },
    { id: 'd-golgi', n: 4, paper: true, set: 'cell', r: [1.76, 1.775, 1.9, 1.92], at: () => D(3.0, 2.35), text: () => 'Golgi · cis → trans', c: '#ffa82e' },
    { id: 'd-sv', n: 5, paper: true, set: 'cell', r: [1.765, 1.78, 1.9, 1.92], at: () => D(6.9, 1.5), text: () => 'Secretory vesicle', c: '#fff0a0' },
    { id: 'd-pm', n: 6, paper: true, set: 'cell', r: [1.77, 1.785, 1.9, 1.92], at: () => D(9.5, -1.6), text: () => 'Plasma membrane · sugars face out', c: '#8cf2ff', left: true },
    { id: 'd-lyso', paper: true, set: 'cell', r: [1.775, 1.79, 1.9, 1.92], at: () => D(5.7, -5.1), text: () => 'Lysosome', c: '#ff4d33' },
    { id: 'd-ser', paper: true, set: 'cell', r: [1.775, 1.79, 1.9, 1.92], at: () => D(-1.3, -4.4), text: () => 'Smooth ER · lipids', c: '#80f2c0', left: true },

    /* the cytoskeleton */
    { set: 'cell', r: [2.04, 2.1, 2.46, 2.5], at: fix(ANCHORS.centrosome), text: () => 'Centrosome', c: '#c4ff4d' },
    { id: 'mt', set: 'cell', r: [2.04, 2.1, 2.46, 2.5], at: fix(ANCHORS.mt), text: () => 'Microtubule · 25 nm', c: '#c4ff4d' },
    { id: 'actin', set: 'cell', r: [2.04, 2.1, 2.46, 2.5], at: fix(ANCHORS.actin), text: () => 'Actin cortex · 7 nm', c: '#ff6b2e' },
    { id: 'if', set: 'cell', r: [2.04, 2.1, 2.46, 2.5], at: fix(ANCHORS.ifil), text: () => 'Intermediate filament · 8–10 nm', c: '#b886ff' },

    /* the whole cell at work, then home */
    { id: 'phago', set: 'cell', r: [13.07, 13.1, 13.18, 13.21], at: () => new THREE.Vector3(0.45, 0.72, 0.52).normalize().multiplyScalar(12.4), text: () => 'Phagocytosis', c: '#44ff7a' },
    { set: 'cell', r: [13.08, 13.11, 13.18, 13.21], at: () => new THREE.Vector3(0.2, -0.9, 0.4).normalize().multiplyScalar(9.6), text: () => 'Pinocytosis', c: '#8cf2ff' },
    { set: 'cell', r: [13.09, 13.12, 13.18, 13.21], at: () => ANCHORS.ves0.clone(), text: () => 'Exocytosis', c: '#fff0a0' },
    { set: 'cell', r: [13.78, 13.82, 13.92, 13.96], at: fix(ANCHORS.pm), text: () => 'Plasma membrane · 5–10 nm', c: '#8cf2ff' },

    /* the fluid mosaic */
    { id: 'phospholipid', set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: fix(SAMPLES.head), text: () => 'Phospholipid', c: '#59e1ff' },
    { id: 'cholesterol', set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: fix(SAMPLES.chol), text: () => 'Cholesterol', c: '#f2eaff' },
    { id: 'glycolipid', set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: fix(SAMPLES.gly), text: () => 'Glycolipid', c: '#8dff7a' },
    { id: 'channel', set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: () => P('channel').clone().add(V(0, 3.8, 0)), text: () => 'Channel protein', c: '#ff4fa3' },
    { id: 'integral', set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: () => P('pump').clone().add(V(0, 4.2, 0)), text: () => 'Integral protein', c: '#e05cff' },
    { id: 'glycoprotein', set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: () => engine.prot.glyco[3].group.position.clone().add(V(0.4, 7.6, 0)), text: () => 'Glycoprotein · carbohydrate', c: '#8dff7a' },
    { id: 'peripheral', set: 'mem', r: [3.08, 3.14, 3.95, 3.99], at: () => engine.prot.peri[3].position.clone().add(V(0, 1.6, 0)), text: () => 'Peripheral protein', c: '#ffe36e' },

    /* one phospholipid */
    { id: 'head', set: 'mem', r: [4.06, 4.11, 4.26, 4.3], at: () => V(SOLO.x, HEAD_Y + 0.5, SOLO.y), text: () => 'Phosphate head · hydrophilic', c: '#59e1ff' },
    { id: 'glycerol', set: 'mem', r: [4.07, 4.12, 4.26, 4.3], at: () => V(SOLO.x, HEAD_Y - 0.45, SOLO.y), text: () => 'Glycerol', c: '#59e1ff' },
    { id: 'sat', set: 'mem', r: [4.08, 4.13, 4.26, 4.3], at: () => V(SOLO.x - 0.2, 0.9, SOLO.y), text: () => 'Saturated tail · straight', c: '#ff9b4a', left: true },
    { id: 'unsat', set: 'mem', r: [4.09, 4.14, 4.26, 4.3], at: () => V(SOLO.x + 0.6, 0.5, SOLO.y), text: () => 'Unsaturated tail · cis kink', c: '#ffe066' },
    { id: 'liposome', set: 'mem', r: [4.62, 4.66, 4.78, 4.82], at: () => V(-13, 13.2, -2), text: () => 'Liposome', c: '#59e1ff' },
    { id: 'micelle', set: 'mem', r: [4.62, 4.66, 4.78, 4.82], at: () => V(8.4, 11.6, -4), text: () => 'Micelles', c: '#59e1ff' },
    { id: 'sheet', set: 'mem', r: [4.62, 4.66, 4.78, 4.82], at: () => V(12, -12.5, -8), text: () => 'Bilayer sheet', c: '#59e1ff' },

    /* cross-section */
    { id: 'heads', set: 'mem', r: [5.08, 5.14, 5.9, 5.96], at: () => V(-9, HEAD_Y + 0.4, 20.3), text: () => 'Heads · hydrophilic', c: '#59e1ff' },
    { id: 'tails', set: 'mem', r: [5.08, 5.14, 5.9, 5.96], at: () => V(-7, 0.2, 20.3), text: () => 'Tails · hydrophobic core', c: '#ffb347' },
    { set: 'mem', r: [5.08, 5.14, 5.9, 5.96], at: () => V(-5, -HEAD_Y - 0.4, 20.3), text: () => 'Cytoplasmic leaflet', c: '#6a8dff' },

    /* proteins */
    { set: 'mem', r: [6.04, 6.1, 6.26, 6.3], at: () => engine.prot.peri[0].position.clone().add(V(0, -1.8, 0)), text: () => 'Peripheral protein', c: '#ffe36e' },
    { set: 'mem', r: [6.04, 6.1, 6.26, 6.3], at: () => engine.prot.peri[4].position.clone().add(V(0, -1.8, 0)), text: () => 'Peripheral protein', c: '#ffe36e' },
    { set: 'mem', r: [6.3, 6.35, 6.46, 6.5], at: () => P('channel').clone().add(V(0, 3.8, 0)), text: () => 'Multi-pass · channel', c: '#ff4fa3' },
    { set: 'mem', r: [6.3, 6.35, 6.46, 6.5], at: () => P('carrier').clone().add(V(0, 3.8, 0)), text: () => '12 helices · carrier', c: '#b77bff' },
    { id: 'sugar', set: 'mem', r: [6.5, 6.55, 6.62, 6.66], at: () => engine.prot.glyco[3].group.position.clone().add(V(0.4, 8, 0)), text: () => 'Sugar chain · outside only', c: '#8dff7a' },
    { set: 'mem', r: [6.5, 6.55, 6.62, 6.66], at: () => engine.prot.glyco[3].group.position.clone().add(V(0.2, 0, 0)), text: () => 'Single pass · 20–25 aa helix', c: '#ff6f91' },
    { id: 'cd4', set: 'mem', r: [6.7, 6.76, 6.9, 6.95], at: () => V(2, 13, 3), text: () => 'CD4 receptor', c: '#ff8a3d' },
    { id: 'hiv', set: 'mem', r: [6.76, 6.82, 6.9, 6.95], at: () => V(-8, 22, 3), text: () => 'HIV envelope · gp120 spikes', c: '#4de1c1' },

    /* transport stages */
    { id: 'aqp', set: 'mem', r: [8.03, 8.08, 8.95, 8.99], at: () => P('aquaporin').clone().add(V(-1.4, 5.2, 1.45)), text: () => 'Aquaporin', c: '#3fb6ff' },
    { id: 'kchan', set: 'mem', r: [8.3, 8.35, 8.95, 8.99], at: () => P('channel').clone().add(V(0, 5.2, 0)), text: () => (film.gate > 0.5 ? 'K⁺ channel · open' : 'K⁺ channel · closed'), c: '#ff4fa3' },
    { id: 'glut', set: 'mem', r: [8.64, 8.69, 8.95, 8.99], at: () => P('carrier').clone().add(V(0, 5.2, 0)), text: () => 'Carrier · GLUT', c: '#b77bff' },
    { id: 'pump', set: 'mem', r: [10.12, 10.16, 10.64, 10.68], at: () => P('pump').clone().add(V(4.2, 2.2, 0.5)), text: () => 'Na⁺/K⁺ pump (Na⁺/K⁺-ATPase)', c: '#e05cff' },
    { id: 'synthase', set: 'mem', r: [11.56, 11.6, 11.97, 12.0], at: () => P('synthase').clone().add(V(0, -14.8, 2)), text: () => 'ATP synthase · F₁ head', c: '#ffd36b' },
    { id: 'rotor', set: 'mem', r: [11.56, 11.6, 11.97, 12.0], at: () => P('synthase').clone().add(V(-2.4, 3.2, 2)), text: () => 'Rotor ring', c: '#ff7b54' },
    { set: 'mem', r: [11.56, 11.6, 11.97, 12.0], at: () => P('synthase').clone().add(V(-9, 7, 2)), text: () => 'Intermembrane space · high H⁺', c: '#ff4b7d' },
    { set: 'mem', r: [11.56, 11.6, 11.97, 12.0], at: () => P('synthase').clone().add(V(-9, -8, 2)), text: () => 'Matrix · low H⁺', c: '#ff4b7d' },

    /* tonicity: the three cells, then the graph */
    ...[0, 1, 2].map(
      (i): L => ({
        id: 'rbc' + i,
        set: 'tonic',
        r: [9.4, 9.44, i === 2 ? 9.84 : 9.795, i === 2 ? 9.86 : 9.81],
        at: () => {
          const m = marks()[i]
          return V(m.x, m.y - 4.7 * m.s, 0)
        },
        text: () => {
          const m = marks()[i]
          const n = ['Hypertonic', 'Isotonic', 'Hypotonic'][i]
          if (film.tonicG > 0.5) return i === 2 ? 'Bursts here · lysis' : i === 0 ? 'Crenated' : 'Isotonic · normal'
          return `${n} · ${Math.round(m.mosm)} mOsm/L`
        },
        c: ['#ffb347', '#59e1ff', '#ff5d73'][i],
      }),
    ),
    {
      id: 'rider',
      set: 'tonic',
      r: [9.745, 9.755, 9.8, 9.82],
      at: () => {
        const m = marks()[3]
        return V(m.x, m.y + 3.2 * 0.42, 0)
      },
      text: () => {
        const m = marks()[3]
        return m.lysis > 0.05 ? 'Lysed' : `${Math.round(m.mosm)} mOsm/L · ${Math.round(Math.min(m.V, 1.6) * 100)}%`
      },
      c: '#ff5d73',
    },
    ...[0, 1, 2].map(
      (i): L => ({
        id: 'plant' + i,
        set: 'tonic',
        r: [9.81, 9.83, 9.97, 10.0],
        at: () => {
          const m = plantMarks(engine.camA.aspect)[i]
          return V(m.x, m.y - 3.8 * m.s, 0)
        },
        text: () => (film.tonicG > 0.5 ? ['Plasmolysed', 'Flaccid', 'Turgid · the wall pushes back'][i] : ['Hypertonic · plasmolysed', 'Isotonic · flaccid', 'Hypotonic · turgid'][i]),
        c: ['#ffb347', '#59e1ff', '#8dff7a'][i],
      }),
    ),

    /* the landscape */
    { set: 'land', r: [10.78, 10.8, 11.44, 11.46], at: () => land.at(0, 0.1, 0.9, 2), text: () => 'Outside · Na⁺ 145 mM', c: '#ffc64a' },
    { set: 'land', r: [10.78, 10.8, 11.44, 11.46], at: () => land.at(0, 0.1, 0.08, 1.6), text: () => 'Inside · Na⁺ 12 mM', c: '#ffc64a' },
    { set: 'land', r: [10.78, 10.8, 11.44, 11.46], at: () => land.at(1, 0.15, 0.92, 2), text: () => (film.landCo > 0.5 ? 'Outside · glucose, low' : 'Outside · K⁺ 4 mM'), c: '#b18cff' },
    { set: 'land', r: [10.78, 10.8, 11.44, 11.46], at: () => land.at(1, 0.15, 0.06, 1.6), text: () => (film.landCo > 0.5 ? 'Inside · glucose, 10× higher' : 'Inside · K⁺ 140 mM'), c: '#b18cff' },
    { id: 'axis', set: 'land', r: [10.79, 10.81, 11.44, 11.46], at: () => land.at(0, 0, 0.75, landHeights().h0 * film.landRise + 5), text: () => 'Free energy ↑', c: '#edebe6', left: true },
    { id: 'membrane', set: 'land', r: [10.79, 10.81, 11.0, 11.02], at: () => land.at(0, 0.02, 0.5, landHeights().h0 * 0.5 * film.landRise + 1), text: () => 'Membrane: the step', c: '#59e1ff', left: true },
    { id: 'volt', set: 'land', r: [10.82, 10.85, 11.0, 11.02], at: () => land.at(1, 0.5, 0.02, 1.5), text: () => `Inside: ${Math.round(-70 * film.landVolt)} mV`, c: '#59e1ff' },
    { id: 'dgna', set: 'land', r: [10.8, 10.82, 11.44, 11.46], at: () => land.at(0, 0.7, 0.5, landHeights().h0 * 0.5 * film.landRise + 1.5), text: () => `Na⁺ in: ${kj(-landHeights().na)} · downhill`, c: '#ffc64a' },
    {
      id: 'dgk',
      set: 'land',
      r: [10.8, 10.82, 11.44, 11.46],
      at: () => land.at(1, 0.55, 0.5, Math.max(0, -landHeights().h1) * 0.5 * film.landRise + 1.5),
      text: () => {
        const h = landHeights()
        if (film.landCo > 0.5) return `Glucose in: ${kj(-h.glu)} · uphill`
        return `K⁺ in: ${kj(-h.k)} · ${Math.abs(h.k) < 4 ? 'nearly level' : 'uphill'}`
      },
      c: '#b18cff',
      left: true,
    },
    { id: 'gate', set: 'land', r: [11.01, 11.03, 11.41, 11.43], at: () => land.gate.position.clone().add(V(0, 2.6, 0)), text: () => (film.landCoRun > film.landPump ? 'Na⁺–glucose symporter · no ATP' : 'Na⁺/K⁺ pump · 1 ATP per cycle'), c: '#e05cff' },

    /* bulk */
    { id: 'bact', set: 'bulk', r: [12.06, 12.1, 12.3, 12.34], at: () => V(-2, 7.5 - 11 * Math.max(0, (film.phago - 0.55) / 0.45), 1), text: () => 'Bacterium', c: '#44ff7a' },
    { id: 'pseudopod', set: 'bulk', r: [12.1, 12.14, 12.22, 12.26], at: () => V(4.5, 3.5, 0), text: () => 'Pseudopod', c: '#59e1ff' },
    { id: 'lysoB', set: 'bulk', r: [12.25, 12.28, 12.32, 12.35], at: () => V(6.5, -8.5, 1), text: () => 'Lysosome', c: '#ff4d33' },
    { id: 'pino', set: 'bulk', r: [12.42, 12.46, 12.55, 12.58], at: () => V(20.6, -1.5, 0), text: () => 'Pinocytic vesicle', c: '#59e1ff' },
    { id: 'caveola', set: 'bulk', r: [12.48, 12.5, 12.55, 12.58], at: () => V(23.4, -0.8, 0.2), text: () => 'Caveola · caveolin', c: '#d19bff' },
    { id: 'clathrin', set: 'bulk', r: [12.64, 12.68, 12.78, 12.81], at: () => V(34.8, -1.2, 0), text: () => 'Clathrin coat', c: '#ffd88a' },
    { id: 'ldl', set: 'bulk', r: [12.62, 12.66, 12.78, 12.81], at: () => V(33.4, 0.5, 0), text: () => 'LDL · receptors', c: '#ffb347', left: true },
    { id: 'secves', set: 'bulk', r: [12.84, 12.87, 12.93, 12.96], at: () => V(46.4, -1.2, 0), text: () => 'Secretory vesicle', c: '#ffe066' },
  ]
  for (const l of list) {
    const el = document.createElement('div')
    el.className = 'lab' + (l.left ? ' l' : '') + (l.n ? ' num' : '')
    if (l.c) el.style.setProperty('--c', l.c)
    el.innerHTML = `<i></i><span>${l.n ? `<b>${l.n}</b>` : ''}<em></em></span>`
    root.appendChild(el)
    l.el = el
    l.sub = el.querySelector('em')!
    l.last = -1
  }
  const byId = new Map(list.filter((l) => l.id).map((l) => [l.id!, l]))
  let hot: L | null = null

  return () => {
    const F = film.F
    for (const l of list) {
      let a = band(l.r[0], l.r[1], l.r[2], l.r[3], F)
      if (a < 0.005 || (film.paper > 0.5 && l.set === 'cell' && !l.paper)) {
        if (l.last !== 0) ((l.el!.style.opacity = '0'), (l.last = 0))
        l.vis = 0
        continue
      }
      const [x, y, ok] = engine.project(l.set, l.at())
      if (!ok || x < -50 || y < -50 || x > innerWidth + 50 || y > innerHeight + 50) a = 0
      l.x = x
      l.y = y
      l.vis = a
      l.el!.style.opacity = a.toFixed(3)
      l.last = a
      l.el!.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(${l.left ? '-100%' : '0'}, -50%)`
      const t = l.text()
      if (l.sub!.textContent !== t) l.sub!.textContent = t
    }

    /* the spotlight: the key term being read wins, then the moment's subject */
    let target: L | null = null
    let amt = 0
    let rad = 280
    const vk = vocab.active ? byId.get(vocab.active) : undefined
    if (vk && (vk.vis ?? 0) > 0.5) ((target = vk), (amt = 0.85 * vocab.strength), (rad = 260))
    else
      for (const s of SPOTS) {
        const w = band(s.r[0], s.r[1], s.r[2], s.r[3], F)
        const l = byId.get(s.id)
        if (w > amt && l && (l.vis ?? 0) > 0.3) ((target = l), (amt = w * 0.85), (rad = s.rad))
      }
    if (target !== hot) {
      hot?.el!.classList.remove('hot')
      target?.el!.classList.add('hot')
      hot = target
    }
    if (target) {
      engine.spot.x = target.x!
      engine.spot.y = target.y!
      engine.spot.r = rad * (innerHeight / 900)
    }
    engine.spot.amt = target ? amt * smooth(0, 1, 1 - film.paper) : 0
  }
}
