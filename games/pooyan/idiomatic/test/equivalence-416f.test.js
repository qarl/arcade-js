// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceObjectDwellThenBlankBand (ROM 0x416f, Pooyan) — the per-object dwell-then-dispatch
 * step for the record based at IX. It advances the object's animation, decrements the dwell
 * countdown (IX+0x11), and returns while it is still non-zero; on expiry it tails into the
 * next-state handler, which blanks the object's sprite band (0x17 bytes from IX).
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). pc/SP/cycles are NOT compared, and there is NO register/flag live-out — a
 * table-dispatched step whose whole result lives in the record's memory. The oracle's animation
 * call and the band-blank tail push/call/ret all land inside STACK_SCRATCH.
 *
 * The animation tick is kept to a simple hold decrement by seeding IX+0x0e non-zero, so the
 * record's animation stream is not walked (that walk is covered by the animation step's own gate).
 *
 * Jobs:
 *   1. EQUAL (crafted) — dwell still counting; dwell expiry -> band blank: oracle == advanceObjectDwellThenBlankBand in RAM.
 *   2. WRITE-SET — the still-dwelling path writes exactly the hold (IX+0x0e) and dwell (IX+0x11).
 *   3. TEETH — a wrong dwell byte (still-dwelling) and a wrong band byte (expiry) are each caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-416f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_416f as oracle } from "../../translated/loc_416f.js";
import { advanceObjectDwellThenBlankBand } from "../advanceObjectDwellThenBlankBand.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8bc0; // isolated work-RAM record base (band 0x8bc0..0x8bd6), clear of the stack
const HOLD = REC + 0x0e; // the animation frame-hold counter
const DWELL = REC + 0x11; // the dwell countdown

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: record band cleared (or dirtied so the band-blank is observable), hold + dwell seated. */
function craft(dwell, dirty = false) {
  const m = BASE.clone();
  for (let off = 0; off <= 0x17; off++) m.mem.write8(REC + off, dirty ? 0xaa : 0x00);
  m.mem.write8(HOLD, 0x05); // non-zero: the animation tick just decrements it
  m.mem.write8(DWELL, dwell & 0xff);
  m.regs.ix = REC;
  m.regs.sp = 0x8fe0; // deep in STACK_SCRATCH: the animation call + band-blank tail stay inside
  return m;
}

const CASES = [
  { name: "still dwelling", dwell: 0x03, dirty: false },
  { name: "dwell expiry -> band blank", dwell: 0x01, dirty: true },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted dwell cases — advanceObjectDwellThenBlankBand == oracle in RAM (−stack)", () => {
  for (const { name, dwell, dirty } of CASES) {
    const o = craft(dwell, dirty);
    const c = craft(dwell, dirty);
    oracle(o);
    advanceObjectDwellThenBlankBand(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the still-dwelling path writes exactly the hold and dwell fields", () => {
  const m = craft(CASES[0].dwell, false);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = m.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push(addr);
    }
  }
  assert.deepEqual(changed.sort((x, y) => x - y), [HOLD, DWELL].sort((x, y) => x - y),
    `unexpected write footprint: ${changed.map(hx).join(",")}`);
  assert.equal(m.mem.read8(HOLD), 0x04, "hold decremented 0x05 -> 0x04");
  assert.equal(m.mem.read8(DWELL), 0x02, "dwell decremented 0x03 -> 0x02");
  console.log(`  WRITE-SET: still-dwelling touches ${hx(HOLD)}/${hx(DWELL)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong dwell byte (still-dwelling) is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[0].dwell, false);
  const c = craft(CASES[0].dwell, false);
  oracle(o);
  advanceObjectDwellThenBlankBand(c);
  c.mem.write8(DWELL, 0xee); // BUG: dwell must be the decremented value
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong dwell byte — it is worthless");
  assert.equal(d.addr, DWELL, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/dwell: caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong band byte (expiry path) is CAUGHT by the RAM diff", () => {
  const cell = REC + 0x00; // the band blank zeroed this cell
  const o = craft(CASES[1].dwell, true);
  const c = craft(CASES[1].dwell, true);
  oracle(o);
  advanceObjectDwellThenBlankBand(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: the expiry path is RAM-equal before the twin breaks it");
  assert.equal(c.mem.read8(cell), 0x00, "sanity: the band blank zeroed this cell");
  c.mem.write8(cell, 0xaa); // BUG: leave a band byte un-blanked
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an un-blanked band byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/band: caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
