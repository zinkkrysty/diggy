# Diggy prototype plan

## Goal

Build a browser-based excavator sandbox using Three.js, with convincing digging and material movement. Use a reasonably coarse simulation for believable bulk behavior, combined with convincing material surfaces and fine visual detail. Target 60 FPS on the owner's AMD Vega integrated GPU. The goal is realistic-looking movement and interaction, rather than maximum simulation detail. The machine also has an RTX 3060, so benchmarks must verify which GPU is active.

## Agreed scope

- Medium tracked excavator with simplified, believable proportions and rendering.
- Free play in a roughly 40 × 40 metre map with several metres of diggable depth.
- Dig anywhere within the map; support trenches, overhangs, cavities, undermining, and collapse.
- Sand, dry soil, and wet dirt in arbitrary combinations and layers, with physical mixing.
- Convincing resistance, scooping, carrying, spilling, traction, compaction, machine rocking, and tipping without exaggerated reactions.
- Keyboard controls with simultaneous joint movement, smooth acceleration, and realistic joint speed limits.
- Outside orbit/follow camera initially.
- Reset on browser reload; no persistence initially.
- Smooth desktop play, including midrange laptops. Keep bulk material movement, mass transfer, and contact physically driven; add inexpensive visual detail driven by that simulation.
- Sand should appear as a continuous, finely textured material with flowing streams, rather than large visible simulation grains. Wet dirt should retain believable clumps and adhesion.

## Recommended simulation approach

Start with a unified Material Point Method (MPM) solver. Particles carry material state, while a temporary grid calculates forces. MLS-MPM is the initial implementation candidate, with pressure-dependent soil plasticity extended for cohesion and wet deformation.

The first laboratory is implemented with WebGPU MLS-MPM/APIC, continuous material controls, and a kinematic bucket. On the integrated Vega, low-budget active scoop tests reached approximately 59 FPS; denser settings were slower. This supports further local development but does not establish calibrated soil behavior or full-world performance. See [milestone findings](docs/MILESTONE-1.md) and [benchmark results](docs/vega-benchmark.json). Validate behavior and the combined physics/rendering budget before committing to the full world architecture. Position-based granular simulation with friction and cohesion is an alternative to evaluate if MPM cannot meet the target.

Simulation particles represent volumes of soil, not individual physical grains. Material grain size and numerical simulation resolution are separate concepts. Choose the coarsest discretization that preserves convincing bulk behavior and stable contact; finer grids must retain enough material samples to avoid undersampling.

### Simulation and visual detail

Separate the physical representation from what the player sees:

- Reconstruct a connected material surface from coarse samples. Evaluate a local density/implicit surface and screen-space reconstruction, including anisotropic kernels where useful. Benchmark quality, thin streams, bucket contact, and camera consistency before selecting the rendering path.
- Give sand a matte, finely textured surface through shading and surface detail; avoid a glossy liquid appearance or large bead-like grains.
- Use fine visual-only particles for scattered grains, thin falling streams, and dust. Drive emission and motion from the physical material flow. These particles must not contribute duplicate mass, digging resistance, or bucket load.
- Keep isolated physical material visible and falling appropriately. Surface smoothing must not bridge real gaps, erase cavities, or conceal unsupported floating material.
- Preserve the raw material-point view as a debug toggle for diagnosing motion and comparing it with the reconstructed surface.

Surface reconstruction adds GPU work; it is a candidate for convincing visuals at coarse physical resolution, not an assumed performance saving. Visual particles enhance physical movement and must not manufacture a flowing appearance while the underlying material remains incorrectly stuck.

### Continuous material properties

Sand, dry soil, and wet dirt are presets within one framework, rather than separate solvers. Parameters include:

| Property | Intended effect |
| --- | --- |
| Grain composition and effective size | Sandy versus fine-grained behavior |
| Water content | Changes in cohesion, density, and flow resistance |
| Internal friction | Sliding and stable pile slopes |
| Cohesion and tensile strength | Clumping, overhang support, and breakup |
| Stiffness and compaction | Digging resistance and compression under tracks |
| Viscous resistance | Rate of wet material deformation |
| Adhesion to metal | Material sticking to the bucket |

Derive mechanical properties from composition and moisture using calibrated curves. Wetness must not simply increase stickiness indefinitely. Preserve composition, water content, and material history during transport and mixing.

Initially represent wet dirt using moisture-dependent mechanical properties. Explicit drainage, separate free water, and pore-pressure coupling require a richer multiphase formulation and are not prerequisites for the first prototype. Keep the architecture extensible for these features.

## Implementation milestones

### 1. Physics and performance proof — implemented

The laboratory provides pouring, stable piles, scooping/spilling, clump breakup, mixing, and support-removal scenarios, plus material sliders and exportable diagnostics. Hardware tests verified finite states, conserved particle mass, falling/settling, and support collapse. Low-budget tests approached 60 FPS on Vega, but did not meet the strict 16.7 ms p95 target.

These checks establish feasibility, not realistic appearance or sufficient physical accuracy. User feedback identifies dry sand stopping too abruptly, apparent clumping, and apparently suspended samples. Individual faceted sample rendering also makes sand look like coarse gravel.

### 2. Local material behavior and convincing presentation — frozen for game development

Improve the existing unified soil solver and laboratory before expanding the world:

1. Reproduce the reported dry-sand behavior using both the raw-point and rendered views. Diagnose artificial cohesion, friction/plasticity, grid transfer effects, and contact handling. The small moisture-derived cohesion in the sand preset is a candidate cause, not a confirmed explanation.
2. Tune and correct dry sand so it flows under gravity and settles into plausible friction-supported piles. Loose sand must not support persistent floating clumps or unsupported overhangs. Keep wet material cohesion and clump behavior within the same continuous framework.
3. Replace visible simulation beads with a connected, textured material surface. Add simulation-driven fine visual particles for spilling and scattering, retaining the debug point view.
4. Check pile slopes, bucket filling/retention/spilling, wet clump breakup, unsupported collapse, and behavior across particle/grid resolutions. Use both measurable checks and user visual feedback. Preserve material mass and composition when mixing.
5. Profile transfers, constitutive evaluation, surface reconstruction, and visual particles together on Vega. Establish a local quality/performance setting that passes the behavior checks and approaches the 60 FPS target without hiding simulation time debt.

The first iteration removes broad invisible contact margins and moisture-derived cohesion from the dry-sand preset. A GPU density surface, matte fine texture, shadows, and restrained simulation-driven grains replace visible simulation beads; raw points remain available. Combined active scoop tests on Vega approach 60 FPS at the coarse setting, with physics maintaining real time. Dense configurations remain slower. Conservation, free fall, contact, collapse, visual/physical separation, and a two-resolution pile comparison pass. The undermine feedback revision additionally tracks stress-free granular dilation, reduces sample lattice alignment, refines the visual grid, replaces scattered carrier dots with shaded detached volumes, and greatly reduces ballistic detail. Small quantities are explicitly tested for visibility. The subsequent rebound revision adds compression/unloading dissipation, removes inward APIC motion at contact, and ties shear strength to the pressure remaining during unloading. Dry soil now has greater cohesion and stiffness; wet-dirt preset values remain unchanged. Pile/drop rebound is measured across all three materials. The volume-retention revision separates bulk and shear stiffness, removes strain-clamp compaction, gives coarse sand zero permanent compaction, and gates limited fine-soil compaction on high pressure with hardening. Mass, permanent/rest volume, recoverable compression, and carried-volume estimates are measured separately. The user chose to freeze this version on 2026-10-04 and continue game development. Dry pile friction, flow appearance, and performance remain open for a later simulation pass. The volume-retention revision currently measures roughly 31–36 FPS and 0.74–0.85× simulation throughput on Vega; the earlier near-60 FPS results do not apply to this version. See [the frozen baseline](docs/SIMULATION-BASELINE.md). See [findings](docs/MILESTONE-2.md).

Slower development configurations are useful for convergence comparisons. Final acceptance still targets 60 FPS on the integrated GPU. Develop game mechanics against this frozen local baseline; expansion of active ground still requires profiling and an activation/sleeping strategy. Evaluate an alternative unified solver only if measurements justify it.

### 3. Force-limited bucket and coupling proof — implemented

Before adding a complete machine, replace prescribed bucket movement in a focused test with force-limited actuation. Verify that material resistance slows or stalls the bucket, carried soil adds weight, and reaction forces remain stable. Keep the kinematic cycle as a repeatable comparison tool. The restricted four-axis fixture now passes resistance, overload, torque, conservation, and contact checks on Vega. Full versus half strength produces measurably different excavation and lift behavior. See [milestone 3](docs/MILESTONE-3.md); this proof does not yet include full machine dynamics.

### 4. Full sandbox ground — development prototype implemented

The current default scene is a 12 × 12 m development map with volumetric samples, dynamic chunks, fixed sleeping boundary halos, indirect GPU particle dispatch, and geometric support wake-up. Digging/transfer, exact sleeping-state preservation, remote unsupported fall, and surface capacity checks pass on Vega. See [terrain findings](docs/MILESTONE-4.md). The full 40 × 40 m map, deeper excavation, sparse storage, local surface caching, and active-boundary reference comparisons remain unfinished.

Use chunked volumetric ground rather than a height field so cavities and overhangs are representable. Concentrate computation around the bucket, tracks, moving material, and unstable ground.

Allow settled regions to sleep, preserving mass, composition, compaction, and material history. Removing support must wake connected ground, including beyond the immediate excavation area. Test activation boundaries and collapse propagation to prevent artificially rigid distant terrain.

### 5. Excavator and two-way coupling — first playable machine implemented

Build the medium tracked machine with correct proportions, joint limits, mass distribution, and keyboard action mapping. Use a rigid-body solver such as Rapier for machine dynamics.

Hydraulic joints have finite force and speed; resistance can slow or stall them. Soil contact generates reaction forces on the excavator. Carried material contributes weight. Implement track traction, ground compression, and realistic rocking and tipping.

Treat soil/rigid-body coupling as a core engineering task. Verify force transfer, timing, and stability rather than assuming a generic rigid-body library supplies the coupling automatically.

### 6. Playable presentation — separate game implemented

Use Three.js, TypeScript, and Vite, with simulation, physics, rendering, input, UI, and diagnostics separated. Provide an outside orbit/follow camera, restrained lighting and shadows, reconstructed soil surfaces, reset, and collapsible keyboard help. Include mixed and layered terrain and an optional material-properties panel.

### 7. Sustained free-play validation

Exercise repeated excavation, transport, dumping, mixing, trench collapse, driving over piles, and digging beneath the machine. Check long-session stability, conservation, and performance as disturbed regions accumulate.

### 8. More realistic digging — planned

Extend the existing force-limited joints, soil reaction feedback, cohesion, adhesion, damage, and compaction rather than replacing the solver. Prioritize hydraulic response and bucket filling, then cutting contact. Keep detailed physical work local to the bucket, tracks, and genuinely unstable ground; preserve cached distant terrain and integrated-Vega performance.

| Improvement | Feasibility | Planned scope and validation |
| --- | --- | --- |
| Load-sensitive hydraulics — first priority | High | Tune resistance, slowing, and stalling using existing joint effort and soil reactions. Add shared hydraulic flow so simultaneous joint commands compete for available power. Verify shallow cuts remain smooth, deep cuts resist movement, and coordinated stick pull/curl improves scooping without unstable reactions. |
| Bucket filling and dumping — first priority | Moderate | Improve containment, metal friction, adhesion, and orientation-dependent spilling. Sand should pour, cohesive soil should release in chunks, and wet dirt should cling briefly. Check scoop, lift, carry, overfill, and dump sequences for conserved mass and believable retained volume. Consistent clump breakup needs additional tuning. |
| Cutting contact — next priority | Moderate | Improve cutting-edge geometry and angle-dependent resistance. Teeth/edge should cut, while the bucket underside should grade or compact. Compare favorable and unfavorable entry angles and verify local material displacement. Current 20 cm particle spacing limits individual tooth-scale cuts. |
| Sound and load feedback | High | Drive hydraulic strain and scraping sounds from measured effort and contact; add restrained visual feedback for load. Keep GPU cost low and avoid exaggerated machine movement or camera shake. |
| Digging tasks | High | Add optional target trench depths, grading guides, and spoil-placement areas using terrain measurements. Reward controlled cuts and accurate placement while retaining free play. |
| Firm ground becoming loose excavated soil | Moderate | Extend existing damage and compaction history to distinguish undisturbed ground from excavated material. Preserve that history during transport and mixing. Verify cutting resistance changes plausibly without restoring remote activation waves or compromising stable piles. |
| Persistent ruts and local edge crumbling | Moderate to hard | Support broad track deformation and local failure of unsupported trench edges. Use visual detail for fine tread marks. Validate support removal, driving over disturbed ground, and collapse propagation; detailed physical fracture would require finer local simulation. |

Defer individual physical grains, detailed tooth-scale fracture, and full hydraulic-fluid simulation. Their cost is difficult to justify on integrated Vega. Consider finer local resolution only after measuring a specific contact limitation and its combined physics/rendering cost.

Each physics change must retain finite states, mass conservation, continuous chassis support, local activation, and genuine unsupported collapse. Benchmark active digging and repeated transport/dumping at real-time simulation speed, not only idle or driving scenes.

## Performance strategy and acceptance

60 FPS provides approximately 16.7 ms for the entire frame. This is a target to validate, not a promise before measurements.

Optimize with sparse active regions, GPU-resident data, efficient particle/grid transfers, careful sleeping, and local surface updates. Budget bulk physics and visible material rendering together. Reduce unnecessary physical detail and rendering cost while preserving the validated behaviors. Use stable physics substeps independent of rendering; do not remove necessary substeps merely to report higher FPS.

Acceptance includes freely flowing dry sand, stable friction-supported piles, no persistent unsupported floating material, distinct wet-soil behavior, believable bucket transfer, and continuous material appearance without large simulation beads.

Benchmark active digging and large collapses as well as idle scenes, using the final material surface and visual effects rather than only the debug point renderer. Report frame-time distributions and simulation throughput so smooth rendering cannot conceal a simulation that is falling behind. If fidelity and frame budget conflict, record the measured limits and revisit the plan explicitly.

## Research references

- [Animating Sand as a Fluid](https://www.cs.ubc.ca/~rbridson/docs/zhu-siggraph05-sandfluid.pdf): continuum sand behavior without simulating individual grains.
- [Reconstructing Surfaces of Particle-Based Fluids Using Anisotropic Kernels](https://faculty.cc.gatech.edu/~turk/my_papers/sph_surfaces.pdf): connected particle-derived surfaces and improved treatment of thin features; a rendering candidate to adapt for opaque granular materials.

- [Drucker-Prager Elastoplasticity for Sand Animation](https://math.ucdavis.edu/~jteran/papers/KGPSJT16.pdf): pressure-dependent continuum sand behavior using MPM.
- [MLS-MPM with Displacement Discontinuity and Two-Way Rigid Body Coupling](https://yuanming.taichi.graphics/publication/2018-mlsmpm/): cutting and rigid-body interaction.
- [Multi-species Simulation of Porous Sand and Water Mixtures](https://www.museth.org/Ken/Publications_files/Pradhana-etal_SIG17.pdf): coupled sand/water behavior within MPM.
- [Unified Particle Physics for Real-Time Applications](https://matthias-research.github.io/pages/publications/flex.pdf): alternative unified particle framework with friction and cohesion.

## Next action

Playtest the separate simulator at `/` with the articulated excavator on the 12 m site. Keep `/lab.html` for material calibration and regression experiments. The first game supports digging, lift, swing, dumping, track driving, orbit/follow camera, help, reset, and three ground presets. Hydraulic response uses reduced-coordinate joints; the Rapier chassis has locked pitch/roll and a coarse ground-connected support proxy. Full articulated mass dynamics, realistic rocking/tipping, calibrated track compression, mixed/layered sites, larger terrain, and long-session validation remain unfinished. Validate the game’s own frame budget rather than carrying over laboratory FPS. See [playable checkpoint](docs/PLAYABLE-SIMULATOR.md).

### Terrain performance revision — 2026-10-04

The current 12 m terrain scene now approaches the 60 FPS target on integrated Vega (59.8 FPS, 16.8 ms p95 across sand, soil, and wet dirt) at real-time simulation speed. Cache unchanged boundary transfers, compact visible detached-volume draws, reuse support-graph storage, throttle HUD updates, and overlap rendering with bucket-feedback readback. Preserve material properties and physics timestep. Unsupported regions still wake, and fixed-step cached/reference comparisons are bit-identical. See [performance revision](docs/PERFORMANCE-REVISION.md). This validates the current scene; larger-world scaling, local surface updates, and long-session performance remain open.

### First game checkpoint — 2026-10-04

The default entry is now the playable excavator sandbox; the lab is preserved at `/lab.html`. The reduced-coordinate hydraulic arm, swing-aware bucket contact, tracked Rapier chassis, procedural model/linkages, outdoor setting, orbit/follow camera, keyboard help, material selection, reset and compact HUD are implemented. GPU playtests cover scoop/lift/swing/dump and driving. Game performance currently measures approximately 32–40 FPS on integrated Vega at adaptive render resolution; the 60 FPS target remains unmet. Preserve the lab, frozen material properties and stable soil timestep while addressing the game’s additional costs. Full machine pitch/roll and calibrated track weight/compaction, mixed/layered sites and longer free play remain open. See [checkpoint and measurements](docs/PLAYABLE-SIMULATOR.md).

### Driving and camera correction — 2026-10-04

Default camera now follows behind and above the chassis, with scroll zoom and optional C orbit mode. Track movement uses supported-weight-limited forces at each belt rather than fighting passive skid friction; differential tread speeds animate independently. Braking, steering, reverse away from bucket boundaries, airborne traction suppression and forward/reverse driving on live sand/soil/wet dirt pass. Material properties and the soil timestep remain unchanged. Calibrated track weight transfer, pitch/roll and sustained rough-terrain driving remain open. See [driving validation](docs/driving-validation.json).

### Pile driving follow-up

The playable chassis now pitches and rolls onto rounded belt ends. Ground probes follow belt orientation, supported contacts share the vehicle load, and traction acts along the local slope. Bucket/render/collision transforms follow chassis tilt. Regression ramps verify climbing 20° and 30° slopes and restricted climbing at 50°; live material driving and excavation are verified separately. Soil constitutive properties remain frozen. Full articulated mass distribution and vehicle pressure/compaction calibration remain future work.

Ledge recovery regression: work-volume bounds apply per joint and allow inward recovery after chassis tilt. Bucket reach no longer disables track propulsion; belt-width probes preserve support at ledge edges. Both left/right support-drop scenarios verify rolled driving and arm recovery.
