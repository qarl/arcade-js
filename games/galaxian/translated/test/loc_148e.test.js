// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_148e (ROM 0x148e-0x149a): spawn (iy) via loc_149b, IY += 0x20, dec C; ret while C!=0,
// else force B=1 then ret. Contract: C=2 path = 57 T, calls [0x149b], IY+=0x20, C=1, rets; C=1 path = 68 T,
// B forced to 1.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_148e } from "../loc_148e.js";

function mk() {
  const routines = new Map();
  // loc_149b stub: pop the return addr loc_148e pushed for its call (a clean ret).
  routines.set(0x149b, (mm) => { mm.pop16(); });
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_148e: budget remains (C=2) -> IY advances, C=1, ret nz; 57 T", () => {
  const m = mk();
  m.regs.iy = 0x42f0; m.regs.c = 0x02; m.regs.b = 0x03;
  m.push16(0x9999);
  loc_148e(m);
  assert.equal(m.cycles, 57, "17+10+15+4+11");
  assert.deepEqual(m.calls, [0x149b], "spawn into (iy)");
  assert.equal(m.regs.iy, 0x4310, "IY += 0x20");
  assert.equal(m.regs.c, 0x01, "C decremented");
  assert.equal(m.regs.b, 0x03, "B untouched while budget remains");
  assert.equal(m.pc, 0x9999, "ret nz to caller");
});

test("loc_148e: budget exhausted (C=1) -> B forced to 1; 68 T", () => {
  const m = mk();
  m.regs.iy = 0x42f0; m.regs.c = 0x01; m.regs.b = 0x03;
  m.push16(0x9999);
  loc_148e(m);
  assert.equal(m.cycles, 68, "17+10+15+4+5+7+10");
  assert.equal(m.regs.c, 0x00, "C hit 0");
  assert.equal(m.regs.b, 0x01, "B forced to 1 to end the caller's walk");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_148e.js
//   find: regs.de = 0x0020;
//   repl: regs.de = 0x0010;  (IY advances by the wrong stride)
//   expect: FAIL  (IY = 0x4300 not 0x4310, caught by the IY assert)
test("loc_148e: the contract catches a wrong IY stride", () => {
  const mutant = (m) => {
    const { regs } = m;
    m.push16(0x1491); m.step(0x149b, 17); m.call(0x149b);
    regs.de = 0x0010; m.step(0x1494, 10); // MUTANT: wrong stride
    regs.addIy(regs.de); m.step(0x1496, 15);
    regs.c = regs.dec8(regs.c); m.step(0x1497, 4);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x1498, 5);
    regs.b = 0x01; m.step(0x149a, 7);
    m.ret();
  };
  const m = mk();
  m.regs.iy = 0x42f0; m.regs.c = 0x02;
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.regs.iy, 0x4310));
});
