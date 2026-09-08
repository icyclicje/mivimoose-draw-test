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
  | 'invite'
  | 'taken'
  | 'streak'
  | 'lead'
  | 'reject'
  | 'roundEnd'
  | 'eliminate';

interface SoundPrefs {
  music: boolean;
  sfx: boolean;
  volume: number;
}

const STORAGE_KEY = 'mivimoose:sound';

// Music on by default. Browsers suspend audio until a gesture, so this cannot
// start noise before the player has interacted — and the header toggle is one
// click away for anyone who wants silence.
const DEFAULTS: SoundPrefs = { music: true, sfx: true, volume: 0.6 };

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
  /**
   * Where to route it. Music goes through its own gain node so stopping it can
   * cut everything already scheduled; effects go straight to master.
   */
  dest?: AudioNode | null;
  /** Attack in seconds. Pads want a slow swell, effects want a click-free 12ms. */
  attack?: number;
}

function tone({
  freq,
  dur,
  type = 'sine',
  gain = 0.18,
  delay = 0,
  dest = null,
  attack = 0.012,
}: ToneSpec): void {
  const c = audio();
  if (!c || !master) return;
  const out = dest ?? master;

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

  // A shaped attack and an exponential tail: square-edged envelopes click.
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + Math.min(attack, dur * 0.5));
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  osc.connect(env);
  env.connect(out);
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
  // Somebody beat you to a word. A closed door, not a failure: a short
  // descending knock rather than the harsher error buzz.
  taken: () => {
    tone({ freq: 392, dur: 0.08, type: 'triangle', gain: 0.12 });
    tone({ freq: 294, dur: 0.12, type: 'triangle', gain: 0.1, delay: 0.07 });
  },
  // A run of green. Rising, and it keeps rising — the point is momentum.
  streak: () => {
    [659, 784, 988].forEach((f, i) =>
      tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.13, delay: i * 0.07 }),
    );
  },
  // Somebody has pulled well ahead. Deliberately a touch ominous.
  lead: () => {
    tone({ freq: 330, dur: 0.24, type: 'sine', gain: 0.11 });
    tone({ freq: 247, dur: 0.3, type: 'sine', gain: 0.1, delay: 0.12 });
  },
  // A word the list does not have. Softer than 'error', which is for real
  // mistakes — an unknown word is an ordinary part of playing.
  reject: () => tone({ freq: [280, 220], dur: 0.11, type: 'triangle', gain: 0.075 }),
  roundEnd: () => {
    [523, 415].forEach((f, i) =>
      tone({ freq: f, dur: 0.26, type: 'sine', gain: 0.12, delay: i * 0.13 }),
    );
  },
  eliminate: () => {
    [392, 311, 233].forEach((f, i) =>
      tone({ freq: f, dur: 0.26, type: 'sawtooth', gain: 0.075, delay: i * 0.1 }),
    );
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
 * Music
 * ------------------------------------------------------------------ */

/**
 * Two beds, generated rather than streamed.
 *
 * The first attempt at this was one bass note every 1.8 seconds with a bell
 * every third — technically playing, but far too sparse to read as music. What
 * follows is written as an actual loop: a four-chord progression in A minor
 * (i - VI - III - VII), with a sustained pad, a soft bass root and a slow
 * arpeggio over the top. Every bar schedules eight or nine voices, so there is
 * always something sounding.
 *
 * `menu` breathes — long bars, gentle swell, no pulse.
 * `game` is the same harmony tightened up: shorter bars, an off-beat pulse and
 * a busier arpeggio, so it feels like a clock is running without ever competing
 * with the words on screen.
 *
 * Both share the progression, so switching mid-session never clashes.
 */
export type MusicMood = 'menu' | 'game';

/** A minor: Am - F - C - G. Root, then the pad voicing, then the arpeggio. */
interface Chord {
  bass: number;
  pad: [number, number, number];
  arp: number[];
}

const PROGRESSION: Chord[] = [
  { bass: 110.0, pad: [220.0, 261.6, 329.6], arp: [440.0, 523.3, 659.3, 523.3] }, // Am
  { bass: 87.31, pad: [174.6, 220.0, 261.6], arp: [349.2, 440.0, 523.3, 440.0] }, // F
  { bass: 130.8, pad: [196.0, 261.6, 329.6], arp: [523.3, 659.3, 784.0, 659.3] }, // C
  { bass: 98.0, pad: [196.0, 246.9, 293.7], arp: [392.0, 493.9, 587.3, 493.9] }, // G
];

interface Bed {
  /** One chord per bar. */
  barMs: number;
  padGain: number;
  bassGain: number;
  arpGain: number;
  /** How many arpeggio notes to play across the bar. */
  arpNotes: number;
  /** A quiet off-beat tick. Only the game bed has one. */
  pulse: boolean;
}

const BEDS: Record<MusicMood, Bed> = {
  menu: {
    barMs: 3600,
    padGain: 0.028,
    bassGain: 0.05,
    arpGain: 0.022,
    arpNotes: 2,
    pulse: false,
  },
  game: {
    barMs: 2400,
    padGain: 0.022,
    bassGain: 0.045,
    arpGain: 0.026,
    arpNotes: 4,
    pulse: true,
  },
};

let musicMood: MusicMood = 'menu';
let musicBar = 0;

/** Music sits well under the effects; it is a room tone, not a track. */
const MUSIC_LEVEL = 0.5;

function ensureMusicGain(): GainNode | null {
  const c = audio();
  if (!c || !master) return null;
  if (musicGain) return musicGain;
  musicGain = c.createGain();
  musicGain.gain.value = MUSIC_LEVEL;
  musicGain.connect(master);
  return musicGain;
}

function playBar(): void {
  const bed = BEDS[musicMood];
  const chord = PROGRESSION[musicBar % PROGRESSION.length];
  const dest = ensureMusicGain();
  if (!dest) return;

  const bar = bed.barMs / 1000;

  // Bass root, held almost the whole bar.
  tone({
    freq: chord.bass,
    dur: bar * 0.92,
    type: 'sine',
    gain: bed.bassGain,
    attack: 0.25,
    dest,
  });

  // Pad: the three chord tones, staggered slightly so they bloom rather than
  // arriving as one block, and overlapping the bar line so there is no gap.
  chord.pad.forEach((freq, i) => {
    tone({
      freq,
      dur: bar * 1.02,
      type: 'sine',
      gain: bed.padGain,
      attack: 0.6,
      delay: i * 0.05,
      dest,
    });
  });

  // Arpeggio over the top, spread evenly across the bar.
  const spacing = bar / (bed.arpNotes + 0.5);
  for (let i = 0; i < bed.arpNotes; i++) {
    tone({
      freq: chord.arp[i % chord.arp.length],
      dur: spacing * 1.4,
      type: 'triangle',
      gain: bed.arpGain,
      attack: 0.08,
      delay: spacing * (i + 0.25),
      dest,
    });
  }

  if (bed.pulse) {
    // Off-beat, an octave above the root, barely there. This is the whole of
    // what makes the game bed feel like it is moving.
    for (const at of [0.5, 1.5]) {
      tone({
        freq: chord.bass * 2,
        dur: 0.1,
        type: 'triangle',
        gain: 0.016,
        delay: (bar * at) / 2,
        dest,
      });
    }
  }

  musicBar += 1;
}

export function startMusic(mood: MusicMood = musicMood): void {
  musicMood = mood;
  if (musicTimer !== null || !prefs.music) return;
  if (!ensureMusicGain()) return;

  playBar();
  musicTimer = window.setInterval(playBar, BEDS[mood].barMs);
}

export function stopMusic(): void {
  if (musicTimer !== null) {
    window.clearInterval(musicTimer);
    musicTimer = null;
  }
  // Disconnecting the shared gain silences everything already scheduled — pads
  // run for a whole bar, so without this the music would keep sounding for
  // seconds after being turned off.
  musicGain?.disconnect();
  musicGain = null;
}

/**
 * Switch bed without a gap.
 *
 * Called on every room-phase change, so it has to be cheap and idempotent —
 * restarting only when the mood actually differs, or the music would stutter
 * every time room state was pushed. The bar counter is kept so the progression
 * continues rather than snapping back to the first chord.
 */
export function setMusicMood(mood: MusicMood): void {
  if (mood === musicMood) return;
  musicMood = mood;
  if (musicTimer !== null) {
    window.clearInterval(musicTimer);
    musicTimer = window.setInterval(playBar, BEDS[mood].barMs);
  }
}

export function getMusicMood(): MusicMood {
  return musicMood;
}

/** True once a gesture has let audio start; the UI uses it to explain silence. */
export function isAudioUnlocked(): boolean {
  return unlocked;
}
