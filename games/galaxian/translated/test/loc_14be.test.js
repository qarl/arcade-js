// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_14be (ROM 0x14be-0x14f2): trigger-flag scan with a spawn arm.
// All-clear (no flags) contract: 331 T, calls [], ret to caller. Divert (first-block flag set, no
// secondaries) contract: 237 T, calls [0x145c].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_14be } from "../loc_14be.js";

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
const retStub = (mm) => { mm.pop16(); }; // a called routine that rets cleanly

test("loc_14be: no flags set -> both scans fall through to ret; 331 T", () => {
  const m = mk({});
  m.push16(0x9999);
  loc_14be(m);
  assert.equal(m.cycles, 331, "loop1(4) + reseed + loop2(4) + ret");
  assert.deepEqual(m.calls, [], "no spawn, no delegate");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_14be: first-block flag diverts to the spawn arm (call 0x145c); 237 T", () => {
  const m = mk({ 0x145c: retStub, 0x148e: retStub });
  m.mem.write8(0x4176, 0x01); // first trigger flag set -> jr nz,0x14d7
  m.push16(0x9999);
  loc_14be(m);
  assert.equal(m.cycles, 237, "loop1(1) + divert arm + loop3(3, none set) + ret");
  assert.deepEqual(m.calls, [0x145c], "primary spawn only; no secondary flags -> no 0x148e");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_14be: second-block flag tail-jumps loc_1446", () => {
  const m = mk({ 0x1446: () => "TAIL" });
  m.mem.write8(0x4165, 0x01); // second block first flag set -> jp nz,0x1446
  const ret = loc_14be(m);
  assert.deepEqual(m.calls, [0x1446], "delegate to loc_1446");
  assert.equal(ret, "TAIL", "tail-jump result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_14be.js
//   find: m.push16(0x14de);\n  m.step(0x145c, 17); // call 0x145c ...\n  m.call(0x145c);
//   repl: (drop the call -- spawn arm skips the primary spawn)
//   expect: FAIL (calls == [] not [0x145c]; caught by the divert calls assert)
test("loc_14be: contract catches a dropped primary spawn call", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4176; m.step(0x14c1, 10);
    regs.b = 0x04; m.step(0x14c3, 7);
    let divert = false;
    for (;;) {
      regs.bit(0, mem.read8(regs.hl)); m.step(0x14c5, 12);
      if (regs.fNZ) { m.step(0x14d7, 12); divert = true; break; }
      m.step(0x14c7, 7);
      regs.l = regs.inc8(regs.l); m.step(0x14c8, 4);
      if (regs.djnz() !== 0) { m.step(0x14c3, 13); continue; }
      m.step(0x14ca, 8); break;
    }
    if (!divert) { m.ret(); return; }
    regs.ix = 0x42d0; m.step(0x14db, 14);
    m.step(0x14de, 17); // MUTANT: dropped call 0x145c
    regs.a = regs.l; m.step(0x14df, 4);
    regs.sub(0x11); m.step(0x14e1, 7);
    regs.l = regs.a; m.step(0x14e2, 4);
    regs.iy = 0x42f0; m.step(0x14e6, 14);
    regs.b = 0x03; m.step(0x14e8, 7);
    regs.c = 0x02; m.step(0x14ea, 7);
    for (;;) {
      regs.bit(0, mem.read8(regs.hl)); m.step(0x14ec, 12);
      if (regs.fNZ) { m.push16(0x14ef); m.step(0x148e, 17); m.call(0x148e); }
      else { m.step(0x14ef, 10); }
      regs.l = regs.inc8(regs.l); m.step(0x14f0, 4);
      if (regs.djnz() !== 0) { m.step(0x14ea, 13); continue; }
      m.step(0x14f2, 8); break;
    }
    m.ret();
  };
  const m = mk({ 0x145c: retStub, 0x148e: retStub });
  m.mem.write8(0x4176, 0x01);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x145c]));
});
