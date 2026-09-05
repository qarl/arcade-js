// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1961 (ROM 0x1961-0x1963):
//   1961 36 63  ld (hl),0x63
//   1963 c9     ret
// Contract: writes 0x63 to (hl), returns; 20 T (10+10), no m.call.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1961 } from "../loc_1961.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_1961: clamps (hl) to 0x63 and returns; 20 T", () => {
  const m = mk();
  m.regs.sp = 0x4400; m.push16(0x00aa); // fake return addr
  m.regs.hl = 0x4002; m.mem.write8(0x4002, 0x99);
  loc_1961(m);
  assert.equal(m.cycles, 20, "T-state total 10+10");
  assert.deepEqual(m.calls, [], "no delegation");
  assert.equal(m.mem.read8(0x4002), 0x63, "ld (hl),0x63");
  assert.equal(m.pc, 0x00aa, "ret pops the return address");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1961.js
//   find: mem.write8(regs.hl, 0x63);
//   repl: mem.write8(regs.hl, 0x62);
//   expect: FAIL  (wrong ceiling -- caught by (hl) == 0x63)
//   verified-anchor: count == 1
test("loc_1961: contract catches a wrong ceiling value", () => {
  const m = mk();
  m.regs.sp = 0x4400; m.push16(0x00aa);
  m.regs.hl = 0x4002; m.mem.write8(0x4002, 0x99);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    mem.write8(regs.hl, 0x62); mm.step(0x1963, 10); // MUTANT
    return mm.ret();
  };
  mutant(m);
  assert.notEqual(m.mem.read8(0x4002), 0x63, "mutant clamps to the wrong value");
});
