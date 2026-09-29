import * as THREE from "three";

// Soft radial glow for lamps. White so SpriteMaterial.color can tint it.
export function createGlowTexture(size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, "rgba(255,255,255,0.85)");
  g.addColorStop(0.35, "rgba(255,255,255,0.22)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Thin horizontal lens streak (the cinematic "anamorphic" flare).
export function createStreakTexture(w = 256, h = 32) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const gx = ctx.createLinearGradient(0, 0, w, 0);
  gx.addColorStop(0, "rgba(255,255,255,0)");
  gx.addColorStop(0.5, "rgba(255,255,255,1)");
  gx.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, w, h);
  // fade vertically
  ctx.globalCompositeOperation = "destination-in";
  const gy = ctx.createLinearGradient(0, 0, 0, h);
  gy.addColorStop(0, "rgba(0,0,0,0)");
  gy.addColorStop(0.5, "rgba(0,0,0,1)");
  gy.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gy;
  ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Night sky band for a cylinder around the camera: faint horizon glow and
// distant hill silhouettes. Seamless horizontally.
export const SKY = { radius: 360, height: 160, centerY: 20 }; // horizon lands at y ≈ 0
export function createSkyTexture() {
  const w = 2048, h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const horizon = Math.round(h * (1 - (SKY.height / 2 - SKY.centerY) / SKY.height)); // row of y = 0

  // moonlit night: slate haze at the horizon, deep blue-black overhead
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, "#07090d");
  g.addColorStop(0.45, "#0b1016");
  g.addColorStop(0.8, "#141c25");
  g.addColorStop(1, "#1f2934");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, horizon);

  // faint stars in the upper sky
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 70; i++) {
    const y = rnd() * horizon * 0.45;
    const a = 0.08 + rnd() * 0.22;
    ctx.fillStyle = `rgba(220,230,240,${a})`;
    ctx.fillRect(rnd() * w, y, rnd() < 0.1 ? 2 : 1, 1);
  }

  // ground band below the horizon
  ctx.fillStyle = "#0c1014";
  ctx.fillRect(0, horizon, w, h - horizon);

  // two ridgelines: far (hazy) and near (darker)
  const ridge = (amp, base, freqs, color) => {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) {
      const u = (x / w) * Math.PI * 2;
      let y = 0;
      freqs.forEach(([f, a, p]) => (y += Math.sin(u * f + p) * a));
      ctx.lineTo(x, horizon - base - amp * (0.5 + 0.5 * y));
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  ridge(30, 2, [[3, 0.5, 0.4], [7, 0.3, 1.9], [13, 0.15, 0.2], [29, 0.05, 2.2]], "#151d25");
  ridge(18, -2, [[2, 0.5, 2.1], [5, 0.35, 0.7], [11, 0.2, 3.1], [23, 0.07, 1.3]], "#0d1217");

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

let seedW = 91;
const rw = () => ((seedW = (seedW * 16807) % 2147483647) - 1) / 2147483646;

function noiseCanvas(size, base, spread, blotch) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < blotch.count; i++) {
    const x = rw() * size, y = rw() * size, r = blotch.min + rw() * (blotch.max - blotch.min);
    const light = rw() < 0.5;
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, light ? `rgba(120,140,120,${blotch.alpha})` : `rgba(0,0,0,${blotch.alpha * 1.5})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    }
  }
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rw() - 0.5) * spread;
    img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Rough grass / earth for the fields either side of the road.
export function createGroundTexture(maxAniso = 4) {
  const t = new THREE.CanvasTexture(noiseCanvas(512, "#1c211d", 30, { count: 70, min: 25, max: 130, alpha: 0.26 }));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

// Tree silhouettes for camera-facing cross billboards. kind: "pine" | "broad"
export function createTreeTexture(kind) {
  const w = 256, h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const body = "#0d1310", lit = "#24302b";
  ctx.fillStyle = "#1a1512";
  ctx.fillRect(w / 2 - 5, h * 0.72, 10, h * 0.28); // trunk
  if (kind === "pine") {
    for (let i = 0; i < 9; i++) {
      const y = h * 0.06 + i * h * 0.075;
      const half = 18 + i * 12 + rw() * 10;
      const g = ctx.createLinearGradient(0, y, 0, y + 90);
      g.addColorStop(0, lit);
      g.addColorStop(0.35, body);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(w / 2, y);
      ctx.lineTo(w / 2 + half, y + 80 + rw() * 14);
      ctx.lineTo(w / 2 - half, y + 80 + rw() * 14);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    for (let i = 0; i < 70; i++) {
      const a = rw() * Math.PI * 2, r = rw() * 90;
      const x = w / 2 + Math.cos(a) * r, y = h * 0.4 + Math.sin(a) * r * 1.15;
      const rr = 22 + rw() * 30;
      const g = ctx.createRadialGradient(x, y - rr * 0.4, 0, x, y, rr);
      g.addColorStop(0, y < h * 0.33 ? lit : body);
      g.addColorStop(1, body);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soft elliptical pool of lamp light, drawn onto the road as an additive decal.
export function createPoolTexture(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.55)");
  g.addColorStop(0.4, "rgba(255,255,255,0.22)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Checkpoint sign face. Designed like a premium road information sign:
// matte dark face, thin white retroreflective border, clear hierarchy.
// The HTML panel's "plate" mirrors the top row, so the two read as one thing.
export function createBoardTexture({ number, label, title }) {
  const w = 1024, h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");

  // face, slightly brighter at the top where the sign lights wash it
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#1a2129");
  g.addColorStop(0.45, "#12171d");
  g.addColorStop(1, "#0d1115");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rw() * 0.025})`;
    ctx.fillRect(rw() * w, rw() * h, 2, 2);
  }

  // thin white border
  const inset = 30;
  ctx.strokeStyle = "rgba(242,245,247,0.92)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, 16);
  ctx.stroke();

  const font = 'Inter, "Helvetica Neue", Arial, sans-serif';
  const pad = 88;
  const spaced = (em) => { if ("letterSpacing" in ctx) ctx.letterSpacing = `${em}px`; };

  // top row: number | label
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#36A9FF";
  ctx.font = `700 50px ${font}`;
  spaced(1);
  ctx.fillText(number, pad, 146);
  const nw = ctx.measureText(number).width;
  ctx.fillStyle = "rgba(242,245,247,0.25)";
  ctx.fillRect(pad + nw + 26, 106, 2, 48);
  ctx.fillStyle = "#8D969F";
  spaced(6);
  let ls = 30;
  ctx.font = `600 ${ls}px ${font}`;
  while (ctx.measureText(label.toUpperCase()).width > w - pad - (pad + nw + 54) && ls > 18) {
    ls -= 1;
    ctx.font = `600 ${ls}px ${font}`;
  }
  ctx.fillText(label.toUpperCase(), pad + nw + 54, 142);

  // title
  ctx.fillStyle = "#F2F5F7";
  spaced(2);
  let size = 132;
  ctx.font = `800 ${size}px ${font}`;
  const t = title.toUpperCase();
  while (ctx.measureText(t).width > w - pad * 2 && size > 60) {
    size -= 4;
    ctx.font = `800 ${size}px ${font}`;
  }
  ctx.fillText(t, pad - 4, 330);

  // small blue accent under the title
  ctx.fillStyle = "#168BFF";
  ctx.fillRect(pad, 382, 64, 6);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Hero statement: large, tight, left-aligned lines. Fades slightly toward the
// bottom so the words feel like they sit in the night air, not on a screen.
export function createStatementTexture(lines) {
  const w = 2048, lineH = 380, padY = 40;
  const h = lines.length * lineH + padY * 2;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const font = 'Inter, "Helvetica Neue", Arial, sans-serif';
  if ("letterSpacing" in ctx) ctx.letterSpacing = "-14px";
  let size = 400;
  ctx.font = `700 ${size}px ${font}`;
  const widest = () => Math.max(...lines.map((l) => ctx.measureText(l.toUpperCase()).width));
  while (widest() > w - 40 && size > 120) {
    size -= 8;
    ctx.font = `700 ${size}px ${font}`;
  }
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(242,245,247,1)");
  g.addColorStop(1, "rgba(242,245,247,0.55)");
  ctx.fillStyle = g;
  ctx.textBaseline = "alphabetic";
  lines.forEach((l, i) => ctx.fillText(l.toUpperCase(), 10, padY + lineH * (i + 1) - 60));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { map: t, aspect: w / h };
}
