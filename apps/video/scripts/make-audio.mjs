import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 48000;
const BPM = 120;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const LENGTH = 56;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "audio");

let seed = 7;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 31 - 1;
};

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const coef = (fc) => 1 - Math.exp((-2 * Math.PI * fc) / SR);

function lp(s, key, fc, x) {
  s[key] = (s[key] ?? 0) + coef(fc) * (x - (s[key] ?? 0));
  return s[key];
}

class Bus {
  constructor(seconds) {
    this.l = new Float32Array(Math.ceil(seconds * SR));
    this.r = new Float32Array(Math.ceil(seconds * SR));
  }
  add(i, v, pan = 0) {
    if (i < 0 || i >= this.l.length) return;
    this.l[i] += v * Math.min(1, 1 - pan);
    this.r[i] += v * Math.min(1, 1 + pan);
  }
}

function render(bus, start, dur, pan, fn) {
  const s0 = Math.floor(start * SR);
  const n = Math.floor(dur * SR);
  const state = {};
  for (let k = 0; k < n; k++) bus.add(s0 + k, fn(k / SR, state), pan);
}

function kick(bus, at, gain = 1) {
  render(bus, at, 0.5, 0, (t, s) => {
    s.ph = (s.ph ?? 0) + (2 * Math.PI * (45 + 110 * Math.exp(-t * 28))) / SR;
    const click = t < 0.004 ? rand() * (1 - t / 0.004) * 0.4 : 0;
    return gain * (Math.sin(s.ph) * Math.exp(-t * 7) * 0.9 + click);
  });
}

function snare(bus, verb, at, gain = 1) {
  const fn = (t, s) => {
    const n = rand();
    lp(s, "lp", 1800, n);
    const tone = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30) * 0.35;
    return gain * ((n - s.lp) * Math.exp(-t * 16) * 0.55 + tone);
  };
  render(bus, at, 0.35, 0, fn);
  render(verb, at, 0.35, 0, (t, s) => fn(t, s) * 0.35);
}

function hat(bus, at, gain = 1, open = false) {
  render(bus, at, open ? 0.25 : 0.06, 0.25, (t, s) => {
    const n = rand();
    lp(s, "lp", 7000, n);
    return gain * (n - s.lp) * Math.exp(-t * (open ? 14 : 70)) * 0.32;
  });
}

function saw(ph) {
  return 2 * (ph - Math.floor(ph + 0.5));
}

function bassNote(bus, at, dur, midi, gain = 1) {
  const f = hz(midi);
  render(bus, at, dur, 0, (t, s) => {
    s.ph = (s.ph ?? 0) + f / SR;
    const env = Math.min(1, t / 0.005) * Math.min(1, (dur - t) / 0.02) * (0.65 + 0.35 * Math.exp(-t * 6));
    const raw = saw(s.ph) * 0.6 + Math.sin(2 * Math.PI * s.ph) * 0.6;
    const cut = 260 + 900 * Math.exp(-t * 9);
    lp(s, "a", cut, raw);
    lp(s, "b", cut, s.a);
    return gain * s.b * env * 0.55;
  });
}

function padChord(bus, verb, at, dur, notes, { gain = 1, cutoff = 1800, attack = 0.4 } = {}) {
  notes.forEach((midi, i) => {
    [-0.11, 0, 0.09].forEach((det, j) => {
      const f = hz(midi) * 2 ** (det / 12);
      const pan = (j - 1) * 0.6;
      const fn = (t, s) => {
        s.ph = (s.ph ?? rand() * 0.5 + 0.5) + f / SR;
        const env = Math.min(1, t / attack) * Math.min(1, Math.max(0, (dur - t) / 0.6));
        lp(s, "a", cutoff, saw(s.ph));
        lp(s, "b", cutoff, s.a);
        return gain * s.b * env * 0.055;
      };
      render(bus, at, dur, pan, fn);
      if (i === 0 || j === 1) render(verb, at, dur, pan, (t, s) => fn(t, s) * 0.5);
    });
  });
}

function pluck(bus, verb, at, midi, { gain = 1, cutoff = 3200, pan = 0 } = {}) {
  const f = hz(midi);
  const fn = (t, s) => {
    s.ph = (s.ph ?? 0) + f / SR;
    const sq = s.ph % 1 < 0.5 ? 1 : -1;
    const cut = 500 + cutoff * Math.exp(-t * 14);
    lp(s, "a", cut, sq * 0.5 + saw(s.ph) * 0.5);
    return gain * s.a * Math.exp(-t * 9) * Math.min(1, t / 0.002) * 0.16;
  };
  render(bus, at, 0.45, pan, fn);
  [0.375, 0.75].forEach((d, i) => render(verb, at + d, 0.45, -pan, (t, s) => fn(t, s) * (0.45 / (i + 1))));
}

function riser(bus, verb, at, dur, gain = 1) {
  const fn = (t, s) => {
    const p = t / dur;
    const n = rand();
    const cut = 400 + 9000 * p * p;
    lp(s, "lp", cut, n);
    s.ph = (s.ph ?? 0) + (200 + 900 * p * p) / SR;
    return gain * (s.lp * 0.5 + Math.sin(2 * Math.PI * s.ph) * 0.12) * p ** 2.2 * 0.6;
  };
  render(bus, at, dur, 0, fn);
  render(verb, at, dur, 0, (t, s) => fn(t, s) * 0.4);
}

function impact(bus, verb, at, gain = 1) {
  render(bus, at, 2.5, 0, (t, s) => {
    s.ph = (s.ph ?? 0) + (38 + 60 * Math.exp(-t * 10)) / SR;
    return gain * Math.sin(2 * Math.PI * s.ph) * Math.exp(-t * 1.6) * 0.9;
  });
  const noise = (t, s) => {
    const n = rand();
    lp(s, "lp", 2600, n);
    return gain * s.lp * Math.exp(-t * 3.2) * 0.7;
  };
  render(bus, at, 1.5, 0, noise);
  render(verb, at, 1.5, 0, (t, s) => noise(t, s) * 1.2);
}

function reverse(bus, at, dur, gain = 1) {
  render(bus, at - dur, dur, 0, (t, s) => {
    const p = t / dur;
    const n = rand();
    lp(s, "lp", 9000, n);
    return gain * (n - s.lp) * p ** 3 * 0.35;
  });
}

function reverb(src, mix = 0.3) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356];
  const allps = [225, 556, 441];
  const run = (input, spread) => {
    const outBuf = new Float32Array(input.length);
    for (const len of combs) {
      const size = len + spread;
      const buf = new Float32Array(size);
      let idx = 0;
      let lp = 0;
      for (let i = 0; i < input.length; i++) {
        const y = buf[idx];
        lp = y * 0.7 + lp * 0.3;
        buf[idx] = input[i] + lp * 0.86;
        idx = (idx + 1) % size;
        outBuf[i] += y / combs.length;
      }
    }
    for (const len of allps) {
      const size = len + spread;
      const buf = new Float32Array(size);
      let idx = 0;
      for (let i = 0; i < outBuf.length; i++) {
        const b = buf[idx];
        const x = outBuf[i];
        buf[idx] = x + b * 0.5;
        outBuf[i] = b - x * 0.5;
        idx = (idx + 1) % size;
      }
    }
    return outBuf;
  };
  return { l: run(src.l, 0).map((v) => v * mix * 3), r: run(src.r, 23).map((v) => v * mix * 3) };
}

function wav(path, l, r) {
  const n = l.length;
  const data = Buffer.alloc(44 + n * 4);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + n * 4, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(SR, 24);
  data.writeUInt32LE(SR * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(path, data);
}

function master(dry, wet, peak = 0.89) {
  const l = new Float32Array(dry.l.length);
  const r = new Float32Array(dry.r.length);
  let max = 0;
  for (let i = 0; i < l.length; i++) {
    l[i] = Math.tanh((dry.l[i] + (wet?.l[i] ?? 0)) * 1.2);
    r[i] = Math.tanh((dry.r[i] + (wet?.r[i] ?? 0)) * 1.2);
    max = Math.max(max, Math.abs(l[i]), Math.abs(r[i]));
  }
  const g = max ? peak / max : 1;
  return { l: l.map((v) => v * g), r: r.map((v) => v * g) };
}

const A = 57;
const progression = [
  { root: A - 12, chord: [A, A + 3, A + 7, A + 12] },
  { root: A - 16, chord: [A - 4, A, A + 3, A + 8] },
  { root: A - 21, chord: [A - 9, A - 5, A - 2, A + 3] },
  { root: A - 14, chord: [A - 2, A + 2, A + 5, A + 10] },
];

function music() {
  const drums = new Bus(LENGTH + 3);
  const bass = new Bus(LENGTH + 3);
  const keys = new Bus(LENGTH + 3);
  const verb = new Bus(LENGTH + 3);
  const kicks = [];

  const groove = { from: 4, to: 44.5 };
  const drop = { from: 48.5, to: 51.5 };
  const inGroove = (t) => (t >= groove.from && t < groove.to) || (t >= drop.from && t < drop.to);

  padChord(keys, verb, 0, 4, [A - 12, A - 5, A, A + 3], { gain: 0.7, cutoff: 700, attack: 1.2 });
  for (let b = 0; b < 8; b++) hat(drums, b * BEAT, 0.35 + b * 0.04);
  impact(drums, verb, 2, 0.45);
  riser(keys, verb, 2.4, 1.55, 0.9);
  reverse(drums, 4, 0.9, 1.2);
  impact(drums, verb, 4, 1);

  for (let bar = 0; bar * BAR < LENGTH; bar++) {
    const t0 = bar * BAR;
    const { root, chord } = progression[bar % 4];
    for (let beat = 0; beat < 4; beat++) {
      const t = t0 + beat * BEAT;
      if (inGroove(t)) {
        kick(drums, t, 0.95);
        kicks.push(t);
        if (beat % 2 === 1) snare(drums, verb, t, 0.7);
        if (t >= 7.5) {
          hat(drums, t + BEAT / 2, 0.75, beat === 3);
          hat(drums, t + BEAT / 4, 0.25);
          hat(drums, t + (BEAT * 3) / 4, 0.3);
        }
      }
    }
    for (let e = 0; e < 8; e++) {
      const t = t0 + e * (BEAT / 2);
      if (inGroove(t)) bassNote(bass, t, BEAT / 2 - 0.02, root + (e === 6 ? 12 : 0), 1);
    }
    const breakdown = t0 >= 44 && t0 < 48.5;
    if (t0 >= 4 && t0 < 51.5) padChord(keys, verb, t0, BAR + 0.1, chord, { gain: breakdown ? 0.9 : 0.55, cutoff: breakdown ? 1100 : 2000, attack: 0.15 });
    const arpFrom = 8;
    if ((t0 >= arpFrom && t0 < 51.5) || breakdown) {
      const tones = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[3] + 12];
      for (let s = 0; s < 16; s++) {
        const t = t0 + s * (BEAT / 4);
        const pattern = [0, 2, 1, 3, 2, 1, 3, 2];
        pluck(keys, verb, t, tones[pattern[s % 8]], { gain: breakdown ? 0.6 : 0.85, cutoff: breakdown ? 1400 : 3200, pan: s % 2 ? 0.35 : -0.35 });
      }
    }
  }

  riser(keys, verb, 46.5, 1.95, 1.1);
  reverse(drums, 48.5, 0.9, 1.3);
  impact(drums, verb, 48.5, 0.9);
  impact(drums, verb, 51.5, 1);
  padChord(keys, verb, 51.5, 4.5, [A - 12, A - 5, A, A + 3, A + 7], { gain: 0.8, cutoff: 1500, attack: 0.05 });
  pluck(keys, verb, 51.5, A + 24, { gain: 1.2 });

  for (let i = 0; i < bass.l.length; i++) {
    const t = i / SR;
    let duck = 1;
    for (let k = kicks.length - 1; k >= 0 && kicks[k] > t - 0.4; k--) {
      if (kicks[k] <= t) duck = Math.min(duck, 1 - 0.75 * Math.exp(-(t - kicks[k]) / 0.09));
    }
    bass.l[i] *= duck;
    bass.r[i] *= duck;
    keys.l[i] *= 0.55 + 0.45 * duck;
    keys.r[i] *= 0.55 + 0.45 * duck;
  }

  const dry = new Bus(LENGTH);
  for (let i = 0; i < dry.l.length; i++) {
    const t = i / SR;
    const fade = Math.min(1, (LENGTH - t) / 2.2);
    dry.l[i] = (drums.l[i] * 0.8 + bass.l[i] * 0.9 + keys.l[i]) * fade;
    dry.r[i] = (drums.r[i] * 0.8 + bass.r[i] * 0.9 + keys.r[i]) * fade;
    verb.l[i] *= fade;
    verb.r[i] *= fade;
  }
  const wet = reverb(verb, 0.28);
  return master(dry, { l: wet.l.slice(0, dry.l.length), r: wet.r.slice(0, dry.r.length) });
}

function sfx(seconds, build, peak = 0.9) {
  const bus = new Bus(seconds);
  const verb = new Bus(seconds);
  build(bus, verb);
  const wet = reverb(verb, 0.25);
  return master(bus, wet, peak);
}

const effects = {
  swish: sfx(1, (bus, verb) => {
    const fn = (t, s) => {
      const p = Math.min(1, t / 0.7);
      const env = Math.sin(Math.PI * p) ** 3;
      const centre = 500 + 1400 * Math.sin(Math.PI * p);
      lp(s, "a", centre * 1.6, rand());
      lp(s, "b", centre * 0.6, s.a);
      lp(s, "c", 2800, s.a - s.b);
      return s.c * env * 2.2;
    };
    render(bus, 0, 0.7, 0, fn);
    render(verb, 0, 0.7, 0, (t, s) => fn(t, s) * 0.5);
  }, 0.5),
  tick: sfx(0.1, (bus) => {
    render(bus, 0, 0.05, 0, (t, s) => {
      const tone = Math.sin(2 * Math.PI * 1250 * t) * Math.exp(-t * 95);
      lp(s, "a", 2200, tone);
      return s.a * Math.min(1, t / 0.0015);
    });
  }, 0.4),
  ding: sfx(1.8, (bus, verb) => {
    [
      [hz(76), 0, 1],
      [hz(81), 0.07, 0.7],
    ].forEach(([f, at, g]) => {
      const fn = (t) => (Math.sin(2 * Math.PI * f * t) + Math.sin(4 * Math.PI * f * t) * 0.06) * Math.exp(-t * 3.5) * Math.min(1, t / 0.012) * g * 0.5;
      render(bus, at, 1.4, 0, fn);
      render(verb, at, 1.4, 0, (t) => fn(t) * 0.8);
    });
  }, 0.4),
  blip: sfx(0.4, (bus, verb) => {
    const fn = (t, s) => {
      s.ph = (s.ph ?? 0) + (hz(81) + hz(76) * 0.08 * Math.exp(-t * 30)) / SR;
      lp(s, "a", 1800, Math.sin(2 * Math.PI * s.ph));
      return s.a * Math.exp(-t * 14) * Math.min(1, t / 0.006);
    };
    render(bus, 0, 0.35, 0, fn);
    render(verb, 0, 0.35, 0, (t, s) => fn(t, s) * 0.5);
  }, 0.4),
};

mkdirSync(out, { recursive: true });
const track = music();
wav(join(out, "music.wav"), track.l, track.r);
for (const [name, { l, r }] of Object.entries(effects)) wav(join(out, `${name}.wav`), l, r);
console.log(`wrote ${Object.keys(effects).length + 1} files to ${out}`);
