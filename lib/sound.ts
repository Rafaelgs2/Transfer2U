"use client";

// Paper and printer sounds, synthesized from filtered noise: no audio files to download.
// Browsers only allow audio after a gesture, so everything is silent until unlockAudio() runs.

const KEY = "t2u:sound";

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let enabled: boolean | null = null;
const listeners = new Set<() => void>();

export function isSoundOn(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem(KEY) !== "off";
    } catch {
      enabled = true;
    }
  }
  return enabled;
}

export function toggleSound() {
  enabled = !isSoundOn();
  try {
    localStorage.setItem(KEY, enabled ? "on" : "off");
  } catch {
    // blocked storage: the choice just lasts until the page reloads
  }
  listeners.forEach((l) => l());
}

export function subscribeSound(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // no Web Audio here: the app works the same, in silence
  }
}

const ready = () => (isSoundOn() && ctx?.state === "running" ? ctx : null);
const jitter = (value: number, amount: number) => value * (1 - amount + Math.random() * amount * 2);

/** A short burst of filtered noise: the building block of every paper sound. */
function burst(c: AudioContext, at: number, dur: number, freq: number, gain: number, q = 1) {
  const src = c.createBufferSource();
  src.buffer = noise;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(gain, at + Math.min(0.004, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(at, Math.random() * 1.5, dur + 0.02);
}

/** A low knock, for anything that lands with weight. */
function thump(c: AudioContext, at: number, freq: number, dur: number, gain: number) {
  const osc = c.createOscillator();
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.6, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function rip(dur: number) {
  const c = ready();
  if (!c) return;
  const steps = Math.floor(dur / 0.012);
  for (let i = 0; i < steps; i++) {
    const p = i / steps;
    const swell = Math.sin(Math.PI * Math.min(1, p * 1.15));
    burst(c, c.currentTime + i * 0.012, 0.03, jitter(5200 - p * 3400, 0.2), jitter(0.13 * swell + 0.015, 0.5), 0.9);
  }
}

let lastTick = 0;

export const sound = {
  /** Thermal printer: a fast run of dry ticks. */
  print(dur = 0.42) {
    const c = ready();
    if (!c) return;
    for (let t = 0; t < dur; t += 0.024) burst(c, c.currentTime + t, 0.014, jitter(3100, 0.12), jitter(0.05, 0.3), 2);
    thump(c, c.currentTime, 90, 0.06, 0.03);
  },
  /** One printer tick, throttled, while a file uploads. */
  tick() {
    const c = ready();
    if (!c || c.currentTime - lastTick < 0.07) return;
    lastTick = c.currentTime;
    burst(c, c.currentTime, 0.014, jitter(3100, 0.12), 0.04, 2);
  },
  /** A key on a soft keyboard. */
  key() {
    const c = ready();
    if (!c) return;
    burst(c, c.currentTime, 0.022, jitter(3300, 0.25), 0.05);
    thump(c, c.currentTime, jitter(170, 0.15), 0.03, 0.03);
  },
  /** A rubber stamp, for button presses. */
  press() {
    const c = ready();
    if (!c) return;
    burst(c, c.currentTime, 0.03, 1400, 0.09);
    thump(c, c.currentTime, 115, 0.07, 0.11);
  },
  /** Paper sliding, for scrolling and for dragging a file in. */
  rustle() {
    const c = ready();
    if (!c) return;
    burst(c, c.currentTime, 0.2, jitter(2300, 0.2), 0.04, 0.6);
    burst(c, c.currentTime + 0.05, 0.16, jitter(3600, 0.2), 0.022, 0.8);
  },
  /** Tearing one item off the tape. */
  tear() {
    rip(0.42);
  },
  /** Tearing the whole room down. */
  tearLong() {
    rip(0.75);
    const c = ready();
    if (c) thump(c, c.currentTime + 0.62, 80, 0.14, 0.12);
  },
};
