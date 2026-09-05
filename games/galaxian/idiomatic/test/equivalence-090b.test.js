// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_090b — memory-equivalent to the frozen oracle at ROM 0x090b. Pure stack plumbing (`pop hl; ret`,
 * the shared epilogue of the loc_08f2 enqueue path): it restores HL from the stack and writes NO
 * non-stack RAM. Its real effect is the HL register-restore, which the memory-only ramDiff cannot see
 * (the pop/ret touch only the masked return-stack window). So EQUAL asserts BOTH: work/VRAM/OBJRAM
 * untouched (ramDiff) AND register HL restored identically to the oracle. Teeth: a spurious-write twin
 * (ramDiff) and a wrong-HL twin (register).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_090b as cand } from "../loc_090b.js";
import { loc_090b as oracle } from "../../translated/loc_090b.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const SCRATCH = 0x4100; // a work-RAM cell outside the masked return-stack window
const SAVED_HL = 0x1234;

// A fresh entry: a saved-HL word then a ret sentinel on the stack for the pop/ret to consume.
const entry = () => craft((mem, mm) => { mm.push16(0x9999); mm.push16(SAVED_HL); });

// The real live-out is register HL; observe it directly (ramDiff is blind to registers).
function hlDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  return a.regs.hl === b.regs.hl ? null : `HL: 0x${a.regs.hl.toString(16)} vs 0x${b.regs.hl.toString(16)}`;
}

const strayWrite = (m) => { m.mem8[SCRATCH] = (m.mem8[SCRATCH] + 1) & 0xff; };
const wrongHL = (m) => { m.pop16(); m.regs.hl = 0; }; // consumes the HL word but restores the wrong value

test("EQUAL (crafted): loc_090b == oracle on non-stack RAM and register HL", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "loc_090b touched non-stack RAM / diverged");
  assert.equal(hlDiff(cand, entry()), null, "loc_090b restored a different HL than the oracle");
  const a = entry(); a.routines = STUBS; oracle(a);
  assert.equal(a.regs.hl, SAVED_HL, "non-vacuous: oracle restored HL from the stack");
  console.log("  EQUAL: loc_090b == oracle — HL restored, no non-stack write");
});

test("TEETH: spurious-write and wrong-HL twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, strayWrite, entry()), "the stray-write twin escaped the RAM diff");
  assert.ok(hlDiff(wrongHL, entry()), "the wrong-HL twin escaped the register check");
  console.log("  TEETH: spurious-write (RAM) and wrong-HL (register) both caught");
});
