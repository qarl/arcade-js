// SPDX-License-Identifier: GPL-3.0-only
/**
 * The equivalence engine — the game-agnostic gate an optimized/ routine passes before replacing its
 * translated/ oracle: does the OPTIMIZED routine leave observably the same state as the TRANSLATED
 * original from identical input? RAM is the contract; cycles are NOT compared (the ROM self-syncs at
 * its vblank spin). The caller supplies a `makeMachine(overrides)` factory; register fields come from
 * core/cpu/z80.js so the diff can't drift from the CPU's own state.
 */

import { REG_FIELDS } from "./cpu/z80.js";

// -- state-diff plumbing ----------------------------------------------------

/** First differing byte between two dumps, or null when identical. `offsetToAddr` (board-owned) maps
 * an offset to its RAM address for reporting; `excludeAddr` skips addresses (dead stack scratch). */
export function firstStateDiff(a, b, offsetToAddr, excludeAddr) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    if (excludeAddr && offsetToAddr && excludeAddr(offsetToAddr(i))) continue;
    return {
      offset: i,
      addr: offsetToAddr ? offsetToAddr(i) : null,
      a: a[i],
      b: b[i],
    };
  }
  if (a.length !== b.length) {
    return { offset: n, addr: null, a: a.length, b: b.length };
  }
  return null;
}

/** Excludes only stack scratch BELOW the caller's live frame: `liveFloor` is the lowest live stack address at
 * entry (Z80/8080: SP; 6502: 0x100 + S + 1). Cells from it up are compared, so a write into the caller's
 * frame is heard; only the pushes a routine makes below it are skipped. */
export function deadStackBelow(scratch, liveFloor) {
  const top = Math.min(liveFloor, scratch.hi);
  return (addr) => addr != null && addr >= scratch.lo && addr < top;
}

/** First differing register (exactly REG_FIELDS, the CPU's own file), or null when identical. */
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

/** A run that stopped short or hit a stub never reached the vblank spin on some frame — announce it
 * rather than silently compare a truncated trace. */
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
 * Run the game `nFrames` twice — baseline (overrides empty) vs optimized (overrides wired) — and diff
 * the per-frame state traces. Each override is wrapped with an invocation counter so an EQUAL result
 * that never dispatched cannot pass vacuously; the wrapper forwards extra call args (`m.call(addr,
 * ...args)`) so parameterized routines are testable through this gate.
 */
export function wholeMachineEquivalence(makeMachine, nFrames, overrides) {
  const base = makeMachine();
  const baseFrames = base.runFrames(nFrames);
  assertRunHealthy(base, baseFrames, nFrames, "baseline");

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
 * Prove translated vs optimized equal for ONE routine, in isolation. Captures the live machine at the
 * instant `target` is first entered — via a snapshot override installed at CONSTRUCTION, so both a
 * dispatch consult and a direct `m.call(target)` resolve to it — then runs the translated and
 * optimized on two clones of that entry state and diffs state + registers. opts.maxFrames (240) bounds it.
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

// -- SP-delta tooth ---------------------------------------------------------

/**
 * The missing-push16 class is INVISIBLE to a memory-equivalence gate: the leaked/adrift stack word lives
 * in dead stack scratch, which the RAM diff excludes, so a rewrite that drops the `m.push16(<slot>)` before
 * an rst-28 / tail dispatch passes eq-green while corrupting the live game (caught only whole-game by
 * tape.test.js / the SP-probe). This tooth closes that gap PER ROUTINE by running the rewrite through the
 * game's own dispatch seam (`withOmittedRet`) — the authority on stack placement. The seam:
 *   - moved 0            -> the rewrite omitted its ROM ret; the seam completes it. (leaf/normal: OK)
 *   - moved +2, pc==slot -> a legit tail-dispatch reached its ret through translated code that popped the
 *                           caller's slot and landed pc on it. (the "+2 dispatcher": OK, NOT a false positive)
 *   - anything else      -> THROW: SP is adrift (a missing push16 is exactly this).
 * Pass the game's `withOmittedRet` so this stays game-agnostic. `m` is a pristine entry clone with SP
 * seated on a real caller-return word (as the eq craft() does). Returns {placeable, error}; a caller
 * asserts placeable === true. Null-mutant it (drop a real push16, prove it goes RED) before trusting a
 * GREEN — a check that cannot see the wrapped case cannot fail on it.
 */
export function seamPlaceable(withOmittedRet, fn, addr, m, ...args) {
  try {
    withOmittedRet(fn, addr)(m, ...args);
    return { placeable: true, error: null };
  } catch (e) {
    return { placeable: false, error: e.message };
  }
}

// -- convergent (relaxed) equivalence ---------------------------------------

/**
 * The RELAXED gate: PIXELS are ground truth; state may diverge TRANSIENTLY as long as it RECONVERGES.
 * PERSISTENT (non-healing) divergence in state or pixels FAILS — real corruption forks and stays
 * forked. Biased to fail: any divergence still present in the final `tailWindow` frames fails.
 * Licenses a cycle-collapse of an interruptible routine, where byte-exact false-fails on benign healing
 * (dead stack scratch via `excludeAddr`; a one-frame raster tear). The caller MUST enable
 * `captureVideo` and supplies the stack region via `excludeAddr`; opts.baseline reuses a runBaseline()
 * across routines on one scenario (opts.tailWindow defaults to 20).
 */
export function convergentEquivalence(makeMachine, nFrames, overrides, opts = {}) {
  const excludeAddr = opts.excludeAddr ?? (() => false);
  const tailWindow = opts.tailWindow ?? 20;
  const nameOf = opts.name ?? ((a) => "0x" + a.toString(16));

  // The baseline depends only on (scenario, nFrames), not `overrides` — reusable via opts.baseline.
  let baseFrames, baseVideo, offToAddrFn;
  if (opts.baseline) {
    ({ frames: baseFrames, video: baseVideo, offToAddr: offToAddrFn } = opts.baseline);
  } else {
    const base = makeMachine();
    baseFrames = base.runFrames(nFrames);
    assertRunHealthy(base, baseFrames, nFrames, "baseline");
    baseVideo = base.videoFrames ?? [];
    offToAddrFn = (o) => base.stateOffsetToAddr(o);
  }

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
  const offToAddr = offToAddrFn;

  // Pixels are ground truth — refuse to run rather than silently pass a pixel-only divergence.
  if (baseVideo.length === 0 || opt.videoFrames.length === 0) {
    throw new Error(
      "convergentEquivalence: no video frames captured — the caller MUST enable " +
        "captureVideo. Pixels are the ground truth and cannot be silently skipped.",
    );
  }
  // Need a genuine tail to observe reconvergence.
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
    statePersistent,
    pixelPersistent,
    transientStateAddrs: lastStateDiff.size - statePersistent.length,
    pixDiffFrames, maxPixels, lastPixDiff, videoCompared: vN,
  };
}

/**
 * Emulate the all-oracle BASELINE once so a caller gating many routines on the SAME scenario reuses it
 * via convergentEquivalence's opts.baseline instead of re-emulating from boot per routine. Depends
 * only on (scenario, nFrames); `frames`/`video` are read-only to the gate, so sharing them is safe.
 */
export function runBaseline(makeMachine, nFrames) {
  const base = makeMachine();
  const frames = base.runFrames(nFrames);
  assertRunHealthy(base, frames, nFrames, "baseline");
  return {
    frames,
    video: base.videoFrames ?? [],
    offToAddr: (o) => base.stateOffsetToAddr(o),
  };
}
