// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0f3c — crafted-entry equivalence vs the frozen homing-AI step.
 * All live-outs are the object record in work RAM (X position, X subpixel, frame counter, dwell timer,
 * state) — no register or latch output — so ramDiff alone covers it, across a move, a dwell-expiry state
 * advance, and an on-target no-move. Teeth: no-op, a bias-dropping twin (the rounding low bits), a
 * frame-counter twin, and a dwell-timer twin.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_0f3c as cand } from "../loc_0f3c.js";
import { loc_0f3c as oracle } from "../../translated/loc_0f3c.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const OBJ = 0x4300; // object record in work RAM, clear of the masked stack window
const TARGET = 0x4202; // shared homing target coordinate
const STATE = 2, FRAME = 3, POS_X = 4, POS_SUB = 9, DWELL = 16;

function entry(target, x, sub, timer) {
  return craft((mem8, mm) => {
    mm.push16(0x9999);
    mm.regs.ix = OBJ;
    mem8[TARGET] = target;
    mem8[OBJ + POS_X] = x;
    mem8[OBJ + POS_SUB] = sub;
    mem8[OBJ + FRAME] = 0x10;
    mem8[OBJ + DWELL] = timer;
    mem8[OBJ + STATE] = 3;
  });
}

const move = () => entry(0x40, 0x80, 0x00, 5); // dist 0x40 -> step 0x0102, position drops
const expiry = () => entry(0x40, 0x80, 0x00, 1); // dwell reaches 0 -> state advances
const onTarget = () => entry(0x80, 0x80, 0x00, 5); // dist 0 -> no move, but frame/dwell still tick

test("EQUAL (crafted): loc_0f3c == oracle across move, dwell expiry and on-target", { skip }, () => {
  for (const [name, e] of [["move", move()], ["expiry", expiry()], ["on-target", onTarget()]]) {
    assert.equal(ramDiff(oracle, cand, e), null, `loc_0f3c diverged on ${name}`);
  }
  // non-vacuous: the oracle really moves the position and, on expiry, advances the state.
  const mv = move(); oracle(mv);
  assert.equal((mv.mem8[OBJ + POS_X] << 8) | mv.mem8[OBJ + POS_SUB], 0x7efe,
    "positive control: oracle stepped the position toward the target");
  const ex = expiry(); oracle(ex);
  assert.equal(ex.mem8[OBJ + STATE], 4, "positive control: oracle advanced the state on dwell expiry");
  console.log("  EQUAL: loc_0f3c == oracle (RAM) on move/expiry/on-target");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  // Drops the rounding bias -> wrong subpixel/position low bits.
  const noBias = (m) => { const d = (m.mem8[OBJ + POS_X] - m.mem8[TARGET]) & 0xff;
    const s = d < 128 ? d : d - 256; const pos = (((m.mem8[OBJ + POS_X] << 8) | m.mem8[OBJ + POS_SUB]) - ((4 * s) & 0xffff)) & 0xffff;
    m.mem8[OBJ + POS_X] = pos >> 8; m.mem8[OBJ + POS_SUB] = pos;
    m.mem8[OBJ + FRAME] = m.mem8[OBJ + FRAME] + 1; m.mem8[OBJ + DWELL] = m.mem8[OBJ + DWELL] - 1; };
  const noFrame = (m) => { cand(m); m.mem8[OBJ + FRAME] = m.mem8[OBJ + FRAME] - 1; };
  const noDwell = (m) => { cand(m); m.mem8[OBJ + DWELL] = m.mem8[OBJ + DWELL] + 1; };
  assert.ok(ramDiff(oracle, noOp, move()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, noBias, move()), "the bias-dropping twin escaped");
  assert.ok(ramDiff(oracle, noFrame, move()), "the frame-counter twin escaped");
  assert.ok(ramDiff(oracle, noDwell, move()), "the dwell-timer twin escaped");
  console.log("  TEETH: no-op, bias-drop, frame, dwell all caught");
});
