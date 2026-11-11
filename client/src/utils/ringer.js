// Ringtones synthesised with the Web Audio API – no audio files to ship.
//   incoming: what the person being called hears (a double warble)
//   ringback: what the caller hears while the other phone rings (440+480 Hz, 2s on / 4s off)
//
// The whole pattern is scheduled up front on the audio clock rather than with
// timers, so it keeps playing on time even when the browser throttles a
// background tab.

const MAX_SECONDS = 60; // safety cap; the server's ring timeout normally ends it sooner

let ctx = null;
let session = null; // { out, oscs }

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

// Browsers keep audio muted until the person has interacted with the page.
// Call this once at startup: the first click/key/tap unlocks sound for later calls.
export function installAudioUnlock() {
  const events = ['pointerdown', 'keydown', 'touchstart'];
  const unlock = () => {
    const c = getCtx();
    if (!c) return;
    c.resume()
      .then(() => {
        if (c.state === 'running') events.forEach((e) => window.removeEventListener(e, unlock));
      })
      .catch(() => {});
  };
  events.forEach((e) => window.addEventListener(e, unlock));
}

// One enveloped burst. `oscs` is a list of oscillators; each is a list of
// frequencies stepped through every `step` seconds.
function burst(c, out, start, dur, oscs, step) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(1, start + 0.02);
  g.gain.setValueAtTime(1, start + dur - 0.04);
  g.gain.linearRampToValueAtTime(0, start + dur);
  g.connect(out);

  return oscs.map((freqs) => {
    const o = c.createOscillator();
    o.type = 'sine';
    freqs.forEach((f, i) => o.frequency.setValueAtTime(f, start + i * step));
    o.connect(g);
    o.start(start);
    o.stop(start + dur + 0.05);
    return o;
  });
}

const PATTERNS = {
  incoming: {
    volume: 0.22,
    cycle: 3,
    schedule(c, out, t) {
      const warble = [[784, 988, 784, 988, 784, 988, 784, 988]]; // 8 × 0.1s
      return [0, 1].flatMap((n) => burst(c, out, t + n * 1.0, 0.8, warble, 0.1));
    },
  },
  ringback: {
    volume: 0.13,
    cycle: 6,
    schedule(c, out, t) {
      return burst(c, out, t, 2, [[440], [480]], 1);
    },
  },
};

export function startRinging(kind) {
  stopRinging();
  const pattern = PATTERNS[kind];
  const c = getCtx();
  if (!pattern || !c) return;

  c.resume().catch(() => {}); // may stay suspended until the first user gesture

  const out = c.createGain();
  out.gain.value = pattern.volume;
  out.connect(c.destination);

  const oscs = [];
  const t0 = c.currentTime + 0.05;
  for (let t = t0; t < t0 + MAX_SECONDS; t += pattern.cycle) {
    oscs.push(...pattern.schedule(c, out, t));
  }
  session = { out, oscs };
}

export function stopRinging() {
  if (!session) return;
  const { out, oscs } = session;
  session = null;
  try {
    out.disconnect();
  } catch {}
  oscs.forEach((o) => {
    try {
      o.stop();
    } catch {}
  });
}

// True when sound will actually be heard (the audio context has been unlocked)
export function canPlayAudio() {
  return !!ctx && ctx.state === 'running';
}
