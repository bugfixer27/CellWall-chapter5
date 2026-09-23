import * as THREE from 'three'
import { HASH, NOISE } from './glsl'
import { U } from './uniforms'

/* ==========================================================================
   THE BILAYER — 1 unit = 1 nm.
   A 60 × 60 nm patch: two leaflets of phospholipids, one instance each
   (a head and two fatty-acid tails; one tail in three carries a cis double
   bond and its ~30° kink), cholesterol tucked between them, and sugar chains
   on the outer leaflet's glycolipids. Outside the cell is +y.

   The lipids drift in a smooth, correlated flow field, so neighbours move
   together (a 2-D liquid) without passing through one another. Temperature
   sets how far they wander and how disordered the tails are. Every lipid
   also knows two other homes, scattered in water and assembled into a
   micelle or a liposome, for the self-assembly sequence.
   ========================================================================== */

export const PATCH = 30 // half-width, nm
export const HEAD_Y = 2.25
const SP = 0.84 // lipid spacing, nm (≈ 0.7 nm² per lipid)
export const MAXP = 16 // protein footprints

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

/* shared: lateral flow of the liquid membrane */
export const DRIFT = /* glsl */ `
uniform float uFluid, uTime, uFlowT;
vec2 drift(vec2 xz){
  float t = uFlowT * 0.12;
  vec2 d = vec2(gnoise(vec3(xz * 0.09, t)), gnoise(vec3(xz * 0.09 + 19.0, t + 5.0))) * 2.4;
  d += vec2(gnoise(vec3(xz * 0.3, t * 2.3 + 3.0)), gnoise(vec3(xz * 0.3 + 7.0, t * 2.3))) * 0.35;
  // the patch keeps a straight edge: flow fades out near its border
  float e = smoothstep(${PATCH.toFixed(1)}, ${(PATCH - 4).toFixed(1)}, max(abs(xz.x), abs(xz.y)));
  return d * uFluid * e;
}
`

function lipidGeometry() {
  // head: an icosphere; tails: two tubes, each tagged with its part and position along it
  const parts: THREE.BufferGeometry[] = []
  const head = new THREE.IcosahedronGeometry(0.42, 1)
  const hp = head.attributes.position.count
  head.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(hp * 2).fill(0), 2))
  parts.push(head.index ? head.toNonIndexed() : head)
  for (const side of [0, 1]) {
    const tube = new THREE.CylinderGeometry(0.15, 0.13, 1.8, 5, 7, false)
    tube.translate(0, -0.9 - 0.32, 0)
    const n = tube.attributes.position.count
    const a = new Float32Array(n * 2)
    const P = tube.attributes.position
    for (let i = 0; i < n; i++) {
      P.setX(i, P.getX(i) + (side ? 0.2 : -0.2))
      a[i * 2] = 1 + side
      a[i * 2 + 1] = Math.min(1, Math.max(0, (-P.getY(i) - 0.32) / 1.8))
    }
    tube.setAttribute('aPart', new THREE.BufferAttribute(a, 2))
    parts.push(tube.index ? tube.toNonIndexed() : tube)
  }
  return mergeGeoms(parts)
}

function cholGeometry() {
  // the hydroxyl (small head), four fused rings (a stiff plate), a short tail
  const parts: THREE.BufferGeometry[] = []
  const oh = new THREE.IcosahedronGeometry(0.17, 1)
  oh.translate(0, -0.3, 0)
  const ring = new THREE.BoxGeometry(0.5, 0.95, 0.2, 1, 3, 1)
  ring.translate(0, -0.95, 0)
  const tail = new THREE.CylinderGeometry(0.09, 0.07, 0.6, 5, 2)
  tail.translate(0, -1.72, 0)
  for (const [g, part] of [[oh, 0], [ring, 3], [tail, 3]] as const) {
    const n = g.attributes.position.count
    const a = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) ((a[i * 2] = part), (a[i * 2 + 1] = 0))
    g.setAttribute('aPart', new THREE.BufferAttribute(a, 2))
    parts.push(g.index ? g.toNonIndexed() : g)
  }
  return mergeGeoms(parts)
}

export function mergeGeoms(list: THREE.BufferGeometry[]) {
  const names = Object.keys(list[0].attributes).filter((k) => list.every((g) => g.attributes[k]))
  const out = new THREE.BufferGeometry()
  for (const name of names) {
    const size = list[0].attributes[name].itemSize
    const total = list.reduce((s, g) => s + g.attributes[name].count, 0)
    const arr = new Float32Array(total * size)
    let o = 0
    for (const g of list) {
      arr.set(g.attributes[name].array as Float32Array, o)
      o += g.attributes[name].count * size
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size))
  }
  return out
}

const VERT_COMMON = /* glsl */ `
${HASH}${NOISE}${DRIFT}
uniform float uState, uTemp, uCut, uSolo, uHideChol;
uniform vec2 uSoloXZ;
uniform vec4 uProt[${MAXP}];
in vec2 aPart;
in vec4 aBase;   // x, z, leaflet (±1), kind (0 lipid · 1 cholesterol)
in vec4 aSeed;   // seed, unsaturated, glyco, 0
in vec4 aScat;   // scattered: head position xyz, (w unused)
in vec3 aScatD;
in vec4 aAsm;    // assembled: head position xyz, w = 1 for liposome/sheet
in vec3 aAsmD;
out vec3 vN;
out vec3 vW;
out float vPart;
out float vT;
out float vUnsat;
out float vLeaf;
out float vVis;
out float vSeed;

vec3 rotAxis(vec3 p, vec3 ax, float a){ return mix(dot(ax,p)*ax, p, cos(a)) + cross(ax,p)*sin(a); }

/* where this molecule's head is and which way it points, for state s */
void place(out vec3 hp, out vec3 hd, out float vis){
  vec2 xz = aBase.xy;
  vec2 dxz = xz + drift(xz);
  float leaf = aBase.z;
  // the gel phase packs a little tighter: cold membranes shrink laterally
  float cold = 1.0 - smoothstep(4.0, 30.0, uTemp);
  dxz *= 1.0 - 0.03 * cold;
  // thermal bobbing of each lipid in and out of the plane
  float bob = gnoise(vec3(xz * 1.7, uFlowT * 0.9 + aSeed.x * 10.0)) * 0.18 * uFluid;
  vec3 bil = vec3(dxz.x, leaf * (${HEAD_Y.toFixed(2)} + bob), dxz.y);
  vec3 bd = vec3(0.0, leaf, 0.0);
  vis = 1.0;
  // holes where proteins sit
  for (int i = 0; i < ${MAXP}; i++) {
    vec4 q = uProt[i];
    if (q.w < 0.5) continue;
    float d = length(dxz - q.xy);
    vis *= smoothstep(q.z - 0.3, q.z + 0.35, d);
  }
  // cut-away: the patch ends at z = edge so the cross-section shows
  float edge = mix(${PATCH.toFixed(1)} + 1.0, 20.3, uCut);
  vis *= step(dxz.y, edge);
  float s = uState;
  vec3 sp = aScat.xyz + vec3(gnoise(vec3(aScat.xyz*0.2 + uTime*0.2)), gnoise(vec3(aScat.xyz*0.2 + 3.0)), gnoise(vec3(aScat.xyz*0.2 - uTime*0.2))) * 1.2;
  vec3 sd = normalize(aScatD + 0.4 * vec3(sin(uTime*0.7 + aSeed.x*30.0), cos(uTime*0.6 + aSeed.x*20.0), 0.0));
  if (s <= 0.0) { hp = bil; hd = bd; }
  else if (s < 1.0) { float k = clamp(s * 1.4 - aSeed.x * 0.4, 0.0, 1.0); hp = mix(bil, sp, k); hd = normalize(mix(bd, sd, k) + 1e-4); vis = mix(vis, 1.0, k); }
  else if (s < 2.0) { float k = clamp((s - 1.0) * 1.4 - aSeed.x * 0.4, 0.0, 1.0); hp = mix(sp, aAsm.xyz, k); hd = normalize(mix(sd, aAsmD, k) + 1e-4); }
  else { float k = clamp((s - 2.0) * 1.4 - aSeed.x * 0.4, 0.0, 1.0); hp = mix(aAsm.xyz, bil, k); hd = normalize(mix(aAsmD, bd, k) + 1e-4); vis = mix(1.0, vis, k); }
  // one phospholipid alone, for its portrait
  float me = step(length(xz - uSoloXZ), 0.05) * step(0.0, leaf);
  vis *= mix(1.0, me, uSolo);
}

/* orthonormal frame with local +y = head direction */
mat3 frameOf(vec3 d, float spin){
  vec3 up = abs(d.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 x = normalize(cross(up, d));
  vec3 z = cross(x, d);
  float c = cos(spin), s = sin(spin);
  vec3 x2 = x * c + z * s;
  vec3 z2 = -x * s + z * c;
  return mat3(x2, d, z2);
}
`

export const SAMPLES = { chol: new THREE.Vector3(), gly: new THREE.Vector3(), head: new THREE.Vector3() }
const uniformsSolo = new THREE.Vector2()
export const SOLO = uniformsSolo
export function buildBilayer() {
  const r = rng(5)
  const side = Math.floor((PATCH * 2) / SP)
  const cells: { x: number; z: number; leaf: number; kind: number; unsat: number; gly: number; seed: number }[] = []
  for (const leaf of [1, -1])
    for (let j = 0; j < side; j++)
      for (let i = 0; i < side; i++) {
        const x = -PATCH + (i + 0.5 + (j % 2) * 0.5) * SP + (r() - 0.5) * 0.18
        const z = -PATCH + (j + 0.5) * SP * 0.93 + (r() - 0.5) * 0.18
        if (Math.abs(x) > PATCH || Math.abs(z) > PATCH) continue
        const kind = r() < 0.13 ? 1 : 0
        const unsat = r() < 0.4 ? 1 : 0
        // glycolipids only on the outer leaflet
        const gly = leaf > 0 && kind === 0 && r() < 0.018 ? 1 : 0
        cells.push({ x, z, leaf, kind, unsat, gly, seed: r() })
      }

  /* self-assembly homes (Fig 5.4): a liposome, micelles, a bilayer sheet */
  const nL = cells.length
  const asmPos = new Float32Array(nL * 4)
  const asmDir = new Float32Array(nL * 3)
  const scat = new Float32Array(nL * 4)
  const scatD = new Float32Array(nL * 3)
  const order = cells.map((_, i) => i).sort(() => r() - 0.5)
  const fib = (k: number, n: number) => {
    const y = 1 - (2 * (k + 0.5)) / n
    const rr = Math.sqrt(1 - y * y)
    const th = k * 2.39996
    return new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr)
  }
  const LIPO = new THREE.Vector3(-13, 1, -2)
  const Ro = 11.2
  const Ri = 6.8
  const nOut = Math.round((4 * Math.PI * Ro * Ro) / 0.62)
  const nIn = Math.round((4 * Math.PI * Ri * Ri) / 0.62)
  let k = 0
  const set = (idx: number, p: THREE.Vector3, d: THREE.Vector3, w = 1) => {
    asmPos.set([p.x, p.y, p.z, w], idx * 4)
    asmDir.set([d.x, d.y, d.z], idx * 3)
  }
  for (let i = 0; i < nOut && k < nL; i++, k++) {
    const d = fib(i, nOut)
    set(order[k], LIPO.clone().addScaledVector(d, Ro), d)
  }
  for (let i = 0; i < nIn && k < nL; i++, k++) {
    const d = fib(i, nIn)
    set(order[k], LIPO.clone().addScaledVector(d, Ri), d.clone().negate())
  }
  // micelles: single layer, heads out
  const micelles: THREE.Vector3[] = []
  for (let m = 0; m < 34; m++) micelles.push(new THREE.Vector3(4 + (m % 6) * 4.4 + (r() - 0.5), 9 - Math.floor(m / 6) * 4.4 + (r() - 0.5), -4 + (r() - 0.5) * 8))
  const perM = 58
  for (let m = 0; m < micelles.length; m++)
    for (let i = 0; i < perM && k < nL; i++, k++) {
      const d = fib(i, perM)
      set(order[k], micelles[m].clone().addScaledVector(d, 2.05), d)
    }
  // the rest: a free bilayer sheet (its edges would be exposed to water, so in
  // reality such a sheet curls up and seals into a vesicle)
  while (k < nL) {
    const idx = order[k++]
    const c = cells[idx]
    const x = -2 + ((c.x + PATCH) / (2 * PATCH)) * 30 + 0
    const z = -12 + ((c.z + PATCH) / (2 * PATCH)) * 8
    const sheetY = -16
    const bend = 0.012 * (x - 13) ** 2
    const d = new THREE.Vector3(0, c.leaf, 0)
    set(idx, new THREE.Vector3(x * 0.95, sheetY + bend + c.leaf * 2.25, z), d, 1)
  }
  for (let i = 0; i < nL; i++) {
    scat.set([(r() - 0.5) * 64, (r() - 0.5) * 36, (r() - 0.5) * 30, 0], i * 4)
    const d = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize()
    scatD.set([d.x, d.y, d.z], i * 3)
  }

  let solo = 0
  let best = 1e9
  cells.forEach((c, i) => {
    const d = Math.hypot(c.x, c.z)
    if (c.leaf > 0 && c.kind === 0 && c.unsat && !c.gly && d < best) ((best = d), (solo = i))
  })
  uniformsSolo.set(cells[solo].x, cells[solo].z)
  const near = (pred: (c: (typeof cells)[number]) => boolean, x: number, z: number) => {
    let bi = 0, bd = 1e9
    cells.forEach((c, i) => {
      const d = Math.hypot(c.x - x, c.z - z)
      if (pred(c) && d < bd) ((bd = d), (bi = i))
    })
    return cells[bi]
  }
  const ch = near((c) => c.kind === 1 && c.leaf > 0, -9, 12)
  SAMPLES.chol.set(ch.x, HEAD_Y - 0.6, ch.z)
  const gy = near((c) => c.gly === 1, 8, 12)
  SAMPLES.gly.set(gy.x, HEAD_Y + 1.6, gy.z)
  SAMPLES.head.set(-6, HEAD_Y + 0.4, 12)
  const base = new Float32Array(nL * 4)
  const seed = new Float32Array(nL * 4)
  cells.forEach((c, i) => {
    base.set([c.x, c.z, c.leaf, c.kind], i * 4)
    seed.set([c.seed, c.unsat, c.gly, 0], i * 4)
  })

  const inst = (geo: THREE.BufferGeometry) => {
    const g = new THREE.InstancedBufferGeometry()
    for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.attributes[k])
    g.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 4))
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
    g.setAttribute('aScat', new THREE.InstancedBufferAttribute(scat, 4))
    g.setAttribute('aScatD', new THREE.InstancedBufferAttribute(scatD, 3))
    g.setAttribute('aAsm', new THREE.InstancedBufferAttribute(asmPos, 4))
    g.setAttribute('aAsmD', new THREE.InstancedBufferAttribute(asmDir, 3))
    g.instanceCount = nL
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200)
    return g
  }

  const uniforms = {
    uTime: U.uTime,
    uFluid: { value: 1 },
    uFlowT: { value: 0 },
    uSoloXZ: { value: uniformsSolo },
    uState: { value: 0 },
    uTemp: { value: 37 },
    uCut: { value: 0 },
    uSolo: { value: 0 },
    uHideChol: { value: 0 },
    uProt: { value: Array.from({ length: MAXP }, () => new THREE.Vector4()) },
    uUnsatHi: { value: 0 },
    uCholHi: { value: 0 },
    uPaper: U.uPaper,
    uFogC: { value: new THREE.Vector3(0, 0, 0) },
  }

  const mk = (isChol: boolean) =>
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: /* glsl */ `
        ${VERT_COMMON}
        void main(){
          vec3 hp, hd; float vis;
          place(hp, hd, vis);
          bool chol = aBase.w > 0.5;
          ${isChol ? 'if (!chol) vis = 0.0; vis *= 1.0 - uHideChol;' : 'if (chol) vis = 0.0;'}
          vec3 p = position;
          vec3 nrm = normal;
          float part = aPart.x;
          float t = aPart.y;
          vT = t;
          ${
            isChol
              ? ''
              : /* glsl */ `
          if (part > 0.5) {
            // the cis double bond: past it, the tail bends ~30°
            float kinked = aSeed.y * step(1.5, part);
            if (kinked > 0.5 && t > 0.45) {
              vec3 piv = vec3(0.2, -0.32 - 0.45 * 1.8, 0.0);
              p = piv + rotAxis(p - piv, vec3(0.0, 0.0, 1.0), 0.52);
              nrm = rotAxis(nrm, vec3(0.0, 0.0, 1.0), 0.52);
            }
            // chain disorder: warm tails wriggle, cold (gel) tails lie straight and parallel
            float dis = smoothstep(2.0, 40.0, uTemp) * 0.9 + 0.1;
            float w = gnoise(vec3(aBase.xy * 3.0 + part * 11.0, uTime * 2.2 + t * 2.5)) * t * 0.55 * dis;
            p.x += w;
            p.z += gnoise(vec3(aBase.yx * 3.0 - part * 5.0, uTime * 1.9 - t * 2.0)) * t * 0.45 * dis;
          }`
          }
          mat3 F = frameOf(hd, aSeed.x * 6.283 + ${isChol ? '0.0' : 'gnoise(vec3(aBase.xy, uFlowT*0.3))*1.5'});
          vec3 w = hp + F * (p * vis);
          vN = normalize(F * nrm);
          vPart = part;
          vUnsat = aSeed.y;
          vLeaf = aBase.z;
          vVis = vis;
          vSeed = aSeed.x;
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          vW = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        layout(location=0) out vec4 o;
        uniform float uUnsatHi, uCholHi, uPaper, uTemp;
        in vec3 vN; in vec3 vW; in float vPart; in float vT; in float vUnsat; in float vLeaf; in float vVis; in float vSeed;
        void main(){
          if (vVis < 0.02) discard;
          vec3 n = normalize(vN);
          vec3 v = normalize(-vW);
          vec3 L = normalize(vec3(-0.4, 0.8, 0.5));
          float dif = max(dot(n, L), 0.0) * 0.8 + 0.2;
          float rim = pow(1.0 - max(dot(n, v), 0.0), 2.5);
          vec3 c;
          ${
            isChol
              ? /* glsl */ `
          // cholesterol: a stiff, pale plate
          c = vPart < 0.5 ? vec3(1.0, 0.95, 0.9) * 1.4 : vec3(0.95, 0.9, 1.0) * 0.55;
          c *= 1.0 + uCholHi * 2.2;
          c += vec3(1.0, 0.9, 0.7) * rim * (0.4 + uCholHi * 2.0);`
              : /* glsl */ `
          if (vPart < 0.5) {
            // hydrophilic heads: bright; the outer leaflet cooler than the inner (membranes are asymmetric)
            c = vLeaf > 0.0 ? vec3(0.35, 0.85, 1.0) : vec3(0.3, 0.55, 1.0);
            c *= 1.05 + 0.25 * fract(vSeed * 13.0);
            c += vec3(0.6, 0.9, 1.0) * rim * 1.1;
          } else {
            // hydrophobic tails: warm, dim, glowing toward their ends
            c = mix(vec3(0.9, 0.52, 0.16), vec3(0.55, 0.25, 0.1), vT) * 0.55;
            float kinkHi = vUnsat * uUnsatHi;
            c = mix(c, vec3(1.0, 0.85, 0.35) * 1.6, kinkHi * step(1.5, vPart) * smoothstep(0.3, 0.55, vT));
            c *= 1.0 - 0.35 * uUnsatHi * (1.0 - vUnsat);
            c += vec3(1.0, 0.6, 0.25) * rim * 0.35;
            // cold tails lose their glow a little
            c *= mix(0.75, 1.0, smoothstep(2.0, 30.0, uTemp));
          }`
          }
          c *= dif;
          // depth: far lipids fade into the dark
          float fog = exp(-max(0.0, length(vW) - 30.0) * 0.018);
          c *= fog;
          o = vec4(c, mix(0.0, vPart < 0.5 ? 0.25 : 0.62, uPaper));
        }`,
    })

  const lipids = new THREE.Mesh(inst(lipidGeometry()), mk(false))
  const chol = new THREE.Mesh(inst(cholGeometry()), mk(true))
  lipids.frustumCulled = chol.frustumCulled = false

  /* glycolipid sugars: a short chain of beads on each glycolipid's head */
  const gl: number[] = []
  const gOff: number[] = []
  cells.forEach((c) => {
    if (!c.gly) return
    const n = 2 + Math.floor(r() * 6)
    let p = new THREE.Vector3(0, 0.5, 0)
    for (let i = 0; i < n; i++) {
      p = p.clone().add(new THREE.Vector3((r() - 0.5) * 0.5, 0.42, (r() - 0.5) * 0.5))
      gl.push(c.x, c.z, 0, 0)
      gOff.push(p.x, p.y, p.z, i / n)
    }
  })
  const bead = new THREE.IcosahedronGeometry(0.22, 1)
  const bg = new THREE.InstancedBufferGeometry()
  bg.setAttribute('position', bead.attributes.position)
  bg.setAttribute('normal', bead.attributes.normal)
  bg.setIndex(bead.index)
  bg.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(gl), 4))
  bg.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(gOff), 4))
  bg.instanceCount = gl.length / 4
  const sugarMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...uniforms, uSugar: { value: 1 } },
    vertexShader: /* glsl */ `
      ${HASH}${NOISE}${DRIFT}
      uniform float uState, uSugar, uCut, uSolo;
      in vec4 aBase; in vec4 aOff;
      out vec3 vN; out vec3 vW; out float vK;
      void main(){
        vec2 dxz = aBase.xy + drift(aBase.xy);
        vec3 sway = vec3(gnoise(vec3(aBase.xy, uTime*0.5)), 0.0, gnoise(vec3(aBase.yx, uTime*0.5))) * aOff.w * 0.6;
        vec3 w = vec3(dxz.x, ${HEAD_Y.toFixed(2)}, dxz.y) + aOff.xyz + sway;
        float vis = uSugar * (1.0 - step(0.01, uState)) * (1.0 - step(0.02, uSolo)) * step(dxz.y, mix(${(PATCH + 1).toFixed(1)}, 20.3, uCut));
        vec4 mv = modelViewMatrix * vec4(w + position * vis, 1.0);
        vN = normalize(normalMatrix * normal);
        vW = mv.xyz;
        vK = aOff.w;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      layout(location=0) out vec4 o;
      in vec3 vN; in vec3 vW; in float vK;
      void main(){
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(-vW))), 2.0);
        vec3 c = mix(vec3(0.5, 1.0, 0.55), vec3(0.95, 1.0, 0.5), vK) * (0.5 + rim * 1.6);
        c *= exp(-max(0.0, length(vW) - 30.0) * 0.018);
        o = vec4(c, 0.3);
      }`,
  })
  const sugars = new THREE.Mesh(bg, sugarMat)
  sugars.frustumCulled = false

  const group = new THREE.Group()
  group.add(lipids, chol, sugars)
  return { group, uniforms, sugarMat, count: nL }
}
