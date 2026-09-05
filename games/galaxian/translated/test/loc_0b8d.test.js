// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0b8d (ROM 0x0b8d-0x0bbd): per-entry overlap/hit test at IX.
//   (a) (ix+0) bit0 clear -> ret z (inactive). 31 T, no hit.
//   (b) active + both bounding checks overlap (else-arm -> jp 0x0bb4): clears (ix+0), sets (0x4204)=1. 181 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0b8d } from "../loc_0b8d.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.push16(0xbeef); // return address for the routine's own ret
  m.regs.ix = 0x4260;
  return m;
}

test("loc_0b8d: inactive entry -> ret z; 31 T; no hit", () => {
  const m = mk();
  m.mem.write8(0x4260, 0x00); // bit0 clear
  m.mem.write8(0x4204, 0x00);
  loc_0b8d(m);
  assert.equal(m.cycles, 31, "bit 20 + ret z taken 11");
  assert.equal(m.mem.read8(0x4204), 0x00, "no hit flag set");
  assert.deepEqual(m.calls, []);
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

test("loc_0b8d: active + overlap (else-arm) -> clears entry, sets hit flag; 181 T", () => {
  const m = mk();
  m.mem.write8(0x4260, 0x01); // active
  m.mem.write8(0x4261, 0x50); // entry Y
  m.mem.write8(0x4263, 0x10); // entry X
  m.mem.write8(0x4202, 0xa1); // player X
  m.mem.write8(0x4204, 0x00);
  m.regs.e = 0x6f; // player Y
  loc_0b8d(m);
  assert.equal(m.cycles, 181, "full else-arm fall-through into loc_0bb4 + ret");
  assert.equal(m.mem.read8(0x4260), 0x00, "(ix+0) cleared -> entry deactivated");
  assert.equal(m.mem.read8(0x4204), 0x01, "hit flag raised");
  assert.deepEqual(m.calls, [], "no delegation -- all interior");
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0b8d.js
//   find: if (regs.fZ) { m.ret(11); return; }   (the active-flag gate)
//   repl: if (regs.fNZ) { m.ret(11); return; }  (inverted sense)
//   expect: FAIL (active entry now rets before the hit; (0x4204) stays 0 not 1)
test("loc_0b8d: contract catches an inverted active-flag sense", () => {
  const m = mk();
  const { regs, mem } = m;
  mem.write8(0x4260, 0x01); // active
  mem.write8(0x4204, 0x00);
  const mutant = (mm) => {
    regs.bit(0, mem.read8(regs.ix), (regs.ix >> 8) & 0xff); mm.step(0x0b91, 20);
    if (regs.fNZ) { mm.ret(11); return; } // MUTANT: rets on ACTIVE, hit never fires
    // (real routine would continue into the bounding checks + loc_0bb4 here)
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4204), 0x01));
});
