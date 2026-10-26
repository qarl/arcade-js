// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickTargetGroupCounterAndQueueDisplay (ROM 0x7059) — "phase-5 target-group tick": dec (HL), then
 * DE := 0x0315 and rst 0x38 enqueues that word into the page-0x88 display-command ring, then ret.
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) PLUS the register live-out. HL is preserved across the enqueue (a caller can reuse
 * the counter pointer); DE is left holding the command word. Both are checked against the oracle
 * clone; DE is seated to a sentinel first so a module that never sets it fails. (A is scratched by
 * the enqueue to the ring pointer and is NOT part of the contract — see notes.)
 *
 * Jobs:
 *   1. EQUAL (crafted) — a free-slot enqueue, a counter wrap (0->0xff), an occupied slot (command
 *      dropped), and a second pointer: oracle == tickTargetGroupCounterAndQueueDisplay in RAM (−stack), HL, and DE.
 *   2. WRITE-SET — the free-slot path writes the counter, the two command bytes, and the advanced
 *      ring pointer; the occupied-slot path writes only the counter.
 *   3. TEETH — a twin that over-decrements the counter is caught in RAM; a twin that returns the
 *      WRONG command word is caught by the DE live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7059.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7059 as oracle } from "../../translated/loc_7059.js";
import { tickTargetGroupCounterAndQueueDisplay } from "../tickTargetGroupCounterAndQueueDisplay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, TARGET_GROUP_COUNT, DISPLAY_CMD_RING_WRITE_PTR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const CMD = 0x0315; // the fixed command word tickTargetGroupCounterAndQueueDisplay queues
const RING_PAGE = DISPLAY_CMD_RING_WRITE_PTR & 0xff00; // page-0x88 ring base
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone: HL points at the counter (seated in the register), ring pointer + slot state set. */
function craft({ at, val, ringPtr, slotFree }) {
  const m = BASE.clone();
  m.mem.write8(at, val);
  m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, ringPtr);
  m.mem.write8(RING_PAGE + ringPtr, slotFree ? 0x80 : 0x00); // bit7 set = free slot
  m.regs.hl = at;
  m.regs.sp = 0x8ffe;
  return m;
}

const CASES = [
  { at: TARGET_GROUP_COUNT, val: 0x05, ringPtr: 0xc0, slotFree: true }, // free slot -> enqueue
  { at: TARGET_GROUP_COUNT, val: 0x00, ringPtr: 0xc0, slotFree: true }, // counter wraps 0 -> 0xff
  { at: TARGET_GROUP_COUNT, val: 0x05, ringPtr: 0xc0, slotFree: false }, // occupied -> command dropped
  { at: 0x8d07, val: 0x09, ringPtr: 0xc4, slotFree: true }, // a different counter + ring slot
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted cases — tickTargetGroupCounterAndQueueDisplay == oracle in RAM (−stack) + HL + DE", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    oracle(o);

    const c = craft(cs);
    c.regs.de = 0xbeef; // sentinel: a module that never sets DE fails
    const ret = tickTargetGroupCounterAndQueueDisplay(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${JSON.stringify(cs)})`);
    assert.equal(ret[0] & 0xffff, o.regs.hl & 0xffff, `HL return mismatch (${JSON.stringify(cs)})`);
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `module must preserve HL (${JSON.stringify(cs)})`);
    assert.equal(ret[1] & 0xffff, o.regs.de & 0xffff, `DE return mismatch (${JSON.stringify(cs)})`);
    assert.equal(c.regs.de & 0xffff, o.regs.de & 0xffff, `module must SET DE (${JSON.stringify(cs)})`);
    assert.equal(o.regs.de & 0xffff, CMD, "oracle leaves the command word in DE");
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + HL + DE)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: free slot writes counter + 2 command bytes + ring pointer; occupied writes only the counter", () => {
  const free = craft(CASES[0]);
  const b0 = free.dumpState();
  oracle(free);
  const a1 = free.dumpState();
  const changed = new Set();
  for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) changed.add(free.stateOffsetToAddr(off));
  assert.ok(changed.has(TARGET_GROUP_COUNT), "counter decremented");
  assert.ok(changed.has(RING_PAGE + 0xc0), "command high byte written");
  assert.ok(changed.has(RING_PAGE + 0xc1), "command low byte written");
  assert.ok(changed.has(DISPLAY_CMD_RING_WRITE_PTR), "ring pointer advanced");
  assert.equal(free.mem.read8(TARGET_GROUP_COUNT), 0x04, "counter := 0x04");
  assert.equal(free.mem.read8(RING_PAGE + 0xc0), CMD >> 8, "high byte := 0x03");
  assert.equal(free.mem.read8(RING_PAGE + 0xc1), CMD & 0xff, "low byte := 0x15");
  assert.equal(free.mem.read8(DISPLAY_CMD_RING_WRITE_PTR), 0xc2, "ring pointer := 0xc2");

  const busy = craft(CASES[2]);
  const s0 = busy.dumpState();
  oracle(busy);
  const s1 = busy.dumpState();
  const busyChanged = [];
  // The rst-0x38 enqueue pushes/pops its return address in STACK_SCRATCH even when the slot is
  // occupied and the command is dropped; those are not game-state writes (as in ramDiffMinusStack).
  for (let off = 0; off < s0.length; off++) {
    if (s0[off] !== s1[off]) {
      const addr = busy.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) busyChanged.push(addr);
    }
  }
  assert.deepEqual(busyChanged, [TARGET_GROUP_COUNT], "occupied slot writes only the counter");
  console.log("  WRITE-SET: free=4 cells, occupied=1 cell");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: an over-decremented counter is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[0]);
  const c = craft(CASES[0]);
  oracle(o);
  tickTargetGroupCounterAndQueueDisplay(c);
  c.mem.write8(TARGET_GROUP_COUNT, 0x03); // BUG: dropped two, not one
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an over-decrement — it is worthless");
  assert.equal(d.addr, TARGET_GROUP_COUNT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): over-decrement caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong command word is CAUGHT by the DE live-out check", () => {
  const o = craft(CASES[0]);
  oracle(o);
  const wrong = (CMD ^ 0x0100) & 0xffff; // BUG: corrupt the command's high byte
  assert.notEqual(wrong, o.regs.de & 0xffff, "the DE live-out check must reject a wrong command word");
  console.log(`  TEETH(DE): wrong command ${hx(wrong)} rejected against oracle DE=${hx(o.regs.de)}`);
});
