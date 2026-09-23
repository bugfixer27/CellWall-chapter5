import * as THREE from 'three'
import { HASH, NOISE, TONE } from './glsl'
import { U } from './uniforms'

const VERT = /* glsl */ `
out vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export class FullScreen {
  scene = new THREE.Scene()
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  constructor(public mat: THREE.ShaderMaterial) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    q.frustumCulled = false
    this.scene.add(q)
  }
  render(r: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget | null) {
    r.setRenderTarget(out)
    r.render(this.scene, this.cam)
  }
}

const sm = (frag: string, uniforms: Record<string, { value: any }>, extra: Partial<THREE.ShaderMaterialParameters> = {}) =>
  new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    uniforms,
    vertexShader: VERT,
    fragmentShader: `precision highp float;\nlayout(location=0) out vec4 o;\nin vec2 vUv;\n${frag}`,
    ...extra,
  })

const rt = (w = 2, h = 2, depth = false, samples = 0) =>
  new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: depth,
    samples,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  })

/* ------------------------------------------------------------------ bloom
   Dual-filter (Kawase) bloom: a soft-knee bright pass, five halvings down
   and back up. Cheap, wide, and free of the boxy look of a single blur. */
export class Bloom {
  levels: THREE.WebGLRenderTarget[] = []
  up: THREE.WebGLRenderTarget[] = []
  bright: FullScreen
  down: FullScreen
  upP: FullScreen
  constructor(n = 6) {
    for (let i = 0; i < n; i++) {
      this.levels.push(rt())
      this.up.push(rt())
    }
    this.bright = new FullScreen(
      sm(
        /* glsl */ `
        uniform sampler2D uMap; uniform float uThresh;
        void main(){
          vec3 c = texture(uMap, vUv).rgb;
          float l = max(c.r, max(c.g, c.b));
          float k = uThresh * 0.5;
          float soft = clamp(l - uThresh + k, 0.0, 2.0*k); soft = soft*soft/(4.0*k + 1e-4);
          float w = max(soft, l - uThresh) / max(l, 1e-4);
          o = vec4(min(c * w, vec3(60.0)), 1.0);
        }`,
        { uMap: { value: null }, uThresh: { value: 1.0 } },
      ),
    )
    this.down = new FullScreen(
      sm(
        /* glsl */ `
        uniform sampler2D uMap; uniform vec2 uTexel;
        void main(){
          vec2 h = uTexel * 0.5;
          vec3 s = texture(uMap, vUv).rgb * 4.0;
          s += texture(uMap, vUv - h).rgb; s += texture(uMap, vUv + h).rgb;
          s += texture(uMap, vUv + vec2(h.x, -h.y)).rgb; s += texture(uMap, vUv - vec2(h.x, -h.y)).rgb;
          o = vec4(s / 8.0, 1.0);
        }`,
        { uMap: { value: null }, uTexel: { value: new THREE.Vector2() } },
      ),
    )
    this.upP = new FullScreen(
      sm(
        /* glsl */ `
        uniform sampler2D uMap, uBase; uniform vec2 uTexel;
        void main(){
          vec2 h = uTexel * 0.5;
          vec3 s = texture(uMap, vUv + vec2(-h.x*2.0, 0.0)).rgb;
          s += texture(uMap, vUv + vec2(-h.x, h.y)).rgb * 2.0;
          s += texture(uMap, vUv + vec2(0.0, h.y*2.0)).rgb;
          s += texture(uMap, vUv + vec2(h.x, h.y)).rgb * 2.0;
          s += texture(uMap, vUv + vec2(h.x*2.0, 0.0)).rgb;
          s += texture(uMap, vUv + vec2(h.x, -h.y)).rgb * 2.0;
          s += texture(uMap, vUv + vec2(0.0, -h.y*2.0)).rgb;
          s += texture(uMap, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
          o = vec4(s / 12.0 * 0.72 + texture(uBase, vUv).rgb, 1.0);
        }`,
        { uMap: { value: null }, uBase: { value: null }, uTexel: { value: new THREE.Vector2() } },
      ),
    )
  }
  setSize(w: number, h: number) {
    let W = Math.max(2, w >> 1)
    let H = Math.max(2, h >> 1)
    for (let i = 0; i < this.levels.length; i++) {
      this.levels[i].setSize(W, H)
      this.up[i].setSize(W, H)
      W = Math.max(2, W >> 1)
      H = Math.max(2, H >> 1)
    }
  }
  render(r: THREE.WebGLRenderer, src: THREE.Texture, thresh: number) {
    const b = this.bright.mat.uniforms
    b.uMap.value = src
    b.uThresh.value = thresh
    this.bright.render(r, this.levels[0])
    const d = this.down.mat.uniforms
    for (let i = 1; i < this.levels.length; i++) {
      d.uMap.value = this.levels[i - 1].texture
      d.uTexel.value.set(1 / this.levels[i - 1].width, 1 / this.levels[i - 1].height)
      this.down.render(r, this.levels[i])
    }
    const u = this.upP.mat.uniforms
    let cur = this.levels[this.levels.length - 1]
    for (let i = this.levels.length - 2; i >= 0; i--) {
      u.uMap.value = cur.texture
      u.uBase.value = this.levels[i].texture
      u.uTexel.value.set(1 / cur.width, 1 / cur.height)
      this.upP.render(r, this.up[i])
      cur = this.up[i]
    }
    return cur.texture
  }
}

/* ------------------------------------------------------------------ micro backdrop
   The inside of a cloud at micrometre scale: black, with neighbouring
   droplets far out of focus as soft discs of light. */
export function microBackdrop() {
  return new FullScreen(
    sm(
      /* glsl */ `
      ${HASH}
      uniform float uTime, uIce; uniform vec2 uRes;
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
        // inside a cloud the light comes from above: a soft bright ceiling, dark below
        vec3 c = mix(vec3(0.004,0.006,0.012), vec3(0.05,0.065,0.09), smoothstep(0.2, 1.0, vUv.y));
        c = mix(c, c * vec3(0.8, 0.9, 1.25), uIce);
        for (int i = 0; i < 26; i++) {
          vec3 h = hash33(vec3(float(i), 7.0, 3.0));
          vec2 ctr = (h.xy - 0.5) * vec2(2.2, 1.4);
          ctr += vec2(sin(uTime * 0.05 + h.z * 6.0), cos(uTime * 0.04 + h.x * 5.0)) * 0.06;
          ctr.y += fract(uTime * 0.004 * (0.5 + h.z) + h.y) * 0.0;
          float R = mix(0.03, 0.16, h.z * h.z);
          float d = length(p - ctr);
          float disc = smoothstep(R, R * 0.92, d);
          float ring = smoothstep(R * 0.8, R, d) * disc;
          vec3 tint = mix(vec3(0.5,0.65,1.0), vec3(1.0,0.85,0.7), h.x);
          c += tint * (disc * 0.05 + ring * 0.08) * (0.4 + h.y);
        }
        o = vec4(c, 0.0);
      }`,
      { uTime: U.uTime, uIce: { value: 0 }, uRes: U.uRes },
    ),
  )
}

/* ------------------------------------------------------------------ the portal
   The micro world opens inside a circle that grows until it fills the frame.
   Its rim behaves like the edge of a lens: the macro world bends around it. */
export function portalPass() {
  return new FullScreen(
    sm(
      /* glsl */ `
      uniform sampler2D uMacro, uMicro; uniform float uR; uniform vec2 uRes;
      void main(){
        vec2 asp = vec2(uRes.x / uRes.y, 1.0);
        vec2 p = (vUv - 0.5) * asp;
        float d = length(p);
        float R = uR * 1.25;
        float inside = smoothstep(R, R - 0.004, d);
        // refraction around the rim: the outside world is pulled inward
        float rim = exp(-pow((d - R) / 0.05, 2.0)) * step(0.001, uR);
        vec2 dir = normalize(p + 1e-5);
        vec2 uvM = vUv - dir / asp * rim * 0.05;
        vec3 macro = texture(uMacro, uvM).rgb;
        // inside: the micro world is seen through a lens that de-magnifies at the edge
        float k = clamp(d / max(R, 1e-3), 0.0, 1.0);
        vec2 uvI = 0.5 + (vUv - 0.5) * (0.82 + 0.18 * k * k);
        vec3 microC = texture(uMicro, uvI).rgb;
        vec3 c = mix(macro, microC, inside);
        c += vec3(0.8, 0.9, 1.0) * rim * 0.25 * (1.0 - inside);
        o = vec4(c, texture(uMacro, vUv).a * (1.0 - inside));
      }`,
      { uMacro: { value: null }, uMicro: { value: null }, uR: { value: 0 }, uRes: U.uRes },
    ),
  )
}

/* ------------------------------------------------------------------ final grade */
export function finalPass() {
  return new FullScreen(
    sm(
      /* glsl */ `
      ${HASH}${NOISE}${TONE}
      uniform sampler2D uMap, uBloom;
      uniform float uExposure, uBloomAmt, uTime, uPaper, uVignette, uGrain, uScrollVel, uFlash, uCA;
      uniform vec2 uRes;
      vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }

      /* engraving: parallel hatch lines whose width follows density, a second
         crossed set for the darkest tones — the look of a 19th-c. atlas plate */
      float hatch(vec2 px, float dens, float ang){
        vec2 d = vec2(cos(ang), sin(ang));
        float wob = gnoise(vec3(px * 0.02, 1.0)) * 1.4;
        float v = fract(dot(px, d) / 5.0 + wob * 0.12);
        float w = clamp(dens, 0.0, 1.0) * 0.5;
        return smoothstep(w + 0.08, w - 0.04, abs(v - 0.5));
      }

      void main(){
        vec2 uv = vUv;
        // lens: a hint of radial chromatic aberration, more when the page is flung
        vec2 c = uv - 0.5;
        float ca = (uCA + abs(uScrollVel) * 0.004) * dot(c, c);
        vec4 base = texture(uMap, uv);
        vec3 col;
        col.r = texture(uMap, uv - c * ca).r;
        col.g = base.g;
        col.b = texture(uMap, uv + c * ca).b;
        vec3 bloom = texture(uBloom, uv).rgb;
        col += bloom * uBloomAmt;
        col *= uExposure;
        col += vec3(0.6, 0.7, 1.0) * uFlash * 0.03;
        vec3 mapped = aces(col);

        // ---- the atlas plate ------------------------------------------------
        if (uPaper > 0.001) {
          vec2 px = uv * uRes;
          vec3 paper = vec3(0.925, 0.905, 0.862);
          paper *= 0.97 + 0.03 * gnoise(vec3(px * 0.35, 0.0));      // tooth
          paper *= 1.0 - 0.06 * smoothstep(0.3, 0.9, length(c * vec2(1.0, 1.3)));
          float lum = dot(mapped, vec3(0.299, 0.587, 0.114));
          // light content becomes ink of its own hue, darkened
          vec3 hue = mapped / max(max(mapped.r, max(mapped.g, mapped.b)), 1e-3);
          vec3 ink = mix(vec3(0.07, 0.065, 0.06), hue * 0.32, 0.75);
          vec3 plate = mix(paper, ink, clamp(lum * 2.4, 0.0, 1.0));
          // solid ground and water are engraved, not printed
          float dens = base.a;
          float h1 = hatch(px, dens * 1.1, 0.785);
          float h2 = hatch(px, (dens - 0.55) * 1.6, -0.785);
          vec3 inkLine = vec3(0.13, 0.12, 0.11);
          plate = mix(plate, inkLine, max(h1, h2) * step(0.05, dens) * 0.85);
          mapped = mix(mapped, plate, uPaper);
        }

        // vignette + grain
        float v = smoothstep(0.95, 0.25, length(c * vec2(1.0, 0.8)));
        mapped *= mix(1.0, v, uVignette * (1.0 - uPaper * 0.7));
        vec3 srgb = toSRGB(mapped);
        float g = hash12(uv * uRes + fract(uTime * 7.3) * 311.0) - 0.5;
        srgb += g * uGrain * (1.0 - uPaper * 0.5);
        o = vec4(srgb, 1.0);
      }`,
      {
        uMap: { value: null }, uBloom: { value: null }, uExposure: { value: 1 }, uBloomAmt: { value: 0.7 },
        uTime: U.uTime, uPaper: U.uPaper, uVignette: { value: 0.5 }, uGrain: { value: 0.04 },
        uScrollVel: U.uScrollVel, uFlash: U.uFlash, uCA: { value: 0.012 }, uRes: U.uRes,
      },
    ),
  )
}

export { rt, sm }
