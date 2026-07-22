// SPDX-License-Identifier: GPL-3.0-only
/**
 * core/audio.js — `SamplePlayer`, the generic sample-playback engine.
 *
 * ## Audio sits ABOVE the emulation. On purpose.
 *
 * We do not emulate sound hardware. No sound CPU, no discrete sound circuits,
 * no DACs — none of it is simulated. Instead a *board* observes the program's
 * writes to its sound-command latches and hands each command value to a
 * `SamplePlayer`, which plays a pre-recorded sample of the real machine.
 *
 * Why:
 *
 *   1. **The pixel gate stays sound-free.** This project's correctness proof is
 *      a pixel-exact diff against MAME, so emulation must be deterministic and
 *      frame-accurate. Audio is wall-clock, host-dependent and asynchronous.
 *      Keeping it strictly outside the emulated machine means audio can never
 *      perturb — or be blamed for — a frame diff.
 *   2. **Cost/benefit.** A second CPU core plus analogue circuit modelling is a
 *      large, separately-validated body of work whose only observable output is
 *      sound a listener cannot A/B against the original anyway. Samples get
 *      nearly all of the perceived fidelity for nearly none of the risk.
 *   3. **It is swappable.** Any game on any board reuses this file; a game
 *      contributes only data (a trigger map + assets), never engine code. If a
 *      real sound-chip emulation is ever wanted it drops in behind the same
 *      `trigger()` seam, without touching the CPU/board/video path.
 *
 * ## Layering
 *
 * This module is game-agnostic: nothing here knows about any particular romset,
 * board, sound command or sample name, and it imports nothing at all (see
 * core/README.md — `core/` never imports from `boards/` or `games/`). A game
 * supplies `{ triggerMap, samples }` from `games/<x>/audio/`.
 *
 * ## The never-throw contract
 *
 * Audio is optional garnish; the game must run identically without it. Every
 * method is a safe no-op when there is no usable AudioContext — in Node, in a
 * browser without WebAudio, before the user gesture that unblocks autoplay, or
 * for a sample that never loaded. Silence is an acceptable outcome; an
 * exception escaping into the engine is not. Nothing here throws, and nothing
 * logs on the ordinary "no audio available" paths.
 *
 * Zero dependencies: native WebAudio only.
 */

/** Hard ceiling on any gain value we will hand to WebAudio. */
export const MAX_GAIN = 4;

/** Default cap on simultaneously-sounding voices, across all samples. */
export const DEFAULT_MAX_VOICES = 32;

/**
 * Coerce anything into a gain value WebAudio will accept.
 *
 * `AudioParam.value = NaN` throws, and a negative or huge gain is a bug
 * amplifier, so every gain crossing into WebAudio goes through here first.
 *
 * `null`/`undefined`/`""` mean "unset" and take the fallback — deliberately not
 * `Number(null) === 0`, since an omitted option must not silence a sound.
 *
 * @param {*} value candidate gain
 * @param {number} [fallback] used when `value` is not a finite number
 * @returns {number} a finite number in [0, MAX_GAIN]
 */
export function clampGain(value, fallback = 1) {
  const safe = Number.isFinite(fallback) ? fallback : 1;
  if (value === null || value === undefined || value === "") return safe;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return safe;
  if (n < 0) return 0;
  if (n > MAX_GAIN) return MAX_GAIN;
  return n;
}

/**
 * Find the AudioContext constructor on a global-ish scope, or null if this host
 * has no WebAudio (Node, jsdom, ancient browsers).
 *
 * @param {object} [scope] defaults to `globalThis`
 * @returns {Function|null}
 */
export function resolveAudioContextCtor(scope = globalThis) {
  if (!scope || typeof scope !== "object") return null;
  const Ctor = scope.AudioContext || scope.webkitAudioContext;
  return typeof Ctor === "function" ? Ctor : null;
}

/**
 * Duck-type test for a decoded AudioBuffer, so a caller may hand us one directly
 * and skip decoding (and so tests can substitute a stand-in).
 *
 * @param {*} v
 * @returns {boolean}
 */
export function isAudioBufferLike(v) {
  if (!v || typeof v !== "object") return false;
  const AB = globalThis.AudioBuffer;
  if (typeof AB === "function" && v instanceof AB) return true;
  return typeof v.getChannelData === "function"
    && typeof v.sampleRate === "number"
    && typeof v.length === "number";
}

/**
 * Normalise encoded audio input to a *detachable copy* of its bytes, or null if
 * this is not encoded audio.
 *
 * The copy matters: `decodeAudioData()` takes ownership of the ArrayBuffer it is
 * given and detaches it, which would silently destroy the caller's buffer — and
 * any chance of re-decoding it after a `dispose()` / `init()` cycle.
 *
 * @param {*} data ArrayBuffer, TypedArray or DataView
 * @returns {ArrayBuffer|null}
 */
export function toEncodedBytes(data) {
  if (data instanceof ArrayBuffer) return data.byteLength ? data.slice(0) : null;
  if (ArrayBuffer.isView(data)) {
    if (!data.byteLength) return null;
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return null;
}

/**
 * Voice bookkeeping — pure, no WebAudio.
 *
 * Voices live in insertion order (Map iteration order), so "oldest" is simply
 * "first". Kept separate from the player so the accounting is testable on a host
 * with no audio at all.
 */
export class VoiceRegistry {
  /** @param {number} [maxVoices] */
  constructor(maxVoices = DEFAULT_MAX_VOICES) {
    const n = Math.floor(Number(maxVoices));
    this.maxVoices = Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_VOICES;
    this._voices = new Map(); // id -> voice, insertion-ordered
    this._nextId = 1;
  }

  get size() { return this._voices.size; }

  /**
   * Register a voice, assigning it an id.
   *
   * @param {{name: string, loop?: boolean}} voice
   * @returns {object|null} a voice evicted to stay under the cap (the caller
   *   must tear it down), or null
   */
  add(voice) {
    if (!voice || typeof voice !== "object") return null;
    let evicted = null;
    if (this._voices.size >= this.maxVoices) {
      evicted = this.oldestEvictable();
      if (evicted) this._voices.delete(evicted.id);
    }
    voice.id = this._nextId++;
    this._voices.set(voice.id, voice);
    return evicted;
  }

  /**
   * The voice to sacrifice when at the cap: the oldest *one-shot*, because
   * dropping a looping cue (background music, a siren) is far more noticeable
   * than dropping one of many overlapping blips. Falls back to the oldest voice
   * overall when every voice loops.
   *
   * @returns {object|null}
   */
  oldestEvictable() {
    let oldest = null;
    for (const v of this._voices.values()) {
      if (oldest === null) oldest = v;
      if (!v.loop) return v;
    }
    return oldest;
  }

  /** @param {object|number} voiceOrId @returns {boolean} true if it was present */
  remove(voiceOrId) {
    const id = typeof voiceOrId === "number" ? voiceOrId : voiceOrId && voiceOrId.id;
    if (id == null) return false;
    return this._voices.delete(id);
  }

  /** @param {string} name @returns {object[]} snapshot — safe to mutate while iterating */
  byName(name) {
    const out = [];
    for (const v of this._voices.values()) if (v.name === name) out.push(v);
    return out;
  }

  /** @returns {object[]} snapshot of every live voice, oldest first */
  all() { return [...this._voices.values()]; }

  /** Empty the registry. @returns {object[]} the voices that were in it */
  clear() {
    const out = this.all();
    this._voices.clear();
    return out;
  }
}

/**
 * Decode encoded audio bytes, tolerating both the promise-returning and the
 * legacy callback-only forms of `decodeAudioData`.
 *
 * @param {*} ctx
 * @param {ArrayBuffer} bytes
 * @returns {Promise<*>} resolves to an AudioBuffer; rejects on failure
 */
function decodeAudioBytes(ctx, bytes) {
  return new Promise((resolve, reject) => {
    let ret;
    try {
      ret = ctx.decodeAudioData(bytes, resolve, reject);
    } catch (err) {
      reject(err);
      return;
    }
    if (ret && typeof ret.then === "function") ret.then(resolve, reject);
  });
}

/**
 * A game-agnostic WebAudio sample player.
 *
 * Typical use:
 *
 *   const player = new SamplePlayer({ masterGain: 0.8, triggerMap });
 *   await player.loadSample("jump", jumpBytes);  // fine before init()
 *   button.onclick = () => player.init();        // user gesture unblocks autoplay
 *   ...
 *   player.trigger(cmdByte);                     // from the board's latch write
 */
export class SamplePlayer {
  /**
   * @param {object} [opts]
   * @param {number} [opts.masterGain=1] master volume, clamped to [0, MAX_GAIN]
   * @param {boolean} [opts.muted=false]
   * @param {number} [opts.maxVoices=32] cap on simultaneous voices
   * @param {object} [opts.samples] { name: ArrayBuffer|AudioBuffer } to preload
   * @param {object} [opts.triggerMap] { soundCommandValue: name | {sample,loop,gain} }
   * @param {Function} [opts.audioContext] AudioContext constructor override — an
   *   injection seam for tests and unusual hosts. Defaults to the global one.
   */
  constructor(opts = {}) {
    const o = opts && typeof opts === "object" ? opts : {};
    this._masterGain = clampGain(o.masterGain, 1);
    this._muted = !!o.muted;
    this._ctxCtor = typeof o.audioContext === "function" ? o.audioContext : null;
    this._ctx = null;
    this._master = null;
    this._initPromise = null;
    this._initTried = false;  // init() called at least once ⇒ we have had a gesture
    this._resuming = false;
    this._samples = new Map(); // name -> { buffer: AudioBuffer|null, encoded: ArrayBuffer|null }
    this._voices = new VoiceRegistry(o.maxVoices);

    /** { soundCommandValue: sampleName | {sample, loop, gain} } — supplied by the game. */
    this.triggerMap = o.triggerMap && typeof o.triggerMap === "object" ? { ...o.triggerMap } : {};

    const preload = o.samples && typeof o.samples === "object" ? o.samples : {};
    for (const name of Object.keys(preload)) {
      // Registers synchronously; any decode happens (or is deferred) inside.
      void this.loadSample(name, preload[name]);
    }
  }

  // ---------------------------------------------------------------- lifecycle

  /** @returns {boolean} true when a live (non-closed) AudioContext exists */
  get ready() {
    return !!this._ctx && this._ctx.state !== "closed";
  }

  /**
   * Create (or resume) the AudioContext.
   *
   * Browsers only permit this from a user gesture, so call it from a click or
   * key handler. Safe to call any number of times, concurrently, and after
   * `dispose()`. Never throws — returns false if audio is unavailable.
   *
   * @returns {Promise<boolean>} whether audio is now usable
   */
  async init() {
    this._initTried = true;
    if (this._ctx && this._ctx.state !== "closed") {
      await this._resume();
      return this.ready;
    }
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._createContext();
    try {
      return await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  /** Stop everything and release the AudioContext. Safe to call twice. */
  dispose() {
    this.stopAll();
    const ctx = this._ctx;
    const master = this._master;
    this._ctx = null;
    this._master = null;
    this._initTried = false;
    this._resuming = false;
    if (master) { try { master.disconnect(); } catch { /* ignore */ } }
    if (ctx && typeof ctx.close === "function" && ctx.state !== "closed") {
      try {
        const p = ctx.close();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch { /* ignore */ }
    }
    // Buffers decoded by the dead context are dropped, but the encoded bytes are
    // retained so a later init() silently restores every sample.
    for (const rec of this._samples.values()) {
      if (rec.encoded) rec.buffer = null;
    }
  }

  // ------------------------------------------------------------------ samples

  /**
   * Register a sample under `name`.
   *
   * `data` is either encoded audio (ArrayBuffer / TypedArray / DataView — the
   * bytes of a .wav/.mp3/.ogg) or an already-decoded AudioBuffer. Fetching bytes
   * over the network is the caller's job; core stays free of network policy.
   *
   * Calling this before `init()` is fine and expected: the bytes are held and
   * decoded as soon as a context exists.
   *
   * @param {string} name
   * @param {ArrayBuffer|ArrayBufferView|AudioBuffer} data
   * @returns {Promise<boolean>} true if the sample is registered (decoded, or
   *   awaiting a context); false if the input was unusable or decoding failed
   */
  async loadSample(name, data) {
    if (typeof name !== "string" || name === "") return false;

    if (isAudioBufferLike(data)) {
      this._samples.set(name, { buffer: data, encoded: null });
      return true;
    }

    const encoded = toEncodedBytes(data);
    if (!encoded) return false;

    // Register immediately so has()/trigger stay consistent right away.
    const rec = { buffer: null, encoded };
    this._samples.set(name, rec);

    if (!this._ctx || typeof this._ctx.decodeAudioData !== "function") return true;
    return this._decodeInto(name, rec);
  }

  /** @param {string} name @returns {boolean} is a sample registered under this name? */
  has(name) { return this._samples.has(name); }

  /** @returns {string[]} every registered sample name */
  sampleNames() { return [...this._samples.keys()]; }

  /** Forget a sample, stopping any of its voices. @param {string} name */
  unload(name) {
    this.stop(name);
    return this._samples.delete(name);
  }

  // ---------------------------------------------------------------- playback

  /**
   * Play a sample. Overlapping one-shots of the same name are supported: every
   * call is an independent voice.
   *
   * No-ops (returning null) when audio is unavailable, when the context is
   * suspended (autoplay not yet unblocked), or when the sample is unknown or
   * not yet decoded.
   *
   * @param {string} name
   * @param {{loop?: boolean, gain?: number}} [opts]
   * @returns {object|null} a voice handle carrying `.stop()`, or null
   */
  play(name, opts = {}) {
    const o = opts && typeof opts === "object" ? opts : {};
    const rec = this._samples.get(name);
    if (!rec || !rec.buffer) return null;

    const ctx = this._ctx;
    const master = this._master;
    if (!ctx || !master || ctx.state === "closed") return null;
    if (ctx.state !== "running") {
      // Autoplay-blocked or backgrounded: stay silent, and quietly try to
      // resume — but only once init() has been called, so we never poke a
      // blocked context before the user gesture and never draw a console warning.
      this._nudgeResume();
      return null;
    }

    let voice = null;
    try {
      const source = ctx.createBufferSource();
      source.buffer = rec.buffer;
      source.loop = !!o.loop;
      const gain = ctx.createGain();
      gain.gain.value = clampGain(o.gain, 1);
      source.connect(gain);
      gain.connect(master);

      voice = { id: 0, name, source, gain, loop: !!o.loop, stopped: false, stop: null };
      voice.stop = () => this._teardown(voice);

      const evicted = this._voices.add(voice);
      if (evicted) this._teardown(evicted);

      source.onended = () => {
        voice.stopped = true;
        this._voices.remove(voice);
        this._disconnect(voice);
      };
      source.start();
      return voice;
    } catch {
      if (voice) this._teardown(voice);
      return null;
    }
  }

  /** Stop every voice of `name`. @param {string} name */
  stop(name) {
    for (const v of this._voices.byName(name)) this._teardown(v);
  }

  /** Stop every voice of every sample. */
  stopAll() {
    for (const v of this._voices.clear()) this._teardown(v);
  }

  /** @returns {number} voices currently sounding */
  get voiceCount() { return this._voices.size; }

  /**
   * The board seam: called with the value the program wrote to its sound-command
   * latch. Looks the value up in the game-supplied `triggerMap` and plays it.
   *
   * A map entry is either a sample name, or `{ sample, loop, gain }`.
   *
   * @param {number|string} commandValue
   * @returns {object|null} the voice handle, or null
   */
  trigger(commandValue) {
    const entry = this.triggerMap ? this.triggerMap[commandValue] : undefined;
    if (entry == null) return null;
    if (typeof entry === "string") return this.play(entry);
    if (typeof entry === "object" && typeof entry.sample === "string") {
      return this.play(entry.sample, { loop: entry.loop, gain: entry.gain });
    }
    return null;
  }

  // -------------------------------------------------------------------- mixer

  /** @returns {number} the master gain, ignoring mute */
  get masterGain() { return this._masterGain; }

  /** @param {number} g clamped to [0, MAX_GAIN]; junk leaves it unchanged */
  setMasterGain(g) {
    this._masterGain = clampGain(g, this._masterGain);
    this._applyGain();
    return this._masterGain;
  }

  /** @returns {boolean} */
  get muted() { return this._muted; }

  /**
   * Mute by forcing the master node to 0, which preserves the gain setting and
   * lets un-muting mid-sound do the obvious thing.
   *
   * @param {boolean} on
   */
  setMuted(on) {
    this._muted = !!on;
    this._applyGain();
    return this._muted;
  }

  /**
   * Back-compat with the original stub's on/off switch: `setEnabled(on)` is
   * exactly `setMuted(!on)`.
   */
  setEnabled(on) { this.setMuted(!on); return !this._muted; }

  /** @returns {boolean} the inverse of `muted` */
  get enabled() { return !this._muted; }

  // ----------------------------------------------------------------- internal

  /** @returns {number} the value the master node should carry right now */
  _effectiveGain() { return this._muted ? 0 : this._masterGain; }

  _applyGain() {
    const master = this._master;
    if (!master || !master.gain) return;
    try { master.gain.value = this._effectiveGain(); } catch { /* ignore */ }
  }

  /** @returns {Promise<boolean>} */
  async _createContext() {
    const Ctor = this._ctxCtor || resolveAudioContextCtor();
    if (!Ctor) return false;
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this._effectiveGain();
      master.connect(ctx.destination);
      this._ctx = ctx;
      this._master = master;
    } catch {
      this._ctx = null;
      this._master = null;
      return false;
    }
    await this._resume();
    await this._decodeAllPending();
    return this.ready;
  }

  async _resume() {
    const ctx = this._ctx;
    if (!ctx || typeof ctx.resume !== "function") return;
    if (ctx.state !== "suspended") return;
    try { await ctx.resume(); } catch { /* autoplay policy said no; stay silent */ }
  }

  /** Fire-and-forget resume attempt: at most one in flight, never before init(). */
  _nudgeResume() {
    if (!this._initTried || this._resuming) return;
    const ctx = this._ctx;
    if (!ctx || ctx.state !== "suspended" || typeof ctx.resume !== "function") return;
    this._resuming = true;
    Promise.resolve()
      .then(() => ctx.resume())
      .catch(() => {})
      .then(() => { this._resuming = false; });
  }

  /** @returns {Promise<boolean>} */
  async _decodeInto(name, rec) {
    try {
      const buffer = await decodeAudioBytes(this._ctx, rec.encoded.slice(0));
      if (!isAudioBufferLike(buffer)) throw new Error("decode produced no buffer");
      // A dispose()/unload() may have raced us; only publish if still ours.
      if (this._samples.get(name) === rec) rec.buffer = buffer;
      return true;
    } catch {
      if (this._samples.get(name) === rec && !rec.buffer) this._samples.delete(name);
      return false;
    }
  }

  async _decodeAllPending() {
    const ctx = this._ctx;
    if (!ctx || typeof ctx.decodeAudioData !== "function") return;
    const work = [];
    for (const [name, rec] of this._samples) {
      if (!rec.buffer && rec.encoded) work.push(this._decodeInto(name, rec));
    }
    if (work.length) await Promise.all(work);
  }

  _disconnect(voice) {
    try { voice.source.disconnect(); } catch { /* ignore */ }
    try { voice.gain.disconnect(); } catch { /* ignore */ }
  }

  _teardown(voice) {
    if (!voice) return;
    this._voices.remove(voice);
    if (voice.stopped) return;
    voice.stopped = true;
    try { voice.source.onended = null; } catch { /* ignore */ }
    try { voice.source.stop(); } catch { /* already stopped, or never started */ }
    this._disconnect(voice);
  }
}

export default SamplePlayer;
