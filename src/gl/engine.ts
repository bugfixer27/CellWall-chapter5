import * as THREE from 'three'
import { film, updateFilm, camAt, type SetName, UNIT_M, smooth, band } from '../core/film'
import { scroll } from '../core/scroll'
import { U } from './uniforms'
import { buildCell } from './cell'
import { buildBilayer } from './bilayer'
import { buildProteins } from './proteins'
import { Molecules } from './molecules'
import { Glass } from './glass'
import { Bloom, finalPass, portalPass, rt } from './post'
import { Plates, SHOTS } from './plates'
import { rbcVolume, RBC_LYSE, ISO_MOSM } from '../science/membrane'

/* ==========================================================================
   THE RENDER GRAPH (one frame)
     outer set → A        cell: particles + headline, glass liposome over it
                          mem:  lipids, cholesterol, sugars, proteins, molecules
                          tonic / bulk: raymarched in one pass
     inner set → M        only while a portal is open
     portal    A, M → C   the next scale opens inside a lens
     plates               DOM-mirrored stills
     bloom + grade        → screen (engraving when the page turns to paper)
   ========================================================================== */

function headline() {
  const c = document.createElement('canvas')
  c.width = 2400
  c.height = 700
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#edebe6'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `560 ${Math.round(c.height * 0.62)}px 'Geist Variable', 'Geist', system-ui, sans-serif`
  ;(g as any).letterSpacing = '-18px'
  g.fillText('Membrane', c.width / 2, c.height * 0.52)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uMap: { value: tex }, uAmt: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uAmt; varying vec2 vUv;
      void main(){ vec3 c = texture2D(uMap, vUv).rgb; c = pow(c, vec3(2.2)); gl_FragColor = vec4(c * 0.85 * uAmt, 1.0); }`,
  })
  const w = 60
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * c.height) / c.width), mat)
  mesh.position.set(0, 0.6, -22)
  mesh.renderOrder = -1
  return { mesh, mat }
}

export class Engine {
  renderer: THREE.WebGLRenderer
  camA = new THREE.PerspectiveCamera(34, 1, 0.1, 2000)
  camB = new THREE.PerspectiveCamera(34, 1, 0.1, 2000)
  w = 1
  h = 1
  dpr = 1
  // the 3-D sets render multisampled: lipid edges and protein rims stay clean
  A = rt(2, 2, true, 4)
  B = rt()
  M = rt(2, 2, true, 4)
  M2 = rt()
  C = rt()
  bloom = new Bloom(6)
  finalP = finalPass()
  portal = portalPass()
  glass = new Glass()
  plates = new Plates()

  cellScene = new THREE.Scene()
  memScene = new THREE.Scene()
  cell = buildCell()
  head = headline()
  bil = buildBilayer()
  prot = buildProteins()
  mol = new Molecules()

  mouse = new THREE.Vector2()
  mouseT = new THREE.Vector2()
  mouseActive = 0
  mouseVel = new THREE.Vector2()
  parallax = new THREE.Vector2()
  pokeAmt = 0
  poke = new THREE.Vector3()
  raycaster = new THREE.Raycaster()
  time = 0
  flowT = 0
  maxPr = 1.5
  private acc = 0
  private nF = 0
  gpuMs = 0

  constructor(canvas: HTMLCanvasElement) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: true })
    r.autoClear = false
    r.outputColorSpace = THREE.LinearSRGBColorSpace
    r.toneMapping = THREE.NoToneMapping
    this.renderer = r
    this.cellScene.add(this.cell.points, this.head.mesh)
    this.memScene.add(this.bil.group, this.prot.root, this.mol.mesh)
    addEventListener('pointermove', (e) => {
      const nx = (e.clientX / innerWidth) * 2 - 1
      const ny = -(e.clientY / innerHeight) * 2 + 1
      this.mouseVel.set(nx - this.mouseT.x, ny - this.mouseT.y)
      this.mouseT.set(nx, ny)
      this.mouseActive = 1
    })
    document.addEventListener('pointerleave', () => (this.mouseActive = 0))
    this.resize()
    addEventListener('resize', () => this.resize())
  }

  resize() {
    this.w = innerWidth
    this.h = innerHeight
    const pr = Math.min(devicePixelRatio || 1, this.maxPr)
    this.dpr = pr
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(this.w, this.h, false)
    const W = Math.round(this.w * pr)
    const H = Math.round(this.h * pr)
    for (const t of [this.A, this.B, this.C, this.M, this.M2]) t.setSize(W, H)
    this.bloom.setSize(W, H)
    U.uRes.value.set(W, H)
    for (const c of [this.camA, this.camB]) {
      c.aspect = this.w / this.h
      c.updateProjectionMatrix()
    }
    this.plates.measure(scroll.y)
  }

  async warmup() {
    const r = this.renderer
    const fs = [this.glass.hero, this.glass.tonic, this.glass.bulk, this.portal, this.finalP, this.bloom.bright, this.bloom.down, this.bloom.upP]
    await Promise.all([
      r.compileAsync(this.cellScene, this.camA).catch(() => {}),
      r.compileAsync(this.memScene, this.camA).catch(() => {}),
      r.compileAsync(this.plates.scene, this.plates.cam).catch(() => {}),
      ...fs.map((f) => r.compileAsync(f.scene, f.cam).catch(() => {})),
    ])
    // prime every set once, so nothing compiles or uploads mid-scroll
    const F0 = film.F
    for (const F of [0.2, 5.5, 9.5, 12.3]) {
      updateFilm(F)
      this.renderSet(film.outer, this.camA, this.A, 0)
    }
    updateFilm(F0)
    for (const key of Object.keys(SHOTS)) {
      if (!this.plates.captures.has(key)) this.capture(key)
      await new Promise((res) => requestAnimationFrame(res))
    }
  }

  /* ---- place a camera on a set's path at film time F ---- */
  private _t = new THREE.Vector3()
  placeCam(cam: THREE.PerspectiveCamera, set: SetName, F: number, parallax = true) {
    cam.fov = camAt(set, F, cam.position, this._t)
    cam.up.set(0, 1, 0)
    cam.lookAt(this._t)
    if (parallax) {
      const d = cam.position.distanceTo(this._t)
      const k = d * 0.02 * (1 - film.paper * 0.8)
      cam.updateMatrixWorld()
      cam.position.addScaledVector(new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), this.parallax.x * k)
      cam.position.addScaledVector(new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1), this.parallax.y * k * 0.6)
      cam.lookAt(this._t)
    }
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    return this._t.clone()
  }

  /* ---- per-set uniforms, from the film ---- */
  private syncSets(cam: THREE.PerspectiveCamera, tgt: THREE.Vector3) {
    const f = film
    const cu = this.cell.mat.uniforms
    cu.uAssemble.value = f.assemble
    cu.uOrg.value = f.organelles
    cu.uCyto.value = f.cyto
    cu.uVes.value = f.vesicles
    cu.uMem.value = f.memGlow
    cu.uFocus.value = cam.position.distanceTo(tgt)
    cu.uPx.value = this.dpr * (this.h / 900)
    cu.uAlpha.value = 1 - f.finalGlass * 0.15
    this.head.mat.uniforms.uAmt.value = f.heroType
    this.head.mesh.visible = f.heroType > 0.001

    const bu = this.bil.uniforms
    bu.uState.value = f.lipidState
    bu.uTemp.value = f.temp
    bu.uFluid.value = 0.2 + 0.8 * smooth(4, 37, f.temp)
    bu.uCut.value = f.cut
    bu.uSolo.value = f.solo
    bu.uHideChol.value = band(4.25, 4.33, 4.9, 4.96, f.F)
    bu.uUnsatHi.value = f.unsatHi
    bu.uCholHi.value = f.cholHi
    bu.uProt.value.forEach((v, i) => v.copy(this.prot.footprints[i]))
  }

  /* tonicity: each cell's state is computed from Boyle–van 't Hoff */
  tonicState() {
    const out = [ISO_MOSM + 150 * film.tonicH, ISO_MOSM, ISO_MOSM - 200 * film.tonicO] // hypertonic · isotonic · hypotonic
    return out.map((mosm) => {
      const V = rbcVolume(mosm)
      const sph = smooth(1.0, RBC_LYSE, V)
      const cren = smooth(1.0, 0.8, V)
      const lysis = V >= RBC_LYSE ? smooth(0, 0.35, (V - RBC_LYSE) / 0.6) : 0
      return { mosm, V, sph, cren, lysis }
    })
  }

  /* ---- render one set into a target; returns the target holding the image ---- */
  renderSet(set: SetName, cam: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget, dt: number): THREE.WebGLRenderTarget {
    const r = this.renderer
    const f = film
    r.setRenderTarget(target)
    r.setClearColor(0x000000, 0)
    r.clear(true, true, false)
    if (set === 'cell') {
      r.render(this.cellScene, cam)
      const glassAmt = Math.max(f.heroGlass, f.finalGlass)
      if (glassAmt > 0.001) {
        const g = this.glass.hero
        this.glass.setCam(g, cam)
        const u = g.mat.uniforms
        u.uBg.value = target.texture
        u.uAmt.value = glassAmt
        u.uPoke.value.copy(this.poke)
        u.uPokeAmt.value = this.pokeAmt
        const out = target === this.A ? this.B : this.M2
        g.render(r, out)
        return out
      }
      return target
    }
    if (set === 'mem') {
      r.render(this.memScene, cam)
      return target
    }
    if (set === 'tonic') {
      const g = this.glass.tonic
      this.glass.setCam(g, cam)
      const u = g.mat.uniforms
      u.uMode.value = f.tonicMode
      u.uFade.value = f.tonicFade
      const st = this.tonicState()
      st.forEach((s, i) => {
        u.uCellA.value[i].set(s.V, s.sph, s.cren, s.lysis)
        // plant cells: hypertonic plasmolyses, isotonic is flaccid, hypotonic is turgid
        const plas = i === 0 ? f.tonic : 0
        const turg = i === 2 ? f.tonic : 0
        u.uPlant.value[i].set(0.05 + plas * 1.35 + (i === 1 ? 0.06 : 0), plas, turg, 0)
      })
      g.render(r, target)
      return target
    }
    const g = this.glass.bulk
    this.glass.setCam(g, cam)
    const u = g.mat.uniforms
    u.uPhago.value = f.phago
    u.uLyso.value = f.lyso
    u.uPino.value = f.pino
    u.uPoto.value = f.poto
    u.uRme.value = f.rme
    u.uExo.value = f.exo
    g.render(r, target)
    void dt
    return target
  }

  /* one still of a set at another moment, for a plate */
  private capture(key: string) {
    const shot = SHOTS[key]
    const W = 1200
    const H = 800
    const out = rt(W, H, true)
    const F0 = film.F
    updateFilm(shot.F)
    const cam = new THREE.PerspectiveCamera(shot.fov, W / H, 0.1, 2000)
    cam.position.set(...shot.pos)
    cam.lookAt(...shot.look)
    cam.updateMatrixWorld()
    this.syncSets(cam, new THREE.Vector3(...shot.look))
    if (shot.set === 'mem') {
      this.prot.update(0, this.mol.carrierRock, this.mol.symRock)
      this.mol.update()
      this.syncSets(cam, new THREE.Vector3(...shot.look))
    }
    const prevRes = U.uRes.value.clone()
    U.uRes.value.set(W, H)
    const tmp = rt(W, H, true)
    const res = this.renderSet(shot.set, cam, tmp, 0)
    // copy (the hero pass may have written to B)
    const r = this.renderer
    r.setRenderTarget(out)
    r.clear(true, true, false)
    this.portal.mat.uniforms.uMacro.value = res.texture
    this.portal.mat.uniforms.uMicro.value = res.texture
    this.portal.mat.uniforms.uR.value = 0
    this.portal.render(r, out)
    U.uRes.value.copy(prevRes)
    tmp.dispose()
    updateFilm(F0)
    this.plates.captures.set(key, out)
  }

  /* ---- screen-space projection for the DOM labels ---- */
  private _p = new THREE.Vector3()
  project(set: SetName, v: THREE.Vector3): [number, number, boolean] {
    if (film.outer !== set || film.portal > 0.02) return [0, 0, false]
    this._p.copy(v).project(this.camA)
    return [(this._p.x * 0.5 + 0.5) * this.w, (-this._p.y * 0.5 + 0.5) * this.h, this._p.z < 1]
  }
  scaleText() {
    const cam = this.camA
    const d = cam.position.distanceTo(this._look)
    const hWorld = 2 * d * Math.tan(((cam.fov * Math.PI) / 180) / 2)
    const m = hWorld * UNIT_M[film.outer]
    const f = (v: number) => (v >= 100 ? String(Math.round(v)) : v.toPrecision(2))
    if (m < 1e-6) return `${f(m * 1e9)} nm`
    if (m < 1e-3) return `${f(m * 1e6)} µm`
    return `${f(m * 1e3)} mm`
  }
  private _look = new THREE.Vector3()

  frame(dt: number) {
    dt = Math.min(dt, 0.1)
    this.time += dt
    U.uTime.value = this.time
    U.uScrollVel.value = scroll.velN
    const f = updateFilm(scroll.F)
    U.uPaper.value = f.paper
    this.flowT += dt * (0.25 + 0.75 * smooth(4, 37, f.temp))
    this.bil.uniforms.uFlowT.value = this.flowT

    const want = this.plates.wanted(scroll.y, scroll.vh)
    if (want.length) this.capture(want[0])

    /* cameras */
    this.mouse.lerp(this.mouseT, Math.min(1, dt * 6))
    this.parallax.lerp(this.mouseT, Math.min(1, dt * 2.2))
    this.mouseVel.multiplyScalar(Math.exp(-dt * 8))
    const look = this.placeCam(this.camA, f.outer, f.F)
    this._look.copy(look)
    let lookB: THREE.Vector3 | null = null
    if (f.inner) lookB = this.placeCam(this.camB, f.inner, f.F)

    /* cursor ray (in the outer set's camera) */
    this.raycaster.setFromCamera(this.mouse, this.camA)
    U.uRayO.value.copy(this.raycaster.ray.origin)
    U.uRayD.value.copy(this.raycaster.ray.direction)
    const moving = Math.min(1, this.mouseVel.length() * 30)
    U.uMouseF.value = this.mouseActive * (0.3 + 0.7 * moving)
    // the liposome dents under the cursor
    const R = 10
    const ray = this.raycaster.ray
    const hit = ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), R), new THREE.Vector3())
    const target = this.mouseActive * (hit ? 1 : 0) * (0.4 + 0.6 * moving)
    this.pokeAmt += (target - this.pokeAmt) * Math.min(1, dt * 6)
    if (hit) this.poke.copy(hit)

    /* scene state */
    this.prot.update(dt, this.mol.carrierRock, this.mol.symRock)
    this.mol.update()

    const r = this.renderer
    this.syncSets(this.camA, look)
    let cur = this.renderSet(f.outer, this.camA, this.A, dt)
    if (f.inner && f.portal > 0.001 && lookB) {
      this.syncSets(this.camB, lookB)
      const inner = this.renderSet(f.inner, this.camB, this.M, dt)
      this.syncSets(this.camA, look)
      const pu = this.portal.mat.uniforms
      pu.uMacro.value = cur.texture
      pu.uMicro.value = inner.texture
      pu.uR.value = f.portal
      this.portal.render(r, this.C)
      cur = this.C
    }

    /* plates */
    if (this.plates.update(scroll.y, this.w, this.h, scroll.velN, dt)) {
      r.setRenderTarget(cur)
      r.render(this.plates.scene, this.plates.cam)
    }

    /* bloom + grade */
    const bloomTex = this.bloom.render(r, cur.texture, f.outer === 'cell' ? 0.55 : 0.8)
    const fu = this.finalP.mat.uniforms
    fu.uMap.value = cur.texture
    fu.uBloom.value = bloomTex
    fu.uExposure.value = f.exposure
    fu.uBloomAmt.value = f.outer === 'cell' ? 0.55 : 0.4
    fu.uVignette.value = f.vignette
    fu.uGrain.value = 0.03
    this.finalP.render(r, null)

    /* keep the frame budget: if frames run long, drop resolution a step */
    this.acc += dt
    if (++this.nF >= 120) {
      const avg = (this.acc / this.nF) * 1000
      this.acc = 0
      this.nF = 0
      if (avg > 24 && this.maxPr > 1) {
        this.maxPr = Math.max(1, this.maxPr - 0.25)
        this.resize()
      }
    }
  }
}
