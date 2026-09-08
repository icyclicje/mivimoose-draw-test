/**
 * Sound, synthesised in the browser.
 *
 * Everything here is generated with WebAudio oscillators rather than loaded
 * from files. That is a deliberate trade: a handful of samples plus a music
 * loop would be a megabyte or two of assets, and a Discord Activity pays for
 * that on every cold load. Synthesis is a few hundred bytes of code, retunes
 * instantly, and lets the "you are getting closer" cue actually track the rank
 * rather than picking from three canned clips.
 *
 * Two rules the rest of the app relies on:
 *
 *  1. Nothing makes noise until the player has interacted with the page.
 *     Browsers suspend AudioContext until then, and an unhandled resume()
 *     rejection is a console error on every load.
 *  2. Failure is silent. If WebAudio is unavailable or blocked, every call
 *     here becomes a no-op rather than throwing into a click handler.
 */

export type Sfx =
  | 'click'
  | 'type'
  | 'guess'
  | 'warm'
  | 'hot'
  | 'found'
  | 'error'
  | 'join'
  | 'leave'
  | 'start'
  | 'tick'
  | 'win'
  | 'lose'
  | 'invite';

interface SoundPrefs {
  music: boolean;
  sfx: boolean;
  volume: number;
}

const STORAGE_KEY = 'mivimoose:sound';

const DEFAULTS: SoundPrefs = { music: false, sfx: true, volume: 0.6 };

let prefs: SoundPrefs = load();
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicTimer: number | null = null;
let musicStep = 0;
let unlocked = false;

function load(): SoundPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SoundPrefs>) };
  } catch {
    // Storage can be unavailable; defaults are fine.
  }
  return { ...DEFAULTS };
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Not being able to remember the setting is not worth an error.
  }
}

export function getSoundPrefs(): SoundPrefs {
  return { ...prefs };
}

export function setSoundPrefs(next: Partial<SoundPrefs>): SoundPrefs {
  prefs = { ...prefs, ...next };
  save();
  if (master && ctx) master.gain.setTargetAtTime(prefs.volume, ctx.currentTime, 0.05);
  if (!prefs.music) stopMusic();
  else if (unlocked) startMusic();
  return { ...prefs };
}

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = prefs.volume;
    master.connect(ctx.destination);
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Called from the first real user gesture. Browsers will not let audio start
 * before one, so every screen that can begin a session calls this on click.
 */
export function unlockAudio(): void {
  if (unlocked) return;
  const c = audio();
  if (!c) return;
  void c.resume().catch(() => undefined);
  unlocked = true;
  if (prefs.music) startMusic();
}

/* ------------------------------------------------------------------ *
 * Effects
 * ------------------------------------------------------------------ */

interface ToneSpec {
  /** Hz, or a two-item glide. */
  freq: number | [number, number];
  /** Seconds. */
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** Seconds to wait before starting, for arpeggios. */
  delay?: number;
}

function tone({ freq, dur, type = 'sine', gain = 0.18, delay = 0 }: ToneSpec): void {
  const c = audio();
  if (!c || !master) return;

  const start = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;

  if (Array.isArray(freq)) {
    osc.frequency.setValueAtTime(freq[0], start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq[1]), start + dur);
  } else {
    osc.frequency.setValueAtTime(freq, start);
  }

  // A short attack and an exponential tail: square-edged envelopes click.
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  osc.connect(env);
  env.connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

const SFX: Record<Sfx, () => void> = {
  click: () => tone({ freq: 420, dur: 0.05, type: 'triangle', gain: 0.1 }),
  type: () => tone({ freq: 660, dur: 0.03, type: 'sine', gain: 0.045 }),
  guess: () => tone({ freq: [340, 300], dur: 0.1, type: 'triangle', gain: 0.12 }),
  warm: () => {
    tone({ freq: 520, dur: 0.09, type: 'triangle', gain: 0.13 });
    tone({ freq: 660, dur: 0.11, type: 'triangle', gain: 0.11, delay: 0.06 });
  },
  hot: () => {
    tone({ freq: 660, dur: 0.09, type: 'triangle', gain: 0.14 });
    tone({ freq: 880, dur: 0.1, type: 'triangle', gain: 0.12, delay: 0.06 });
    tone({ freq: 1050, dur: 0.14, type: 'sine', gain: 0.1, delay: 0.12 });
  },
  found: () => {
    // A major arpeggio. Unmistakably the good one.
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.16, delay: i * 0.075 }),
    );
  },
  error: () => tone({ freq: [200, 150], dur: 0.16, type: 'sawtooth', gain: 0.09 }),
  join: () => {
    tone({ freq: 480, dur: 0.08, type: 'sine', gain: 0.1 });
    tone({ freq: 720, dur: 0.1, type: 'sine', gain: 0.09, delay: 0.06 });
  },
  leave: () => {
    tone({ freq: 480, dur: 0.09, type: 'sine', gain: 0.09 });
    tone({ freq: 320, dur: 0.11, type: 'sine', gain: 0.08, delay: 0.06 });
  },
  start: () => {
    [392, 523, 659].forEach((f, i) =>
      tone({ freq: f, dur: 0.22, type: 'triangle', gain: 0.15, delay: i * 0.1 }),
    );
  },
  tick: () => tone({ freq: 880, dur: 0.04, type: 'square', gain: 0.06 }),
  win: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone({ freq: f, dur: 0.36, type: 'triangle', gain: 0.16, delay: i * 0.09 }),
    );
  },
  lose: () => {
    [440, 392, 330].forEach((f, i) =>
      tone({ freq: f, dur: 0.3, type: 'sine', gain: 0.12, delay: i * 0.12 }),
    );
  },
  invite: () => {
    tone({ freq: 784, dur: 0.1, type: 'triangle', gain: 0.13 });
    tone({ freq: 1047, dur: 0.14, type: 'triangle', gain: 0.11, delay: 0.09 });
  },
};

export function play(name: Sfx): void {
  if (!prefs.sfx || !unlocked) return;
  try {
    SFX[name]?.();
  } catch {
    // Never let a sound break the interaction that triggered it.
  }
}

/**
 * The closer-you-get cue, pitched by rank.
 *
 * One sound whose pitch rises as the rank falls says more than three fixed
 * clips, and it is the same information the colour bar carries — just in a
 * channel you do not have to be looking at.
 */
export function playRank(rank: number): void {
  if (!prefs.sfx || !unlocked) return;
  if (rank === 1) return play('found');
  if (rank <= 300) return play('hot');
  if (rank <= 1500) return play('warm');
  play('guess');
}

/* ------------------------------------------------------------------ *
 * Menu music
 * ------------------------------------------------------------------ */

/**
 * A slow generative loop rather than a track: a pentatonic bass pulse with an
 * occasional bell on top. It is meant to sit under menus without ever becoming
 * the thing you notice, and it costs nothing to ship.
 */
const BASS = [131, 147, 165, 196, 220];
const BELL = [523, 587, 659, 784, 880];

export function startMusic(): void {
  if (musicTimer !== null || !prefs.music) return;
  const c = audio();
  if (!c || !master) return;

  musicGain = c.createGain();
  musicGain.gain.value = 0.25;
  musicGain.connect(master);

  const step = () => {
    if (!ctx || !musicGain) return;
    const i = musicStep % BASS.length;
    // Bass on every beat.
    tone({ freq: BASS[i], dur: 1.6, type: 'sine', gain: 0.05 });
    // A bell every third beat, wandering through the scale.
    if (musicStep % 3 === 0) {
      tone({ freq: BELL[(musicStep * 2) % BELL.length], dur: 1.1, type: 'triangle', gain: 0.03 });
    }
    musicStep += 1;
  };

  step();
  musicTimer = window.setInterval(step, 1800);
}

export function stopMusic(): void {
  if (musicTimer !== null) {
    window.clearInterval(musicTimer);
    musicTimer = null;
  }
  musicGain?.disconnect();
  musicGain = null;
}

/** True once a gesture has let audio start; the UI uses it to explain silence. */
export function isAudioUnlocked(): boolean {
  return unlocked;
}
