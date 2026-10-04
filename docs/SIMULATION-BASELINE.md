# Frozen material baseline — 2026-10-04

The user chose to stop material tuning for now and develop the game. This is a development checkpoint, not final acceptance of soil realism or performance.

The unified WebGPU MLS-MPM/APIC material model remains in place: continuous moisture/composition, friction, cohesion, shear stiffness, viscosity, and adhesion. Bulk modulus is 2 MPa. Coarse sand has zero permanent compaction; fine soils compact only beyond a pressure threshold with hardening. Reference mass, plastic rest volume, and recoverable deformation are separate.

Copies of the exact pre-coupling shader and material settings are in `checkpoints/soil-model-2026-10-04.wgsl` and `checkpoints/material-2026-10-04.ts`. These preserve the material implementation for later comparison. Do not restore the whole old shader over new contact-coupling work: compare constitutive and transfer sections first.

## Evidence

- [Controlled compaction checks](compaction-validation.json): 10 kPa creates no permanent compaction; repeated 80 kPa loading leaves sand unchanged and compacts the fine-soil presets within their limits. Recoverable compression unloads.
- [Volume and visibility checks](material-validation-volume.json): conservation, finite states, contact, support removal, small quantities, and visual/physical separation pass.
- [Rebound revision checks](rebound-volume-revision.json): pile/drop upward kinetic energy is much lower than the earlier baseline across all three presets.

## Revisit later

- Dry sand still makes shallow piles; friction and flow need calibration and visual review.
- The latest volume-preserving version runs around 31–36 FPS with 0.74–0.85× simulation throughput on integrated Vega in active coarse scoop measurements. The historical near-60 FPS results were from an earlier model. The 60 FPS goal remains unmet.
- Wet dirt is a moisture-dependent solid continuum, without a separate water phase, drainage, or pore pressure.
- Fine spill grains and surface reconstruction are presentation; they do not add physical mass.

Continue gameplay work without changing these material rules. Optimize active regions, coupling, and rendering as the world grows, then explicitly return to material calibration and integrated performance validation.
