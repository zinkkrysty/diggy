# Milestone 2 · Continuous material presentation

Implemented in the existing six-metre soil lab; the full machine and world remain later milestones.

## Behavior changes

Grid contacts previously extended into the air by approximately one grid cell. Floor and bucket contacts now act at the actual collider boundary; particle correction also resolves floor velocity. Dry sand now starts at zero water content, avoiding unintended moisture-derived cohesion. Wetness and composition still use the same constitutive model. Jacobi eigenbasis rotations use an algebraic expression instead of trigonometry, retaining the spectral material calculation.

These changes improve contact and dry behavior but do not establish calibrated soil mechanics. The approximate settled sand flank is only about 13 degrees in the coarse pile test, despite a higher nominal friction setting. Calibration of the plasticity/friction response remains necessary. Fine grains must not conceal physically stuck material.

## Presentation

GPU compute splats normalized compact-support density kernels, clips the field against floor/bucket geometry, and extracts a connected surface using marching tetrahedra. Reconstruction is camera-independent and volumetric, so cavities are representable. The visual grid is now 6 cm; it is independent of the physical grid and effective material grain size. An isotropic support radius of 1.85 sample spacings smooths coarse sampling. Thin features and narrow gaps still require visual review.

The surface uses matte triplanar fine texture, moisture/composition shading, and shadows. Small massless ballistic grains follow exposed moving material, with reduced emission for cohesive dirt. Sparse physical samples retain small matte, shaded volume proxies when below the surface threshold. Each follows one physical sample without random jitter and retains its reference-volume radius when no surface exists. Turning off optional spill effects preserves those volumes; raw-point mode exposes the physical samples directly.

The mesh, normals, particle data, and indirect draw count stay on the GPU. Occasional asynchronous diagnostics report compute time and overflow. The mesh allocation supports 65,536 triangles; overflow is explicit. Visual buffers currently use roughly 10 MB in these tests, excluding renderer textures and driver allocations.

## Validation

`npm run build`, `npm test`, browser smoke checks, and `npm run test:materials` pass. GPU validation covers dry pouring, two pile resolutions, wet clumps, support removal, and mixing:

- No invalid states, surface capacity overflow, or sampled collider penetration.
- Relative mass drift below 0.000004%.
- Isolated free fall differs from the analytic position by about 3 mm after 0.389 s.
- Dry floor sample centres sit about 8–10 mm above the floor, rather than the previous grid-sized contact gap.
- Coarse/finer pile centre heights differ by 17 mm; spreads differ by about 2%. This is a limited comparison, not a convergence proof.
- Visual toggles leave particle positions and state exactly unchanged while paused.

Snapshots and profile estimates are in [material-validation.json](material-validation.json). Batched explicit-advance GPU times in that file are not frame timings.

## Vega measurements

Active 15-second scoop/curl/lift/dump tests at 1440 × 960 verify the AMD GCN-5 adapter and hardware renderer. Initial combined measurements before the undermine revision:

| Configuration | Average FPS | p95 frame time | Simulation rate |
| --- | ---: | ---: | ---: |
| Sand, 12.5 cm, 4,096 budget, raw points | 59.9 | 17.0 ms | 1× |
| Sand, same budget, surface without optional spill | 59.8 | 16.9 ms | 1× |
| Sand, same budget, surface and spill | 59.7 | 16.9 ms | 1× |
| Sand, 10 cm, 4,096 budget, surface and spill | 56.0 | 33.2 ms | 1× |
| Sand, 12.5 cm, 8,192 budget, surface and spill | 29.4 | 33.8 ms | 1× |
| Wet dirt, 12.5 cm, 4,096 budget, surface and spill | 59.2 | 17.0 ms | 1× |

See [full measurements](vega-presentation-benchmark.json). An earlier [two-material repeat](vega-presentation-final-check.json) after the shading fix measured sand at 58.2 FPS (17.1 ms p95) and wet dirt at 59.7 FPS (16.9 ms p95), both at approximately 1× simulation rate with no invalid states or sampled penetration. These approach the target at the coarse setting but do not pass a strict 16.7 ms p95 requirement. They cover the small lab and kinematic bucket, not full-world digging or force-limited hydraulics. Denser settings need further optimization.

## Next review

Compare surface and raw-point views while pouring, spilling, and removing support. Assess whether sand flows naturally, wet dirt holds and breaks plausibly, and contact stays convincing from different angles. Calibrate dry pile friction before accepting material behavior and proceeding to force-limited bucket coupling. Sparse world activation and long-session validation remain future work.

## Undermine feedback revision

The reported scattered dots were the sparse-sample carrier effect. It substituted six tiny jittered grains for each physical sample whenever the density fell below the surface threshold. Those carriers are removed. A lower surface threshold (0.12 versus 0.38), finer visual grid, and shaded fallback volume retain small detached quantities. Optional ballistic detail has much lower emission, less position jitter, and a shorter lifetime. This changes presentation, not physical mass or digging forces. The lower threshold thickens visible thin features; the reconstruction is not a measurement of material volume.

The constitutive update now tracks stress-free dilation in the unused history component, following the volume-correction treatment described in [granular MPM research](https://gmd.copernicus.org/articles/18/9149/2025/index.html). For loose material, subsequent compression closes this free volume before building elastic pressure, rather than treating each expanded state as a fresh bonded rest shape. Cohesion smoothly reduces this correction, preserving bonded wet-material behavior. Initial sample jitter is also increased within each sampling cell to reduce lattice-aligned rows, while preserving seed mass, composition, and repeatability.

A GPU expansion/recompression probe verifies that the dilation gap persists, is consumed by recompression, and eventually restores pressure. Isolated visibility checks cover four positions within a visual voxel at both 4,096 and 16,384 budgets, including the case where extraction emits no triangles: the fallback retains its full reference-volume radius. The central dry bridge no longer survives the support-removal test. Conservation, contacts, finite state, mixed materials, wet clumps, and the two-resolution pile comparison pass.

This is an intermediate improvement, not acceptance of sand realism. The coarse stable-pile estimate remains about 13 degrees, and the poured pile is shallower still. Motion near pier edges and thin streams require further review and material/contact tuning. Shading alone cannot resolve those physical limitations.

See [revised material checks](material-validation-undermine.json), [revised scoop timings](vega-undermine-revision-scoop.json), and [support-removal timings](vega-undermine-revision-collapse.json). The revised coarse scoop and support-removal runs both average about 59.8 FPS, with 16.8–16.9 ms p95 frame times and approximately 1× simulation throughput on Vega. The earlier table remains a historical baseline.

## Rebound and material-response revision · 2026-10-04

User review found springy pile/drop behavior across all materials, sand that felt sticky/liquid-like, and dry soil that should hold together more firmly. Collider restitution was already zero. The update addresses energy stored in the continuum and its APIC transfers:

- Add grid-scaled bulk dissipation during load-bearing compression/unloading. Stress-free dilation and translation remain undamped; dry sand gains no shear-viscosity parameter.
- Recompute the allowable shear strain from the pressure remaining during unloading. Loose sand must not retain bonded-looking shear resistance after that pressure disappears.
- Remove inward normal affine motion during particle contact, relative to the rigid collider’s motion. Previously only particle velocity was resolved, allowing inward subcell motion to feed the next transfer.
- Raise the dry-soil preset from 650 to 1,500 Pa base cohesion and from 65 to 85 kPa stiffness. The wet-dirt preset values remain unchanged; the common rebound fixes apply to it.
- Include the explicit bulk-diffusion timestep bound, so stronger damping is not introduced without its stability cost.

A new GPU regression samples 55 points in each pile and clump-drop timeline for all three materials. It checks post-contact upward kinetic energy and mass-weighted upward velocity, as well as finite states, mass, and contact. These are numerical prototype comparisons, not laboratory calibration. Soil’s timestep changes with its new stiffness, so its timeline covers a shorter duration; impact peaks remain within both windows.

| Experiment | Material | Before peak upward energy | After | Reduction |
| --- | --- | ---: | ---: | ---: |
| pile | sand | 218.3 J | 5.30 J | 97.6% |
| pile | soil | 85.7 J | 12.54 J | 85.4% |
| pile | wet | 456.6 J | 42.53 J | 90.7% |
| clump | sand | 322.0 J | 0.03 J | 100.0% |
| clump | soil | 556.6 J | 3.59 J | 99.4% |
| clump | wet | 103.2 J | 9.92 J | 90.4% |

See [before timelines](rebound-before.json), [after timelines](rebound-after.json), and [material regressions](material-validation-rebound.json). `npm run test:rebound` requires peak upward energy below 40% of the saved baseline and peak bulk upward velocity below 0.16 m/s in every case. The measured final values are lower, including no net upward rebound in the sand clump-drop timeline.

Build, unit tests, rebound checks, and material regressions pass. Free fall, isolated-volume visibility, pressure recovery, mass conservation, wet clumps, support removal, and the two-resolution sand-pile comparison remain covered. Dry-pile slope estimates remain only about 14 degrees, so material calibration and further user review are still required. This revision keeps the same surface presentation and restrained loose-particle effect.

Current three-material scoop timings are saved in [rebound revision benchmark](vega-rebound-revision.json): sand 59.6 FPS, firmer soil 59.3 FPS, and wet dirt 59.6 FPS. All maintain approximately 1× simulation rate; p95 frame time is 16.8 ms, with no sampled invalid states, penetration, or surface-capacity overflow.
