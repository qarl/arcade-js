// SPDX-License-Identifier: GPL-3.0-only
/**
 * Tests for games/dkong/audio/synth.js.
 *
 * These run in Node, which has no WebAudio at all, so they cover two things:
 * the never-throw degradation contract (no OfflineAudioContext ⇒ null, never an
 * exception), and the whole of the synthesis itself — which is deliberately pure
 * array maths, so it is checkable here rather than only in a browser.
 *
 * The graph-assembly path is exercised through the module's constructor
 * injection seam with a recording stand-in, the same trick core/audio.js's own
 * tests use for AudioContext.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SAMPLE_RATE,
  EFFECTS,
  EFFECT_NAMES,
  MAX_SAMPLE_RATE,
  MIN_SAMPLE_RATE,
  createLfsr,
  curveValueAt,
  harmonicsFor,
  normaliseSampleRate,
  renderEffect,
  renderEffects,
  renderEffectSamples,
  renderRumbleSource,
  renderToneSource,
  renderVoice,
  resolveOfflineAudioContextCtor,
  sampleCurve,
  voiceLength,
  voiceTopHz,
} from "../synth.js";

const SR = 48000; // the reference clips' rate, so figures here compare directly

/** peak / rms of a Float32Array. */
function measure(samples) {
  let peak = 0;
  let sum = 0;
  for (const v of samples) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { peak, rms: samples.length ? Math.sqrt(sum / samples.length) : 0 };
}

/** Rate at which a signal crosses zero, in crossings per second. */
function zeroCrossingRate(samples, sampleRate) {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] < 0 && samples[i] >= 0) || (samples[i - 1] >= 0 && samples[i] < 0)) crossings++;
  }
  return crossings / (samples.length / sampleRate);
}

/**
 * A recording stand-in for OfflineAudioContext: enough surface for the render
 * path, and it keeps every node it made so the graph can be asserted on.
 */
function stubOfflineAudioContext(log) {
  return class StubOfflineAudioContext {
    constructor(channels, length, sampleRate) {
      log.contexts.push({ channels, length, sampleRate });
      this.destination = { kind: "destination" };
      this._data = null;
      this._gain = 1;
    }
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length);
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: () => data,
        copyToChannel: (src) => { data.set(src); },
      };
    }
    createBufferSource() {
      const ctx = this;
      return {
        kind: "source",
        buffer: null,
        connect(target) { log.edges.push(["source", target.kind]); return target; },
        start() { log.started++; ctx._data = this.buffer.getChannelData(0); },
      };
    }
    createBiquadFilter() {
      const node = {
        kind: "biquad",
        type: "",
        frequency: { value: 0 },
        Q: { value: 0 },
        connect(target) { log.edges.push(["biquad", target.kind]); return target; },
      };
      log.biquads.push(node);
      return node;
    }
    createGain() {
      const ctx = this;
      const node = {
        kind: "gain",
        gain: { value: 1 },
        connect(target) { log.edges.push(["gain", target.kind]); ctx._gain = node.gain.value; return target; },
      };
      log.gains.push(node);
      return node;
    }
    async startRendering() {
      // No filtering — the stub proves the graph is wired and carries signal;
      // the fidelity figures come from a real browser render.
      const src = this._data || new Float32Array(0);
      const data = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) data[i] = src[i] * this._gain;
      return { numberOfChannels: 1, length: data.length, sampleRate: SR, getChannelData: () => data };
    }
  };
}

function newLog() {
  return { contexts: [], biquads: [], gains: [], edges: [], started: 0 };
}

// ------------------------------------------------------- degradation contract

test("Node has no OfflineAudioContext, so renderEffects() resolves to null", async () => {
  assert.equal(resolveOfflineAudioContextCtor(), null);
  assert.equal(await renderEffects(), null);
  assert.equal(await renderEffects(48000), null);
});

test("renderEffect() resolves to null rather than throwing on any host or input", async () => {
  assert.equal(await renderEffect(EFFECTS.walk), null);
  assert.equal(await renderEffect(null), null);
  assert.equal(await renderEffect(undefined, NaN), null);
  assert.equal(await renderEffect({}, "nonsense"), null);
});

test("resolveOfflineAudioContextCtor accepts a scope and rejects non-functions", () => {
  const Stub = stubOfflineAudioContext(newLog());
  assert.equal(resolveOfflineAudioContextCtor({ OfflineAudioContext: Stub }), Stub);
  assert.equal(resolveOfflineAudioContextCtor({ webkitOfflineAudioContext: Stub }), Stub);
  assert.equal(resolveOfflineAudioContextCtor({ OfflineAudioContext: 42 }), null);
  assert.equal(resolveOfflineAudioContextCtor(null), null);
  assert.equal(resolveOfflineAudioContextCtor("nope"), null);
});

test("a context constructor that throws is swallowed, not propagated", async () => {
  const Boom = function () { throw new Error("no audio here"); };
  assert.equal(await renderEffect(EFFECTS.boom, SR, { offlineAudioContext: Boom }), null);
  const all = await renderEffects(SR, { offlineAudioContext: Boom });
  assert.deepEqual(Object.keys(all), EFFECT_NAMES);
  for (const name of EFFECT_NAMES) assert.equal(all[name], null);
});

// ------------------------------------------------------------ EFFECTS is sane

test("EFFECTS declares exactly walk, jump and boom, on ls259 triggers 0/1/2", () => {
  assert.deepEqual(Object.keys(EFFECTS), ["walk", "jump", "boom"]);
  assert.deepEqual(EFFECT_NAMES, ["walk", "jump", "boom"]);
  assert.equal(EFFECTS.walk.trigger, 0);
  assert.equal(EFFECTS.jump.trigger, 1);
  assert.equal(EFFECTS.boom.trigger, 2);
  assert.equal(EFFECTS.walk.port, 0x7d00);
  assert.equal(EFFECTS.jump.port, 0x7d01);
  assert.equal(EFFECTS.boom.port, 0x7d02);
  for (const name of EFFECT_NAMES) assert.equal(EFFECTS[name].name, name);
  assert.equal(EFFECTS.walk.behaviour, "level");
  assert.equal(EFFECTS.jump.behaviour, "oneshot");
  assert.equal(EFFECTS.boom.behaviour, "oneshot");
});

test("each effect's rendered length matches the measured audible length of the circuit", () => {
  for (const name of EFFECT_NAMES) {
    const fx = EFFECTS[name];
    assert.ok(fx.durationSec > 0, `${name} duration must be positive`);
    assert.ok(
      Math.abs(fx.durationSec - fx.measured.audibleSec) <= 0.02,
      `${name}: renders ${fx.durationSec}s but the circuit is audible for ${fx.measured.audibleSec}s`,
    );
  }
  // The three measured targets, from samples/index.json and the clips themselves.
  assert.ok(Math.abs(EFFECTS.walk.durationSec - 0.37108) < 1e-4);
  assert.ok(Math.abs(EFFECTS.jump.durationSec - 0.5139) < 1e-4);
  // boom is the documented exception: the recorder's 1.825 s span is a DC
  // settling step, not sound, so we render the 0.78 s that is.
  assert.equal(EFFECTS.boom.measured.clipSec, 1.82546);
  assert.ok(EFFECTS.boom.durationSec < EFFECTS.boom.measured.clipSec);
});

test("every measured reference figure is a plausible full-scale audio measurement", () => {
  for (const name of EFFECT_NAMES) {
    const m = EFFECTS[name].measured;
    assert.match(m.clip, /^samples\/trig[012]\.wav$/);
    assert.ok(m.peak > 0 && m.peak <= 1, `${name} peak`);
    assert.ok(m.rms > 0 && m.rms < m.peak, `${name} rms`);
    assert.ok(m.crest25ms >= 1 && m.crest25ms < 10, `${name} crest`);
    assert.ok(m.dominantHz >= 40 && m.dominantHz <= 4000, `${name} dominant`);
    assert.ok(m.clipSec > 0 && m.audibleSec > 0);
  }
  assert.equal(EFFECTS.walk.measured.dominantHz, 435);
  assert.equal(EFFECTS.jump.measured.dominantHz, 231);
  assert.equal(EFFECTS.boom.measured.dominantHz, 130);
});

test("every synthesis parameter is inside a sane range", () => {
  for (const name of EFFECT_NAMES) {
    const fx = EFFECTS[name];
    assert.ok(fx.gain > 0 && fx.gain <= 4, `${name} trim gain`);
    assert.ok(Array.isArray(fx.voices) && fx.voices.length > 0, `${name} has voices`);

    for (const f of fx.filters) {
      assert.ok(["lowpass", "highpass", "bandpass"].includes(f.type), `${name} filter type`);
      assert.ok(f.hz > 20 && f.hz < 20000, `${name} filter frequency`);
      assert.ok(f.qDb >= -24 && f.qDb <= 24, `${name} filter Q (dB)`);
    }

    for (const v of fx.voices) {
      assert.ok(v.durationSec > 0, `${name} voice duration`);
      assert.ok(v.atSec >= 0, `${name} voice offset`);
      assert.ok(
        v.atSec + v.durationSec <= fx.durationSec + 1e-9,
        `${name} voice runs past the end of the effect`,
      );
      assert.ok(v.gain > 0 && v.gain <= 1, `${name} voice gain`);

      if (v.kind === "tone") {
        assert.ok(v.harmonics >= 1 && v.harmonics <= 64, `${name} harmonic count`);
        assert.ok(v.harmonicExp > 0 && v.harmonicExp <= 3, `${name} harmonic rolloff`);
        // Nothing may reach Nyquist at any rate we would actually render at.
        assert.ok(
          voiceTopHz(v) * v.harmonics < DEFAULT_SAMPLE_RATE / 2,
          `${name} would alias at ${DEFAULT_SAMPLE_RATE} Hz`,
        );
        for (const [, hz] of v.freqHz) assert.ok(hz >= 20 && hz <= 8000, `${name} frequency point`);
        if (v.warbleHz) {
          assert.ok(v.warbleHz > 0 && v.warbleHz < 100, `${name} warble rate`);
          assert.ok(v.warbleDepth > 0 && v.warbleDepth < 1, `${name} warble depth`);
        }
      } else {
        assert.equal(v.kind, "rumble");
        assert.ok(v.hz > 20 && v.hz < 2000, `${name} rumble pitch`);
        assert.ok(v.jitter >= 0 && v.jitter < 1, `${name} rumble jitter`);
        assert.ok(v.jitterBits >= 1 && v.jitterBits <= 16, `${name} rumble jitter bits`);
        assert.ok(v.seed > 0 && v.seed <= 0xffff, `${name} LFSR seed must be non-zero`);
      }
    }
  }
});

test("every breakpoint curve rises in time, and every envelope opens and closes at silence", () => {
  const ascending = (points, label) => {
    assert.ok(points.length >= 2, `${label} needs at least two points`);
    for (let i = 1; i < points.length; i++) {
      assert.ok(points[i][0] >= points[i - 1][0], `${label} goes back in time at index ${i}`);
      assert.ok(Number.isFinite(points[i][1]), `${label} has a non-finite value at index ${i}`);
    }
  };
  for (const name of EFFECT_NAMES) {
    for (const [i, v] of EFFECTS[name].voices.entries()) {
      ascending(v.env, `${name} voice ${i} env`);
      assert.equal(v.env[0][0], 0, `${name} voice ${i} env must start at t=0`);
      assert.equal(v.env[0][1], 0, `${name} voice ${i} env must start silent`);
      assert.equal(v.env[v.env.length - 1][1], 0, `${name} voice ${i} env must end silent`);
      assert.ok(
        v.env[v.env.length - 1][0] <= v.durationSec + 1e-9,
        `${name} voice ${i} env outlives its voice`,
      );
      assert.ok(Math.max(...v.env.map(([, x]) => x)) === 1, `${name} voice ${i} env must peak at 1`);
      if (v.kind === "tone") ascending(v.freqHz, `${name} voice ${i} freq`);
    }
  }
});

// ------------------------------------------------------------- pure helpers

test("normaliseSampleRate clamps to what OfflineAudioContext accepts", () => {
  assert.equal(normaliseSampleRate(44100), 44100);
  assert.equal(normaliseSampleRate(48000), 48000);
  assert.equal(normaliseSampleRate(undefined), DEFAULT_SAMPLE_RATE);
  assert.equal(normaliseSampleRate(NaN), DEFAULT_SAMPLE_RATE);
  assert.equal(normaliseSampleRate("not a rate"), DEFAULT_SAMPLE_RATE);
  assert.equal(normaliseSampleRate(0), MIN_SAMPLE_RATE);
  assert.equal(normaliseSampleRate(-5), MIN_SAMPLE_RATE);
  assert.equal(normaliseSampleRate(1e9), MAX_SAMPLE_RATE);
  assert.equal(normaliseSampleRate("48000"), 48000);
});

test("curveValueAt interpolates between breakpoints and holds the ends", () => {
  const c = [[0, 0], [1, 10], [2, 20]];
  assert.equal(curveValueAt(c, -1), 0);
  assert.equal(curveValueAt(c, 0), 0);
  assert.equal(curveValueAt(c, 0.5), 5);
  assert.equal(curveValueAt(c, 1), 10);
  assert.equal(curveValueAt(c, 1.25), 12.5);
  assert.equal(curveValueAt(c, 2), 20);
  assert.equal(curveValueAt(c, 99), 20);
  assert.equal(curveValueAt([[0, 7]], 3), 7);
  // A repeated time is a step, and must not divide by zero.
  assert.equal(curveValueAt([[0, 0], [1, 1], [1, 5], [2, 5]], 1), 1);
  assert.equal(curveValueAt([[0, 0], [1, 1], [1, 5], [2, 5]], 1.5), 5);
  assert.equal(curveValueAt([], 1), 0);
});

test("sampleCurve spans exactly [0, durationSec] across its output", () => {
  const c = [[0, 0], [1, 100]];
  const s = sampleCurve(c, 5, 1);
  assert.equal(s.length, 5);
  assert.equal(s[0], 0);
  assert.equal(s[4], 100);
  assert.equal(s[2], 50);
  assert.equal(sampleCurve(c, 0, 1).length, 0);
  assert.equal(sampleCurve(c, 1, 1)[0], 0);
});

test("voiceLength rounds the voice onto the sample grid", () => {
  assert.equal(voiceLength({ durationSec: 1 }, 48000), 48000);
  assert.equal(voiceLength({ durationSec: 0.12 }, 48000), 5760);
  assert.equal(voiceLength({ durationSec: 0 }, 48000), 0);
  assert.equal(voiceLength({}, 48000), 0);
  assert.equal(voiceLength(null, 48000), 0);
});

test("createLfsr is a maximal-length 16-bit sequence that never locks up", () => {
  const lfsr = createLfsr(0xace1);
  let ones = 0;
  for (let i = 0; i < 65535; i++) ones += lfsr.next();
  // A maximal 16-bit LFSR visits all 65535 non-zero states, so the output bit is
  // 1 for exactly half of them (rounded up).
  assert.equal(ones, 32768);
  // bits() packs successive output bits, MSB first.
  const a = createLfsr(1);
  const b = createLfsr(1);
  const packed = a.bits(4);
  const manual = (b.next() << 3) | (b.next() << 2) | (b.next() << 1) | b.next();
  assert.equal(packed, manual);
  // A zero seed would freeze the register, so it is replaced.
  const zero = createLfsr(0);
  let changed = false;
  let prev = zero.next();
  for (let i = 0; i < 64; i++) if (zero.next() !== prev) { changed = true; break; }
  assert.ok(changed, "a zero seed must not produce a constant output");
});

test("renderToneSource follows its frequency curve", () => {
  const voice = {
    kind: "tone", durationSec: 0.5, gain: 1,
    harmonics: 1, harmonicExp: 1, phaseOffset: 0,
    freqHz: [[0, 1000], [0.5, 1000]],
    env: [[0, 0], [0.001, 1], [0.5, 0]],
  };
  const s = renderToneSource(voice, SR);
  assert.equal(s.length, 24000);
  assert.ok(s.every(Number.isFinite));
  // One partial at 1000 Hz ⇒ 2000 zero crossings per second.
  assert.ok(Math.abs(zeroCrossingRate(s, SR) - 2000) < 20, "constant 1 kHz tone");
  assert.ok(Math.abs(measure(s).peak - 1) < 0.01, "a lone unit partial peaks at 1");

  // A sweep really sweeps: the second half must be higher-pitched than the first.
  const swept = renderToneSource({ ...voice, freqHz: [[0, 200], [0.5, 800]] }, SR);
  const lo = zeroCrossingRate(swept.subarray(0, 12000), SR);
  const hi = zeroCrossingRate(swept.subarray(12000), SR);
  assert.ok(hi > lo * 1.5, `sweep should climb: ${lo} -> ${hi}`);

  // The harmonic ladder is 1/k^harmonicExp, so more partials means a taller peak.
  const rich = renderToneSource({ ...voice, harmonics: 8, phaseOffset: Math.PI / 2 }, SR);
  assert.ok(measure(rich).peak > 2, "cosine-phase partials stack up");
  assert.ok(measure(rich).peak <= 8, "and stay bounded by the sum of the ladder");
});

test("harmonicsFor keeps every partial below Nyquist at any render rate", () => {
  const walkVoice = EFFECTS.walk.voices[0];
  assert.equal(harmonicsFor(walkVoice, 48000), walkVoice.harmonics, "no clamping at 48 kHz");
  assert.equal(harmonicsFor(walkVoice, DEFAULT_SAMPLE_RATE), walkVoice.harmonics, "nor at 44.1 kHz");
  const clamped = harmonicsFor(walkVoice, MIN_SAMPLE_RATE);
  assert.ok(clamped >= 1 && clamped < walkVoice.harmonics, `clamped to ${clamped} at ${MIN_SAMPLE_RATE} Hz`);
  assert.ok(voiceTopHz(walkVoice) * clamped <= MIN_SAMPLE_RATE / 2, "and the top partial stays below Nyquist");
  assert.equal(harmonicsFor({ harmonics: 4 }, 48000), 4, "a voice with no frequency curve is left alone");
  assert.equal(harmonicsFor({}, 48000), 1);

  // voiceTopHz includes the vibrato swing.
  assert.equal(voiceTopHz({ freqHz: [[0, 100], [1, 400]] }), 400);
  assert.equal(voiceTopHz({ freqHz: [[0, 400]], warbleHz: 10, warbleDepth: 0.25 }), 500);
  assert.equal(voiceTopHz({ freqHz: [[0, 400]], warbleDepth: 0.25 }), 400, "depth without a rate does nothing");
  assert.equal(voiceTopHz(null), 0);
});

test("renderToneSource applies warble as proportional vibrato", () => {
  const base = {
    kind: "tone", durationSec: 0.4, gain: 1,
    harmonics: 1, harmonicExp: 1, phaseOffset: 0,
    freqHz: [[0, 400], [0.4, 400]],
    env: [[0, 0], [0.001, 1], [0.4, 0]],
  };
  const flat = renderToneSource(base, SR);
  const wobbly = renderToneSource({ ...base, warbleHz: 10, warbleDepth: 0.25, warblePhase: -Math.PI / 2 }, SR);
  // Averaged over whole vibrato cycles the mean rate is unchanged...
  assert.ok(Math.abs(zeroCrossingRate(wobbly, SR) - zeroCrossingRate(flat, SR)) < 40);
  // ...but within a cycle it swings, and a flat tone does not.
  const window = Math.round(0.025 * SR);
  const rates = [];
  for (let i = 0; i + window <= wobbly.length; i += window) {
    rates.push(zeroCrossingRate(wobbly.subarray(i, i + window), SR));
  }
  assert.ok(Math.max(...rates) - Math.min(...rates) > 200, "vibrato must move the pitch");
});

test("renderRumbleSource is a two-level square at roughly twice its stated pitch", () => {
  const voice = { kind: "rumble", durationSec: 1, gain: 1, hz: 130, jitter: 0.35, jitterBits: 5, seed: 0xace1, env: [[0, 0], [0.01, 1], [1, 0]] };
  const s = renderRumbleSource(voice, SR);
  assert.equal(s.length, SR);
  for (const v of s) assert.ok(v === 1 || v === -1, "a rumble source only ever holds +1 or -1");
  const rate = zeroCrossingRate(s, SR);
  assert.ok(Math.abs(rate - 2 * voice.hz) < 0.15 * 2 * voice.hz, `crossing rate ${rate} should be near ${2 * voice.hz}`);

  // Jitter is what makes it a rumble rather than a tone: with none, every
  // half-period is identical.
  const clean = renderRumbleSource({ ...voice, jitter: 0 }, SR);
  const runLengths = new Set();
  let run = 1;
  for (let i = 1; i < 2000; i++) {
    if (clean[i] === clean[i - 1]) run++;
    else { runLengths.add(run); run = 1; }
  }
  assert.ok(runLengths.size <= 2, "unjittered runs are all the same length");
  const jittered = new Set();
  run = 1;
  for (let i = 1; i < 2000; i++) {
    if (s[i] === s[i - 1]) run++;
    else { jittered.add(run); run = 1; }
  }
  assert.ok(jittered.size > 4, "jittered runs vary");
});

test("renderVoice opens and closes at silence and honours its gain", () => {
  const voice = EFFECTS.boom.voices[0];
  const full = renderVoice(voice, SR);
  assert.equal(full.length, voiceLength(voice, SR));
  assert.equal(Math.abs(full[0]), 0, "an envelope that starts at 0 must produce silence at t=0");
  assert.equal(Math.abs(full[full.length - 1]), 0, "and at the end");
  assert.ok(measure(full).rms > 0.01, "but not in between");

  const half = renderVoice({ ...voice, gain: voice.gain / 2 }, SR);
  const a = measure(full).rms;
  const b = measure(half).rms;
  assert.ok(Math.abs(b / a - 0.5) < 1e-4, `halving the gain should halve the rms (${b / a})`);
});

test("renderEffectSamples mixes every voice into a finite, non-silent buffer", () => {
  for (const name of EFFECT_NAMES) {
    const fx = EFFECTS[name];
    const s = renderEffectSamples(fx, SR);
    assert.equal(s.length, Math.round(fx.durationSec * SR), `${name} length`);
    assert.ok(s.every(Number.isFinite), `${name} is finite throughout`);
    const { peak, rms } = measure(s);
    assert.ok(peak > 0.5, `${name} must not be silent (peak ${peak})`);
    assert.ok(rms > 0.05, `${name} must carry energy (rms ${rms})`);
  }
  // walk's second voice is scheduled late, so its buffer has a quiet gap that a
  // single-voice mix would not.
  const walk = renderEffectSamples(EFFECTS.walk, SR);
  const gap = measure(walk.subarray(Math.round(0.18 * SR), Math.round(0.24 * SR)));
  const attack = measure(walk.subarray(0, Math.round(0.02 * SR)));
  const release = measure(walk.subarray(Math.round(0.25 * SR), Math.round(0.30 * SR)));
  assert.ok(gap.rms < attack.rms / 50, "the gap between footstep blips is quiet");
  assert.ok(release.rms > gap.rms * 10, "the release blip is not");

  assert.equal(renderEffectSamples(null, SR).length, 0);
  assert.equal(renderEffectSamples({ durationSec: 0 }, SR).length, 0);
});

test("renderEffectSamples is deterministic and rate-independent in level", () => {
  const a = renderEffectSamples(EFFECTS.boom, SR);
  const b = renderEffectSamples(EFFECTS.boom, SR);
  assert.deepEqual(Array.from(a), Array.from(b), "the LFSR is seeded, so renders repeat exactly");

  for (const name of EFFECT_NAMES) {
    const at44 = measure(renderEffectSamples(EFFECTS[name], 44100));
    const at48 = measure(renderEffectSamples(EFFECTS[name], 48000));
    assert.ok(Math.abs(at44.rms / at48.rms - 1) < 0.05, `${name} rms must not depend on the render rate`);
  }
});

test("the fitted synthesis has not drifted from the parameters that were measured", () => {
  // Pre-filter figures at 48 kHz, recorded when EFFECTS was fitted against
  // samples/trig{0,1,2}.wav. An edit to any curve moves these.
  const expected = {
    walk: { peak: 3.48541, rms: 0.14665 },
    jump: { peak: 4.32990, rms: 0.78669 },
    boom: { peak: 1.00000, rms: 0.51004 },
  };
  for (const name of EFFECT_NAMES) {
    const got = measure(renderEffectSamples(EFFECTS[name], SR));
    assert.ok(Math.abs(got.peak - expected[name].peak) < 2e-3, `${name} peak ${got.peak}`);
    assert.ok(Math.abs(got.rms - expected[name].rms) < 2e-3, `${name} rms ${got.rms}`);
  }
});

// -------------------------------------------------------------- graph wiring

test("renderEffect builds source -> filters -> trim -> destination", async () => {
  const log = newLog();
  const buffer = await renderEffect(EFFECTS.walk, SR, { offlineAudioContext: stubOfflineAudioContext(log) });
  assert.ok(buffer, "a usable context must yield a buffer");
  assert.equal(log.contexts.length, 1);
  assert.deepEqual(log.contexts[0], {
    channels: 1,
    length: Math.round(EFFECTS.walk.durationSec * SR),
    sampleRate: SR,
  });
  assert.equal(log.started, 1, "the source is started exactly once");
  assert.equal(log.biquads.length, EFFECTS.walk.filters.length);
  assert.equal(log.biquads[0].type, "lowpass");
  assert.equal(log.biquads[0].frequency.value, EFFECTS.walk.filters[0].hz);
  assert.equal(log.biquads[0].Q.value, EFFECTS.walk.filters[0].qDb);
  assert.equal(log.gains.length, 1);
  assert.equal(log.gains[0].gain.value, EFFECTS.walk.gain);
  assert.deepEqual(log.edges, [["source", "biquad"], ["biquad", "gain"], ["gain", "destination"]]);
  assert.equal(buffer.length, Math.round(EFFECTS.walk.durationSec * SR));
  assert.ok(measure(buffer.getChannelData(0)).peak > 0, "and the buffer carries signal");
});

test("renderEffects returns all three effects as buffers of the requested rate", async () => {
  const log = newLog();
  const fx = await renderEffects(SR, { offlineAudioContext: stubOfflineAudioContext(log) });
  assert.ok(fx);
  assert.deepEqual(Object.keys(fx), EFFECT_NAMES);
  assert.equal(log.contexts.length, 3);
  for (const name of EFFECT_NAMES) {
    assert.ok(fx[name], `${name} must render`);
    assert.equal(fx[name].numberOfChannels, 1, `${name} is mono, as SamplePlayer expects`);
    assert.equal(fx[name].length, Math.round(EFFECTS[name].durationSec * SR), `${name} length`);
    assert.ok(measure(fx[name].getChannelData(0)).rms > 0, `${name} is not silent`);
  }
  for (const ctx of log.contexts) assert.equal(ctx.sampleRate, SR);
});

test("renderEffects clamps a junk sample rate instead of failing", async () => {
  const log = newLog();
  const fx = await renderEffects("nonsense", { offlineAudioContext: stubOfflineAudioContext(log) });
  assert.ok(fx);
  for (const ctx of log.contexts) assert.equal(ctx.sampleRate, DEFAULT_SAMPLE_RATE);
});
