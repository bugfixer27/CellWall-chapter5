import * as THREE from 'three'
import { HASH, NOISE } from './glsl'
import { U } from './uniforms'
import { FullScreen, sm } from './post'

/* ==========================================================================
   RAYMARCHED SETS
   hero   a giant liposome: a cell drawn as nothing but its membrane. Light
          refracts through it (exaggerated), and its rim shows the bilayer as
          two bright tracks, the "railroad track" of the 1950s micrographs.
   tonic  red blood cells (Evans–Fung biconcave profile; haemoglobin absorbs
          blue and green, so thin centres look pale) and plant cells (wall,
          protoplast, vacuole, chloroplasts) in three solutions.
   bulk   the plasma membrane bending: pseudopods wrapping a bacterium,
          pinocytic pits, a caveola, a clathrin-coated pit, exocytosis.
          The membrane is drawn as fluorescence: light is emitted where the
          ray passes through the bilayer, so edge-on it glows brightest.
   ========================================================================== */

const COMMON = /* glsl */ `
${HASH}${NOISE}
uniform mat4 uInvVP;
uniform vec3 uCamPos;
uniform vec2 uRes;
uniform float uTime;
const float PI = 3.14159265;
vec3 rayDir(vec2 uv){
  vec4 p = uInvVP * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return normalize(p.xyz / p.w - uCamPos);
}
float smin(float a, float b, float k){ k = max(k, 1e-4); float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0-h); }
float smax(float a, float b, float k){ return -smin(-a, -b, k); }
float sdRoundBox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0) - r; }
float sdCapsule(vec3 p, float h, float r){ p.x -= clamp(p.x, -h, h); return length(p) - r; }
/* a studio: soft key light upper left, a cool strip right, dark floor */
vec3 env(vec3 d){
  vec3 c = mix(vec3(0.006, 0.008, 0.014), vec3(0.03, 0.04, 0.06), smoothstep(-0.2, 0.8, d.y));
  c += vec3(1.0, 0.96, 0.92) * 2.0 * smoothstep(0.9, 0.985, dot(d, normalize(vec3(-0.55, 0.62, 0.55))));
  c += vec3(0.45, 0.8, 1.0) * 1.4 * smoothstep(0.1, 0.0, abs(d.x - 0.78)) * smoothstep(-0.3, 0.2, d.y) * smoothstep(0.9, 0.2, d.y);
  return c;
}
/* the dark, faintly granular fluid a cell sits in, with far-off defocused bodies */
vec3 backdrop(vec3 d, float tint){
  vec3 c = mix(vec3(0.004, 0.006, 0.012), vec3(0.018, 0.028, 0.045), smoothstep(-0.6, 0.9, d.y));
  vec2 p = d.xy / (1.2 - d.z * 0.2);
  for (int i = 0; i < 14; i++) {
    vec3 h = hash33(vec3(float(i), 3.0, 9.0));
    vec2 ctr = (h.xy - 0.5) * vec2(2.6, 1.6) + vec2(sin(uTime*0.03 + h.z*6.0), cos(uTime*0.02 + h.x*5.0)) * 0.05;
    float R = mix(0.04, 0.2, h.z * h.z);
    float dd = length(p - ctr);
    float disc = smoothstep(R, R * 0.9, dd);
    float ring = smoothstep(R * 0.75, R, dd) * disc;
    vec3 col = mix(vec3(0.35, 0.7, 1.0), vec3(1.0, 0.5, 0.45), h.x * tint);
    c += col * (disc * 0.02 + ring * 0.04) * (0.3 + h.y);
  }
  return c;
}
`

/* ------------------------------------------------------------------ hero */
function heroMat() {
  return sm(
    /* glsl */ `
    ${COMMON}
    uniform sampler2D uBg;
    uniform mat4 uVP;
    uniform float uAmt, uR, uPokeAmt, uPlaneZ, uVel;
    uniform vec3 uPoke;
    float chord(float a, float d){ return 2.0 * sqrt(max(a*a - d*d, 0.0)); }
    vec2 toUv(vec3 w){ vec4 c = uVP * vec4(w, 1.0); return c.xy / c.w * 0.5 + 0.5; }
    vec3 bgAlong(vec3 q, vec3 r){
      float s = r.z < -1e-3 ? (uPlaneZ - q.z) / r.z : 60.0;
      return texture(uBg, clamp(toUv(q + r * s), 0.001, 0.999)).rgb;
    }
    /* dispersion: each wavelength takes its own path through the cell */
    vec3 refrCh(vec3 p, vec3 n, vec3 rd, float ior){
      float eta = 1.0 / ior;
      vec3 r1 = refract(rd, n, eta);
      float t1 = -2.0 * dot(p, r1);
      vec3 q = p + r1 * t1;
      vec3 n2 = -normalize(q);
      vec3 r2 = refract(r1, n2, ior);
      if (dot(r2, r2) < 0.5) r2 = reflect(r1, n2);
      return bgAlong(q, r2);
    }
    void main(){
      vec3 ro = uCamPos, rd = rayDir(vUv);
      vec4 base = texture(uBg, vUv);
      vec3 bg = base.rgb;
      float R = uR;
      float b = dot(ro, rd);
      float dC = length(ro - rd * b);
      // the membrane as two leaflets: emission ∝ the path length through each
      float w = 0.012 * R;
      float lead = chord(R + w*0.5, dC) - chord(R - w*0.5, dC) + chord(R - w*1.9, dC) - chord(R - w*2.9, dC);
      // face-on the film is nearly invisible; edge-on it glows (path length through it)
      vec3 memC = vec3(0.35, 0.85, 1.0) * pow(lead * 0.25, 2.0) * 0.5;
      float c2 = dot(ro, ro) - R*R;
      float h = b*b - c2;
      vec3 col = bg;
      if (h > 0.0) {
        float t0 = -b - sqrt(h);
        vec3 p = ro + rd * t0;
        vec3 n = normalize(p);
        // thermal ringing in its surface modes, and the cursor's dent
        vec3 wob = vec3(gnoise(p * 0.18 + uTime * 0.3), gnoise(p * 0.18 + 11.0 - uTime * 0.27), gnoise(p * 0.18 + 23.0)) * (0.1 + abs(uVel) * 0.25);
        float dent = exp(-pow(length(p - uPoke) / (R * 0.28), 2.0)) * uPokeAmt;
        n = normalize(n + wob - normalize(p - uPoke + 1e-4) * dent * 0.6);
        float cosi = clamp(-dot(rd, n), 0.0, 1.0);
        float F = 0.02 + 0.98 * pow(1.0 - cosi, 5.0);
        vec3 refr = vec3(refrCh(p, n, rd, 1.08).r, refrCh(p, n, rd, 1.092).g, refrCh(p, n, rd, 1.104).b);
        // cytoplasm: a faint cool haze, thicker through the middle
        float inside = chord(R, dC) / (2.0 * R);
        refr = refr * (0.95 - 0.08 * inside) + vec3(0.004, 0.012, 0.018) * inside;
        col = mix(refr, env(reflect(rd, n)), F);
        col += vec3(1.0, 0.95, 0.9) * dent * 0.08;
      }
      col += memC;
      o = vec4(mix(bg, col, uAmt), base.a);
    }`,
    {
      uInvVP: { value: new THREE.Matrix4() }, uVP: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uRes: U.uRes, uTime: U.uTime, uBg: { value: null }, uAmt: { value: 1 }, uR: { value: 10 }, uPoke: { value: new THREE.Vector3() },
      uPokeAmt: { value: 0 }, uPlaneZ: { value: -22 }, uVel: U.uScrollVel,
    },
  )
}

/* ------------------------------------------------------------------ tonicity */
function tonicMat() {
  return sm(
    /* glsl */ `
    ${COMMON}
    uniform float uRbcA, uPlantA, uFade, uFlat, uG;
    uniform vec4 uCellA[4];   // RBC: V/V0, sphericity, crenation, lysis
    uniform vec4 uPos[4];     // RBC: centre, marker scale (0 = not drawn)
    uniform vec4 uPlant[3];   // plant: inset, roundness, turgor bulge, 0
    uniform vec4 uPPos[3];    // plant: centre, marker scale

    /* Evans–Fung red cell: half-thickness ½·R₀·√(1−ρ²)(C0 + C1ρ² + C2ρ⁴), R₀ = 3.91 µm,
       C0 = 0.207, C1 = 2.003, C2 = −1.123: 0.8 µm thick at the centre, 2.6 µm at the rim */
    float sdRBC(vec3 p, vec4 s){
      float V = s.x;
      float sph = s.y;
      float cren = s.z;
      float sc = pow(clamp(V, 0.5, 1.0), 0.333);
      p /= sc;
      const float R0 = 3.91;
      float rr = length(p.xz);
      float rho = min(rr / R0, 1.0);
      float r2 = rho * rho;
      float hh = 0.5 * R0 * sqrt(max(1.0 - r2, 0.0)) * (0.207 + 2.003 * r2 - 1.123 * r2 * r2);
      float dDisc = rr < R0 ? (abs(p.y) - max(hh, 0.0)) * 0.5 : length(vec2(rr - R0, p.y)) * 0.8;
      // swelling: at constant membrane area a red cell can only round up to a sphere of r ≈ 3.3 µm
      float dS = length(p) - mix(3.3, 3.28, sph);
      float d = mix(dDisc, dS, smoothstep(0.0, 1.0, sph));
      // crenation: shrinking cells throw out spicules
      float sp = smoothstep(0.4, 0.0, worley(p * 0.95 + 1.7));
      d -= sp * cren * 0.42;
      return d * sc;
    }
    /* plant cell: wall (shell), protoplast inside */
    const vec3 BOX = vec3(3.4, 3.0, 2.6);
    float sdWall(vec3 p, vec4 s){
      vec3 b = BOX * (1.0 + s.z * 0.035);
      return abs(sdRoundBox(p, b, 0.7)) - 0.22;
    }
    float sdProto(vec3 p, vec4 s){
      vec3 b = BOX * (1.0 + s.z * 0.035) - 0.25 - s.x;
      float r = mix(0.6, 1.6, s.y);
      return sdRoundBox(p, max(b, vec3(0.5)), min(r, min(b.x, min(b.y, b.z)) - 0.05)) + gnoise(p * 0.9 + 3.0) * 0.12 * s.y;
    }
    float sdVac(vec3 p, vec4 s){
      vec3 b = BOX * (1.0 + s.z * 0.035) - 0.25 - s.x - 0.55;
      return sdRoundBox(p, max(b, vec3(0.2)), 0.6);
    }

    /* plant cells: a confocal optical section through their middle (z = 0).
       Wall yellow-green, plasma membrane cyan, chloroplasts green, vacuole dark. */
    float sdRR(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
    vec3 plantSection(vec3 ro, vec3 rd){
      if (abs(rd.z) < 1e-4) return vec3(0.0);
      float t = -ro.z / rd.z;
      if (t < 0.0) return vec3(0.0);
      vec2 q0 = (ro + rd * t).xy;
      vec3 c = vec3(0.0);
      float px = t * 0.0022;                       // about a pixel, in µm, at this distance (per marker scale)
      for (int i = 0; i < 3; i++) {
        vec4 s = uPlant[i];
        float sc = uPPos[i].w;
        if (sc < 0.01) continue;
        vec2 q = (q0 - uPPos[i].xy) / sc;
        px = t * 0.0022 / sc;
        vec2 B = BOX.xy * (1.0 + s.z * 0.035);
        float dw = sdRR(q, B, 0.8);
        // the wall: a thick band of cellulose
        float wall = smoothstep(0.26 + px, 0.26 - px, abs(dw + 0.13));
        c += vec3(0.75, 0.95, 0.32) * wall * 0.55 + vec3(0.9, 1.0, 0.5) * exp(-pow((dw + 0.13) / (0.02 + px), 2.0)) * 0.4;
        // the protoplast: pulled away from the wall when plasmolysed
        vec2 Bp = max(B - 0.27 - s.x * vec2(1.0, 0.85), vec2(0.4));
        float wob = gnoise(vec3(q * 1.1, float(i) * 3.0)) * 0.22 * s.y;
        float dp = sdRR(q, Bp, mix(0.55, 1.4, s.y)) + wob;
        float inside = smoothstep(px, -px, dp);
        c += vec3(0.3, 0.9, 1.0) * exp(-pow(dp / (0.035 + px), 2.0)) * 1.5;
        // the central vacuole fills most of the cell; the cytoplasm is a thin layer around it
        float dv = sdRR(q, max(Bp - 0.55, vec2(0.2)), 0.9) + wob * 0.8;
        float cyt = inside * smoothstep(-px, px, dv);
        c += vec3(0.05, 0.16, 0.08) * cyt;
        c += vec3(0.02, 0.03, 0.05) * smoothstep(px, -px, dv) * inside;
        c += vec3(0.6, 0.75, 1.0) * exp(-pow(dv / (0.02 + px), 2.0)) * 0.25 * inside;   // tonoplast
        // chloroplasts, strung along the cytoplasm
        for (int k = 0; k < 14; k++) {
          float a = float(k) / 14.0 * 6.2832 + float(i);
          vec2 dir = vec2(cos(a), sin(a));
          // walk out from the centre to the middle of the cytoplasm band
          vec2 e = Bp - 0.3;
          vec2 pos = dir * e / max(abs(dir.x) * e.y, abs(dir.y) * e.x) * min(e.x, e.y);
          pos = clamp(pos, -e, e);
          vec2 d2 = q - pos;
          vec2 tang = vec2(-dir.y, dir.x);
          float ell = length(vec2(dot(d2, tang) / 0.46, dot(d2, dir) / 0.2)) - 1.0;
          float ch = smoothstep(0.15, -0.1, ell);
          c += vec3(0.25, 1.0, 0.35) * ch * 0.9 + vec3(0.1, 0.4, 0.12) * exp(-max(ell, 0.0) * 3.0) * 0.15;
        }
      }
      return c;
    }

    /* each cell is tilted a little toward the camera, until the graph lays it flat */
    vec3 orient(vec3 q){
      q.yz = mat2(0.87, -0.5, 0.5, 0.87) * q.yz;
      q.xy = mat2(0.98, -0.2, 0.2, 0.98) * q.xy;
      return q;
    }
    vec3 local(vec3 p, int i){
      vec3 q = (p - uPos[i].xyz) / uPos[i].w;
      vec3 f = vec3(q.x, -q.z, q.y);                 // flat: the disc faces the camera
      return mix(orient(q), f, uFlat);
    }
    float scene(vec3 p, out int id, out int k){
      float d = 1e9; id = 0; k = 0;
      for (int i = 0; i < 4; i++) {
        if (uPos[i].w < 0.01) continue;
        float dc = sdRBC(local(p, i), uCellA[i]) * uPos[i].w;
        if (dc < d) { d = dc; id = 1; k = i; }
      }
      return d;
    }
    vec3 nrm(vec3 p){
      int a, b; vec2 e = vec2(0.01, 0.0);
      return normalize(vec3(scene(p+e.xyy,a,b)-scene(p-e.xyy,a,b), scene(p+e.yxy,a,b)-scene(p-e.yxy,a,b), scene(p+e.yyx,a,b)-scene(p-e.yyx,a,b)));
    }

    /* inside a red cell: march to the far side, measuring the haemoglobin path */
    float throughRBC(vec3 p, vec3 r, vec4 s, int k, out vec3 q){
      float t = 0.02;
      for (int i = 0; i < 48; i++) {
        float d = -sdRBC(local(p + r * t, k), s) * uPos[k].w;
        if (d < 0.004) break;
        t += max(d, 0.02);
      }
      q = p + r * t;
      return t;
    }

    void main(){
      vec3 ro = uCamPos, rd = rayDir(vUv);
      vec3 bgc = backdrop(rd, mix(0.2, 1.0, uRbcA)) * (1.0 - 0.65 * uG);
      vec3 col = bgc;
      float t = 0.0;
      int id = 0, k = 0;
      bool hit = false;
      float glow = 0.0;
      if (uRbcA > 0.01) {
        for (int i = 0; i < 110; i++) {
          vec3 p = ro + rd * t;
          float d = scene(p, id, k);
          if (d < 0.003) { hit = true; break; }
          // near-misses glow: the membrane seen edge-on
          glow += exp(-d * 6.0) * 0.012;
          t += d * 0.8;
          if (t > 120.0) break;
        }
      }
      vec3 rbc = bgc;
      vec3 memc = vec3(0.4, 0.8, 1.0);
      rbc += memc * glow * 0.6;
      if (hit) {
        vec3 p = ro + rd * t;
        vec3 n = nrm(p);
        vec4 s = uCellA[k];
        float cosi = clamp(-dot(rd, n), 0.0, 1.0);
        float F = 0.03 + 0.97 * pow(1.0 - cosi, 5.0);
        vec3 r1 = refract(rd, n, 1.0 / 1.39);
        vec3 q;
        float L = throughRBC(p, r1, s, k, q) / uPos[k].w;
        vec3 r2 = refract(r1, -nrm(q), 1.39);
        if (dot(r2, r2) < 0.5) r2 = reflect(r1, -nrm(q));
        // Beer–Lambert through haemoglobin; a lysed cell has lost it (a "ghost")
        float hb = 1.0 - smoothstep(0.0, 0.6, s.w);
        vec3 absorb = exp(-L * vec3(0.18, 1.35, 1.6) * hb * 1.4);
        vec3 through = backdrop(r2, 1.0) * absorb * 2.2 + vec3(0.55, 0.05, 0.04) * (1.0 - absorb.g) * 0.35 * hb;
        rbc = mix(through, env(reflect(rd, n)), F);
        rbc += memc * pow(1.0 - cosi, 3.0) * 0.5;
        rbc *= 1.0 - s.w * 0.6;
      }
      // escaping haemoglobin after lysis: a red haze spreading from the burst cell
      for (int i = 0; i < 4; i++) {
        float ly = uCellA[i].w;
        if (ly < 0.01 || uPos[i].w < 0.01) continue;
        vec3 c = uPos[i].xyz;
        float b2 = dot(c - ro, rd);
        float dd = length(ro + rd * b2 - c) / uPos[i].w;
        float R = 3.4 + ly * 4.0;
        float haze = exp(-pow(dd / R, 2.0)) * smoothstep(0.0, 0.25, ly) * (1.0 - smoothstep(0.6, 1.0, ly) * 0.6);
        rbc += vec3(0.6, 0.03, 0.03) * haze * (0.35 + 0.15 * gnoise(vec3((ro + rd * b2) * 0.6 + uTime * 0.2)));
      }
      col = mix(bgc, rbc, uRbcA);
      if (uPlantA > 0.01) col += plantSection(ro, rd) * uPlantA;
      o = vec4(col * uFade, 0.0);
    }`,
    {
      uInvVP: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uRes: U.uRes, uTime: U.uTime,
      uRbcA: { value: 1 }, uPlantA: { value: 0 }, uFade: { value: 1 }, uFlat: { value: 0 }, uG: { value: 0 },
      uCellA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(1, 0, 0, 0)) },
      uPos: { value: [new THREE.Vector4(-9, 0, 0, 1), new THREE.Vector4(0, 0, 0, 1), new THREE.Vector4(9, 0, 0, 1), new THREE.Vector4(0, 0, 0, 0)] },
      uPlant: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uPPos: { value: [new THREE.Vector4(-9, 0, 0, 1), new THREE.Vector4(0, 0, 0, 1), new THREE.Vector4(9, 0, 0, 1)] },
    },
  )
}

/* ------------------------------------------------------------------ bulk transport */
function bulkMat() {
  return sm(
    /* glsl */ `
    ${COMMON}
    uniform float uPhago, uLyso, uPino, uPoto, uRme, uExo, uFade;
    const float TH = 0.035;      // half-thickness of the bilayer, 100-nm units (≈ 7 nm total)

    /* ---- cargo positions ---- */
    vec3 bactC(){ return vec3(0.0, mix(4.2, 4.2, 0.0) - 11.0 * smoothstep(0.55, 1.0, uPhago), 0.0); }
    float sdBact(vec3 p){ vec3 q = p - bactC(); q.xy = mat2(0.98, 0.17, -0.17, 0.98) * q.xy; return sdCapsule(q, 3.0, 2.6) + gnoise(q * 1.2) * 0.06; }

    /* ---- the cell's cytoplasm region C (negative inside); its boundary is membrane ---- */
    float cellPhago(vec3 p){
      // pseudopods: a thick shell of cytoplasm hugging the bacterium, rising from the base
      float w = smoothstep(0.0, 0.55, uPhago);
      vec3 c = bactC();
      float db = sdBact(p);
      float arm = abs(db - 0.75) - 0.5;
      float cut = (p.y - c.y) - mix(-4.0, 4.5, w);
      arm = smax(arm, cut, 0.6);
      float d = smin(p.y, arm, 0.9);
      // the space around the bacterium stays extracellular: it becomes the phagosome's lumen
      d = smax(d, -(db - 0.25), 0.12);
      // the lysosome: its lumen is not cytoplasm
      vec3 lc = mix(vec3(9.0, -9.0, 1.0), c + vec3(3.4, -0.4, 0.8), smoothstep(0.0, 1.0, uLyso));
      float dl = length(p - lc) - 1.6;
      float lumen = mix(dl, smin(dl, sdBact(p) - 0.62, 1.2 * uLyso), smoothstep(0.7, 1.0, uLyso));
      d = smax(d, -lumen, 0.25 * uLyso);
      return d;
    }
    /* invaginations: extracellular pockets pushing into the cell (E, negative inside) */
    float pocket(vec3 p, vec3 c0, float r, float prog, out vec3 cc){
      float depth = mix(-r * 0.2, r * 2.6, smoothstep(0.0, 1.0, prog));
      cc = c0 - vec3(0.0, depth, 0.0);
      return length(p - cc) - r;
    }
    float outsideEndo(vec3 p){
      float e = -p.y;
      vec3 cc;
      // pinocytosis: two pits at different stages
      float k1 = mix(0.5, 0.02, smoothstep(0.5, 0.9, uPino));
      e = smin(e, pocket(p, vec3(20.6, 0.0, 0.0), 0.6, uPino, cc), k1 * 0.6);
      e = smin(e, pocket(p, vec3(22.0, 0.0, -0.3), 0.55, uPino * 0.7, cc), 0.3);
      // potocytosis: a small flask-shaped caveola
      e = smin(e, pocket(p, vec3(23.4, 0.0, 0.2), 0.33, uPoto, cc), mix(0.25, 0.015, smoothstep(0.55, 0.95, uPoto)));
      // receptor-mediated: a coated pit
      e = smin(e, pocket(p, vec3(34.0, 0.0, 0.0), 0.62, uRme, cc), mix(0.5, 0.015, smoothstep(0.55, 0.9, uRme)));
      return e;
    }
    float cellExo(vec3 p){
      // a secretory vesicle rises, fuses, and its membrane flattens into the plasma membrane
      vec3 v = vec3(46.0, mix(-2.6, 0.9, smoothstep(0.0, 1.0, uExo)), 0.0);
      float dv = length(p - v) - 0.55;
      float k = mix(0.02, 0.6, smoothstep(0.35, 0.8, uExo));
      return smax(p.y, -dv, k);
    }
    float cellRegion(vec3 p){
      if (p.x < 12.0) return cellPhago(p);
      if (p.x < 40.0) return -outsideEndo(p);
      return cellExo(p);
    }

    /* coats and cargo */
    vec3 pitC(vec3 c0, float r, float prog){ return c0 - vec3(0.0, mix(-r * 0.2, r * 2.6, smoothstep(0.0, 1.0, prog)), 0.0); }
    float clathrin(vec3 p){
      // a lattice of hexagons and pentagons on the pit's cytoplasmic face
      vec3 c = pitC(vec3(34.0, 0.0, 0.0), 0.62, uRme);
      vec3 q = p - c;
      float dsh = abs(length(q) - 0.74) - 0.03;
      vec3 n = normalize(q);
      float a = atan(n.z, n.x), b = acos(clamp(n.y, -1.0, 1.0));
      vec2 uv = vec2(a * 3.0, b * 3.4);
      vec2 g = abs(fract(uv + vec2(0.5 * floor(uv.y), 0.0)) - 0.5);
      float edge = min(g.x, g.y);
      float lattice = smoothstep(0.08, 0.02, edge);
      float cap = smoothstep(0.2, -0.4, q.y + 0.3 * (1.0 - smoothstep(0.3, 0.8, uRme)));
      float assembled = smoothstep(0.08, 0.35, uRme) * (1.0 - smoothstep(0.9, 1.0, uRme));
      return dsh + (1.0 - lattice * cap * assembled) * 0.5;
    }
    float caveolin(vec3 p){
      vec3 c = pitC(vec3(23.4, 0.0, 0.2), 0.33, uPoto);
      vec3 q = p - c;
      float dsh = abs(length(q) - 0.4) - 0.02;
      float stripes = smoothstep(0.3, 0.0, abs(sin(atan(q.z, q.x) * 7.0 + q.y * 12.0)));
      return dsh + (1.0 - stripes * smoothstep(0.1, -0.2, q.y + 0.1) * smoothstep(0.05, 0.3, uPoto)) * 0.3;
    }
    float ldl(vec3 p){
      vec3 c = pitC(vec3(34.0, 0.0, 0.0), 0.62, uRme);
      float d = 1e9;
      for (int i = 0; i < 7; i++) {
        float a = float(i) * 0.9 + 0.4;
        vec3 dir = normalize(vec3(cos(a), -0.3 - 0.8 * fract(float(i) * 0.37), sin(a)));
        vec3 bound = c + dir * 0.44;
        vec3 free_ = vec3(34.0 + cos(a) * 2.2, 1.2 + fract(float(i) * 0.61) * 1.5, sin(a) * 1.6);
        vec3 x = mix(free_, bound, smoothstep(0.0, 0.3, uRme));
        d = min(d, length(p - x) - 0.11);
      }
      return d;
    }
    float solids(vec3 p, out int id){
      id = 0;
      float d = 1e9;
      if (p.x < 12.0) { float b = sdBact(p); d = b; id = 1; }
      else if (p.x < 40.0) {
        float c = clathrin(p); if (c < d) { d = c; id = 2; }
        float v = caveolin(p); if (v < d) { d = v; id = 4; }
        float l = ldl(p); if (l < d) { d = l; id = 3; }
      }
      return d;
    }

    vec3 lysoC(){ return mix(vec3(9.0, -9.0, 1.0), bactC() + vec3(3.4, -0.4, 0.8), smoothstep(0.0, 1.0, uLyso)); }

    /* the cut face: a cross-section through z = 0, drawn like a textbook figure
       — each membrane as its two leaflets, a "railroad track" */
    vec4 section(vec3 q, float px){
      float dm = cellRegion(q);
      float w = max(TH * 0.32, px * 0.9);
      float l1 = exp(-pow((dm - TH * 0.55) / w, 2.0));
      float l2 = exp(-pow((dm + TH * 0.55) / w, 2.0));
      vec3 c = vec3(0.4, 0.9, 1.0) * l1 * 1.3 + vec3(0.35, 0.6, 1.0) * l2 * 1.1;
      c += vec3(0.025, 0.02, 0.035) * smoothstep(0.02, -0.05, dm);                 // cytoplasm
      if (q.x < 12.0) c += vec3(0.5, 0.08, 0.05) * smoothstep(1.62, 1.4, length(q - lysoC())) * (0.3 + uLyso * 0.6); // lysosome lumen
      float a = 0.0;
      // cargo cut through
      if (q.x < 12.0) {
        float b = sdBact(q);
        if (b < 0.0) {
          float dig = smoothstep(0.7, 1.0, uLyso);
          vec3 bc = mix(vec3(0.12, 0.55, 0.2), vec3(0.4, 0.2, 0.12), dig) * (0.6 + 0.4 * gnoise(q * 3.0));
          bc += vec3(0.4, 1.0, 0.5) * exp(-pow(b / 0.06, 2.0)) * (1.0 - dig * 0.6);
          c = bc; a = 1.0;
        }
      } else if (q.x < 40.0) {
        float l = ldl(q);
        if (l < 0.0) { c = vec3(1.0, 0.72, 0.25) * (0.8 + 0.4 * exp(-pow(l / 0.03, 2.0))); a = 1.0; }
        c += vec3(1.0, 0.85, 0.5) * smoothstep(0.02, -0.01, clathrin(q)) * 1.2;
        c += vec3(0.85, 0.6, 1.0) * smoothstep(0.02, -0.01, caveolin(q)) * 1.2;
      }
      return vec4(c, a);
    }

    void main(){
      vec3 ro = uCamPos, rd = rayDir(vUv);
      vec3 acc = vec3(0.0);
      float mOut = 0.0, mIn = 0.0;
      int id = 0; bool hit = false;
      // start at the cut plane: everything in front of z = 0 is cut away
      float t = 0.05;
      vec4 sec = vec4(0.0);
      if (ro.z > 0.0 && rd.z < 0.0) {
        t = -ro.z / rd.z;
        vec3 q = ro + rd * t;
        sec = section(q, t * 0.0016);
        t += 0.002;
      }
      if (sec.a < 0.5) {
        for (int i = 0; i < 150; i++) {
          vec3 p = ro + rd * t;
          float dm = cellRegion(p);
          float ds = solids(p, id);
          if (ds < 0.002) { hit = true; break; }
          float a1 = exp(-pow((dm - TH * 0.55) / (TH * 0.45), 2.0));
          float a2 = exp(-pow((dm + TH * 0.55) / (TH * 0.45), 2.0));
          float st = clamp(min(ds * 0.9, max(abs(dm) * 0.5, TH * 0.35)), TH * 0.3, 0.8);
          float fall = exp(-(t) * 0.08);
          mOut += a1 * st * 1.3 * fall;
          mIn += a2 * st * 1.3 * fall;
          acc += vec3(0.0015, 0.0012, 0.0025) * smoothstep(0.02, -0.05, dm) * st * fall;
          if (p.x < 12.0) acc += vec3(1.0, 0.25, 0.15) * smoothstep(1.7, 0.6, length(p - lysoC())) * st * 0.08 * (1.0 + uLyso * 2.0);
          t += st;
          if (t > 90.0) break;
        }
      }
      // fluorescence saturates: an edge-on membrane is bright, never blinding
      acc += vec3(0.35, 0.85, 1.0) * (1.0 - exp(-mOut)) * 0.55 + vec3(0.3, 0.55, 1.0) * (1.0 - exp(-mIn)) * 0.45;
      vec3 bgc = backdrop(rd, 0.4);
      vec3 col = bgc * 0.7 + acc;
      if (hit && sec.a < 0.5) {
        vec3 p = ro + rd * t;
        int j;
        vec2 e = vec2(0.004, 0.0);
        vec3 n = normalize(vec3(solids(p+e.xyy,j)-solids(p-e.xyy,j), solids(p+e.yxy,j)-solids(p-e.yxy,j), solids(p+e.yyx,j)-solids(p-e.yyx,j)));
        float cosi = max(dot(-rd, n), 0.0);
        float rim = pow(1.0 - cosi, 2.0);
        vec3 L = normalize(vec3(-0.4, 0.8, 0.5));
        float dif = max(dot(n, L), 0.0) * 0.7 + 0.3;
        vec3 sc;
        if (id == 1) {
          float dig = smoothstep(0.7, 1.0, uLyso);
          sc = mix(vec3(0.2, 0.8, 0.3), vec3(0.6, 0.3, 0.18), dig) * (dif * 0.5 + rim * 1.2) * (1.0 - dig * 0.5);
        } else if (id == 2) sc = vec3(1.0, 0.85, 0.5) * (dif * 0.6 + rim * 1.2);
        else if (id == 3) sc = vec3(1.0, 0.7, 0.2) * (dif + rim * 1.6);
        else sc = vec3(0.9, 0.6, 1.0) * (dif * 0.6 + rim * 1.2);
        col = acc * 0.6 + sc * 0.8;
      }
      col = sec.a > 0.5 ? sec.rgb : col + sec.rgb;
      // secreted cargo leaves the fused vesicle
      float ex = smoothstep(0.45, 0.8, uExo);
      for (int i = 0; i < 26; i++) {
        vec3 h = hash33(vec3(float(i), 5.0, 1.0)) - 0.5;
        vec3 v = vec3(46.0, mix(-2.6, 0.9, smoothstep(0.0, 1.0, uExo)), 0.0);
        vec3 x = v + h * 0.6 + vec3(h.x * 3.0, 0.6 + abs(h.y) * 3.0, h.z * 2.0) * ex + vec3(0.0, ex * 0.3, 0.0);
        float b = dot(x - ro, rd);
        float d = length(ro + rd * b - x);
        col += vec3(1.0, 0.9, 0.45) * exp(-d * d / 0.0009) * 0.6 * step(0.0, b) * smoothstep(0.02, 0.1, uExo);
      }
      // pinocytic fluid in the pits
      o = vec4(col * uFade, 0.0);
    }`,
    {
      uInvVP: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uRes: U.uRes, uTime: U.uTime,
      uPhago: { value: 0 }, uLyso: { value: 0 }, uPino: { value: 0 }, uPoto: { value: 0 }, uRme: { value: 0 }, uExo: { value: 0 }, uFade: { value: 1 },
    },
  )
}

export class Glass {
  hero = new FullScreen(heroMat())
  tonic = new FullScreen(tonicMat())
  bulk = new FullScreen(bulkMat())
  private inv = new THREE.Matrix4()
  private vp = new THREE.Matrix4()
  setCam(fs: FullScreen, cam: THREE.PerspectiveCamera) {
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    this.inv.copy(this.vp).invert()
    const u = fs.mat.uniforms
    u.uInvVP.value.copy(this.inv)
    u.uCamPos.value.copy(cam.position)
    if (u.uVP) u.uVP.value.copy(this.vp)
  }
}
