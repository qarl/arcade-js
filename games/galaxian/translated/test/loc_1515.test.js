// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1515 (ROM 0x1515-0x1554): guarded WRAM updater. Full-loop contract with (0x4200)
// bit0 set, (0x4220)/(0x422b) bit0 clear, (0x421a)=0x0003 -> B=4, (0x424a)=1 (dec->0) enters the reload
// loop; (0x424b)=1 refreshes via call 0x15df, C=1 -> (0x4228)=1. Contract: 416 T, calls [0x15df], (0x4228)=1.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1515 } from "../loc_1515.js";

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
// loc_15df stub: A=(DE); (HL)=A; C++; ret (pops the pushed return address).
const stub15df = (mm) => { mm.pop16(); mm.regs.a = mm.mem.read8(mm.regs.de); mm.mem.write8(mm.regs.hl, mm.regs.a); mm.regs.c = (mm.regs.c + 1) & 0xff; };

function run(fn) {
  const m = mk({ 0x15df: stub15df });
  m.mem.write8(0x4200, 0x01); // bit0 set -> ret nc not taken
  m.mem.write8(0x4220, 0x00); // bit0 clear -> ret c not taken
  m.mem.write8(0x422b, 0x00); // bit0 clear -> ret c not taken
  m.mem.write8(0x421a, 0x03); // L=3
  m.mem.write8(0x421b, 0x00); // H=0 (<2 -> A cleared)
  m.mem.write8(0x424a, 0x01); // dec -> 0 -> enter reload loop
  m.mem.write8(0x424b, 0x01); // dec -> 0 -> call 0x15df, C=1
  m.push16(0x9999);
  fn(m);
  return m;
}
function checkSpec(m) {
  assert.equal(m.cycles, 416, "T-state total of the full reload-loop path");
  assert.deepEqual(m.calls, [0x15df], "one refresh call (only 0x424b dec'd to zero)");
  assert.equal(m.mem.read8(0x4228), 1, "C!=0 -> (0x4228) <- 1");
  assert.equal(m.regs.c, 1, "one entry refreshed");
  assert.equal(m.pc, 0x9999, "ret to caller");
}

test("loc_1515: reload loop refreshes one entry (call 0x15df), sets (0x4228)=1; 416 T", () => {
  checkSpec(run(loc_1515));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1515.js
//   find: if (regs.fZ) {   (the loop's `call z,0x15df` guard)
//   repl: if (regs.fNZ) {
//   expect: FAIL (calls become [0x15df x3] over the 0xff entries, cycles 430; caught by calls/cycles)
test("loc_1515: the contract catches a flipped loop call condition (call z -> call nz)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4200); m.step(0x1518, 13);
    regs.rrca(); m.step(0x1519, 4);
    if (regs.fNC) { m.ret(11); return; } m.step(0x151a, 5);
    regs.a = mem.read8(0x4220); m.step(0x151d, 13);
    regs.rrca(); m.step(0x151e, 4);
    if (regs.fC) { m.ret(11); return; } m.step(0x151f, 5);
    regs.a = mem.read8(0x422b); m.step(0x1522, 13);
    regs.rrca(); m.step(0x1523, 4);
    if (regs.fC) { m.ret(11); return; } m.step(0x1524, 5);
    regs.hl = mem.read16(0x421a); m.step(0x1527, 16);
    regs.a = regs.h; m.step(0x1528, 4);
    regs.cp(0x02); m.step(0x152a, 7);
    if (regs.fNC) { m.step(0x152d, 12); } else { m.step(0x152c, 7); regs.xor(regs.a); m.step(0x152d, 4); }
    regs.add(regs.l); m.step(0x152e, 4);
    regs.and(0x0f); m.step(0x1530, 7);
    regs.a = regs.inc8(regs.a); m.step(0x1531, 4);
    regs.b = regs.a; m.step(0x1532, 4);
    regs.hl = 0x424a; m.step(0x1535, 10);
    regs.de = 0x15e3; m.step(0x1538, 10);
    regs.decMem8(mem, regs.hl); m.step(0x1539, 11);
    if (regs.fNZ) { m.step(0x153b, 7); regs.xor(regs.a); m.step(0x153c, 4); mem.write8(0x4228, regs.a); m.step(0x153f, 13); m.ret(); return; }
    m.step(0x1540, 12);
    regs.c = 0x00; m.step(0x1542, 7);
    regs.a = mem.read8(regs.de); m.step(0x1543, 7);
    mem.write8(regs.hl, regs.a); m.step(0x1544, 7);
    for (;;) {
      regs.hl = (regs.hl + 1) & 0xffff; m.step(0x1545, 6);
      regs.de = (regs.de + 1) & 0xffff; m.step(0x1546, 6);
      regs.decMem8(mem, regs.hl); m.step(0x1547, 11);
      if (regs.fNZ) { m.push16(0x154a); m.step(0x15df, 17); m.call(0x15df); } else { m.step(0x154a, 10); } // MUTANT fZ->fNZ
      if (regs.djnz() !== 0) { m.step(0x1544, 13); continue; }
      m.step(0x154c, 8); break;
    }
    regs.a = regs.c; m.step(0x154d, 4);
    regs.and(regs.a); m.step(0x154e, 4);
    if (regs.fZ) { m.ret(11); return; } m.step(0x154f, 5);
    regs.a = 0x01; m.step(0x1551, 7);
    mem.write8(0x4228, regs.a); m.step(0x1554, 13);
    m.ret();
  };
  assert.throws(() => checkSpec(run(mutant)));
});
