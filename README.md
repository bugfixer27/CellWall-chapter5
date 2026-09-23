# Membrane

The structure and function of plasma membranes (OpenStax *Biology 2e*,
chapter 5), opening with a cinematic recap of the cell (chapter 4): an
editorial scroll film with real-time 3D sets. It starts at a whole cell,
zooms 2 000× into its surface, and follows every way a molecule can cross.
It is a companion to *Sea Breeze*.

## Run it

**On GitHub Pages:** push to `main` and the workflow in
`.github/workflows/deploy.yml` builds and publishes the site. The first time,
open the repository's **Settings → Pages** and set **Source** to
**GitHub Actions**. The site appears at `https://<user>.github.io/<repo>/`.

**Locally:** double-click **`launch.command`**. It installs dependencies on
first run, starts the dev server on port 5179 and opens Chrome. Or:

```bash
npm install
npm run dev
```

Best in desktop Chrome with a recent GPU (developed on an Apple M1 Pro).

## What's on the page

| | Chapter | Set piece |
|---|---|---|
| 00 | Membrane | A glass liposome (a cell drawn as only its membrane) lenses the headline. Its rim shows the bilayer as two bright tracks. It dents under the cursor. |
| 01 | The cell, inside (§4.3–4.4) | 262 144 points form a fluorescent cell with a numbered tour of its organelles. **Transition:** the camera rides one vesicle out of the rough ER, through the Golgi stack and into the plasma membrane. At fusion a ripple runs across the surface and the whole cell lies down into an engraved flow map (nucleus → ER → Golgi → vesicle → membrane), where the microtubules become the map's arrows. |
| 02 | Scaffold and seams (§4.5–4.6) | Actin cortex, intermediate filaments, microtubules from a centrosome with nine-triplet centrioles. The page turns to an engraved plate of the four cell junctions. A lens-portal dives into the membrane. |
| 03 | Fluid mosaic (§5.1) | About 10 000 instanced phospholipids flow as a 2-D liquid, with cholesterol, glycolipids and proteins grown from their helices by marching cubes. |
| 04 | Phospholipids | Engraved plate: one phospholipid, then every lipid scatters into water and self-assembles into micelles, a liposome and a bilayer sheet. |
| 05 | Fluidity | Cross-section. Temperature falls to 4 °C: saturated tails straighten and pack; unsaturated kinks glow. Cholesterol. |
| 06 | Proteins and sugars | Peripheral and integral proteins, the glycocalyx. HIV's envelope descends onto CD4. |
| — | Selectively permeable | The sentence falls onto a drawn bilayer. O₂, CO₂ and fat-soluble vitamins fall through; ions and sugars pile up on top. |
| 07 | Diffusion (§5.2) | Every molecule is a scroll-reversible random walk. The chart of O₂ and CO₂ reaching equilibrium is counted from the molecules on screen. |
| 08 | Facilitated transport | Aquaporin, a gated K⁺ channel that opens, a GLUT carrier. Saturation chart. |
| 09 | Osmosis and tonicity | Engraved U-tube, then raymarched red cells: crenation, lysis to a ghost. **Transition:** the scene flattens into a graph of cell volume against outside osmolarity; the cells fly onto the Boyle–van 't Hoff curve and a fourth rides it down until it bursts at ≈150 mOsm/L. The plant cells join the same axes (the wall caps the curve), then step out into close-up. |
| 10 | Active transport (§5.3) | The Na⁺/K⁺-ATPase in six steps. **Transition:** the membrane's picture tips back into the ground and rises into a free-energy landscape, one lane per ion. Switching on −70 mV steepens Na⁺'s cliff and levels K⁺'s. |
| 11 | Cotransport | On the landscape: the pump lifts both ions uphill; then 2 Na⁺ roll down and haul 1 glucose up. The terrain folds back into the membrane for ATP synthase. |
| 12 | Bulk transport (§5.4) | A cut-away cross-section: phagocytosis and a lysosome, pinocytosis, a caveola, a clathrin-coated pit with LDL, exocytosis. |
| 13 | The whole border | The whole cell eating, drinking and secreting at once. **Transition:** its plasma membrane unrolls like the skin of a globe into a flat map, and Table 5.2 is laid over it in three territories: passive, active, bulk. |

Throughout, as a lesson:

- **Spotlight.** At each moment the thing being taught stays sharp and bright; everything else softens and dims.
- **Key terms.** Bold terms light up in reading order, and each lights up the thing it names on screen (its label glows and the spotlight moves to it). Hovering a term does the same.
- **Predict → reveal.** Eight questions ask you to predict before the scene shows the answer.
- **Takeaways.** Each chapter ends on three lines that assemble out of the scene.
- **Legibility.** Nothing that teaches is smaller than 12 px, sized for a 13-inch laptop.

## Science notes

`src/science/membrane.ts` holds the numbers. Every value in the copy is
filled from it through `data-v` hooks (`src/science/derived.ts`):

- Nernst potentials at 37 °C for typical mammalian Na⁺/K⁺ (E_Na ≈ +67 mV, E_K ≈ −95 mV); the work of one pump cycle (≈ 44 kJ/mol against ATP's ≈ 50).
- Red cell volume by Boyle–van 't Hoff (b = 0.4). Lysis happens at the constant-area sphere, ≈ 1.6 V₀, which is reached at ≈ 150 mOsm/L. 0.9% saline ≈ 308 mOsm/L.
- Diffusion time t = x²/2D for O₂ (10 µm ≈ 17 ms, 1 cm ≈ 5 h).
- The landscape's heights are ΔG per mole of ion from the concentrations and the membrane potential (Na⁺ in: −13.2 kJ/mol at −70 mV; K⁺ in: +2.4). Glucose's 10× gradient is illustrative; 2 Na⁺ entering release ≈26 kJ/mol against its ≈6.
- Where the textbook simplifies, a short note says so: "integrins" vs integral proteins; clathrin vs actin in phagocytosis; micelles vs bilayers; the c-ring's 8 vs 10 subunits.

Not to scale, and labelled as such: ions and small molecules, the hero cell's refraction, and time. The flow map and the membrane map are diagrams, not micrographs.

## Dev handles

- `?f=5.5` jumps to a moment of the film (0 = hero … 14 = end).
- `__m.go(10.4)` does the same from the console.

## Layout

```
index.html            all copy: semantic and readable without WebGL
src/
  science/            the numbers
  core/film.ts        scroll → film time F → sets, cameras, stages
  gl/cell.ts          the particle cell
  gl/bilayer.ts       instanced lipids, cholesterol, glycolipid sugars
  gl/proteins.ts      marching-cubes proteins and their motions
  gl/molecules.ts     scroll-reversible molecules and scripted passages
  gl/glass.ts         raymarched liposome, red and plant cells, bulk transport
  gl/land.ts          the free-energy landscape
  core/graph.ts       the tonicity graph: where the cells sit on it
  dom/lesson.ts       key terms, takeaways, the graph's axes, the membrane map
  gl/engine.ts        render graph: set → portal → plates → bloom → grade/engraving
  dom/                beats, instruments, 3-D labels, the sieve, junction plate
```

Source text: Clark, Douglas & Choi, *Biology 2e*, OpenStax (2018), CC BY 4.0.
