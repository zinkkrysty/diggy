# Terrain performance revision

Measured on AMD Vega integrated graphics, Chromium WebGPU, 1440 × 960, continuous surface rendering and automated force-limited digging. Physics uses the existing 25 cm grid, 7,650 samples and unchanged stable timestep/material model.

| Material | Previous terrain FPS | Current FPS | Current p95 frame | Simulation speed |
| --- | ---: | ---: | ---: | ---: |
| Sand | 27.4 | 59.8 | 16.8 ms | 1.00× |
| Soil | 30.0 | 59.8 | 16.8 ms | 1.00× |
| Wet dirt | 30.0 | 59.8 | 16.8 ms | 1.00× |

Previous measurements are in [the original benchmark](terrain-vega-benchmark.json); current measurements are in [the paired benchmark](terrain-optimization-ab.json). Each current run lasts 15 seconds. This meets the practical approximately-60 FPS goal for this scene, although p95 is slightly above the strict 16.7 ms budget. It does not establish performance for a larger world or every camera/terrain configuration.

## Changes

- Sleeping terrain remains frozen, with dynamic neighbors, support removal and disconnected material waking it. Reusable occupancy/BFS storage avoids per-sample allocations; support connectivity is rebuilt only when occupancy changes.
- Fixed halo material transfers are computed once per simulation batch and cached as the same integer grid contributions. Dynamic samples still update at every original physics substep.
- GPU compaction draws only visible detached physical volumes. The previous renderer submitted 7,650 proxy instances, mostly invisible; final optimized runs draw 11, 7 and 0 respectively. Empty spill effects also skip their draw. Small pieces retain their physical-volume representation.
- Physics/contact readback overlaps rendering. The next frame waits for required bucket feedback without also waiting for the entire preceding render. GPU queue order protects shared buffers; work remains bounded. HUD updates run five times a second.

The final paired runs disable boundary caching and proxy compaction for reference measurements, while retaining CPU and frame-scheduling improvements in both runs. Both configurations reach the display ceiling. Cached physics nevertheless reduces GPU compute work and compacted draws reduce vertex work; the largest frame-rate improvement came from avoiding unnecessary serial synchronization. CPU analysis fell from roughly 7 ms to roughly 2 ms in development profiles.

## Correctness

[Fixed-step cache comparisons](terrain-cache-validation.json) across sand, soil and wet dirt report zero differences in positions, all 36 per-sample state values, and bucket reaction. No material tuning or larger timestep was introduced.

The terrain regression confirms unsupported remote material falls, 332 never-active samples retain byte-identical positions/history, and the scoop moves 2,217 samples while holding up to 1,006.6 kg. Surface reconstruction produces 90,700 triangles with no overflow and draws all 49 detached volumes. Build and unit tests pass. Saved [terrain checks](terrain-optimized-terrain-validation.json) and [material visibility/behavior checks](terrain-optimized-material-check.json) report no browser errors.
