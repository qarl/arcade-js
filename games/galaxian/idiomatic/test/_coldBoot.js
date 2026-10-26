// SPDX-License-Identifier: GPL-3.0-only
// Cold-boot chain equivalence fixtures (galaxian). The boot chain runs once, from a fresh power-on Machine, so
// its entries are CAPTURED at their real dispatches: the frozen translated oracle boots a fresh machine and
// every dispatch of a chain entry is cloned at that moment. Each test replays a captured (or crafted) entry
// through the oracle and the idiomatic candidate and compares work/video/OBJ RAM (stack scratch below the entry
// SP masked), the board latches the boot drives, the watchdog kick count, and that both hand off to the main loop.
// The chain ends at 0x2000; both sides reach the same wired enterMainLoop there, whose generator is returned
// unstarted, so each replay stops exactly at the hand-off.
// Not compared: SP (the idiomatic layer seats no guest stack; the ROM's `ld sp,0x4400` has no consumer after
// the hand-off) and the board's unmapped-write counter (the idiomatic seeding drops the ROM's three stores to
// the unmapped 0x7002/0x7003/0x7005 slots).
import { makeMachine, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { buildRoutines } from "../../routines.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { enterMainLoop } from "../enterMainLoop.js";

export { romsPresent };

const STACK_HI = STACK_SCRATCH.hi;
const HANDOFF = 0x2000;
export const CHAIN = [0x1a55, 0x1a9a, 0x1aca, 0x1b5d, 0x1b70];

// The oracle's table: the full translated layer, with the main-loop hand-off served by the wired idiomatic
// entry (as in the live game) so a replay ends at the hand-off instead of running the translated main loop.
export function oracleRoutines() {
  const r = buildRoutines();
  r.set(HANDOFF, enterMainLoop);
  return r;
}

let captured = null;
/** { 0x0000: [fresh power-on machine], 0x1a55: [...], ... } -- clones taken at each real dispatch. */
export function captures() {
  if (captured) return captured;
  const m = makeMachine();
  const routines = oracleRoutines();
  captured = { 0x0000: [m.clone()] };
  for (const addr of CHAIN) {
    captured[addr] = [];
    const orig = routines.get(addr);
    routines.set(addr, (mm, ...a) => { captured[addr].push(mm.clone()); return orig(mm, ...a); });
  }
  m.routines = routines;
  const r = m.call(0x0000);
  if (!isGenerator(r)) throw new Error("capture run did not reach the main-loop hand-off");
  return captured;
}

export const isGenerator = (r) => !!r && typeof r.next === "function" && typeof r.throw === "function";

/** Live stack floor at an entry: SP, except power-on SP 0 is an empty stack (the first push lands at 0xfffe). */
export const liveFloor = (entry) => entry.regs.sp || 0x10000;

/** Run `fn` on a clone of `entry` (oracle table installed); return the observable end state + entry floor. */
export function run(fn, entry) {
  const m = entry.clone();
  m.routines = oracleRoutines();
  const r = fn(m);
  return { m, handedOff: isGenerator(r), floor: liveFloor(entry) };
}

export function ioOf(m) {
  const io = m.io;
  return {
    irq: io.irqEnable, stars: io.starsEnable, flipX: io.flipX, flipY: io.flipY, coinLock: io.coinLock,
    startLamp: [...io.startLamp], coinCounter: [...io.coinCounter], lfo: [...io.soundLfo],
    reg: [...io.soundReg], pitch: io.soundPitchVal, watchdog: m.mem.watchdogReads,
  };
}

/** First divergence between two end states (RAM minus stack scratch below the entry SP, then io), or null. */
export function diff(a, b) {
  if (a.handedOff !== b.handedOff) return `hand-off ${a.handedOff} vs ${b.handedOff}`;
  const dead = deadStackBelow(STACK_SCRATCH, a.floor);
  const A = a.m.dumpState(), B = b.m.dumpState();
  for (let i = 0; i < A.length; i++) {
    if (A[i] === B[i]) continue;
    const addr = a.m.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return `ram 0x${addr.toString(16)}: ${A[i]} vs ${B[i]}`;
  }
  const x = JSON.stringify(ioOf(a.m)), y = JSON.stringify(ioOf(b.m));
  return x === y ? null : `io ${x} vs ${y}`;
}

/** Oracle vs candidate from one chain entry: the divergence, or null. The oracle must reach the hand-off
 *  (positive control), so two runs that both stop short can never read as equal. */
export function compare(oracle, cand, entry) {
  const a = run(oracle, entry);
  if (!a.handedOff) return "the oracle did not reach the main-loop hand-off";
  return diff(a, run(cand, entry));
}

/** An entry whose every boot-driven latch sits away from its boot value, on a populated attract RAM image. */
export function warmEntry(base, mut) {
  const e = base.clone();
  e.regs.sp = STACK_HI;
  const io = e.io;
  io.irqEnable = 1; io.starsEnable = 0; io.flipX = 1; io.flipY = 1; io.coinLock = 1;
  io.startLamp = [1, 1]; io.coinCounter = [1, 1]; io.soundLfo = [9, 9, 9, 9];
  io.soundReg = new Uint8Array(8).fill(9); io.soundPitchVal = 0;
  for (let i = 0; i < 0x400; i++) e.mem8[0x4000 + i] = (i * 7 + 3) & 0xff;
  for (let i = 0; i < 0x400; i++) e.mem8[0x5000 + i] = (i * 11 + 5) & 0xff;
  for (let i = 0; i < 0x100; i++) e.mem8[0x5800 + i] = (i * 13 + 1) & 0xff;
  if (mut) mut(e);
  return e;
}
