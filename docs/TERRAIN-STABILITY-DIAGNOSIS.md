# Deep terrain stability and integrated AMD performance

Measured October 5, 2026 on Chromium WebGPU, native AMD GCN-5/Vega integrated graphics (not a fallback adapter). Gameplay reproduction uses a 1440 × 960 viewport. This document records the original investigation and comparison prototype. The production changes and validation are recorded in [TERRAIN-STABILITY-FIX.md](TERRAIN-STABILITY-FIX.md).

## Findings

The deeper seed has 146,892 material samples, versus 7,650 in the earlier performance milestone. Each sample starts with an identity deformation gradient and zero velocity: the buried soil has no initial compressive stress to balance its weight. Sleeping material stays frozen, which conceals that imbalance until activation.

Track motion wakes a two-metre sphere around each belt. That includes buried material, rather than just the contact footprint. Once a sample exceeds 0.08 m/s, its entire chunk and face neighbors wake for two simulated seconds. Newly awakened stress-free soil then settles too. This creates a self-propagating activation front. A floating bucket also wakes material through proximity, even before actual contact.

In a straight driving reproduction, active chunks rose from 87 to 2,282; all occupied chunks eventually left sleep. GPU physics time rose from 11.98 ms to 253.17 ms per 32-substep batch. The batch advances only 31.60 ms of simulation. After driving and stopping, 146,837 samples had moved more than 1 cm, including 129,519 outside a three-metre margin around the extended machine/bucket path. Mass stayed conserved and states remained finite: the current validity checks do not detect this unwanted behavior.

## Isolated causal comparison

Same seed, grid, timestep, material, and scheduler; no machine colliders or applied contact forces. Each run advances 72 batches, totaling 2.275 simulated seconds. Snapshots are taken every eight batches, so their timing and activation history differ from normal gameplay.

| Activation / initialization | Active chunks at first/final sample | Final physics batch | Samples displaced >1 cm | Samples displaced >1 cm beyond 4 m |
| --- | ---: | ---: | ---: | ---: |
| Airborne bucket proximity, shallow activation | 20 / 20 | 2.79 ms | 295 | 0 |
| Additional deep track-sized activation, current seed | 32 / 480 | 65.11 ms | 32,165 | 17,880 |
| Same deep activation, experimental initial stress | 32 / 32 | 5.22 ms | 0 | 0 |

The experimental seed uses pressure `p = density * 9.81 * max(0, 0.55 - y)` and isotropic deformation stretch `exp(-p / (3 * bulkModulus))`. Positions and mass remain unchanged. Peak sample speed fell from 1.97 m/s to 0.0053 m/s. This supports initial stress balance as a first fix; it is not validation of this simple pressure formula for the sand pile, driving, excavation, wet soil, or collapsing overhangs. A production seed needs local overburden/material accounting and equilibrium checks. It also changes deformation-derived visual density, which needs surface-level verification.

## Independent chassis wobble hazard

`supportHeights` reconstructs ground support through binary occupancy in 20 cm vertical bins. It requires uninterrupted occupancy from bedrock, and the chassis replaces the whole heightfield when any height changes by more than 6 cm. This happens through periodic snapshots rather than continuous support sampling.

A CPU probe at an undisturbed column produced:

| Uniform particle displacement | Reported support height |
| ---: | ---: |
| 0 cm | 0.55 m |
| +9.9 cm | 0.55 m |
| +10.1 cm | -1.85 m |
| -10.1 cm | 0.35 m |

The uplift case creates an empty bottom bin and reports bedrock as support, even though the material moved upward. This discontinuity can amplify soil motion into rocking or sudden chassis drops. It needs a connected, continuous support estimate with tolerance for sample deformation, spatial filtering, and smooth collider updates. Detached/bucket-carried material must still be excluded.

## Remaining performance costs

- Surface reconstruction scans all 146,892 samples and 889,239 density cells whenever simulation advances. It costs approximately 7.6–8.0 ms in the driving reproduction, even when the action is local. Sleeping physics does not cache the visible surface.
- Each diagnostic snapshot reads 23.50 MB of positions and all 36 state floats per sample. Measured CPU analysis costs approximately 30–40 ms during gameplay reproduction, before separately accounting for GPU transfer/synchronization. These snapshots also drive terrain connectivity and chassis support, so simply disabling them would break behavior.
- The stable timestep is approximately 0.987 ms: about 1,013 physics substeps per simulated second. Global activation therefore multiplies expensive spectral material projection and grid transfers. Larger timesteps or reduced render resolution would not address the activation defect.

## Recommended implementation order

1. Initialize buried soil near gravitational equilibrium, then verify that waking unchanged ground does not start a moving front or shift the surface.
2. Replace broad track spheres with actual contact-region activation. Keep unsupported material and genuine displaced material dynamic, but avoid spreading wake solely from small elastic velocities; include hysteresis and a quiet/deactivation rule.
3. Replace discontinuous chassis support reconstruction. Test small perturbations, real excavation, carried material, steep slopes, and re-entry across the verge.
4. Cache surface meshes/density per tile and rebuild only dirty tiles plus reconstruction halos. Use GPU reductions/local readback for motion, occupancy, support, and normal HUD metrics; retain full-state snapshots for explicit diagnostics.
5. Validate locality, material conservation, collapse, digging, and sustained integrated-GPU frame time together. Restricting all motion to a hard radius would incorrectly freeze real falls/collapses; indiscriminate damping would conceal the initialization problem.

## Reproduction artifacts

Local scripts: `.local/terrain-diagnosis.ts`, `.local/terrain-activation-probe.ts`, `.local/terrain-track-wake-probe.ts`, and `.local/terrain-prestress-probe.ts`.

Raw results and screenshots are under `.local/artifacts/`: `terrain-diagnosis.json`, `terrain-activation-probe.json`, `terrain-track-wake-probe.json`, `terrain-prestress-probe.json`, `terrain-waves-driving.png`, and `terrain-waves-stopped.png`.

Relevant implementation: `src/simulation/terrain.ts` (seed/activation), `src/simulation/ground-support.ts` (support quantization), `src/physics/chassis.ts` (heightfield replacement), `src/physics/solver.ts` (snapshots), and `src/render/surface.ts` (full-domain reconstruction).
