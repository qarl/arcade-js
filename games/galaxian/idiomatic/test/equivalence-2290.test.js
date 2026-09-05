// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_2290 — register-DE-equivalent to the frozen oracle at ROM 0x2290 (active-player score selector).
 * GATE: crafted-entry. This leaf writes NO RAM — its whole effect is the pointer it returns in DE — so
 * the RAM diff is trivially null and equivalence is checked on register DE, exactly as frogger's
 * register-only leaves do (equivalence-1198). A post-attract seed is cloned, the current-player flag at
 * 0x400d poked (0 = player 1, nonzero = player 2), and DE compared against the oracle. ramDiff is still
 * asserted null (both sides must leave RAM untouched). Teeth are on the DE arm: no-op (leaves DE at its
 * sentinel), a swapped-players twin, and a wrong-constant twin — each moves DE where the oracle does not.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff, STUBS } from "./_bootSetup.js";
import { selectCurrentPlayerScore as cand } from "../selectCurrentPlayerScore.js";
import { loc_2290 as oracle } from "../../translated/loc_2290.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const CURRENT_PLAYER = 0x400d;
const P1_SCORE = 0x40a2;
const P2_SCORE = 0x40a5;
const SENTINEL = 0x1234; // a distinctive incoming DE, so a no-op twin that never sets DE is visible

const player = (v) => craft((mem, m) => { mem[CURRENT_PLAYER] = v; m.regs.de = SENTINEL; m.push16(0x9999); });

// null == equivalent on the live-out register DE (RAM is checked separately by ramDiff).
function deDiff(twin, entry) {
  const a = entry.clone(); a.routines = STUBS; oracle(a);
  const b = entry.clone(); b.routines = STUBS; twin(b);
  return a.regs.de === b.regs.de ? null : `DE: 0x${a.regs.de.toString(16)} vs 0x${b.regs.de.toString(16)}`;
}

test("EQUAL (crafted): loc_2290 == oracle on DE across the player flag", { skip }, () => {
  for (const v of [0, 1, 0xff]) {
    assert.equal(ramDiff(oracle, cand, player(v)), null, `player=${v}: RAM was touched`);
    assert.equal(deDiff(cand, player(v)), null, `player=${v}: DE diverged`);
  }
  // Positive control: the oracle selects the two distinct score pointers.
  const a = player(0); oracle(a);
  assert.equal(a.regs.de, P1_SCORE, "control: player 1 -> 0x40a2");
  const b = player(1); oracle(b);
  assert.equal(b.regs.de, P2_SCORE, "control: player 2 -> 0x40a5");
  console.log("  EQUAL: DE == oracle for player 0/1/0xff; control 0->0x40a2, nonzero->0x40a5");
});

test("TEETH: broken twins are caught on the DE arm", { skip }, () => {
  const noOp = () => {};
  const swapped = (m) => { m.regs.de = m.mem8[CURRENT_PLAYER] === 0 ? P2_SCORE : P1_SCORE; }; // players reversed
  const wrongConst = (m) => { m.regs.de = m.mem8[CURRENT_PLAYER] === 0 ? P1_SCORE + 1 : P2_SCORE; }; // P1 pointer off by one
  assert.ok([0, 1, 0xff].some((v) => deDiff(noOp, player(v))), "no-op twin escaped the DE arm");
  assert.ok([0, 1, 0xff].some((v) => deDiff(swapped, player(v))), "swapped-players twin escaped");
  assert.ok([0, 1, 0xff].some((v) => deDiff(wrongConst, player(v))), "wrong-constant twin escaped");
  console.log("  TEETH: no-op, swapped-players, wrong-constant all caught on DE");
});
