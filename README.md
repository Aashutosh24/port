# Portfolio — the ride

A developer journey told as a motorcycle ride. React + React Three Fiber, no extra libraries.

```bash
npm install
npm run dev
```

## Where things live

| File | What it does |
| --- | --- |
| `src/content.js` | **All copy.** Name, role, hero line, links, the five checkpoints (sign + panel text), the finale. |
| `src/journey.js` | Road shape, lane choice (`LANE_SIDE`), where the ride starts/ends, scroll phases. |
| `src/scene/Scene.jsx` | Road mesh, roadside, motorcycle, lights, and the `Director` that turns scroll into bike + camera + fog. |
| `src/scene/roadTextures.js` | Procedural asphalt (grain, wheel-track wear, worn paint) baked to canvas textures. |
| `src/main.jsx` | HTML overlay: hero, checkpoint cards, finale, loader. |

## Hero

The composition is built in the 3D scene, not in HTML.

- **Shot**: low camera (~0.5 m), front-3/4, the bike looming in the left third. The road curves away
  behind it to a lit start-line gantry (sign `00`) that carries the name — the same sign design as every
  checkpoint, so the hero is the first stop of the world, not a separate landing page.
- **Statement**: `site.statement` is rendered on a plane *behind* the bike (`HeroType` in `Scene.jsx`), so the
  rider overlaps the words like a magazine cover, and the camera's breathing adds real parallax.
- **HTML frame only**: small-caps nav, role + one line (`site.line`) bottom-right, a lane-marking scroll cue
  at the centre. A screen-reader `h1` carries name + role + statement.
- **Alive before scrolling**: slow camera breathing; the scene renders continuously only while the hero is on screen.
- **Intro**: black → white outline pops the bike out → the night road, lamps and signs come up → headlights
  flick on → statement surfaces → HTML frame fades in. Framing numbers live in `HERO` / `HERO_PORTRAIT`.

Review aids: `?introAt=1.5` freezes the intro at that second; `?notext` hides all text (HTML and 3D) so you can
judge the bare composition.

## Checkpoints

Physical checkpoint = where I am. Panel = what happened there.

- Each checkpoint is an overhead information sign over the road (`Boards` in `src/scene/World.jsx`):
  posts on concrete footings, a two-tube truss, three sign lights, and a wash of light on the road beneath.
- Choreography (all driven from the `Director`): as the bike approaches, the camera eases a few metres
  further ahead and tilts up slightly so the sign comes into frame → the sign switches on → the bike rides
  under it → the panel opens (`CARD_LEAD = 0` in `journey.js`) → the sign stays lit behind the bike as it
  recedes → the panel fades as the ride continues.
- The panel opens with a small plate (`01 | WHERE I LEARNED TO RIDE`) that mirrors the sign face, so the
  two read as one object. Sign text and panel text both come from `content.js` (`number`, `label`, `title`).

## Surroundings

`src/scene/World.jsx`: grass fields, cross-billboard trees and low roadside scrub, a steel guardrail on the far shoulder, street lamps (glowing heads, light pools on
the road, and one real light that follows the nearest lamp so the bike is lit as it passes), plus a
moonlit sky band with distant ridgelines (`effects.js`). Everything starts ~60 m down the road, so the
hero stays a clean studio.

## Sound

`src/audio/rideAudio.js` — engine + wind built with the Web Audio API, off by default
(browsers only allow audio after a click). "Sound off / on" in the top bar, or "Ride with sound" in the hero.
Overall loudness is `VOLUME` at the top of that file (0.32). Engine pitch and filter follow the bike's speed; wind rises with speed; there's a starter + blip on ignition.

**Real engine audio:** drop a seamless idle loop at `public/audio/engine.mp3` and it is used automatically
instead of the synth (pitched up with speed).

## Constant-speed riding

Scrolling no longer moves the bike directly. The scroll position says *where* the bike should be; the bike
then rides there at a steady cruising speed (`CRUISE`, 24 m/s), accelerating (`ACCEL`) and braking (`BRAKE`)
smoothly so it stops exactly on target. All tuning lives at the top of `src/journey.js`.

- Checkpoint panels, the hero fade and the route bar follow the **bike**, not the scrollbar, so a panel
  opens exactly when the bike rides under its sign, however fast you scroll.
- The engine note is tied to the bike's speed, so a steady ride gives a steady sound.
- **Route bar** (top centre): the whole ride as a line with its stops (00 start → 06 contact). The fill and blue
  marker follow the bike; click a stop and the bike rides there (a jump rides faster, `JUMP_TIME` ≈ 3 s).
- Rendering stays on demand: frames run only while the bike moves (and while the hero is on screen).
- Add `?debug` to expose the ride state as `window.__journey`.

## How it works

- **Scroll** writes a 0–1 value into `journey.target`; the scene damps it every frame (no React re-renders while scrolling).
- **First 10% of scroll**: camera orbits from a front-3/4 "studio" view to the front chase position; fog opens from dark studio to open road.
- **Rest of the scroll**: bike rides toward the camera in its lane, leans into bends (only while moving). The camera travels on the road a few metres ahead of the bike, low and slightly front-3/4, looking back at the rider and the road already covered.
- **Cards** are HTML. Each shows in a window around its `at` value and slides in/out by direction. All cards hide as soon as the finale starts entering.
- **Milestone stones** sit on the roadside at each checkpoint.

## Tuning

- Left- vs right-hand traffic: `LANE_SIDE` in `src/journey.js` (default `-1`, left lane, as in India).
- Ride length (scroll distance): `.track { height: 900vh }` in `styles.css`.
- Card timing: `CARD_LEAD` / `CARD_HOLD` in `src/main.jsx`.
- Model fit: `MODEL_YAW`, `MODEL_LIFT`, `BIKE_SCALE` in `Scene.jsx`. The GLB faces −X with wheels at y = −0.829.
- Add `?instant` to the URL to disable smoothing (useful for screenshots).

## Performance

- `motorcycle.glb` was optimised from 20 MB / 462k triangles to 2 MB / 139k triangles (meshopt + WebP) with `scripts/optimize-model.mjs`. The look is unchanged; drei's `useGLTF` decodes it out of the box.
- The canvas renders **on demand**: frames run only while the bike, camera or lean are still settling, then the GPU goes idle.
- Cards have no `backdrop-filter` (blurring a live WebGL canvas every frame is very expensive).
- Scroll handler does no layout reads; CSS variables are set on the two elements that use them.
- Pixel ratio capped at 1.25 and drops automatically (1.25 → 1 → 0.8) if frames run slow.
- Shadow map 1024, texture anisotropy capped at 8.
- Lamp glows and lens streak are sprites, and the horizon is one textured cylinder — no post-processing pass.

## Type

Self-hosted **Geist** (text) and **Geist Mono** (labels, numbers, meta) in `public/fonts/` (SIL Open Font License),
preloaded in `index.html`. The 3D hero statement and sign faces are drawn on canvas and keep their own font.
