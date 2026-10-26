// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceIntroPhaseAndDrawHitTally (ROM 0x6f42, Pooyan) — level-intro phase 2: inc the intro
 * phase (0x8f51), then draw the target-hit tally (0x8f52) as two stacked digit pairs through
 * drawStackedBcdDigits (0x1119). A nonzero tally is packed via binToPackedBcd (0x1131) and drawn at
 * HUD base 0x8634; the tally is then doubled in BCD (the ROM's `add a,a`/`daa`) and drawn two rows
 * up at 0x85d4. Each pair is tens at the cursor + units one row up (-0x20).
 *
 * CYCLE-FREE / memory-equivalence gate. Writes video + work RAM, so each case runs the oracle on
 * one FRESH clone and advanceIntroPhaseAndDrawHitTally on another, compared on RAM (dumpState, minus stack scratch below the entry SP). pc/SP
 * are NOT compared; there is no register live-out (an intro phase handler; no caller reads a
 * register back). The oracle's calls to 0x1119/0x1131 resolve through the translated registry
 * `new Machine(ROM)` builds; the gate cross-checks the idiomatic drawStackedBcdDigits/binToPackedBcd
 * against the translated routines.
 *
 * Jobs:
 *   1. EQUAL (crafted) — tally 0 (skip path) and 1/10/20/255 leave identical RAM(−stack).
 *   2. WRITE-SET — a run writes only the phase byte + the four digit tiles.
 *   3. TEETH — a wrong tile at the HUD base is caught there.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6f42.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6f42 as oracle } from "../../translated/loc_6f42.js";
import { advanceIntroPhaseAndDrawHitTally } from "../advanceIntroPhaseAndDrawHitTally.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const INTRO_PHASE = 0x8f51;
const HIT_TALLY = 0x8f52;
const HUD_BASE = 0x8634;
const FIRST_UNITS = (HUD_BASE + 0xffe0) & 0xffff; // 0x8614
const SECOND_TENS = (HUD_BASE + 0xffa0) & 0xffff; // 0x85d4 (two rows up)
const SECOND_UNITS = (SECOND_TENS + 0xffe0) & 0xffff; // 0x85b4
const HUD_CELLS = [HUD_BASE, FIRST_UNITS, SECOND_TENS, SECOND_UNITS];
const WRITTEN = new Set([INTRO_PHASE, ...HUD_CELLS]);
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone: phase + tally seeded, the four HUD tiles pre-dirtied, SP parked in dead scratch. */
function craft(tally) {
  const m = BASE.clone();
  m.mem.write8(INTRO_PHASE, 0x02);
  m.mem.write8(HIT_TALLY, tally & 0xff);
  for (const cell of HUD_CELLS) m.mem.write8(cell, 0xee); // sentinel so digit writes are observable
  m.regs.sp = 0x8ffe;
  return m;
}

const CASES = [0x00, 0x01, 0x0a, 0x14, 0xff];

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: crafted tallies — advanceIntroPhaseAndDrawHitTally == oracle in RAM(−stack)", () => {
  for (const tally of CASES) {
    const o = craft(tally);
    const c = craft(tally);
    oracle(o);
    advanceIntroPhaseAndDrawHitTally(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} (tally ${hx(tally)}): oracle=${d.a} mine=${d.b}`);
    assert.equal(c.mem.read8(INTRO_PHASE), o.mem.read8(INTRO_PHASE), `phase byte mismatch (tally ${hx(tally)})`);
    for (const cell of HUD_CELLS) {
      assert.equal(c.mem.read8(cell), o.mem.read8(cell), `HUD tile ${hx(cell)} mismatch (tally ${hx(tally)})`);
    }
  }
  console.log(`  EQUAL: ${CASES.length} tallies identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a run writes only the phase byte + the four digit tiles", () => {
  const before = craft(0x14); // 20 -> both pairs have a nonzero tens digit
  const after = craft(0x14);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push(addr);
    }
  }
  for (const addr of changed) assert.ok(WRITTEN.has(addr), `unexpected write at ${hx(addr)}`);
  assert.ok(changed.includes(INTRO_PHASE), "phase byte should have changed");
  assert.ok(changed.includes(HUD_BASE), "first tens tile should have changed");
  console.log(`  WRITE-SET: ${changed.length} writes, all within {phase} + the four digit tiles`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong tile at the HUD base is caught there", () => {
  const o = craft(0x14);
  const c = craft(0x14);
  oracle(o);
  advanceIntroPhaseAndDrawHitTally(c);
  c.mem.write8(HUD_BASE, (c.mem.read8(HUD_BASE) ^ 0xff) & 0xff); // BUG: corrupt the first tens tile
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong HUD tile — it is worthless");
  assert.equal(d.addr, HUD_BASE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong HUD tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
