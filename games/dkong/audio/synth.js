// SPDX-License-Identifier: GPL-3.0-only
/**
 * games/dkong/audio/synth.js — WebAudio synthesis of Donkey Kong's three
 * discrete/analogue sound effects: **walk**, **jump** and **boom**.
 *
 * ## Why these three are synthesised rather than sampled
 *
 * DK's audio splits in two. Every tune comes out of an I8035 sound CPU running
 * its own ROM. But ls259.6h trigger bits 0, 1 and 2 — `0x7D00`, `0x7D01`,
 * `0x7D02` — are not code at all: they are *discrete analogue circuits* on the
 * sound board (MAME 0.288 `dkong_a.cpp:1322-1350`, netlists at `:356-436`).
 * There is no sample data for them in any ROM, and `games/dkong/audio/sounds.js`
 * records the empirical confirmation.
 *
 * A circuit with no data behind it can either be recorded or re-created. We
 * re-create it. A synthesised effect is unambiguously our own work and ships
 * freely, whereas a recording of DK's audio is Nintendo's — so these three work
 * out of the box for every visitor, with no ROM, no MAME and no sample files.
 *
 * ## "Matches the circuit", not "sounds plausible"
 *
 * Nothing here was tuned by ear. `games/dkong/tools/record_samples.py` captures
 * the real netlist's output (`samples/trig0.wav`, `trig1.wav`, `trig2.wav`);
 * every number in `EFFECTS` was fitted against those clips on duration, peak,
 * RMS, crest factor, the 25/50 ms RMS envelope and the 1/3-octave spectrum.
 * The `measured` block on each effect carries the reference figures so a later
 * change can be re-checked against them. Fit as committed (48 kHz):
 *
 *   effect   duration      peak        RMS         crest      spectrum
 *   walk     exact         -0.05 dB    +0.00 dB    -0.10 dB   0.82 dB/band
 *   jump     exact         +0.25 dB    +0.00 dB    -0.00 dB   0.56 dB/band
 *   boom     see note      -0.04 dB    +0.00 dB    -0.16 dB   0.45 dB/band
 *
 * ## Shape of each voice, as measured
 *
 * - **walk** (`0x7D00`, level-driven). Two pitched blips, not one: a loud one on
 *   the rising edge (~435 Hz, ~25 ms decay) and a quieter, higher one on the
 *   falling edge (~677 Hz) — the recorder held the bit for 250 ms and the second
 *   blip lands at 245.5 ms, which is what pins it to the release. Both are
 *   swept, harmonically rich and low-passed: the fitted harmonic ladder is
 *   `1/k^0.7` behind a ~640 Hz pole.
 * - **jump** (`0x7D01`, one-shot, 0.514 s). One warbling tone: a carrier that
 *   creeps from ~287 Hz to ~400 Hz with a 10.2 Hz, ±21 % vibrato over it — the
 *   555 VCO chased by the 4049 oscillator. Same harmonic ladder, ~400 Hz pole.
 * - **boom** (`0x7D02`, one-shot). *Not* noise into a resonator — the measured
 *   crest factor (1.59 per 25 ms) is far too low for that and the RMS envelope
 *   far too steady. It is a constant-amplitude square wave at ~130 Hz whose
 *   half-period is randomised ±35 % by an LFSR, i.e. exactly the "LFSR noise +
 *   LS161 divider" the netlist describes, behind a ~220 Hz pole.
 *
 * ## Boom's duration, honestly
 *
 * `index.json` and `sounds.js` both give boom as 1.825 s. That number is the
 * recorder's first-to-last-non-silent span, and it is inflated: the sound itself
 * is over by 0.76 s, after which the clip holds a 2-3 LSB DC offset until a
 * single smooth 12 ms DC step at 1.803 s — a settling transient of the netlist,
 * one-sided and tone-free, not audio. We render the 0.78 s that is the sound and
 * record both figures in `measured`.
 *
 * ## Output contract
 *
 * `renderEffects()` hands back `{ walk, jump, boom }` as mono AudioBuffers,
 * which is precisely what `core/audio.js`'s `SamplePlayer.loadSample(name, data)`
 * already accepts — so nothing in the player or the board wiring has to change.
 *
 * Like the rest of the audio layer this module never throws: with no
 * `OfflineAudioContext` (Node, or a browser without WebAudio) `renderEffects()`
 * resolves to `null` and the game runs silent. Everything below the rendering
 * step is pure array maths with no WebAudio at all, so the synthesis itself is
 * testable on a host with no audio.
 *
 * Zero dependencies: native WebAudio only.
 */

/** Fallback render rate when the caller does not name one. */
export const DEFAULT_SAMPLE_RATE = 44100;

/** Accepted render rates. `OfflineAudioContext` rejects anything outside this. */
export const MIN_SAMPLE_RATE = 8000;
export const MAX_SAMPLE_RATE = 192000;

/** The names `renderEffects()` resolves to, in `SOUNDS.triggers[n].name` form. */
export const EFFECT_NAMES = ["walk", "jump", "boom"];

/**
 * The whole synthesis, as data.
 *
 * Every field here was fitted against a recording of the real circuit, so this
 * object is the tuning surface: change a number, re-render, re-measure. No code
 * below reads anything that is not declared here.
 *
 * Per effect:
 *   `durationSec`  length of the rendered buffer
 *   `gain`         output trim, chosen so the render's RMS matches the reference
 *   `filters[]`    biquads applied to the summed voices, in order.
 *                  `qDb` is named for WebAudio's convention: `BiquadFilterNode.Q`
 *                  is *decibels* for lowpass/highpass (linear Q = 10^(qDb/20)).
 *   `voices[]`     sources summed before filtering; each carries its own
 *                  envelope, so `atSec` schedules it within the effect.
 *   `measured`     the reference figures this was fitted to.
 *
 * Per voice:
 *   `kind: "tone"`    additive oscillator: sum over k of sin(k*phase + phaseOffset)/k^harmonicExp.
 *                     `freqHz` is a breakpoint curve in Hz; `warble*` adds
 *                     proportional vibrato on top of it.
 *   `kind: "rumble"`  square wave of constant amplitude whose half-period is
 *                     drawn from a 16-bit LFSR: half = base * (1 + jitter*u),
 *                     u uniform in [-1, 1] from `jitterBits` LFSR bits.
 *   `env`             breakpoint curve, normalised 0..1, in seconds from `atSec`.
 *
 * Breakpoint curves are `[[seconds, value], ...]`, ascending in time, linearly
 * interpolated and clamped outside their range.
 */
export const EFFECTS = {
  walk: {
    name: "walk",
    trigger: 0,
    port: 0x7d00,
    behaviour: "level",
    durationSec: 0.37108,
    gain: 0.23805,
    filters: [{ type: "lowpass", hz: 640, qDb: 3 }],
    voices: [
      {
        // Rising edge: the footstep proper.
        kind: "tone",
        atSec: 0,
        durationSec: 0.12,
        gain: 1,
        harmonics: 12,
        harmonicExp: 0.7,
        phaseOffset: Math.PI / 2,
        freqHz: [
          [0, 360], [0.01, 372], [0.02, 418], [0.03, 463], [0.04, 417],
          [0.05, 369], [0.06, 263], [0.075, 240], [0.09, 280], [0.12, 465],
        ],
        env: [
          [0, 0], [0.0013, 1], [0.0037, 0.68], [0.0063, 0.59], [0.0088, 0.515],
          [0.0113, 0.447], [0.0163, 0.349], [0.0213, 0.282], [0.0263, 0.234],
          [0.0313, 0.196], [0.0388, 0.152], [0.0463, 0.111], [0.0563, 0.098],
          [0.0663, 0.072], [0.0763, 0.048], [0.0888, 0.031], [0.1013, 0.017],
          [0.1188, 0.008], [0.12, 0],
        ],
      },
      {
        // Falling edge: the quieter, higher release blip. `atSec` is where it
        // landed under the recorder's 250 ms hold; a player that gates this
        // sample on the latch bit will cut it, which is correct — in-game the
        // ROM holds the bit for 3 frames, so the release blip arrives at ~50 ms.
        kind: "tone",
        atSec: 0.2455,
        // 0.1255 rather than the 0.126 measured: the recorder's silence
        // threshold cut the clip 0.4 ms early, and a voice must fit its effect.
        durationSec: 0.1255,
        gain: 0.2,
        harmonics: 12,
        harmonicExp: 0.7,
        phaseOffset: Math.PI / 2,
        freqHz: [
          [0, 350], [0.015, 452], [0.025, 635], [0.04, 684], [0.05, 688],
          [0.06, 561], [0.07, 478], [0.09, 489], [0.11, 647], [0.1255, 668],
        ],
        env: [
          [0, 0], [0.0037, 1], [0.0063, 0.78], [0.0113, 0.689], [0.0163, 0.637],
          [0.0213, 0.543], [0.0263, 0.457], [0.0338, 0.438], [0.0413, 0.424],
          [0.0463, 0.337], [0.0538, 0.259], [0.0613, 0.186], [0.0713, 0.148],
          [0.0813, 0.104], [0.0913, 0.07], [0.1013, 0.048], [0.1113, 0.027],
          [0.1238, 0.018], [0.1255, 0],
        ],
      },
    ],
    measured: {
      clip: "samples/trig0.wav",
      clipSec: 0.37108,
      audibleSec: 0.37108,
      peak: 0.434,
      rms: 0.0349,
      crest25ms: 2.74,
      dominantHz: 435,
      note:
        "Two blips: rising edge at 0 s (435 Hz, peak 0.434) and falling edge at " +
        "0.2455 s (677 Hz, peak 0.0895). The gap between them is the recorder's " +
        "250 ms hold, which is how we know the second one is the release.",
    },
  },

  jump: {
    name: "jump",
    trigger: 1,
    port: 0x7d01,
    behaviour: "oneshot",
    durationSec: 0.5139,
    gain: 0.07692,
    filters: [{ type: "lowpass", hz: 400, qDb: 0 }],
    voices: [
      {
        kind: "tone",
        atSec: 0,
        durationSec: 0.5139,
        gain: 1,
        harmonics: 12,
        harmonicExp: 0.7,
        phaseOffset: Math.PI / 2,
        warbleHz: 10.2,
        warbleDepth: 0.21,
        warblePhase: -Math.PI / 2,
        freqHz: [
          [0, 290], [0.06, 287], [0.16, 277], [0.21, 284], [0.26, 329],
          [0.31, 384], [0.36, 398], [0.5139, 400],
        ],
        env: [
          [0, 0], [0.02, 1], [0.06, 0.96], [0.12, 0.94], [0.175, 1], [0.23, 0.92],
          [0.275, 0.83], [0.31, 0.66], [0.35, 0.55], [0.39, 0.48], [0.42, 0.32],
          [0.45, 0.23], [0.48, 0.17], [0.5139, 0],
        ],
      },
    ],
    measured: {
      clip: "samples/trig1.wav",
      clipSec: 0.5139,
      audibleSec: 0.5139,
      peak: 0.1383,
      rms: 0.0479,
      crest25ms: 1.91,
      dominantHz: 231,
      note:
        "Carrier climbs 287 -> 400 Hz under a 10.2 Hz vibrato of about +/-21 %. " +
        "Clip length does not change with hold length, so it is a true one-shot.",
    },
  },

  boom: {
    name: "boom",
    trigger: 2,
    port: 0x7d02,
    behaviour: "oneshot",
    durationSec: 0.78,
    gain: 0.2059,
    filters: [{ type: "lowpass", hz: 220, qDb: 3 }],
    voices: [
      {
        kind: "rumble",
        atSec: 0,
        durationSec: 0.78,
        gain: 1,
        hz: 130,
        jitter: 0.35,
        jitterBits: 5,
        seed: 0xace1,
        env: [
          [0, 0], [0.012, 0.9], [0.03, 1], [0.06, 0.95], [0.1, 0.9], [0.15, 0.82],
          [0.2, 0.69], [0.25, 0.55], [0.3, 0.46], [0.35, 0.37], [0.4, 0.31],
          [0.45, 0.24], [0.5, 0.18], [0.55, 0.145], [0.6, 0.105], [0.65, 0.055],
          [0.7, 0.023], [0.75, 0],
        ],
      },
    ],
    measured: {
      clip: "samples/trig2.wav",
      clipSec: 1.82546,
      audibleSec: 0.7625,
      peak: 0.369,
      rms: 0.1223,
      crest25ms: 1.59,
      dominantHz: 130,
      note:
        "peak/rms/crest are over the audible 0.78 s. clipSec is the recorder's " +
        "span and is not sound: past 0.7625 s the clip holds a 2-3 LSB DC offset, " +
        "then takes one smooth one-sided 12 ms DC step at 1.803 s — a netlist " +
        "settling transient that the silence threshold counted as signal.",
    },
  },
};

// --------------------------------------------------------------- pure helpers

/**
 * Clamp a requested render rate into what `OfflineAudioContext` will accept.
 *
 * @param {*} rate
 * @returns {number} a finite rate in [MIN_SAMPLE_RATE, MAX_SAMPLE_RATE]
 */
export function normaliseSampleRate(rate) {
  const n = typeof rate === "number" ? rate : Number(rate);
  if (!Number.isFinite(n)) return DEFAULT_SAMPLE_RATE;
  if (n < MIN_SAMPLE_RATE) return MIN_SAMPLE_RATE;
  if (n > MAX_SAMPLE_RATE) return MAX_SAMPLE_RATE;
  return n;
}

/**
 * Read a breakpoint curve `[[seconds, value], ...]` at time `t`, linearly
 * interpolating between points and holding the end values outside the range.
 *
 * @param {Array<[number, number]>} points ascending in time; must be non-empty
 * @param {number} t seconds
 * @returns {number}
 */
export function curveValueAt(points, t) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  if (!(t > points[0][0])) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    if (t <= t1) {
      const [t0, v0] = points[i - 1];
      if (t1 === t0) return v1;
      return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
    }
  }
  return points[points.length - 1][1];
}

/**
 * Flatten a breakpoint curve to `count` samples spread over `durationSec`, with
 * the first sample at t=0 and the last at t=durationSec.
 *
 * @param {Array<[number, number]>} points
 * @param {number} count
 * @param {number} durationSec
 * @returns {Float32Array}
 */
export function sampleCurve(points, count, durationSec) {
  const n = Math.max(0, Math.floor(count));
  const out = new Float32Array(n);
  if (n === 0) return out;
  if (n === 1) { out[0] = curveValueAt(points, 0); return out; }
  for (let i = 0; i < n; i++) out[i] = curveValueAt(points, (i / (n - 1)) * durationSec);
  return out;
}

/** Sample count a voice occupies at `sampleRate`. @returns {number} */
export function voiceLength(voice, sampleRate) {
  return Math.max(0, Math.round((voice && voice.durationSec > 0 ? voice.durationSec : 0) * sampleRate));
}

/**
 * A 16-bit maximal-length Galois LFSR (taps 0xB400), the same shift register
 * shape the sound board's noise source uses.
 *
 * Kept as a tiny explicit object rather than a closure so tests can step it and
 * check the sequence rather than only its statistics.
 *
 * @param {number} [seed] any non-zero 16-bit value; 0 would lock the register up
 * @returns {{next: () => number, bits: (n: number) => number}}
 */
export function createLfsr(seed = 0xace1) {
  let reg = (Math.floor(Number(seed)) || 0) & 0xffff;
  if (reg === 0) reg = 0xace1;
  const next = () => {
    const lsb = reg & 1;
    reg >>= 1;
    if (lsb) reg ^= 0xb400;
    return reg & 1;
  };
  return {
    next,
    /** @param {number} n @returns {number} the next `n` bits, MSB first */
    bits(n) {
      let r = 0;
      for (let i = 0; i < n; i++) r = (r << 1) | next();
      return r;
    },
  };
}

/**
 * The highest frequency a tone voice will ever reach, vibrato included.
 *
 * @param {object} voice
 * @returns {number} Hz, or 0 if the voice has no frequency curve
 */
export function voiceTopHz(voice) {
  if (!voice || !Array.isArray(voice.freqHz) || voice.freqHz.length === 0) return 0;
  let top = 0;
  for (const [, hz] of voice.freqHz) if (hz > top) top = hz;
  const depth = Number.isFinite(voice.warbleDepth) ? Math.abs(voice.warbleDepth) : 0;
  return top * (1 + (voice.warbleHz ? depth : 0));
}

/**
 * How many partials a tone voice may use at `sampleRate` without any of them
 * crossing Nyquist. At every rate this project renders at the declared count
 * already fits, so this only ever bites on an absurdly low rate — but it makes
 * the generator alias-free at *any* rate rather than at the ones we happened to
 * test.
 *
 * @param {object} voice
 * @param {number} sampleRate
 * @returns {number} at least 1
 */
export function harmonicsFor(voice, sampleRate) {
  const declared = Math.max(1, Math.floor((voice && voice.harmonics) || 1));
  const top = voiceTopHz(voice);
  if (!(top > 0)) return declared;
  const limit = Math.floor(sampleRate / 2 / top);
  return Math.max(1, Math.min(declared, limit));
}

/**
 * Additive oscillator for a `kind: "tone"` voice — unit-scale, no envelope.
 *
 * The partial ladder is explicit (`sin(k*phase + phaseOffset) / k^harmonicExp`)
 * rather than a naive sawtooth because a naive one aliases: its folded partials
 * land *below* the effect's lowpass and so survive it. Summing a bounded number
 * of partials is alias-free by construction, and beyond ~12 the lowpass has
 * already removed them.
 *
 * `phaseOffset` is a free parameter that leaves the magnitude spectrum untouched
 * and moves only the crest factor, which is how the measured crest was matched.
 *
 * @param {object} voice
 * @param {number} sampleRate
 * @returns {Float32Array}
 */
export function renderToneSource(voice, sampleRate) {
  const n = voiceLength(voice, sampleRate);
  const out = new Float32Array(n);
  if (n === 0) return out;
  const harmonics = harmonicsFor(voice, sampleRate);
  const exp = Number.isFinite(voice.harmonicExp) ? voice.harmonicExp : 1;
  const psi = Number.isFinite(voice.phaseOffset) ? voice.phaseOffset : 0;
  const warbleHz = Number.isFinite(voice.warbleHz) ? voice.warbleHz : 0;
  const warbleDepth = Number.isFinite(voice.warbleDepth) ? voice.warbleDepth : 0;
  const warblePhase = Number.isFinite(voice.warblePhase) ? voice.warblePhase : 0;

  const amp = new Float64Array(harmonics + 1);
  for (let k = 1; k <= harmonics; k++) amp[k] = 1 / Math.pow(k, exp);

  const TWO_PI = Math.PI * 2;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let f = curveValueAt(voice.freqHz, t);
    if (warbleHz && warbleDepth) f *= 1 + warbleDepth * Math.sin(TWO_PI * warbleHz * t + warblePhase);
    phase += (TWO_PI * f) / sampleRate;
    let s = 0;
    for (let k = 1; k <= harmonics; k++) s += amp[k] * Math.sin(k * phase + psi);
    out[i] = s;
  }
  return out;
}

/**
 * Square wave of constant amplitude whose half-period is randomised by the LFSR
 * — the `kind: "rumble"` voice, and the model that actually fits boom.
 *
 * @param {object} voice
 * @param {number} sampleRate
 * @returns {Float32Array} values are exactly +1 / -1
 */
export function renderRumbleSource(voice, sampleRate) {
  const n = voiceLength(voice, sampleRate);
  const out = new Float32Array(n);
  if (n === 0) return out;
  const bits = Math.max(1, Math.min(16, Math.floor(voice.jitterBits || 5)));
  const span = (1 << bits) - 1;
  const hz = voice.hz > 0 ? voice.hz : 1;
  const base = sampleRate / (2 * hz);
  const jitter = Number.isFinite(voice.jitter) ? voice.jitter : 0;
  const lfsr = createLfsr(voice.seed);

  let sign = 1;
  let left = 0;
  for (let i = 0; i < n; i++) {
    if (left <= 0) {
      sign = -sign;
      const u = (lfsr.bits(bits) / span) * 2 - 1;
      left = base * (1 + jitter * u);
      if (!(left > 0)) left = base;
    }
    left -= 1;
    out[i] = sign;
  }
  return out;
}

/** Dispatch a voice to its source generator. @returns {Float32Array} */
export function renderVoiceSource(voice, sampleRate) {
  if (!voice || typeof voice !== "object") return new Float32Array(0);
  if (voice.kind === "rumble") return renderRumbleSource(voice, sampleRate);
  return renderToneSource(voice, sampleRate);
}

/**
 * A voice's source with its envelope and gain applied.
 *
 * @param {object} voice
 * @param {number} sampleRate
 * @returns {Float32Array}
 */
export function renderVoice(voice, sampleRate) {
  const src = renderVoiceSource(voice, sampleRate);
  const env = sampleCurve(voice.env, src.length, voice.durationSec);
  const gain = Number.isFinite(voice.gain) ? voice.gain : 1;
  for (let i = 0; i < src.length; i++) src[i] = src[i] * env[i] * gain;
  return src;
}

/**
 * The summed, enveloped voices of one effect — everything the synthesis does
 * before the filters and the output trim, and all of it pure.
 *
 * @param {object} spec an entry of `EFFECTS`
 * @param {number} sampleRate
 * @returns {Float32Array}
 */
export function renderEffectSamples(spec, sampleRate) {
  const sr = normaliseSampleRate(sampleRate);
  const total = Math.max(0, Math.round((spec && spec.durationSec > 0 ? spec.durationSec : 0) * sr));
  const mix = new Float32Array(total);
  if (total === 0 || !spec || !Array.isArray(spec.voices)) return mix;
  for (const voice of spec.voices) {
    const seg = renderVoice(voice, sr);
    const at = Math.max(0, Math.round((voice.atSec || 0) * sr));
    const count = Math.min(seg.length, total - at);
    for (let i = 0; i < count; i++) mix[at + i] += seg[i];
  }
  return mix;
}

// ------------------------------------------------------------------ rendering

/**
 * Find the `OfflineAudioContext` constructor, or null on a host without one.
 *
 * @param {object} [scope] defaults to `globalThis`
 * @returns {Function|null}
 */
export function resolveOfflineAudioContextCtor(scope = globalThis) {
  if (!scope || typeof scope !== "object") return null;
  const Ctor = scope.OfflineAudioContext || scope.webkitOfflineAudioContext;
  return typeof Ctor === "function" ? Ctor : null;
}

/**
 * Render one effect to a mono AudioBuffer.
 *
 * The pure part above produces the summed voices; the OfflineAudioContext graph
 * — buffer source, the effect's biquads, the output trim — does the rest, so the
 * filters are the browser's own and match what the same numbers would do live.
 *
 * @param {object} spec an entry of `EFFECTS`
 * @param {number} [sampleRate]
 * @param {{offlineAudioContext?: Function}} [opts] constructor override, a seam
 *   for tests and unusual hosts
 * @returns {Promise<*>} an AudioBuffer, or null if this host cannot render
 */
export async function renderEffect(spec, sampleRate = DEFAULT_SAMPLE_RATE, opts = {}) {
  const o = opts && typeof opts === "object" ? opts : {};
  const Ctor = typeof o.offlineAudioContext === "function"
    ? o.offlineAudioContext
    : resolveOfflineAudioContextCtor();
  if (!Ctor || !spec) return null;

  try {
    const sr = normaliseSampleRate(sampleRate);
    const samples = renderEffectSamples(spec, sr);
    if (samples.length === 0) return null;

    const ctx = new Ctor(1, samples.length, sr);
    const buffer = ctx.createBuffer(1, samples.length, sr);
    if (typeof buffer.copyToChannel === "function") buffer.copyToChannel(samples, 0);
    else buffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    let node = source;
    for (const f of Array.isArray(spec.filters) ? spec.filters : []) {
      const biquad = ctx.createBiquadFilter();
      biquad.type = f.type;
      biquad.frequency.value = f.hz;
      // WebAudio reads Q in dB for lowpass/highpass; see EFFECTS' docs.
      biquad.Q.value = f.qDb;
      node.connect(biquad);
      node = biquad;
    }

    const trim = ctx.createGain();
    trim.gain.value = Number.isFinite(spec.gain) ? spec.gain : 1;
    node.connect(trim);
    trim.connect(ctx.destination);
    source.start();

    const rendered = await ctx.startRendering();
    return rendered || null;
  } catch {
    return null;
  }
}

/**
 * Render all three effects.
 *
 * The result drops straight into the existing player:
 *
 *   const fx = await renderEffects(44100);
 *   if (fx) for (const [name, buf] of Object.entries(fx)) player.loadSample(name, buf);
 *
 * @param {number} [sampleRate] ideally the AudioContext's own rate, to skip a resample
 * @param {{offlineAudioContext?: Function}} [opts]
 * @returns {Promise<{walk: *, jump: *, boom: *}|null>} null where WebAudio is absent
 */
export async function renderEffects(sampleRate = DEFAULT_SAMPLE_RATE, opts = {}) {
  const o = opts && typeof opts === "object" ? opts : {};
  const Ctor = typeof o.offlineAudioContext === "function"
    ? o.offlineAudioContext
    : resolveOfflineAudioContextCtor();
  if (!Ctor) return null;

  const out = {};
  for (const name of EFFECT_NAMES) {
    out[name] = await renderEffect(EFFECTS[name], sampleRate, { offlineAudioContext: Ctor });
  }
  return out;
}

export default EFFECTS;
