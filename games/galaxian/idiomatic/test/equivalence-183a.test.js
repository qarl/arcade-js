// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_183a — crafted-entry equivalence vs the frozen sound-sequence arming arm.
 * Covers both paths: selector != 0x16 (no writes) and selector == 0x16 (0x41cf<-0, 0x41cd<-1, 0x41d6<-1,
 * and the 16-bit sequence pointer 0x41d3 <- 0x1edf, little-endian). RAM compared, stack masked.
 * Teeth (on the armed path): a no-op twin, a wrong-pointer twin, a wrong-flag twin — all must diverge.
 * Positive control: the oracle really cleared 0x41cf, raised both flags, and stored 0x1edf low/high.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { armSoundSequenceForSelector16 as cand } from "../armSoundSequenceForSelector16.js";
import { loc_183a as oracle } from "../../translated/loc_183a.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const P_41CF = 0x41cf, P_41CD = 0x41cd, P_41D6 = 0x41d6, P_41D3 = 0x41d3;
const SEQ_PTR = 0x1edf;

const stale = (mem) => {
  mem[P_41CF] = 0x99; mem[P_41CD] = 0x00; mem[P_41D6] = 0x00;
  mem[P_41D3] = 0x00; mem[P_41D3 + 1] = 0x00;
};
const armed = () => craft((mem, mm) => { mm.regs.a = 0x16; stale(mem); });
const other = () => craft((mem, mm) => { mm.regs.a = 0x05; stale(mem); });

test("EQUAL (crafted): loc_183a == oracle on armed and ignored selectors", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, armed()), null, "the armed path diverged");
  assert.equal(ramDiff(oracle, cand, other()), null, "the ignored-selector path diverged");

  const a = armed().clone(); oracle(a);
  assert.equal(a.mem8[P_41CF], 0, "0x41cf not cleared");
  assert.equal(a.mem8[P_41CD], 1, "sequence-active flag not raised");
  assert.equal(a.mem8[P_41D6], 1, "0x41d6 flag not raised");
  assert.equal(a.mem8[P_41D3], SEQ_PTR & 0xff, "sequence pointer low byte wrong");
  assert.equal(a.mem8[P_41D3 + 1], (SEQ_PTR >> 8) & 0xff, "sequence pointer high byte wrong");
  console.log(`  EQUAL: armed on 0x16 -> flags up, ptr 0x${SEQ_PTR.toString(16)}; ignored on 0x05`);
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongPtr = (m) => {
    if (m.regs.a !== 0x16) return;
    const { mem8 } = m;
    mem8[P_41CF] = 0; mem8[P_41CD] = 1; mem8[P_41D6] = 1;
    mem8[P_41D3] = (SEQ_PTR + 1) & 0xff; mem8[P_41D3 + 1] = (SEQ_PTR >> 8) & 0xff;
  };
  const wrongFlag = (m) => {
    if (m.regs.a !== 0x16) return;
    const { mem8 } = m;
    mem8[P_41CF] = 0; mem8[P_41CD] = 0; mem8[P_41D6] = 1; // 0x41cd left clear
    mem8[P_41D3] = SEQ_PTR & 0xff; mem8[P_41D3 + 1] = (SEQ_PTR >> 8) & 0xff;
  };
  assert.ok(ramDiff(oracle, noOp, armed()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongPtr, armed()), "wrong-pointer twin escaped");
  assert.ok(ramDiff(oracle, wrongFlag, armed()), "wrong-flag twin escaped");
  console.log("  TEETH: no-op, wrong pointer, wrong flag all caught");
});
