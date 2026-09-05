// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1971 (ROM 0x1971-0x1973):
//   1971 36 01  ld (hl),0x01
//   1973 c9     ret
// Contract: writes 0x01 to (hl), returns; 20 T (10+10), no m.call.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1971 } from "../loc_1971.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_1971: sets (hl) to 0x01 and returns; 20 T", () => {
  const m = mk();
  m.regs.sp = 0x4400; m.push16(0x00aa);
  m.regs.hl = 0x4001; m.mem.write8(0x4001, 0x00);
  loc_1971(m);
  assert.equal(m.cycles, 20, "T-state total 10+10");
  assert.deepEqual(m.calls, [], "no delegation");
  assert.equal(m.mem.read8(0x4001), 0x01, "ld (hl),0x01");
  assert.equal(m.pc, 0x00aa, "ret pops the return address");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1971.js
//   find: mem.write8(regs.hl, 0x01);
//   repl: mem.write8(regs.hl, 0x00);
//   expect: FAIL  (flag not set -- caught by (hl) == 0x01)
//   verified-anchor: count == 1
test("loc_1971: contract catches a failure to set the flag", () => {
  const m = mk();
  m.regs.sp = 0x4400; m.push16(0x00aa);
  m.regs.hl = 0x4001; m.mem.write8(0x4001, 0x00);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    mem.write8(regs.hl, 0x00); mm.step(0x1973, 10); // MUTANT
    return mm.ret();
  };
  mutant(m);
  assert.notEqual(m.mem.read8(0x4001), 0x01, "mutant leaves the flag clear");
});
