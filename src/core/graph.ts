/* The tonicity graph: cell volume against the osmolarity outside, with the
   red cells (and then the plant cells) sitting on it as live 3-D markers.
   The same function places them in the scene and draws the axes in the
   DOM, so the cells land exactly on their curve. */
import { GRAPH, film, lerp } from './film'
import { rbcVolume, RBC_LYSE, ISO_MOSM, lyseMosm } from '../science/membrane'

export const AX = { m0: 0, m1: 600, v0: 0.4, v1: 1.8 }
/** where the graph sits on screen (fractions of the viewport) */
const BOX = { x0: 0.41, x1: 0.93, y0: 0.27, y1: 0.83 }
/** plant cells: the wall stops the protoplast from growing past about its own volume */
export const PLANT_CAP = 1.04
export const plantVolume = (mosm: number) => Math.min(rbcVolume(mosm), PLANT_CAP)

/** world rectangle of the graph at the graph camera, for this aspect ratio */
export function graphRect(aspect: number) {
  const h = 2 * GRAPH.cz * Math.tan((20 * Math.PI) / 180)
  const w = h * aspect
  return { x0: (BOX.x0 - 0.5) * w, x1: (BOX.x1 - 0.5) * w, y0: (0.5 - BOX.y1) * h, y1: (0.5 - BOX.y0) * h }
}
export function toWorld(mosm: number, V: number, aspect: number): [number, number] {
  const r = graphRect(aspect)
  return [lerp(r.x0, r.x1, (mosm - AX.m0) / (AX.m1 - AX.m0)), lerp(r.y0, r.y1, (V - AX.v0) / (AX.v1 - AX.v0))]
}

export type CellMark = { mosm: number; V: number; sph: number; cren: number; lysis: number; x: number; y: number; z: number; s: number }
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const state = (mosm: number) => {
  const V = rbcVolume(mosm)
  return { mosm, V, sph: smoothstep(1.0, RBC_LYSE, V), cren: smoothstep(1.0, 0.8, V), lysis: V >= RBC_LYSE ? smoothstep(0, 0.35, (V - RBC_LYSE) / 0.6) : 0 }
}

const ROW = [-9, 0, 9]
const MARK_RBC = 0.42
const MARK_PLANT = 0.5

/** the four red cells: hypertonic, isotonic, hypotonic and the rider */
export function rbcMarks(aspect: number): CellMark[] {
  const f = film
  const g = f.tonicG
  // when the plant cells join, the red cells shrink to dots on their curve
  const k = lerp(1, 0.38, f.plantA * g)
  const out: CellMark[] = []
  const mos = [ISO_MOSM + 150 * f.tonicH, ISO_MOSM, ISO_MOSM - 200 * f.tonicO]
  mos.forEach((m, i) => {
    const s = state(m)
    // on the graph a burst cell is shown where it burst
    const plotM = Math.max(m, lyseMosm)
    const [gx, gy] = toWorld(plotM, Math.min(s.V, RBC_LYSE), aspect)
    // in flight their paths cross, so they pass at different depths, and lift like cards being dealt
    const arc = Math.sin(Math.PI * g)
    out.push({ ...s, x: lerp(ROW[i], gx, g), y: lerp(0, gy, g) + arc * (1 - i) * 3, z: arc * (i - 1) * 9, s: lerp(1, MARK_RBC * k, g) })
  })
  // the rider slides down the whole curve, from 600 mOsm/L to where it bursts
  const r = f.rider
  const m = 600 - 470 * smoothstep(0, 1, r)
  const s = state(m)
  const [gx, gy] = toWorld(Math.max(m, lyseMosm), Math.min(s.V, RBC_LYSE), aspect)
  out.push({ ...s, x: gx, y: gy, z: 0, s: MARK_RBC * k * f.riderOn })
  return out
}

/** the plant cells: plasmolysed, flaccid, turgid */
export const PLANT_MOSM = [500, 300, 100]
export function plantMarks(aspect: number) {
  const g = film.tonicG
  return PLANT_MOSM.map((m, i) => {
    const [gx, gy] = toWorld(m, plantVolume(m), aspect)
    return { x: lerp(ROW[i], gx, g), y: lerp(0, gy, g), s: lerp(1, MARK_PLANT, g) }
  })
}
