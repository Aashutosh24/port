import React, { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, PerspectiveCamera, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import {
  BIKE_LATERAL, LANE_SIDE, ROAD_WIDTH, START_S, TAIL_S,
    ACCEL, BRAKE, CRUISE, JUMP_TIME, REVERSE_ACCEL, REVERSE_BRAKE, REVERSE_CRUISE, REWIND_TIME,
  frameAt, heroAmount, journey, makePath, mToProgress, progressToM, rideAmount,
} from "../journey.js";
import { ROAD_TILE_M, createRoadTextures, createShoulderTexture } from "./roadTextures.js";
import { SKY, createGlowTexture, createSkyTexture, createStatementTexture, createStreakTexture } from "./effects.js";
import { site } from "../content.js";
import { rideAudio } from "../audio/rideAudio.js";
import { Boards, Ground, Guardrail, LAMP_SPACING, SIGN_Y, StreetLamps, Trees } from "./World.jsx";

export const MODEL_URL = "/models/motorcycle.glb";

// The GLB is centred on the origin, ~1.9 m long, with its front pointing to -X
// and wheels at y = -0.829. These two numbers put it upright on the road.
const MODEL_YAW = Math.PI / 2; // turns model -X to local +Z (our "forward")
const MODEL_LIFT = 0.829;
const BIKE_SCALE = 1.08;

const GROUND_Y = -0.2;
const STEP = 0.5; // metres between road cross-sections
const HALF = ROAD_WIDTH / 2;

// Slight crown so the road catches light like real tarmac.
const CROWN = [[-HALF, 0], [-HALF / 2, 0.03], [0, 0.05], [HALF / 2, 0.03], [HALF, 0]];
function crownAt(lat) {
  for (let i = 0; i < CROWN.length - 1; i++) {
    const [a, ya] = CROWN[i], [b, yb] = CROWN[i + 1];
    if (lat >= a && lat <= b) return ya + ((lat - a) / (b - a)) * (yb - ya);
  }
  return 0;
}

const ease = (x) => x * x * (3 - 2 * x);
// smoothstep that also works with edges in either order (e0 > e1 = falling)
const sstep = (e0, e1, x) => ease(THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1));
// `?instant` in the URL disables smoothing (handy for screenshots / debugging).
const INSTANT = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("instant");
const NOTEXT = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("notext");
// `?introAt=1.2` freezes the hero intro at that second (for reviewing the sequence).
const INTRO_AT = typeof window !== "undefined" ? parseFloat(new URLSearchParams(window.location.search).get("introAt")) : NaN;
const damp = (a, b, lambda, dt) => INSTANT ? b : THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));

// -----------------------------------------------------------------------------
// Geometry: a strip swept along the curve. Each column is a lateral offset
// (metres, right = +) with a height rule and a u coordinate.
function buildStrip(curve, length, cols, vScale, shade) {
  const n = Math.floor(length / STEP) + 1;
  const pos = [], uv = [], col = [], idx = [];
  const f = {};
  const phase = [Math.random() * 10, Math.random() * 10];
  for (let i = 0; i < n; i++) {
    const s = Math.min(i * STEP, length);
    frameAt(curve, length, s, f);
    const macro = shade
      ? 0.9 + 0.07 * Math.sin(s * 0.043 + phase[0]) + 0.05 * Math.sin(s * 0.117 + phase[1])
      : 1;
    for (const c of cols) {
      const x = f.point.x - f.left.x * c.lat;
      const z = f.point.z - f.left.z * c.lat;
      const y = c.ground ? GROUND_Y + 0.01 : f.point.y + c.dy;
      pos.push(x, y, z);
      uv.push(c.u, s / vScale);
      col.push(macro, macro, macro);
    }
  }
  const w = cols.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < w - 1; j++) {
      const a = i * w + j, b = a + 1, c = a + w, d = c + 1;
      // winding so faces point up
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function Road({ curve, length }) {
  const gl = useThree((s) => s.gl);
  const maxAniso = Math.min(8, gl.capabilities.getMaxAnisotropy()); // 16x is costly at grazing angles

  const { road, shoulders, tex, gravel } = useMemo(() => {
    const roadCols = CROWN.map(([lat, dy]) => ({ lat, dy, u: (lat + HALF) / ROAD_WIDTH }));
    const side = (sgn) => {
      const cols = [
        { lat: sgn * (HALF - 0.02), dy: -0.01, u: 0 },
        { lat: sgn * (HALF + 1.4), dy: -0.07, u: 0.7 },
        { lat: sgn * (HALF + 4.5), ground: true, u: 2.25 },
      ];
      return sgn < 0 ? cols.reverse() : cols;
    };
    const L = side(-1), R = side(1);
    return {
      road: buildStrip(curve, length, roadCols, ROAD_TILE_M, true),
      shoulders: [buildStrip(curve, length, L, 2, true), buildStrip(curve, length, R, 2, true)],
      tex: createRoadTextures(maxAniso),
      gravel: createShoulderTexture(maxAniso),
    };
  }, [curve, length, maxAniso]);

  return (
    <group>
      <mesh geometry={road} receiveShadow>
        <meshStandardMaterial
          map={tex.map}
          roughnessMap={tex.roughnessMap}
          bumpMap={tex.bumpMap}
          bumpScale={1.2}
          roughness={1}
          metalness={0}
          vertexColors
          envMapIntensity={0.6}
        />
      </mesh>
      {shoulders.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial map={gravel} color="#8a8680" roughness={1} vertexColors envMapIntensity={0.2} />
        </mesh>
      ))}
    </group>
  );
}

// Sparse delineator posts along both shoulders.
function Roadside({ curve, length, rideLength }) {
  const posts = useRef();
  const reflectors = useRef();

  const { postMatrices, reflMatrices } = useMemo(() => {
    const f = {};
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const postMatrices = [], reflMatrices = [];
    for (let s = 8; s < length - 4; s += 26) {
      frameAt(curve, length, s, f);
      for (const sgn of [LANE_SIDE]) {
        const lat = sgn * (HALF + 1.7);
        const x = f.point.x - f.left.x * lat, z = f.point.z - f.left.z * lat;
        e.set(0, Math.atan2(f.tangent.x, f.tangent.z), 0);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(x, GROUND_Y + 0.5, z), q, new THREE.Vector3(1, 1, 1));
        postMatrices.push(m.clone());
        m.compose(new THREE.Vector3(x, GROUND_Y + 0.82, z), q, new THREE.Vector3(1, 1, 1));
        reflMatrices.push(m.clone());
      }
    }
    return { postMatrices, reflMatrices };
  }, [curve, length, rideLength]);

  useLayoutEffect(() => {
    postMatrices.forEach((m, i) => posts.current.setMatrixAt(i, m));
    reflMatrices.forEach((m, i) => reflectors.current.setMatrixAt(i, m));
    posts.current.instanceMatrix.needsUpdate = true;
    reflectors.current.instanceMatrix.needsUpdate = true;
  }, [postMatrices, reflMatrices]);

  return (
    <group>
      <instancedMesh ref={posts} args={[null, null, postMatrices.length]}>
        <boxGeometry args={[0.09, 1, 0.09]} />
        <meshStandardMaterial color="#2a2e33" roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={reflectors} args={[null, null, reflMatrices.length]}>
        <boxGeometry args={[0.095, 0.1, 0.095]} />
        <meshStandardMaterial color="#d9dde0" emissive="#d9dde0" emissiveIntensity={0.25} roughness={0.3} />
      </instancedMesh>
    </group>
  );
}

// Lamp positions in the bike group's space (measured from the GLB's textures).
const HEADLAMPS = [[0.12, 0.92, 0.8], [-0.12, 0.92, 0.8]];
const INDICATORS = [[0.28, 0.8, 0.66], [-0.28, 0.8, 0.66]];

function Motorcycle({ bikeRef, leanRef, headRef, glowRef }) {
  const { scene } = useGLTF(MODEL_URL);
  // Fresnel edge glow: a clean white "border" around the silhouette that the
  // hero animates in. No extra lights, no spill on the road.
  const rim = useMemo(() => ({ uRim: { value: 0 }, uRimColor: { value: new THREE.Color("#e8f1fa") } }), []);
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((o) => {
      if (o.isMesh && o.material) {
        o.castShadow = true;
        o.receiveShadow = true;
        const m = o.material.clone();
        m.envMapIntensity = 1.5; // livelier reflections on paint and chrome
        m.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, rim);
          shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nuniform float uRim;\nuniform vec3 uRimColor;")
            .replace(
              "#include <emissivemap_fragment>",
              `#include <emissivemap_fragment>
              float fres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 4.5); // thin, crisp edge
              totalEmissiveRadiance += uRimColor * fres * uRim;`
            );
        };
        o.material = m;
      }
    });
    return clone;
  }, [scene, rim]);

  const headTarget = useMemo(() => new THREE.Object3D(), []);
  useLayoutEffect(() => {
    headRef.current.target = headTarget;
  }, [headTarget, headRef]);

  // Lamp glows are sprites: always face the camera, cost almost nothing.
  const mats = useMemo(() => {
    const glow = createGlowTexture();
    const streak = createStreakTexture();
    const make = (map, color) => new THREE.SpriteMaterial({
      map, color, blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, fog: false, toneMapped: false, opacity: 0,
    });
    return {
      rim,
      head: make(glow, "#fff6ea"),
      bloom: make(glow, "#dfe9f5"),
      amber: make(glow, "#ff9a2e"),
      streak: make(streak, "#9fd2ff"),
    };
  }, [rim]);
  useLayoutEffect(() => {
    glowRef.current = mats;
  }, [mats, glowRef]);

  return (
    <group ref={bikeRef}>
      <group ref={leanRef}>
        <group scale={BIKE_SCALE}>
          <primitive object={model} rotation-y={MODEL_YAW} position-y={MODEL_LIFT} />
        </group>
        {HEADLAMPS.map((p, i) => (
          <sprite key={i} position={p} scale={0.7} material={mats.head} />
        ))}
        {INDICATORS.map((p, i) => (
          <sprite key={i} position={p} scale={0.2} material={mats.amber} />
        ))}
        <sprite position={[0, 0.92, 0.84]} scale={[2.4, 0.08, 1]} material={mats.streak} />
        {/* soft bloom around the headlamps */}
        <sprite position={[0, 0.9, 0.9]} scale={2.6} material={mats.bloom} />
        {/* tail light glow on the road behind the bike */}
        <pointLight position={[0, 0.45, -1.4]} color="#FF3B30" intensity={0.25} distance={2.2} decay={2} />
      </group>
      {/* headlight pooling on the road ahead */}
      <spotLight
        ref={headRef}
        position={[0, 0.95, 1.05]}
        angle={0.42}
        penumbra={0.8}
        distance={40}
        decay={1.4}
        intensity={0}
        color="#f4efe6"
      />
      <primitive object={headTarget} position={[0, 0, 18]} />
    </group>
  );
}

// The hero statement lives *in* the scene: a plane behind the bike, so the rider
// overlaps the words like a magazine cover. Placed every frame by the Director.
function HeroType({ typeRef }) {
  const { map, aspect } = useMemo(() => createStatementTexture(site.statement), []);
  return (
    <mesh ref={typeRef} renderOrder={1} visible={false}>
      <planeGeometry args={[1, 1 / aspect]} />
      <meshBasicMaterial map={map} transparent opacity={0} depthWrite={false} fog={false} toneMapped={false} />
    </mesh>
  );
}

// Faint horizon glow + distant ridgelines, on a cylinder that travels with the camera.
function Sky({ skyRef }) {
  const map = useMemo(createSkyTexture, []);
  return (
    <mesh ref={skyRef} renderOrder={-1} position-y={SKY.centerY}>
      <cylinderGeometry args={[SKY.radius, SKY.radius, SKY.height, 64, 1, true]} />
      <meshBasicMaterial map={map} side={THREE.BackSide} fog={false} depthWrite={false} toneMapped={false} transparent opacity={0} />
    </mesh>
  );
}

// Colours: moonlit night road.
const NIGHT_BG = new THREE.Color("#07090d");
const NIGHT_FOG = new THREE.Color("#141b22");
const BLACK = new THREE.Color("#000000");

// ---- hero framing -----------------------------------------------------------
// alpha: 0 = behind the bike, ±PI = straight ahead of it (negative = shoulder side).
// type*: where the statement sits, relative to the hero camera (metres).
const HERO = {
  alpha: -2.62, dist: 4.7, height: 0.5, lookY: 1.02, lookSide: 0.7,
  typeDist: 15, typeX: -3.1, typeY: 2.55, typeW: 7.2, typeOpacity: 0.88,
};
const HERO_PORTRAIT = {
  alpha: -2.75, dist: 5.8, height: 0.55, lookY: 1.7, lookSide: 0,
  typeDist: 15, typeX: -0.35, typeY: 4.1, typeW: 5.6, typeOpacity: 0.9,
};

// ---- hero intro timeline (seconds after the bike first renders) --------------
const INTRO = {
  rim: [0.2, 0.75],     // 1. white edge light snaps on: the bike pops out of black as an outline
  studio: [0.9, 2.1],   // 2. the night road comes up around it: lamps, sky, key light
  camera: [0, 2.9],     //    slow crane / push-in throughout
  ignition: 1.7,        // 3. headlights flick on
  type: [2.0, 3.4],     // 4. the statement surfaces out of the dark behind the bike
  text: 2.7,            // 5. the small HTML details (name, line, scroll)
};
const REDUCED_MOTION = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const span = (t, [a, b]) => THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);

// -----------------------------------------------------------------------------
// One place that turns time + scroll into bike, camera, light, fog and sound.
function Director({ curve, length, rideLength, refs }) {
  const invalidate = useThree((st) => st.invalidate);
  useLayoutEffect(() => {
    journey.invalidate = invalidate;
    invalidate(); // kick the first frame; after that frames request themselves
    return () => { journey.invalidate = null; };
  }, [invalidate]);

  const tmp = useMemo(() => ({
    f: {}, f2: {}, f3: {}, heroBase: new THREE.Vector3(), heroLook: new THREE.Vector3(), lookRide: new THREE.Vector3(),
    fwd2: new THREE.Vector3(), r2: new THREE.Vector3(), u2: new THREE.Vector3(), m4: new THREE.Matrix4(), bike: new THREE.Vector3(), camPos: new THREE.Vector3(), camRide: new THREE.Vector3(),
    look: new THREE.Vector3(), lookSmooth: new THREE.Vector3(), towardCenter: new THREE.Vector3(),
    dir: new THREE.Vector3(), right: new THREE.Vector3(), toCam: new THREE.Vector3(), fwd: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0), lean: 0, lastS: START_S, init: false,
    clock: 0, textSent: false, perfSum: 0, perfN: 0, shake: 0,
  }), []);

  useFrame((state, delta) => {
    // read live state every frame (never a stale camera from an earlier render)
    const { camera, scene, size, gl, setDpr, viewport } = state;
    const t = tmp;
    const dt = Math.min(delta, 0.1);
    t.frames = (t.frames || 0) + 1;

    // ---- adaptive resolution: drop pixel ratio if frames are consistently slow
    if (delta < 0.1 && t.init) {
      t.perfSum += delta;
      if (++t.perfN === 90) {
        const avg = t.perfSum / t.perfN;
        if (avg > 1 / 40 && viewport.dpr > 1) setDpr(1);
        else if (avg > 1 / 28 && viewport.dpr > 0.8) setDpr(0.8);
        t.perfSum = 0;
        t.perfN = 0;
      }
    }

    // ---- intro clock (wall time, so a slow first frame doesn't stretch it)
    const now = performance.now() / 1000;
    if (t.start === undefined) t.start = now;
    t.clock = Number.isNaN(INTRO_AT) ? now - t.start : INTRO_AT;
    const it = REDUCED_MOTION ? 99 : t.clock;
    const introDone = it > INTRO.type[1] || !Number.isNaN(INTRO_AT);
    if (!t.textSent && it >= INTRO.text) {
      t.textSent = true;
      window.dispatchEvent(new Event("ride:intro"));
    }
    gl.toneMappingExposure = 1.2;
    const rimUp = easeOut(span(it, INTRO.rim));
    const lightUp = ease(span(it, INTRO.studio));
    const camIn = easeOut(span(it, INTRO.camera));
    const on = it < INTRO.ignition ? 0
      : it < INTRO.ignition + 0.08 ? 1
      : it < INTRO.ignition + 0.16 ? 0.15
      : 1; // quick double-flick like a real ignition

    // ---- scroll
        // ---- constant-speed ride toward wherever the scroll says the bike should be
    const targetM = progressToM(journey.target, rideLength);
    if (t.m === undefined || INSTANT) { t.m = targetM; t.v = 0; }
    const gap = targetM - t.m;

    // Rewind: a route-bar jump *backwards* (e.g. back to Start) is a quick timed
    // sweep instead of a ride, so going back feels instant.
    if (journey.jump && gap < -1 && !t.tween) t.tween = { from: t.m, to: targetM, time: 0 };
    if (t.tween && t.tween.to !== targetM) t.tween = null; // user scrolled mid-rewind: go back to riding

    if (t.tween) {
      const tw = t.tween;
      tw.time += dt;
      const k = Math.min(tw.time / REWIND_TIME, 1);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // ease in-out
      const next = tw.from + (tw.to - tw.from) * e;
      t.v = (next - t.m) / Math.max(dt, 1e-3);
      t.m = next;
      if (k >= 1) { t.m = tw.to; t.v = 0; t.tween = null; journey.jump = false; }
    } else if (Math.abs(gap) < 0.02 && Math.abs(t.v) < 0.3) {
      t.m = targetM;
      t.v = 0;
      journey.jump = false;
    } else {
      // riding backwards (scrolling up) is quicker than riding forwards
      const back = gap < 0;
      const base = back ? REVERSE_CRUISE : CRUISE;
      const brake = back ? REVERSE_BRAKE : BRAKE;
      const accel = back ? REVERSE_ACCEL : ACCEL;
      const cruise = journey.jump ? Math.max(base, Math.abs(gap) / JUMP_TIME) : base;
      // fastest speed from which we can still brake to a stop exactly at the target
      const vWant = Math.sign(gap) * Math.min(cruise, Math.sqrt(2 * brake * Math.abs(gap)));
      const dv = vWant - t.v;
      const a = Math.abs(vWant) > Math.abs(t.v) && Math.sign(vWant) === Math.sign(t.v || vWant) ? accel : accel * 1.5;
      t.v += THREE.MathUtils.clamp(dv, -a * dt, a * dt);
      const step = t.v * dt;
      if (Math.abs(step) >= Math.abs(gap) && Math.sign(step) === Math.sign(gap)) { t.m = targetM; t.v = 0; }
      else t.m += step;
    }
    journey.smooth = mToProgress(t.m, rideLength);
    journey.speed = t.v;
    journey.rewinding = !!t.tween;
    const p = journey.smooth;
    const h = ease(heroAmount(p));
    const s = START_S + rideAmount(p) * rideLength;
    // tell the page when the bike moves, or when a jump/rewind starts or ends
    const hold = journey.jump || journey.rewinding;
    if (p !== t.lastP || hold !== t.lastHold) {
      t.lastP = p;
      t.lastHold = hold;
      journey.ui?.update(p);
    }
    const speedN = THREE.MathUtils.clamp(Math.abs(journey.speed) / 30, 0, 1);
    // during a rewind the engine stays at cruising revs instead of screaming
    rideAudio.update(t.tween ? Math.sign(t.v) * Math.min(Math.abs(t.v), CRUISE) : journey.speed);

    // ---- bike
    const f = frameAt(curve, length, s, t.f);
    t.bike.copy(f.point).addScaledVector(f.left, -BIKE_LATERAL);
    t.bike.y = f.point.y + crownAt(BIKE_LATERAL);
    const yaw = Math.atan2(f.tangent.x, f.tangent.z);
    const f2 = frameAt(curve, length, s + 5, t.f2);
    const turn = f.tangent.x * f2.tangent.z - f.tangent.z * f2.tangent.x; // + = right-hand bend
    const moving = THREE.MathUtils.clamp(Math.abs(journey.speed) / 8, 0, 1);
    t.lean = damp(t.lean, THREE.MathUtils.clamp(turn * 2.4, -0.2, 0.2) * moving, 4, dt);
    refs.bike.current.position.copy(t.bike);
    refs.bike.current.rotation.y = yaw;
    refs.lean.current.rotation.z = t.lean; // + leans right

    // ---- checkpoint choreography
    // near: 0 far away → 1 while the bike approaches and passes under a sign → 0 after.
    // Signs "switch on" as the bike comes up to them and stay lit behind it.
    let near = 0, signDist = Infinity, sign = null;
    const signs = refs.signs.current;
    if (signs) {
      for (const b of signs.list) {
        const d = b.s - s; // metres until the bike reaches this sign
        near = Math.max(near, sstep(26, 12, d) * sstep(-16, -3, d));
        const lit = (0.15 + 0.85 * sstep(40, 8, d) * sstep(-90, -30, d)) * lightUp;
        b.face.emissiveIntensity = 0.02 + 0.7 * lit;
        b.glow.opacity = 0.82 * lit;
        b.pool.opacity = 0.75 * lit;
        if (Math.abs(d) < signDist) { signDist = Math.abs(d); sign = b; }
      }
      if (sign) {
        const L = signs.light;
        L.position.copy(sign.point).addScaledVector(sign.tangent, 1.2);
        L.position.y += SIGN_Y + 1.4;
        L.target.position.copy(sign.point).addScaledVector(sign.tangent, 2);
        L.target.updateMatrixWorld();
        L.intensity = 40 * sstep(30, 8, signDist) * lightUp;
      }
    }
    t.near = damp(t.near || 0, near, 3, dt);

    // ---- camera
    t.towardCenter.copy(f.left).multiplyScalar(LANE_SIDE); // from bike toward road centre
    const portrait = size.width < size.height;
    const fov = (portrait ? 52 : 38) + speedN * 5; // widen slightly with speed
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = damp(camera.fov, fov, 4, dt);
      camera.updateProjectionMatrix();
    }

    // Hero: a low, near-ground front-3/4 shot. The bike looms over the lens,
    // the road curves away behind it toward the lit start-line sign.
    const HP = portrait ? HERO_PORTRAIT : HERO;
    t.dir.copy(f.tangent).multiplyScalar(-Math.cos(HP.alpha)).addScaledVector(t.towardCenter, Math.sin(HP.alpha));
    // base pose (no intro push-in, no breathing): also anchors the hero typography
    t.heroBase.copy(t.bike).addScaledVector(t.dir, HP.dist);
    t.heroBase.y += HP.height;
    t.heroLook.copy(t.bike);
    t.heroLook.y += HP.lookY;
    t.right.subVectors(t.heroLook, t.heroBase).normalize().cross(t.up).normalize();
    t.heroLook.addScaledVector(t.right, HP.lookSide);

    t.camPos.copy(t.heroBase)
      .addScaledVector(t.dir, (1 - camIn) * 2.2)
      .addScaledVector(t.right, (1 - camIn) * -0.8);
    t.camPos.y -= (1 - camIn) * 0.2;
    // breathing: a slow, tiny drift so the opening scene never feels frozen
    if (!REDUCED_MOTION && h < 1) {
      const w = (1 - h) * (INSTANT ? 0 : 1);
      t.camPos.addScaledVector(t.right, Math.sin(now * 0.23) * 0.07 * w);
      t.camPos.y += Math.sin(now * 0.31 + 1.3) * 0.03 * w;
    }

    // Ride: camera travels on the road a few metres ahead, bike rides toward us.
    const ahead = frameAt(curve, length, s + (portrait ? 7 : 6) + 3 * t.near, t.f3);
    t.camRide.copy(ahead.point)
      .addScaledVector(ahead.left, -BIKE_LATERAL)
      .addScaledVector(ahead.left, LANE_SIDE * (portrait ? 0.4 : 1.1));
    t.camRide.y = ahead.point.y + 1.15 + 0.25 * t.near;
    t.camPos.lerp(t.camRide, h);

    // road buzz: a few millimetres of shake, only at speed
    t.shake += dt * 38;
    const buzz = 0.012 * speedN;
    t.camPos.x += Math.sin(t.shake * 1.7) * buzz;
    t.camPos.y += Math.sin(t.shake * 2.3 + 1.1) * buzz;

    // ride look: at the rider, slightly behind so the covered road stretches away
    t.lookRide.copy(t.bike).addScaledVector(f.tangent, -1.5);
    t.lookRide.y += 0.8 + 0.55 * t.near;
    if (!portrait) {
      t.right.subVectors(t.lookRide, t.camRide).normalize().cross(t.up).normalize();
      t.lookRide.addScaledVector(t.right, 0.85);
    }
    t.look.copy(t.heroLook).lerp(t.lookRide, h);

    // hero typography: a plane in the scene, placed from the hero's base pose so the
    // bike genuinely stands in front of the words (and parallax sells the depth)
    const type = refs.type.current;
    if (type) {
      t.fwd2.subVectors(t.heroLook, t.heroBase).normalize();
      t.r2.crossVectors(t.fwd2, t.up).normalize();
      t.u2.crossVectors(t.r2, t.fwd2).normalize();
      type.position.copy(t.heroBase)
        .addScaledVector(t.fwd2, HP.typeDist)
        .addScaledVector(t.r2, HP.typeX)
        .addScaledVector(t.u2, HP.typeY);
      t.m4.makeBasis(t.r2, t.u2, t.fwd2.clone().negate());
      type.quaternion.setFromRotationMatrix(t.m4);
      type.scale.setScalar(HP.typeW);
      type.material.opacity = ease(span(it, INTRO.type)) * (1 - sstep(0, 0.35, h)) * HP.typeOpacity;
      if (NOTEXT) type.material.opacity = 0;
      type.visible = type.material.opacity > 0.001;
    }

    if (!t.init) {
      camera.position.copy(t.camPos);
      t.lookSmooth.copy(t.look);
      t.init = true;
    }
        const k = INSTANT || t.tween ? 1 : 1 - Math.exp(-14 * dt); // camera locks on during a rewind
    camera.position.lerp(t.camPos, k);
    t.lookSmooth.lerp(t.look, k);
    camera.lookAt(t.lookSmooth);

    // ---- lamps: brightest when the bike faces the camera
    t.fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    t.toCam.subVectors(camera.position, t.bike).setY(0).normalize();
    const facing = THREE.MathUtils.smoothstep(t.fwd.dot(t.toCam), 0.05, 0.9);
    const g = refs.glow.current;
    if (g) {
      // softer lamps in the hero close-up (they read as light pouring out of the bike);
      // full strength once the ride starts
      const heroDim = THREE.MathUtils.lerp(0.45, 1, h);
      g.head.opacity = on * (0.35 + 0.65 * facing) * heroDim;
      g.amber.opacity = on * 0.8 * (0.3 + 0.7 * facing);
      g.streak.opacity = on * 0.35 * facing * heroDim;
      // strong outline while the bike "pops" in the studio, a faint edge on the road
      // white border: only in the hero, with a brief swell while the camera swings
      // round to the front view; fully gone once the ride starts
      g.rim.uRim.value = rimUp * (THREE.MathUtils.lerp(1.3, 0.55, lightUp) * (1 - h) + 0.6 * Math.sin(Math.PI * h));
      g.bloom.opacity = on * 0.22 * facing * THREE.MathUtils.lerp(0.15, 1, h);
    }
    refs.head.current.intensity = 20 * on * THREE.MathUtils.lerp(0.6, 1, h);

    // ---- lights follow the bike so shadows stay crisp
    const key = refs.key.current;
    key.intensity = 1.9 * lightUp;
    key.position.copy(t.bike).addScaledVector(f.tangent, 6).addScaledVector(t.towardCenter, -2.5);
    key.position.y += 9;
    key.target.position.copy(t.bike);
    key.target.updateMatrixWorld();

    const rim = refs.rim.current; // blue, from behind: traces the silhouette edge
    rim.intensity = 8 * lightUp;
    rim.position.copy(t.bike).addScaledVector(f.tangent, -6).addScaledVector(t.towardCenter, 3 * (1 - h) - 3 * h);
    rim.position.y += 2.4;
    rim.target.position.copy(t.bike);
    rim.target.position.y += 1.1;
    rim.target.updateMatrixWorld();

    // white edge light: the "border" that makes the bike pop in the hero
    const edge = refs.edge.current;
    edge.intensity = 30 * rimUp * (1 - h * 0.75);
    edge.position.copy(t.bike).addScaledVector(f.tangent, -3.2).addScaledVector(t.towardCenter, 2.2 - 3.4 * h);
    edge.position.y += 2.8;
    edge.target.position.copy(t.bike);
    edge.target.position.y += 1.2;
    edge.target.updateMatrixWorld();

    const fill = refs.fill.current; // from the camera side
    fill.intensity = 0.8 * lightUp;
    fill.position.copy(t.bike).addScaledVector(f.tangent, 8).addScaledVector(t.towardCenter, 3);
    fill.position.y += 4;
    fill.target.position.copy(t.bike);
    fill.target.updateMatrixWorld();

    refs.hemi.current.intensity = 0.72 * lightUp;
    scene.environmentIntensity = 0.5 * (0.25 * rimUp + 0.75 * lightUp);
    // hero backlight: a practical from behind and above the bike. Separates the
    // silhouette from the road and throws a pool of light behind it.
    const back = refs.studio.current;
    back.intensity = 55 * (1 - h) * lightUp;
    back.position.copy(t.bike).addScaledVector(f.tangent, -6).addScaledVector(t.towardCenter, 1.2);
    back.position.y += 4.2;
    back.target.position.copy(t.bike);
    back.target.position.y += 0.9;
    back.target.updateMatrixWorld();

    // nearest street lamp lends its light to the bike as it rides under it
    const lamps = refs.lamps.current;
    if (lamps && lamps.data.length) {
      let best = lamps.data[0], bd = Infinity;
      for (const d of lamps.data) {
        const dd = Math.abs(d.s - s);
        if (dd < bd) { bd = dd; best = d; }
      }
      const L = lamps.light;
      L.position.copy(best.headPos);
      L.target.position.set(best.headPos.x, best.roadY, best.headPos.z);
      L.target.updateMatrixWorld();
      L.intensity = 45 * sstep(LAMP_SPACING / 2, 5, bd) * lightUp;
      lamps.glowMat.opacity = 0.55 * lightUp;
      lamps.poolMat.opacity = lightUp;
      lamps.headMat.emissiveIntensity = 1.4 * lightUp;
    }

    // ---- atmosphere: dark studio → open road with a distant horizon
    // black → the night road comes up around the bike
    scene.background.copy(BLACK).lerp(NIGHT_BG, lightUp);
    scene.fog.color.copy(BLACK).lerp(NIGHT_FOG, lightUp);
    scene.fog.density = THREE.MathUtils.lerp(0.024, 0.014, h);
    const sky = refs.sky.current;
    sky.position.x = camera.position.x;
    sky.position.z = camera.position.z;
    sky.material.opacity = lightUp;


    // ---- keep rendering only while something is still changing
    const busy =
      t.frames < 4 ||
      (!REDUCED_MOTION && !INSTANT && h < 0.02 && !document.hidden) ||
      !introDone ||
      t.m !== targetM || t.v !== 0 ||
      Math.abs(journey.speed) > 1e-3 ||
      Math.abs(t.lean) > 1e-4 ||
      Math.abs(t.near - near) > 1e-3 ||
      Math.abs(camera.fov - fov) > 0.01 ||
      camera.position.distanceToSquared(t.camPos) > 1e-7 ||
      t.lookSmooth.distanceToSquared(t.look) > 1e-7;
    if (busy) invalidate();
  });
  return null;
}

export default function Scene() {
  const curve = useMemo(makePath, []);
  const length = useMemo(() => curve.getLength(), [curve]);
  const rideLength = length - TAIL_S - START_S;

  const refs = {
    bike: useRef(), lean: useRef(), key: useRef(), rim: useRef(), studio: useRef(),
    fill: useRef(), head: useRef(), glow: useRef(), sky: useRef(),
    edge: useRef(), hemi: useRef(), lamps: useRef(), signs: useRef(), type: useRef(),
  };
  const startPoint = useMemo(() => {
    const f = frameAt(curve, length, START_S);
    return f.point.clone().addScaledVector(f.left, -BIKE_LATERAL);
  }, [curve, length]);
  const studioTarget = useMemo(() => new THREE.Object3D(), []);

  return (
    <>
      <PerspectiveCamera makeDefault fov={40} near={0.1} far={400} position={[4, 1.2, 4]} />
      <color attach="background" args={["#050608"]} />
      {/* fog a touch lighter than the sky gives a soft horizon and depth */}
      <fogExp2 attach="fog" args={["#0A0D10", 0.075]} />

      <hemisphereLight ref={refs.hemi} args={["#9fb0c2", "#0b0e12", 0]} />
      <directionalLight
        ref={refs.key}
        intensity={1.6}
        color="#e8edf2"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      {/* soft fill from behind the camera so the rider's back reads */}
      <directionalLight ref={refs.fill} intensity={0.55} color="#c9d3dc" />
      {/* white edge light — outlines the bike against the dark in the hero */}
      <spotLight ref={refs.edge} intensity={0} color="#ffffff" angle={0.38} penumbra={0.7} distance={16} decay={1.4} />
      {/* narrow blue rim that mostly catches the rider's silhouette, not the road */}
      <spotLight ref={refs.rim} intensity={5} color="#36A9FF" angle={0.22} penumbra={1} distance={14} decay={1.5} />
      <spotLight
        ref={refs.studio}
        position={[startPoint.x, 7, startPoint.z]}
        angle={0.55}
        penumbra={1}
        decay={1.6}
        distance={20}
        intensity={0}
        color="#eef2f6"
        target={studioTarget}
      />
      <primitive object={studioTarget} position={[startPoint.x, 0, startPoint.z]} />

      <Road curve={curve} length={length} />
      <Ground />
      <Trees curve={curve} length={length} />
      <Guardrail curve={curve} length={length} rideLength={rideLength} />
      <StreetLamps curve={curve} length={length} lampsRef={refs.lamps} />
      <Boards curve={curve} length={length} rideLength={rideLength} signsRef={refs.signs} />
      <Roadside curve={curve} length={length} rideLength={rideLength} />
      <Sky skyRef={refs.sky} />
      <HeroType typeRef={refs.type} />
      <Motorcycle bikeRef={refs.bike} leanRef={refs.lean} headRef={refs.head} glowRef={refs.glow} />
      <Director curve={curve} length={length} rideLength={rideLength} refs={refs} />

      {/* Local studio-style reflections — no remote HDR download */}
      <Environment resolution={256} frames={1} environmentIntensity={0.5}>
        <Lightformer form="rect" intensity={2.2} color="#e9eef3" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
        <Lightformer form="rect" intensity={0.9} color="#cfd6dd" position={[0, 1.2, -12]} scale={[30, 1.2, 1]} />
        <Lightformer form="rect" intensity={0.7} color="#36A9FF" position={[-10, 1.5, 0]} rotation-y={Math.PI / 2} scale={[8, 0.8, 1]} />
      </Environment>
    </>
  );
}

useGLTF.preload(MODEL_URL);
