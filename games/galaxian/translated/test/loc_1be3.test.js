// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1be3 (OBJRAM color-ramp fill, ROM 0x1BE3-0x1BEC):
//   ld (hl),a; add a,0x2f; inc l; jp nz,0x1be3   (0x100 bytes, stepped ramp)
//   ld a,(0x401e)  -> fall through into loc_1bed
// Entry (from loc_1bcd): HL=0x5800, A=seed. Contract with A=0:
//   256 iters * 28 T + 13 = 7181 T, calls [0x1bed]; OBJRAM ramp 0x00,0x2f,0x5e,...,0xd1.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1be3 } from "../loc_1be3.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_1be3: lays a 0x2f-step OBJRAM ramp, reloads A, falls into loc_1bed; 7181 T", () => {
  const m = mk({ 0x1bed: "tail" });
  m.regs.hl = 0x5800; m.regs.a = 0x00;
  const ret = loc_1be3(m);
  assert.equal(m.cycles, 7181, "T total (256*(7+7+4+10) + 13)");
  assert.deepEqual(m.calls, [0x1bed], "fall through into loc_1bed");
  assert.equal(ret, "TAIL", "the fall-through callee result propagates out");
  assert.equal(m.regs.a, 0x00, "ld a,(0x401e) reloaded (=0 in zeroed work RAM)");
  // stepped ramp: value written is A BEFORE the add, so byte k = (k*0x2f) & 0xff.
  assert.equal(m.mem.read8(0x5800), 0x00, "OBJRAM[0] = seed 0");
  assert.equal(m.mem.read8(0x5801), 0x2f, "OBJRAM[1] = 0x2f");
  assert.equal(m.mem.read8(0x5802), 0x5e, "OBJRAM[2] = 0x5e");
  assert.equal(m.mem.read8(0x5803), 0x8d, "OBJRAM[3] = 0x8d");
  assert.equal(m.mem.read8(0x58ff), 0xd1, "OBJRAM[0xff] = (255*0x2f)&0xff = 0xd1");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1be3.js
//   find: regs.add(0x2f);\n    m.step(0x1be6, 7); // add a,0x2f -- step the ramp
//   repl: regs.add(0x30); ...
//   expect: FAIL  (OBJRAM[1] == 0x30 != 0x2f)
test("loc_1be3: the contract catches a wrong ramp step", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      mem.write8(regs.hl, regs.a); m.step(0x1be4, 7);
      regs.add(0x30); m.step(0x1be6, 7); // MUTANT: wrong step
      regs.l = regs.inc8(regs.l); m.step(0x1be7, 4);
      if (regs.fNZ) { m.step(0x1be3, 10); continue; }
      m.step(0x1bea, 10); break;
    }
    regs.a = mem.read8(0x401e); m.step(0x1bed, 13);
    return m.call(0x1bed);
  };
  const m = mk({ 0x1bed: "tail" });
  m.regs.hl = 0x5800; m.regs.a = 0x00;
  mutant(m);
  assert.notEqual(m.mem.read8(0x5801), 0x2f, "mutant step 0x30 makes OBJRAM[1] != 0x2f");
});
