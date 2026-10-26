// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runSelfTestAndInitMachineState (ROM 0x0092) — the power-on boot entry.
 *
 * runSelfTestAndInitMachineState checksums the eight program-memory banks (writing a pass tally the play-state gate later
 * requires), then lays down the whole initial machine state: clears work RAM, empties the two command
 * rings, floods the colour map, arms the tile fill, decodes both DIP-switch ports, clears the sprite
 * banks and blanks the lower tile map, enables the vblank interrupt, seeds the high-score table, and
 * finally hands control to the main-loop generator (`jp` into the main loop in the frozen
 * form; a returned generator in the idiomatic form).
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The contract is RAM (dumpState, minus
 * stack scratch below the entry SP) with NO register live-out (the routine transfers into the main loop and no register
 * survives as a consumed value), PLUS one dedicated cell:
 *
 *   THE SELF-TEST TALLY (0x8FFF) IS LOAD-BEARING BUT LIVES INSIDE STACK_SCRATCH. The frozen boot sets
 *   SP to 0x9000 and its very first push seats the bank count into 0x8FFF, which the self-test then
 *   increments per matching bank; blankFillRowThenFinishAttractSetup reads 0x8FFF and requires 0x10 (a full pass) to finish
 *   setup. Because 0x8FFF sits in the excluded stack window (0x8FC0-0x8FFF), ramDiffMinusStack cannot
 *   see it, so this test compares it with a DEDICATED arm — otherwise the tally would go unverified.
 *
 * pc/SP/cycles are NOT compared. The frozen tail call into the never-returning main loop is neutralised
 * by stubbing routine 0x020F to a no-op on the frozen side; the idiomatic side builds — but does not
 * run — the main-loop generator, so both stop at boot-complete. The only external inputs besides the
 * fixed program image are the two DIP-switch ports, which every case CRAFTS identically on both sides.
 *
 * Jobs:
 *   1. EQUAL (crafted DSW sweep) — over curated (DSW0, DSW1) pairs oracle == runSelfTestAndInitMachineState in RAM (−stack)
 *      AND in the dedicated tally cell (both 0x10, a full self-test pass on the intact image).
 *   2. WRITE-SET — the boot's key written cells hold their exact expected values (colour flood + its
 *      one-cell tile-map spill, blank region, config cells, rings, sprite fill, high-score seed, tally).
 *   3. TEETH — a wrong dumped byte MUST be caught by the RAM diff, and a wrong tally by the dedicated
 *      arm (proving that arm load-bearing, since the RAM diff excludes 0x8FFF).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0092.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0092 as oracle } from "../../translated/loc_0092.js";
import { runSelfTestAndInitMachineState } from "../runSelfTestAndInitMachineState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// 0x8FFF: the ROM self-test pass tally. It is a real, consumed cell (blankFillRowThenFinishAttractSetup needs it == 0x10) but
// it lives inside the excluded stack window, so it gets a dedicated comparison arm below.
const TALLY_ADDR = 0x8fff;
const FULL_PASS = 0x10; // bank count + eight matches on an intact image
const MAIN_LOOP_ADDR = 0x020f;

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x9000);

/** First RAM difference minus the stack scratch below the entry SP (the frozen boot's transient stack). */
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

// Stub the main-loop routine so the frozen boot's tail `m.call(0x020f)` returns instead of entering
// the never-returning main loop. clone() preserves this routines map, so both craft sides carry it.
const BASE = ROM_PRESENT
  ? new Machine(ROM, { overrides: [[MAIN_LOOP_ADDR, () => undefined]] }).clone()
  : null;

/** A fresh clone with the two DIP-switch ports seated identically (the routine's only inputs). */
function craft(dsw0, dsw1) {
  const m = BASE.clone();
  m.io.dsw0 = dsw0 & 0xff;
  m.io.dsw1 = dsw1 & 0xff;
  m.regs.sp = 0x9000; // the frozen boot sets this itself; seated here only for cleanliness
  return m;
}

// Curated DIP combos: the idle defaults, the two extremes, and mixes that drive the coinage-table
// lookups and the lives-decode's max branch (DSW1 low two bits = 00 -> complemented == 3 -> 0xff).
const CASES = [
  { dsw0: 0xff, dsw1: 0x7b }, // idle defaults
  { dsw0: 0x00, dsw1: 0x00 }, // all-zero ports
  { dsw0: 0xff, dsw1: 0xff }, // all-ones ports
  { dsw0: 0x5a, dsw1: 0x7c }, // mixed coinage + lives-max branch
  { dsw0: 0xa5, dsw1: 0x39 }, // mixed
  { dsw0: 0x3c, dsw1: 0xc6 }, // mixed
];

// -- 1. EQUAL (crafted DSW sweep) ---------------------------------------------

test("EQUAL: crafted DSW pairs — runSelfTestAndInitMachineState == oracle in RAM (−stack) + the self-test tally", () => {
  for (const { dsw0, dsw1 } of CASES) {
    const o = craft(dsw0, dsw1);
    const c = craft(dsw0, dsw1);
    oracle(o);
    runSelfTestAndInitMachineState(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (DSW0=${hx(dsw0)} DSW1=${hx(dsw1)})`);

    // Dedicated tally arm: excluded from the RAM diff, so compared explicitly.
    assert.equal(
      c.mem.read8(TALLY_ADDR),
      o.mem.read8(TALLY_ADDR),
      `tally mismatch for DSW0=${hx(dsw0)} DSW1=${hx(dsw1)}`,
    );
    assert.equal(o.mem.read8(TALLY_ADDR), FULL_PASS, "the intact image must produce a full self-test pass");
  }
  console.log(`  EQUAL: ${CASES.length} crafted DSW cases identical (RAM −stack + tally == ${hx(FULL_PASS)})`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the boot's key cells hold their exact expected values", () => {
  const { dsw0, dsw1 } = CASES[0];
  const o = craft(dsw0, dsw1);
  oracle(o);
  const r = (a) => o.mem.read8(a);

  // colour map flooded to 0x10, spilling one cell into the tile map's first cell
  assert.equal(r(0x8000), 0x10, "colour-map base flooded");
  assert.equal(r(0x83ff), 0x10, "colour-map end flooded");
  assert.equal(r(0x8400), 0x10, "one flood cell spills into the tile-map base");
  // lower tile map blanked to 0x1e, first blank cell one row below the spill
  assert.equal(r(0x8440), 0x1e, "lower tile map blanked");
  assert.equal(r(0x87ff), 0x1e, "tile map blanked to its end");

  // command rings emptied (0xff), read/write cursors parked at the origin
  assert.equal(r(0x88c0), 0xff, "display-command ring emptied");
  assert.equal(r(0x88ff), 0xff, "display-command ring emptied to its end");
  assert.equal(r(0x88a0), 0xc0, "display-ring write cursor at origin");
  assert.equal(r(0x88a1), 0xc0, "display-ring read cursor at origin");
  assert.equal(r(0x8a43), 0xff, "sound-command ring emptied");
  assert.equal(r(0x8a40), 0x43, "sound-ring write cursor at origin");
  assert.equal(r(0x8a41), 0x43, "sound-ring read cursor at origin");

  // config + loose cells
  assert.equal(r(0x881f), 1, "flip-screen flag set (upright)");
  assert.equal(r(0x8a42), 8, "loose sound-side cell seeded");
  assert.ok(r(0x8807) === 3 || r(0x8807) === 4 || r(0x8807) === 5 || r(0x8807) === 0xff, "lives decoded");

  // sprite banks filled with the low-nibble coinage byte
  assert.equal(r(0x9010), r(0x882c), "sprite bank 0 filled with the coinage byte");
  assert.equal(r(0x9410), r(0x882c), "sprite bank 1 filled with the coinage byte");

  // default high-score table: ten (0,0,1) triples + the top-score high byte
  assert.equal(r(0x8a00), 0, "high-score entry 0 byte 0");
  assert.equal(r(0x8a02), 1, "high-score entry 0 byte 2");
  assert.equal(r(0x8a1b), 0, "high-score entry 9 byte 0");
  assert.equal(r(0x8a1d), 1, "high-score entry 9 byte 2");
  assert.equal(r(0x88aa), 1, "top-score high byte");

  // the self-test tally
  assert.equal(r(TALLY_ADDR), FULL_PASS, "self-test tally is a full pass");
  console.log("  WRITE-SET: colour flood + spill, blank region, rings, config, sprites, hi-score, tally");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong dumped byte is CAUGHT by the RAM diff", () => {
  const { dsw0, dsw1 } = CASES[0];
  const o = craft(dsw0, dsw1);
  const c = craft(dsw0, dsw1);
  oracle(o);
  runSelfTestAndInitMachineState(c);
  c.mem.write8(0x8807, (c.mem.read8(0x8807) + 1) & 0xff); // BUG: corrupt the decoded lives cell

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong config byte — it is worthless");
  assert.equal(d.addr, 0x8807, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected 0x8807)`);
  console.log(`  TEETH/RAM: wrong lives byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong tally is CAUGHT only by the dedicated arm (RAM diff excludes 0x8FFF)", () => {
  const { dsw0, dsw1 } = CASES[0];
  const o = craft(dsw0, dsw1);
  const c = craft(dsw0, dsw1);
  oracle(o);
  runSelfTestAndInitMachineState(c);
  c.mem.write8(TALLY_ADDR, (c.mem.read8(TALLY_ADDR) + 1) & 0xff); // BUG: corrupt the pass tally

  // The RAM diff is blind to this (0x8FFF is inside STACK_SCRATCH) — proving the dedicated arm's worth.
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: the RAM diff excludes the tally cell");
  assert.notEqual(
    c.mem.read8(TALLY_ADDR),
    o.mem.read8(TALLY_ADDR),
    "the dedicated tally arm FAILED to catch a wrong tally — it is worthless",
  );
  console.log(`  TEETH/TALLY: wrong tally caught by the dedicated arm (oracle=${hx(o.mem.read8(TALLY_ADDR))} broken=${hx(c.mem.read8(TALLY_ADDR))})`);
});
