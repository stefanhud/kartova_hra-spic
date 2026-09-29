// Small synthesized table sounds (Web Audio): nothing to download, works offline.
// Phones only allow audio after a tap, so the context is created/resumed on the first touch.

export type SoundName = 'turn' | 'deal' | 'chip' | 'swap' | 'win' | 'bigWin' | 'tie';

const MUTE_KEY = 'spic.muted';
let ctx: AudioContext | null = null;
let muted = readMuted();

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    /* private mode */
  }
  if (!value) unlock();
}

function unlock() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}

// One enveloped oscillator note.
function tone(freq: number, start: number, dur: number, opts: { type?: OscillatorType; gain?: number; slide?: number } = {}) {
  const c = ctx!;
  const osc = c.createOscillator();
  const g = c.createGain();
  const t0 = c.currentTime + start;
  const peak = opts.gain ?? 0.18;
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(freq * opts.slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// A short burst of filtered noise: a card flick or a chip click.
function noise(start: number, dur: number, freq: number, gain = 0.25) {
  const c = ctx!;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(c.destination);
  src.start(c.currentTime + start);
}

const SOUNDS: Record<SoundName, () => void> = {
  turn: () => {
    tone(880, 0, 0.16, { type: 'triangle', gain: 0.2 });
    tone(1318.5, 0.11, 0.26, { type: 'triangle', gain: 0.18 });
  },
  deal: () => {
    for (let i = 0; i < 3; i++) noise(i * 0.075, 0.06, 2600, 0.3);
  },
  chip: () => {
    noise(0, 0.03, 5200, 0.35);
    tone(2400, 0, 0.07, { type: 'square', gain: 0.03 });
    noise(0.05, 0.03, 4600, 0.25);
  },
  swap: () => {
    noise(0, 0.07, 2200, 0.25);
    tone(520, 0.02, 0.14, { type: 'sine', gain: 0.1, slide: 1.5 });
  },
  win: () => {
    [523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.09, 0.3, { type: 'triangle', gain: 0.14 }));
  },
  bigWin: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.1, 0.35, { type: 'triangle', gain: 0.18 }));
    [1046.5, 1318.5].forEach(f => tone(f, 0.45, 0.7, { type: 'sine', gain: 0.12 }));
    for (let i = 0; i < 6; i++) noise(0.5 + i * 0.06, 0.03, 5000, 0.2);
  },
  tie: () => {
    tone(392, 0, 0.22, { type: 'triangle', gain: 0.14 });
    tone(349.23, 0.18, 0.34, { type: 'triangle', gain: 0.12 });
  },
};

export function play(name: SoundName) {
  if (muted) return;
  unlock();
  if (!ctx || ctx.state !== 'running') return;
  try {
    SOUNDS[name]();
  } catch {
    /* never let a sound break the game */
  }
}
