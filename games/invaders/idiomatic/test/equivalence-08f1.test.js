// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawThreeSprites -- seed a fixed 3-entry count then run the sprite-list driver
// (DISSOLVED into drawSpriteList): for those 3 ids starting at DE, blit each sprite down the screen from HL,
// advancing the id pointer per sprite until the count drains. The incoming C is IGNORED (forced to 3).
// Live-out: the blitted cells (RAM), HL (advanced 0x100 per sprite), DE (= entry DE + 3), C (= 0). The
// oracle push/pops DE (and the delegate's HL/BC) through the stack scratch below the entry SP; the module
// keeps its walk in locals, so CAPTURE excludes relative to that SP and CRAFTED excludes STACK_SCRATCH below the entry SP.
// Run: node --test games/invaders/idiomatic/test/equivalence-08f1.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08f1 as oracleBody } from "../../translated/loc_08f1.js";
import { drawThreeSprites } from "../drawThreeSprites.js";
import { drawSpriteList } from "../drawSpriteList.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { u16 } from "../../../../core/int.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x08f1;
const CALLER_RET = 0xabcd;
const COUNT = 3;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x08f1 dispatches -- drawThreeSprites == oracle in RAM (-stack), HL, DE and C", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp; // the oracle's push d + delegate push residue sits just below the entry SP
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawThreeSprites(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.de, o.regs.de, "DE walked to the end matches the oracle");
    assert.equal(c.regs.c, o.regs.c, "C drained to 0 matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine: a caller return on the stack, a list of ids at DE, a screen base at HL. C is
// seeded WRONG (0x07) to prove drawThreeSprites forces the count to 3 and ignores the incoming C.
function seat(m, { hl, de, ids }) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.regs.hl = hl; m.regs.de = de; m.regs.c = 0x07;
  ids.forEach((v, i) => m.mem.write8((de + i) & 0xffff, v));
}

test("CRAFTED: 3 ids blitted (incoming C ignored); HL += 0x300, DE += 3, C := 0", () => {
  const CASE = { hl: 0x2500, de: 0x2100, ids: [0x01, 0x08, 0x10] };
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); drawThreeSprites(c);

  assert.equal(ramDiff(o, c), null, "oracle and module leave identical RAM (-stack)");
  assert.equal(c.regs.hl, u16(CASE.hl + 0x100 * COUNT), "HL advanced 0x100 per sprite");
  assert.equal(c.regs.hl, o.regs.hl, "HL matches the oracle");
  assert.equal(c.regs.de, u16(CASE.de + COUNT), "DE walked past the 3-id list");
  assert.equal(c.regs.de, o.regs.de, "DE matches the oracle");
  assert.equal(c.regs.c, 0, "C drained to 0");
  assert.equal(c.regs.c, o.regs.c, "C matches the oracle");
  for (let s = 0; s < COUNT; s++) {
    const slot = u16(CASE.hl + 0x100 * s);
    assert.equal(c.mem.read8(slot), c.mem.read8(u16(0x1e00 + 8 * CASE.ids[s])), `sprite ${s} blitted`);
  }
});

test("TEETH: a twin that seeds a count of two blits one sprite short and is caught", () => {
  // Mutate drawThreeSprites's OWN logic: seed 2 entries instead of 3 -- the third sprite is never blitted.
  const loc_08f1_broken = (m, de = m.regs.de) => drawSpriteList(m, de, 0x02); // BUG: count 2, not 3
  const CASE = { hl: 0x2500, de: 0x2100, ids: [0x01, 0x08, 0x10] };
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); loc_08f1_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a short sprite count");
});
