// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_214e — crafted-entry equivalence vs the frozen VRAM-pointer selector at ROM 0x214e.
 * This leaf writes no RAM; its only live-out is register HL, set to the player-1 status column base
 * (0x5340) when A==0 and to the player-2 base (0x50e0) otherwise. The seed lays a return word for the
 * oracle's `ret`, seeds A with the player index, and seats HL foreign so a no-op twin is visible. Live-out
 * is checked on RAM (must stay untouched on both sides — stack window masked) AND register HL. Non-vacuous:
 * the oracle always overwrites HL (it opens with `ld hl,0x5340`). Teeth: no-op, and each fixed-base twin
 * fails the case that needs the other base.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff, STUBS } from "./_bootSetup.js";
import { selectPlayerStatusVram as cand } from "../selectPlayerStatusVram.js";
import { loc_214e as oracle } from "../../translated/loc_214e.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const PLAYER1_VRAM = 0x5340;
const PLAYER2_VRAM = 0x50e0;
const FOREIGN_HL = 0x0000; // seeded so a no-op twin (leaves HL here) diverges from the oracle

// A crafted entry: return word for the oracle's ret, A = player index, HL seated foreign. No RAM written.
function entry(playerIndex) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.a = playerIndex;
    m.regs.hl = FOREIGN_HL;
  });
}

// null == equivalent on the live-out: RAM untouched (stack masked by ramDiff) AND register HL.
function hlDiff(twin, e) {
  const ram = ramDiff(oracle, twin, e);
  if (ram) return `RAM ${ram}`;
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.hl !== b.regs.hl) return `HL: 0x${a.regs.hl.toString(16)} vs 0x${b.regs.hl.toString(16)}`;
  return null;
}

test("EQUAL (crafted): loc_214e == oracle on register HL for each player index", { skip }, () => {
  for (const idx of [0x00, 0x01, 0x02, 0xff]) {
    assert.equal(hlDiff(cand, entry(idx)), null, `loc_214e diverged (A=0x${idx.toString(16)})`);
  }
  // non-vacuous: the oracle actually sets HL to each base.
  const a0 = entry(0x00).clone(); a0.routines = STUBS; oracle(a0);
  assert.equal(a0.regs.hl, PLAYER1_VRAM, "oracle did not select the player-1 base for A==0");
  const a1 = entry(0x01).clone(); a1.routines = STUBS; oracle(a1);
  assert.equal(a1.regs.hl, PLAYER2_VRAM, "oracle did not select the player-2 base for A!=0");
  console.log("  EQUAL: loc_214e == oracle on HL; A==0 -> 0x5340, else 0x50e0; no RAM touched");
});

test("TEETH: broken twins are caught on register HL", { skip }, () => {
  const noOp = () => {};                                  // leaves HL foreign
  const alwaysP1 = (m) => { m.regs.hl = PLAYER1_VRAM; };  // ignores A: wrong for A!=0
  const alwaysP2 = (m) => { m.regs.hl = PLAYER2_VRAM; };  // ignores A: wrong for A==0
  assert.ok(hlDiff(noOp, entry(0x00)), "no-op twin escaped (A==0)");
  assert.ok(hlDiff(alwaysP2, entry(0x00)), "always-player2 twin escaped the A==0 case");
  assert.ok(hlDiff(alwaysP1, entry(0x01)), "always-player1 twin escaped the A!=0 case");
  console.log("  TEETH: no-op, always-P1, always-P2 all caught on HL");
});
