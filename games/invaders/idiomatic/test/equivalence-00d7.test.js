// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_00d7 -- seed the mirrored per-player cells (0x21fb/0x22fb) with 0x02, then
// blank a fixed 0x20-column screen strip (dissolved into blankScreenStrip -> clearScreenStrip). blankScreenStrip short-
// circuits when its mode-guard cell (0x20ce) is nonzero, leaving the strip and HL untouched -- but the two
// per-player cells are seeded unconditionally, ahead of the tail. Live-out: RAM (the two cells + the
// cleared strip) AND HL (the strip end pointer, or entry HL when the guard short-circuits). The oracle
// push/pops through the stack scratch below the entry SP; the module drops the save/restore, so CAPTURE
// excludes relative to that SP and CRAFTED excludes STACK_SCRATCH below the entry SP.
// Run: node --test games/invaders/idiomatic/test/equivalence-00d7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_00d7 as oracleBody } from "../../translated/loc_00d7.js";
import { loc_00d7 } from "../loc_00d7.js";
import { blankScreenStrip } from "../blankScreenStrip.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x00d7;
const GUARD = 0x20ce;    // blankScreenStrip's mode guard: nonzero => short-circuit
const P1_CELL = 0x21fb;  // mirrored per-player cells, both seeded with 0x02
const P2_CELL = 0x22fb;
const STRIP = 0x391c;
const STRIP_END = (STRIP + 0x20 * 0x20) & 0xffff; // 0x391c + 0x20 columns * 0x20 stride
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x00d7 dispatches -- loc_00d7 == oracle in RAM (-stack) and HL", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp; // the strip clear's per-row `push b` residue sits just below the entry SP
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); loc_00d7(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.mem.read8(P1_CELL), 0x02, "player-1 cell seeded");
    assert.equal(c.mem.read8(P2_CELL), 0x02, "player-2 cell seeded");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A real caller return on the stack, a decoy A (the module never reads it), a decoy HL, the guard cell,
// and a pre-marked strip so the guard-clear path visibly zeroes it.
function seat(m, { guard, hl }) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.regs.a = 0x55; m.regs.hl = hl;
  m.mem.write8(GUARD, guard);
  for (let k = 0; k < 0x20; k++) m.mem.write8((STRIP + k * 0x20) & 0xffff, 0xff);
}

test("CRAFTED: cells always seeded 0x02; guard set -> strip/HL untouched, guard clear -> strip blanked", () => {
  // guard nonzero: the strip and HL are left alone, but the two cells are still seeded.
  {
    const CASE = { guard: 0x05, hl: 0x1234 };
    const o = new Machine(ROM); seat(o, CASE);
    const c = new Machine(ROM); seat(c, CASE);
    oracle(o); loc_00d7(c);
    assert.equal(ramDiff(o, c), null, "guard set: identical RAM (-stack)");
    assert.equal(c.regs.hl, CASE.hl, "guard set: HL left at entry HL");
    assert.equal(c.regs.hl, o.regs.hl, "guard set: HL matches oracle");
    assert.equal(c.mem.read8(P1_CELL), 0x02, "guard set: player-1 cell seeded");
    assert.equal(c.mem.read8(P2_CELL), 0x02, "guard set: player-2 cell seeded");
    assert.equal(c.mem.read8(STRIP), 0xff, "guard set: strip NOT cleared");
  }
  // guard zero: the strip is blanked and HL := its end pointer.
  {
    const CASE = { guard: 0x00, hl: 0x1234 };
    const o = new Machine(ROM); seat(o, CASE);
    const c = new Machine(ROM); seat(c, CASE);
    oracle(o); loc_00d7(c);
    assert.equal(ramDiff(o, c), null, "guard clear: identical RAM (-stack)");
    assert.equal(c.regs.hl, STRIP_END, "guard clear: HL := strip end pointer");
    assert.equal(c.regs.hl, o.regs.hl, "guard clear: HL matches oracle");
    assert.equal(c.mem.read8(P1_CELL), 0x02, "guard clear: player-1 cell seeded");
    assert.equal(c.mem.read8(P2_CELL), 0x02, "guard clear: player-2 cell seeded");
    assert.equal(c.mem.read8(STRIP), 0x00, "guard clear: first strip column zeroed");
    assert.equal(c.mem.read8((STRIP + 0x1f * 0x20) & 0xffff), 0x00, "guard clear: last strip column zeroed");
  }
});

test("TEETH: a twin that seeds the wrong cell value diverges in RAM at the first cell", () => {
  // Mutate loc_00d7's OWN contribution: it seeds 0x03 instead of 0x02 (the tail is unchanged).
  function loc_00d7_broken(m) {
    m.mem8[P1_CELL] = 0x03; // BUG: wrong seed value
    m.mem8[P2_CELL] = 0x03;
    return blankScreenStrip(m);
  }
  const CASE = { guard: 0x00, hl: 0x1234 };
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); loc_00d7_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a wrong seed value");
  assert.equal(d.addr, P1_CELL, "first divergence is the mis-seeded player-1 cell");
});
