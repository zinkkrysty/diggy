# Gameplay playtest, round 2 — 2026-10-04

The four first-round issues are fixed: Shift precision survives leaving a form control, all top actions fit narrow screens, Escape closes Site even when the selector has focus, and dismissed panels report collapsed accessibility state. The hint no longer overlaps telemetry at narrow widths. `npm run test:game-ui` protects these interactions with an actual browser check.

The second round used live keyboard operation in Chromium with the AMD gcn-5 WebGPU adapter at 1440 × 960. It exercised scoop/curl/lift/swing/hold/dump on all three materials, driving onto and reversing from the raised bank, turning and driving, key clearing on blur, pause, camera switching, zoom extremes, joint-limit recovery, and a longer wet-material dump. Screenshots were reviewed, not just DOM state. Raw reports, scripts, and captures are in the ignored `.local/artifacts/` directory.

## Remaining player-facing findings

### Medium: close follow-camera zoom hides the work

Reproduce from a fresh site: keep the third-person camera and scroll inward to its closest setting. The cab/counterweight and boom occupy most of the screen; the bucket cutting edge is occluded. Zooming in to inspect a cut makes precision digging harder. Portrait views also frame the machine so tightly that little working area is visible.

Evidence: `.local/artifacts/round2-max-zoom-in.png` and `round2-width-320.png`. Owner: `src/render/game-scene.ts` chase-distance bounds and camera framing. Consider a shoulder offset or a minimum useful distance, with aspect-aware framing. This is a visibility/usability issue; no camera collision or renderer failure was observed.

### Medium: swing overruns the intended stopping point

Reproduce on sand: lower with S for 1.4 seconds, reach with D for 2.2, curl with R for 2.2, lift with W for 2.5, then swing with Q for 2.5. Release every key and observe for four seconds. The bucket travels another approximately 29 cm horizontally; upper swing adds 0.077 radians (4.4°). The corresponding soil run moved another 26 cm. This makes placing a load beside a trench or over a small dump target frustrating.

Evidence: `gameplay-round2.json`, `sand-swing` versus `sand-hold`, and equivalent soil phases. Owner: `src/simulation/excavator.ts` target tracking. Motion/inertia can be intentional, but the target remains ahead after input stops and no visual cue explains the continued motion. A stopping policy or clearer control feedback needs a gameplay decision; the solver was not changed in this pass.

### Medium: resisted movement and hard limits look like unresponsive controls

Reproduce the same excavation sequence on Wet dirt. During 2.5 seconds of W, the bucket rose only about 2 cm, versus about 84 cm on sand. The W indicator lights, but the status remains “Free play”; it gives no explanation of material resistance. On an empty fresh site, holding W eventually reaches the boom's 1.32-radian joint limit; holding W for another two seconds still shows “Free play.” Players cannot distinguish resistance or a limit from missed input.

Evidence: `gameplay-round2.json` wet-curl/wet-lift and `gameplay-followup.json` boom-limit observations; screenshots `round2-wet-lift.png` and `round2-boom-limit.png`. Owners: `src/game/main.ts` HUD and `src/simulation/excavator.ts` diagnostics. Add explanatory load/limit feedback without removing the intended force limits. Lowering from the boom limit worked.

## Other observations

Wet dirt emptied slowly: after 8.5 seconds of tipping and three seconds settling, approximately 72 kg remained; subsequent lifting emptied the bucket. Cohesion/adhesion and the low dumping position make this insufficient evidence of a solver bug. It remains a playability observation to compare against a higher, fully tipped dump.

Driving onto the bank tilted the chassis and raised the bucket above its arm work-volume ceiling. Reverse successfully recovered to level ground. Key clearing on blur stopped travel with approximately 1.5 cm additional displacement. Pause held simulation time constant. Controls remain operable with the Controls panel open; this was observed, not classified as a bug. Camera switching and orbit dragging worked.

All captured gameplay snapshots reported zero invalid particles. No page errors were recorded during the main keyboard pass. The first exploratory script stopped in its final camera section because the test called Playwright's two-argument wheel method incorrectly; a separate corrected follow-up completed the camera and limit checks. This was a test harness error, not an application failure.

## Validation

- `npm test`: all five test files passed.
- `npm run build`: passed; existing bundle-size warnings remain.
- `npm run test:game-ui`: passed, including 320/390/600/850 px action visibility and modifier recovery.
- `npm run test:driving`: passed, including moderate slopes, steep-slope restriction, and both ledge-drop recoveries.
- Sustained keyboard gameplay and focused follow-up: completed the scenarios above with screenshot evidence. Timing observations from this playtest are not a formal hardware benchmark.
