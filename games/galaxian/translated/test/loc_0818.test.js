// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0818 (ROM 0x0818-0x0836): timer (0x4009) countdown; on expiry clear 0x400a/0x400d,
// set state (0x4005)=3, pack via loc_0764, ldir 8 bytes 0x4218->DE, ret.
// Contract: expiry path 294 T (131 instr + 163 for the 8-byte ldir), calls [0x0764]; ret-nz path 32 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0818 } from "../loc_0818.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const PAT = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];
// loc_0764 stub: mimic the real routine leaving DE past the 0x10-byte pack table (0x41a0 -> 0x41b0).
const pack = (mm) => { mm.pop16(); mm.regs.de = 0x41b0; };

test("loc_0818: expiry clears/sets state and ldir 8 bytes; 294 T", () => {
  const m = mk({ 0x0764: pack });
  m.mem.write8(0x4009, 1); // timer -> 0 this tick (fires)
  for (let i = 0; i < PAT.length; i++) m.mem.write8(0x4218 + i, PAT[i]); // ldir source
  m.push16(0x9999); // caller return
  loc_0818(m);
  assert.equal(m.cycles, 294, "131 instr T + 17 call + 163 ldir");
  assert.deepEqual(m.calls, [0x0764], "packs via loc_0764");
  assert.equal(m.mem.read8(0x400a), 0, "0x400a cleared");
  assert.equal(m.mem.read8(0x400d), 0, "0x400d cleared");
  assert.equal(m.mem.read8(0x4005), 3, "0x4005 <- 3 next state");
  for (let i = 0; i < PAT.length; i++) {
    assert.equal(m.mem.read8(0x41b0 + i), PAT[i], `ldir byte ${i} 0x4218 -> 0x41b0`);
  }
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0818: timer not yet expired returns early; 32 T", () => {
  const m = mk({ 0x0764: pack });
  m.mem.write8(0x4009, 5); // -> 4, nonzero
  m.push16(0x9999);
  loc_0818(m);
  assert.equal(m.cycles, 32, "ld hl(10)+dec(11)+ret nz taken(11)");
  assert.deepEqual(m.calls, [], "no pack when still counting");
  assert.equal(m.mem.read8(0x4009), 4, "timer decremented");
  assert.equal(m.mem.read8(0x4005), 0, "state untouched");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0818.js
//   find: regs.a = 0x03;
//   repl: regs.a = 0x02;
//   expect: FAIL (0x4005 becomes 2; caught by the state assert)
test("loc_0818: contract catches a wrong next-state value", () => {
  const m = mk({ 0x0764: pack });
  m.mem.write8(0x4009, 1);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.hl = 0x4009; mm.step(0x081b, 10);
    regs.decMem8(mem, regs.hl); mm.step(0x081c, 11);
    if (regs.fNZ) { mm.ret(11); return; }
    mm.step(0x081d, 5);
    regs.l = regs.inc8(regs.l); mm.step(0x081e, 4);
    regs.xor(regs.a); mm.step(0x081f, 4);
    mem.write8(regs.hl, regs.a); mm.step(0x0820, 7);
    mem.write8(0x400d, regs.a); mm.step(0x0823, 13);
    regs.a = 0x02; mm.step(0x0825, 7); // MUTANT
    mem.write8(0x4005, regs.a); mm.step(0x0828, 13);
    regs.de = 0x41a0; mm.step(0x082b, 10);
    mm.push16(0x082e); mm.step(0x0764, 17); mm.call(0x0764);
    regs.hl = 0x4218; mm.step(0x0831, 10);
    regs.bc = 0x0008; mm.step(0x0834, 10);
    mm.ldirAt(0x0834, 0x0836);
    return mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4005), 3));
});
