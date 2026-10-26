// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorAnimationsUnlessGrabbing (ROM 0x22b1) — "run the animation stepper over four actor
 * records, unless a rope-grab is active". Gated on GRAB_ACTIVE_FLAG==0; IX walks the actor table in
 * 0x18-byte strides (0x8a80, 0x8a98, 0x8ab0, 0x8ac8), invoking advanceActorAnimationFrame on each.
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) PLUS the register live-out. On the run path the loop leaves IX at the fourth record
 * and DE at the stride (advanceActorAnimationFrame leaves both untouched, verified by its own gate); both are the
 * routine's own deterministic output, checked against the oracle clone. On the skip path IX/DE are
 * untouched. (A/HL are advanceActorAnimationFrame's internal residue and are NOT part of the contract — see notes.)
 *
 * Jobs:
 *   1. EQUAL (crafted) — a run with all four frame-countdowns live (four in-place decrements), a run
 *      that pulls fresh script entries into all four records, and a skip: oracle == advanceActorAnimationsUnlessGrabbing in RAM
 *      (−stack), IX, and DE; the module SETS IX/DE on the run path and leaves them on the skip path.
 *   2. WRITE-SET — the countdown-live run writes exactly the four records' countdown cells.
 *   3. TEETH — a twin that corrupts the fourth record is caught in RAM; a twin that under-advances
 *      IX (stops one record short) is caught by the IX live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-22b1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_22b1 as oracle } from "../../translated/loc_22b1.js";
import { advanceActorAnimationsUnlessGrabbing } from "../advanceActorAnimationsUnlessGrabbing.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE, GRAB_ACTIVE_FLAG, ANIM_SCRIPT_CURSOR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const STRIDE = 0x18;
const OFF_DELAY = 0x0e; // per-record frame countdown advanceActorAnimationFrame ticks
const RECS = [ACTOR_TABLE, ACTOR_TABLE + STRIDE, ACTOR_TABLE + 2 * STRIDE, ACTOR_TABLE + 3 * STRIDE];
const FINAL_IX = RECS[3]; // 0x8ac8
const DECOY_IX = 0x1234;
const DECOY_DE = 0x5678;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the grab gate set and each record's countdown seated; IX/DE seated as decoys. */
function craft({ grab, delays, pull }) {
  const m = BASE.clone();
  m.mem.write8(GRAB_ACTIVE_FLAG, grab);
  RECS.forEach((rec, i) => m.mem.write8(rec + OFF_DELAY, delays[i]));
  if (pull) {
    // point the shared script cursor at a controlled run of non-0xff {tile,colour,delay} bytes, so
    // each record pulls a fresh entry and the cursor advances 3 bytes per record.
    m.mem.write16(ANIM_SCRIPT_CURSOR, 0x8b00);
    for (let i = 0; i < 12; i++) m.mem.write8(0x8b00 + i, 0x10);
  }
  m.regs.ix = DECOY_IX;
  m.regs.de = DECOY_DE;
  m.regs.sp = 0x8ffe;
  return m;
}

const RUN_TICK = { grab: 0, delays: [0x05, 0x03, 0x08, 0x01], pull: false };
const RUN_PULL = { grab: 0, delays: [0x00, 0x00, 0x00, 0x00], pull: true };
const SKIP = { grab: 1, delays: [0x05, 0x03, 0x08, 0x01], pull: false };

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted run/skip cases — advanceActorAnimationsUnlessGrabbing == oracle in RAM (−stack) + IX + DE", () => {
  for (const cs of [RUN_TICK, RUN_PULL, SKIP]) {
    const o = craft(cs);
    oracle(o);

    const c = craft(cs);
    const ret = advanceActorAnimationsUnlessGrabbing(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (grab=${cs.grab} pull=${cs.pull})`);
    assert.equal(c.regs.ix & 0xffff, o.regs.ix & 0xffff, `IX mismatch (grab=${cs.grab})`);
    assert.equal(c.regs.de & 0xffff, o.regs.de & 0xffff, `DE mismatch (grab=${cs.grab})`);
    if (cs.grab === 0) {
      assert.deepEqual([ret[0] & 0xffff, ret[1] & 0xffff], [FINAL_IX, STRIDE], "run path returns [IX, DE]");
      assert.equal(o.regs.ix & 0xffff, FINAL_IX, "oracle IX at the fourth record");
      assert.equal(o.regs.de & 0xffff, STRIDE, "oracle DE at the stride");
    } else {
      assert.equal(ret, undefined, "skip path returns nothing");
      assert.equal(o.regs.ix & 0xffff, DECOY_IX, "skip leaves IX untouched");
    }
  }
  console.log("  EQUAL: run(tick), run(pull), skip identical (RAM −stack + IX + DE)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the countdown-live run writes exactly the four records' countdown cells", () => {
  const m = craft(RUN_TICK);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    const addr = m.stateOffsetToAddr(off);
    if (b0[off] !== a1[off] && !inDeadStack(addr)) changed.push({ addr, to: a1[off] });
  }
  const addrs = changed.map((ch) => ch.addr).sort((x, y) => x - y);
  assert.deepEqual(addrs, RECS.map((r) => r + OFF_DELAY), "only the four countdown cells change");
  RECS.forEach((rec, i) => assert.equal(m.mem.read8(rec + OFF_DELAY), RUN_TICK.delays[i] - 1, `record ${i} decremented`));
  console.log("  WRITE-SET: 4 countdown cells decremented");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted fourth record is CAUGHT by the RAM diff", () => {
  const o = craft(RUN_TICK);
  const c = craft(RUN_TICK);
  oracle(o);
  advanceActorAnimationsUnlessGrabbing(c);
  c.mem.write8(RECS[3] + OFF_DELAY, 0xaa); // BUG: fourth record wrong
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted record — it is worthless");
  assert.equal(d.addr, RECS[3] + OFF_DELAY, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): corrupted fourth record caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: an under-advanced IX is CAUGHT by the live-out check", () => {
  const o = craft(RUN_TICK);
  oracle(o);
  const short = RECS[2]; // stopped one record short
  assert.notEqual(short & 0xffff, o.regs.ix & 0xffff, "the IX live-out check must reject an under-advanced pointer");
  console.log(`  TEETH(IX): under-advanced ${hx(short)} rejected against oracle IX=${hx(o.regs.ix)}`);
});
