# First playable simulator

The main entry `/` is now the game. The previous experimental interface and diagnostic API remain at `/lab.html`; both are included in the production build and share the material solver and surface renderer.

## Play

W/S operates the boom, A/D the stick, R/F the bucket, Q/E upper-body swing. Arrow keys drive/steer the tracks. Shift provides precise joint and track movement. Space pauses, C switches camera mode, H opens controls. The default camera follows behind and above the chassis. Scroll zooms. Press C for orbit mode; then drag orbits and right-drag pans. Site settings reset the terrain with sand, soil or wet dirt. Reload starts fresh.

The scene has a procedural simplified excavator in metre-based proportions, cab, counterweight, track shoes/rollers, boom, stick, teeth and moving hydraulic cylinders. Model state is separate from Three.js objects. A sparse DOM overlay contains the controls and bucket-load estimate; experiment panels stay in the lab.

## Physics boundary

- The existing material properties, sample spacing, solver grid and stable timestep are preserved. Per-box yaw is now supported by GPU collision, rotating contact velocity, bucket load, CPU diagnostics and visual clipping, allowing real upper-body swing.
- The arm uses four reduced-coordinate hydraulic joints with joint limits, limited torque/speed, hold targets, gravity compensation and measured contact impulses mapped through the bucket Jacobian. It is a prototype hydraulic model, not a full articulated rigid-body solver.
- The Rapier chassis advances at a fixed 60 Hz, independently of the smaller soil/hydraulic substeps. It carries a 12,000 kg mass and explicit inertia, using ground-limited forces at each belt. Ground probes across each belt’s length and width determine available support, and the combined longitudinal/lateral force is limited by supported weight. Rolling resistance and braking are explicit. Passive track-box tangential friction is disabled to avoid opposing belt propulsion twice. Differential belt speeds generate steering, and the two tread animations move independently. Soil bucket reaction is applied to the chassis; the chassis pitches and rolls freely, with rounded belt hulls and traction projected along the supported slope. Bucket collision and rendering follow the complete chassis rotation. Swing motor reaction and arm centre-of-mass changes are not yet resolved as a full articulated system.
- Track support uses a 50 cm height proxy extracted from contiguous ground-connected material columns. Airborne/carried material is excluded. This height field is only a vehicle support proxy: the soil itself remains volumetric and can form cavities/overhangs. The proxy cannot resolve every undercut. Track collision boxes participate in soil contact, but calibrated vehicle weight transfer/compaction is unfinished.
- Stationary tracks do not continuously wake nearby soil. Moving tracks and bucket motion wake local regions; geometric support loss and moving material continue to trigger independent wakes.
- Conservative world bounds skip expensive oriented contact calculations only when contact is geometrically impossible.
- Excavator static parts are merged by material and trees/track shoes use instancing. Still track shoes retain their instance buffer. Contact feedback overlaps rendering; sleeping/cached terrain transfers and compacted physical-volume draws remain enabled. Hidden tabs stop submitting work.
- Rendering starts at 85% of native resolution and can reduce to 65% when recent frames exceed the budget. DOM controls stay sharp. Soil sampling, visual field spacing, physics timestep and material properties are unaffected. The current scale is reported in Site → Performance and benchmark exports.

## Validation

Build and unit checks cover joint hold/limits, reaction response, yaw collision and exclusion of airborne support. The integrated-GPU game playtest exercises scoop, curl, lift, swing, dump, steering, drive, keyboard control, preset reset, small-volume rendering and the retained lab. The repeatable sand sequence collects approximately 278 kg, retains about 186 kg during lift/swing and empties the bucket while tipping. All phases conserve mass and retain finite state, with no surface overflow.

Saved browser artifacts are under `.local/artifacts/`. Game benchmark timings measure the complete scene during 15 seconds of live keyboard operation at 1440 × 960 on integrated Vega. They supersede lab timings only for the game; neither measurement establishes full 40 m world performance.

## Remaining work

Full articulated machine dynamics, track load calibration, a larger site, mixed/layered game presets, optional in-game material controls, longer free-play sessions and remaining performance work. Keep material experiments isolated in the lab while improving the actual game.

Rapier integration uses [the official rigid-body API](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/); installed TypeScript declarations define the pinned dependency’s interfaces.

## Current game performance

[Saved full-game benchmark](game-benchmark.json), integrated AMD Vega, 1440 × 960 viewport, adaptive render resolution, live keyboard scoop sequence. All physics substeps remain enabled.

| Ground | FPS | p95 frame | Simulation speed | Final render scale |
| --- | ---: | ---: | ---: | ---: |
| sand | 40.1 | 50.0 ms | 1.000× | 65% |
| soil | 37.4 | 33.6 ms | 0.999× | 65% |
| wet | 31.9 | 50.1 ms | 0.985× | 65% |

This does **not** meet the 60 FPS acceptance target. Earlier development runs varied from roughly 30 to 54 FPS, depending on active ground and rendering cost. The latest wet run ends with about 206 ms of simulation debt; this is exposed rather than discarded. These game timings must not be replaced with the older near-60 FPS standalone lab result. Further profiling and coupling/rendering optimization remain necessary.

[Game playtest](game-validation.json), [shared terrain regression](game-shared-terrain-validation.json), and [bit-identical cache/reference checks](game-shared-cache-validation.json) are saved for review. Build and unit tests pass.

## Camera and traction correction

The previous track model could stall on flat sand because its drive force fought passive skid friction. The corrected model propels the machine through contact forces at each belt, preserves support/traction limits, brakes on release, and provides no propulsion in midair. Site walls constrain chassis travel; bucket reach does not disable the tracks. [Standalone regression results](driving-validation.json) and [live-material browser checks](game-validation.json) verify useful forward/reverse movement on all three presets, while the existing excavation sequence still passes. Vehicle weight/compaction calibration remains unfinished.

The camera now uses a chassis-relative rear and elevated offset, with time-based smoothing through translation and turns. Scroll adjusts distance; C switches between this third-person camera and free orbit. Camera tests check the rear/above relationship across headings, and the browser playtest verifies both modes.

## Sand pile climbing

The chassis can now tilt onto piles instead of pushing a level rectangular track nose into them. Contact probes follow the belt orientation, and supported belts redistribute vehicle weight across their contact patches. Finite grip, gravity and rolling resistance still restrict steep slopes. Bucket geometry, contact velocities, gravity compensation and material clipping use the complete chassis orientation. Material properties are unchanged.

`npm run test:driving` now includes 1.2 m raised-ground ramps at 20° and 30°, which the machine climbs, and a 50° ramp that blocks its ascent. These tests isolate the vehicle support model; they are not calibrated sand gradeability measurements. [Pile results](pile-driving-validation.json). The live GPU game excavation, drive/reverse on all presets and retained lab also pass.

## Ledge recovery

A ledge drop could move the bucket outside the work volume, causing the previous all-joint rollback and bucket-dependent drive limiter to lock the controls. Joint bounds now reject only motion that worsens a limit, independently for each joint, so lowering/retracting/swinging back into the volume remains possible. Track support probes span belt width and begin above the tread, preserving contact at ledge edges. Site walls constrain driving independently of bucket reach.

The driving suite removes support beneath either belt, verifies chassis roll, then checks forward travel and arm recovery with the bucket initially outside its height limit. Both sides travel approximately 1.75 m in three seconds. [Ledge regression results](ledge-driving-validation.json).
