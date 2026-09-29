import * as THREE from "three";
import { ROAD_WIDTH, LANE_WIDTH } from "../journey.js";

// Procedural asphalt with painted markings, baked into one tile that repeats
// along the road. Markings follow curves because they live in UV space.
export const ROAD_TILE_M = 14; // metres of road per texture repeat

const PX_PER_M = 128;
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

// Soft low-contrast blotches that wrap vertically so the tile stays seamless.
function blotches(ctx, w, h, count, rMin, rMax, alpha, light) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w, y = rand() * h, r = rMin + rand() * (rMax - rMin);
    for (const dy of [-h, 0, h]) {
      const g = ctx.createRadialGradient(x, y + dy, 0, x, y + dy, r);
      const c = light ? "255,255,255" : "0,0,0";
      g.addColorStop(0, `rgba(${c},${alpha * (0.4 + rand() * 0.6)})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y + dy - r, r * 2, r * 2);
    }
  }
}

function grain(ctx, w, h, base, spread, speckChance) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let v = (rand() - 0.5) * spread;
    const r = rand();
    if (r < speckChance) v += 14 + rand() * 16; // light aggregate stones
    else if (r < speckChance * 3) v -= 22; // voids
    d[i] = THREE.MathUtils.clamp(d[i] + v + base, 0, 255);
    d[i + 1] = THREE.MathUtils.clamp(d[i + 1] + v + base, 0, 255);
    d[i + 2] = THREE.MathUtils.clamp(d[i + 2] + v + base + 1, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}

// lateral metres (from road centre, right = +) -> pixel x
const xOf = (m, w) => ((m + ROAD_WIDTH / 2) / ROAD_WIDTH) * w;

function paintMarkings(ctx, w, h, style) {
  const lineW = 0.12 * PX_PER_M;
  const edgeInset = 0.3;
  const { fill, worn } = style;

  // Solid edge lines
  for (const side of [-1, 1]) {
    const x = xOf(side * (ROAD_WIDTH / 2 - edgeInset), w);
    ctx.fillStyle = fill;
    ctx.fillRect(x - lineW / 2, 0, lineW, h);
  }
  // Dashed centre line: 3 m dash, 4 m gap (2 per tile)
  const dash = 3 * PX_PER_M, period = 7 * PX_PER_M;
  const cx = xOf(0, w);
  for (let y = 0; y < h; y += period) {
    ctx.fillStyle = fill;
    ctx.fillRect(cx - lineW / 2, y + 0.5 * PX_PER_M, lineW, dash);
  }
  if (worn) {
    // chip paint away in small flecks so lines don't look vector-perfect
    ctx.fillStyle = worn;
    for (let i = 0; i < 2600; i++) {
      const side = [-1, 0, 1][Math.floor(rand() * 3)];
      const x = xOf(side * (ROAD_WIDTH / 2 - (side ? edgeInset : 0)), w) + (rand() - 0.5) * lineW * 1.1;
      ctx.fillRect(x, rand() * h, 1 + rand() * 2, 1 + rand() * 3);
    }
  }
}

function wheelTracks(ctx, w, h, rgba) {
  // Traffic polishes / darkens two bands in each lane.
  for (const lane of [-1, 1]) {
    for (const off of [-0.85, 0.85]) {
      const x = xOf(lane * (LANE_WIDTH / 2) + off, w);
      const g = ctx.createLinearGradient(x - 0.45 * PX_PER_M, 0, x + 0.45 * PX_PER_M, 0);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.5, rgba);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - 0.45 * PX_PER_M, 0, 0.9 * PX_PER_M, h);
    }
  }
}

function toTexture(c, { srgb, maxAniso }) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function createRoadTextures(maxAniso = 8) {
  const w = Math.round(ROAD_WIDTH * PX_PER_M);
  const h = Math.round(ROAD_TILE_M * PX_PER_M);

  // ---- colour ----
  seed = 7;
  const [cc, c] = canvas(w, h);
  c.fillStyle = "rgb(46,48,50)";
  c.fillRect(0, 0, w, h);
  blotches(c, w, h, 60, 40, 220, 0.18, false);
  blotches(c, w, h, 30, 60, 260, 0.06, true);
  wheelTracks(c, w, h, "rgba(0,0,0,0.16)");
  grain(c, w, h, 0, 12, 0.02);
  paintMarkings(c, w, h, { fill: "rgba(206,204,194,0.92)", worn: "rgba(48,50,52,0.9)" });

  // ---- roughness (lighter = rougher) ----
  seed = 7;
  const [rc, r] = canvas(w, h);
  r.fillStyle = "rgb(214,214,214)"; // a touch of night-time damp: catches headlights
  r.fillRect(0, 0, w, h);
  wheelTracks(r, w, h, "rgba(0,0,0,0.28)");
  blotches(r, w, h, 40, 50, 200, 0.12, false);
  paintMarkings(r, w, h, { fill: "rgb(165,165,165)" });

  // ---- bump (aggregate + raised paint) ----
  seed = 11;
  const [bc, b] = canvas(w / 2, h / 2);
  b.fillStyle = "rgb(128,128,128)";
  b.fillRect(0, 0, w / 2, h / 2);
  grain(b, w / 2, h / 2, 0, 70, 0.03);

  return {
    map: toTexture(cc, { srgb: true, maxAniso }),
    roughnessMap: toTexture(rc, { maxAniso }),
    bumpMap: toTexture(bc, { maxAniso }),
  };
}

// Gravel / dirt shoulder, tiles in both directions.
export function createShoulderTexture(maxAniso = 8) {
  seed = 23;
  const s = 512;
  const [cc, c] = canvas(s, s);
  c.fillStyle = "rgb(34,33,31)";
  c.fillRect(0, 0, s, s);
  blotches(c, s, s, 40, 20, 90, 0.25, false);
  grain(c, s, s, 0, 30, 0.04);
  const t = new THREE.CanvasTexture(cc);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}
