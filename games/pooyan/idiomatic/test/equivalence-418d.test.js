// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceObjectCountdownAndEmitDisplayCommand (ROM 0x418d) — countdown step for the object record at IX.
 * Advances the record's animation (advanceObjectAnimationFrame), then decrements the timer at rec+0x11 and returns
 * while it is still non-zero. On expiry it enqueues a display command (type 0x03, low byte 0x12 +
 * the record's adjusted rec+0x16 — one less when non-zero), re-seats rec+0x11=1, stores rec+0x16+1
 * into rec+0x13, sets rec+0x02=2, and tails into advanceObjectDwellThenBlankBand (which — since rec+0x11 is now 1 — steps
 * the animation once more, decrements it to 0, and blanks the record's sprite band).
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case uses a FRESH clone
 * per side. Contract: RAM (dumpState minus stack scratch below the entry SP) ONLY — every callee is memory-only and no
 * caller reads a register back (the shared tail is entered by fall-through / dispatch). pc/SP/cycles
 * are NOT compared.
 *
 * The record is based at IX; every case is CRAFTED. rec+0x0e (the animation hold) is seated non-zero
 * so advanceObjectAnimationFrame merely decrements it (no script walk), and the timer + seed fields are seated on both
 * sides. On the expiry path advanceObjectDwellThenBlankBand's tail blanks rec+0x00..0x16, so the field writes are wiped and
 * the observable net effect is the blanked record plus the enqueued command / advanced ring pointer.
 *
 * Jobs:
 *   1. EQUAL — the still-counting path and both expiry sub-cases (seed zero / non-zero) agree in
 *      RAM (−stack), covering the enqueued command word and the record blank.
 *   2. WRITE-SET — the still-counting path writes exactly rec+0x0e and rec+0x11 (the two counters).
 *   3. TEETH — a twin with a wrong blanked record byte (expiry path) and a twin with a wrong timer
 *      (still-counting path) are both CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-418d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_418d as oracle } from "../../translated/loc_418d.js";
import { advanceObjectCountdownAndEmitDisplayCommand } from "../advanceObjectCountdownAndEmitDisplayCommand.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ba0;   // work-RAM record base (IX)
const REC_LEN = 0x18;
const HOLD = 0x0e;    // animation hold offset advanceObjectAnimationFrame decrements
const TIMER = 0x11;   // countdown timer offset
const SEED = 0x16;    // source of the command offset + rec+0x13 value
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: record pre-dirtied to 0xAA, hold/timer/seed seated, IX=REC. */
function craft(scn) {
  const m = BASE.clone();
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, 0xaa);
  m.mem.write8(REC + HOLD, 0x03); // non-zero: advanceObjectAnimationFrame just decrements the hold this frame
  m.mem.write8(REC + TIMER, scn.timer);
  m.mem.write8(REC + SEED, scn.seed);
  m.regs.ix = REC;
  m.regs.sp = 0x8ffe; // dead-stack scratch
  return m;
}

const CASES = [
  { name: "still counting",   timer: 0x02, seed: 0x03 },
  { name: "expiry seed != 0", timer: 0x01, seed: 0x03 },
  { name: "expiry seed == 0", timer: 0x01, seed: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: counting + both expiry sub-cases — advanceObjectCountdownAndEmitDisplayCommand == oracle in RAM (−stack)", () => {
  for (const scn of CASES) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    advanceObjectCountdownAndEmitDisplayCommand(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${scn.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the still-counting path writes exactly rec+0x0e and rec+0x11", () => {
  const scn = CASES[0];
  const c = craft(scn);
  const before = c.dumpState();
  advanceObjectCountdownAndEmitDisplayCommand(c);
  const after = c.dumpState();

  const changed = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) changed.push(c.stateOffsetToAddr(off));
  }
  const expected = [REC + HOLD, REC + TIMER].sort((a, b) => a - b);
  assert.deepEqual(changed.sort((a, b) => a - b), expected, `unexpected write footprint: ${changed.map(hx)}`);
  assert.equal(c.mem.read8(REC + HOLD), 0x02, "hold decremented 0x03 -> 0x02");
  assert.equal(c.mem.read8(REC + TIMER), 0x01, "timer decremented 0x02 -> 0x01 (still counting)");
  console.log("  WRITE-SET: still-counting writes rec+0x0e=0x02, rec+0x11=0x01 (2 cells)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong blanked record byte on the expiry path is CAUGHT by the RAM diff", () => {
  const scn = CASES[1]; // expiry: advanceObjectDwellThenBlankBand's tail blanks rec+0x00..0x16 (rec+0x02 -> 0)
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  advanceObjectCountdownAndEmitDisplayCommand(c);
  c.mem.write8(REC + 0x02, 0x55); // BUG: the expiry tail blanks rec+0x02 to 0

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong blanked byte — it is worthless");
  assert.equal(d.addr, REC + 0x02, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong blanked byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong timer on the still-counting path is CAUGHT by the RAM diff", () => {
  const scn = CASES[0];
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  advanceObjectCountdownAndEmitDisplayCommand(c);
  c.mem.write8(REC + TIMER, scn.timer); // BUG: timer not decremented

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-decremented timer — it is worthless");
  assert.equal(d.addr, REC + TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: non-decremented timer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
