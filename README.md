# Lumière — interactive 3D restaurant

Vite + TypeScript (strict) + Three.js. A live restaurant hall: 10 round tables × 5 chairs, guests and waiters,
table reservations with status colours and timers, a first-person view from every seat, a full menu with
ordering, a physical pull-cord light switch, a day/night clock dial, a walk mode and a music player.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build in dist/
npm run preview  # serve dist/
npm test         # Vitest: state machine, path-finding, simulation
npm run lint
```

If `vite`/`vitest` fail with "Cannot find native binding" (an npm optional-dependency bug), delete
`node_modules` and `package-lock.json` and run `npm install` again.

URL options: `?quality=low|medium|high` (otherwise auto-detected and stepped down below ~28 fps),
`?debug` (lil-gui panel: quality, FPS, draw calls, auto-booking).

## Controls

| Action | How |
|---|---|
| Look around the hall | drag; scroll / pinch to zoom |
| Reserve a table | click a free table → choose guests → **Confirm** |
| Sit at a seat (first person) | click a chair, the chair icon in a label, or **Seats** in the top bar (Table 1–10, Seat 1–5) |
| Look around from the seat | drag (mouse or touch) |
| Previous / next seat, exit | HUD arrows or ← / →, **Exit to overview** or Esc |
| Menu | click the menu card on a table, **Menu** in the seat HUD, or key E while seated |
| Hall lights | pull the cord in the top-right corner down (or focus the bead and press Enter / Space) |
| Time of day | drag the hand of the dial (← / → = 10 min, PgUp / PgDn = 1 h); **Auto** lets time flow |
| Labels always / on hover, simulation speed 1× 4× 12×, sound | top bar |
| Walk mode | **Walk** in the top bar or key V (cycles overview → walk → seat) |
| Walk: move / look / jump / sprint / crouch | W A S D / mouse (click to capture) / Space / Shift / C or Ctrl |
| Walk: interact with the nearest table | E (sit, menu, reserve); H shows the key list; Esc releases the mouse, Esc again exits |
| Anywhere | L lights · T / Shift+T time ±30 min · 1 2 3 speed · M mute · N next track · P play/pause |
| Music and volumes | note icon, bottom-right: play/pause, prev/next, Music / Effects / Ambience sliders (saved) |

Table colours: **red** reserved → **green** seated (brief) → **yellow** waiting for a waiter → **green** served
(stays green until the guests leave). Each label shows "In restaurant" and, while yellow, "Waiting for waiter".

## Editing content

- **Menu:** `src/data/menu.ts` (categories, items, prices, currency). Photos are 800×600 WebP files in
  `public/assets/menu/<item id>.webp`. `node scripts/fetch-menu-images.mjs` re-creates the current set.
- **Layout and timings:** `src/data/config.ts` — table positions/shapes/zones, waiter posts, bar, timings
  (`TIMING`), location and `SOLAR_DATE` for the sun (`'today'` uses the real date; default is the equinox).
- **Design tokens:** `src/styles/tokens.css`.

## Performance notes

- Lights are never added, removed or hidden at runtime (that recompiles every shader and freezes the page); only
  their intensity changes. Keep it that way when editing `src/world/lighting.ts`.
- The simulation runs in fixed 1/60 s steps (max 16 per frame), so 4× / 12× cost no extra rendering.
- Integrated GPUs start on the medium preset; below 40 fps the render resolution drops (to 85 %, then 70 %).
- Close other tabs that show the site: every open copy renders the full 3D scene on the same GPU.

## Structure

```
src/core   engine (renderer, post-fx, quality presets, loop), views (overview / seat camera)
src/world  room, furniture + tableware (instanced), exterior, lighting, dayNight, people
src/sim    pure TypeScript: tableState (state machine), agents, pathfinding (A*), restaurantSim
src/ui     tableLabels, menu, pullCord, timeDial, viewSwitcher, audio (SFX + music), toasts
src/data   config.ts, menu.ts
```

The simulation has no rendering or DOM dependencies; the 3D layer only reads its state.
