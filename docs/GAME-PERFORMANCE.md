# Digging performance follow-up — 2026-10-10

Measured in Chromium WebGPU on AMD Vega integrated graphics, using the current 24 m playable site and the hydraulic scoop/lift/dump regression followed by timed live controls. Both runs use the same workflow, viewport and adaptive render scale (0.65); live input timing means their particle trajectories are not identical.

| Measurement | Before | After |
| --- | ---: | ---: |
| Live FPS | 28.6 | 30.2 |
| Median frame | 33.4 ms | 33.3 ms |
| p95 frame | 50.0 ms | 36.5 ms |
| p99 frame | 50.2 ms | 38.7 ms |
| Simulation throughput | 0.9985× | 0.9984× |
| Outstanding simulation debt | 33.6 ms | 0.8 ms |

This is a modest throughput improvement and fewer long frames in this run. It does not meet the 60 FPS target or establish performance across every material and camera configuration. Raw local measurements are saved in `.local/artifacts/performance-before.json` and `performance-after.json`.

Surface splatting now visits only grid nodes inside the particle kernel and tile halo. A paired GPU check runs both implementations on identical particle buffers, comparing every density and shading field word, triangle count and detached-volume count. All six batches match exactly, without triangle overflow or browser errors. Updating four dirty tiles costs roughly 6.7–7.0 ms instead of 7.9–8.1 ms; the initial 36-tile rebuild falls from 64.6 to 51.6 ms. Run `npm run test:surface-performance` with the development server available to reproduce; results are in `.local/artifacts/surface-performance.json`.

CPU grid-node enumeration caches coordinate mappings and skips sleeping chunk spans, retaining exactly the original node order. Unit tests compare it with the original full-grid enumeration across multiple spacings and activity masks. Terrain meshes now have conservative tile bounds, allowing camera and shadow frustum culling without GPU readback.

The soil timestep, material properties, contact calculation and surface resolution remain unchanged. The live hydraulic regression still conserves mass, respects capacity/flow/power limits and carries 582 kg before dumping completely. A smaller Jacobi implementation was tested and discarded because it did not improve GPU timing.
