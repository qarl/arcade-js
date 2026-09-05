// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0367 (ROM 0x0367-0x0393): periodic VRAM draw gated by 0x4241 count + 0x425f frame.
//   0367 3a 41 42 / a7 / c8       B=(0x4241); ret z (count 0)
//   036c 3d / c8 / 47             dec A; ret z (count 1); B=count-1
//   036f 3a 5f 42 / 4f / e6 3f    C=(0x425f); A=low6
//   0375 28 49                    jr z,loc_03c0  (low6==0)
//   0377 fe 20 / c0               cp 0x20; ret nz (only the 0x20 phase acts)
//   037a..0388                    row = bits6-7; E=3*row; HL=0x039a+E (3-byte rows)
//   0389 11 93 51 / cd af 03      DE=0x5193 (VRAM); call 0x03af (draw one row)
//   038f 05 / c8                  dec B; ret z (single row)
//   0391 21 a6 03                 more rows: inlined loc_0394 djnz loop (call 0x03af B-1 more times, ret)
// Contracts: count0 28 T; count1 37 T; low6==0 71 T; wrong-phase 84 T; single-row 183 T; two-row 222 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0367 } from "../loc_0367.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x43f0;
  m.mem.write8(0x43f0, 0x00); m.mem.write8(0x43f1, 0x20); // caller return = 0x2000
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
function tail(m, a) { m.routines.set(a, () => "TAIL"); }
// 0x03af is a real `call` (return addr pushed): record [HL, DE] and pop the frame.
function stubDraw(m, args) {
  m.routines.set(0x03af, (mm) => { args.push([mm.regs.hl, mm.regs.de]); mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
}

test("loc_0367: count 0 -> ret z; 28 T", () => {
  const m = mk();
  m.mem.write8(0x4241, 0);
  loc_0367(m);
  assert.equal(m.cycles, 28, "13 + 4 + 11");
  assert.deepEqual(m.calls, []);
  assert.equal(m.pc, 0x2000);
});

test("loc_0367: count 1 -> ret z; 37 T", () => {
  const m = mk();
  m.mem.write8(0x4241, 1);
  loc_0367(m);
  assert.equal(m.cycles, 37, "13 + 4 + 5 + 4 + 11");
  assert.deepEqual(m.calls, []);
  assert.equal(m.pc, 0x2000);
});

test("loc_0367: low6==0 -> jr loc_03c0; 71 T", () => {
  const m = mk();
  tail(m, 0x03c0);
  m.mem.write8(0x4241, 2);
  m.mem.write8(0x425f, 0x40); // 0x40 & 0x3f == 0
  const ret = loc_0367(m);
  assert.equal(m.cycles, 71);
  assert.deepEqual(m.calls, [0x03c0]);
  assert.equal(ret, "TAIL");
});

test("loc_0367: low6 != 0 and != 0x20 -> ret nz; 84 T", () => {
  const m = mk();
  m.mem.write8(0x4241, 2);
  m.mem.write8(0x425f, 0x10);
  loc_0367(m);
  assert.equal(m.cycles, 84);
  assert.deepEqual(m.calls, []);
  assert.equal(m.pc, 0x2000);
});

function checkSingle(m, args) {
  assert.equal(m.cycles, 183, "single-row draw T total");
  assert.deepEqual(m.calls, [0x03af], "one draw call");
  // 0x425f=0xE0 -> C=0xE0; rlca rlca -> 0x83; &3 -> row 3; E=3*3=9; HL=0x039a+9
  assert.deepEqual(args, [[0x03a3, 0x5193]], "row-3 table ptr 0x03a3 + VRAM dest 0x5193");
  assert.equal(m.pc, 0x2000, "ret z after single row");
}

test("loc_0367: 0x20 phase, count 2 -> draw one row; 183 T", () => {
  const m = mk();
  const args = [];
  stubDraw(m, args);
  m.mem.write8(0x4241, 2); // B = 1
  m.mem.write8(0x425f, 0xe0); // low6 == 0x20, bits6-7 == 3
  loc_0367(m);
  checkSingle(m, args);
});

test("loc_0367: 0x20 phase, count 3 -> draw + inlined loc_0394 loop (2 rows); 222 T", () => {
  const m = mk();
  const args = [];
  stubDraw(m, args);
  m.mem.write8(0x4241, 3); // B = 2 -> one pre-loop row + one loop row
  m.mem.write8(0x425f, 0xe0);
  loc_0367(m);
  assert.equal(m.cycles, 222, "187 (through ld hl,0x03a6) + 17 (loop call) + 8 (djnz not taken) + 10 (ret)");
  assert.deepEqual(m.calls, [0x03af, 0x03af], "pre-loop draw then one inlined loop draw");
  assert.deepEqual(args, [[0x03a3, 0x5193], [0x03a6, 0x5193]], "row-3 ptr then loop table 0x03a6 (stub leaves HL/DE)");
  assert.equal(m.pc, 0x2000, "ret after the loop");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0367.js
//   find: regs.de = 0x5193;
//   repl: regs.de = 0x5194;
//   expect: FAIL (draw dest becomes 0x5194, not the 0x5193 VRAM address)
test("loc_0367: the contract catches a wrong VRAM dest", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4241); m.step(0x036a, 13);
    regs.and(regs.a); m.step(0x036b, 4);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x036c, 5);
    regs.a = regs.dec8(regs.a); m.step(0x036d, 4);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x036e, 5);
    regs.b = regs.a; m.step(0x036f, 4);
    regs.a = mem.read8(0x425f); m.step(0x0372, 13);
    regs.c = regs.a; m.step(0x0373, 4);
    regs.and(0x3f); m.step(0x0375, 7);
    if (regs.fZ) { m.step(0x03c0, 12); return m.call(0x03c0); }
    m.step(0x0377, 7);
    regs.cp(0x20); m.step(0x0379, 7);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x037a, 5);
    regs.a = regs.c; m.step(0x037b, 4);
    regs.rlca(); m.step(0x037c, 4);
    regs.rlca(); m.step(0x037d, 4);
    regs.and(0x03); m.step(0x037f, 7);
    regs.c = regs.a; m.step(0x0380, 4);
    regs.add(regs.a); m.step(0x0381, 4);
    regs.add(regs.c); m.step(0x0382, 4);
    regs.e = regs.a; m.step(0x0383, 4);
    regs.d = 0x00; m.step(0x0385, 7);
    regs.hl = 0x039a; m.step(0x0388, 10);
    regs.addHl(regs.de); m.step(0x0389, 11);
    regs.de = 0x5194; m.step(0x038c, 10); // MUTANT
    m.push16(0x038f); m.step(0x03af, 17); m.call(0x03af);
    regs.b = regs.dec8(regs.b); m.step(0x0390, 4);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x0391, 5);
    regs.hl = 0x03a6; m.step(0x0394, 10);
    for (;;) {
      m.push16(0x0397); m.step(0x03af, 17); m.call(0x03af);
      regs.b = (regs.b - 1) & 0xff;
      if (regs.b !== 0) { m.step(0x0394, 13); continue; }
      m.step(0x0399, 8); break;
    }
    m.ret();
  };
  const m = mk();
  const args = [];
  stubDraw(m, args);
  m.mem.write8(0x4241, 2);
  m.mem.write8(0x425f, 0xe0);
  mutant(m);
  assert.throws(() => checkSingle(m, args));
});
