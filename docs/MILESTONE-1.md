# Milestone 1: physics laboratory

Implemented a small Three.js/WebGPU scene with a kinematic open bucket, six reproducible scenarios, seven continuous material controls, and exportable performance/physics reports.

## What has been verified

The integrated AMD adapter was selected explicitly through the Radeon Vulkan driver. WebGPU reports `amd / gcn-5`, with no fallback adapter. Chromium's hardware renderer reports AMD Radeon Graphics; PCI device `1002:1638` matches the integrated GPU. These measurements did not use the RTX 3060.

The hardware browser test advances sand, soil, wet dirt, and mixed material through roughly two simulated seconds, then removes the bridge support and advances further. It checks finite states, positive deformation determinants, and conserved particle mass. The bridge center of mass dropped from approximately 1.217 m to 0.660 m after support removal. Sand settled with a final maximum speed of approximately 0.037 m/s. Sampled final collider penetration was zero; mass drift remained below 0.000005%.

GPU pass batching preserved the deterministic scenario snapshots, including settled positions, velocities, and contact reactions. It changes dispatch overhead, not equations or timesteps.

## Measured performance

Chromium 152, headless at 1440 × 960, integrated AMD GPU, 15 seconds per active scoop cycle. Each scene contains approximately 2.61 m³ of soil.

| Grid spacing | Point budget | Actual points | FPS | Frame p95 | Physics rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| 12.5 cm | 4,096 | 3,519 | 59.3 | 17.0 ms | 1.000× |
| 10 cm | 4,096 | 3,519 | 59.4 | 16.9 ms | 1.000× |
| 8 cm | 4,096 | 3,519 | 30.0 | 33.6 ms | 1.000× |
| 12.5 cm | 8,192 | 7,560 | 49.5 | 33.5 ms | 1.000× |
| 10 cm | 8,192 | 7,560 | 29.3 | 49.7 ms | 1.000× |
| 8 cm | 8,192 | 7,560 | 29.1 | 49.9 ms | 1.000× |
| 12.5 cm | 16,384 | 14,985 | 28.3 | 50.0 ms | 1.000× |
| 10 cm | 16,384 | 14,985 | 26.2 | 50.3 ms | 1.000× |
| 8 cm | 16,384 | 14,985 | 20.0 | 50.2 ms | 0.916× |

The low-budget 12.5 and 10 cm configurations approach 60 FPS, but neither meets the strict 16.7 ms p95 frame target in this run. The default remains 12.5 cm / 4,096 requested points: it provides more samples per grid cell than the same point count on finer grids. Denser configurations need further optimization before committing to full-world performance. No tested run reported invalid states or sampled final bucket penetration. These are sampled diagnostics, not a proof that every intermediate contact is exact.

## How to interpret the prototype

This milestone demonstrates a unified material framework and provides a measurement harness. It does not establish calibrated soil behavior, realistic machine dynamics, or a final full-world performance guarantee.

Resolution and particle count must be considered together. A finer grid with too few material points can undersample the continuum; a high FPS result alone does not demonstrate sufficient physical accuracy. The default low point budget is a feasibility setting, not a final terrain-detail target. The lab represents 1–3.5 cubic metres of active material depending on scenario, within a 6 × 4 × 4 metre bounded domain. A complete 40 × 40 metre world will require sparse activation and support-aware sleeping.

Wetness currently changes cohesion and deformation resistance within the soil constitutive model. Separate fluid flow, pore pressure, drainage, and physical grain segregation remain future work. Material composition travels with particles, so mechanically interacting inputs retain their properties rather than switching solver type when mixed.

The displayed grains are continuum samples. Smooth surface reconstruction, calibrated clump fracture, improved bucket-boundary separation, and accurate force-limited machine coupling are not part of this milestone.

## Reproduce

See [README.md](../README.md) for the local browser setup and commands. Run the hardware test for sustained correctness checks, then the benchmark matrix for active scoop measurements. Raw artifacts are generated under `.local/artifacts/`; the checked-in summary is in [vega-benchmark.json](vega-benchmark.json).

## Next engineering work

Use the measured limits to optimize transfers, grid occupancy, and constitutive evaluation before increasing active material volume. Preserve physical substeps and conservation while doing so. Add resolution-convergence tests and slope/compaction calibration before treating the material presets as realistic soil parameters. Proceed to sparse full-world storage only once the local bucket/material test has adequate fidelity at the measured frame budget.
