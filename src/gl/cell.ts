import * as THREE from 'three'
import { HASH, NOISE } from './glsl'
import { U } from './uniforms'

/* ==========================================================================
   THE CELL — 262 144 points, 1 unit = 1 µm, drawn like a multi-channel
   fluorescence micrograph: every organelle in its own dye colour.

   Each point has a home on one structure. Everything that moves is
   computed in the vertex shader from time and the point's own attributes,
   so the cell is stateless: scrolling back reverses it exactly. Vesicles
   bud from the ER, pass through the Golgi and fuse with the plasma
   membrane; mitochondria drift; microtubules flicker with dynamic
   instability; the cursor pushes the cytoplasm aside.
   ========================================================================== */

export const N = 512 * 512

/* tags */
export const T = {
  PM: 0, NE: 1, CHROM: 2, RER: 3, SER: 4, GOLGI: 5, MITO: 6, LYSO: 7, VES: 8, MT: 9, ACTIN: 10, IF: 11, HAZE: 12, CENT: 13,
} as const

/* fluorescence palette, linear RGB, deliberately saturated */
const COLORS: [number, number, number][] = [
  [0.55, 0.95, 1.0], // PM · cyan membrane dye
  [0.25, 0.42, 1.0], // nuclear envelope · blue
  [0.18, 0.26, 0.95], // chromatin · DAPI
  [0.25, 1.0, 0.45], // rough ER · green
  [0.45, 0.95, 0.75], // smooth ER · mint
  [1.0, 0.66, 0.18], // Golgi · amber
  [1.0, 0.22, 0.52], // mitochondria · magenta
  [1.0, 0.3, 0.2], // lysosomes · red
  [1.0, 0.92, 0.6], // vesicles · warm white
  [0.78, 1.0, 0.3], // microtubules · yellow-green
  [1.0, 0.42, 0.18], // actin · orange
  [0.72, 0.45, 1.0], // intermediate filaments · violet
  [0.35, 0.45, 0.6], // cytosol · dim
  [1.0, 1.0, 1.0], // centrioles
]

const R_CELL = 10
export const NUC = new THREE.Vector3(-1.4, 0.2, -0.6)
const NUC_R = new THREE.Vector3(4.3, 3.7, 3.9)
export const GOLGI = new THREE.Vector3(5.0, 2.3, 1.4)
export const CENTRO = new THREE.Vector3(3.3, -0.4, 2.2)

/* anchors for the in-place labels */
export const ANCHORS: Record<string, THREE.Vector3> = {}

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

export function buildCell() {
  const r = rng(11)
  const pos = new Float32Array(N * 3)
  const info = new Float32Array(N * 4) // tag, seed, a, b
  const aux = new Float32Array(N * 3) // vesicle end point / fibre direction
  let n = 0
  const put = (x: number, y: number, z: number, tag: number, a = 0, b = 0) => {
    if (n >= N) return false
    pos[n * 3] = x
    pos[n * 3 + 1] = y
    pos[n * 3 + 2] = z
    info[n * 4] = tag
    info[n * 4 + 1] = r()
    info[n * 4 + 2] = a
    info[n * 4 + 3] = b
    n++
    return true
  }
  const v = new THREE.Vector3()
  const dir = () => {
    const u = r() * 2 - 1
    const t = r() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    return v.set(s * Math.cos(t), u, s * Math.sin(t))
  }
  const gauss = () => (r() + r() + r() - 1.5) * 0.8
  const nucDir = GOLGI.clone().sub(NUC).normalize()

  /* nucleus: double envelope with pores, the lamina beneath, chromatin */
  const pores: THREE.Vector3[] = []
  for (let i = 0; i < 60; i++) pores.push(dir().clone())
  const nearPore = (d: THREE.Vector3) => pores.some((p) => p.dot(d) > 0.9985)
  for (let i = 0; i < 24000; i++) {
    const d = dir()
    const s = r() < 0.5 ? 1.0 : 1.055
    if (nearPore(d)) {
      // nuclear pore complex: a bright ring bridging both membranes
      const p = pores.find((q) => q.dot(d) > 0.9985)!
      const t = new THREE.Vector3().crossVectors(p, Math.abs(p.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize()
      const b = new THREE.Vector3().crossVectors(p, t)
      const a = r() * Math.PI * 2
      const q = p.clone().multiplyScalar(1.028).addScaledVector(t, Math.cos(a) * 0.035).addScaledVector(b, Math.sin(a) * 0.035)
      put(NUC.x + q.x * NUC_R.x, NUC.y + q.y * NUC_R.y, NUC.z + q.z * NUC_R.z, T.NE, 1)
      continue
    }
    put(NUC.x + d.x * NUC_R.x * s, NUC.y + d.y * NUC_R.y * s, NUC.z + d.z * NUC_R.z * s, T.NE)
  }
  ANCHORS.pore = NUC.clone().add(new THREE.Vector3(pores[3].x * NUC_R.x, pores[3].y * NUC_R.y, pores[3].z * NUC_R.z).multiplyScalar(1.03))
  ANCHORS.nucleus = NUC.clone().add(new THREE.Vector3(-0.8, NUC_R.y * 1.02, 0.6))
  // lamina: intermediate filaments lining the inner envelope
  for (let i = 0; i < 3000; i++) {
    const d = dir()
    put(NUC.x + d.x * NUC_R.x * 0.975, NUC.y + d.y * NUC_R.y * 0.975, NUC.z + d.z * NUC_R.z * 0.975, T.IF, 0.5)
  }
  // chromatin: clumped, with a dense nucleolus
  const nucleolus = NUC.clone().add(new THREE.Vector3(0.9, 0.7, 0.5))
  ANCHORS.nucleolus = nucleolus.clone()
  for (let i = 0; i < 14000; i++) {
    if (i < 4500) {
      const d = dir()
      const rr = 1.15 * Math.cbrt(r())
      put(nucleolus.x + d.x * rr, nucleolus.y + d.y * rr, nucleolus.z + d.z * rr, T.CHROM, 1)
    } else {
      // chromatin threads: random walks
      if (i % 300 === 4500 % 300 || i === 4500) v.set(gauss() * 2.5, gauss() * 2.2, gauss() * 2.2)
      const d = dir().multiplyScalar(0.09)
      const c = new THREE.Vector3(gauss() * 2.4, gauss() * 2.1, gauss() * 2.1)
      c.multiplyScalar(Math.min(1, 1 / Math.max(0.01, Math.hypot(c.x / 3.6, c.y / 3.1, c.z / 3.3))))
      put(NUC.x + c.x + d.x, NUC.y + c.y + d.y, NUC.z + c.z + d.z, T.CHROM)
    }
  }

  /* rough ER: flattened sacs wrapping the nucleus, continuous with its outer
     membrane, studded with ribosomes */
  const sheets = [1.18, 1.34, 1.5, 1.66]
  let rer = 0
  while (rer < 40000) {
    const d = dir()
    const k = Math.floor(r() * sheets.length)
    const s = sheets[k] + 0.03 * Math.sin(d.x * 9 + k) * Math.cos(d.z * 7)
    // sacs are patchy; none on the Golgi side (that is where the traffic goes)
    const patch = Math.sin(d.x * 5.1 + k * 1.7) * Math.sin(d.y * 4.3 - k) * Math.sin(d.z * 5.7 + k * 0.6)
    if (patch < -0.12 || d.dot(nucDir) > 0.55) continue
    const layer = r() < 0.5 ? -0.028 : 0.028
    const rib = r() < 0.16
    const ss = s + layer + (rib ? 0.06 * Math.sign(layer) : 0)
    const x = NUC.x + d.x * NUC_R.x * ss
    const y = NUC.y + d.y * NUC_R.y * ss
    const z = NUC.z + d.z * NUC_R.z * ss
    if (Math.hypot(x, y, z) > R_CELL - 0.6) continue
    put(x, y, z, T.RER, rib ? 1 : 0)
    rer++
  }
  ANCHORS.rer = NUC.clone().add(new THREE.Vector3(-NUC_R.x * 1.45, -0.6, 1.8))

  /* smooth ER: a tubular net further out */
  for (let t = 0; t < 26; t++) {
    const a = dir().clone().multiplyScalar(-1).lerp(nucDir.clone().multiplyScalar(-1), 0.4).normalize()
    const p0 = NUC.clone().addScaledVector(a, 6.6 + r() * 1.2)
    const b = dir().clone().multiplyScalar(2.6)
    const c = dir().clone().multiplyScalar(2.2)
    for (let i = 0; i < 540; i++) {
      const s = i / 540
      const p = p0.clone().addScaledVector(b, Math.sin(s * 3.1)).addScaledVector(c, s * s - s)
      if (p.length() > R_CELL - 0.5) continue
      const j = dir().multiplyScalar(0.07)
      put(p.x + j.x, p.y + j.y, p.z + j.z, T.SER)
    }
    if (t === 5) ANCHORS.ser = p0.clone()
  }

  /* Golgi: a stack of curved cisternae facing the nucleus (cis) */
  const gz = nucDir.clone()
  const gx = new THREE.Vector3().crossVectors(gz, new THREE.Vector3(0, 1, 0)).normalize()
  const gy = new THREE.Vector3().crossVectors(gx, gz)
  const cis = 6
  for (let c = 0; c < cis; c++) {
    const rad = 2.1 - c * 0.14 + (c === 0 ? 0.1 : 0)
    for (let i = 0; i < 3000; i++) {
      const a = r() * Math.PI * 2
      const rr = rad * Math.sqrt(r())
      const x = Math.cos(a) * rr
      const y = Math.sin(a) * rr * 0.55
      const bow = -0.22 * (x * x + y * y) // curved toward the nucleus
      const rim = rr / rad > 0.9 ? 0.07 : 0.028
      const lay = (r() < 0.5 ? -1 : 1) * rim
      const p = GOLGI.clone().addScaledVector(gx, x).addScaledVector(gy, y).addScaledVector(gz, c * 0.3 + bow + lay)
      put(p.x, p.y, p.z, T.GOLGI, c / (cis - 1))
    }
  }
  // buds at the rims
  for (let b = 0; b < 26; b++) {
    const a = r() * Math.PI * 2
    const c = GOLGI.clone().addScaledVector(gx, Math.cos(a) * 2.2).addScaledVector(gy, Math.sin(a) * 1.25).addScaledVector(gz, r() * 1.6)
    for (let i = 0; i < 90; i++) {
      const d = dir().multiplyScalar(0.14)
      put(c.x + d.x, c.y + d.y, c.z + d.z, T.GOLGI, 0.5)
    }
  }
  ANCHORS.golgi = GOLGI.clone().addScaledVector(gy, 1.3).addScaledVector(gz, 1.0)
  ANCHORS.cis = GOLGI.clone().addScaledVector(gx, -2.1)
  ANCHORS.trans = GOLGI.clone().addScaledVector(gx, 1.9).addScaledVector(gz, 1.5)

  /* mitochondria: capsules with inner folds (cristae) */
  const mitos: THREE.Vector3[] = []
  let guard = 0
  while (mitos.length < 13 && guard++ < 400) {
    const c = dir().clone().multiplyScalar(5.6 + r() * 2.4)
    if (c.distanceTo(GOLGI) < 3.2 || c.clone().sub(NUC).length() < 5.6 || mitos.some((m) => m.distanceTo(c) < 2.6)) continue
    mitos.push(c)
  }
  mitos.forEach((c, id) => {
    const ax = dir().clone()
    const tx = new THREE.Vector3().crossVectors(ax, new THREE.Vector3(0.3, 1, 0.1)).normalize()
    const ty = new THREE.Vector3().crossVectors(ax, tx)
    const L = 0.9 + r() * 0.8
    const R = 0.42
    for (let i = 0; i < 2000; i++) {
      const outer = i < 1150
      if (outer) {
        // capsule surface, a double membrane
        const s = (r() * 2 - 1) * (L + R)
        const a = r() * Math.PI * 2
        const cl = Math.max(-L, Math.min(L, s))
        const cap = Math.abs(s) > L ? Math.sqrt(Math.max(0, 1 - ((Math.abs(s) - L) / R) ** 2)) : 1
        const rr = R * cap * (r() < 0.5 ? 1 : 0.9)
        const p = c.clone().addScaledVector(ax, s).addScaledVector(tx, Math.cos(a) * rr).addScaledVector(ty, Math.sin(a) * rr)
        void cl
        put(p.x, p.y, p.z, T.MITO, id)
      } else {
        // cristae: folds of the inner membrane reaching across the matrix
        const k = Math.floor(r() * 7)
        const s = -L + ((k + 0.5) / 7) * 2 * L
        const a = r() * Math.PI * 2
        const rr = R * 0.86 * Math.sqrt(r())
        const side = Math.cos(a) * rr
        if (side > R * 0.35) continue
        const p = c.clone().addScaledVector(ax, s + 0.05 * Math.sin(a * 3)).addScaledVector(tx, side).addScaledVector(ty, Math.sin(a) * rr)
        put(p.x, p.y, p.z, T.MITO, id)
      }
    }
  })
  ANCHORS.mito = mitos[0].clone()

  /* lysosomes */
  const lysos: THREE.Vector3[] = []
  for (let i = 0; i < 11; i++) {
    const c = dir().clone().multiplyScalar(4.8 + r() * 3.6)
    if (c.clone().sub(NUC).length() < 5.2) {
      i--
      continue
    }
    lysos.push(c)
    const R = 0.28 + r() * 0.25
    for (let k = 0; k < 520; k++) {
      const d = dir().multiplyScalar(R * Math.cbrt(r()))
      put(c.x + d.x, c.y + d.y, c.z + d.z, T.LYSO)
    }
  }
  ANCHORS.lyso = lysos[0].clone()

  /* vesicles: pos holds the local offset; aux holds the membrane target */
  const nv = 44
  for (let k = 0; k < nv; k++) {
    // exit site on the ER facing the Golgi, fusion site on the plasma membrane
    const end = nucDir.clone().add(dir().clone().multiplyScalar(0.75)).normalize().multiplyScalar(R_CELL * 0.985)
    const R = 0.17 + r() * 0.07
    for (let i = 0; i < 180; i++) {
      const d = dir().multiplyScalar(R)
      if (put(d.x, d.y, d.z, T.VES, k / nv, R)) {
        aux[(n - 1) * 3] = end.x
        aux[(n - 1) * 3 + 1] = end.y
        aux[(n - 1) * 3 + 2] = end.z
      }
    }
  }

  /* microtubules radiate from the centrosome, beside the nucleus */
  for (let i = 0; i < 9; i++) {
    // centrioles: two barrels of nine triplets, at right angles
    for (const o of [0, 1]) {
      const a = (i / 9) * Math.PI * 2
      for (let k = 0; k < 40; k++) {
        const h = (r() - 0.5) * 0.45
        const x = Math.cos(a) * 0.11
        const y = Math.sin(a) * 0.11
        const p = o === 0 ? new THREE.Vector3(x, y, h) : new THREE.Vector3(h, x, y + 0.25)
        put(CENTRO.x + p.x, CENTRO.y + p.y, CENTRO.z + p.z, T.CENT)
      }
    }
  }
  ANCHORS.centrosome = CENTRO.clone()
  for (let m = 0; m < 80; m++) {
    const end = dir().clone().multiplyScalar(R_CELL * 0.95)
    const ctrl = CENTRO.clone().lerp(end, 0.5).add(dir().clone().multiplyScalar(1.4))
    // route around the nucleus rather than through it
    const toN = ctrl.clone().sub(NUC)
    if (toN.length() < 5.2) ctrl.copy(NUC).addScaledVector(toN.normalize(), 5.4)
    const cnt = 220
    for (let i = 0; i < cnt; i++) {
      const s = i / cnt
      const a = CENTRO.clone().multiplyScalar((1 - s) * (1 - s)).addScaledVector(ctrl, 2 * s * (1 - s)).addScaledVector(end, s * s)
      const q = a.clone().sub(NUC)
      if (Math.hypot(q.x / NUC_R.x, q.y / NUC_R.y, q.z / NUC_R.z) < 1.1) continue
      const j = dir().multiplyScalar(0.025)
      put(a.x + j.x, a.y + j.y, a.z + j.z, T.MT, s, m / 80)
    }
    if (m === 6) ANCHORS.mt = CENTRO.clone().lerp(end, 0.62)
  }

  /* actin: a dense cortex just beneath the membrane */
  for (let f = 0; f < 700; f++) {
    const p0 = dir().clone().multiplyScalar(R_CELL * (0.93 + r() * 0.05))
    const t = new THREE.Vector3().crossVectors(p0, dir()).normalize()
    const L = 0.6 + r() * 2.0
    for (let i = 0; i < 22; i++) {
      const p = p0.clone().addScaledVector(t, ((i / 22) - 0.5) * L)
      p.setLength(R_CELL * 0.95 + (r() - 0.5) * 0.12)
      put(p.x, p.y, p.z, T.ACTIN)
    }
  }
  ANCHORS.actin = new THREE.Vector3(-6.6, -7.2, 1.2).setLength(R_CELL * 0.95)

  /* intermediate filaments: long wavy ropes, nucleus → membrane */
  for (let f = 0; f < 42; f++) {
    const a = NUC.clone().add(dir().clone().multiplyScalar(4.2))
    const b = dir().clone().multiplyScalar(R_CELL * 0.94)
    const w = dir().clone().multiplyScalar(1.3)
    for (let i = 0; i < 230; i++) {
      const s = i / 230
      const p = a.clone().lerp(b, s).addScaledVector(w, Math.sin(s * 9 + f)).add(new THREE.Vector3(0, Math.sin(s * 13 + f * 2) * 0.3, 0))
      const q = p.clone().sub(NUC)
      if (Math.hypot(q.x / NUC_R.x, q.y / NUC_R.y, q.z / NUC_R.z) < 1.08 || p.length() > R_CELL * 0.96) continue
      put(p.x, p.y, p.z, T.IF, 0)
    }
    if (f === 2) ANCHORS.ifil = a.clone().lerp(b, 0.62)
  }

  /* the plasma membrane: what is left, minus a little cytosol haze */
  const rest = N - n - 9000
  for (let i = 0; i < rest; i++) {
    const d = dir()
    const w = 1 + 0.012 * Math.sin(d.x * 7) * Math.sin(d.y * 6 + 1) * Math.sin(d.z * 8)
    const rr = R_CELL * w * (1 + (r() - 0.5) * 0.004)
    put(d.x * rr, d.y * rr, d.z * rr, T.PM)
  }
  ANCHORS.pm = new THREE.Vector3(9.55, 1.9, 3.2).setLength(R_CELL)
  while (n < N) {
    const d = dir().multiplyScalar(R_CELL * 0.92 * Math.cbrt(r()))
    const q = d.clone().sub(NUC)
    if (Math.hypot(q.x / NUC_R.x, q.y / NUC_R.y, q.z / NUC_R.z) < 1.1) continue
    put(d.x, d.y, d.z, T.HAZE)
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4))
  g.setAttribute('aAux', new THREE.BufferAttribute(aux, 3))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 80)

  const colors = COLORS.map((c) => new THREE.Vector3(...c))
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: U.uTime,
      uCol: { value: colors },
      uAssemble: { value: 0 },
      uOrg: { value: 1 },
      uCyto: { value: 0.1 },
      uVes: { value: 0 },
      uMem: { value: 0.5 },
      uFocus: { value: 30 },
      uPx: { value: 1 },
      uRayO: U.uRayO,
      uRayD: U.uRayD,
      uMouseF: U.uMouseF,
      uAlpha: { value: 1 },
      uGolgi: { value: GOLGI },
      uNuc: { value: NUC },
      uNucDir: { value: nucDir },
    },
    vertexShader: /* glsl */ `
      ${HASH}${NOISE}
      uniform float uTime, uAssemble, uOrg, uCyto, uVes, uMem, uFocus, uPx, uMouseF, uAlpha;
      uniform vec3 uCol[14];
      uniform vec3 uRayO, uRayD, uGolgi, uNuc, uNucDir;
      in vec4 aInfo;
      in vec3 aAux;
      out vec3 vCol;
      out float vA;
      out float vBlur;

      vec3 bez(vec3 a, vec3 b, vec3 c, float t){ return mix(mix(a,b,t), mix(b,c,t), t); }

      void main(){
        int tag = int(aInfo.x + 0.5);
        float seed = aInfo.y;
        vec3 p = position;
        float gain = 1.0;
        float size = 1.0;

        if (tag == 8) {
          // a vesicle's life: ER exit site → cis Golgi → through the stack → trans → plasma membrane
          float k = aInfo.z;
          float t = fract(uTime * 0.045 + k * 7.13);
          vec3 exitER = uNuc + uNucDir * 5.9 + vec3(sin(k*40.0), cos(k*23.0), sin(k*17.0)) * 1.4;
          vec3 cisF = uGolgi - uNucDir * 0.4 + vec3(sin(k*9.0), cos(k*13.0), 0.0) * 0.7;
          vec3 transF = uGolgi + uNucDir * 2.0 + vec3(cos(k*11.0), sin(k*7.0), 0.0) * 0.9;
          vec3 c;
          if (t < 0.3) c = mix(exitER, cisF, smoothstep(0.0, 0.3, t));
          else if (t < 0.5) c = mix(cisF, transF, smoothstep(0.3, 0.5, t));
          else c = bez(transF, mix(transF, aAux, 0.5) + vec3(0.0, 1.2, 0.0) * sin(k*30.0), aAux, smoothstep(0.5, 0.97, t));
          // bud and fuse: the vesicle appears at the ER, flattens into the membrane
          float life = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.93, 1.0, t));
          p = c + position * mix(0.3, 1.0, life);
          gain = life * (0.35 + 1.4 * uVes);
          size = 1.0 + uVes * 0.6;
        } else if (tag == 6) {
          // mitochondria drift and flex
          float id = aInfo.z;
          p += vec3(gnoise(vec3(id, uTime*0.08, 1.0)), gnoise(vec3(id, uTime*0.08, 7.0)), gnoise(vec3(id, uTime*0.08, 13.0))) * 0.35;
        } else if (tag == 9) {
          // dynamic instability: bright tips grow and shrink along each microtubule
          float front = fract(uTime * 0.05 + aInfo.w * 3.7);
          gain *= 0.55 + 0.9 * smoothstep(0.1, 0.0, abs(aInfo.z - front));
        } else if (tag == 12) {
          p += vec3(gnoise(vec3(p*0.7 + uTime*0.1)), gnoise(vec3(p*0.7 + 31.0 - uTime*0.1)), gnoise(vec3(p*0.7 + 71.0))) * 0.3;
        } else if (tag == 0) {
          float w = gnoise(vec3(p * 0.35 + vec3(0.0, uTime * 0.15, 0.0)));
          p *= 1.0 + 0.006 * w;
        }

        /* channel gains: organelles vs cytoskeleton vs membrane */
        bool isCyto = (tag == 9 || tag == 10 || tag == 11 || tag == 13);
        if (tag == 0) gain *= uMem;
        else if (isCyto) gain *= uCyto * (aInfo.z > 0.4 && tag == 11 ? 1.0 : 1.0);
        else if (tag == 12) gain *= 0.5 * uOrg;
        else if (tag != 8) gain *= uOrg;

        /* scattered ↔ assembled: each point finds home on its own cue */
        vec3 h = hash33(vec3(seed * 91.0, float(tag), seed * 17.0)) * 2.0 - 1.0;
        vec3 scat = normalize(h + 1e-4) * (14.0 + 30.0 * fract(seed * 13.7));
        scat += vec3(gnoise(vec3(scat*0.05 + uTime*0.05)), gnoise(vec3(scat*0.05 + 9.0)), gnoise(vec3(scat*0.05 - uTime*0.04))) * 4.0;
        float a = clamp(uAssemble * 1.45 - seed * 0.45, 0.0, 1.0);
        a = a * a * (3.0 - 2.0 * a);
        p = mix(scat, p, a);
        gain *= mix(0.12, 1.0, a);

        /* the cursor clears a hole through the cytoplasm */
        vec3 op = p - uRayO;
        float along = dot(op, uRayD);
        vec3 perp = op - uRayD * along;
        float d = length(perp);
        p += normalize(perp + 1e-5) * exp(-d*d / 3.0) * 1.6 * uMouseF;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        // depth of field: out-of-focus points grow and dim, like a confocal stack
        float blur = clamp(abs(dist - uFocus) / uFocus * 1.1 - 0.08, 0.0, 1.0);
        vBlur = blur;
        float px = (1.6 + blur * 4.0) * size * uPx * (26.0 / dist);
        gl_PointSize = clamp(px, 1.0, 22.0);
        vCol = uCol[tag];
        vA = gain * uAlpha * (0.5 + 0.4 * fract(seed * 7.1)) / (1.0 + blur * 2.2);
        if (tag == 3 && aInfo.z > 0.5) vA *= 2.0; // ribosomes are bright specks
        if (tag == 2 && aInfo.z > 0.5) vA *= 1.6;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      layout(location=0) out vec4 o;
      in vec3 vCol; in float vA; in float vBlur;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c);
        float disk = mix(smoothstep(0.5, 0.0, r), smoothstep(0.5, 0.42, r) * 0.7 + 0.3 * smoothstep(0.5, 0.0, r), vBlur);
        if (disk < 0.01) discard;
        o = vec4(vCol * vA * disk, vA * disk * 0.3);
      }`,
  })
  const points = new THREE.Points(g, mat)
  points.frustumCulled = false
  return { points, mat }
}
