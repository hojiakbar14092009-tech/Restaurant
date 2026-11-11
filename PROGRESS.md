# PROGRESS

Phases 1-8 done (2026-11-11). Change requests #1 and #2 applied (2026-11-11).

Change request #1 — luxury hall
- 10 round tables (1.56 m) x 5 seats, 5 waiters / 5 zones, hall 27 x 18 x 8 m (config.ts).
- Arched 6.7 m windows with fan mullions and curtains, pilasters, coffered ceiling, boiserie, mirrors,
  marble floor border, urns, olive trees, 3 crystal chandeliers (room.ts, lighting.ts).
- Upholstered chairs, floor-length cloths with folds, full place settings, 3 pillar candles per table
  with a shader-animated flame and a light pool; 2 shared flickering candle lights (furniture.ts).

Change request #2
- Freeze on light toggle: lights were hidden at level 0 -> shader recompile. Lights now never change count.
- Fixed-step simulation (1/60 s, max 16 steps/frame); animation speed capped at 3x.
- Guests stood up every 8 s: the "Sitting" clip was looped. Now played once and clamped.
- Waiters walking on the spot: `moving` was never cleared when idle. Animation now follows real speed.
- Stuck recovery: after 1.5 s of yielding an agent walks through for 2.5 s (tested for 30 sim-minutes).
- Red chandelier globes when off, trees inside the hall, sky/ground overdraw: fixed.
- Walk mode (views.ts), synthesised SFX + streamed 3-track playlist with crossfade (ui/audio.ts).
- Matte surfaces use Lambert; velvet has no physical sheen (cost); integrated GPUs start on medium;
  dynamic resolution 100 -> 85 -> 70 %.

Measured (headless Chromium, Intel Iris Xe, 1920x870, medium, auto resolution 70 %)
- 1x ~35-40 fps, 12x with 32 people ~34 fps; worst frame 40-65 ms; light toggle 39-117 ms.
- 60 fps is NOT reached on this GPU in that test.

Decision 2026-11-11: sharpness over frame rate. Dynamic resolution removed; native resolution (SMAA stays high-only: it cost ~8 fps on Iris Xe).
Black-frame flicker fixed (NaN in the light-shaft shader spread by bloom).

Not done / next
- Real-Chrome and phone measurements; mouse-look pointer lock and the touch joystick were not testable headless.
- Normal maps / KTX2, marble rosette inlay, rugs: skipped.
- If 60 fps is required on integrated graphics: fewer skinned people (cap groups) or impostors for far guests.
