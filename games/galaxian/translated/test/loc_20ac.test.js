// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_20ac (Galaxian, ROM 0x20ac-0x20cc): A=(0x400d); call 0x214e -> HL column pointer;
// DE=-0x20. If B bit4 clear -> jr straight into loc_20cd (60 T). If B bit4 set -> pre-fill 3 cells with
// 0x10, then when (0x400e)==0 ret z (133 T). The 0x214e stub sets HL=0x5340 (VIDEORAM) so writes land.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_20ac } from "../loc_20ac.js";

function mk() {
  const routines = new Map();
  routines.set(0x214e, (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; mm.regs.hl = 0x5340; });
  routines.set(0x20cd, () => "TAIL");
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4380;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const vr = (m, a) => m.mem.videoRam[a & 0x3ff];

test("loc_20ac: B bit4 clear -> straight into loc_20cd; 60 T", () => {
  const m = mk();
  m.regs.b = 0x00; // bit 4 clear
  const ret = loc_20ac(m);
  assert.equal(m.cycles, 60, "clear path T-total (13+17+10+8+12)");
  assert.deepEqual(m.calls, [0x214e, 0x20cd], "map call then tail into loc_20cd");
  assert.equal(m.regs.hl, 0x5340, "HL from loc_214e, no pre-fill stepping");
  assert.equal(ret, "TAIL", "loc_20cd result propagates");
});

test("loc_20ac: B bit4 set, (0x400e)==0 -> pre-fill 3 cells then ret z; 133 T", () => {
  const m = mk();
  m.regs.b = 0x10; // bit 4 set
  m.mem.workRam[0x00e] = 0x00; // (0x400e)==0 -> ret z after the pre-fill
  const ret = loc_20ac(m);
  assert.equal(m.cycles, 133, "set path T-total through ret z");
  assert.deepEqual(m.calls, [0x214e], "only the first map call; ret z before the second");
  assert.equal(vr(m, 0x5340), 0x10, "cell 0 pre-filled 0x10");
  assert.equal(vr(m, 0x5320), 0x10, "cell 1 (HL-0x20) pre-filled 0x10");
  assert.equal(vr(m, 0x5300), 0x10, "cell 2 (HL-0x40) pre-filled 0x10");
  assert.equal(ret, undefined, "ret z returns nothing");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_20ac.js
//   find: regs.bit(4, regs.b); // Z = B bit 4 clear
//   repl: regs.bit(5, regs.b); // Z = B bit 5 clear
//   expect: FAIL  (tests the wrong bit; with B=0x10 it now jr-z's into loc_20cd, skipping the pre-fill)
//   verified-anchor: count == 1  (the sole bit test in loc_20ac.js; loc_20cd owns the other)
test("loc_20ac: the contract catches testing the wrong B bit", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x400d); m.step(0x20af, 13);
    m.push16(0x20b2); m.step(0x214e, 17); m.call(0x214e);
    regs.de = 0xffe0; m.step(0x20b5, 10);
    regs.bit(5, regs.b); m.step(0x20b7, 8); // MUTANT: wrong bit
    if (regs.fZ) { m.step(0x20cd, 12); return m.call(0x20cd); }
    m.step(0x20b9, 7);
    regs.a = 0x10; m.step(0x20bb, 7);
    mem.write8(regs.hl, regs.a); m.step(0x20bc, 7);
    regs.addHl(regs.de); m.step(0x20bd, 11);
    mem.write8(regs.hl, regs.a); m.step(0x20be, 7);
    regs.addHl(regs.de); m.step(0x20bf, 11);
    mem.write8(regs.hl, regs.a); m.step(0x20c0, 7);
    regs.a = mem.read8(0x400e); m.step(0x20c3, 13);
    regs.and(regs.a); m.step(0x20c4, 4);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x20c5, 5);
    regs.a = mem.read8(0x400d); m.step(0x20c8, 13);
    regs.xor(0x01); m.step(0x20ca, 7);
    m.push16(0x20cd); m.step(0x214e, 17); m.call(0x214e);
    return m.call(0x20cd);
  };
  const m = mk();
  m.regs.b = 0x10;
  m.mem.workRam[0x00e] = 0x00;
  mutant(m);
  assert.throws(() => assert.equal(m.mem.videoRam[0x340], 0x10));
});
