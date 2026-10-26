// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEagleDiveClimbToRetireAtLimit (Pooyan) — "eagle dive/climb state": advance the record's
 * animation (shared stepper), then integrate its 16-bit vertical position by the per-record speed.
 * An even-indexed record (bit 3 of its low address byte clear) descends (add speed, carry bumps the
 * row, bottom limit advances the state byte); an odd-indexed record climbs (subtract, borrow drops
 * the row, top limit advances the state byte).
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES RAM, so each
 * case runs the oracle on one FRESH clone and advanceEagleDiveClimbToRetireAtLimit on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The live-out is MEMORY ONLY — the record's position/row/state fields. pc/SP are not compared. No
 * register is a consumed result: this is a table-dispatched state handler whose effect is the record
 * mutation, and the shared animation stepper it calls is itself memory-only. IX is an input.
 *
 * IX (the record base) both selects the record AND, via bit 3 of its low byte, the dive/climb path,
 * so cases craft records at an even base and an odd base. The animation stepper is kept on its
 * frame-hold branch (rec+0x0E non-zero, so it just decrements) — its full stream walk has its own
 * gate — leaving this test to exercise advanceEagleDiveClimbToRetireAtLimit's own integration arithmetic.
 *
 * Jobs:
 *   1. EQUAL (crafted) — descending {no-carry, carry, bottom-limit} and climbing {no-borrow, borrow,
 *      top-limit} all match in RAM(−stack).
 *   2. WRITE-SET — a bottom-limit descend writes exactly the hold counter, the position byte, and
 *      the state byte.
 *   3. CRAFTED — a carry descend bumps the row; a borrow climb drops the row.
 *   4. TEETH — a wrong integrated position byte MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7395.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7395 as oracle } from "../../translated/loc_7395.js";
import { advanceEagleDiveClimbToRetireAtLimit } from "../advanceEagleDiveClimbToRetireAtLimit.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const DESCEND_REC = ENEMY_ACTOR_TABLE; //     0x8ae0: bit 3 of the low byte clear -> descend
const CLIMB_REC = ENEMY_ACTOR_TABLE + 0x08; // 0x8ae8: bit 3 set -> climb
const HOLD = 0x04; // rec+0x0E frame-hold: non-zero, so the animation stepper just decrements it

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}
function changedMinusStack(m, before, after) {
  const out = new Map();
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) {
      const addr = m.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) out.set(addr, after[off]);
    }
  }
  return out;
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the eagle record fields seated identically at `rec`. */
function craft(rec, { pos, row, speed, state }) {
  const m = BASE.clone();
  m.regs.ix = rec;
  m.mem.write8(rec + 0x02, state); // state byte
  m.mem.write8(rec + 0x03, pos); // 16-bit position, low
  m.mem.write8(rec + 0x04, row); // 16-bit position, high (row)
  m.mem.write8(rec + 0x09, speed); // per-record speed
  m.mem.write8(rec + 0x0e, HOLD); // animation frame-hold counter
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's call/ret only touch dead RAM
  return m;
}

const CASES = [
  { name: "descend: no carry", rec: DESCEND_REC, pos: 0x10, row: 0x08, speed: 0x05, state: 0x02 },
  { name: "descend: carry bumps row", rec: DESCEND_REC, pos: 0xf0, row: 0x08, speed: 0x20, state: 0x02 },
  { name: "descend: bottom limit -> state", rec: DESCEND_REC, pos: 0x10, row: 0x1d, speed: 0x05, state: 0x02 },
  { name: "climb: no borrow", rec: CLIMB_REC, pos: 0x40, row: 0x10, speed: 0x05, state: 0x01 },
  { name: "climb: borrow drops row", rec: CLIMB_REC, pos: 0x02, row: 0x10, speed: 0x05, state: 0x01 },
  { name: "climb: top limit -> state", rec: CLIMB_REC, pos: 0x40, row: 0x03, speed: 0x05, state: 0x01 },
];

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: crafted dive/climb records — advanceEagleDiveClimbToRetireAtLimit == oracle in RAM(−stack)", () => {
  for (const c of CASES) {
    const o = craft(c.rec, c);
    const k = craft(c.rec, c);
    oracle(o);
    advanceEagleDiveClimbToRetireAtLimit(k);
    const d = ramDiffMinusStack(o, k);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b} (${c.name})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted records identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a bottom-limit descend writes the hold counter, position, and state", () => {
  const c = CASES[2]; // descend, bottom limit -> state advance
  const o = craft(c.rec, c);
  const before = o.dumpState();
  oracle(o);
  const changed = changedMinusStack(o, before, o.dumpState());
  assert.equal(changed.get(c.rec + 0x0e), HOLD - 1, "hold counter decremented");
  assert.equal(changed.get(c.rec + 0x03), (c.pos + c.speed) & 0xff, "position integrated");
  assert.equal(changed.get(c.rec + 0x02), (c.state + 1) & 0xff, "state advanced at the bottom row");
  assert.equal(changed.size, 3, `expected exactly 3 writes, got ${changed.size}`);
  console.log("  WRITE-SET: hold, position, state (3 writes)");
});

// -- 3. CRAFTED (carry / borrow) ----------------------------------------------

test("CRAFTED: a carry bumps the row (descend) and a borrow drops it (climb)", () => {
  const cc = CASES[1]; // descend carry
  const oc = craft(cc.rec, cc);
  oracle(oc);
  assert.equal(oc.mem.read8(cc.rec + 0x03), (cc.pos + cc.speed) & 0xff, "descend position wrapped");
  assert.equal(oc.mem.read8(cc.rec + 0x04), (cc.row + 1) & 0xff, "descend carry bumped the row");

  const cb = CASES[4]; // climb borrow
  const ob = craft(cb.rec, cb);
  oracle(ob);
  assert.equal(ob.mem.read8(cb.rec + 0x03), (cb.pos - cb.speed) & 0xff, "climb position underflowed");
  assert.equal(ob.mem.read8(cb.rec + 0x04), (cb.row - 1) & 0xff, "climb borrow dropped the row");
  console.log("  CRAFTED: descend carry row++ and climb borrow row-- confirmed");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong integrated position byte is CAUGHT by the RAM diff", () => {
  const c = CASES[0]; // descend, no carry
  const o = craft(c.rec, c);
  const k = craft(c.rec, c);
  oracle(o);
  advanceEagleDiveClimbToRetireAtLimit(k);
  k.mem.write8(c.rec + 0x03, (o.mem.read8(c.rec + 0x03) ^ 0xff) & 0xff); // BUG: wrong position

  const d = ramDiffMinusStack(o, k);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong integrated position — it is worthless");
  assert.equal(d.addr, c.rec + 0x03, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
