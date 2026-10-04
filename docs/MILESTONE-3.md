# Milestone 3 — Force-limited bucket coupling

The bucket now defaults to a four-axis actuated fixture. Keyboard inputs move a bounded position target; a damped servo applies finite force/torque with a flow speed limit. Soil contact transfers linear and angular impulse back to the fixture. Material resistance can slow movement, and carried material consumes lift capacity through its contact weight.

This is the coupling proof before the complete excavator. The translating fixture mass is 1,800 kg, rotational inertia 1,100 kg·m²; limits are 28 kN horizontal/lateral, 45 kN vertical, and 22 kN·m curl. These include an imaginary support carriage and are prototype test parameters, not a specification for the future machine. The full excavator needs articulated joints, hydraulic geometry, chassis dynamics, and track contact.

## Implementation

- `src/simulation/actuator.ts` contains the restricted fixture dynamics, bounded servo target, gravity, joint/workspace limits, and contact impulse feedback.
- The soil shader measures contact torque about the bucket pivot in addition to its existing linear impulse. One extra GPU pass measures geometric contents once per physics batch. Constitutive material rules and transfer algorithms are unchanged from the [frozen baseline](SIMULATION-BASELINE.md).
- Each active force-limited frame reads a 32-byte metrics buffer. Full particle/state snapshots remain occasional diagnostics. Soil weight is already in contact impulses; the contents estimate is not added again as a second gravity force.
- Both full and half actuator strength are selectable. Prescribed motion remains available for comparisons; the original keyboard mapping and scripted scoop cycle remain.
- Reports include actuation mode, fixture mass/inertia, actuator effort, contact reaction/torque, and contents.

## Verification

Build and unit tests pass. Dynamics checks exercise resistance, stall, bounded target error, gravity holding, overload, angular momentum, and reset.

The deterministic integrated-Vega GPU check drives the same push/curl/lift/tip sequence with full and half strength. [Saved results](coupling-validation.json):

| Metric | Full strength | Half strength |
| --- | ---: | ---: |
| Bucket x after push sample | −0.019 m | −0.154 m |
| Final bucket height | 1.831 m | 0.580 m |
| Peak geometric contents | 901 kg | 888 kg |
| Peak soil reaction | 28.5 kN | 28.5 kN |
| Peak contact torque | 14.1 kN·m | 12.7 kN·m |
| Peak fixture speed component | 0.726 | 0.726 |

The reduced actuator advances less during excavation and cannot raise the load as the full actuator does. Throughout both sequences, particle states remain finite, mass drift stays below 0.001%, and corrected contact overlap stays below 1 mm (final overlap zero). This is numerical coupling evidence, not a realism calibration or a performance benchmark. Screenshots were inspected for loaded-bucket material visibility.

## Limits and next step

This is a restricted bucket fixture, not a six-degree rigid body or complete machine. Soil and fixture exchange impulses once per frame's physics batch. The collider uses the batch-end pose and average velocity; tighter substep coupling may be needed for stronger contacts or lighter bodies. The fixture's substantial carriage inertia helps this explicit exchange remain stable. Test stability again when replacing it with articulated machine dynamics.

GPU-to-CPU mapping adds a synchronization point. Active-region/sleeping and integrated profiling remain necessary; the frozen baseline already misses 60 FPS. Do not claim the current fixture proves full-world real-time performance.

Next: chunked volumetric ground with active excavation regions, sleeping settled material, and support-dependent wake-up, followed by the tracked excavator and chassis coupling. Keep soil tuning as a separately revisit-able task.
