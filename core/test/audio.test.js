// SPDX-License-Identifier: GPL-3.0-only
/**
 * core/audio.js tests.
 *
 * These run in Node, where WebAudio does not exist. Two halves:
 *
 *   1. **The graceful-degradation contract.** With no AudioContext anywhere,
 *      every SamplePlayer method must be a quiet no-op — the game has to run
 *      identically when audio is unavailable. Silence is fine; a throw is not.
 *   2. **The playback logic**, exercised through the `audioContext` injection
 *      seam with a minimal fake WebAudio graph, plus the pure helpers
 *      (gain clamping, voice bookkeeping, buffer normalisation) tested directly.
 *
 * No ROM, no browser, no dependencies.
 * Run: node --test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  SamplePlayer, VoiceRegistry, clampGain, resolveAudioContextCtor,
  isAudioBufferLike, toEncodedBytes, MAX_GAIN, DEFAULT_MAX_VOICES,
} from "../audio.js";

// ---------------------------------------------------------------------------
// A minimal fake WebAudio graph. Enough surface for SamplePlayer, nothing more.
// ---------------------------------------------------------------------------

class FakeParam {
  constructor(value) { this.value = value; }
}

class FakeNode {
  constructor() { this.outputs = []; this.disconnects = 0; }
  connect(dest) { this.outputs.push(dest); return dest; }
  disconnect() { this.disconnects++; this.outputs.length = 0; }
}

class FakeGain extends FakeNode {
  constructor() { super(); this.gain = new FakeParam(1); }
}

class FakeSource extends FakeNode {
  constructor() {
    super();
    this.buffer = null;
    this.loop = false;
    this.onended = null;
    this.starts = 0;
    this.stops = 0;
  }
  start() { this.starts++; }
  stop() { this.stops++; }
  /** Simulate the source running to its end. */
  finish() { if (this.onended) this.onended(); }
}

function fakeAudioBuffer(tag = "buf") {
  return { tag, sampleRate: 44100, length: 128, getChannelData() { return new Float32Array(128); } };
}

/**
 * Build an AudioContext class. `cfg` steers the behaviours we need to test:
 *   state          initial ctx.state ("running" | "suspended")
 *   resumeRejects  ctx.resume() rejects (autoplay policy said no)
 *   decodeFails    decodeAudioData rejects
 *   decodeStyle    "promise" (default) | "callback" (legacy Safari)
 *   throwOnNew     constructing the context throws
 *   instances      array the created contexts are pushed into
 */
function fakeContextClass(cfg = {}) {
  const instances = cfg.instances || [];
  return class FakeAudioContext {
    constructor() {
      if (cfg.throwOnNew) throw new Error("no audio device");
      this.state = cfg.state || "running";
      this.destination = new FakeNode();
      this.sources = [];
      this.gains = [];
      this.resumes = 0;
      this.closes = 0;
      instances.push(this);
    }
    createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
    createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
    decodeAudioData(bytes, onOk, onErr) {
      this.lastDecoded = bytes;
      if (cfg.decodeStyle === "callback") {
        if (cfg.decodeFails) onErr(new Error("bad audio"));
        else onOk(fakeAudioBuffer("decoded"));
        return undefined;
      }
      return cfg.decodeFails
        ? Promise.reject(new Error("bad audio"))
        : Promise.resolve(fakeAudioBuffer("decoded"));
    }
    async resume() {
      this.resumes++;
      if (cfg.resumeRejects) throw new Error("autoplay blocked");
      this.state = "running";
    }
    async close() { this.closes++; this.state = "closed"; }
  };
}

const bytes = (n = 16) => new Uint8Array(n).fill(1).buffer;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("clampGain keeps sane gains, clamps the rest, and falls back on junk", () => {
  assert.equal(clampGain(0.5), 0.5);
  assert.equal(clampGain(0), 0);
  assert.equal(clampGain(1), 1);
  assert.equal(clampGain(-3), 0, "negative gain clamps to silence");
  assert.equal(clampGain(1e9), MAX_GAIN, "runaway gain clamps to the ceiling");
  // NaN into an AudioParam throws; the fallback is what keeps us from doing that.
  assert.equal(clampGain(NaN), 1);
  // An omitted option must not silence a sound, so "unset" takes the fallback
  // rather than Number(null) === 0.
  assert.equal(clampGain(undefined), 1);
  assert.equal(clampGain(null), 1);
  assert.equal(clampGain(""), 1);
  assert.equal(clampGain("nope"), 1);
  assert.equal(clampGain(NaN, 0.25), 0.25, "fallback is honoured");
  assert.equal(clampGain(NaN, NaN), 1, "a junk fallback still yields a finite gain");
  assert.equal(clampGain("0.75"), 0.75, "numeric strings coerce");
});

test("resolveAudioContextCtor finds WebAudio, or returns null on a host without it", () => {
  assert.equal(resolveAudioContextCtor(globalThis), null, "Node has no WebAudio");
  assert.equal(resolveAudioContextCtor(null), null);
  assert.equal(resolveAudioContextCtor(undefined), null, "no scope, no context");
  const C = function () {};
  assert.equal(resolveAudioContextCtor({ AudioContext: C }), C);
  assert.equal(resolveAudioContextCtor({ webkitAudioContext: C }), C, "webkit prefix accepted");
  assert.equal(resolveAudioContextCtor({ AudioContext: "not a ctor" }), null);
  assert.equal(resolveAudioContextCtor({}), null);
});

test("isAudioBufferLike distinguishes decoded buffers from raw bytes", () => {
  assert.equal(isAudioBufferLike(fakeAudioBuffer()), true);
  assert.equal(isAudioBufferLike(new ArrayBuffer(8)), false);
  assert.equal(isAudioBufferLike(new Uint8Array(8)), false);
  assert.equal(isAudioBufferLike(null), false);
  assert.equal(isAudioBufferLike("wav"), false);
  assert.equal(isAudioBufferLike({ sampleRate: 44100, length: 4 }), false, "needs getChannelData");
});

test("toEncodedBytes copies bytes out of any view, and rejects non-audio input", () => {
  const src = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const whole = toEncodedBytes(src.buffer);
  assert.ok(whole instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(whole)], [1, 2, 3, 4, 5, 6]);
  assert.notEqual(whole, src.buffer, "must be a copy — decodeAudioData detaches what it is given");

  const view = new Uint8Array(src.buffer, 2, 3);
  assert.deepEqual([...new Uint8Array(toEncodedBytes(view))], [3, 4, 5], "honours byteOffset/length");

  assert.equal(toEncodedBytes(new ArrayBuffer(0)), null, "empty is not a sample");
  assert.equal(toEncodedBytes("sound.wav"), null, "URLs are the caller's job, not core's");
  assert.equal(toEncodedBytes(null), null);
  assert.equal(toEncodedBytes(fakeAudioBuffer()), null);
});

// ---------------------------------------------------------------------------
// VoiceRegistry (pure bookkeeping)
// ---------------------------------------------------------------------------

test("VoiceRegistry tracks voices by name with unique ids", () => {
  const r = new VoiceRegistry(8);
  assert.equal(r.size, 0);
  assert.deepEqual(r.byName("jump"), []);

  const a = { name: "jump" }, b = { name: "jump" }, c = { name: "walk" };
  assert.equal(r.add(a), null, "no eviction below the cap");
  r.add(b);
  r.add(c);
  assert.equal(r.size, 3);
  assert.notEqual(a.id, b.id, "ids are unique");
  assert.equal(r.byName("jump").length, 2, "overlapping voices of one sample coexist");
  assert.equal(r.byName("walk").length, 1);
  assert.equal(r.byName("nope").length, 0);
  assert.deepEqual(r.all(), [a, b, c], "oldest first");

  assert.equal(r.remove(a), true);
  assert.equal(r.remove(a), false, "removing twice is harmless");
  assert.equal(r.remove(null), false);
  assert.equal(r.remove({}), false, "an unregistered voice is not present");
  assert.equal(r.size, 2);

  assert.deepEqual(r.clear(), [b, c]);
  assert.equal(r.size, 0);
});

test("VoiceRegistry caps voices, sacrificing the oldest one-shot before any loop", () => {
  const r = new VoiceRegistry(3);
  const loop = { name: "bgm", loop: true };
  const one = { name: "blip" }, two = { name: "blip" };
  r.add(loop); r.add(one); r.add(two);
  assert.equal(r.size, 3);

  const evicted = r.add({ name: "blip" });
  assert.equal(evicted, one, "the oldest one-shot goes, not the older looping cue");
  assert.equal(r.size, 3, "still at the cap");
  assert.ok(r.all().includes(loop), "background music survives blip spam");

  // When everything loops, the oldest overall is the only candidate.
  const allLoops = new VoiceRegistry(2);
  const l1 = { name: "a", loop: true }, l2 = { name: "b", loop: true };
  allLoops.add(l1); allLoops.add(l2);
  assert.equal(allLoops.add({ name: "c", loop: true }), l1);
});

test("VoiceRegistry rejects a nonsense cap and non-object voices", () => {
  assert.equal(new VoiceRegistry(0).maxVoices, DEFAULT_MAX_VOICES);
  assert.equal(new VoiceRegistry(-5).maxVoices, DEFAULT_MAX_VOICES);
  assert.equal(new VoiceRegistry("many").maxVoices, DEFAULT_MAX_VOICES);
  assert.equal(new VoiceRegistry(undefined).maxVoices, DEFAULT_MAX_VOICES);
  assert.equal(new VoiceRegistry(4).maxVoices, 4);

  const r = new VoiceRegistry(4);
  assert.equal(r.add(null), null);
  assert.equal(r.add("voice"), null);
  assert.equal(r.size, 0, "junk is not registered");
});

// ---------------------------------------------------------------------------
// Graceful degradation: no AudioContext at all (this is Node)
// ---------------------------------------------------------------------------

test("a player constructed without WebAudio is not ready and has sane defaults", () => {
  const p = new SamplePlayer();
  assert.equal(p.ready, false, "Node has no AudioContext");
  assert.equal(p.muted, false);
  assert.equal(p.enabled, true);
  assert.equal(p.masterGain, 1);
  assert.equal(p.voiceCount, 0);
  assert.deepEqual(p.sampleNames(), []);
});

test("init() without WebAudio resolves false instead of throwing", async () => {
  const p = new SamplePlayer();
  assert.equal(await p.init(), false);
  assert.equal(p.ready, false);
  assert.equal(await p.init(), false, "callable twice");
});

test("every method on a context-less player is a safe no-op", async () => {
  const p = new SamplePlayer({ masterGain: 0.5 });

  assert.equal(await p.loadSample("jump", bytes()), true, "bytes are held for a later context");
  assert.equal(p.has("jump"), true);
  assert.equal(p.play("jump"), null, "no context ⇒ no voice");
  assert.equal(p.play("jump", { loop: true, gain: 0.2 }), null);
  assert.equal(p.voiceCount, 0);

  assert.doesNotThrow(() => p.stop("jump"));
  assert.doesNotThrow(() => p.stop("never-loaded"));
  assert.doesNotThrow(() => p.stopAll());
  assert.doesNotThrow(() => p.setMasterGain(0.3));
  assert.doesNotThrow(() => p.setMuted(true));
  assert.doesNotThrow(() => p.trigger(0x12));
  assert.doesNotThrow(() => p.dispose());
  assert.doesNotThrow(() => p.dispose(), "dispose is idempotent");
  assert.equal(p.ready, false);
});

test("play() of an unknown sample no-ops, and has() is false for it", () => {
  const p = new SamplePlayer();
  assert.equal(p.has("nope"), false);
  assert.equal(p.has(""), false);
  assert.equal(p.has(undefined), false);
  assert.equal(p.play("nope"), null);
  assert.equal(p.play(undefined), null);
  assert.equal(p.voiceCount, 0);
});

test("loadSample rejects junk without throwing, and never registers it", async () => {
  const p = new SamplePlayer();
  assert.equal(await p.loadSample("", bytes()), false, "a sample needs a name");
  assert.equal(await p.loadSample(null, bytes()), false);
  assert.equal(await p.loadSample("x", null), false);
  assert.equal(await p.loadSample("x", "sound.wav"), false, "URLs are not accepted");
  assert.equal(await p.loadSample("x", new ArrayBuffer(0)), false);
  assert.equal(p.has("x"), false);
  assert.deepEqual(p.sampleNames(), []);
});

test("loadSample accepts an already-decoded AudioBuffer, no context needed", async () => {
  const p = new SamplePlayer();
  assert.equal(await p.loadSample("boom", fakeAudioBuffer()), true);
  assert.equal(p.has("boom"), true);
  assert.equal(p.play("boom"), null, "still silent — there is no context to play through");
});

test("masterGain and muted track state and clamp, with or without a context", () => {
  const p = new SamplePlayer({ masterGain: 9 });
  assert.equal(p.masterGain, MAX_GAIN, "constructor gain is clamped");

  assert.equal(p.setMasterGain(0.25), 0.25);
  assert.equal(p.masterGain, 0.25);
  assert.equal(p.setMasterGain(-1), 0);
  assert.equal(p.setMasterGain(0.5), 0.5);
  assert.equal(p.setMasterGain(NaN), 0.5, "junk leaves the gain untouched");
  assert.equal(p.setMasterGain("loud"), 0.5);

  assert.equal(p.setMuted(true), true);
  assert.equal(p.muted, true);
  assert.equal(p.enabled, false);
  assert.equal(p.masterGain, 0.5, "muting preserves the gain setting");
  p.setMuted(0);
  assert.equal(p.muted, false, "muted is coerced to a boolean");

  p.setEnabled(false);
  assert.equal(p.muted, true, "setEnabled(false) is setMuted(true)");
  p.setEnabled(true);
  assert.equal(p.muted, false);
  assert.equal(p.enabled, true);
});

test("the constructor tolerates junk options and preloads samples", async () => {
  assert.doesNotThrow(() => new SamplePlayer(null));
  assert.doesNotThrow(() => new SamplePlayer("nonsense"));

  const p = new SamplePlayer({
    samples: { boom: fakeAudioBuffer(), bad: "not audio" },
    triggerMap: { 0x0a: "boom" },
  });
  assert.equal(p.has("boom"), true, "preloaded samples register synchronously");
  assert.equal(p.has("bad"), false, "junk preloads are dropped, not thrown");
  assert.deepEqual(p.triggerMap, { 10: "boom" });
});

test("trigger() maps sound-command values to samples and ignores unmapped ones", () => {
  const p = new SamplePlayer({ triggerMap: { 3: "jump", 4: { sample: "bgm", loop: true } } });
  assert.equal(p.trigger(3), null, "no context ⇒ silence, not a crash");
  assert.equal(p.trigger(4), null);
  assert.equal(p.trigger(0x99), null, "unmapped command value");
  assert.equal(p.trigger(undefined), null);

  const bare = new SamplePlayer();
  bare.triggerMap = null;
  assert.equal(bare.trigger(1), null, "even a nulled trigger map cannot throw");
});

// ---------------------------------------------------------------------------
// Playback, through the injected fake context
// ---------------------------------------------------------------------------

test("init() builds the graph once and is safe to call repeatedly", async () => {
  const instances = [];
  const p = new SamplePlayer({ audioContext: fakeContextClass({ instances }), masterGain: 0.4 });
  assert.equal(p.ready, false, "not ready before init()");

  assert.equal(await p.init(), true);
  assert.equal(p.ready, true);
  assert.equal(instances.length, 1);
  const ctx = instances[0];
  assert.equal(ctx.gains.length, 1, "one master gain");
  assert.equal(ctx.gains[0].gain.value, 0.4, "master node carries the configured gain");
  assert.deepEqual(ctx.gains[0].outputs, [ctx.destination]);

  assert.equal(await p.init(), true);
  assert.equal(instances.length, 1, "a second init() reuses the context");

  const [first, second] = await Promise.all([p.init(), p.init()]);
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(instances.length, 1, "concurrent init() calls do not race a second context");
});

test("init() resumes a suspended context (the user-gesture path)", async () => {
  const instances = [];
  const p = new SamplePlayer({ audioContext: fakeContextClass({ state: "suspended", instances }) });
  assert.equal(await p.init(), true);
  assert.equal(instances[0].resumes, 1);
  assert.equal(instances[0].state, "running");
});

test("a context that cannot be constructed or resumed degrades to silence", async () => {
  const dead = new SamplePlayer({ audioContext: fakeContextClass({ throwOnNew: true }) });
  assert.equal(await dead.init(), false, "constructor throwing must not escape");
  assert.equal(dead.ready, false);
  await dead.loadSample("jump", bytes());
  assert.equal(dead.play("jump"), null);

  const blocked = new SamplePlayer({
    audioContext: fakeContextClass({ state: "suspended", resumeRejects: true }),
  });
  assert.equal(await blocked.init(), true, "the context exists even though autoplay is blocked");
  await blocked.loadSample("jump", bytes());
  assert.equal(blocked.play("jump"), null, "suspended ⇒ quiet no-op, no throw");
  assert.equal(blocked.voiceCount, 0);
});

test("samples loaded before init() are decoded when the context arrives", async () => {
  const p = new SamplePlayer({ audioContext: fakeContextClass() });
  assert.equal(await p.loadSample("jump", bytes()), true);
  assert.equal(p.play("jump"), null, "undecoded ⇒ no voice");

  assert.equal(await p.init(), true);
  const voice = p.play("jump");
  assert.ok(voice, "decoded on init(), so it plays now");
  assert.equal(voice.source.buffer.tag, "decoded");
});

test("loadSample after init() decodes immediately, in promise or callback style", async () => {
  for (const decodeStyle of ["promise", "callback"]) {
    const p = new SamplePlayer({ audioContext: fakeContextClass({ decodeStyle }) });
    await p.init();
    assert.equal(await p.loadSample("jump", bytes()), true, decodeStyle);
    assert.ok(p.play("jump"), `${decodeStyle}: plays once decoded`);
  }
});

test("a failed decode unregisters the sample instead of throwing", async () => {
  const p = new SamplePlayer({ audioContext: fakeContextClass({ decodeFails: true }) });
  await p.init();
  assert.equal(await p.loadSample("junk", bytes()), false);
  assert.equal(p.has("junk"), false);
  assert.equal(p.play("junk"), null);
});

test("play() wires source → voice gain → master and starts the source", async () => {
  const instances = [];
  const p = new SamplePlayer({ audioContext: fakeContextClass({ instances }) });
  await p.init();
  await p.loadSample("jump", bytes());

  const ctx = instances[0];
  const master = ctx.gains[0];
  const voice = p.play("jump", { gain: 0.5 });
  assert.ok(voice);
  assert.equal(voice.name, "jump");
  assert.equal(voice.source.starts, 1);
  assert.equal(voice.gain.gain.value, 0.5);
  assert.deepEqual(voice.source.outputs, [voice.gain]);
  assert.deepEqual(voice.gain.outputs, [master]);
  assert.equal(p.voiceCount, 1);

  assert.equal(p.play("jump", { gain: NaN }).gain.gain.value, 1, "a junk voice gain falls back");
  assert.equal(p.play("jump", null).gain.gain.value, 1, "junk options object tolerated");
});

test("overlapping one-shots of the same sample get independent voices", async () => {
  const p = new SamplePlayer({ audioContext: fakeContextClass() });
  await p.init();
  await p.loadSample("blip", bytes());

  const a = p.play("blip"), b = p.play("blip"), c = p.play("blip");
  assert.equal(p.voiceCount, 3);
  assert.notEqual(a.source, b.source);
  assert.notEqual(b.source, c.source);

  b.source.finish(); // the middle one ends naturally
  assert.equal(p.voiceCount, 2, "onended reaps the finished voice");
  assert.equal(b.source.disconnects, 1, "and disconnects its nodes");
});

test("stop() ends every voice of one sample and leaves the others alone", async () => {
  const p = new SamplePlayer({ audioContext: fakeContextClass() });
  await p.init();
  await p.loadSample("blip", bytes());
  await p.loadSample("bgm", bytes());

  const a = p.play("blip"), b = p.play("blip"), keep = p.play("bgm", { loop: true });
  assert.equal(p.voiceCount, 3);

  p.stop("blip");
  assert.equal(a.source.stops, 1);
  assert.equal(b.source.stops, 1);
  assert.equal(keep.source.stops, 0, "an unrelated sample keeps playing");
  assert.equal(p.voiceCount, 1);

  assert.doesNotThrow(() => p.stop("blip"), "stopping an already-stopped sample is a no-op");
  assert.doesNotThrow(() => p.stop("never-loaded"));
});

test("looping voices set loop and stop cleanly", async () => {
  const p = new SamplePlayer({ audioContext: fakeContextClass() });
  await p.init();
  await p.loadSample("bgm", bytes());

  const bgm = p.play("bgm", { loop: true });
  assert.equal(bgm.source.loop, true);
  assert.equal(bgm.loop, true);
  assert.equal(p.voiceCount, 1);

  bgm.stop();
  assert.equal(bgm.source.stops, 1);
  assert.equal(bgm.source.onended, null, "the ended handler is detached before stopping");
  assert.equal(bgm.source.disconnects, 1);
  assert.equal(p.voiceCount, 0);

  bgm.stop();
  assert.equal(bgm.source.stops, 1, "the handle's stop() is idempotent");
});

test("stopAll() silences everything", async () => {
  const p = new SamplePlayer({ audioContext: fakeContextClass() });
  await p.init();
  await p.loadSample("a", bytes());
  await p.loadSample("b", bytes());

  const voices = [p.play("a"), p.play("a"), p.play("b", { loop: true })];
  assert.equal(p.voiceCount, 3);
  p.stopAll();
  assert.equal(p.voiceCount, 0);
  for (const v of voices) assert.equal(v.source.stops, 1);
  assert.doesNotThrow(() => p.stopAll());
});

test("the voice cap evicts and stops the oldest one-shot", async () => {
  const p = new SamplePlayer({ audioContext: fakeContextClass(), maxVoices: 2 });
  await p.init();
  await p.loadSample("blip", bytes());

  const a = p.play("blip"), b = p.play("blip");
  const c = p.play("blip");
  assert.equal(p.voiceCount, 2, "never exceeds the cap");
  assert.equal(a.source.stops, 1, "the oldest voice was stopped, not leaked");
  assert.equal(b.source.stops, 0);
  assert.ok(c, "the new voice still plays");
});

test("masterGain and mute drive the master node live", async () => {
  const instances = [];
  const p = new SamplePlayer({ audioContext: fakeContextClass({ instances }) });
  await p.init();
  const master = instances[0].gains[0];

  p.setMasterGain(0.25);
  assert.equal(master.gain.value, 0.25);
  p.setMuted(true);
  assert.equal(master.gain.value, 0, "mute forces the node to silence");
  assert.equal(p.masterGain, 0.25, "…while remembering the setting");
  p.setMasterGain(0.75);
  assert.equal(master.gain.value, 0, "still muted");
  p.setMuted(false);
  assert.equal(master.gain.value, 0.75, "unmuting restores the current gain");
});

test("a muted player still plays voices, silenced at the master node", async () => {
  const instances = [];
  const p = new SamplePlayer({ audioContext: fakeContextClass({ instances }), muted: true });
  await p.init();
  await p.loadSample("blip", bytes());
  assert.equal(instances[0].gains[0].gain.value, 0);

  const v = p.play("blip");
  assert.ok(v, "voices are still scheduled so unmuting mid-sound works");
  assert.equal(p.voiceCount, 1);
});

test("trigger() plays through the map, honouring loop/gain entries", async () => {
  const p = new SamplePlayer({
    audioContext: fakeContextClass(),
    triggerMap: { 0x03: "jump", 0x04: { sample: "bgm", loop: true, gain: 0.5 }, 0x05: "missing", 0x06: 42 },
  });
  await p.init();
  await p.loadSample("jump", bytes());
  await p.loadSample("bgm", bytes());

  const jump = p.trigger(0x03);
  assert.ok(jump);
  assert.equal(jump.name, "jump");
  assert.equal(jump.loop, false);

  const bgm = p.trigger(0x04);
  assert.equal(bgm.name, "bgm");
  assert.equal(bgm.loop, true);
  assert.equal(bgm.gain.gain.value, 0.5);

  assert.equal(p.trigger(0x05), null, "mapped to a sample that never loaded");
  assert.equal(p.trigger(0x06), null, "a malformed map entry is ignored");
  assert.equal(p.trigger(0xff), null, "unmapped");
});

test("unload() forgets a sample and stops its voices", async () => {
  const p = new SamplePlayer({ audioContext: fakeContextClass() });
  await p.init();
  await p.loadSample("blip", bytes());
  const v = p.play("blip");

  assert.equal(p.unload("blip"), true);
  assert.equal(v.source.stops, 1);
  assert.equal(p.has("blip"), false);
  assert.equal(p.play("blip"), null);
  assert.equal(p.unload("blip"), false);
});

test("dispose() closes the context, and a later init() restores the samples", async () => {
  const instances = [];
  const p = new SamplePlayer({ audioContext: fakeContextClass({ instances }) });
  await p.init();
  await p.loadSample("blip", bytes());
  const v = p.play("blip");

  p.dispose();
  assert.equal(v.source.stops, 1, "voices are stopped on dispose");
  assert.equal(instances[0].closes, 1);
  assert.equal(p.ready, false);
  assert.equal(p.voiceCount, 0);
  assert.equal(p.has("blip"), true, "the sample is remembered…");
  assert.equal(p.play("blip"), null, "…but silent until there is a context again");

  assert.equal(await p.init(), true);
  assert.equal(instances.length, 2, "a fresh context");
  assert.ok(p.play("blip"), "re-decoded from the retained bytes");
});

test("a caller's ArrayBuffer survives loading (decodeAudioData detaches its input)", async () => {
  const p = new SamplePlayer({ audioContext: fakeContextClass() });
  await p.init();
  const src = new Uint8Array([9, 8, 7, 6]);
  await p.loadSample("blip", src);
  assert.deepEqual([...src], [9, 8, 7, 6], "the caller's bytes are untouched");
  assert.ok(p.play("blip"));
});
