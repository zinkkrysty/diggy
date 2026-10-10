# Shared hydraulic pump — first realistic-digging increment

The playable excavator now shares pump capacity between boom, stick, curl, and swing. A single requested function retains its existing speed limit. Concurrent functions receive proportional allocations from a 1.6-function flow budget and an estimated 45 kW mechanical power budget. Power demand uses bounded joint effort, gravity torque, and measured soil reaction. These are prototype tuning values, not calibrated specifications for a real excavator.

The allocation changes target advance and commanded speed limits. Joint torque limits still determine whether the arm can overcome contact resistance; soil impulses continue to backdrive the arm. Holding a stationary load does not reserve pump flow, and commands into angular stops release their allocation. Target error is bounded after integration as well as before it, preventing accumulated position error when overload moves the arm backwards. Soil weight remains in measured contact impulses, rather than being counted twice from the bucket-load diagnostic.

Machine reports expose `hydraulics.flowDemand`, `powerDemandWatts`, and `allocation`. This increment does not change material properties, bucket collision geometry, terrain activation, or soil substeps.

## Validation

- `npm test`: all test files pass. New regressions cover concurrent motion, restored flow after command release, estimated power limits, angular stops, resistance, overload/backdrive, and bounded targets.
- `npm run build`: TypeScript and production build pass.
- `npm run test:game`: live Vega game, driving across all material presets, camera, keyboard, finite state, mass conservation, surface capacity, and preserved laboratory checks pass.
- `npm run test:hydraulics`: approaches the soil from the roadside spawn, lowers, cuts, coordinates stick pull/curl, lifts, and dumps. Requires measured contact, a retained load above 10 kg, release during dumping, finite states, and conserved mass. Also measures a rendered digging sequence with simulation throughput and time debt. Detailed results are written to `.local/artifacts/hydraulics-validation.json`.

The existing general game test's short roadside sequence did not retain soil, so it alone is insufficient evidence for loaded digging. The focused check addresses that gap. Bucket containment, calibrated entry-angle resistance, shallow/deep-cut comparisons across presets, longer transport cycles, and comparison against a baseline performance run remain future validation work.

## Vega measurement

The focused rendered soil sequence at 1280 × 800 measured 19.6 FPS, 50.0 ms median, 66.6 ms p95, and 0.922× simulation throughput over 235 frames, with 0.971 s of accumulated simulation debt captured before pausing. Adaptive render scale reached 65%. The adapter reported `amd · gcn-5`, without a fallback adapter. The 60 FPS / real-time target remains unmet; this is an active excavation measurement, not a before/after performance comparison.

The final fixed-batch sequence measured 400 kg after cutting, 12 kg after lifting, and zero after dumping, with conserved total material mass and finite states. Earlier runs retained 121–133 kg after lifting. This verifies physical contact, transport, and release, but the variation and losses reinforce that believable bucket filling still needs its planned follow-up.
