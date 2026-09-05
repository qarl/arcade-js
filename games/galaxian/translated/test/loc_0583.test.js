// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0583 (ROM 0x0583-0x0592): block-fill 0x20 bytes at (0x400b) via rst 0x10, store the
// advanced pointer, dec (0x4009); ret nz, else fall through to loc_0593.
//   TAKEN  (0x4009 != 1): 16+7+7+11+16+10+11+11(ret) = 89 T, calls [0x0010], rets to caller.
//   FALL   (0x4009 == 1): 16+7+7+11+16+10+11+5      = 83 T, calls [0x0010,0x0593].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0583 } from "../loc_0583.js";

// rst 0x10 stub: pop the pushed return, mimic loc_0010 advancing HL by B (fill count).
const rst10 = (mm) => { mm.pop16(); mm.regs.hl = (mm.regs.hl + 0x20) & 0xffff; };

function mk(counter) {
  const routines = new Map();
  routines.set(0x0010, rst10);
  routines.set(0x0593, () => {}); // no-op fall-through target
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.push16(0x9999); // caller return for the ret-nz path
  m.mem.write16(0x400b, 0x5000); // running fill pointer
  m.mem.write8(0x4009, counter);
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_0583: ret-nz path (counter stays > 0) fills, stores advanced ptr, returns", () => {
  const m = mk(3);
  loc_0583(m);
  assert.equal(m.cycles, 89, "T-states incl ret nz taken (11)");
  assert.deepEqual(m.calls, [0x0010], "one rst 0x10 fill, no fall-through");
  assert.equal(m.mem.read8(0x4009), 2, "dec (0x4009): 3 -> 2");
  assert.equal(m.mem.read16(0x400b), 0x5020, "advanced pointer stored (0x5000 + 0x20)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0583: counter hits 0 -> fall through to loc_0593", () => {
  const m = mk(1);
  loc_0583(m);
  assert.equal(m.cycles, 83, "T-states incl ret nz not-taken (5)");
  assert.deepEqual(m.calls, [0x0010, 0x0593], "fill then delegate to loc_0593");
  assert.equal(m.mem.read8(0x4009), 0, "dec (0x4009): 1 -> 0");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0583.js
//   find: if (regs.fNZ) {   repl: if (regs.fZ) {   (ret condition inverted)
//   expect: FAIL (counter=1 would ret instead of falling to loc_0593; calls omit 0x0593)
test("loc_0583: contract catches an inverted ret condition", () => {
  const m = mk(1);
  const { regs, mem } = m;
  regs.hl = mem.read16(0x400b); m.step(0x0586, 16);
  regs.b = 0x20; m.step(0x0588, 7);
  regs.a = 0x10; m.step(0x058a, 7);
  m.push16(0x058b); m.step(0x0010, 11); m.call(0x0010);
  mem.write16(0x400b, regs.hl); m.step(0x058e, 16);
  regs.hl = 0x4009; m.step(0x0591, 10);
  regs.decMem8(mem, regs.hl); m.step(0x0592, 11);
  if (regs.fZ) { m.ret(11); } // MUTANT: fZ instead of fNZ
  else { m.step(0x0593, 5); m.call(0x0593); }
  assert.throws(() => assert.deepEqual(m.calls, [0x0010, 0x0593]));
});
