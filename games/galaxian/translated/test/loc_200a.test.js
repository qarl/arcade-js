// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_200a (Galaxian dispatch loop, ROM 0x200a-0x2018):
//   200a  26 40     ld h,0x40
//   200c  3a a1 40  ld a,(0x40a1)     ; slot pointer
//   200f  6f        ld l,a
//   2010  7e        ld a,(hl)         ; control byte
//   2011  87        add a,a           ; bit7 -> carry
//   2012  30 05     jr nc,0x2019      ; bit7 clear -> decode
//   2014  cd 67 20  call 0x2067       ; bit7 set -> service, then
//   2017  18 f1     jr 0x200a         ; re-scan
// Contract A (bit7 clear): 6 instr, 47 T (7+13+4+7+4+12), delegates to loc_2019.
// Contract B (bit7 set): call 0x2067, loop, then decode; 118 T, calls [0x2067, 0x2019].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_200a } from "../loc_200a.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function checkClear(m, ret) {
  assert.equal(m.cycles, 47, "T-state total (7+13+4+7+4+12)");
  assert.deepEqual(m.calls, [0x2019], "bit7 clear -> decode at 0x2019");
  assert.equal(ret, "TAIL", "the fall-through callee result propagates");
  assert.equal(m.regs.h, 0x40, "H = page 0x40");
  assert.equal(m.regs.l, 0x50, "L = slot pointer read from 0x40a1");
  assert.equal(m.regs.a, 0x40, "A = control byte (0x20) doubled");
  assert.equal(m.regs.fNC, true, "no carry: bit7 was clear");
}

test("loc_200a: bit7 clear -> decode; 47 T", () => {
  const m = mk({ 0x2019: "tail" });
  m.mem.write8(0x40a1, 0x50); // slot pointer -> HL=0x4050
  m.mem.write8(0x4050, 0x20); // control byte, bit7 clear
  checkClear(m, loc_200a(m));
});

test("loc_200a: bit7 set -> call 0x2067, re-scan, then decode; 118 T", () => {
  const m = mk({ 0x2019: "tail" });
  m.regs.sp = 0x4400; // push16 lands in work RAM
  m.mem.write8(0x40a1, 0x50);
  m.mem.write8(0x4050, 0x80); // control byte, bit7 SET
  // 0x2067 stub: pop its return addr AND clear bit7 so the re-scan exits.
  m.routines.set(0x2067, (mm) => {
    mm.regs.sp = (mm.regs.sp + 2) & 0xffff;
    mm.mem.write8(0x4050, 0x10);
  });
  const ret = loc_200a(m);
  assert.equal(m.cycles, 118, "iter1 (call path) 71 + iter2 (decode) 47");
  assert.deepEqual(m.calls, [0x2067, 0x2019], "service 0x2067 then decode 0x2019");
  assert.equal(ret, "TAIL");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_200a.js
//   find: return m.call(0x2019);
//   repl: return m.call(0x2018);
//   expect: FAIL  (wrong decode target, caught by calls == [0x2019])
test("loc_200a: the contract catches a wrong decode target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      regs.h = 0x40; m.step(0x200c, 7);
      regs.a = mem.read8(0x40a1); m.step(0x200f, 13);
      regs.l = regs.a; m.step(0x2010, 4);
      regs.a = mem.read8(regs.hl); m.step(0x2011, 7);
      regs.add(regs.a); m.step(0x2012, 4);
      if (regs.fNC) { m.step(0x2019, 12); break; }
      m.step(0x2014, 7);
      m.push16(0x2017); m.step(0x2067, 17); m.call(0x2067);
      m.step(0x200a, 12);
    }
    return m.call(0x2018); // MUTANT
  };
  const m = mk({ 0x2018: "tail", 0x2019: "tail" });
  m.mem.write8(0x40a1, 0x50); m.mem.write8(0x4050, 0x20);
  assert.throws(() => checkClear(m, mutant(m)));
});
