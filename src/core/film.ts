/* ==========================================================================
   THE FILM
   Scroll becomes one continuous film time F ∈ [0, 14]. This file turns F into
   every camera, set, transition and stage the renderer, the molecules and
   the instruments need. It is a pure function of F, so scrolling back
   reverses everything exactly.

   Four sets, each with its own units:
     CELL   1 unit = 1 µm      a fluorescent animal cell (particles)
     MEM    1 unit = 1 nm      a patch of plasma membrane (instanced lipids)
     TONIC  1 unit = 1 µm      red blood cells and plant cells (raymarched)
     BULK   1 unit = 100 nm    the membrane bending: endo- and exocytosis
   Sets hand over through a lens-portal: one scale opens inside the other.
   ========================================================================== */

import * as THREE from 'three'

export const CHAPTERS = [
  'Membrane',
  'The cell, inside',
  'Scaffold and seams',
  'Fluid mosaic',
  'Phospholipids',
  'Fluidity',
  'Proteins and sugars',
  'Diffusion',
  'Facilitated transport',
  'Osmosis and tonicity',
  'Active transport',
  'Cotransport',
  'Bulk transport',
  'The whole border',
]
export const LAST = CHAPTERS.length // 14

export type SetName = 'cell' | 'mem' | 'tonic' | 'bulk'

/* ---------------------------------------------------------------- helpers */
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const band = (a: number, b: number, c: number, d: number, x: number) => smooth(a, b, x) * (1 - smooth(c, d, x))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/* ------------------------------------------------------------ set spans
   [from, to] in F, and which set is "outer" during each portal. */
type Span = { set: SetName; a: number; b: number }
const SPANS: Span[] = [
  { set: 'cell', a: 0, b: 3.02 },
  { set: 'mem', a: 2.9, b: 9.42 },
  { set: 'tonic', a: 9.3, b: 10.1 },
  { set: 'mem', a: 10.0, b: 12.03 },
  { set: 'bulk', a: 11.9, b: 13.06 },
  { set: 'cell', a: 12.96, b: 14.01 },
]
/* portals: [start, end] — inside grows from nothing to the full frame */
const PORTALS: [number, number][] = [
  [2.9, 3.02],
  [9.3, 9.42],
  [10.0, 10.1],
  [11.9, 12.03],
  [12.96, 13.06],
]

/* ----------------------------------------------------------- camera paths */
type Key = { f: number; p: [number, number, number]; t: [number, number, number]; fov: number }
const CAM: Record<SetName, Key[]> = {
  cell: [
    { f: 0.0, p: [0, 0, 36], t: [0, 0, 0], fov: 34 },
    { f: 0.5, p: [0, 0, 35], t: [0, 0, 0], fov: 34 },
    { f: 0.95, p: [14, 8, 30], t: [0, 0, 0], fov: 38 },
    { f: 1.3, p: [10, 4, 22], t: [1, 0.5, 0], fov: 40 },
    { f: 1.62, p: [-4, 7, 17], t: [2.5, 1.5, 0], fov: 42 },
    { f: 1.95, p: [-15, -3, 20], t: [0, 0, 0], fov: 40 },
    { f: 2.3, p: [-6, -14, 21], t: [0, -1, 0], fov: 42 },
    { f: 2.6, p: [16, -4, 24], t: [0, 0, 0], fov: 40 },
    { f: 2.86, p: [9, 2, 16], t: [8.5, 1.6, 2.8], fov: 44 },
    { f: 3.02, p: [9.3, 1.9, 4.6], t: [9.6, 1.9, 3.2], fov: 60 },
    { f: 12.96, p: [9.3, 1.9, 4.6], t: [9.6, 1.9, 3.2], fov: 60 },
    { f: 13.07, p: [0, 0, 38], t: [0, 0, 0], fov: 36 },
    { f: 13.5, p: [-18, 6, 30], t: [0, 0, 0], fov: 38 },
    { f: 13.95, p: [0, 0, 36], t: [0, 0, 0], fov: 34 },
    { f: 14.0, p: [0, 0, 36], t: [0, 0, 0], fov: 34 },
  ],
  mem: [
    { f: 2.9, p: [0, 70, 30], t: [0, 0, 0], fov: 50 },
    { f: 3.05, p: [0, 58, 24], t: [0, 0, 0], fov: 46 },
    { f: 3.35, p: [-30, 10, 30], t: [4, 0, -4], fov: 42 },
    { f: 3.7, p: [26, 16, 32], t: [0, -1, 0], fov: 40 },
    { f: 4.0, p: [3, 5, 16], t: [-1, 1, 0], fov: 40 },
    { f: 4.12, p: [-1.0, 1.6, 7.6], t: [-1.3, 1.3, 0], fov: 36 },
    { f: 4.27, p: [-0.6, 1.8, 7.2], t: [-1.3, 1.3, 0], fov: 36 },
    { f: 4.42, p: [2, 6, 50], t: [4, 2, 0], fov: 44 },
    { f: 4.62, p: [3, 6, 56], t: [6, 2.5, 0], fov: 44 },
    { f: 4.85, p: [-12, 18, 44], t: [0, 0, 0], fov: 42 },
    { f: 5.1, p: [0, 3, 58], t: [0, 0, 26], fov: 38 },
    { f: 5.5, p: [-6, 1.5, 46], t: [-3, 0, 26], fov: 34 },
    { f: 5.9, p: [6, 4, 50], t: [2, 0, 24], fov: 36 },
    { f: 6.12, p: [-18, -14, 26], t: [-8, -3, 2], fov: 42 },
    { f: 6.38, p: [-24, 8, 22], t: [-10, 0, 0], fov: 40 },
    { f: 6.58, p: [13, 9, 24], t: [3, 4, 8], fov: 40 },
    { f: 6.85, p: [12, 22, 60], t: [3, 13, 3], fov: 44 },
    { f: 7.0, p: [0, 22, 70], t: [0, 2, 8], fov: 40 },
    { f: 7.1, p: [0, 1, 78], t: [0, 0, 12], fov: 38 },
    { f: 7.9, p: [0, 1, 76], t: [0, 0, 12], fov: 38 },
    { f: 8.1, p: [-12, 2, 52], t: [-10, 0, 18], fov: 36 },
    { f: 8.5, p: [0, 1, 58], t: [0, 0, 18], fov: 36 },
    { f: 8.9, p: [12, 1, 50], t: [10, 0, 18], fov: 36 },
    { f: 9.1, p: [0, 1, 70], t: [0, 0, 16], fov: 38 },
    { f: 9.42, p: [0, 1, 70], t: [0, 0, 16], fov: 38 },
    { f: 10.0, p: [0, 1, 70], t: [0, 0, 16], fov: 38 },
    { f: 10.12, p: [0, 1, 74], t: [0, 0, 14], fov: 38 },
    { f: 10.3, p: [1, -1, 52], t: [3, -2, 20], fov: 40 },
    { f: 10.9, p: [5, -1, 48], t: [3, -2.5, 20], fov: 40 },
    { f: 11.15, p: [-9, 1, 54], t: [-7, -0.5, 20], fov: 38 },
    { f: 11.45, p: [-7, 0, 52], t: [-7, -0.5, 20], fov: 38 },
    { f: 11.6, p: [20, -6, 56], t: [15, -4.5, 18], fov: 40 },
    { f: 11.9, p: [18, -5, 52], t: [15, -4.5, 18], fov: 40 },
    { f: 12.03, p: [15, -4, 34], t: [15, -4, 18], fov: 50 },
  ],
  tonic: [
    { f: 9.3, p: [0, 4, 44], t: [0, 0, 0], fov: 40 },
    { f: 9.4, p: [0, 3, 38], t: [0, 0, 0], fov: 40 },
    { f: 9.45, p: [-5.5, 3, 15], t: [-10.5, 0, 0], fov: 40 },
    { f: 9.5, p: [-5.5, 2.5, 14], t: [-10.5, 0, 0], fov: 40 },
    { f: 9.54, p: [12.5, 3, 15], t: [7.5, 0, 0], fov: 40 },
    { f: 9.62, p: [12.5, 2.5, 14.5], t: [7.5, 0, 0], fov: 40 },
    { f: 9.68, p: [0, 4, 38], t: [0, 0, 0], fov: 40 },
    { f: 9.73, p: [0, 4.5, 37], t: [0, 0, 0], fov: 40 },
    { f: 9.8, p: [0, 5, 36], t: [0, 0, 0], fov: 40 },
    { f: 9.9, p: [0, 4, 33], t: [0, 0, 0], fov: 40 },
    { f: 10.1, p: [0, 3, 30], t: [0, 0, 0], fov: 40 },
  ],
  bulk: [
    { f: 11.9, p: [0, 14, 40], t: [0, 1, 0], fov: 40 },
    { f: 12.05, p: [0, 10, 34], t: [0, 0, 0], fov: 40 },
    { f: 12.32, p: [6, 4, 28], t: [0, -2, 0], fov: 40 },
    { f: 12.4, p: [22, 2.5, 7], t: [22, -0.3, 0], fov: 40 },
    { f: 12.55, p: [22, 2.2, 6.5], t: [22, -0.4, 0], fov: 40 },
    { f: 12.62, p: [34, 2.2, 6.5], t: [34, -0.4, 0], fov: 40 },
    { f: 12.78, p: [34, 1.8, 6], t: [34, -0.4, 0], fov: 40 },
    { f: 12.84, p: [46, 1.4, 4.2], t: [46, 0.1, 0], fov: 40 },
    { f: 13.06, p: [46, 1.2, 3.8], t: [46, 0.2, 0], fov: 40 },
  ],
}

type Path = { keys: Key[]; pos: THREE.CatmullRomCurve3; tgt: THREE.CatmullRomCurve3 }
const PATHS = {} as Record<SetName, Path>
for (const k of Object.keys(CAM) as SetName[]) {
  const keys = CAM[k]
  PATHS[k] = {
    keys,
    pos: new THREE.CatmullRomCurve3(keys.map((q) => new THREE.Vector3(...q.p)), false, 'centripetal'),
    tgt: new THREE.CatmullRomCurve3(keys.map((q) => new THREE.Vector3(...q.t)), false, 'centripetal'),
  }
}

export function camAt(set: SetName, F: number, pos: THREE.Vector3, tgt: THREE.Vector3) {
  const { keys, pos: cp, tgt: ct } = PATHS[set]
  const n = keys.length
  let i = 0
  while (i < n - 2 && F > keys[i + 1].f) i++
  const a = keys[i]
  const b = keys[i + 1]
  const l = clamp01((F - a.f) / Math.max(1e-6, b.f - a.f))
  const e = l * l * (3 - 2 * l)
  const u = (i + e) / (n - 1)
  cp.getPoint(u, pos)
  ct.getPoint(u, tgt)
  return lerp(a.fov, b.fov, e)
}

/* ------------------------------------------------------------ film state */
export const film = {
  F: 0,
  chapter: 0,
  u: 0,

  /* sets: outer is drawn first, inner opens inside the portal */
  outer: 'cell' as SetName,
  inner: null as SetName | null,
  portal: 0,

  paper: 0,
  exposure: 1,
  vignette: 0.5,

  /* ---- hero / cell ---- */
  heroGlass: 1,
  heroType: 1,
  assemble: 0, // particles: scattered → cell
  organelles: 1, // brightness of the organelles
  cyto: 0, // brightness of the cytoskeleton
  vesicles: 0, // endomembrane traffic highlighted
  memGlow: 0.4, // plasma membrane highlight
  finalGlass: 0,

  /* ---- membrane set ---- */
  lipidState: 0, // 0 bilayer · 1 scattered · 2 micelles & liposome · 3 bilayer again
  solo: 0, // one phospholipid alone
  temp: 37, // °C, drives packing and disorder
  cholesterol: 1,
  cholHi: 0,
  unsatHi: 0,
  proteins: 1,
  protHi: 0,
  sugars: 1,
  hiv: 0,
  cut: 0, // clip the patch to show the cross-section
  gate: 0, // gated channel open 0..1
  rock: 0, // carrier alternating access -1..1
  stage: 0, // 0 mosaic layout, 1 transport layout
  mol: 'none' as 'none' | 'diff' | 'fac' | 'osm' | 'active' | 'co',
  tau: 0, // molecular clock (s of film), for the stateless molecule paths
  pumpStep: 0, // 0..6, fractional
  synthase: 0,
  memDim: 0,

  /* ---- tonicity ---- */
  tonicMode: 0, // 0 red cells, 1 plant cells
  tonic: 0, // how far the solutions have acted, 0..1
  tonicFade: 1,
  tonicH: 0,
  tonicO: 0,

  /* ---- bulk ---- */
  phago: 0,
  lyso: 0,
  pino: 0,
  poto: 0,
  rme: 0,
  exo: 0,
}
export type Film = typeof film

function spansAt(F: number) {
  const on = SPANS.filter((s) => F >= s.a && F <= s.b)
  return on
}

export function updateFilm(F: number) {
  const f = film
  f.F = F
  f.chapter = Math.min(LAST - 1, Math.floor(F))
  f.u = F - f.chapter

  /* ---- sets & portals ---- */
  const on = spansAt(F)
  f.outer = on[0]?.set ?? 'cell'
  f.inner = on.length > 1 ? on[1].set : null
  f.portal = 0
  for (const [a, b] of PORTALS) if (F >= a && F <= b) f.portal = smooth(a, b, F)
  if (!f.inner) f.portal = 0

  /* ---- hero & cell ---- */
  f.heroGlass = 1 - smooth(0.5, 0.68, F)
  f.heroType = 1 - smooth(0.42, 0.62, F)
  f.assemble = smooth(0.5, 0.98, F)
  f.finalGlass = smooth(13.78, 13.96, F)
  f.organelles = 1 - 0.8 * band(2.0, 2.12, 2.9, 3.0, F)
  f.cyto = 0.12 + 0.88 * band(2.0, 2.12, 2.52, 2.62, F) + 0.25 * band(2.52, 2.6, 2.9, 3.0, F)
  f.vesicles = band(1.33, 1.42, 1.95, 2.05, F)
  f.memGlow = 0.45 + 0.55 * smooth(2.75, 2.95, F) + 0.5 * band(13.05, 13.3, 13.7, 13.9, F)

  /* ---- paper plates: junctions, phospholipids, osmosis, the summary ---- */
  f.paper = Math.max(band(2.5, 2.58, 2.84, 2.9, F), band(4.04, 4.12, 4.9, 4.97, F), band(9.02, 9.08, 9.24, 9.3, F), band(13.06, 13.12, 13.42, 13.5, F))

  /* ---- membrane ---- */
  // self-assembly: bilayer → scattered → micelles/liposome → bilayer
  f.lipidState = F < 4.3 ? 0 : F < 4.44 ? smooth(4.3, 4.44, F) : F < 4.56 ? 1 + smooth(4.48, 4.62, F) : F < 4.8 ? 1 + smooth(4.48, 4.62, F) : 2 + smooth(4.8, 4.93, F)
  f.solo = band(4.04, 4.1, 4.26, 4.32, F)
  // temperature: 37 → 5 → 37 → 42, the cholesterol beat
  f.temp = F < 5.25 ? 37 : F < 5.5 ? lerp(37, 4, smooth(5.25, 5.45, F)) : F < 5.7 ? lerp(4, 37, smooth(5.55, 5.68, F)) : 37
  f.unsatHi = band(5.25, 5.32, 5.55, 5.62, F)
  f.cholHi = band(5.75, 5.8, 5.95, 5.99, F)
  f.cholesterol = 1
  f.protHi = band(6.3, 6.35, 6.46, 6.5, F)
  f.sugars = 1
  f.hiv = band(6.66, 6.8, 6.9, 6.97, F)
  f.cut = smooth(4.95, 5.1, F) * (1 - smooth(6.0, 6.12, F)) + smooth(7.0, 7.08, F)
  f.stage = smooth(7.0, 7.1, F)
  f.proteins = 1 - 0.85 * band(4.02, 4.1, 4.95, 5.02, F)
  f.memDim = band(9.04, 9.1, 9.24, 9.3, F) * 0.7

  // molecules: which script is running and how far along it is
  if (F >= 7.0 && F < 8.0) {
    f.mol = 'diff'
    f.tau = (F - 7.0) * 40
  } else if (F >= 8.0 && F < 9.0) {
    f.mol = 'fac'
    f.tau = (F - 8.0) * 40
  } else if (F >= 9.0 && F < 9.42) {
    f.mol = 'osm'
    f.tau = (F - 9.0) * 40
  } else if (F >= 10.0 && F < 11.0) {
    f.mol = 'active'
    f.tau = (F - 10.0) * 40
  } else if (F >= 11.0 && F < 12.03) {
    f.mol = 'co'
    f.tau = (F - 11.0) * 40
  } else f.mol = 'none'

  f.gate = band(8.3, 8.36, 8.62, 8.68, F)
  // the carrier rocks: open-out while loading, open-in while releasing
  f.rock = 0
  // Na⁺/K⁺ pump: six steps across 10.3 → 10.85
  f.pumpStep = clamp01((F - 10.3) / 0.55) * 6
  f.synthase = smooth(11.55, 11.62, F)

  /* ---- tonicity ---- */
  f.tonicMode = F < 9.732 ? 0 : 1
  f.tonicH = smooth(9.43, 9.5, F)
  f.tonicO = smooth(9.53, 9.615, F)
  f.tonic = smooth(9.76, 9.85, F)
  f.tonicFade = 1 - band(9.712, 9.728, 9.736, 9.752, F)

  /* ---- bulk ---- */
  f.phago = smooth(12.06, 12.26, F)
  f.lyso = smooth(12.26, 12.36, F)
  f.pino = smooth(12.42, 12.54, F)
  f.poto = smooth(12.46, 12.58, F)
  f.rme = smooth(12.64, 12.77, F)
  f.exo = smooth(12.84, 12.95, F)

  /* ---- grade ---- */
  f.exposure = 1 - f.memDim * 0.4
  f.vignette = 0.45 + (f.outer === 'bulk' ? 0.15 : 0)
  return f
}

/* the scale readout: world units → metres, per set */
export const UNIT_M: Record<SetName, number> = { cell: 1e-6, mem: 1e-9, tonic: 1e-6, bulk: 1e-7 }
