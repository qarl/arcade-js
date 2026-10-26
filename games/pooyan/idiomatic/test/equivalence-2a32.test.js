// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorPositionAndEnqueueMilestone (ROM 0x2a32, Pooyan) — the state-3 per-frame handler for
 * an actor record at IX. It reloads the frame delay (rec+0x11 := 0x03), bumps the frame counter
 * (rec+0x0b) and every fourth frame flips the display tile (rec+0x0f) between 0x15 and 0x1e, then
 * advances the 16-bit position (rec+0x05 low, rec+0x06 high) by 0x80 with the carry plus one extra
 * into the high byte. On high byte 0x52 or 0x64 it enqueues a display command and returns; below
 * 0xac it returns; otherwise it steps the record's dispatch state (rec+0x02).
 *
 * Cycle-free gate: a fresh clone per side, compared on RAM (dumpState) minus stack scratch below the entry SP. There
 * is NO register live-out — a dispatch handler whose shared epilogue reads the record, not a
 * register — so only RAM is compared. IX and the record are poked identically on both sides
 * (CRAFTED); the display ring is seated with a free slot so the two enqueue milestones are
 * observable.
 *
 * Jobs:
 *   1. EQUAL — crafted records covering: the three tile-flip outcomes, the no-flip frame, carry
 *      propagation, both enqueue milestones, the state-advance path, and the below-threshold path.
 *   2. WRITE-SET — the milestone-A record: record fields + the two enqueued command bytes + the
 *      advanced ring pointer.
 *   3. TEETH — a wrong high byte and a wrong enqueued command byte are each CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2a32.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2a32 as oracle } from "../../translated/loc_2a32.js";
import { advanceActorPositionAndEnqueueMilestone } from "../advanceActorPositionAndEnqueueMilestone.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c30; // an actor record base in work RAM
const RING_PTR = 0x88a0; // display-command ring write pointer (low byte on page 0x88)
const RING_PAGE = 0x8800;
const RING_LOW = 0xc0; // a free ring position
const CMD_A_HI = 0x06; // command word at milestone 0x52 is 0x0694
const CMD_A_LO = 0x94;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: IX at REC, the six read/written record fields seated, a free display-ring slot. */
function craft({ b, f, low, high, s2 }) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.mem.write8(REC + 0x11, 0x00); // delay: seated != 0x03 so the reload is observable
  m.mem.write8(REC + 0x0b, b);
  m.mem.write8(REC + 0x0f, f);
  m.mem.write8(REC + 0x05, low);
  m.mem.write8(REC + 0x06, high);
  m.mem.write8(REC + 0x02, s2);
  m.mem.write8(RING_PTR, RING_LOW); // free ring slot for the enqueue path
  m.mem.write8(RING_PAGE + RING_LOW, 0xff);
  m.mem.write8(RING_PAGE + ((RING_LOW + 1) & 0xff), 0xff);
  m.regs.sp = 0x8ffe; // the rst-0x38 enqueue trampoline lands inside STACK_SCRATCH
  return m;
}

const CASES = [
  { b: 0x03, f: 0x15, low: 0x00, high: 0x10, s2: 0x00 }, // flip 0x15 -> 0x1e, below limit
  { b: 0x03, f: 0x1e, low: 0x00, high: 0x10, s2: 0x00 }, // flip 0x1e -> 0x15
  { b: 0x03, f: 0x00, low: 0x00, high: 0x10, s2: 0x00 }, // flip other -> 0x15
  { b: 0x00, f: 0x15, low: 0x00, high: 0x10, s2: 0x00 }, // no flip
  { b: 0x00, f: 0x15, low: 0x80, high: 0x10, s2: 0x00 }, // carry propagates into high
  { b: 0x00, f: 0x15, low: 0x00, high: 0x51, s2: 0x00 }, // milestone A (high -> 0x52)
  { b: 0x00, f: 0x15, low: 0x00, high: 0x63, s2: 0x00 }, // milestone B (high -> 0x64)
  { b: 0x00, f: 0x15, low: 0x80, high: 0xab, s2: 0x05 }, // high -> 0xad: advance state
  { b: 0x00, f: 0x15, low: 0x80, high: 0xaa, s2: 0x07 }, // high -> 0xac: advance state (boundary)
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted records — advanceActorPositionAndEnqueueMilestone == oracle in RAM (−stack)", () => {
  for (const kase of CASES) {
    const o = craft(kase);
    const c = craft(kase);
    oracle(o);
    advanceActorPositionAndEnqueueMilestone(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `case ${JSON.stringify(kase)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted records identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: milestone-A record writes its fields + enqueues the command word", () => {
  const kase = { b: 0x00, f: 0x15, low: 0x00, high: 0x51, s2: 0x00 };
  const slot0 = RING_PAGE + RING_LOW;
  const slot1 = RING_PAGE + ((RING_LOW + 1) & 0xff);
  const footprint = new Set([REC + 0x11, REC + 0x0b, REC + 0x05, REC + 0x06, slot0, slot1, RING_PTR]);

  const m = craft(kase);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = m.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue; // the rst-0x38 enqueue trampoline pushes into STACK_SCRATCH — not game state
      changed.push(addr);
    }
  }
  assert.equal(changed.length, footprint.size, `expected ${footprint.size} writes, got ${changed.length}`);
  for (const addr of changed) assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  assert.equal(m.mem.read8(REC + 0x11), 0x03, "delay reloaded");
  assert.equal(m.mem.read8(REC + 0x0b), 0x01, "frame counter bumped");
  assert.equal(m.mem.read8(REC + 0x05), 0x80, "position low advanced");
  assert.equal(m.mem.read8(REC + 0x06), 0x52, "position high at milestone A");
  assert.equal(m.mem.read8(slot0), CMD_A_HI, "command hi byte enqueued");
  assert.equal(m.mem.read8(slot1), CMD_A_LO, "command lo byte enqueued");
  assert.equal(m.mem.read8(RING_PTR), (RING_LOW + 2) & 0xff, "ring pointer advanced two");
  console.log(`  WRITE-SET: 4 record fields + 2 command bytes + ring ptr (${footprint.size} cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong position high byte is CAUGHT by the RAM diff", () => {
  const kase = { b: 0x00, f: 0x15, low: 0x00, high: 0x10, s2: 0x00 };
  const o = craft(kase);
  const c = craft(kase);
  oracle(o);
  advanceActorPositionAndEnqueueMilestone(c);
  c.mem.write8(REC + 0x06, 0x00); // BUG: high must be old_high + 1 = 0x11
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong high byte — it is worthless");
  assert.equal(d.addr, REC + 0x06, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(high): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong enqueued command byte is CAUGHT by the RAM diff", () => {
  const kase = { b: 0x00, f: 0x15, low: 0x00, high: 0x51, s2: 0x00 };
  const slot1 = RING_PAGE + ((RING_LOW + 1) & 0xff);
  const o = craft(kase);
  const c = craft(kase);
  oracle(o);
  advanceActorPositionAndEnqueueMilestone(c);
  c.mem.write8(slot1, 0x00); // BUG: enqueued command lo byte must be 0x94
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong command byte — it is worthless");
  assert.equal(d.addr, slot1, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(cmd): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
