// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawCreditLabel -- seat a fixed sprite-id list (count 0x07, source CREDIT_LABEL_TEXT, screen slot
// CREDIT_LABEL_SCREEN_ADDR) and tail-delegate to the sprite-list driver drawSpriteList (the tail-jump is DISSOLVED into a direct
// call). Live-out: the blitted cells (RAM) plus HL (advanced 0x100 per sprite), DE (past the id list) and
// C (= 0). The oracle push/pops through the stack scratch below the entry SP; the module keeps its walk in
// locals. Run: node --test games/invaders/idiomatic/test/equivalence-193c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_193c as oracleBody } from "../../translated/loc_193c.js";
import { drawCreditLabel } from "../drawCreditLabel.js";
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

const TARGET = 0x193c;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x193c dispatches -- drawCreditLabel == oracle in RAM (-stack), HL, DE and C", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp; // the oracle's driver push residue sits just below the entry SP
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawCreditLabel(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.de, o.regs.de, "DE walked past the id list matches the oracle");
    assert.equal(c.regs.c, o.regs.c, "C drained to 0 matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine with a caller return on the stack; drawCreditLabel supplies its own count/source/slot.
function seat(m) { m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false); }

test("CRAFTED: the preset 0x07-sprite list is blitted; HL += 0x700, DE past the list, C := 0", () => {
  const o = new Machine(ROM); seat(o);
  const c = new Machine(ROM); seat(c);
  oracle(o); drawCreditLabel(c);

  assert.equal(ramDiff(o, c), null, "oracle and module leave identical RAM (-stack)");
  assert.equal(c.regs.hl, u16(0x3501 + 0x100 * 0x07), "HL advanced 0x100 per sprite");
  assert.equal(c.regs.hl, o.regs.hl, "HL matches the oracle");
  assert.equal(c.regs.de, u16(0x1fa9 + 0x07), "DE walked past the id list");
  assert.equal(c.regs.de, o.regs.de, "DE matches the oracle");
  assert.equal(c.regs.c, 0, "C drained to 0");
  assert.equal(c.regs.c, o.regs.c, "C matches the oracle");
});

test("TEETH: a twin that seats the wrong screen slot blits to the wrong place and is caught", () => {
  // Broken twin of drawCreditLabel: real delegation, one mutated constant -- the screen slot is shifted a column.
  const loc_193c_broken = (m) => drawSpriteList(m, 0x1fa9, 0x07, (0x3501 + 0x20) & 0xffff);
  const o = new Machine(ROM); seat(o);
  const c = new Machine(ROM); seat(c);
  oracle(o); loc_193c_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a shifted screen slot");
});
