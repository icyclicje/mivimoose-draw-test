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
 * Three rules the rest of the app relies on:
 *
 *  1. Nothing makes noise until the player has interacted with the page.
 *     Browsers suspend AudioContext until then, and an unhandled resume()
 *     rejection is a console error on every load.
 *  2. Failure is silent. If WebAudio is unavailable or blocked, every call
 *     here becomes a no-op rather than throwing into a click handler.
 *  3. Nothing is scheduled against a suspended context. Its clock is stopped,
 *     so everything queued while it is down lands on the same instant and
 *     plays as one blast when it comes back.
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
// start noise before the player has interacted. The header toggle is one
// click away for anyone who wants silence.
const DEFAULTS: SoundPrefs = { music: true, sfx: true, volume: 0.6 };

let prefs: SoundPrefs = load();
let ctx: AudioContext | null = null;
/** Unity bus. Every voice, effect or music, connects here. */
let mix: GainNode | null = null;
/** Player volume. Last stage before the speakers; the graph is built in audio(). */
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicTimer: number | null = null;
let unlocked = false;
/** True from unlockAudio() until its resume() settles. See tone(). */
let resuming = false;
let lastResumeNudge = 0;
/** Set once WebAudio has proved unavailable, so audio() stops retrying. */
let audioFailed = false;

/**
 * Bumped whenever a DEFAULT changes in a way stored settings would otherwise
 * mask. Music used to default to off; without a version, every returning player
 * kept `music: false` for ever and the music looked broken rather than muted.
 * A bump re-applies the new defaults once, keeping any choice that is still
 * meaningful (volume, and effects, which nobody's default changed).
 */
const PREFS_VERSION = 2;

function load(): SoundPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };

    const stored = JSON.parse(raw) as Partial<SoundPrefs> & { v?: number };
    if ((stored.v ?? 1) < PREFS_VERSION) {
      // Carry forward what the player actually chose, take the new default for
      // the setting whose default moved.
      const migrated = clean({ ...stored, music: DEFAULTS.music });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...migrated, v: PREFS_VERSION }));
      } catch {
        // Not being able to record the migration only means it runs again.
      }
      return migrated;
    }
    return clean(stored);
  } catch {
    // Storage can be unavailable; defaults are fine.
  }
  return { ...DEFAULTS };
}

/**
 * Nothing that reaches an AudioParam is trusted. Stored prefs are whatever was
 * in localStorage last: an older build, another tab, a hand-edited value. A
 * a non-finite volume throws out of the AudioParam and takes the click handler
 * that set it down with it.
 */
function clean(p: Partial<SoundPrefs>): SoundPrefs {
  const v = Number(p.volume);
  return {
    music: typeof p.music === 'boolean' ? p.music : DEFAULTS.music,
    sfx: typeof p.sfx === 'boolean' ? p.sfx : DEFAULTS.sfx,
    volume: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULTS.volume,
  };
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prefs, v: PREFS_VERSION }));
  } catch {
    // Not being able to remember the setting is not worth an error.
  }
}

export function getSoundPrefs(): SoundPrefs {
  return { ...prefs };
}

export function setSoundPrefs(next: Partial<SoundPrefs>): SoundPrefs {
  prefs = clean({ ...prefs, ...next });
  save();
  applyVolume();
  // Recorded music runs through an <audio> element, not the WebAudio graph, so
  // the master gain does not reach it and it needs telling separately.
  applyTrackVolume();
  if (!prefs.music) stopMusic();
  else if (unlocked) startMusic();
  return { ...prefs };
}

function applyVolume(): void {
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  // A ramp rather than setTargetAtTime: that one only ever approaches its
  // target, so volume 0 would settle a hair above silence and never land on it.
  // Cancel first, or dragging the slider queues ramps that fight each other.
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(prefs.volume, now + 0.06);
}

function audio(): AudioContext | null {
  if (ctx) return ctx;
  // Build the graph once and never retry. Browsers cap how many AudioContexts
  // one document may hold (six in Chrome), so a construction that failed once
  // will fail every time, and tone() calls this on every note. Without the flag
  // one dead context becomes a throw on every click for the rest of the
  // session, and each attempt burns another slot against the cap.
  if (audioFailed) return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      audioFailed = true;
      return null;
    }
    ctx = new Ctor();

    mix = ctx.createGain();

    // Effects and music are scheduled independently, so their sum has no
    // ceiling: a 'win' (five overlapping voices) landing on a 'found' over a
    // full music bar adds up to well past 1.0, and the destination hard-clips
    // that into a crackle. Limiting the bus is the honest fix. Quieting every
    // voice enough to make the worst case safe would leave the common case,
    // one effect over the bed, inaudible.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 4;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.2;

    // Volume goes after the limiter, so the mix sounds the same at every
    // setting and 0 is a hard mute instead of a compressed floor.
    master = ctx.createGain();
    master.gain.value = prefs.volume;

    mix.connect(limiter);
    limiter.connect(master);
    master.connect(ctx.destination);
    return ctx;
  } catch {
    // A half-built graph is worse than none: leave nothing behind for tone().
    // Close whatever did get constructed as well. An abandoned context still
    // counts against the per-document limit for the life of the page.
    audioFailed = true;
    const dead = ctx;
    ctx = null;
    mix = null;
    master = null;
    try {
      void dead?.close().catch(() => undefined);
    } catch {
      // Never opened, or already closing.
    }
    return null;
  }
}

/**
 * resume() is specified to return a promise, but older WebKit returns
 * undefined. Reaching for .catch() on that throws a TypeError straight out of
 * whichever click handler asked for sound, and in unlockAudio() it would also
 * leave `resuming` stuck true, so every note after it would be scheduled
 * against a clock that never moved. Normalise the shape once, here.
 */
function resume(c: AudioContext): Promise<void> {
  try {
    return Promise.resolve(c.resume()).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

/**
 * A suspended context freezes currentTime, so anything scheduled against it
 * stacks on a single instant and arrives as one blast when it comes back.
 * Callers drop the sound instead and call this to ask for the context:
 * throttled, because a context stays suspended for as long as the tab is
 * hidden and every dropped sound would otherwise ask again.
 */
function nudgeResume(c: AudioContext): void {
  const now = Date.now();
  if (now - lastResumeNudge < 500) return;
  lastResumeNudge = now;
  void resume(c);
}

/**
 * Called from the first real user gesture. Browsers will not let audio start
 * before one, so every screen that can begin a session calls this on click.
 */
export function unlockAudio(): void {
  if (unlocked) return;
  const c = audio();
  if (!c) return;
  unlocked = true;
  resuming = true;
  // Start the bed only once the context is actually running. playBar() refuses
  // to schedule against a suspended clock, so starting synchronously here would
  // throw the first bar away and leave a silent gap until the next one.
  void resume(c)
    .then(() => {
      resuming = false;
      if (prefs.music) startMusic();
    })
    .catch(() => {
      // Nothing in there should reject, but an unhandled rejection on the first
      // click is a console error on every load. `resuming` has to come back
      // down either way, or tone() keeps scheduling against a frozen clock.
      resuming = false;
    });
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
   * cut everything already scheduled; effects go straight to the bus.
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
  if (!c || !mix) return;
  // Sounds scheduled while the context is suspended all land on the same frozen
  // instant and play at once when it resumes. Come back to a backgrounded tab
  // and you hear every guess anyone made while you were away, together.
  // `resuming` is the one exception: the gesture that unlocks audio usually
  // plays a click of its own, and dropping that reads as a broken button.
  if (c.state !== 'running' && !resuming) {
    nudgeResume(c);
    return;
  }
  const out = dest ?? mix;

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

  // A bar schedules six to ten of these every few seconds for as long as the
  // tab is open. A stopped oscillator is collectable in principle, but only once
  // nothing holds it and nothing it feeds holds a live edge, so dropping both
  // edges here makes that immediate rather than something we hope the engine
  // gets around to.
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
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
  // A run of green. Rising, and it keeps rising, because the point is momentum.
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
  // mistakes. An unknown word is an ordinary part of playing.
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
 * clips, and it is the same information the colour bar carries, just in a
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
 * every third. Technically playing, but far too sparse to read as music. What
 * follows is written as an actual loop: a four-chord progression in A minor
 * (i - VI - III - VII), with a sustained pad, a soft bass root and a slow
 * arpeggio over the top. A menu bar is six voices (bass, three pad tones and
 * two arpeggio notes) and a game bar is ten, so there is always something
 * sounding.
 *
 * `menu` breathes: long bars, gentle swell, no pulse.
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

/** Rebuilt on demand: stopMusic() drops the node so it can cut sustained pads. */
function ensureMusicGain(): GainNode | null {
  const c = audio();
  if (!c || !mix) return null;
  if (musicGain) return musicGain;
  musicGain = c.createGain();
  musicGain.gain.value = MUSIC_LEVEL;
  musicGain.connect(mix);
  return musicGain;
}

function playBar(): void {
  const c = audio();
  if (!c) return;
  // Skip the bar outright while the context is down rather than piling a whole
  // bar of voices onto a frozen currentTime. Holding musicBar as well means the
  // progression carries on from where it left off instead of jumping.
  if (c.state !== 'running') {
    nudgeResume(c);
    return;
  }

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

/**
 * playBar() writes to AudioParams directly, and it runs both on a repeating
 * timer and inside the click handler that flips the music toggle. Anything that
 * threw in there would be an uncaught error every few seconds for the life of
 * the page, or a dead toggle button. Swallow it, like every other failure here.
 */
function safeBar(): void {
  try {
    playBar();
  } catch {
    // The next bar tries again.
  }
}

/** One owner for the bar timer, so no path can leave two of them running. */
function restartBarTimer(): void {
  if (musicTimer !== null) window.clearInterval(musicTimer);
  musicTimer = window.setInterval(safeBar, BEDS[musicMood].barMs);
}

/* ------------------------------------------------------------------ *
 * Recorded soundtrack
 *
 * Oscillators can carry a room tone, but they cannot be a soundtrack. If real
 * tracks are present they are used instead, and the synthesised beds stay as
 * the zero-download fallback so the game still has music out of the box.
 *
 * Drop files here and they are picked up on the next load, no code change:
 *
 *   client/public/music/menu.mp3   plays in the menus
 *   client/public/music/game.mp3   plays during a round
 *
 * .ogg and .m4a work too. Anything you have the right to use is fine; nothing
 * is bundled, so the licence choice stays yours.
 * ------------------------------------------------------------------ */

const TRACK_SOURCES: Record<MusicMood, string[]> = {
  menu: ['/music/menu.mp3', '/music/menu.ogg', '/music/menu.m4a'],
  game: ['/music/game.mp3', '/music/game.ogg', '/music/game.m4a'],
};

/** Recorded music sits lower than the synthesised bed; real mixes are louder. */
const TRACK_LEVEL = 0.35;
const CROSSFADE_S = 1.2;

const tracks: Partial<Record<MusicMood, HTMLAudioElement>> = {};
/** null until probed, then true/false per mood. */
const trackAvailable: Partial<Record<MusicMood, boolean>> = {};

/**
 * Does a track exist? A HEAD request rather than trying to play and waiting for
 * an error, so a missing file costs one 404 at startup instead of a stall.
 */
async function probeTrack(mood: MusicMood): Promise<string | null> {
  for (const src of TRACK_SOURCES[mood]) {
    try {
      const res = await fetch(src, { method: 'HEAD' });
      // A dev server with a history fallback answers 200 with index.html for a
      // missing file, so the content type has to be checked as well.
      if (res.ok && (res.headers.get('content-type') ?? '').startsWith('audio')) return src;
    } catch {
      // Network or CORS. Treat as absent.
    }
  }
  return null;
}

function fadeTo(el: HTMLAudioElement, target: number, seconds: number): void {
  const from = el.volume;
  const started = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - started) / (seconds * 1000));
    el.volume = Math.max(0, Math.min(1, from + (target - from) * t));
    if (t < 1) requestAnimationFrame(step);
    else if (target === 0) el.pause();
  };
  requestAnimationFrame(step);
}

/**
 * Starts the recorded track for a mood if one exists.
 *
 * Returns false when there is no file, which is the signal for the caller to
 * fall back to the synthesised bed.
 */
async function startTrack(mood: MusicMood): Promise<boolean> {
  if (trackAvailable[mood] === false) return false;

  let el = tracks[mood];
  if (!el) {
    const src = await probeTrack(mood);
    trackAvailable[mood] = src !== null;
    if (!src) return false;
    el = new Audio(src);
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    tracks[mood] = el;
  }

  // Silence the other mood rather than stopping it dead, so switching between
  // menu and game is a crossfade instead of a cut.
  for (const [other, otherEl] of Object.entries(tracks)) {
    if (other !== mood && otherEl && !otherEl.paused) fadeTo(otherEl, 0, CROSSFADE_S);
  }

  try {
    await el.play();
  } catch {
    // Autoplay refused. unlockAudio() calls this again after a gesture.
    return trackAvailable[mood] === true;
  }
  fadeTo(el, TRACK_LEVEL * prefs.volume, CROSSFADE_S);
  return true;
}

function stopTracks(): void {
  for (const el of Object.values(tracks)) {
    if (el && !el.paused) fadeTo(el, 0, 0.4);
  }
}

/** Keeps recorded music in step with the volume slider. */
function applyTrackVolume(): void {
  const el = tracks[musicMood];
  if (el && !el.paused) el.volume = TRACK_LEVEL * prefs.volume;
}

export function startMusic(mood: MusicMood = musicMood): void {
  // Record the bed even when we cannot start: the toggle may turn music on
  // later and should come up in the bed the room is actually in.
  const changed = mood !== musicMood;
  musicMood = mood;

  if (musicTimer !== null) {
    // Already running. The two beds have different bar lengths, so a bed change
    // has to retime the timer. Otherwise startMusic('game') swapped the
    // voicing but left bars 3.6s apart, and the arpeggio, whose spacing is
    // derived from barMs, drifted away from the bar line.
    if (changed) restartBarTimer();
    return;
  }

  if (!prefs.music) return;
  // Before the unlocking gesture there is nothing to start. audio() would build
  // a context the browser holds suspended, playBar() would drop every bar it
  // scheduled, and the live timer would then send unlockAudio()'s own
  // startMusic() down the "already running" path above, so the bed would come
  // up a full bar late, silent until then.
  if (!unlocked) return;
  // A recorded track wins whenever one is present. The synthesised bed is the
  // fallback, so the game still has music with an empty music folder.
  void startTrack(mood).then((playing) => {
    // Re-check on the way back in: the probe is async, and the player may have
    // muted or changed room in the meantime.
    if (playing || !prefs.music || !unlocked || musicTimer !== null) return;
    if (!ensureMusicGain()) return;
    safeBar();
    restartBarTimer();
  });
}

export function stopMusic(): void {
  stopTracks();
  if (musicTimer !== null) {
    window.clearInterval(musicTimer);
    musicTimer = null;
  }

  // Everything already scheduled has to be silenced through the shared gain:
  // pads run for a whole bar, so otherwise the music keeps sounding for seconds
  // after being turned off. Drop the reference first so a start() during the
  // fade builds a fresh node rather than reviving this one.
  const node = musicGain;
  musicGain = null;
  if (!node) return;
  if (!ctx) {
    node.disconnect();
    return;
  }

  // Ramp rather than yanking the connection: cutting a sustained sine mid-cycle
  // is an audible click.
  const now = ctx.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(node.gain.value, now);
  node.gain.linearRampToValueAtTime(0, now + 0.12);
  window.setTimeout(() => node.disconnect(), 200);
}

/**
 * Switch bed without a gap.
 *
 * Called on every room-phase change, so it has to be cheap and idempotent.
 * restarting only when the mood actually differs, or the music would stutter
 * every time room state was pushed. The bar counter is kept so the progression
 * continues rather than snapping back to the first chord.
 */
export function setMusicMood(mood: MusicMood): void {
  if (mood === musicMood) return;
  musicMood = mood;

  // A phase change must never START music that is stopped, or muting it would
  // last only until the next round began. It only ever switches what is already
  // playing.
  if (musicTimer !== null) {
    restartBarTimer();
    return;
  }
  // A recorded track is playing outside the bar timer, so it has its own check:
  // crossfade to the other mood's file if one exists.
  if (prefs.music && unlocked && trackAvailable[mood] !== false) {
    void startTrack(mood);
  }
}

export function getMusicMood(): MusicMood {
  return musicMood;
}

/** True once a gesture has let audio start; the UI uses it to explain silence. */
export function isAudioUnlocked(): boolean {
  return unlocked;
}
