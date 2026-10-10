# Bucket retention and release — second realistic-digging increment

Bucket contact now uses a separate, provisional metal friction coefficient of 0.45. Wet adhesion resists both sliding and separation, with strength scaled by each sample's moisture. A dry sample cannot inherit adhesion just because the global material controls are wet. Contact bonds use the previously unused fourth history component to identify the touched plate; tensile contact continues only within a 4 mm peeling range following real contact. It adds equal and opposite reaction impulses and never pulls detached material across a large gap.

Thin bucket plates now resolve contact on material samples rather than grid nodes. The inverted-bucket regression exposed a grid artifact: an isolated sample stayed just below a plate even with adhesion disabled. Nodes inside the thin plate could select its opposite face and create false support. Sample contact removes that artifact. Other rigid supports and the domain floor retain their existing grid contact.

Swept sample contact catches entry into a bucket plate between solver steps, including samples that finish outside its opposite face. Collision correction returns them to the entry face rather than pushing them through the wall. The shell remains open at the top and front; containment does not clamp material into a chamber. Gravity and bucket orientation determine spilling. Material mass, composition, constitutive properties, grid resolution, and soil timestep remain unchanged.

The shell receives a second correction pass at contacting samples to clear overlapping plates, without repeating adhesion. When a low bucket would push a sample below the fixed floor, correction selects the closest plate exit that respects bedrock. The original closest-face correction violated the floor during force-limited curling; the force-coupling regression retains its existing 1 mm penetration limit.

## Controlled GPU checks

`npm run test:bucket` runs on the connected GPU and writes `.local/artifacts/bucket-validation.json`. It tests settled loads, raising/translating the bucket, tipping, dumping, overfill, fast wall crossing, and release from inverted metal.

| Material | Carry retention, 0.125 m grid | Carry retention, 0.25 m game grid | Final dumped load |
| --- | --- | --- | --- |
| Sand | 95% | 100% | 0 kg |
| Dry soil | 100% | 100% | 0 kg |
| Wet dirt | 100% | 100% | 0 kg |

The seeded load is 0.339 m³. Total material mass stays conserved throughout; bucket volume estimates track transported rest volume separately. All snapshots have finite states and less than 1 mm final penetration. Composition is preserved during transport. The overfilled sand load spills without a chamber clamp.

An inverted isolated wet sample falls 2.25 mm less over the first 30 ms with adhesion enabled, but still falls more than a metre after a further half second. A dry sample under wet global settings follows the nonadhesive result. A 700 m/s synthetic crossing verifies the swept-contact barrier; this is a numerical regression, not a realistic digging speed.

These checks establish retention and gravity-driven release, not calibrated bucket capacity or realistic clump fracture. Consistent soil chunk breakup, full scoop/lift/carry cycles across materials, and user assessment of pouring still need further tuning. The metal friction and adhesion values are prototype parameters.

## Force coupling

`npm run test:coupling` passes with finite states, conserved mass, final penetration below 1 mm, and stable force/torque feedback. Full and half strength move similarly through the shallow cut (1.9 cm difference), whose measured resistance does not exceed both force limits. The strength regression now uses the loaded lift as the overload comparison, requiring more than 0.5 m of separation: full strength reaches 1.623 m versus 0.729 m at the comparison point. Peak retained load is approximately 1.2 tonnes; maximum fixture speed remains 0.728 m/s. Detailed results are written to `.local/artifacts/coupling-validation.json`.

## Live game and performance

`npm run test:hydraulics` passes the approach, cut, coordinated scoop, lift, and dump sequence on integrated AMD Vega (`amd · gcn-5`). The cut measures 1092 kg, the scoop/lift retains 582 kg, and dumping releases the load completely. All stages preserve total mass and finite states; the rendered surface stays within capacity.

The active rendered digging measurement at 1280 × 800 reaches 29.0 FPS, 33.3 ms median, 49.9 ms p95, and 0.990× simulation throughput across 348 frames. Time debt before pausing is 0.099 s; adaptive render scale reaches 65%. The earlier hydraulic increment measured 19.6 FPS, but these sequences are not a matched before/after benchmark. The 60 FPS target remains unmet. Results are in `.local/artifacts/hydraulics-validation.json`.

`npm test`, `npm run build`, and `git diff --check` pass.
