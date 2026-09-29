import * as THREE from "three";

// ---- Road layout (metres) -------------------------------------------------
export const LANE_WIDTH = 3.5;
export const ROAD_WIDTH = LANE_WIDTH * 2;

// Which lane the bike rides in. -1 = left lane (India / UK), +1 = right lane.
export const LANE_SIDE = -1;
// Distance from road centre to the bike (slightly toward the lane's outer third).
export const BIKE_LATERAL = LANE_SIDE * (LANE_WIDTH / 2 + 0.2);

// Gentle, believable curves. The road continues well past the destination so
// it fades into fog instead of ending abruptly, and ~100 m *behind* the start
// line so the hero shot has a road curving away into the distance.
const PATH = (() => {
  const pts = [
    [26, 0.3, 150], [12, 0.1, 100], [2, 0, 55], [0, 0, 20], [0, 0, 0], [0, 0, -30], [10, 0.2, -62], [-4, 0.1, -96],
    [-18, 0.4, -126], [-6, 0.2, -160], [14, 0.5, -192], [10, 0.2, -226],
    [-8, 0.1, -256], [-12, 0.3, -292], [4, 0.2, -332], [10, 0, -382], [4, 0, -430],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  return new THREE.CatmullRomCurve3(pts, false, "centripetal");
})();
export const makePath = () => PATH;

// Where the ride starts / ends along the road, in metres from the path start.
// The bike starts just past z = 0 (where the original road began).
export const START_S = (() => {
  const L = PATH.getLength();
  const v = new THREE.Vector3();
  for (let s = 0; s < L; s += 0.25) if (PATH.getPointAt(s / L, v).z <= -2) return s;
  return 22;
})();
export const TAIL_S = 90; // road left over beyond the destination

// ---- Scroll phases --------------------------------------------------------
// Fraction of the scroll track spent on the hero (camera orbits to the rear).
export const HERO_END = 0.1;

// Card timing, in ride units (0..1 of the road).
export const CARD_LEAD = 0; // panel opens as the bike passes under its checkpoint sign
export const CARD_HOLD = 0.13; // and stays up this long after it

// ---- Constant-speed riding ----------------------------------------------------
// Scrolling sets where the bike should be; the bike then *rides* there at a steady
// cruising speed (accelerating and braking smoothly), instead of mirroring every
// jitter of the wheel. Panels, the route bar and the engine all follow the bike.
export const HERO_M = 25;   // the hero → road transition counts as this many metres
export const CRUISE = 24;   // m/s (~86 km/h): speed while following the scroll
export const ACCEL = 26;    // m/s² speeding up
export const BRAKE = 16;    // m/s² slowing to a stop exactly at the target
export const JUMP_TIME = 3; // s: route-bar jumps arrive in about this long
// Going back feels instant: we only ever really ride forward.
export const REWIND_TIME = 0.8;   // s: a backwards route-bar jump (e.g. to Start) takes this long, any distance
export const REVERSE_CRUISE = 60; // m/s: scrolling back up rides backwards this fast
export const REVERSE_ACCEL = 70;  // m/s²
export const REVERSE_BRAKE = 45;  // m/s²

// progress (0..1 of the scroll track) → "virtual metres" along the whole ride, and back
export const progressToM = (p, rideLength) =>
  p <= HERO_END ? (p / HERO_END) * HERO_M : HERO_M + ((p - HERO_END) / (1 - HERO_END)) * rideLength;
export const mToProgress = (m, rideLength) =>
  m <= HERO_M ? (m / HERO_M) * HERO_END : HERO_END + ((m - HERO_M) / rideLength) * (1 - HERO_END);
// where a checkpoint sits on the scroll track
export const checkpointProgress = (at) => HERO_END + at * (1 - HERO_END);

export const journey = {
  jump: false,      // set by route-bar clicks: allow a faster (still constant) ride there
  finaleIn: false,  // the contact section is on screen
  rewinding: false,
  ui: null,         // set by the page: ui.update(progress) is called whenever the bike moves
  invalidate: null, // set by the scene; requests a frame (on-demand rendering)
  target: 0, // raw scroll progress of the track, 0..1 (written by scroll handler)
  smooth: 0, // damped version used by the 3D scene
  speed: 0,  // metres / second, for lean
};

export const heroAmount = (p) => THREE.MathUtils.clamp(p / HERO_END, 0, 1);
export const rideAmount = (p) => THREE.MathUtils.clamp((p - HERO_END) / (1 - HERO_END), 0, 1);

// Frame helpers ----------------------------------------------------------------
const UP = new THREE.Vector3(0, 1, 0);
export function frameAt(curve, length, s, out = {}) {
  const u = THREE.MathUtils.clamp(s / length, 0, 1);
  out.point = curve.getPointAt(u, out.point || new THREE.Vector3());
  out.tangent = curve.getTangentAt(u, out.tangent || new THREE.Vector3()).normalize();
  // `left` = left-hand side when facing along the tangent.
  out.left = (out.left || new THREE.Vector3()).crossVectors(UP, out.tangent).normalize();
  return out;
}

// `?debug` exposes the ride state for inspection in the console.
if (typeof window !== "undefined" && window.location.search.includes("debug")) window.__journey = journey;
