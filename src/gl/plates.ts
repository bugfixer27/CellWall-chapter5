import * as THREE from 'three'
import { HASH, NOISE } from './glsl'
import { U } from './uniforms'

/* ==========================================================================
   PLATES — the page's "photographs" are stills rendered from this same world
   at other moments of the afternoon. Each <figure data-plate> in the DOM
   only reserves space; a WebGL plane is laid exactly over it every frame and
   bends, ripples and melts with the speed of the scroll.
   ========================================================================== */

import type { SetName } from '../core/film'

export type PlateShot = { F: number; set: SetName; pos: [number, number, number]; look: [number, number, number]; fov: number }

export const SHOTS: Record<string, PlateShot> = {
  cell: { F: 1.62, set: 'cell', pos: [-3, 6, 25], look: [0.5, 0.5, 0], fov: 40 },
  bilayer: { F: 3.5, set: 'mem', pos: [-16, 5, 22], look: [2, -1, 0], fov: 40 },
  rbcHyper: { F: 9.68, set: 'tonic', pos: [-9, 2.5, 11], look: [-9, 0, 0], fov: 40 },
  rbcIso: { F: 9.68, set: 'tonic', pos: [0, 2.5, 11], look: [0, 0, 0], fov: 40 },
  rbcHypo: { F: 9.64, set: 'tonic', pos: [9, 2.5, 11.5], look: [9, 0, 0], fov: 40 },
  plants: { F: 9.95, set: 'tonic', pos: [0, 5, 29], look: [0, 0, 0], fov: 40 },
  phago: { F: 12.2, set: 'bulk', pos: [-8, 6, 24], look: [0, 1, 0], fov: 40 },
}

const VERT = /* glsl */ `
uniform float uVel, uTime;
uniform vec2 uSize;
out vec2 vUv;
void main(){
  vUv = uv;
  vec3 p = position;
  // the plate bends like a sheet dragged through the air
  float bend = sin(uv.x * 3.14159) * uVel * 0.9;
  // (a membrane, bending under load)
  p.y += bend * 0.08;                        // local units: the mesh is scaled to the figure
  p.x += sin(uv.y * 3.14159) * uVel * 0.008;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;
layout(location=0) out vec4 o;
${HASH}${NOISE}
uniform sampler2D uMap;
uniform float uVel, uReveal, uTime, uHover, uReady, uAspect;
uniform vec2 uMouse, uSize;
in vec2 vUv;
float rbox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
void main(){
  vec2 uv = vUv;
  // reveal: an inset window that opens from the centre
  float r = uReveal;
  vec2 px = (uv - 0.5) * uSize;
  float box = rbox(px, uSize * 0.5 * vec2(mix(0.84, 1.0, r), r), 3.0);
  float mask = smoothstep(1.0, -1.0, box);
  if (mask < 0.001) discard;

  // cover-fit the still into the frame, with a slow scale-in
  float fa = uSize.x / uSize.y;
  vec2 st = uv - 0.5;
  if (fa > uAspect) st.y *= uAspect / fa; else st.x *= fa / uAspect;
  st *= mix(1.16, 1.0, r);
  // velocity: stretch toward the scroll, and melt in columns when flung hard
  float v = uVel;
  st.y *= 1.0 - abs(v) * 0.12;
  float col = fbm(vec3(uv.x * 7.0, 0.0, uTime * 0.2), 3) * 0.5 + 0.5;
  st.y += col * v * 0.16 * (0.5 + uv.y);
  // the cursor sets off rings in the image like a drop landing on water
  vec2 m = (uv - uMouse) * vec2(fa, 1.0);
  float d = length(m);
  st += normalize(m + 1e-5) * sin(d * 60.0 - uTime * 8.0) * exp(-d * 7.0) * 0.012 * uHover;
  vec2 tuv = st + 0.5;
  float split = v * 0.012 + uHover * 0.002;
  vec3 c;
  c.r = texture(uMap, tuv + vec2(0.0, split)).r;
  c.g = texture(uMap, tuv).g;
  c.b = texture(uMap, tuv - vec2(0.0, split)).b;
  // until the still is rendered, a quiet dark card
  c = mix(vec3(0.02, 0.022, 0.028), c * 1.35, uReady);
  // hairline border
  float edge = smoothstep(1.5, 0.0, abs(box + 0.5));
  c += vec3(0.12) * edge;
  o = vec4(c * mask, mask);
}
`

type Plate = {
  el: HTMLElement
  key: string
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  top: number
  left: number
  w: number
  h: number
  reveal: number
  hover: number
  vel: number
}

export class Plates {
  scene = new THREE.Scene()
  cam = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10)
  list: Plate[] = []
  captures = new Map<string, THREE.WebGLRenderTarget>()
  pending: string[] = []

  constructor() {
    document.querySelectorAll<HTMLElement>('[data-plate]').forEach((el) => {
      const key = el.dataset.plate!
      const g = new THREE.PlaneGeometry(1, 1, 24, 24)
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
        uniforms: {
          uMap: { value: null }, uVel: { value: 0 }, uReveal: { value: 0 }, uTime: U.uTime, uHover: { value: 0 },
          uReady: { value: 0 }, uAspect: { value: 1.6 }, uMouse: { value: new THREE.Vector2(0.5, 0.5) },
          uSize: { value: new THREE.Vector2(1, 1) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
      })
      const mesh = new THREE.Mesh(g, mat)
      mesh.frustumCulled = false
      this.scene.add(mesh)
      this.list.push({ el, key, mesh, mat, top: 0, left: 0, w: 1, h: 1, reveal: 0, hover: 0, vel: 0 })
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect()
        mat.uniforms.uMouse.value.set((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height)
      })
      const p = this.list[this.list.length - 1]
      el.addEventListener('pointerenter', () => (p.hover = 1))
      el.addEventListener('pointerleave', () => (p.hover = 0))
    })
  }

  measure(scrollY: number) {
    for (const p of this.list) {
      const r = p.el.getBoundingClientRect()
      p.top = r.top + scrollY
      p.left = r.left
      p.w = r.width
      p.h = r.height
    }
  }

  /** keys that are near the viewport and still need their still rendered */
  wanted(scrollY: number, vh: number) {
    const out: string[] = []
    for (const p of this.list) {
      if (this.captures.has(p.key)) continue
      if (p.top - scrollY < vh * 3 && p.top + p.h - scrollY > -vh) out.push(p.key)
    }
    return out
  }

  update(scrollY: number, vw: number, vh: number, vel: number, dt: number) {
    this.cam.left = 0
    this.cam.right = vw
    this.cam.top = 0
    this.cam.bottom = -vh
    this.cam.updateProjectionMatrix()
    let any = false
    for (const p of this.list) {
      const y = p.top - scrollY
      const on = y < vh && y + p.h > 0
      p.mesh.visible = on
      if (!on) continue
      any = true
      // reveal as it enters, keyed to position so it reverses on scroll-up
      const enter = Math.min(1, Math.max(0, (vh - y) / (vh * 0.55)))
      p.reveal += (enter * enter * (3 - 2 * enter) - p.reveal) * Math.min(1, dt * 8)
      p.vel += (vel - p.vel) * Math.min(1, dt * 10)
      const u = p.mat.uniforms
      u.uReveal.value = p.reveal
      u.uVel.value = p.vel
      u.uHover.value += (p.hover - u.uHover.value) * Math.min(1, dt * 5)
      u.uSize.value.set(p.w, p.h)
      const cap = this.captures.get(p.key)
      u.uMap.value = cap ? cap.texture : null
      u.uReady.value += ((cap ? 1 : 0) - u.uReady.value) * Math.min(1, dt * 3)
      if (cap) u.uAspect.value = cap.width / cap.height
      p.mesh.position.set(p.left + p.w / 2, -(y + p.h / 2), 0)
      p.mesh.scale.set(p.w, p.h, 1)
    }
    return any
  }
}
