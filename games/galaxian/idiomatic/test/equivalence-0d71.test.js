// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0d71 — crafted-entry equivalence vs the frozen path-move step handler.
 * Every live-out is the object record in work RAM (position, cursor, throttle, leg counter, cross
 * field, state) — no register or latch output — so equivalence is asserted with ramDiff alone across
 * the add path, the subtract path, a leg-expiry state advance, and an off-near-edge drop to state 5.
 * Teeth: no-op, a direction-ignoring twin, and per-cell scribbles proving the diff sees each output.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_0d71 as cand } from "../loc_0d71.js";
import { loc_0d71 as oracle } from "../../translated/loc_0d71.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const OBJ = 0x4300; // object record in work RAM, clear of the masked stack window
const PATH_TABLE = 0x1e00;
// Field offsets used only by the twins below.
const STATE = 2, POS_Y = 3, POS_X = 4, CROSS = 5, CURSOR = 19;

// A crafted object with the fields the handler reads; `dir` picks the X direction, `x`/`cur`/`thr`/`legs`
// steer which branch runs.
function entry(cur, dir, x, thr, legs, y = 0x30) {
  return craft((mem8, mm) => {
    mm.push16(0x9999);
    mm.regs.ix = OBJ;
    mem8[OBJ + CURSOR] = cur;
    mem8[OBJ + 6] = dir;
    mem8[OBJ + POS_X] = x;
    mem8[OBJ + POS_Y] = y;
    mem8[OBJ + 16] = thr;
    mem8[OBJ + 17] = legs;
    mem8[OBJ + CROSS] = 0x20;
    mem8[OBJ + STATE] = 3;
  });
}

// table[0x40]=0x00 (Y delta), table[0x41]=0x01 (X delta) -> a clean +/-1 X move on the 0x40 cursor.
const walkAdd = () => entry(0x40, 0x00, 0x80, 5, 2);
const walkSub = () => entry(0x40, 0x01, 0x80, 5, 2);
const legAdd = () => entry(0x40, 0x00, 0x80, 1, 1);
const legSub = () => entry(0x40, 0x01, 0x80, 1, 1);
// cursor 0: table[1]=0x00, so X stays 2; (2+7) < 14 -> off the near edge -> state 5.
const offEdge = () => entry(0x00, 0x00, 0x02, 5, 2);

test("EQUAL (crafted): loc_0d71 == oracle across both directions, leg expiry and the edge drop", { skip }, () => {
  for (const [name, e] of [["walk+", walkAdd()], ["walk-", walkSub()], ["leg+", legAdd()],
                           ["leg-", legSub()], ["edge", offEdge()]]) {
    assert.equal(ramDiff(oracle, cand, e), null, `loc_0d71 diverged on ${name}`);
  }
  // non-vacuous: the oracle really moves X on the walk path, sets state 5 at the edge, advances state on leg expiry.
  const w = walkAdd(); oracle(w);
  assert.equal(w.mem8[OBJ + POS_X], 0x81, "positive control: oracle stepped X on the add path");
  const o = offEdge(); oracle(o);
  assert.equal(o.mem8[OBJ + STATE], 5, "positive control: oracle dropped to the edge state");
  const l = legAdd(); oracle(l);
  assert.equal(l.mem8[OBJ + STATE], 4, "positive control: oracle advanced the path state on leg expiry");
  console.log("  EQUAL: loc_0d71 == oracle (RAM) on add/sub/leg/edge");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  // Ignores the direction bit and always adds -> wrong X on the subtract path.
  const ignoreDir = (m) => { const c = (m.mem8[OBJ + CURSOR] + 1) & 0xff;
    m.mem8[OBJ + POS_X] = m.mem8[OBJ + POS_X] + m.mem8[PATH_TABLE + c]; };
  const scribbleY = (m) => { cand(m); m.mem8[OBJ + POS_Y] = m.mem8[OBJ + POS_Y] + 1; };
  const scribbleState = (m) => { cand(m); m.mem8[OBJ + STATE] = m.mem8[OBJ + STATE] + 1; };
  const scribbleCursor = (m) => { cand(m); m.mem8[OBJ + CURSOR] = m.mem8[OBJ + CURSOR] + 1; };
  assert.ok(ramDiff(oracle, noOp, walkAdd()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, ignoreDir, walkSub()), "the direction-ignoring twin escaped");
  assert.ok(ramDiff(oracle, scribbleY, walkAdd()), "the Y-scribble twin escaped");
  assert.ok(ramDiff(oracle, scribbleState, walkAdd()), "the state-scribble twin escaped");
  assert.ok(ramDiff(oracle, scribbleCursor, walkAdd()), "the cursor-scribble twin escaped");
  console.log("  TEETH: no-op, direction-ignoring, Y/state/cursor scribbles all caught");
});
