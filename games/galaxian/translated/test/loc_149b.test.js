// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_149b (ROM 0x149b-0x14bd): activate the IY secondary slot then tail-jump loc_08f2.
// Spawn contract: 176 T, calls [0x08f2], (HL)=0, IY[0]=1, IY[2]=0, IY[6]=IX[6], IY[7]=L, D=1, E=L.
// Early-bail contract: IY[0] bit0 set -> ret nz, 31 T, no calls, no writes.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_149b } from "../loc_149b.js";

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

function spawnSetup(m) {
  m.regs.iy = 0x42f0; m.regs.ix = 0x42d0; m.regs.hl = 0x4176;
  m.mem.write8(0x42d6, 0xab); // IX[6]
  m.mem.write8(0x4176, 0xff); // trigger flag, should be cleared to 0
}

test("loc_149b: spawn path fills the IY slot + tail-jumps loc_08f2; 176 T", () => {
  const m = mk({ 0x08f2: () => "TAIL" });
  spawnSetup(m);
  const ret = loc_149b(m);
  assert.equal(m.cycles, 176, "T-state total");
  assert.deepEqual(m.calls, [0x08f2], "tail-jump into the queue routine");
  assert.equal(ret, "TAIL", "tail-jump callee result propagates");
  assert.equal(m.mem.read8(0x4176), 0x00, "trigger flag consumed");
  assert.equal(m.mem.read8(0x42f0), 0x01, "IY[0] marked alive");
  assert.equal(m.mem.read8(0x42f2), 0x00, "IY[2] cleared");
  assert.equal(m.mem.read8(0x42f6), 0xab, "IY[6] = IX[6]");
  assert.equal(m.mem.read8(0x42f7), 0x76, "IY[7] = L (source trigger index)");
  assert.equal(m.regs.d, 0x01, "D=1");
  assert.equal(m.regs.e, 0x76, "E=L -> DE=0x0176");
});

test("loc_149b: bails when IY[0] is already live (ret nz, 31 T, no spawn)", () => {
  const m = mk({});
  spawnSetup(m);
  m.mem.write8(0x42f0, 0x01); // IY[0] bit0 set
  m.push16(0x9999);
  loc_149b(m);
  assert.equal(m.cycles, 31, "bit(20) + ret nz taken(11)");
  assert.deepEqual(m.calls, [], "no tail-jump");
  assert.equal(m.pc, 0x9999, "ret to caller");
  assert.equal(m.mem.read8(0x4176), 0xff, "trigger flag untouched");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_149b.js
//   find: mem.write8(regs.iy + 0x00, 0x01);
//   repl: (drop it -- IY[0] never marked alive)
//   expect: FAIL (IY[0] stays 0; caught by the IY[0]==1 assert)
test("loc_149b: contract catches a dropped alive-mark write", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.bit(0, mem.read8(regs.iy + 0x00), (regs.iy + 0x00) >> 8); m.step(0x149f, 20);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x14a0, 5);
    regs.bit(0, mem.read8(regs.iy + 0x01), (regs.iy + 0x01) >> 8); m.step(0x14a4, 20);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x14a5, 5);
    mem.write8(regs.hl, 0x00); m.step(0x14a7, 10);
    m.step(0x14ab, 19); // MUTANT: dropped ld (iy+0),0x01
    mem.write8(regs.iy + 0x02, 0x00); m.step(0x14af, 19);
    regs.a = mem.read8(regs.ix + 0x06); m.step(0x14b2, 19);
    mem.write8(regs.iy + 0x06, regs.a); m.step(0x14b5, 19);
    mem.write8(regs.iy + 0x07, regs.l); m.step(0x14b8, 19);
    regs.d = 0x01; m.step(0x14ba, 7);
    regs.e = regs.l; m.step(0x14bb, 4);
    m.step(0x08f2, 10); return m.call(0x08f2);
  };
  const m = mk({ 0x08f2: () => "TAIL" });
  spawnSetup(m);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x42f0), 0x01));
});
