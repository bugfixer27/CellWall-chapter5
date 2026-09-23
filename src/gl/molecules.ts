import * as THREE from 'three'
import { film, smooth, clamp01, lerp } from '../core/film'
import { U } from './uniforms'
import { SYN_W, SYN_T0 } from './proteins'

/* ==========================================================================
   MOLECULES — every ion and small molecule in the transport chapters.
   Each one's position is a pure function of molecular time τ (set by the
   scroll): a random walk, reflected off whatever it cannot cross, plus
   scripted passages through proteins. Scroll back and every molecule
   retraces its path. The instruments count them from the same functions,
   so the charts are measured from the scene, not drawn beside it.

   Units: nm. Outside the cell is +y. The cross-section plane is z ≈ 20.3.
   ========================================================================== */

export const SP = { O2: 0, CO2: 1, Na: 2, K: 3, Cl: 4, GLU: 5, H2O: 6, ATP: 7, ADP: 8, Pi: 9, H: 10, PROT: 11, SOL: 12 } as const
type Sp = (typeof SP)[keyof typeof SP]

const COLOR: Record<number, string> = {
  0: '#ff5d73', 1: '#dfe6f0', 2: '#ffc64a', 3: '#b18cff', 4: '#6dffa8', 5: '#fff0c8', 6: '#4cc3ff', 7: '#e8ff5a', 8: '#c4d65a', 9: '#ff9a3c', 10: '#ff4b7d', 11: '#7a6cff', 12: '#ffc9ec',
}
const SIZE: Record<number, number> = { 0: 0.8, 1: 0.9, 2: 0.78, 3: 0.9, 4: 0.85, 5: 1.35, 6: 0.62, 7: 1.5, 8: 1.3, 9: 0.72, 10: 0.55, 11: 2.4, 12: 1.6 }
const SHAPE: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 2, 11: 9, 12: 10 }

const MAX = 1200
const X = 27
const YT = 17
const MEM = 2.9 // half-thickness to the outer surface of the head groups
const DT = 0.25 // walk sample spacing, τ units
const STEPS = 240

type Ev = { t0: number; t1: number; path: THREE.Vector3[]; after: number }
type Mol = {
  sp: Sp
  x0: THREE.Vector3
  side: number // +1 outside, −1 inside, 0 free to cross the lipids
  sig: number
  z: [number, number]
  walk: Float32Array // STEPS × 3, cumulative
  ev: Ev[]
  key?: (F: number) => THREE.Vector3 | null // fully scripted (the pump)
  alpha?: (F: number) => number
}

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const fold = (v: number, lo: number, hi: number) => {
  const w = hi - lo
  let t = (v - lo) % (2 * w)
  if (t < 0) t += 2 * w
  return lo + (t < w ? t : 2 * w - t)
}
const catmull = (pts: THREE.Vector3[], u: number, out: THREE.Vector3) => {
  const n = pts.length - 1
  const f = Math.min(n - 1e-6, Math.max(0, u * n))
  const i = Math.floor(f)
  const t = f - i
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)]
  const t2 = t * t, t3 = t2 * t
  out.set(
    0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  )
  return out
}

/* ---------------------------------------------------------------- scripts */
type Script = { mols: Mol[]; tau: number }
const r = rng(99)
const gauss = () => {
  const u = Math.max(1e-6, r())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}
function mkWalk() {
  const w = new Float32Array(STEPS * 3)
  let x = 0, y = 0, z = 0
  for (let i = 0; i < STEPS; i++) {
    w[i * 3] = x
    w[i * 3 + 1] = y
    w[i * 3 + 2] = z
    x += gauss()
    y += gauss()
    z += gauss() * 0.4
  }
  return w
}
const FRONT: [number, number] = [20.5, 22.2]
const DEEP: [number, number] = [6, 19.5]
function mol(sp: Sp, side: number, sig: number, deep = r() < 0.25): Mol {
  const yLo = side > 0 ? MEM + 0.5 : side < 0 ? -YT : -YT
  const yHi = side > 0 ? YT : side < 0 ? -MEM - 0.5 : YT
  const z = deep ? DEEP : FRONT
  return {
    sp,
    side,
    sig,
    z,
    x0: V((r() * 2 - 1) * X, yLo + r() * (yHi - yLo), z[0] + r() * (z[1] - z[0])),
    walk: mkWalk(),
    ev: [],
  }
}
/** a free molecule that starts on one side but can cross the lipids */
function free(sp: Sp, start: number, sig: number) {
  const m = mol(sp, start, sig)
  m.side = 0
  return m
}

function passage(x: number, z: number, dir: number, t0: number, dur: number, hold = 0): Ev {
  // a straight run through a pore, with an optional pause at the binding site
  const y0 = -dir * 5.5
  const path = hold > 0 ? [V(x, y0, z), V(x, -dir * 1.4, z), V(x, 0, z), V(x, dir * 1.4, z), V(x, -y0, z)] : [V(x, y0, z), V(x, -dir * 2.2, z), V(x, 0, z), V(x, dir * 2.2, z), V(x, -y0, z)]
  return { t0, t1: t0 + dur + hold, path, after: dir }
}

const scripts: Record<string, Script> = {}

/* 5.2 diffusion: two gases each running down their own gradient, and ions that cannot */
{
  const m: Mol[] = []
  for (let i = 0; i < 240; i++) {
    const q = free(SP.O2, 1, 2.9)
    q.x0.y = MEM + 1 + r() * (YT - MEM - 1)
    m.push(q)
  }
  for (let i = 0; i < 150; i++) {
    const q = free(SP.CO2, -1, 2.5)
    q.x0.y = -(MEM + 1 + r() * (YT - MEM - 1))
    m.push(q)
  }
  for (let i = 0; i < 60; i++) m.push(mol(SP.Na, 1, 0.9))
  for (let i = 0; i < 44; i++) m.push(mol(SP.Cl, 1, 0.9))
  for (let i = 0; i < 26; i++) m.push(mol(SP.GLU, 1, 0.6))
  for (let i = 0; i < 50; i++) m.push(mol(SP.K, -1, 0.9))
  for (let i = 0; i < 8; i++) m.push(mol(SP.PROT, -1, 0.3))
  scripts.diff = { mols: m, tau: 0 }
}

/* 5.2 facilitated: aquaporin, a gated K⁺ channel, a glucose carrier */
export const CARRIER_EVENTS: Ev[] = []
{
  const m: Mol[] = []
  // water, single file both ways through the two cut pores of the aquaporin
  for (let i = 0; i < 90; i++) {
    const side = i % 2 ? 1 : -1
    const q = mol(SP.H2O, side, 1.1)
    if (i < 36) {
      const pore = i % 4 < 2 ? -3.45 : -0.55
      q.z = FRONT
      q.ev.push(passage(pore, 20.4, -side, 1 + (i / 36) * 36, 0.9))
    }
    m.push(q)
  }
  // K⁺: many inside; while the gate is open (τ 13.5–26) a stream leaves
  for (let i = 0; i < 50; i++) {
    const q = mol(SP.K, -1, 0.9)
    if (i < 14) {
      q.z = FRONT
      q.ev.push(passage(-15, 20.45, 1, 13.6 + i * 0.85, 0.55))
    }
    m.push(q)
  }
  for (let i = 0; i < 8; i++) m.push(mol(SP.K, 1, 0.9))
  // glucose: high outside; the carrier takes one at a time
  for (let i = 0; i < 28; i++) {
    const q = mol(SP.GLU, 1, 0.6)
    if (i < 4) {
      q.z = FRONT
      const e = passage(11, 20.45, -1, 27.2 + i * 3.1, 1.2, 1.5)
      q.ev.push(e)
      CARRIER_EVENTS.push(e)
    }
    m.push(q)
  }
  for (let i = 0; i < 5; i++) m.push(mol(SP.GLU, -1, 0.6))
  for (let i = 0; i < 40; i++) m.push(mol(SP.Na, 1, 0.9))
  scripts.fac = { mols: m, tau: 0 }
}

/* 5.2 osmosis: solute that cannot cross, water that can */
{
  const m: Mol[] = []
  for (let i = 0; i < 46; i++) m.push(mol(SP.SOL, 1, 0.45))
  for (let i = 0; i < 10; i++) m.push(mol(SP.SOL, -1, 0.45))
  for (let i = 0; i < 120; i++) {
    const side = i < 52 ? 1 : -1
    const q = mol(SP.H2O, side, 1.1)
    if (i >= 52 && i < 76) q.ev.push(passage(i % 2 ? -3.45 : -0.55, 20.4, 1, 0.5 + (i - 52) * 0.62, 0.9))
    if (i < 6) q.ev.push(passage(i % 2 ? -3.45 : -0.55, 20.4, -1, 2 + i * 2.3, 0.9))
    m.push(q)
  }
  scripts.osm = { mols: m, tau: 0 }
}

/* 5.3 active transport: the gradient, and one full cycle of the Na⁺/K⁺ pump */
const PUMP = V(2, 0, 20.45)
export const PS0 = 10.2
export const PSL = 0.42
const stepAt = (s: number) => PS0 + (s / 6) * PSL // F at pump step s
const tauAtF = (F: number) => (F - 10.0) * 40
{
  const m: Mol[] = []
  for (let i = 0; i < 86; i++) m.push(mol(SP.Na, 1, 0.9))
  for (let i = 0; i < 8; i++) m.push(mol(SP.Na, -1, 0.9))
  for (let i = 0; i < 60; i++) m.push(mol(SP.K, -1, 0.9))
  for (let i = 0; i < 6; i++) m.push(mol(SP.K, 1, 0.9))
  for (let i = 0; i < 36; i++) m.push(mol(SP.Cl, 1, 0.9))
  for (let i = 0; i < 12; i++) m.push(mol(SP.PROT, -1, 0.3))
  // the pump's own passengers
  const naSite = [V(-0.7, -0.6, 0), V(0, -0.2, 0), V(0.7, -0.6, 0)]
  const kSite = [V(-0.4, 0.5, 0), V(0.45, 0.5, 0)]
  naSite.forEach((site, i) => {
    const q = mol(SP.Na, -1, 0.9)
    q.z = FRONT
    q.x0.set(PUMP.x - 6 + i * 5, -8 - i * 2, 21)
    const inCav = PUMP.clone().add(V(site.x * 0.6, -2.4, 0))
    const bound = PUMP.clone().add(site)
    const up = PUMP.clone().add(V(site.x * 0.7, 1.6, 0))
    const outP = PUMP.clone().add(V(-3 + i * 3, 6.5, 0.4))
    q.key = (F) => {
      const s = clamp01((F - PS0) / PSL) * 6
      if (F < PS0 - 0.02 || F > stepAt(3.05)) return null
      const t = new THREE.Vector3()
      if (s < 0.9) return catmull([molAt({ ...q, key: undefined }, tauAtF(PS0 - 0.02), new THREE.Vector3()), inCav, bound], smooth(0, 0.9, s), t)
      if (s < 2.4) return bound.clone()
      return catmull([bound, up, outP], smooth(2.4, 3.0, s), t)
    }
    // afterwards it wanders outside, starting from where it was released
    q.ev.push({ t0: tauAtF(stepAt(3.0)) - 0.01, t1: tauAtF(stepAt(3.0)), path: [outP, outP], after: 1 })
    q.side = -1
    m.push(q)
  })
  kSite.forEach((site, i) => {
    const q = mol(SP.K, 1, 0.9)
    q.z = FRONT
    q.x0.set(PUMP.x - 4 + i * 8, 9 + i * 2, 21)
    const mouth = PUMP.clone().add(V(site.x, 2.6, 0))
    const bound = PUMP.clone().add(site)
    const down = PUMP.clone().add(V(site.x * 0.8, -1.7, 0))
    const inP = PUMP.clone().add(V(-2 + i * 4, -7, 0.4))
    q.key = (F) => {
      const s = clamp01((F - PS0) / PSL) * 6
      if (F < stepAt(3.0) || F > stepAt(6.05)) return null
      const t = new THREE.Vector3()
      if (s < 3.9) return catmull([molAt({ ...q, key: undefined, ev: [] }, tauAtF(stepAt(3.0)), new THREE.Vector3()), mouth, bound], smooth(3.0, 3.9, s), t)
      if (s < 4.8) return bound.clone().lerp(PUMP.clone().add(V(site.x, -0.3, 0)), smooth(4.0, 4.8, s))
      return catmull([PUMP.clone().add(V(site.x, -0.3, 0)), down, inP], smooth(5.0, 6.0, s), t)
    }
    q.ev.push({ t0: tauAtF(stepAt(6.0)) - 0.01, t1: tauAtF(stepAt(6.0)), path: [inP, inP], after: -1 })
    m.push(q)
  })
  // ATP arrives at the N domain, is split; Pi rides on the P domain, ADP leaves
  const nSite = PUMP.clone().add(V(2.3, -4.9, 0.1))
  const pSite = PUMP.clone().add(V(0.9, -3.4, 0.1))
  const atp: Mol = { ...mol(SP.ATP, -1, 0.3), z: FRONT }
  atp.x0.set(PUMP.x + 7, -13, 20.8)
  atp.key = (F) => {
    const s = clamp01((F - PS0) / PSL) * 6
    if (F > stepAt(1.75)) return null
    if (s < 1.2) return atp.x0.clone().lerp(nSite, smooth(0, 1.2, s))
    return nSite.clone()
  }
  atp.alpha = (F) => (F > stepAt(1.7) ? 0 : 1)
  m.push(atp)
  const adp: Mol = { ...mol(SP.ADP, -1, 0.3), z: FRONT }
  adp.key = (F) => {
    if (F < stepAt(1.7)) return nSite.clone()
    if (F > stepAt(3.5)) return null
    return nSite.clone().lerp(V(PUMP.x + 8, -14, 20.8), smooth(stepAt(1.75), stepAt(3.4), F))
  }
  adp.alpha = (F) => (F < stepAt(1.7) ? 0 : 1 - smooth(stepAt(3.2), stepAt(3.5), F))
  m.push(adp)
  const pi: Mol = { ...mol(SP.Pi, -1, 0.3), z: FRONT }
  pi.key = (F) => {
    if (F < stepAt(1.7)) return nSite.clone()
    if (F < stepAt(1.95)) return nSite.clone().lerp(pSite, smooth(stepAt(1.7), stepAt(1.95), F))
    if (F < stepAt(3.7)) return pSite.clone()
    if (F > stepAt(5.2)) return null
    return pSite.clone().lerp(V(PUMP.x - 6, -12, 20.8), smooth(stepAt(3.7), stepAt(5.0), F))
  }
  pi.alpha = (F) => (F < stepAt(1.7) ? 0 : 1 - smooth(stepAt(4.8), stepAt(5.2), F))
  m.push(pi)
  scripts.active = { mols: m, tau: 0 }
}

/* 5.3 cotransport: Na⁺ down its gradient pulls glucose up its own; then H⁺ turns ATP synthase */
export const SYM_EVENTS: Ev[] = []
const SYM = V(-11, 0, 20.45)
const SYN = V(15, 0, 18)
{
  const m: Mol[] = []
  for (let i = 0; i < 70; i++) m.push(mol(SP.Na, 1, 0.9))
  for (let i = 0; i < 8; i++) m.push(mol(SP.Na, -1, 0.9))
  for (let i = 0; i < 26; i++) m.push(mol(SP.GLU, -1, 0.5))
  for (let i = 0; i < 6; i++) m.push(mol(SP.GLU, 1, 0.5))
  for (let c = 0; c < 5; c++) {
    const t0 = 2 + c * 3.6
    const g = mol(SP.GLU, 1, 0.5)
    g.z = FRONT
    const e = passage(SYM.x, 20.45, -1, t0, 1.3, 1.4)
    g.ev.push(e)
    SYM_EVENTS.push(e)
    m.push(g)
    for (const dx of [-0.9, 0.9]) {
      const n = mol(SP.Na, 1, 0.9)
      n.z = FRONT
      n.ev.push(passage(SYM.x + dx, 20.45, -1, t0 + 0.05, 1.3, 1.4))
      m.push(n)
    }
  }
  // protons: high in the intermembrane space (+y), low in the matrix
  for (let i = 0; i < 44; i++) {
    const q = mol(SP.H, 1, 0.9)
    q.x0.x = 2 + r() * 20
    m.push(q)
  }
  for (let i = 0; i < 6; i++) m.push(mol(SP.H, -1, 0.9))
  const R = 2.4
  for (let i = 0; i < 36; i++) {
    const q = mol(SP.H, 1, 0.9)
    q.z = FRONT
    const tIn = SYN_T0 + 0.3 + i * 0.5
    const a0 = 0.35 // enters a c-subunit beside the stator (+x)
    const ride = 4.5 // ~0.9 of a turn
    const pts: THREE.Vector3[] = []
    pts.push(V(SYN.x + 4.4, 6, 20.6), V(SYN.x + 3.2, 2.0, 20.3))
    const K = 14
    for (let k = 0; k <= K; k++) {
      // position of its c-subunit as the rotor turns (rotation.y = +θ → angle a0 − θ)
      const a = a0 - SYN_W * (ride * k) / K
      pts.push(V(SYN.x + Math.cos(a) * R, -0.2 + (k / K) * -0.6, SYN.z + Math.sin(a) * R))
    }
    pts.push(V(SYN.x + 3.1, -2.2, 20.3), V(SYN.x + 4.6, -6.5, 20.6))
    q.ev.push({ t0: tIn - 0.6, t1: tIn + ride + 0.6, path: pts, after: -1 })
    m.push(q)
  }
  // ATP leaves the F₁ head three times per turn
  for (let i = 0; i < 12; i++) {
    const q = mol(SP.ATP, -1, 0.4)
    q.z = FRONT
    const t0 = SYN_T0 + 1 + i * (5 / 3)
    const b = 1.2 + i * 2.09
    const site = V(SYN.x + Math.cos(b) * 3.2, -10.8, SYN.z + Math.max(0.5, Math.sin(b)) * 2.6)
    q.ev.push({ t0, t1: t0 + 2.5, path: [site, site.clone().add(V(Math.cos(b) * 2, -2, 0.5)), site.clone().add(V(Math.cos(b) * 4, -5, 0.8))], after: -1 })
    q.alpha = (F) => {
      const tau = (F - 11) * 40
      return tau < t0 ? 0 : 1
    }
    m.push(q)
  }
  scripts.co = { mols: m, tau: 0 }
}

/* ---------------------------------------------------------------- evaluate */
const tmpW = new THREE.Vector3()
function walkAt(m: Mol, tau: number, out: THREE.Vector3) {
  const f = Math.max(0, Math.min(STEPS - 1.001, tau / DT))
  const i = Math.floor(f)
  const t = f - i
  const w = m.walk
  out.set(
    w[i * 3] + (w[i * 3 + 3] - w[i * 3]) * t,
    w[i * 3 + 1] + (w[i * 3 + 4] - w[i * 3 + 1]) * t,
    w[i * 3 + 2] + (w[i * 3 + 5] - w[i * 3 + 2]) * t,
  )
  return out.multiplyScalar(m.sig * Math.sqrt(DT) * 1.6)
}
const tA = new THREE.Vector3()
const tB = new THREE.Vector3()
function wander(m: Mol, anchor: THREE.Vector3, tAnchor: number, side: number, tau: number, out: THREE.Vector3) {
  walkAt(m, tau, tA)
  walkAt(m, tAnchor, tB)
  out.copy(anchor).add(tA.sub(tB))
  out.x = fold(out.x, -X, X)
  out.z = fold(out.z, m.z[0], m.z[1])
  if (side > 0) out.y = fold(out.y, MEM + 0.4, YT)
  else if (side < 0) out.y = fold(out.y, -YT, -MEM - 0.4)
  else out.y = fold(out.y, -YT, YT)
  return out
}
export function molAt(m: Mol, tau: number, out: THREE.Vector3) {
  let anchor = m.x0
  let tAnchor = 0
  let side = m.side
  for (const e of m.ev) {
    if (tau < e.t0 - 1.4) break
    if (tau < e.t0) {
      // approach the mouth of the pore
      wander(m, anchor, tAnchor, side, tau, out)
      const k = smooth(e.t0 - 1.4, e.t0, tau)
      return out.lerp(e.path[0], k)
    }
    if (tau < e.t1) return catmull(e.path, (tau - e.t0) / (e.t1 - e.t0), out)
    anchor = e.path[e.path.length - 1]
    tAnchor = e.t1
    side = e.after
  }
  return wander(m, anchor, tAnchor, side, tau, out)
}

/** alternating access state of a carrier from its passengers: +1 open outside, −1 open inside */
function rockFrom(evs: Ev[], tau: number) {
  for (const e of evs) {
    if (tau < e.t0 - 0.6) break
    const u = (tau - e.t0) / (e.t1 - e.t0)
    if (u < 1.35) return lerp(1, -1, smooth(0.38, 0.62, u)) * (1 - smooth(1.05, 1.35, u)) + smooth(1.05, 1.35, u)
  }
  return 1
}

/* ---------------------------------------------------------------- render */
export class Molecules {
  mesh: THREE.Mesh
  inst: Float32Array
  instB: Float32Array
  geo: THREE.InstancedBufferGeometry
  stats = { up: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], down: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }
  carrierRock = 1
  symRock = 1
  private p = new THREE.Vector3()
  private cur: Script | null = null

  constructor() {
    const g = new THREE.InstancedBufferGeometry()
    const q = new THREE.PlaneGeometry(1, 1)
    g.setAttribute('position', q.attributes.position)
    g.setAttribute('uv', q.attributes.uv)
    g.setIndex(q.index)
    this.inst = new Float32Array(MAX * 4)
    this.instB = new Float32Array(MAX * 4)
    const a = new THREE.InstancedBufferAttribute(this.inst, 4)
    const b = new THREE.InstancedBufferAttribute(this.instB, 4)
    a.setUsage(THREE.DynamicDrawUsage)
    b.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('aP', a)
    g.setAttribute('aB', b)
    g.instanceCount = 0
    this.geo = g
    const cols = Array.from({ length: 13 }, (_, i) => new THREE.Color(COLOR[i]).convertSRGBToLinear())
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uCol: { value: cols }, uTime: U.uTime, uPaper: U.uPaper },
      vertexShader: /* glsl */ `
        in vec4 aP; in vec4 aB;
        out vec2 vUv; out vec3 vC; out float vA; out float vShape; out float vSp;
        uniform vec3 uCol[13];
        void main(){
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(aP.xyz, 1.0);
          float s = aB.x;
          mv.xy += position.xy * s * 1.25;
          gl_Position = projectionMatrix * mv;
          int sp = int(aP.w + 0.5);
          vC = uCol[sp];
          vA = aB.y;
          vShape = aB.z;
          vSp = aP.w;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        layout(location=0) out vec4 o;
        in vec2 vUv; in vec3 vC; in float vA; in float vShape; in float vSp;
        float disc(vec2 p, vec2 c, float r){ return smoothstep(r, r * 0.72, length(p - c)); }
        float hex(vec2 p, float r){ p = abs(p); return max(dot(p, vec2(0.866, 0.5)), p.y) - r; }
        void main(){
          vec2 p = (vUv - 0.5) * 2.0;
          int sh = int(vShape + 0.5);
          float a = 0.0; float glyph = 0.0;
          if (sh == 0) a = max(disc(p, vec2(-0.3, 0.0), 0.42), disc(p, vec2(0.3, 0.0), 0.42));
          else if (sh == 1) a = max(disc(p, vec2(0.0), 0.34), max(disc(p, vec2(-0.55, 0.0), 0.3), disc(p, vec2(0.55, 0.0), 0.3)));
          else if (sh == 2 || sh == 3) {
            a = disc(p, vec2(0.0), 0.62);
            float bar = step(abs(p.y), 0.07) * step(abs(p.x), 0.32);
            float vbar = step(abs(p.x), 0.07) * step(abs(p.y), 0.32);
            glyph = sh == 2 ? max(bar, vbar) : bar;
          }
          else if (sh == 4) { float h = hex(p, 0.5); a = smoothstep(0.08, 0.0, abs(h) - 0.07); }
          else if (sh == 5) a = max(disc(p, vec2(0.0, 0.12), 0.4), max(disc(p, vec2(-0.42, -0.25), 0.24), disc(p, vec2(0.42, -0.25), 0.24)));
          else if (sh == 6 || sh == 7) {
            a = disc(p, vec2(-0.35, 0.0), 0.42);
            int n = sh == 6 ? 3 : 2;
            for (int i = 0; i < 3; i++) if (i < n) a = max(a, disc(p, vec2(0.2 + float(i) * 0.3, 0.0), 0.16));
          }
          else if (sh == 8) a = disc(p, vec2(0.0), 0.5);
          else if (sh == 9) { a = disc(p, vec2(0.0), 0.75) * 0.6; glyph = step(abs(p.y), 0.05) * step(abs(p.x), 0.25); }
          else { float h = hex(p - vec2(-0.32, 0.0), 0.3); float h2 = hex(p - vec2(0.32, 0.0), 0.3); a = smoothstep(0.08, 0.0, min(abs(h), abs(h2)) - 0.06); }
          float halo = exp(-dot(p, p) * 2.2) * 0.35;
          vec3 c = vC * (a * 1.7 + halo) - vec3(glyph) * vC * 0.9 * a;
          float al = (a + halo) * vA;
          if (al < 0.01) discard;
          o = vec4(c * vA, al * 0.4);
        }`,
    })
    this.mesh = new THREE.Mesh(g, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
  }

  update() {
    const f = film
    const s = f.mol === 'none' ? null : scripts[f.mol]
    this.cur = s
    this.carrierRock = f.mol === 'fac' ? rockFrom(CARRIER_EVENTS, f.tau) : 1
    this.symRock = f.mol === 'co' ? rockFrom(SYM_EVENTS, f.tau) : 1
    this.stats.up.fill(0)
    this.stats.down.fill(0)
    if (!s) {
      this.geo.instanceCount = 0
      return
    }
    const tau = f.tau
    const t = U.uTime.value
    // chapter fades so scripts never pop
    const edge = smooth(0, 0.8, tau) * (1 - smooth(39, 40.5, tau)) * (1 - f.memDim * 0.6)
    let n = 0
    for (let i = 0; i < s.mols.length && n < MAX; i++) {
      const m = s.mols[i]
      let p: THREE.Vector3 | null = null
      if (m.key) {
        const k = m.key(f.F)
        if (k) p = this.p.copy(k)
      }
      if (!p) p = molAt(m, tau, this.p)
      // thermal jitter keeps the scene alive between scroll ticks (bounded, so it never drifts)
      const j = 0.18 * Math.min(m.sig, 1.2)
      p.x += Math.sin(t * 3.1 + i * 1.7) * j
      p.y += Math.sin(t * 2.7 + i * 2.3) * j
      const a = (m.alpha ? m.alpha(f.F) : 1) * edge
      const sp = m.sp
      if (p.y > 0) this.stats.up[sp]++
      else this.stats.down[sp]++
      this.inst[n * 4] = p.x
      this.inst[n * 4 + 1] = p.y
      this.inst[n * 4 + 2] = p.z
      this.inst[n * 4 + 3] = sp
      this.instB[n * 4] = SIZE[sp]
      this.instB[n * 4 + 1] = a
      this.instB[n * 4 + 2] = SHAPE[sp]
      n++
    }
    this.geo.instanceCount = n
    ;(this.geo.attributes.aP as THREE.InstancedBufferAttribute).needsUpdate = true
    ;(this.geo.attributes.aB as THREE.InstancedBufferAttribute).needsUpdate = true
  }

  /** how many passages of a species have completed by τ */
  crossed(script: string, sp: number, tau: number) {
    let n = 0
    for (const m of scripts[script].mols) if (m.sp === sp) for (const e of m.ev) if (e.t1 <= tau && e.path.length > 2) n++
    return n
  }

  /** fraction of a species above the membrane at molecular time τ (for the charts) */
  fractionUp(script: string, sp: Sp, tau: number) {
    const s = scripts[script]
    let up = 0
    let tot = 0
    for (const m of s.mols) {
      if (m.sp !== sp) continue
      tot++
      if (molAt(m, tau, tmpW).y > 0) up++
    }
    return tot ? up / tot : 0
  }
}
