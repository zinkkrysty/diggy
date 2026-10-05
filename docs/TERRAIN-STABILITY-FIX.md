# Local terrain stability and performance fix

Implemented and measured October 5, 2026 on native AMD GCN-5/Vega WebGPU in Chromium, at a 1440 × 960 viewport.

Buried material now starts with compressive stress from the soil and sand above it. Particle positions, mass, and initial occupied volume remain unchanged, so the deeper excavation does not lower the surface. Actual collider footprints activate occupied terrain; ordinary elastic movement keeps its own chunk awake without waking successive neighbors. Unsupported material and removed support still trigger connectivity-based activation, allowing real falls and excavation.

Chassis support uses continuous connected particle intervals instead of quantized vertical occupancy. Small displacements no longer turn a soil column into a sudden bedrock drop. Detached material cannot create support beneath the machine.

Gameplay reads back positions and velocities only for active particles, updates their chunk/voxel membership and affected support columns, and retains full-state snapshots for explicit diagnostics. The renderer caches 36 surface tiles and rebuilds local tiles with reconstruction halos, including previous collider footprints so moving equipment does not leave clipped holes.

## Validation

`npm run test:terrain-stability` checks sand, soil, and wet dirt under deep activation; unsupported collapse; normal realtime driving; and a bucket digging/lifting sequence. On the native integrated adapter:

| Measurement | Result |
| --- | ---: |
| Deep activation, maximum dynamic chunks (each material) | 32 |
| Samples moved more than 1 cm outside the activated region | 0 |
| Realtime driving average FPS | 59.3 |
| Frame time, median / 95th / 99th percentile | 16.7 / 16.8 / 33.4 ms |
| Simulation rate relative to realtime | 1.000 |
| Adaptive render scale | 0.85 |
| Final driving physics batch | 2.31 ms |
| Gameplay feedback transfer | 38.4 KB |
| Gameplay feedback CPU analysis | 1.6 ms |
| Lifted bucket material | 242.6 kg |
| Reused remote tiles during digging | 30 of 36 |

The original driving reproduction reached 253 ms per physics batch and read back 23.5 MB per full snapshot. These are individual measurements rather than guarantees for every action: large collapses can legitimately activate more material. Adaptive resolution remains enabled, and occasional frames exceeded 16.7 ms.

Mass error stayed below 0.001%, all states remained finite, and surface buffers did not overflow. An unsupported wet clump fell to the deeper floor. Unit tests compare incremental terrain/support updates against complete rebuilds across particle movement, chunk crossings, and cuts, and check that initialization preserves the surface volume. Driving checks cover braking, reversing, steering, airborne tracks, slopes, and ledges.

Raw results and visual captures: `.local/artifacts/terrain-stability-validation.json`, `terrain-fix-driving.png`, and `terrain-fix-digging.png`. The original investigation is in [TERRAIN-STABILITY-DIAGNOSIS.md](TERRAIN-STABILITY-DIAGNOSIS.md).
