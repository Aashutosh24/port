import React, { useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LANE_SIDE, ROAD_WIDTH, START_S, frameAt } from "../journey.js";
import { checkpoints, startSign } from "../content.js";
import {
  createBoardTexture, createGlowTexture, createGroundTexture, createPoolTexture, createTreeTexture,
} from "./effects.js";

const HALF = ROAD_WIDTH / 2;
export const GROUND_Y = -0.2;

// The world now runs the whole length of the road, including the stretch
// behind the start line that the hero shot looks down.
const WORLD_START = 0;

let seed = 5;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const at = (f, lat) => new THREE.Vector3(f.point.x - f.left.x * lat, f.point.y, f.point.z - f.left.z * lat);

// ---------------------------------------------------------------------------
export function Ground() {
  const gl = useThree((s) => s.gl);
  const map = useMemo(() => {
    const t = createGroundTexture(Math.min(4, gl.capabilities.getMaxAnisotropy()));
    t.repeat.set(140, 140);
    return t;
  }, [gl]);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, GROUND_Y, -200]}>
      <planeGeometry args={[900, 900]} />
      <meshStandardMaterial map={map} color="#9aa29c" roughness={1} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Cross-billboard trees: two quads per tree, instanced. Cheap and reads well in fog.
function crossGeometry() {
  const a = new THREE.PlaneGeometry(1, 1);
  a.translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const merge = (attr) => {
    const A = a.getAttribute(attr).array, B = b.getAttribute(attr).array;
    const out = new Float32Array(A.length + B.length);
    out.set(A);
    out.set(B, A.length);
    return new THREE.BufferAttribute(out, a.getAttribute(attr).itemSize);
  };
  ["position", "normal", "uv"].forEach((k) => g.setAttribute(k, merge(k)));
  const ia = a.getIndex().array, n = a.getAttribute("position").count;
  g.setIndex([...ia, ...Array.from(ia, (i) => i + n)]);
  return g;
}

export function Trees({ curve, length }) {
  const refs = [useRef(), useRef()];
  const { geo, mats, groups } = useMemo(() => {
    seed = 5;
    // road samples to keep trees off the tarmac anywhere along the curve
    const samples = [];
    const f = {};
    for (let s = 0; s < length; s += 3) samples.push(at(frameAt(curve, length, s, f), 0));
    const clear = (p, r = 11) => samples.every((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 > r * r);

    const groups = [[], []];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let s = WORLD_START; s < length; s += 4 + rnd() * 7) {
      frameAt(curve, length, s, f);
      for (const side of [-1, 1]) {
        if (rnd() < 0.35) continue; // gaps between clumps
        const lat = side * (HALF + 9 + rnd() * rnd() * 55);
        const p = at(f, lat);
        if (!clear(p)) continue;
        const hgt = 6 + rnd() * 7;
        e.set(0, rnd() * Math.PI, 0);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(p.x, GROUND_Y - 0.1, p.z), q, new THREE.Vector3(hgt * 0.55, hgt, hgt * 0.55));
        groups[rnd() < 0.6 ? 0 : 1].push(m.clone());
      }
    }
    // low roadside scrub: sparse, small, just beyond the shoulder
    for (let s = WORLD_START; s < length; s += 5 + rnd() * 6) {
      frameAt(curve, length, s, f);
      for (const side of [-1, 1]) {
        if (rnd() < 0.55) continue;
        const p = at(f, side * (HALF + 5 + rnd() * 5));
        if (!clear(p, 7.5)) continue;
        const hgt = 0.9 + rnd() * 1.3;
        e.set(0, rnd() * Math.PI, 0);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(p.x, GROUND_Y - 0.15, p.z), q, new THREE.Vector3(hgt * 1.4, hgt, hgt * 1.4));
        groups[1].push(m.clone());
      }
    }
    const mat = (kind) => new THREE.MeshStandardMaterial({
      map: createTreeTexture(kind), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: "#b8c2bc",
    });
    return { geo: crossGeometry(), mats: [mat("pine"), mat("broad")], groups };
  }, [curve, length]);

  useLayoutEffect(() => {
    groups.forEach((list, gi) => {
      list.forEach((mm, i) => refs[gi].current.setMatrixAt(i, mm));
      refs[gi].current.instanceMatrix.needsUpdate = true;
    });
  }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

  return groups.map((list, gi) => (
    <instancedMesh key={gi} ref={refs[gi]} args={[geo, mats[gi], list.length]} frustumCulled={false} />
  ));
}

// ---------------------------------------------------------------------------
// Steel guardrail along the far shoulder: posts + one continuous beam that
// follows the road. Gaps at each checkpoint gantry.
export function Guardrail({ curve, length, rideLength }) {
  const posts = useRef();
  const { beam, postMats } = useMemo(() => {
    const side = -LANE_SIDE;
    const lat = side * (HALF + 1.35);
    const gaps = [START_S + START_SIGN_OFFSET, ...checkpoints.map((c) => START_S + c.at * rideLength)];
    const inGap = (s) => gaps.some((g) => Math.abs(g - s) < 3.5);
    const f = {};
    const pos = [], idx = [], nor = [];
    const postMats = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let prevOk = false, n = 0;
    for (let s = WORLD_START - 20; s < length - 4; s += 1) {
      frameAt(curve, length, s, f);
      const ok = !inGap(s);
      const p = at(f, lat);
      const base = f.point.y - 0.07;
      // beam: two rows of verts (bottom/top); normals face the road
      pos.push(p.x, base + 0.5, p.z, p.x, base + 0.82, p.z);
      const nx = f.left.x * side, nz = f.left.z * side;
      nor.push(nx, 0, nz, nx, 0, nz);
      if (ok && prevOk) {
        const a = (n - 1) * 2, b = n * 2;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      if (ok && Math.round(s) % 4 === 0) {
        e.set(0, Math.atan2(f.tangent.x, f.tangent.z), 0);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(p.x - f.left.x * side * 0.12, base + 0.36, p.z - f.left.z * side * 0.12), q, new THREE.Vector3(1, 1, 1));
        postMats.push(m.clone());
      }
      prevOk = ok;
      n++;
    }
    const beam = new THREE.BufferGeometry();
    beam.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    beam.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    beam.setIndex(idx);
    return { beam, postMats };
  }, [curve, length, rideLength]);

  useLayoutEffect(() => {
    postMats.forEach((mm, i) => posts.current.setMatrixAt(i, mm));
    posts.current.instanceMatrix.needsUpdate = true;
  }, [postMats]);

  return (
    <group>
      <mesh geometry={beam}>
        <meshStandardMaterial color="#8d949b" metalness={0.8} roughness={0.38} side={THREE.DoubleSide} envMapIntensity={0.9} />
      </mesh>
      <instancedMesh ref={posts} args={[null, null, postMats.length]}>
        <boxGeometry args={[0.1, 0.72, 0.12]} />
        <meshStandardMaterial color="#5e656c" metalness={0.6} roughness={0.5} />
      </instancedMesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Street lamps on the bike's side. Each has a glowing head, a light pool on the
// road, and one real light that follows the nearest lamp (so the bike is lit
// as it rides under them).
export const LAMP_SPACING = 46;
export function StreetLamps({ curve, length, lampsRef }) {
  const pole = useRef(), arm = useRef(), head = useRef();
  const light = useRef();
  const data = useMemo(() => {
    const f = {};
    const list = [];
    // phase chosen so no lamp stands between the hero camera and the bike,
    // and one glows a little way beyond the start-line sign
    const phase = (((START_S + 14) % LAMP_SPACING) + LAMP_SPACING) % LAMP_SPACING;
    for (let s = phase; s < length - 10; s += LAMP_SPACING) {
      frameAt(curve, length, s, f);
      const base = at(f, LANE_SIDE * (HALF + 1.3));
      const headPos = at(f, LANE_SIDE * (HALF - 1.2));
      headPos.y = GROUND_Y + 8.1;
      list.push({ s, base, headPos, yaw: Math.atan2(f.tangent.x, f.tangent.z), roadY: f.point.y });
    }
    return list;
  }, [curve, length]);

  const glowMat = useMemo(() => new THREE.SpriteMaterial({
    map: createGlowTexture(), color: "#dfe7ef", blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, opacity: 0.55,
  }), []);
  const poolMat = useMemo(() => new THREE.MeshBasicMaterial({
    map: createPoolTexture(), color: "#b9c4cf", blending: THREE.AdditiveBlending, transparent: true,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }), []);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    data.forEach((d, i) => {
      e.set(0, d.yaw, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(d.base.x, GROUND_Y + 4, d.base.z), q, new THREE.Vector3(1, 1, 1));
      pole.current.setMatrixAt(i, m);
      const mid = d.base.clone().lerp(d.headPos, 0.5);
      // arm runs across the road: rotate the box so its length is lateral
      m.compose(new THREE.Vector3(mid.x, GROUND_Y + 8.15, mid.z), q, new THREE.Vector3(1, 1, 1));
      arm.current.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(d.headPos.x, d.headPos.y - 0.05, d.headPos.z), q, new THREE.Vector3(1, 1, 1));
      head.current.setMatrixAt(i, m);
    });
    [pole, arm, head].forEach((r) => (r.current.instanceMatrix.needsUpdate = true));
    lampsRef.current = { data, light: light.current, glowMat, poolMat, headMat: head.current.material };
  }, [data, lampsRef, glowMat, poolMat]);

  return (
    <group>
      <instancedMesh ref={pole} args={[null, null, data.length]} castShadow={false}>
        <cylinderGeometry args={[0.07, 0.11, 8, 10]} />
        <meshStandardMaterial color="#5d646b" metalness={0.6} roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={arm} args={[null, null, data.length]}>
        <boxGeometry args={[2.5, 0.08, 0.08]} />
        <meshStandardMaterial color="#5d646b" metalness={0.6} roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={head} args={[null, null, data.length]}>
        <boxGeometry args={[0.55, 0.1, 0.22]} />
        <meshStandardMaterial color="#2a2f35" emissive="#eef3f8" emissiveIntensity={1.4} roughness={0.4} />
      </instancedMesh>
      {data.map((d, i) => (
        <group key={i}>
          <sprite position={[d.headPos.x, d.headPos.y - 0.15, d.headPos.z]} scale={1.6} material={glowMat} />
          <mesh position={[d.headPos.x, d.roadY + 0.075, d.headPos.z]} rotation={[-Math.PI / 2, 0, -d.yaw]} material={poolMat}>
            <planeGeometry args={[11, 14]} />
          </mesh>
        </group>
      ))}
      <spotLight ref={light} angle={0.95} penumbra={0.9} distance={18} decay={1.2} intensity={0} color="#e3eaf1" />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Checkpoint gantries. One per checkpoint, spanning the road like a real
// overhead information sign: galvanised posts on concrete footings, a two-tube
// truss, a lit sign face, and a wash of light on the road beneath it.
// The sign "switches on" as the bike approaches (driven from the Director).
const SPAN = ROAD_WIDTH + 2.2;
export const SIGN_Y = 4.9; // centre of the sign above the road
// The start line: sign "00" stands behind the bike and carries the name.
export const START_SIGN_OFFSET = -22;
const STEEL = { color: "#737a82", metalness: 0.75, roughness: 0.38 };

export function Boards({ curve, length, rideLength, signsRef }) {
  const light = useRef();
  const { boards, glowTex, poolTex } = useMemo(() => {
    const f = {};
    const glowTex = createGlowTexture();
    const poolTex = createPoolTexture();
    const signs = [
      { s: START_S + START_SIGN_OFFSET, number: startSign.number, label: startSign.label, title: startSign.title },
      ...checkpoints.map((c) => ({ ...c, s: START_S + c.at * rideLength })), // bike passes under as its panel opens
    ];
    const boards = signs.map((c) => {
      const s = c.s;
      frameAt(curve, length, s, f);
      const p = at(f, 0);
      const tex = createBoardTexture({ number: c.number, label: c.label, title: c.title });
      return {
        s,
        point: p.clone(),
        tangent: f.tangent.clone(),
        position: [p.x, f.point.y, p.z],
        rotationY: Math.atan2(f.tangent.x, f.tangent.z), // faces the way the bike travels (toward the camera)
        face: new THREE.MeshStandardMaterial({
          map: tex, emissiveMap: tex, emissive: "#ffffff", emissiveIntensity: 0.25, roughness: 0.6,
        }),
        glow: new THREE.SpriteMaterial({
          map: glowTex, color: "#e6edf4", blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.2,
        }),
        pool: new THREE.MeshBasicMaterial({
          map: poolTex, color: "#aab5c0", blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -2, opacity: 0.2,
        }),
      };
    });
    return { boards, glowTex, poolTex };
  }, [curve, length, rideLength]);

  useLayoutEffect(() => {
    signsRef.current = { list: boards, light: light.current };
  }, [boards, signsRef]);

  const back = <meshStandardMaterial color="#1b2127" roughness={0.8} />;
  return (
    <group>
      {boards.map((b, i) => (
        <group key={i} position={b.position} rotation-y={b.rotationY}>
          {/* posts + footings */}
          {[-SPAN / 2, SPAN / 2].map((x) => (
            <group key={x} position={[x, 0, -0.15]}>
              <mesh position={[0, GROUND_Y + 0.12, 0]} receiveShadow>
                <boxGeometry args={[0.6, 0.3, 0.6]} />
                <meshStandardMaterial color="#3a3e42" roughness={0.95} />
              </mesh>
              <mesh position={[0, (SIGN_Y + 1.4) / 2, 0]}>
                <cylinderGeometry args={[0.13, 0.15, SIGN_Y + 1.4, 14]} />
                <meshStandardMaterial {...STEEL} />
              </mesh>
            </group>
          ))}
          {/* truss: two tubes with struts */}
          {[SIGN_Y + 1.3, SIGN_Y - 1.3].map((y) => (
            <mesh key={y} position={[0, y, -0.15]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.07, 0.07, SPAN, 10]} />
              <meshStandardMaterial {...STEEL} />
            </mesh>
          ))}
          {[-3.4, -1.7, 0, 1.7, 3.4].map((x) => (
            <mesh key={x} position={[x, SIGN_Y, -0.15]}>
              <boxGeometry args={[0.05, 2.6, 0.05]} />
              <meshStandardMaterial {...STEEL} />
            </mesh>
          ))}
          {/* sign: frame, face */}
          <mesh position={[0, SIGN_Y, -0.02]}>
            <boxGeometry args={[4.72, 2.42, 0.1]} />
            {back}
          </mesh>
          <mesh position={[0, SIGN_Y, 0.035]} material={b.face}>
            <planeGeometry args={[4.6, 2.3]} />
          </mesh>
          {/* three sign lights on short arms, angled at the face */}
          {[-1.5, 0, 1.5].map((x) => (
            <group key={x} position={[x, SIGN_Y + 1.42, 0.45]}>
              <mesh position={[0, 0, -0.2]}>
                <boxGeometry args={[0.04, 0.04, 0.45]} />
                <meshStandardMaterial {...STEEL} />
              </mesh>
              <mesh rotation-x={0.5}>
                <boxGeometry args={[0.34, 0.07, 0.16]} />
                <meshStandardMaterial color="#2a2f35" emissive="#eef3f8" emissiveIntensity={0.9} roughness={0.4} />
              </mesh>
              <sprite position={[0, -0.06, 0.05]} scale={0.9} material={b.glow} />
            </group>
          ))}
          {/* practical light on the road under the gantry */}
          <mesh position={[0, 0.075, 1.5]} rotation-x={-Math.PI / 2} material={b.pool}>
            <planeGeometry args={[9, 11]} />
          </mesh>
        </group>
      ))}
      {/* one real light that follows the nearest gantry: lights the bike as it rides under */}
      <spotLight ref={light} angle={0.85} penumbra={0.9} distance={16} decay={1.3} intensity={0} color="#e6edf4" />
    </group>
  );
}
