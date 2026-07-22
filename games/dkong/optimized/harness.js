// SPDX-License-Identifier: GPL-3.0-only
/**
 * The equivalence harness — the gate every optimized/ routine must pass before
 * it is trusted to replace its translated/ oracle.
 *
 * It answers one question two ways: does running the OPTIMIZED routine leave the
 * machine in observably the same state as running the TRANSLATED original from
 * identical input?
 *
 *   • wholeMachineEquivalence — run the whole game N frames twice, once with the
 *     override wired and once without, and diff the full per-frame state trace
 *     (work + sprite + video RAM). This is the strict gate: a TIMING divergence
 *     (an optimized routine that pushed the frame's work past the vblank spin)
 *     does not hide here, it surfaces as downstream state drift. RAM is the
 *     real contract (README §"The equivalence harness").
 *
 *   • unitEquivalence — capture the machine at the instant the routine
 *     dispatches, clone it, run translated vs optimized on the two clones, and
 *     diff work/sprite/video RAM + the Z80 registers. Faster, and it localizes a
 *     failure to the routine itself instead of to some frame downstream.
 *
 * Cycles are deliberately NOT compared (README §2): the ROM self-synchronises at
 * the vblank spin, so a routine's internal cycle distribution is unobservable as
 * long as the frame still reaches that spin — and a frame that DIDN'T reach it
 * shows up as a state divergence in the whole-machine trace.
 */

import { Machine } from "../machine.js";
import {
  SPRITE_RAM_BASE, SPRITE_RAM_SIZE,
  VIDEO_RAM_BASE,
  WORK_RAM_BASE, WORK_RAM_SIZE,
} from "../../../boards/dkong/memory.js";

// -- state-diff plumbing ----------------------------------------------------

/**
 * Map a byte offset in a 5120-byte dumpState() blob back to the RAM address it
 * came from. The dump is work(0x6000..) + sprite(0x7000..) + video(0x7400..),
 * concatenated in that order (see AddressSpace.dumpState).
 */
export function stateOffsetToAddr(off) {
  if (off < WORK_RAM_SIZE) return WORK_RAM_BASE + off;
  if (off < WORK_RAM_SIZE + SPRITE_RAM_SIZE) {
    return SPRITE_RAM_BASE + (off - WORK_RAM_SIZE);
  }
  return VIDEO_RAM_BASE + (off - WORK_RAM_SIZE - SPRITE_RAM_SIZE);
}

/** First differing byte between two dumps, or null when identical. */
export function firstStateDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return { offset: i, addr: stateOffsetToAddr(i), a: a[i], b: b[i] };
    }
  }
  if (a.length !== b.length) {
    return { offset: n, addr: null, a: a.length, b: b.length };
  }
  return null;
}

// The Z80 register file: every one of these is an own primitive field on Regs
// (bc/de/hl/af and the flag getters are prototype accessors, so they are not
// enumerated). Copying and diffing this list is copying and diffing the CPU.
const REG_FIELDS = [
  "a", "f", "b", "c", "d", "e", "h", "l", "ix", "iy", "sp",
  "a_", "f_", "b_", "c_", "d_", "e_", "h_", "l_",
];

/** First differing register, or null when identical. */
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
 * A run that stopped short of the frames it was asked for, or that hit a
 * NotImplemented, never reached the vblank spin on some frame — exactly the
 * overrun the README warns about. Announce it instead of silently comparing a
 * truncated trace.
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
 * @param {Uint8Array} rom      maincpu image
 * @param {object} assets       { gfx1, proms, gfx2 } — optional; the state dump
 *                              needs none of it, so {} is the fast path.
 * @param {number} nFrames      frames to run each side
 * @param {object|Map} overrides  { targetAddr: optimizedFn } to wire on the
 *                              optimized side. Each fn is wrapped with an
 *                              invocation counter so an EQUAL result that never
 *                              actually dispatched the override cannot pass
 *                              vacuously.
 * @returns {object} { equal, framesCompared, invocations, ...firstDiff }
 */
export function wholeMachineEquivalence(rom, assets, nFrames, overrides) {
  // Baseline: the shipped path, overrides empty (manifest.optimized === {}).
  const base = new Machine(rom, assets);
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
  const opt = new Machine(rom, { ...assets, overrides: wrapped });
  const optFrames = opt.runFrames(nFrames);
  assertRunHealthy(opt, optFrames, nFrames, "optimized");

  const framesCompared = Math.min(baseFrames.length, optFrames.length);
  for (let f = 0; f < framesCompared; f++) {
    const d = firstStateDiff(baseFrames[f], optFrames[f]);
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

// -- machine cloning (for the unit gate) ------------------------------------

/**
 * Copy the i8257 / latch / input / watchdog VALUE-state from one IO to another.
 * Mirrors boards/dkong/io.js. Deliberately does NOT touch dma.mem: the fresh
 * Machine's AddressSpace already bound its own dma.mem, and rebinding it to the
 * source's address space would make the clone's DMA write into the wrong RAM.
 */
function copyIoState(dst, src) {
  dst.nmiMask = src.nmiMask;
  dst.flipScreen = src.flipScreen;
  dst.spriteBank = src.spriteBank;
  dst.paletteBank = src.paletteBank;
  dst.gridEnable = src.gridEnable;
  dst.audioIrq = src.audioIrq;
  dst.soundLatch3d = src.soundLatch3d;
  dst.soundWrites = src.soundWrites;
  dst.latch6h.set(src.latch6h);
  dst.inputAssert = src.inputAssert ? { ...src.inputAssert } : null;

  dst.inputs.service1 = src.inputs.service1;
  dst.inputs._in0 = src.inputs._in0;
  dst.inputs._in1 = src.inputs._in1;
  dst.inputs._in2 = src.inputs._in2;
  dst.inputs._dsw0 = src.inputs._dsw0;

  dst.watchdog.timeoutFrames = src.watchdog.timeoutFrames;
  dst.watchdog.framesSinceKick = src.watchdog.framesSinceKick;
  dst.watchdog.enabled = src.watchdog.enabled;

  dst.dma.addr.set(src.dma.addr);
  dst.dma.count.set(src.dma.count);
  dst.dma.flipFlop = src.dma.flipFlop;
  dst.dma.mode = src.dma.mode;
  dst.dma.drq = src.dma.drq;
  dst.dma.transfers = src.dma.transfers;
  dst.dma.bytesMoved = src.dma.bytesMoved;
  dst.dma.cyclesStolen = src.dma.cyclesStolen;
}

/**
 * A fresh Machine on the same ROM/assets, restored to `src`'s observable state:
 * all RAM, the full register file, and IO value-state. The clone's frame
 * machinery is neutralised (boundaries/NMI/budget set to Infinity) so that
 * running ONE routine on it in isolation cannot trip a frame sample, fire an
 * NMI, or throw FramesComplete — the unit gate measures the routine, not the
 * scheduler.
 */
export function cloneMachine(src, rom, assets) {
  const c = new Machine(rom, assets);
  c.mem.workRam.set(src.mem.workRam);
  c.mem.spriteRam.set(src.mem.spriteRam);
  c.mem.videoRam.set(src.mem.videoRam);
  c.mem.discardedWrites = src.mem.discardedWrites;

  // Regs' data fields are all own primitives, so a spread copies exactly the
  // 19 register bytes/words and leaves the prototype accessors intact.
  Object.assign(c.regs, { ...src.regs });

  copyIoState(c.io, src.io);

  c.cycles = src.cycles;
  c.pc = src.pc;
  c.pcKnown = src.pcKnown;
  c.frame = src.frame;
  c.nmiCount = src.nmiCount;
  c.booted = src.booted;

  c.nextBoundary = Infinity;
  c.nextNmi = Infinity;
  c.maxFrames = Infinity;
  c.maxCycles = Infinity;
  return c;
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
 * @param {Uint8Array} rom
 * @param {object} assets      { gfx1, proms, gfx2 } — optional
 * @param {number} target      dispatch address of the routine (e.g. 0x01c3)
 * @param {function} translatedFn  the oracle implementation
 * @param {function} optimizedFn   the implementation under test
 * @param {object} [opts]      { maxFrames = 240 } — how long to run to reach the
 *                             first dispatch of `target`
 * @returns {object} { equal, ram, regs, pc }
 */
export function unitEquivalence(rom, assets, target, translatedFn, optimizedFn, opts = {}) {
  const maxFrames = opts.maxFrames ?? 240;

  const host = new Machine(rom, assets);
  let entry = null;
  host.overrides = new Map([[target, (mm) => {
    if (entry === null) entry = cloneMachine(mm, rom, assets); // pristine entry state
    return translatedFn(mm); // let the host game proceed normally
  }]]);
  host.runFrames(maxFrames);
  if (entry === null) {
    throw new Error(
      `unit harness: 0x${target.toString(16).padStart(4, "0")} never dispatched ` +
        `within ${maxFrames} frames`,
    );
  }

  const a = cloneMachine(entry, rom, assets); // translated
  const b = cloneMachine(entry, rom, assets); // optimized
  translatedFn(a);
  optimizedFn(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState());
  const regs = firstRegDiff(a.regs, b.regs);
  return {
    equal: !ram && !regs,
    ram,
    regs,
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
  };
}
