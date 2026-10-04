# Milestone 4 — Chunked terrain development prototype

The default scene is now a 12 × 12 m volumetric sandbox with a shallow bed and taller bank. The existing force-limited bucket can excavate, carry, move across the map, and dump material. The frozen soil constitutive model is unchanged; the initial terrain uses a coarser numerical discretization than the laboratory.

## Representation and scheduling

The initial samples are seeded inside the physics boundary margin so waking an edge chunk does not forcibly relocate its initial material. The map contains 7,650 physical samples in 576 one-metre chunk slots across a 12 × 4 × 12 m domain. Samples retain mass, moisture, fines, deformation, affine velocity, plastic volume, damage, and dilation in their original GPU buffers. There is no height field, chunk-to-chunk particle copying, sample reinitialization, or material deletion at activation boundaries.

A CPU scheduler assigns each chunk one of three roles: dynamic, sleeping boundary, or asleep. The bucket wakes its neighborhood. Moving samples wake their chunks and face neighbors; activity expires after a quiet interval. A one-chunk halo includes all 26 face/edge/corner neighbors to cover the transfer stencil and provides fixed boundary support. The GPU compacts participating sample indices once per batch and uses indirect dispatch for constitutive/transfer work. Only participating grid nodes are cleared/updated each substep. The indirect arguments are copied into a separate buffer before use, avoiding a WebGPU storage-write/indirect synchronization conflict.

Sleeping sample states are never rewritten. Boundary samples contribute to the transfer grid without committing constitutive changes; their grid velocities are fixed. The boundary is an approximation until woken, not a physically simulated distant region. Disturbances can spread through neighbors without a fixed maximum active-chunk budget.

A 25 cm three-dimensional occupancy graph is rebuilt from occasional material diagnostics. Flood fill from the bed identifies disconnected volumes. Losing an occupied voxel beneath remaining material wakes adjacent chunks; disconnected volumes wake regardless of distance from the bucket. Occupancy records cavities and overhangs rather than storing only the highest point in a column. This conservative geometric wake-up method does not solve global stress balance or predict fracture by itself; the active soil solver supplies subsequent motion/failure.

## Rendering

The terrain uses a 25 cm physics grid, 20 cm initial sample spacing, and a 16 cm visual density field. The laboratory retains its existing grid and surface settings. The terrain surface allows 262,144 triangles; the original lab allocation remains unchanged. The first attempt at retaining the lab-sized surface overflowed on the larger map, so the final terrain field is coarser and its mesh budget larger. Paused surfaces are cached and rebuilt after simulation, support, or display changes.

## Validation

Build and unit checks pass. Scheduler tests verify deterministic volumetric seeding, a support-removal case spanning chunk boundaries, moving-material wake-up, return to sleep, and a smaller active node list than the full grid.

The [integrated-Vega GPU check](terrain-validation.json) runs 300 fixed batches of excavation/curl/lift/move/tip and checks every material snapshot:

- No invalid material states; mass drift stays below 0.001%; corrected collider overlap stays below 1 mm.
- 2,217 samples move more than 5 cm; peak geometric bucket contents are approximately 1,007 kg. Contents are a diagnostic containment estimate, not calibrated bucket capacity.
- 332 samples in chunks that never become dynamic remain exactly identical, including all 36 floats of material state.
- Activity propagates: 277 chunk slots become dynamic during the sequence; final scheduling has 79 dynamic, 186 boundary, and 64 occupied sleeping chunks. Not all chunk slots contain material.
- A remote unsupported wet clump initially spans eight chunks, outside bucket activation range. It wakes and falls from roughly 2 m to a centre height of 0.376 m in 1.905 simulated seconds, retaining mass and finite states.
- The final terrain mesh has 90,700 triangles with no overflow. The excavated bank and bucket contents were visually inspected.

## Original active performance on integrated Vega

These measurements precede the [performance revision](PERFORMANCE-REVISION.md), which brings the current terrain scene to approximately 60 FPS.

[Saved measurement](terrain-vega-benchmark.json), 1,440 × 960 viewport, continuous surface, force-limited automated scoop, 25 cm physics grid and 7,650 samples:

| Material | FPS | Frame p95 | Simulation throughput |
| --- | ---: | ---: | ---: |
| Sand | 27.4 | 50.1 ms | 1.00× |
| Soil | 30.0 | 33.5 ms | 1.00× |
| Wet dirt | 30.0 | 33.5 ms | 1.00× |

The adapter and renderer confirm AMD GCN-5/Vega. All three runs have zero invalid states, zero corrected overlap, and no surface overflow. Sand retains zero permanent compaction. These runs miss the 60 FPS target; active physics batches reach approximately 17–18 ms as wake-up spreads. Full state/occupancy diagnostics, boundary transfers, rendering, and synchronization also contribute. FPS is not improved by slowing simulation time. Smaller local surface cost (about 1.2 ms at the last samples) alone does not solve the total budget.

The benchmark records actual solver grid spacing and sample count. All timing includes normal diagnostic work; paused screenshots are not performance measurements.

## Remaining scope

This is the terrain architecture and interaction proof, not the completed full sandbox:

- The planned 40 × 40 m map and several metres of excavation depth are not implemented yet. The current bedrock plane limits excavation depth, while the raised bank provides accessible volumetric ground.
- Initial terrain uses one material preset; layered/mixed terrain layouts remain to be added. Transported samples retain their own composition.
- Grid storage is still densely allocated for this bounded map; only execution is sparse. A 40 m world needs sparse allocation or streamed active tiles, and cached local surface updates.
- The entire visible density surface is rebuilt when the simulation advances. Rendering cost does not yet scale only with changed chunks.
- Occupancy/speed diagnostics run periodically. Faster motion, long thin bridges, stressed but connected ground, and articulated machine contact need stronger boundary/wake tests.
- Sleeping boundaries temporarily act as fixed support. Before accepting larger terrain, compare frontier motion with a fully active reference and measure delayed collapse or seam artifacts.
- The existing restricted bucket fixture is still present; tracked machine, joints, traction, rocking, and tipping remain milestone 5.

Material calibration and the 60 FPS acceptance target remain explicit open items. Preserve this development scene and its regression checks when moving to the machine; continue scaling/performance work before claiming the full terrain milestone complete.
