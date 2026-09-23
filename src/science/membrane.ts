/* ==========================================================================
   THE NUMBERS
   Every figure the copy quotes is either a textbook value (OpenStax
   Biology 2e, ch. 4–5) or computed here from standard physiology, so the
   prose and the instruments cannot drift apart.
   ========================================================================== */

/* physical constants */
export const R_GAS = 8.314 // J mol⁻¹ K⁻¹
export const FARADAY = 96485 // C mol⁻¹
export const T_BODY = 310.15 // K (37 °C)

/* ---- structure (§5.1) ---------------------------------------------------- */
export const THICK_NM = [5, 10] as const // plasma membrane thickness
export const RBC_UM = 8 // red blood cell diameter
export const rbcRatio = Math.round((RBC_UM * 1000) / ((THICK_NM[0] + THICK_NM[1]) / 2) / 1000) * 1000 // ≈ 1 000×

/** % by mass (protein, lipid, carbohydrate) */
export const COMPOSITION = [
  { name: 'Typical human cell', p: 50, l: 40, c: 10 },
  { name: 'Myelin', p: 18, l: 76, c: 6 },
  { name: 'Inner mitochondrial', p: 76, l: 24, c: 0 },
]

export const HISTORY = [
  { y: '1890s', t: 'The plasma membrane is identified' },
  { y: '1915', t: 'Its chemistry: lipids and proteins' },
  { y: '1935', t: 'Davson & Danielli: the protein–lipid–protein sandwich' },
  { y: '1950s', t: 'Electron micrographs: a lipid bilayer' },
  { y: '1972', t: 'Singer & Nicolson: the fluid mosaic model' },
]

/* ---- cytoskeleton (§4.5) ------------------------------------------------- */
export const FILAMENTS = [
  { name: 'Microfilament', prot: 'Actin', d: [7, 7], role: 'Cell shape, movement, cytokinesis; the cortex under the membrane' },
  { name: 'Intermediate filament', prot: 'Keratin and others', d: [8, 10], role: 'Tension; anchor the nucleus; desmosomes' },
  { name: 'Microtubule', prot: 'α/β-tubulin', d: [25, 25], role: 'Tracks for vesicles; spindle; cilia and flagella' },
]

/* ---- diffusion (§5.2) ---------------------------------------------------- */
/** O₂ in water at 37 °C, m² s⁻¹ */
export const D_O2 = 3.0e-9
/** mean time to diffuse a distance x (1-D), t = x² / 2D */
export const diffTime = (x_m: number, D = D_O2) => (x_m * x_m) / (2 * D)
export function fmtTime(s: number) {
  if (s < 1e-3) return `${(s * 1e6).toPrecision(2)} µs`
  if (s < 1) return `${Math.round(s * 1000)} ms`
  if (s < 120) return `${s.toPrecision(2)} s`
  if (s < 7200) return `${Math.round(s / 60)} min`
  if (s < 3 * 86400) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} days`
}

/* transport rates (§5.2) */
export const RATE_CHANNEL = '10⁷' // "tens of millions" per second
export const RATE_CARRIER = '10³–10⁶'

/** carrier-mediated flux saturates (hyperbolic), simple diffusion is linear */
export const carrierFlux = (c: number, vmax = 1, km = 0.25) => (vmax * c) / (km + c)

/* ---- osmosis & tonicity (§5.2) ------------------------------------------- */
export const ISO_MOSM = 300 // cytoplasm of a human cell, mOsm L⁻¹ (approx.)
/** Boyle–van 't Hoff: V/V₀ = b + (1 − b)·π₀/π, b = osmotically inactive fraction */
export const RBC_B = 0.4
export const rbcVolume = (mosm: number) => RBC_B + (1 - RBC_B) * (ISO_MOSM / Math.max(mosm, 1))
/** a red cell lyses once it has swollen to a sphere, ~1.6× its resting volume */
export const RBC_LYSE = 1.6
export const lyseMosm = ((1 - RBC_B) * ISO_MOSM) / (RBC_LYSE - RBC_B) // ≈ 150
/** NaCl % (w/v) → mOsm L⁻¹, ideal (2 particles per formula unit) */
export const salineMosm = (pct: number) => ((pct * 10) / 58.44) * 2 * 1000
export const FISH_ENERGY = 5 // % of metabolic energy on osmotic homeostasis

/* ---- the electrochemical gradient (§5.3) --------------------------------- */
/** typical mammalian concentrations, mM */
export const ION = {
  Na: { out: 145, in: 12, z: 1 },
  K: { out: 4, in: 140, z: 1 },
}
export const V_REST = -70 // mV, typical resting potential (neuron)
/** Nernst potential, mV */
export const nernst = (out: number, inside: number, z = 1, T = T_BODY) => ((R_GAS * T) / (z * FARADAY)) * Math.log(out / inside) * 1000
export const E_NA = nernst(ION.Na.out, ION.Na.in)
export const E_K = nernst(ION.K.out, ION.K.in)

/** free energy to move one mole of ion inward (kJ mol⁻¹); negative = downhill */
export const dGin = (out: number, inside: number, z: number, vm_mV = V_REST) =>
  ((R_GAS * T_BODY * Math.log(inside / out)) + z * FARADAY * (vm_mV / 1000)) / 1000

/** work per Na⁺/K⁺-pump cycle: 3 Na⁺ out, 2 K⁺ in */
export const PUMP_WORK = 3 * -dGin(ION.Na.out, ION.Na.in, 1) + 2 * dGin(ION.K.out, ION.K.in, 1)
export const ATP_DG = 50 // kJ mol⁻¹ available from ATP hydrolysis in a cell (≈ 50–60)

/** ATP synthase (c₁₀ ring): 10 H⁺ per turn, 3 ATP per turn */
export const SYNTHASE = { c: 10, atpPerTurn: 3 }
