// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for findLiveAlienInColumn (ROM 0x062f) -- scan five object slots (stride 0x0b) on page
// ACTIVE_PLAYER_PAGE from low byte C-1. No RAM write. THREE live-outs (from the oracle): the carry flag (set
// on the first non-empty slot, else the final adi's carry), C decremented once, and L -- the low byte of the
// found slot, which the caller feeds to alienIndexToScreenCoords. A leaf: it omits the ROM ret and the seam
// completes it, so the arms compare RAM (-stack) + carry + C + L, NOT pc/SP.
// Run: node --test games/invaders/idiomatic/test/equivalence-062f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_062f as oracleBody } from "../../translated/loc_062f.js";
import { findLiveAlienInColumn } from "../findLiveAlienInColumn.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { seamPlaceable } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ACTIVE_PLAYER_PAGE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x062f;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
// 0x062f runs only from stepAlienShot's alien-shot SPAWN path -- a gameplay state the attract boot does not
// reach (0 dispatches through 12000 frames), gated on the clock-free block that would let a poke-tape drive
// gameplay. Until then the CRAFTED cases below (real oracle vs idiomatic, seeded slots) carry the check.
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x062f dispatches -- findLiveAlienInColumn == oracle in RAM (-stack), carry, C and L", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); findLiveAlienInColumn(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.fC, o.regs.fC, "carry live-out matches the oracle");
    assert.equal(c.regs.c, o.regs.c, "C live-out matches the oracle");
    assert.equal(c.regs.l, o.regs.l, "L live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: carry on the first non-empty slot; C := C-1; no RAM write", () => {
  const cases = [
    { page: 0x21, cIn: 0x0c, slots: [1, 0, 0, 0, 0], hit: true },   // first slot non-empty
    { page: 0x21, cIn: 0x0c, slots: [0, 0, 5, 0, 0], hit: true },   // third slot non-empty
    { page: 0x21, cIn: 0x01, slots: [0, 0, 0, 0, 0], hit: false },  // no hit, low start -> no final carry
    { page: 0x21, cIn: 0xca, slots: [0, 0, 0, 0, 0], hit: false },  // no hit, high start -> final adi overflows
  ];
  for (const { page, cIn, slots, hit } of cases) {
    const seed = (m) => {
      m.regs.c = cIn;
      m.mem.write8(ACTIVE_PLAYER_PAGE, page);
      let l = (cIn - 1) & 0xff;
      for (const v of slots) { m.mem.write8(((page << 8) | l) & 0xffff, v); l = (l + 0x0b) & 0xff; }
      m.io.setInte(false);
    };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); findLiveAlienInColumn(c);
    const tag = `page=0x${page.toString(16)} c=0x${cIn.toString(16)} hit=${hit}`;
    assert.equal(ramDiff(o, c), null, `no RAM write: ${tag}`);
    assert.equal(c.regs.fC, hit ? true : o.regs.fC, `carry: ${tag}`);
    assert.equal(c.regs.fC, o.regs.fC, `carry matches oracle: ${tag}`);
    assert.equal(c.regs.c, (cIn - 1) & 0xff, `C decremented: ${tag}`);
    assert.equal(c.regs.c, o.regs.c, `C matches oracle: ${tag}`);
    assert.equal(c.regs.l, o.regs.l, `L (slot low byte) matches oracle: ${tag}`);
  }
});

test("TEETH: a twin that drops the L live-out leaves the wrong slot index", () => {
  const page = 0x21, cIn = 0x0c;
  const seed = (m) => { m.regs.c = cIn; m.mem.write8(ACTIVE_PLAYER_PAGE, page); m.mem.write8(((page << 8) | (((cIn - 1) + 0x16) & 0xff)) & 0xffff, 5); m.io.setInte(false); };
  const o = new Machine(ROM); seed(o);
  oracle(o);
  const brokenL = (cIn - 1) & 0xff; // BUG: leaves the START low byte, not the found slot's
  assert.notEqual(brokenL, o.regs.l, "the L live-out check FAILED to catch a dropped slot index");
});

test("TEETH: a twin that never sets carry mis-reports a hit", () => {
  const page = 0x21, cIn = 0x0c;
  const seed = (m) => { m.regs.c = cIn; m.mem.write8(ACTIVE_PLAYER_PAGE, page); m.mem.write8(((page << 8) | ((cIn - 1) & 0xff)) & 0xffff, 1); m.io.setInte(false); };
  const o = new Machine(ROM); seed(o);
  oracle(o);
  const brokenCarry = false; // BUG: never flags the non-empty slot
  assert.notEqual(brokenCarry, o.regs.fC, "the carry live-out check FAILED to catch a dropped hit flag");
});

test("TEETH: a twin that forgets to decrement C leaves the wrong C live-out", () => {
  const page = 0x21, cIn = 0x0c;
  const seed = (m) => { m.regs.c = cIn; m.mem.write8(ACTIVE_PLAYER_PAGE, page); m.io.setInte(false); };
  const o = new Machine(ROM); seed(o);
  oracle(o);
  const brokenC = cIn; // BUG: never decremented
  assert.notEqual(brokenC, o.regs.c, "the C live-out check FAILED to catch a missing dcr c");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x2400;
  m.mem.write16(0x2400, 0xabcd); // a real caller-return word for the seam to consume
  m.regs.c = 0x0c;
  m.mem.write8(ACTIVE_PLAYER_PAGE, 0x21);
  m.io.setInte(false);
  const r = seamPlaceable(withOmittedRet, findLiveAlienInColumn, TARGET, m);
  assert.equal(r.placeable, true, `findLiveAlienInColumn must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
