import * as THREE from 'three'
import { film, smooth, clamp01, lerp, LAND, LAND_IN, LAND_OUT } from '../core/film'
import { ION, V_REST, dGout, SYM_GLU } from '../science/membrane'
import { U } from './uniforms'

/* ==========================================================================
   THE LANDSCAPE — the electrochemical gradient drawn as terrain.
   It begins as the membrane itself: the side-on picture of the bilayer
   (outside above, cytoplasm below) stands upright, filling the frame
   exactly as the membrane did, then tips back to become the ground. The
   top of the picture, outside the cell, ends up at the back; the cytoplasm
   in front; the bilayer runs across the middle.

   Then the ground rises. Height is free energy per mole of ion: an ion
   outside sits as high above the same ion inside as the energy it would
   release by crossing, from the concentrations and the membrane potential
   (src/science). Anything that rolls downhill is passive; carrying it up
   takes a pump.

   Two lanes, one per ion, side by side: Na⁺ (gold) and K⁺ (violet), which
   becomes glucose (cream) for cotransport.
   ========================================================================== */

const L = LAND.L
const WF = 38 // width of the terrain once it has risen
const K_E = 1.05 // height units per kJ mol⁻¹
const GAP = 1.5 // half-width of the gap between the lanes
const R_ION = 0.7
const C_NA = new THREE.Color('#ffc64a')
const C_K = new THREE.Color('#b18cff')
const C_GLU = new THREE.Color('#fff0c8')

/** heights of the outside (back) relative to the inside (front), per lane */
export function landHeights() {
  const vm = V_REST * film.landVolt
  const na = dGout(ION.Na.out, ION.Na.in, 1, vm)
  const k = dGout(ION.K.out, ION.K.in, 1, vm)
  const glu = -SYM_GLU
  return { na, k, glu, h0: na * K_E, h1: lerp(k, glu, film.landCo) * K_E }
}

const VERT = /* glsl */ `
uniform float uTilt, uRise, uW, uH0, uH1;
out vec2 vUv;
out float vH;
out float vX;
out vec3 vW;
const float L = ${L.toFixed(1)};
const float WF = ${WF.toFixed(1)};
float prof(float v){ return smoothstep(0.4, 0.6, v); }
void main(){
  vUv = uv;
  float width = mix(uW, WF, uRise);
  float x = (uv.x - 0.5) * width;
  float th = (1.0 - uTilt) * 1.5707963;
  float hOut = x < 0.0 ? uH0 : uH1;
  // a gentle roll on the plateaus, so they read as ground
  float h = (hOut * prof(uv.y) + 0.25 * sin(x * 0.35 + uv.y * 7.0) * sin(uv.y * 11.0 - x * 0.2)) * uRise;
  vec3 p = vec3(x, uv.y * L * sin(th), -uv.y * L * cos(th)) + vec3(0.0, cos(th), sin(th)) * h;
  vH = h;
  vX = x;
  vW = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;
layout(location=0) out vec4 o;
uniform sampler2D uPhoto;
uniform float uRise, uPhotoOn, uCo, uTime;
uniform vec3 uC0, uC1, uC2;
in vec2 vUv;
in float vH;
in float vX;
in vec3 vW;
float line(float v, float w){ float d = abs(fract(v - 0.5) - 0.5); return 1.0 - smoothstep(0.0, fwidth(v) * w, d); }
void main(){
  if (uRise > 0.02 && abs(vX) < ${GAP.toFixed(2)} * uRise) discard;
  vec3 photo = uPhotoOn > 0.5 ? texture(uPhoto, vUv).rgb : vec3(0.0);
  vec3 lane = vX < 0.0 ? uC0 : mix(uC1, uC2, uCo);
  // contours of equal free energy, and a grid across the ground
  float c = line(vH / 1.1, 1.3);
  float g = max(line(vW.x / 4.0, 1.0), line(vW.z / 4.0, 1.0));
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  float lit = clamp(dot(n, normalize(vec3(-0.3, 0.9, 0.4))), 0.0, 1.0);
  float slope = 1.0 - abs(n.y);
  vec3 ground = lane * (0.05 + 0.1 * lit + 0.85 * c + 0.16 * g) + lane * slope * 0.35;
  // the cliff between the plateaus is the membrane: the picture of it stays there
  float mem = smoothstep(0.34, 0.4, vUv.y) * smoothstep(0.66, 0.6, vUv.y);
  ground = mix(ground, photo * 1.15 + lane * 0.08, mem * 0.9);
  // edges fade into the dark
  float edge = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x) * smoothstep(1.0, 0.94, vUv.y) * smoothstep(0.0, 0.03, vUv.y);
  ground *= mix(1.0, edge, uRise);
  o = vec4(mix(photo, ground, uRise), 1.0);
}
`

const BALL_VERT = /* glsl */ `

out vec3 vC;
out vec3 vN;
out vec3 vV;
void main(){
  vC = instanceColor;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vV = cameraPosition - w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const BALL_FRAG = /* glsl */ `
precision highp float;
layout(location=0) out vec4 o;
in vec3 vC; in vec3 vN; in vec3 vV;
void main(){
  float f = 1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  vec3 c = vC * (0.55 + 0.6 * pow(f, 1.5)) + vC * pow(f, 4.0) * 1.5;
  o = vec4(c * 1.4, 1.0);
}
`

type Ball = { lane: 0 | 1; kind: 'na' | 'k' | 'glu'; u: number; v: number; ph: number }

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

export class Land {
  scene = new THREE.Scene()
  mat: THREE.ShaderMaterial
  balls: THREE.InstancedMesh
  gate: THREE.Mesh
  tether: THREE.Mesh
  list: Ball[] = []
  aspect = 1.6
  /** how many pump cycles and symporter cycles have completed, for the instruments */
  pumped = 0
  cotransported = 0
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      uniforms: {
        uPhoto: { value: null }, uPhotoOn: { value: 0 }, uTilt: { value: 0 }, uRise: { value: 0 }, uW: { value: L * 1.6 },
        uH0: { value: 0 }, uH1: { value: 0 }, uCo: { value: 0 }, uTime: U.uTime,
        uC0: { value: C_NA.clone() }, uC1: { value: C_K.clone() }, uC2: { value: C_GLU.clone() },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 220, 160), this.mat)
    terrain.frustumCulled = false
    this.scene.add(terrain)

    // the ions: Na⁺ crowded outside, K⁺ crowded inside, and glucose waiting in the wings
    const r = rng(5)
    const add = (lane: 0 | 1, kind: Ball['kind'], n: number, v0: number, v1: number) => {
      for (let i = 0; i < n; i++) this.list.push({ lane, kind, u: 0.08 + r() * 0.8, v: v0 + r() * (v1 - v0), ph: r() * 6.28 })
    }
    add(0, 'na', 22, 0.67, 0.93) // Na⁺ outside: 145 mM
    add(0, 'na', 2, 0.08, 0.3) // Na⁺ inside: 12 mM
    add(1, 'k', 1, 0.7, 0.92) // K⁺ outside: 4 mM
    add(1, 'k', 22, 0.07, 0.32) // K⁺ inside: 140 mM
    add(1, 'glu', 2, 0.7, 0.92) // glucose outside (low)
    add(1, 'glu', 12, 0.07, 0.32) // glucose inside (high)
    // movers: leaks, pump passengers, symporter passengers (placed every frame)
    for (let i = 0; i < 16; i++) this.list.push({ lane: 0, kind: 'na', u: 0, v: 0, ph: i })
    const geo = new THREE.IcosahedronGeometry(1, 2)
    const bm = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BALL_VERT, fragmentShader: BALL_FRAG })
    this.balls = new THREE.InstancedMesh(geo, bm, this.list.length)
    this.balls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.list.length * 3), 3)
    this.balls.frustumCulled = false
    this.scene.add(this.balls)

    // the carrier in the cliff: the pump (magenta), then the symporter (orange)
    this.gate = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.28, 12, 48),
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { uC: { value: new THREE.Color('#e05cff') }, uA: { value: 0 } },
        vertexShader: `out vec3 vN; out vec3 vV; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `precision highp float; layout(location=0) out vec4 o; uniform vec3 uC; uniform float uA; in vec3 vN; in vec3 vV; void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); o = vec4(uC * (0.6 + 1.6 * f) * uA, 1.0); }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    this.gate.frustumCulled = false
    this.scene.add(this.gate)
    this.tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 1, 8),
      new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { uA: { value: 0 } }, vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: `precision highp float; layout(location=0) out vec4 o; uniform float uA; void main(){ o = vec4(vec3(1.0, 0.75, 0.4) * 1.6 * uA, 1.0); }`, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.tether.frustumCulled = false
    this.scene.add(this.tether)
  }

  /** the terrain's surface at (u, v) of a lane, exactly as the vertex shader places it */
  at(lane: 0 | 1, u: number, v: number, lift = 0, out = new THREE.Vector3()) {
    const f = film
    const width = lerp(L * this.aspect, WF, f.landRise)
    const half = width / 2
    // u runs across the lane, from the outer edge to the gap
    const x = lane === 0 ? lerp(-half + 2, -GAP - 1, u) : lerp(GAP + 1, half - 2, 1 - u)
    const th = (1 - f.landTilt) * (Math.PI / 2)
    const H = landHeights()
    const hOut = lane === 0 ? H.h0 : H.h1
    const h = hOut * smooth(0.4, 0.6, v) * f.landRise + lift
    return out.set(x, v * L * Math.sin(th) + Math.cos(th) * h, -v * L * Math.cos(th) + Math.sin(th) * h)
  }

  update(aspect: number, photo: THREE.Texture | null) {
    const f = film
    const F = f.F
    this.aspect = aspect
    const u = this.mat.uniforms
    const H = landHeights()
    u.uTilt.value = f.landTilt
    u.uRise.value = f.landRise
    u.uW.value = L * aspect
    u.uH0.value = H.h0
    u.uH1.value = H.h1
    u.uCo.value = f.landCo
    u.uPhoto.value = photo
    u.uPhotoOn.value = photo ? 1 : 0

    const t = U.uTime.value
    const show = smooth(0.35, 1, f.landRise)
    const col = new THREE.Color()
    let n = 0
    const put = (p: THREE.Vector3, c: THREE.Color, s: number) => {
      this.s.setScalar(Math.max(1e-4, s * R_ION))
      this.m.compose(p, this.q, this.s)
      this.balls.setMatrixAt(n, this.m)
      this.balls.setColorAt(n, c)
      n++
    }
    const lift = R_ION * 0.95
    for (const b of this.list) {
      if (b.ph >= 0 && b.u === 0 && b.v === 0) continue // movers, below
      let a = show
      if (b.kind === 'k') a *= 1 - f.landCo
      if (b.kind === 'glu') a *= f.landCo
      if (a < 0.01) continue
      const ju = Math.sin(t * 0.9 + b.ph) * 0.012
      const jv = Math.cos(t * 0.7 + b.ph * 1.3) * 0.01
      this.at(b.lane, clamp01(b.u + ju), b.v + jv, lift, this.v)
      put(this.v, col.copy(b.kind === 'na' ? C_NA : b.kind === 'k' ? C_K : C_GLU), a)
    }

    /* passive: Na⁺ leaks in down its slope; K⁺ leaks out down its (much smaller) one */
    const ease = (x: number) => x * x
    if (f.landLeak > 0.01) {
      for (let i = 0; i < 3; i++) {
        const ph = (((F - 10.79) * 16 + i / 3) % 1 + 1) % 1
        this.at(0, 0.82 - i * 0.05, lerp(0.7, 0.18, ease(ph)), lift, this.v)
        put(this.v, col.copy(C_NA), f.landLeak * smooth(0, 0.08, ph) * (1 - smooth(0.9, 1, ph)))
      }
      const ph = (((F - 10.79) * 7) % 1 + 1) % 1
      this.at(1, 0.84, lerp(0.28, 0.78, ease(ph)), lift, this.v)
      put(this.v, col.copy(C_K), f.landLeak * smooth(0, 0.08, ph) * (1 - smooth(0.9, 1, ph)))
    }

    /* primary active transport: the pump carries 3 Na⁺ up and out, 2 K⁺ up and in */
    const gm = this.gate.material as THREE.ShaderMaterial
    const gA = Math.max(f.landPump, f.landCoRun)
    gm.uniforms.uA.value = gA
    gm.uniforms.uC.value.set(f.landCoRun > f.landPump ? '#ffb347' : '#e05cff')
    this.gate.visible = gA > 0.01
    this.at(0, 1, 0.5, 2.4, this.v)
    this.gate.position.set(0, this.v.y, this.v.z)
    this.gate.rotation.set(0, Math.PI / 2, 0)
    this.pumped = 0
    if (f.landPump > 0.01) {
      const cyc = clamp01((F - 11.02) / 0.13) * 2
      this.pumped = Math.floor(cyc + 1e-6)
      const ph = cyc % 1
      const up = smooth(0.15, 0.85, ph)
      for (let i = 0; i < 3; i++) {
        this.at(0, 0.9 - i * 0.04, lerp(0.22, 0.78, up), lift + 0.4 * Math.sin(up * Math.PI), this.v)
        put(this.v, col.copy(C_NA), f.landPump * smooth(0, 0.1, ph) * (1 - smooth(0.9, 1, ph)))
      }
      for (let i = 0; i < 2; i++) {
        this.at(1, 0.9 - i * 0.05, lerp(0.78, 0.22, up), lift + 0.4 * Math.sin(up * Math.PI), this.v)
        put(this.v, col.copy(C_K), f.landPump * smooth(0, 0.1, ph) * (1 - smooth(0.9, 1, ph)))
      }
      // the ATP flash as each cycle starts
      U.uFlash.value = Math.max(U.uFlash.value, smooth(0.0, 0.05, ph) * (1 - smooth(0.05, 0.2, ph)) * f.landPump * 6)
    }

    /* secondary active transport: 2 Na⁺ roll down, and haul 1 glucose up with them */
    const tm = this.tether.material as THREE.ShaderMaterial
    tm.uniforms.uA.value = 0
    this.tether.visible = false
    this.cotransported = 0
    if (f.landCoRun > 0.01) {
      const cyc = clamp01((F - 11.225) / 0.175) * 3
      this.cotransported = Math.floor(cyc + 1e-6)
      const ph = cyc % 1
      const go = smooth(0.12, 0.88, ph)
      const a = f.landCoRun * smooth(0, 0.1, ph) * (1 - smooth(0.9, 1, ph))
      const pNa = new THREE.Vector3()
      for (let i = 0; i < 2; i++) {
        this.at(0, 0.92 - i * 0.05, lerp(0.78, 0.2, go), lift, this.v)
        if (i === 0) pNa.copy(this.v)
        put(this.v, col.copy(C_NA), a)
      }
      const pG = this.at(1, 0.92, lerp(0.78, 0.2, go), lift, new THREE.Vector3())
      put(pG, col.copy(C_GLU), a)
      // the tether: the symporter couples them
      this.tether.visible = a > 0.01
      tm.uniforms.uA.value = a
      const mid = pNa.clone().add(pG).multiplyScalar(0.5)
      const d = pG.clone().sub(pNa)
      this.tether.position.copy(mid)
      this.tether.scale.set(1, d.length(), 1)
      this.tether.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
    }

    this.balls.count = n
    this.balls.instanceMatrix.needsUpdate = true
    if (this.balls.instanceColor) this.balls.instanceColor.needsUpdate = true
    void LAND_IN
    void LAND_OUT
  }
}
