// Engine + wind sound, built with the Web Audio API (no files, no libraries).
//
// If a real recording is dropped at /public/audio/engine.mp3 (a seamless idle
// loop, 2–6 s), it is used instead of the synthesised engine and pitched with
// the bike's speed.

const SAMPLE_URL = "/audio/engine.mp3";
// Overall loudness. Kept low on purpose: a background layer, not a game.
export const VOLUME = 0.32;
const IDLE_RPM = 1100;
const MAX_RPM = 7600;
const TOP_SPEED = 48; // m/s that maps to redline; steady cruise (24 m/s) sits mid-range

function noiseBuffer(ctx, seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function softClip(k = 2.2, n = 1024) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

// Harmonic recipe for a four-cylinder exhaust note: strong low harmonics,
// a bump around the 4th–6th (the "bark"), then a fast roll-off.
function engineWave(ctx) {
  const N = 32;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    const bark = 1 + 0.9 * Math.exp(-((n - 5) ** 2) / 6);
    imag[n] = (bark / Math.pow(n, 1.15)) * (n % 2 ? 1 : 0.7);
  }
  return ctx.createPeriodicWave(real, imag);
}

export class RideAudio {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.running = false;
    this.useSample = false;
  }

  // Must be called from a click / tap (browser autoplay rules).
  async enable() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.#build(this.ctx);
      await this.#loadSample();
      document.addEventListener("visibilitychange", () => {
        if (!this.on) return;
        if (document.hidden) this.ctx.suspend();
        else this.ctx.resume();
      });
    }
    await this.ctx.resume();
    this.on = true;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(VOLUME, t, 0.4);
    if (!this.running) this.#ignition();
    return true;
  }

  disable() {
    if (!this.ctx) return;
    this.on = false;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.12);
    clearTimeout(this._suspend);
    this._suspend = setTimeout(() => !this.on && this.ctx.suspend(), 600);
  }

  // Called every rendered frame with the bike's speed (m/s).
  update(speed) {
    if (!this.on || !this.running) return;
    const t = this.ctx.currentTime;
    const v = Math.min(Math.abs(speed) / TOP_SPEED, 1);
    const load = v; // linear: a constant ride speed gives a constant engine note
    const rpm = IDLE_RPM + load * (MAX_RPM - IDLE_RPM);
    this.#setRpm(rpm, t, 0.09);
    this.lp.frequency.setTargetAtTime(320 + rpm * 0.28, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.24 + load * 0.16, t, 0.12);
    this.exhaustGain.gain.setTargetAtTime(0.015 + load * 0.05, t, 0.1);
    this.windGain.gain.setTargetAtTime(v * v * 0.14, t, 0.3);
    this.windLp.frequency.setTargetAtTime(350 + v * 1400, t, 0.25);
  }

  // ---------------------------------------------------------------------------
  #build(ctx) {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // engine chain: sources -> shaper -> lowpass -> engineGain -> master
    this.engineIn = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip();
    shaper.oversample = "2x";
    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.Q.value = 1.2;
    this.lp.frequency.value = 600;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineIn.connect(shaper).connect(this.lp).connect(this.engineGain).connect(this.master);

    const wave = engineWave(ctx);
    const f0 = this.#hz(IDLE_RPM);
    this.oscA = ctx.createOscillator();
    this.oscA.setPeriodicWave(wave);
    this.oscA.frequency.value = f0;
    this.oscB = ctx.createOscillator();
    this.oscB.setPeriodicWave(wave);
    this.oscB.frequency.value = f0;
    this.oscB.detune.value = 11;
    this.sub = ctx.createOscillator();
    this.sub.type = "sine";
    this.sub.frequency.value = f0 / 2;

    // uneven firing "lope" at idle
    this.lope = ctx.createOscillator();
    this.lope.frequency.value = f0 / 4;
    const lopeDepth = ctx.createGain();
    lopeDepth.gain.value = 0.22;
    this.pulse = ctx.createGain();
    this.pulse.gain.value = 0.8;
    this.lope.connect(lopeDepth).connect(this.pulse.gain);

    const gA = ctx.createGain(); gA.gain.value = 0.5;
    const gB = ctx.createGain(); gB.gain.value = 0.35;
    const gS = ctx.createGain(); gS.gain.value = 0.2; // sub-bass: felt on good speakers, inaudible on laptops
    this.oscA.connect(gA).connect(this.pulse);
    this.oscB.connect(gB).connect(this.pulse);
    this.sub.connect(gS).connect(this.pulse);
    this.pulse.connect(this.engineIn);

    // exhaust breath + wind, both from one noise buffer
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.7;
    this.exhaustGain = ctx.createGain();
    this.exhaustGain.gain.value = 0;
    noise.connect(bp).connect(this.exhaustGain).connect(this.engineIn);

    this.windLp = ctx.createBiquadFilter();
    this.windLp.type = "lowpass";
    this.windLp.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(this.windLp).connect(this.windGain).connect(this.master);

    // starter motor
    this.starter = ctx.createOscillator();
    this.starter.type = "sawtooth";
    this.starter.frequency.value = 140;
    this.starterGain = ctx.createGain();
    this.starterGain.gain.value = 0;
    const starterLp = ctx.createBiquadFilter();
    starterLp.type = "lowpass";
    starterLp.frequency.value = 900;
    this.starter.connect(starterLp).connect(this.starterGain).connect(this.master);

    [this.oscA, this.oscB, this.sub, this.lope, noise, this.starter].forEach((n) => n.start());
  }

  async #loadSample() {
    try {
      const res = await fetch(SAMPLE_URL);
      if (!res.ok || !(res.headers.get("content-type") || "").startsWith("audio")) return;
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 1.2;
      src.connect(g).connect(this.lp);
      src.start();
      this.sample = src;
      this.useSample = true;
      this.pulse.disconnect(); // real recording replaces the synth voices
    } catch {
      /* no sample provided — synth it is */
    }
  }

  #hz(rpm) {
    return (rpm / 60) * 2; // 4-cylinder, 4-stroke: two firings per revolution
  }

  #setRpm(rpm, t, tau) {
    const f = this.#hz(rpm);
    this.oscA.frequency.setTargetAtTime(f, t, tau);
    this.oscB.frequency.setTargetAtTime(f, t, tau);
    this.sub.frequency.setTargetAtTime(f / 2, t, tau);
    this.lope.frequency.setTargetAtTime(f / 4, t, tau);
    if (this.sample) this.sample.playbackRate.setTargetAtTime(Math.min(rpm / IDLE_RPM, 2.4), t, tau);
  }

  // crank → catch → blip → settle to idle
  #ignition() {
    const t = this.ctx.currentTime + 0.05;
    const sg = this.starterGain.gain;
    sg.setValueAtTime(0, t);
    sg.linearRampToValueAtTime(0.035, t + 0.05);
    for (let i = 0; i < 7; i++) sg.setValueAtTime(i % 2 ? 0.015 : 0.035, t + 0.05 + i * 0.07);
    sg.linearRampToValueAtTime(0, t + 0.6);
    this.starter.frequency.setValueAtTime(110, t);
    this.starter.frequency.linearRampToValueAtTime(190, t + 0.55);

    const catchAt = t + 0.55;
    this.#setRpm(IDLE_RPM, t, 0.01);
    this.engineGain.gain.setValueAtTime(0, catchAt);
    this.engineGain.gain.linearRampToValueAtTime(0.36, catchAt + 0.1);
    this.engineGain.gain.setTargetAtTime(0.24, catchAt + 0.5, 0.3);
    this.lp.frequency.setValueAtTime(600, catchAt);
    this.lp.frequency.linearRampToValueAtTime(1500, catchAt + 0.15);
    this.lp.frequency.setTargetAtTime(630, catchAt + 0.3, 0.3);
    const f = (r) => this.#hz(r);
    for (const o of [this.oscA, this.oscB]) {
      o.frequency.setValueAtTime(f(1400), catchAt);
      o.frequency.linearRampToValueAtTime(f(3200), catchAt + 0.16);
      o.frequency.setTargetAtTime(f(IDLE_RPM), catchAt + 0.2, 0.25);
    }
    this.sub.frequency.setValueAtTime(f(1400) / 2, catchAt);
    this.sub.frequency.linearRampToValueAtTime(f(3200) / 2, catchAt + 0.16);
    this.sub.frequency.setTargetAtTime(f(IDLE_RPM) / 2, catchAt + 0.2, 0.25);
    if (this.sample) {
      this.sample.playbackRate.setValueAtTime(1.3, catchAt);
      this.sample.playbackRate.linearRampToValueAtTime(2.2, catchAt + 0.16);
      this.sample.playbackRate.setTargetAtTime(1, catchAt + 0.2, 0.25);
    }
    setTimeout(() => (this.running = true), 1200);
  }
}

export const rideAudio = new RideAudio();
