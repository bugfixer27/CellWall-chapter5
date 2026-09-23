import * as THREE from 'three'
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js'
import { HASH, NOISE } from './glsl'
import { U } from './uniforms'
import { film, smooth, band, lerp, clamp01 } from '../core/film'
import { MAXP } from './bilayer'

/** ATP synthase rotor: 2π/5 rad per unit of molecular time (one H⁺ every 0.5) */
export const SYN_W = (Math.PI * 2) / 5
export const SYN_T0 = 22

/* ==========================================================================
   PROTEINS — molecular surfaces, 1 unit = 1 nm.
   Each protein is built from its secondary structure: α-helices are chains
   of spheres, globular domains are clusters. A marching-cubes pass melts the
   spheres into one smooth molecular surface, like a structure viewer's
   surface mode. Parts that move (channel subunits, the carrier's two halves,
   the pump's domains, ATP synthase's rotor) are separate surfaces.
   ========================================================================== */

type Ball = [number, number, number, number]

function blob(balls: Ball[], resMax = 60): THREE.BufferGeometry {
  const min = new THREE.Vector3(1e9, 1e9, 1e9)
  const max = new THREE.Vector3(-1e9, -1e9, -1e9)
  for (const [x, y, z, r] of balls) {
    min.min(new THREE.Vector3(x - r * 1.6, y - r * 1.6, z - r * 1.6))
    max.max(new THREE.Vector3(x + r * 1.6, y + r * 1.6, z + r * 1.6))
  }
  const c = min.clone().add(max).multiplyScalar(0.5)
  const ext = Math.max(max.x - min.x, max.y - min.y, max.z - min.z)
  const S = ext * 1.15
  const res = Math.round(Math.max(28, Math.min(resMax, ext / 0.16)))
  const mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 120000)
  mc.isolation = 1
  mc.reset()
  for (const [x, y, z, r] of balls) mc.addBall(0.5 + (x - c.x) / S, 0.5 + (y - c.y) / S, 0.5 + (z - c.z) / S, 2 * (r / S) ** 2, 1)
  mc.update()
  const n = mc.count
  const pos = (mc as any).positionArray.slice(0, n * 3) as Float32Array
  const nor = (mc as any).normalArray.slice(0, n * 3) as Float32Array
  for (let i = 0; i < n; i++) {
    pos[i * 3] = c.x + (pos[i * 3] * S) / 2
    pos[i * 3 + 1] = c.y + (pos[i * 3 + 1] * S) / 2
    pos[i * 3 + 2] = c.z + (pos[i * 3 + 2] * S) / 2
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  mc.geometry.dispose()
  return g
}

/** an α-helix from a to b: a chain of spheres winding round the axis */
function helix(a: THREE.Vector3, b: THREE.Vector3, r = 0.5): Ball[] {
  const out: Ball[] = []
  const L = a.distanceTo(b)
  const ax = b.clone().sub(a).normalize()
  const t = new THREE.Vector3().crossVectors(ax, new THREE.Vector3(0.3, 0.1, 1)).normalize()
  const s = new THREE.Vector3().crossVectors(ax, t)
  const n = Math.ceil(L / 0.15)
  for (let i = 0; i <= n; i++) {
    const k = i / n
    const ang = i * 1.745 // 100° per residue
    const p = a.clone().lerp(b, k).addScaledVector(t, Math.cos(ang) * 0.23).addScaledVector(s, Math.sin(ang) * 0.23)
    out.push([p.x, p.y, p.z, r * 0.62])
  }
  return out
}
function glob(c: THREE.Vector3, R: number, n: number, seed: number): Ball[] {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const out: Ball[] = []
  for (let i = 0; i < n; i++) {
    const d = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(R * Math.cbrt(rnd()) * 0.8)
    out.push([c.x + d.x, c.y + d.y, c.z + d.z, R * (0.35 + rnd() * 0.25)])
  }
  return out
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/* ---------------------------------------------------------------- material */
function protMat(color: THREE.Color, opts: { alpha?: number } = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.DoubleSide,
    transparent: (opts.alpha ?? 1) < 1,
    depthWrite: (opts.alpha ?? 1) >= 1,
    uniforms: {
      uTime: U.uTime,
      uColor: { value: color },
      uHi: { value: 0 },
      uClipZ: { value: 1e4 },
      uAlpha: { value: opts.alpha ?? 1 },
      uPaper: U.uPaper,
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      out vec3 vN; out vec3 vV; out vec3 vWP;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWP = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vN = normalize(mat3(modelViewMatrix) * normal);
        vV = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      layout(location=0) out vec4 o;
      ${HASH}${NOISE}
      uniform vec3 uColor; uniform float uHi, uClipZ, uAlpha, uTime, uPaper, uFade;
      in vec3 vN; in vec3 vV; in vec3 vWP;
      void main(){
        if (vWP.z > uClipZ) discard;
        vec3 n = normalize(vN);
        vec3 v = normalize(-vV);
        bool back = !gl_FrontFacing;
        if (back) n = -n;
        vec3 L = normalize(vec3(-0.4, 0.8, 0.6));
        float dif = max(dot(n, L), 0.0);
        float wrap = max(dot(n, L) * 0.5 + 0.5, 0.0);
        float rim = pow(1.0 - max(dot(n, v), 0.0), 2.2);
        // molecular-surface grain
        float g = gnoise(vWP * 2.6) * 0.5 + 0.5;
        vec3 c = uColor * (0.18 + 0.55 * wrap + 0.25 * dif) * (0.85 + 0.3 * g);
        c += uColor * rim * (1.3 + uHi * 2.0) + vec3(1.0) * pow(rim, 5.0) * 0.4;
        c *= 1.0 + uHi * 0.9 * (0.6 + 0.4 * sin(uTime * 3.0));
        if (back) c = uColor * 0.12 + vec3(0.02);    // the cut face: we are looking inside
        c *= exp(-max(0.0, length(vV) - 34.0) * 0.016) * uFade;
        o = vec4(c * uAlpha, mix(uAlpha, 0.8, uPaper));
      }`,
  })
}

const col = (h: string) => new THREE.Color(h).convertSRGBToLinear().multiplyScalar(1.4)

/* ---------------------------------------------------------------- builders */
function channelSubunit(): THREE.BufferGeometry {
  // K⁺-channel-like: an outer and an inner helix leaning to form an inverted
  // teepee, with the selectivity filter (a short pore helix) near the top
  const b: Ball[] = []
  b.push(...helix(V(2.1, -2.6, 0.2), V(1.5, 2.6, 0.3), 0.55))
  b.push(...helix(V(0.75, -2.7, -0.2), V(1.3, 2.3, -0.4), 0.55))
  b.push(...helix(V(1.2, 0.6, 0.6), V(0.7, 1.7, 0.2), 0.4))
  b.push(...glob(V(1.6, 3.0, 0.2), 0.8, 7, 3))
  b.push(...glob(V(1.7, -3.1, 0.0), 0.7, 5, 9))
  return blob(b)
}

function ring6(cx: number, cz: number, R: number): Ball[] {
  const b: Ball[] = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3
    const t = a + 0.5
    b.push(...helix(V(cx + Math.cos(a) * R, -2.5, cz + Math.sin(a) * R), V(cx + Math.cos(t) * R, 2.5, cz + Math.sin(t) * R), 0.55))
  }
  return b
}

function aquaporin(): THREE.BufferGeometry {
  const b: Ball[] = []
  for (const [x, z] of [[-1.45, -1.45], [1.45, -1.45], [-1.45, 1.45], [1.45, 1.45]]) {
    b.push(...ring6(x, z, 1.05))
    b.push(...glob(V(x, 2.8, z), 0.7, 4, Math.round(x * 7 + z * 13 + 50)))
    b.push(...glob(V(x, -2.8, z), 0.7, 4, Math.round(x * 3 + z * 5 + 80)))
  }
  return blob(b)
}

function carrierHalf(side: number, n: number): THREE.BufferGeometry {
  // one half of a major-facilitator-like carrier: a bundle of n helices
  const b: Ball[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI - Math.PI / 2
    const x = side * (1.1 + Math.cos(a) * 1.3)
    const z = Math.sin(a) * 1.8
    b.push(...helix(V(x + side * 0.2, -2.7, z), V(x - side * 0.25, 2.7, z + 0.3), 0.55))
  }
  b.push(...glob(V(side * 1.8, -3.2, 0), 0.9, 6, side > 0 ? 17 : 23))
  return blob(b)
}

function pumpParts() {
  // Na⁺/K⁺-ATPase: α subunit (transmembrane halves; A, N and P domains in the
  // cytoplasm) and the β subunit with its glycosylated outer domain
  const tmL = (() => {
    const b: Ball[] = []
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI - Math.PI / 2
      b.push(...helix(V(-1.3 - Math.cos(a) * 1.5, -2.8, Math.sin(a) * 2), V(-1.0 - Math.cos(a) * 1.5, 2.8, Math.sin(a) * 2 + 0.2), 0.55))
    }
    b.push(...glob(V(-1.6, 3.1, 0), 0.9, 5, 3))
    return blob(b)
  })()
  const tmR = (() => {
    const b: Ball[] = []
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI - Math.PI / 2
      b.push(...helix(V(1.3 + Math.cos(a) * 1.5, -2.8, Math.sin(a) * 2), V(1.0 + Math.cos(a) * 1.5, 2.8, Math.sin(a) * 2 - 0.2), 0.55))
    }
    b.push(...glob(V(1.6, 3.1, 0.3), 0.8, 5, 7))
    return blob(b)
  })()
  const P = blob([...glob(V(0, 0, 0), 1.9, 16, 31), ...helix(V(0, 1.2, 0), V(0.3, 3.0, 0), 0.6)])
  const N = blob(glob(V(0, 0, 0), 1.9, 16, 37))
  const A = blob(glob(V(0, 0, 0), 1.6, 12, 41))
  const beta = blob([...helix(V(0, -2.7, 0), V(0.2, 2.8, 0), 0.55), ...glob(V(0.2, 4.2, 0), 1.5, 12, 43)])
  return { tmL, tmR, P, N, A, beta }
}

function synthaseParts() {
  const cSub = blob([...helix(V(0, -2.6, 0), V(0, 2.6, 0.1), 0.5), ...helix(V(0.75, 2.6, 0), V(0.75, -2.6, 0.1), 0.5), [0.35, 2.9, 0, 0.5]])
  const stator = blob([...ring6(0, 0, 0.9).slice(0, 80), ...helix(V(0.2, -2.6, 0.2), V(0.1, 2.6, 0), 0.6), ...helix(V(0.4, -3.0, 0), V(-0.4, -13, 0.4), 0.45), ...glob(V(-0.6, -14.2, 0), 1.2, 6, 5)])
  const gamma = blob([...helix(V(0, -2.2, 0), V(0.1, -11.5, 0), 0.8), ...glob(V(0, -3.2, 0), 1.2, 6, 13)])
  const alpha = blob(glob(V(0, 0, 0), 1.7, 16, 51))
  const beta = blob(glob(V(0, 0, 0), 1.65, 16, 53))
  return { cSub, stator, gamma, alpha, beta }
}

function glycoprotein(seed: number): THREE.BufferGeometry {
  return blob([...helix(V(0, -2.8, 0), V(0.2, 2.6, 0), 0.55), ...glob(V(0.2, 4.3, 0), 1.6, 12, seed), ...glob(V(0, -3.4, 0), 0.7, 4, seed + 2)])
}

function cd4(): THREE.BufferGeometry {
  // a single pass, then four immunoglobulin-like domains end to end (~12 nm)
  const b: Ball[] = [...helix(V(0, -2.8, 0), V(0, 2.8, 0), 0.55)]
  for (let i = 0; i < 4; i++) b.push(...glob(V(Math.sin(i) * 0.4, 4.0 + i * 2.4, 0), 1.15, 8, 70 + i))
  return blob(b)
}

/* sugar trees: branched chains of 2–60 monosaccharides (drawn 3–14) */
function sugarTree(root: THREE.Vector3, n: number, seed: number): THREE.Vector3[] {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const out: THREE.Vector3[] = [root.clone()]
  for (let i = 1; i < n; i++) {
    const parent = out[Math.floor(rnd() * Math.min(out.length, 1 + i * 0.6))]
    out.push(parent.clone().add(V((rnd() - 0.5) * 0.9, 0.38 + rnd() * 0.3, (rnd() - 0.5) * 0.9)))
  }
  return out
}
function beads(points: THREE.Vector3[], r = 0.24) {
  const base = new THREE.IcosahedronGeometry(r, 1)
  const list = points.map((p) => base.clone().translate(p.x, p.y, p.z))
  const arr = new Float32Array(list.reduce((s, g) => s + g.attributes.position.count * 3, 0))
  const nor = new Float32Array(arr.length)
  let o = 0
  for (const g of list) {
    arr.set(g.attributes.position.array as Float32Array, o)
    nor.set(g.attributes.normal.array as Float32Array, o)
    o += g.attributes.position.count * 3
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return g
}

/* ================================================================ the set */
export type Protein = { group: THREE.Group; mats: THREE.ShaderMaterial[]; r: number; name: string }

export function buildProteins() {
  const root = new THREE.Group()
  const list: Protein[] = []
  const sugarMat = protMat(col('#8dff7a'))
  const add = (name: string, r: number, parts: [THREE.BufferGeometry, THREE.ShaderMaterial][]) => {
    const group = new THREE.Group()
    const mats: THREE.ShaderMaterial[] = []
    for (const [g, m] of parts) {
      const mesh = new THREE.Mesh(g, m)
      mesh.frustumCulled = false
      group.add(mesh)
      if (!mats.includes(m)) mats.push(m)
    }
    root.add(group)
    const p = { group, mats, r, name }
    list.push(p)
    return p
  }

  /* channel: four subunits round a pore */
  const chanMat = protMat(col('#ff4fa3'))
  const chanSub = channelSubunit()
  const channel = add('channel', 3.1, [])
  const chanSubs: THREE.Group[] = []
  for (let i = 0; i < 4; i++) {
    const hinge = new THREE.Group()
    hinge.rotation.y = (i / 4) * Math.PI * 2 + Math.PI / 4
    const tilt = new THREE.Group()
    tilt.position.set(0, 1.2, 0)
    const m = new THREE.Mesh(chanSub, chanMat)
    m.position.set(0, -1.2, 0)
    m.frustumCulled = false
    tilt.add(m)
    hinge.add(tilt)
    channel.group.add(hinge)
    chanSubs.push(tilt)
  }
  channel.mats.push(chanMat)

  const aqp = add('aquaporin', 3.6, [[aquaporin(), protMat(col('#3fb6ff'))]])

  const carMat = protMat(col('#b77bff'))
  const carrier = add('carrier', 3.2, [])
  const carL = new THREE.Mesh(carrierHalf(-1, 6), carMat)
  const carR = new THREE.Mesh(carrierHalf(1, 6), carMat)
  carL.frustumCulled = carR.frustumCulled = false
  carrier.group.add(carL, carR)
  carrier.mats.push(carMat)

  const symMat = protMat(col('#ffb347'))
  const sym = add('symporter', 3.2, [])
  const symL = new THREE.Mesh(carrierHalf(-1, 7), symMat)
  const symR = new THREE.Mesh(carrierHalf(1, 7), symMat)
  symL.frustumCulled = symR.frustumCulled = false
  sym.group.add(symL, symR)
  sym.mats.push(symMat)

  /* Na⁺/K⁺ pump */
  const pp = pumpParts()
  const pumpMat = protMat(col('#e05cff'))
  const pumpCyt = protMat(col('#c98bff'))
  const betaMat = protMat(col('#ff9fd8'))
  const pump = add('pump', 4.2, [])
  const pL = new THREE.Mesh(pp.tmL, pumpMat)
  const pR = new THREE.Mesh(pp.tmR, pumpMat)
  const pP = new THREE.Mesh(pp.P, pumpCyt)
  const pN = new THREE.Mesh(pp.N, pumpCyt)
  const pA = new THREE.Mesh(pp.A, pumpCyt)
  const pB = new THREE.Mesh(pp.beta, betaMat)
  pB.position.set(3.7, 0, 1.6)
  const pSug = new THREE.Mesh(beads(sugarTree(V(3.9, 5.6, 1.6), 9, 5)), sugarMat)
  for (const m of [pL, pR, pP, pN, pA, pB, pSug]) ((m.frustumCulled = false), pump.group.add(m))
  pump.mats.push(pumpMat, pumpCyt, betaMat, sugarMat)

  /* ATP synthase (inner mitochondrial membrane) */
  const sp = synthaseParts()
  const synMat = protMat(col('#ff7b54'))
  const synA = protMat(col('#ffd36b'))
  const synB = protMat(col('#ff9b6b'))
  const synth = add('synthase', 3.6, [])
  const rotor = new THREE.Group()
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(sp.cSub, synMat)
    const a = (i / 10) * Math.PI * 2
    m.position.set(Math.cos(a) * 2.4, 0, Math.sin(a) * 2.4)
    m.rotation.y = -a
    m.frustumCulled = false
    rotor.add(m)
  }
  const gam = new THREE.Mesh(sp.gamma, synB)
  gam.frustumCulled = false
  rotor.add(gam)
  const stator = new THREE.Mesh(sp.stator, synB)
  stator.position.set(3.8, 0, 0)
  stator.frustumCulled = false
  const head = new THREE.Group()
  head.position.set(0, -10.8, 0)
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(i % 2 ? sp.beta : sp.alpha, i % 2 ? synB : synA)
    const a = (i / 6) * Math.PI * 2
    m.position.set(Math.cos(a) * 2.3, 0, Math.sin(a) * 2.3)
    m.frustumCulled = false
    head.add(m)
  }
  synth.group.add(rotor, stator, head)
  synth.mats.push(synMat, synA, synB)

  /* glycoproteins, peripheral proteins, CD4 */
  const gpMat = protMat(col('#ff6f91'))
  const glyco: Protein[] = []
  const GP = [
    [-20, -18], [21, 20], [-8, -22], [3, 9],
  ]
  GP.forEach(([x, z], i) => {
    const p = add('glycoprotein', 1.6, [[glycoprotein(100 + i * 7), gpMat], [beads(sugarTree(V(0.2, 5.6, 0), 7 + i * 3, 11 + i)), sugarMat]])
    p.group.position.set(x, 0, z)
    glyco.push(p)
  })
  const perMat = protMat(col('#ffe36e'))
  const peri: THREE.Mesh[] = []
  const PERI: [number, number, number][] = [
    [-11, -3.6, -6], [-3, -3.6, 15], [10, -3.7, -12], [17, 3.6, 7], [-24, -3.6, 8],
  ]
  PERI.forEach(([x, y, z], i) => {
    const m = new THREE.Mesh(blob(glob(V(0, 0, 0), 1.5, 12, 200 + i * 5)), perMat)
    m.position.set(x, y, z)
    m.frustumCulled = false
    root.add(m)
    peri.push(m)
  })
  const cd4m = add('cd4', 1.2, [[cd4(), protMat(col('#ff8a3d'))]])
  cd4m.group.position.set(2, 0, 3)

  /* HIV: a patch of its envelope, studded with gp120/gp41 spikes */
  const hiv = new THREE.Group()
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(50, 12), protMat(col('#4de1c1'), { alpha: 0.55 }))
  shell.frustumCulled = false
  hiv.add(shell)
  const spikeG = blob([...glob(V(-0.9, 1.4, 0), 1.3, 7, 91), ...glob(V(0.9, 1.4, 0.3), 1.3, 7, 93), ...glob(V(0, 1.4, -1.1), 1.3, 7, 97), ...helix(V(0, -1.5, 0), V(0, 0.6, 0), 0.9)])
  const spikeM = protMat(col('#b8ffe9'))
  const spikeDirs: THREE.Vector3[] = []
  for (let i = 0; i < 90; i++) {
    const y = 1 - (2 * (i + 0.5)) / 90
    const rr = Math.sqrt(1 - y * y)
    spikeDirs.push(V(Math.cos(i * 2.4) * rr, y, Math.sin(i * 2.4) * rr))
  }
  spikeDirs.push(V(0, -1, 0))
  for (const d of spikeDirs) {
    const m = new THREE.Mesh(spikeG, spikeM)
    m.position.copy(d).multiplyScalar(51.5)
    m.quaternion.setFromUnitVectors(V(0, 1, 0), d)
    m.frustumCulled = false
    hiv.add(m)
  }
  root.add(hiv)

  /* ------------------------------------------------------------ layout */
  const MOSAIC: Record<string, [number, number]> = {
    channel: [-14, -8], aquaporin: [16, 4], carrier: [-4, 16], symporter: [12, -24], pump: [8, -14], synthase: [-22, -20],
  }
  const STAGE_FAC: Record<string, [number, number]> = {
    channel: [-15, 20], aquaporin: [-2, 18.8], carrier: [11, 20], symporter: [12, -24], pump: [8, -14], synthase: [-22, -20],
  }
  const STAGE_ACT: Record<string, [number, number]> = {
    channel: [-14, -8], aquaporin: [16, 4], carrier: [-4, 8], symporter: [-11, 20], pump: [2, 20], synthase: [15, 18],
  }
  const tmp = V(0, 0, 0)
  const at = (name: string, F: number) => {
    const a = MOSAIC[name]
    const b = STAGE_FAC[name]
    const c = STAGE_ACT[name]
    const s1 = smooth(7.0, 7.1, F) * (1 - smooth(10.0, 10.12, F))
    const s2 = smooth(10.0, 10.12, F)
    let x = lerp(a[0], b[0], s1)
    let z = lerp(a[1], b[1], s1)
    x = lerp(x, c[0], s2)
    z = lerp(z, c[1], s2)
    // the pump yields the stage to the symporter pair, then to ATP synthase
    if (name === 'pump') {
      const k = smooth(11.0, 11.1, F)
      x = lerp(x, 4.5, k)
    }
    return tmp.set(x, 0, z)
  }

  const footprints: THREE.Vector4[] = Array.from({ length: MAXP }, () => new THREE.Vector4())
  const allMats = new Set<THREE.ShaderMaterial>()
  list.forEach((p) => p.mats.forEach((m) => allMats.add(m)))
  allMats.add(perMat)
  allMats.add(spikeM)
  allMats.add(shell.material as THREE.ShaderMaterial)

  function update(_dt: number, carrierRock: number, symRock: number) {
    const F = film.F
    const time = U.uTime.value
    const clipOn = smooth(7.0, 7.08, F)
    const clipZ = lerp(1e4, 20.25, clipOn)
    for (const m of allMats) m.uniforms.uClipZ.value = clipZ
    // the HIV envelope is not in the cut
    ;(shell.material as THREE.ShaderMaterial).uniforms.uClipZ.value = 1e4
    spikeM.uniforms.uClipZ.value = 1e4

    for (const name of Object.keys(MOSAIC)) {
      const p = list.find((q) => q.name === name)!
      p.group.position.copy(at(name, F))
    }
    // visibility: the synthase and symporter only for cotransport; everything fades for the self-assembly
    const assembly = band(4.25, 4.35, 4.9, 4.97, F)
    const vis = (p: Protein, v: number) => {
      p.group.visible = v > 0.01
      p.mats.forEach((m) => (m.uniforms.uFade.value = v))
    }
    const base = 1 - assembly
    list.forEach((p) => vis(p, base * (1 - film.solo)))
    vis(synth, base * smooth(11.45, 11.55, F) * (1 - smooth(12.05, 12.1, F)))
    vis(sym, base * smooth(11.0, 11.08, F))
    peri.forEach((m) => (m.visible = base > 0.01 && F < 7.02 && film.solo < 0.02))
    const cd4v = band(6.6, 6.68, 6.93, 6.99, F)
    vis(cd4m, cd4v)

    // highlights
    const hi = film.protHi
    list.forEach((p) => p.mats.forEach((m) => (m.uniforms.uHi.value = 0)))
    chanMat.uniforms.uHi.value = Math.max(hi * 0.5, band(8.28, 8.33, 8.66, 8.72, F) * 0.4)
    carMat.uniforms.uHi.value = hi * 0.5
    pumpMat.uniforms.uHi.value = hi * 0.5
    aqp.mats[0].uniforms.uHi.value = band(8.05, 8.1, 8.26, 8.3, F) * 0.5 + band(9.05, 9.1, 9.25, 9.3, F) * 0.4
    carMat.uniforms.uHi.value = Math.max(carMat.uniforms.uHi.value, band(8.68, 8.74, 8.98, 9.0, F) * 0.4)
    gpMat.uniforms.uHi.value = band(6.5, 6.55, 6.62, 6.66, F) * 0.6
    perMat.uniforms.uHi.value = band(6.04, 6.1, 6.26, 6.3, F) * 0.8

    // channel gate: the inner bundle opens
    chanSubs.forEach((t) => (t.rotation.z = film.gate * 0.22))
    // carrier and symporter: alternating access
    const rock = (L: THREE.Mesh, R: THREE.Mesh, v: number) => {
      L.rotation.z = v * 0.16
      R.rotation.z = -v * 0.16
    }
    rock(carL, carR, carrierRock)
    rock(symL, symR, symRock)

    // Na⁺/K⁺ pump conformations, keyed to the six steps
    const s = film.pumpStep
    const out = smooth(2.0, 3.0, s) * (1 - smooth(4.0, 5.0, s)) // E2: open to the outside
    rock(pL as any, pR as any, 0)
    pL.rotation.z = lerp(-0.12, 0.14, out)
    pR.rotation.z = lerp(0.12, -0.14, out)
    const nSwing = smooth(1.0, 1.6, s) * (1 - smooth(3.6, 4.2, s)) // N domain delivers ATP to P
    pP.position.set(0.6, -5.2, 0.2)
    pN.position.set(lerp(3.6, 2.3, nSwing), lerp(-6.4, -6.0, nSwing), 0.4)
    pN.rotation.z = nSwing * 0.5
    pA.position.set(lerp(-3.0, -2.3, out), lerp(-5.0, -5.4, out), -0.4)
    pA.rotation.y = out * 1.2

    // ATP synthase: the rotor turns one c-subunit per proton
    rotor.rotation.y = film.mol === 'co' ? SYN_W * Math.max(0, film.tau - SYN_T0) + time * 0.05 * film.synthase : 0

    // HIV descends onto CD4
    const h = film.hiv
    hiv.visible = h > 0.001
    hiv.position.set(2.3, lerp(150, 67.8, smooth(0, 0.8, h)) + Math.sin(time * 0.6) * 0.3 * h, 3)
    hiv.rotation.y = time * 0.01
    ;(shell.material as THREE.ShaderMaterial).uniforms.uFade.value = clamp01(h * 1.5)
    spikeM.uniforms.uFade.value = clamp01(h * 1.5)

    // footprints for the lipids
    let k = 0
    const push = (x: number, z: number, r: number, on: boolean) => {
      if (k < MAXP) footprints[k++].set(x, z, r, on ? 1 : 0)
    }
    for (const p of list) {
      const on = p.group.visible && (p.name !== 'cd4' || cd4v > 0.3)
      if (p.name === 'cd4') {
        push(p.group.position.x, p.group.position.z, 0.9, on)
        continue
      }
      const extra = p.name === 'pump' ? V(3.7, 0, 1.6) : null
      push(p.group.position.x, p.group.position.z, p.r, on)
      if (extra) push(p.group.position.x + extra.x, p.group.position.z + extra.z, 1.0, on)
      if (p.name === 'synthase') push(p.group.position.x + 3.8, p.group.position.z, 1.4, on)
    }
    while (k < MAXP) footprints[k++].set(0, 0, 0, 0)
  }

  const where = (name: string) => list.find((q) => q.name === name)!.group.position
  return { root, update, footprints, where, glyco, peri }
}
