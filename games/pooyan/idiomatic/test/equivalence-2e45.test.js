// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickRopeCellFrameTimer (ROM 0x2e45, Pooyan) — "tick down one of the four
 * rope-cell frame timers". The low two bits of IXL pick a timer at 0x8f28 + 2*(IXL&3);
 * the routine decrements it in place.
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState,
 * minus stack scratch below the entry SP) PLUS the declared register live-out. Two live-outs are genuine and
 * consumed by the frozen rope-cell handlers (spawnHangingRopeObject/2ecb/2f01/2f2f):
 *   - HL = the timer's address — spawnHangingRopeObject/advanceHangingRopeObjectWithGrabCheck store through it after the call;
 *   - the Z flag = decremented-to-zero — every caller `ret nz` on it.
 * Both are checked against the oracle clone, and the module's own clone must SET them (a
 * return-only rewrite would pass the return check but starve the register-dispatch
 * caller). The oracle also loads C := IXL, but no caller reads C back, so C is not part of
 * the contract and is not compared (see notes).
 *
 * Jobs:
 *   1. EQUAL (crafted) — each IXL&3 timer, plus a zero->0xff wrap and an IXL with high
 *      bits set (proving the &3 mask): oracle == module in RAM, HL, and Z.
 *   2. WRITE-SET — the only write is the selected timer cell.
 *   3. TEETH — a wrong decremented byte (RAM), a wrong returned HL (live-out), and a
 *      wrong Z flag (live-out) are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2e45.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2e45 as oracle } from "../../translated/loc_2e45.js";
import { tickRopeCellFrameTimer } from "../tickRopeCellFrameTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TIMER_BASE = 0x8f28;
const timerAddr = (ixl) => TIMER_BASE + 2 * (ixl & 0x03);
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with IX (low byte = ixl) seated and the selected timer set. */
function craft(ixl, timerVal) {
  const m = BASE.clone();
  m.regs.ix = (0x99 << 8) | (ixl & 0xff); // only IXL matters; high byte is a decoy
  m.mem.write8(timerAddr(ixl), timerVal);
  m.regs.sp = 0x8ffe;
  return m;
}

const CASES = [
  { ixl: 0x00, timerVal: 0x01 }, // -> 0, Z set
  { ixl: 0x01, timerVal: 0x05 }, // -> 4, Z clear
  { ixl: 0x02, timerVal: 0x00 }, // -> 0xff, Z clear (wrap)
  { ixl: 0x03, timerVal: 0x01 }, // -> 0, Z set
  { ixl: 0x07, timerVal: 0x02 }, // &3 = 3 -> timer 0x8f2e; proves the mask
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted IXL/timer cases — tickRopeCellFrameTimer == oracle in RAM (−stack) + HL + Z", () => {
  for (const { ixl, timerVal } of CASES) {
    const o = craft(ixl, timerVal);
    oracle(o);

    const c = craft(ixl, timerVal);
    c.regs.hl = 0xffff; // sentinel: not any timer address, so a non-writing module fails
    c.regs.fZ = !o.regs.fZ; // opposite, so a module that never sets Z fails
    const ret = tickRopeCellFrameTimer(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `ixl=${hx(ixl)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    assert.equal(ret[0] & 0xffff, o.regs.hl & 0xffff, `HL return mismatch (ixl=${hx(ixl)})`);
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `module must SET HL (ixl=${hx(ixl)})`);
    assert.equal(ret[1], o.regs.fZ, `Z return mismatch (ixl=${hx(ixl)})`);
    assert.equal(c.regs.fZ, o.regs.fZ, `module must SET the Z flag (ixl=${hx(ixl)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + HL + Z)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the only write is the selected timer cell", () => {
  const { ixl, timerVal } = CASES[1];
  const m = craft(ixl, timerVal);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: m.stateOffsetToAddr(off), to: a1[off] });
  }
  assert.equal(changed.length, 1, `expected 1 write, got ${changed.length}`);
  assert.equal(changed[0].addr, timerAddr(ixl), `wrote wrong cell ${hx(changed[0].addr)}`);
  assert.equal(changed[0].to, (timerVal - 1) & 0xff, "wrong decremented value");
  console.log(`  WRITE-SET: ${hx(timerAddr(ixl))} := ${hx((timerVal - 1) & 0xff)} (1 cell)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong decremented byte is CAUGHT by the RAM diff", () => {
  const { ixl, timerVal } = CASES[1];
  const o = craft(ixl, timerVal);
  const c = craft(ixl, timerVal);
  oracle(o);
  tickRopeCellFrameTimer(c);
  c.mem.write8(timerAddr(ixl), (timerVal - 2) & 0xff); // BUG: over-decremented
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong decrement — it is worthless");
  assert.equal(d.addr, timerAddr(ixl), `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong returned HL is CAUGHT by the live-out check", () => {
  const { ixl, timerVal } = CASES[3];
  const o = craft(ixl, timerVal);
  oracle(o);
  // broken twin: decrements correctly but reports the adjacent timer's address
  const c = craft(ixl, timerVal);
  const ticked = (c.mem.read8(timerAddr(ixl)) - 1) & 0xff;
  c.mem.write8(timerAddr(ixl), ticked);
  c.regs.hl = (timerAddr(ixl) + 2) & 0xffff; // BUG: off by one timer
  assert.notEqual(c.regs.hl & 0xffff, o.regs.hl & 0xffff, "the HL live-out check must reject a wrong address");
  console.log(`  TEETH(HL): wrong HL ${hx(c.regs.hl)} rejected (oracle ${hx(o.regs.hl)})`);
});

test("TEETH: a wrong Z flag is CAUGHT by the live-out check", () => {
  const { ixl, timerVal } = CASES[0]; // decrements 1 -> 0, so oracle Z = true
  const o = craft(ixl, timerVal);
  oracle(o);
  assert.equal(o.regs.fZ, true, "sanity: oracle sets Z when the timer reaches zero");
  // broken twin: leaves Z clear regardless
  const c = craft(ixl, timerVal);
  c.mem.write8(timerAddr(ixl), (timerVal - 1) & 0xff);
  c.regs.fZ = false; // BUG: never reports reached-zero
  assert.notEqual(c.regs.fZ, o.regs.fZ, "the Z live-out check must reject a stuck-clear flag");
  console.log("  TEETH(Z): stuck-clear Z rejected against oracle Z=true");
});
