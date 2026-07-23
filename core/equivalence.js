// SPDX-License-Identifier: GPL-3.0-only
/**
 * The equivalence engine — the game-agnostic gate every optimized/ routine must
 * pass before it is trusted to replace its translated/ oracle.
 *
 * It answers one question two ways: does running the OPTIMIZED routine leave the
 * machine in observably the same state as running the TRANSLATED original from
 * identical input?
 *
 *   • wholeMachineEquivalence — run the whole game N frames twice, once with the
 *     override wired and once without, and diff the full per-frame state trace.
 *     This is the strict gate: a TIMING divergence (an optimized routine that
 *     pushed the frame's work past the vblank spin) does not hide here, it
 *     surfaces as downstream state drift. RAM is the real contract.
 *
 *   • unitEquivalence — capture the machine at the instant the routine is first
 *     entered (via a dispatch OR a direct m.call), clone it, run translated vs
 *     optimized on the two clones, and diff state + the CPU registers. Faster, and
 *     it localizes a failure to the routine itself instead of to some frame downstream.
 *
 * Cycles are deliberately NOT compared: the ROM self-synchronises at its vblank
 * spin, so a routine's internal cycle distribution is unobservable as long as
 * the frame still reaches that spin — and a frame that DIDN'T reach it shows up
 * as a state divergence in the whole-machine trace.
 *
 * WHAT MAKES THIS GAME-AGNOSTIC. It knows nothing about any board's memory map,
 * IO fields, or which game it is running. The caller supplies a
 * `makeMachine(overrides)` factory that returns a machine for its game; the
 * engine drives that machine through the small contract every board's machine
 * already satisfies:
 *
 *   runFrames(n) -> array of per-frame state dumps (Uint8Array), one per boundary
 *   dumpState()  -> a single state dump (Uint8Array)
 *   clone()      -> a fresh machine restored to this one's observable state, with
 *                   its frame machinery neutralised (see the board's clone())
 *   stateOffsetToAddr(off) -> the RAM address a dump offset came from
 *   .regs, .overrides, .stoppedBy  (the register file, the dispatch override map,
 *                   and why a bounded run ended)
 *
 * The register field list comes from core/cpu/z80.js — the CPU's own definition
 * of its state — so the register diff is not a copy that can drift from it.
 */

import { REG_FIELDS } from "./cpu/z80.js";

// -- state-diff plumbing ----------------------------------------------------

/**
 * First differing byte between two dumps, or null when identical.
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @param {(off:number)=>number} [offsetToAddr]  maps a dump offset back to its
 *   RAM address for reporting; when omitted, `addr` is null. The board owns this
 *   map (memory.js), so the engine never hardcodes region bases.
 */
export function firstStateDiff(a, b, offsetToAddr) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return {
        offset: i,
        addr: offsetToAddr ? offsetToAddr(i) : null,
        a: a[i],
        b: b[i],
      };
    }
  }
  if (a.length !== b.length) {
    return { offset: n, addr: null, a: a.length, b: b.length };
  }
  return null;
}

/**
 * First differing register, or null when identical. Diffs exactly REG_FIELDS —
 * the CPU's own register file — so it stays in step with core/cpu/z80.js.
 */
export function firstRegDiff(a, b) {
  for (const k of REG_FIELDS) {
    if (a[k] !== b[k]) return { reg: k, a: a[k], b: b[k] };
  }
  return null;
}

// -- override map helpers ---------------------------------------------------

function normAddr(k) {
  return typeof k === "number" ? k : parseInt(k, 16);
}

function overrideEntries(overrides) {
  return overrides instanceof Map ? [...overrides.entries()] : Object.entries(overrides);
}

/**
 * A run that stopped short of the frames it was asked for, or that hit a stub,
 * never reached the vblank spin on some frame — exactly the overrun the gate
 * warns about. Announce it instead of silently comparing a truncated trace.
 */
function assertRunHealthy(m, capturedFrames, nFrames, label) {
  if (m.stoppedBy) {
    throw new Error(`${label} run stopped early: ${m.stoppedBy}`);
  }
  if (capturedFrames.length !== nFrames) {
    throw new Error(
      `${label} run captured ${capturedFrames.length}/${nFrames} frames — a frame ` +
        "did not reach the vblank spin",
    );
  }
}

// -- whole-machine equivalence ----------------------------------------------

/**
 * Run the game `nFrames` twice — baseline (overrides empty) and optimized (the
 * given overrides wired) — and diff the two per-frame state traces.
 *
 * @param {(overrides?:Map|object)=>object} makeMachine  factory returning a
 *   machine for the game under test; called with no argument for the baseline
 *   and with the wrapped override map for the optimized side.
 * @param {number} nFrames      frames to run each side
 * @param {object|Map} overrides  { targetAddr: optimizedFn } to wire on the
 *   optimized side. Each fn is wrapped with an invocation counter so an EQUAL
 *   result that never actually dispatched the override cannot pass vacuously.
 *   The wrapper forwards extra call args (`m.call(addr, ...args)`), matching the
 *   machine's raw override registration, so parameterized routines (draw_0578,
 *   sub_0028) are testable through this gate rather than needing a local wrapper.
 * @returns {object} { equal, framesCompared, invocations, ...firstDiff }
 */
export function wholeMachineEquivalence(makeMachine, nFrames, overrides) {
  // Baseline: the shipped path, overrides empty.
  const base = makeMachine();
  const baseFrames = base.runFrames(nFrames);
  assertRunHealthy(base, baseFrames, nFrames, "baseline");

  // Optimized side: wrap each override so we can prove it fired.
  const invocations = new Map();
  const wrapped = new Map();
  for (const [k, fn] of overrideEntries(overrides)) {
    const addr = normAddr(k);
    invocations.set(addr, 0);
    wrapped.set(addr, (mm, ...args) => {
      invocations.set(addr, invocations.get(addr) + 1);
      return fn(mm, ...args);
    });
  }
  const opt = makeMachine(wrapped);
  const optFrames = opt.runFrames(nFrames);
  assertRunHealthy(opt, optFrames, nFrames, "optimized");

  const offsetToAddr = (off) => base.stateOffsetToAddr(off);
  const framesCompared = Math.min(baseFrames.length, optFrames.length);
  for (let f = 0; f < framesCompared; f++) {
    const d = firstStateDiff(baseFrames[f], optFrames[f], offsetToAddr);
    if (d) {
      return {
        equal: false,
        frame: f,
        addr: d.addr,
        offset: d.offset,
        baseline: d.a,
        optimized: d.b,
        framesCompared,
        invocations,
      };
    }
  }
  return { equal: true, framesCompared, invocations };
}

// -- unit equivalence -------------------------------------------------------

/**
 * Prove translated vs optimized equal for ONE routine, in isolation.
 *
 * Captures the live machine at the instant `target` is first entered (via a
 * temporary override that snapshots on entry, then delegates to the translated
 * routine so the host run continues to a clean stop), then runs the translated
 * and optimized implementations on two independent clones of that entry state
 * and diffs the result.
 *
 * The snapshot override is installed at CONSTRUCTION (passed through
 * `makeMachine`), not mutated onto the machine afterward. That matters because a
 * routine reached only by a direct call — `m.call(target)` — resolves through the
 * registry built at construction, which a post-construction `overrides` mutation
 * would not touch; it would be caught only if `target` were a dispatch point.
 * Constructing with the override makes BOTH the dispatch consult and `m.call`
 * resolve to it, so the entry is captured however the routine is first entered
 * (this is the same construction-time wiring the whole-machine gate already uses).
 *
 * @param {(overrides?:Map|object)=>object} makeMachine  factory returning a
 *   machine for the game under test; called with the snapshot override so it is
 *   wired into the machine's routine registry at construction.
 * @param {number} target      address of the routine (e.g. 0x01c3)
 * @param {function} translatedFn  the oracle implementation
 * @param {function} optimizedFn   the implementation under test
 * @param {object} [opts]      { maxFrames = 240 } — how long to run to reach the
 *                             first entry of `target`
 * @returns {object} { equal, ram, regs, pc }
 */
export function unitEquivalence(makeMachine, target, translatedFn, optimizedFn, opts = {}) {
  const maxFrames = opts.maxFrames ?? 240;

  let entry = null;
  const snapshot = new Map([[target, (mm) => {
    if (entry === null) entry = mm.clone(); // pristine entry state
    return translatedFn(mm); // let the host game proceed normally
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  if (entry === null) {
    throw new Error(
      `unit harness: 0x${target.toString(16).padStart(4, "0")} never entered ` +
        `(neither dispatched nor m.call'd) within ${maxFrames} frames`,
    );
  }

  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized
  translatedFn(a);
  optimizedFn(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return {
    equal: !ram && !regs,
    ram,
    regs,
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
  };
}

// -- convergent (relaxed) equivalence ---------------------------------------

/**
 * The RELAXED gate. PIXELS are the ground truth; internal state may diverge
 * TRANSIENTLY as long as it RECONVERGES. PERSISTENT (non-healing) divergence in
 * either the compared state or the pixels FAILS. This is the gate for licensing a
 * cycle-collapse of an interruptible routine, where the strict byte-exact gate
 * false-fails on benign, self-healing differences:
 *
 *   - dead STACK scratch: the NMI's pushed PC lands in popped stack memory that is
 *     read only after a matching push overwrites it — excluded via `excludeAddr`.
 *   - a sub-perceptible RASTER tear: when the collapse services the vblank NMI a
 *     scanline late, a few pixels render stale for ONE frame, then heal (measured
 *     on sub_0350: 10 px total over 1400 frames, 3 isolated single-frame tears).
 *
 * Real corruption does NOT reconverge — the game state forks and stays forked —
 * which is exactly what "persistent" catches. The bias is toward FAILING: any
 * divergence still present in the final `tailWindow` frames fails, so a benign
 * tail tear fails safe (re-run longer) rather than a real fork passing.
 *
 * The caller MUST enable video (`captureVideo`) in `makeMachine` for the pixel
 * gate. This function stays game-agnostic: the caller supplies the game's stack
 * region via `excludeAddr` and (optionally) an address→name map for reporting.
 *
 * @param {(overrides?:Map|object)=>object} makeMachine  factory (video-enabled)
 * @param {number} nFrames
 * @param {object|Map} overrides   { addr: optimizedFn }
 * @param {object} [opts]
 * @param {(addr:number)=>boolean} [opts.excludeAddr]  skip these in the state diff
 *   (the dead stack scratch); default excludes nothing.
 * @param {number} [opts.tailWindow=20]  final frames that must be fully converged.
 * @param {(addr:number)=>string} [opts.name]  addr→name for reporting.
 * @returns {object} { pass, invocations, framesCompared, statePersistent,
 *   pixelPersistent, transientStateAddrs, pixDiffFrames, maxPixels, lastPixDiff }
 */
export function convergentEquivalence(makeMachine, nFrames, overrides, opts = {}) {
  const excludeAddr = opts.excludeAddr ?? (() => false);
  const tailWindow = opts.tailWindow ?? 20;
  const nameOf = opts.name ?? ((a) => "0x" + a.toString(16));

  const base = makeMachine();
  const baseFrames = base.runFrames(nFrames);
  assertRunHealthy(base, baseFrames, nFrames, "baseline");
  const baseVideo = base.videoFrames ?? [];

  const invocations = new Map();
  const wrapped = new Map();
  for (const [k, fn] of overrideEntries(overrides)) {
    const addr = normAddr(k);
    invocations.set(addr, 0);
    wrapped.set(addr, (mm, ...args) => {
      invocations.set(addr, invocations.get(addr) + 1);
      return fn(mm, ...args);
    });
  }
  const opt = makeMachine(wrapped);
  const optFrames = opt.runFrames(nFrames);
  assertRunHealthy(opt, optFrames, nFrames, "optimized");
  const optVideo = opt.videoFrames ?? [];

  const F = Math.min(baseFrames.length, optFrames.length);
  const offToAddr = (o) => base.stateOffsetToAddr(o);

  // PIXELS are the ground truth — they must be captured, or the gate is meaningless.
  // Refuse to run rather than silently pass a pixel-only divergence (review finding).
  if (base.videoFrames.length === 0 || opt.videoFrames.length === 0) {
    throw new Error(
      "convergentEquivalence: no video frames captured — the caller MUST enable " +
        "captureVideo. Pixels are the ground truth and cannot be silently skipped.",
    );
  }
  // Need a genuine tail to observe reconvergence; too short a run classes every diff
  // as persistent (fail-safe) but is not a real convergence test.
  if (F <= tailWindow) {
    throw new Error(
      `convergentEquivalence: nFrames (${F}) must exceed tailWindow (${tailWindow}) ` +
        "to observe reconvergence — run more frames.",
    );
  }

  // STATE: last frame each non-excluded address differed on.
  const lastStateDiff = new Map();
  for (let f = 0; f < F; f++) {
    const a = baseFrames[f], b = optFrames[f];
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] === b[i]) continue;
      const addr = offToAddr(i);
      if (excludeAddr(addr)) continue;
      lastStateDiff.set(addr, f);
    }
  }

  // PIXELS: last frame pixels differed on (a pixel = 3 RGB bytes).
  const vN = Math.min(baseVideo.length, optVideo.length);
  let lastPixDiff = -1, pixDiffFrames = 0, maxPixels = 0;
  for (let f = 0; f < vN; f++) {
    const a = baseVideo[f], b = optVideo[f];
    let d = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 3) {
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) d++;
    }
    if (d) { lastPixDiff = f; pixDiffFrames++; if (d > maxPixels) maxPixels = d; }
  }

  const stateCutoff = F - tailWindow;
  const statePersistent = [...lastStateDiff.entries()]
    .filter(([, lf]) => lf >= stateCutoff)
    .map(([a, lf]) => ({ addr: a, name: nameOf(a), lastFrame: lf }));
  const pixelPersistent = vN > 0 && lastPixDiff >= vN - tailWindow;

  return {
    pass: statePersistent.length === 0 && !pixelPersistent,
    invocations,
    framesCompared: F,
    statePersistent,                                  // FAIL if nonempty (non-healing state)
    pixelPersistent,                                  // FAIL if true (non-healing pixels)
    transientStateAddrs: lastStateDiff.size - statePersistent.length, // healed (tolerated)
    pixDiffFrames, maxPixels, lastPixDiff, videoCompared: vN,
  };
}
