// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1a12 (ROM 0x1a12-0x1a44): per-object contribution helper. Active + in-range object
// builds a table index from coordinates, reads a signed step from the 16-byte table at 0x1a45, and adds it
// into B. Leaf routine (no calls). Contract: index E=2 -> table[2]=0xfe, B: 0x05 -> 0x03, 206 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1a12 } from "../loc_1a12.js";

// signed-step table @0x1a45 (from ROM); loaded into the ROM image the routine reads
const TABLE = [0x02, 0x03, 0xfe, 0x02, 0xff, 0xfe, 0x00, 0xff,
               0x00, 0x01, 0x01, 0x02, 0x02, 0xfe, 0xfe, 0x03];

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  for (let i = 0; i < TABLE.length; i++) m.mem.rom[0x1a45 + i] = TABLE[i];
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };

// active object at IX=0x4260, H/L/C + (0x4202) chosen so E=2 (table[2]=0xfe), band 0
function scene(m) {
  m.regs.ix = 0x4260;
  wr(m, 0x4260, 0x01); // bit0 -> active
  m.regs.h = 0x90;     // H-0x80 = 0x10 (>=0)
  m.regs.l = 0x10;
  m.regs.c = 0x00;
  m.regs.b = 0x05;     // incoming accumulator
  wr(m, 0x4202, 0x80); // reference X; delta = 0x80-0x10-0x40 = 0x30 (< 0x80)
}

function checkSpec(m) {
  assert.equal(m.cycles, 206, "in-range path T-state total");
  assert.deepEqual(m.calls, [], "leaf routine");
  assert.equal(m.regs.e, 0x02, "table index");
  assert.equal(m.regs.b, 0x03, "B += table[2]=0xfe -> 0x05-2");
  assert.equal(m.regs.a, 0x03, "A = new B");
  assert.equal(m.pc, 0x9999, "ret to caller");
}

test("loc_1a12: active in-range object accumulates signed step into B; 206 T", () => {
  const m = mk();
  scene(m);
  m.push16(0x9999);
  loc_1a12(m);
  checkSpec(m);
});

test("loc_1a12: inactive object (bit0 of (ix+0) clear) -> immediate ret z; 31 T; B unchanged", () => {
  const m = mk();
  scene(m);
  wr(m, 0x4260, 0x00); // bit0 clear
  m.push16(0x9999);
  loc_1a12(m);
  assert.equal(m.cycles, 31, "20 + 11");
  assert.equal(m.regs.b, 0x05, "accumulator untouched");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1a12.js
//   find: regs.and(0x60);\n  m.step(0x1a30, 7); // keep bits 5-6 of the delta
//   repl: regs.and(0x40); ...  (drops bit5 of the delta -> index E=0 not 2)
//   expect: FAIL -- reads table[0]=0x02, so B -> 0x07 not 0x03
test("loc_1a12: contract catches a wrong index mask", () => {
  const m = mk();
  scene(m);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.bit(0, mem.read8(regs.ix), (regs.ix >> 8) & 0xff); mm.step(0x1a16, 20);
    if (regs.fZ) { mm.ret(11); return; }
    mm.step(0x1a17, 5);
    regs.a = regs.h; mm.step(0x1a18, 4);
    regs.sub(0x80); mm.step(0x1a1a, 7);
    if (regs.fC) { mm.ret(11); return; }
    mm.step(0x1a1b, 5);
    regs.e = 0x00; mm.step(0x1a1d, 7);
    regs.sub(0x34); mm.step(0x1a1f, 7);
    if (regs.fC) { mm.step(0x1a25, 12); }
    else {
      mm.step(0x1a21, 7);
      regs.e = regs.inc8(regs.e); mm.step(0x1a22, 4);
      regs.sub(0x34); mm.step(0x1a24, 7);
      if (regs.fNC) { mm.ret(11); return; }
      mm.step(0x1a25, 5);
    }
    regs.a = mem.read8(0x4202); mm.step(0x1a28, 13);
    regs.sub(regs.l); mm.step(0x1a29, 4);
    regs.sub(0x40); mm.step(0x1a2b, 7);
    regs.cp(0x80); mm.step(0x1a2d, 7);
    if (regs.fNC) { mm.ret(11); return; }
    mm.step(0x1a2e, 5);
    regs.and(0x40); mm.step(0x1a30, 7); // MUTANT: 0x40 not 0x60
    regs.l = regs.a; mm.step(0x1a31, 4);
    regs.a = regs.c; mm.step(0x1a32, 4);
    regs.and(0x80); mm.step(0x1a34, 7);
    regs.or(regs.l); mm.step(0x1a35, 4);
    regs.rrca(); mm.step(0x1a36, 4);
    regs.rrca(); mm.step(0x1a37, 4);
    regs.rrca(); mm.step(0x1a38, 4);
    regs.rrca(); mm.step(0x1a39, 4);
    regs.or(regs.e); mm.step(0x1a3a, 4);
    regs.e = regs.a; mm.step(0x1a3b, 4);
    regs.d = 0x00; mm.step(0x1a3d, 7);
    regs.hl = 0x1a45; mm.step(0x1a40, 10);
    regs.addHl(regs.de); mm.step(0x1a41, 11);
    regs.a = mem.read8(regs.hl); mm.step(0x1a42, 7);
    regs.add(regs.b); mm.step(0x1a43, 4);
    regs.b = regs.a; mm.step(0x1a44, 4);
    mm.ret();
  };
  mutant(m);
  assert.throws(() => checkSpec(m));
});
