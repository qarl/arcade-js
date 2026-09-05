// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1147 — crafted-entry equivalence vs the frozen translated oracle at ROM 0x1147 (packed grid cell ->
 * sprite screen coordinates). IX is the object-record base; live-out is two record bytes (sprite Y at +3,
 * sprite X at +4), so ramDiff covers it (stack window masked). The seed lays a record with a packed cell
 * and pokes the shared X-anchor cell. Teeth: a no-op, a wrong-Y twin (drops the 3/4 scaling term), and a
 * wrong-X twin (omits the X anchor).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_1147 as cand } from "../loc_1147.js";
import { loc_1147 as oracle } from "../../translated/loc_1147.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const RECORD = 0x4160; // object-record base (IX)
const CELL = 7; // packed row/column cell within the record
const SPRITE_Y = 3;
const SPRITE_X = 4;
const XBASE = 0x420e; // shared X anchor (low byte read here)
const PACKED = 0x53; // row bits 0x50, column bits 0x03

const entry = () => craft((mem, m) => {
  m.push16(0x9999);
  m.regs.ix = RECORD;
  mem[RECORD + CELL] = PACKED;
  mem[XBASE] = 0x40;
});

test("EQUAL (crafted): loc_1147 == oracle on the sprite coordinates", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "the coordinate write diverged");

  // Positive control: Y = 124 - 3/4*0x50 = 64; X = 0x40 + (3<<4) + 7 = 119.
  const a = entry(); oracle(a);
  assert.equal(a.mem8[RECORD + SPRITE_Y], 64, "control: sprite Y");
  assert.equal(a.mem8[RECORD + SPRITE_X], 119, "control: sprite X");
  console.log("  EQUAL: loc_1147 == oracle, Y=64 X=119");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongY = (m, obj = m.regs.ix) => {
    const { mem8 } = m;
    const row = mem8[obj + CELL] & 0x70;
    mem8[obj + SPRITE_Y] = 124 - (row >> 1); // drops the extra 1/4-row term
    mem8[obj + SPRITE_X] = mem8[XBASE] + ((mem8[obj + CELL] & 0x0f) << 4) + 7;
  };
  const wrongX = (m, obj = m.regs.ix) => {
    const { mem8 } = m;
    const row = mem8[obj + CELL] & 0x70;
    mem8[obj + SPRITE_Y] = 124 - ((row >> 1) + (row >> 2));
    mem8[obj + SPRITE_X] = ((mem8[obj + CELL] & 0x0f) << 4) + 7; // forgets the X anchor
  };
  assert.ok(ramDiff(oracle, noOp, entry()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongY, entry()), "wrong-Y twin escaped");
  assert.ok(ramDiff(oracle, wrongX, entry()), "wrong-X twin escaped");
  console.log("  TEETH: no-op, wrong-Y, wrong-X all caught");
});
