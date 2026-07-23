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
 *   • unitEquivalence — capture the machine at the instant the routine
 *     dispatches, clone it, run translated vs optimized on the two clones, and
 *     diff state + the CPU registers. Faster, and it localizes a failure to the
 *     routine itself instead of to some frame downstream.
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
    wrapped.set(addr, (mm) => {
      invocations.set(addr, invocations.get(addr) + 1);
      return fn(mm);
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
 * Captures the live machine at the instant `target` first dispatches (via a
 * temporary override that snapshots on entry, then delegates to the translated
 * routine so the host run continues to a clean stop), then runs the translated
 * and optimized implementations on two independent clones of that entry state
 * and diffs the result.
 *
 * @param {(overrides?:Map|object)=>object} makeMachine  factory returning a
 *   machine for the game under test (called with no argument here — the target
 *   is wired via the machine's own `overrides` map after construction).
 * @param {number} target      dispatch address of the routine (e.g. 0x01c3)
 * @param {function} translatedFn  the oracle implementation
 * @param {function} optimizedFn   the implementation under test
 * @param {object} [opts]      { maxFrames = 240 } — how long to run to reach the
 *                             first dispatch of `target`
 * @returns {object} { equal, ram, regs, pc }
 */
export function unitEquivalence(makeMachine, target, translatedFn, optimizedFn, opts = {}) {
  const maxFrames = opts.maxFrames ?? 240;

  const host = makeMachine();
  let entry = null;
  host.overrides = new Map([[target, (mm) => {
    if (entry === null) entry = mm.clone(); // pristine entry state
    return translatedFn(mm); // let the host game proceed normally
  }]]);
  host.runFrames(maxFrames);
  if (entry === null) {
    throw new Error(
      `unit harness: 0x${target.toString(16).padStart(4, "0")} never dispatched ` +
        `within ${maxFrames} frames`,
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
