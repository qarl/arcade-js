// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0908 — crafted-entry equivalence vs the frozen commit-write-head tail (a DISSOLVE: its lone
 * call into the pop-hl stack epilogue is replaced by a direct idiomatic call).
 * Two live-outs: the write-head cell at 0x40a0 (in the state dump) and the restored HL register (the
 * epilogue's pop, invisible to ramDiff). So EQUAL asserts ramDiff==null for 0x40a0 AND register HL.
 * The seed lays a saved-HL word then a ret sentinel on the stack (pop hl consumes the top, ret the
 * next). Teeth: a no-op and wrong-value twin (RAM), and a wrong-HL twin (register).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_0908 as cand } from "../loc_0908.js";
import { loc_0908 as oracle } from "../../translated/loc_0908.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const HEAD_CELL = 0x40a0; // queue write-head index
const HEAD = 0x3c; // value committed to the write-head
const SAVED_HL = 0x1234; // HL saved on the stack, restored by the epilogue

const entry = () => craft((mem, mm) => {
  mem[HEAD_CELL] = 0xff;   // foreign, so the write to the head cell is observable
  mm.regs.a = HEAD;
  mm.regs.hl = 0xdead;     // foreign, must be overwritten by the pop
  mm.push16(0x9999);       // return address consumed by the epilogue's ret (oracle)
  mm.push16(SAVED_HL);     // saved HL, on top, consumed by pop hl
});

// The restored HL is a register live-out; observe it directly (ramDiff is blind to registers).
function hlDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  return a.regs.hl === b.regs.hl ? null : `HL: 0x${a.regs.hl.toString(16)} vs 0x${b.regs.hl.toString(16)}`;
}

test("EQUAL (crafted): loc_0908 == oracle on the write-head cell and register HL", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "loc_0908 diverged on RAM");
  assert.equal(hlDiff(cand, entry()), null, "loc_0908 restored a different HL than the oracle");
  // Non-vacuous: the oracle commits the head and restores HL from the stack.
  const a = entry(); a.routines = STUBS; oracle(a);
  assert.equal(a.mem8[HEAD_CELL], HEAD, "positive control: write-head not committed");
  assert.equal(a.regs.hl, SAVED_HL, "positive control: HL not restored from the stack");
  console.log("  EQUAL: loc_0908 == oracle — write-head committed, HL restored");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongHead = (m) => { m.mem8[HEAD_CELL] = HEAD + 1; }; // wrong committed value
  const wrongHL = (m) => { m.mem8[HEAD_CELL] = HEAD; m.pop16(); m.regs.hl = 0; }; // right RAM, wrong HL
  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped (RAM)");
  assert.ok(ramDiff(oracle, wrongHead, entry()), "the wrong-value twin escaped (RAM)");
  assert.ok(hlDiff(wrongHL, entry()), "the wrong-HL twin escaped (register)");
  console.log("  TEETH: no-op, wrong-value (RAM), wrong-HL (register) all caught");
});
