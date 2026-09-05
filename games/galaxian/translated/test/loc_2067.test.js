// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2067 (ROM 0x2067-0x207c):
//   ld a,(0x425f); ld b,a; and 0x0f; jr z,0x209c; ld hl,0x4120; add a,l; ld l,a;
//   ld a,(0x4238); rrca; ret c; ld c,0x10; ld b,0x06; (fall through into loc_207d)
// Contract: low nibble 0 -> tail loc_209c (36 T); else index HL=0x4120+nibble, bit0 of (0x4238) set -> ret
// (77 T); else seed C=0x10,B=6 and fall into loc_207d (85 T).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2067 } from "../loc_2067.js";

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
const tail = () => "TAIL";

test("loc_2067 main: nibble!=0, bit0 clear -> seed C/B, fall into loc_207d; 85 T", () => {
  const m = mk({ 0x207d: tail });
  m.mem.write8(0x425f, 0x35); // low nibble 5
  m.mem.write8(0x4238, 0x02); // bit0 = 0
  const ret = loc_2067(m);
  assert.equal(m.cycles, 85);
  assert.deepEqual(m.calls, [0x207d]);
  assert.equal(ret, "TAIL");
  assert.equal(m.regs.hl, 0x4125, "HL = 0x4120 + nibble(5)");
  assert.equal(m.regs.c, 0x10, "stride seeded");
  assert.equal(m.regs.b, 0x06, "slot count seeded");
});

test("loc_2067 nibble 0 -> tail loc_209c; 36 T", () => {
  const m = mk({ 0x209c: tail });
  m.mem.write8(0x425f, 0x30); // low nibble 0
  const ret = loc_2067(m);
  assert.equal(m.cycles, 36, "13+4+7+12");
  assert.deepEqual(m.calls, [0x209c]);
  assert.equal(ret, "TAIL");
  assert.equal(m.regs.b, 0x30, "B kept the full 0x425f value on this path");
});

test("loc_2067 bit0 set -> ret; 77 T, no call", () => {
  const m = mk();
  m.mem.write8(0x425f, 0x35);
  m.mem.write8(0x4238, 0x03); // bit0 = 1 -> rrca sets carry
  m.push16(0xbeef); // return address for the ret c
  loc_2067(m);
  assert.equal(m.cycles, 77);
  assert.deepEqual(m.calls, []);
  assert.equal(m.pc, 0xbeef, "ret c returned to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2067.js
//   find: regs.hl = 0x4120;
//   repl: regs.hl = 0x4130;
//   expect: FAIL (wrong table base -> HL = 0x4135, caught by HL == 0x4125 on the main path)
test("loc_2067: the contract catches a wrong slot-table base", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x425f); m.step(0x206a, 13);
    regs.b = regs.a; m.step(0x206b, 4);
    regs.and(0x0f); m.step(0x206d, 7);
    if (regs.fZ) { m.step(0x209c, 12); return m.call(0x209c); }
    m.step(0x206f, 7);
    regs.hl = 0x4130; m.step(0x2072, 10); // MUTANT
    regs.add(regs.l); m.step(0x2073, 4);
    regs.l = regs.a; m.step(0x2074, 4);
    regs.a = mem.read8(0x4238); m.step(0x2077, 13);
    regs.rrca(); m.step(0x2078, 4);
    if (regs.fC) { m.ret(11); return; }
    m.step(0x2079, 5);
    regs.c = 0x10; m.step(0x207b, 7);
    regs.b = 0x06; m.step(0x207d, 7);
    return m.call(0x207d);
  };
  const m = mk({ 0x207d: tail });
  m.mem.write8(0x425f, 0x35);
  m.mem.write8(0x4238, 0x02);
  mutant(m);
  assert.throws(() => assert.equal(m.regs.hl, 0x4125));
});
