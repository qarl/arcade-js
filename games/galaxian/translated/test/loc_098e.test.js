// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_098e (ROM 0x098e-0x0a31): reduce the 0x4123 occupancy map into edge/summary cells.
// Contract (all-zeros map): 6271 T, no calls; row-ORs 0x41ea..0x41ef and col-ORs 0x41f3..0x41fc all 0;
// DE bound (0x4210)=0x22,(0x4211)=0xe0 (both scans exhaust -> reset constants); side flags 0x4220/0x4221/
// 0x4225/0x4226 = 1 (0 ^ C=1); A=1 at ret.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_098e } from "../loc_098e.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400; m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const rd = (m, a) => m.mem.workRam[a & 0x3ff];
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };

test("loc_098e: all-zeros map -> reset edge bound + side flags; 6271 T", () => {
  const m = mk();
  m.push16(0x9999);
  loc_098e(m); // work RAM starts all zero
  assert.equal(m.cycles, 6271, "fixed T with both bit-scans exhausting (no early jr)");
  assert.deepEqual(m.calls, [], "no calls");
  for (let a = 0x41e8; a <= 0x41f2; a++) assert.equal(rd(m, a), 0, `row-OR region ${a.toString(16)} = 0`);
  for (let a = 0x41f3; a <= 0x41fc; a++) assert.equal(rd(m, a), 0, `col-OR region ${a.toString(16)} = 0`);
  assert.equal(rd(m, 0x4210), 0x22, "E bound reset (down-scan exhausted)");
  assert.equal(rd(m, 0x4211), 0xe0, "D bound reset (up-scan exhausted)");
  assert.equal(rd(m, 0x4221), 1, "0x4221 side flag = 0 ^ C(1)");
  assert.equal(rd(m, 0x4220), 1, "0x4220 side flag");
  assert.equal(rd(m, 0x4226), 1, "0x4226 side flag");
  assert.equal(rd(m, 0x4225), 1, "0x4225 side flag");
  assert.equal(m.regs.a, 1, "A = last xor c result");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_098e: a set bit in map col 9 (0x412c) drives both scans to that column", () => {
  const m = mk();
  m.push16(0x9999);
  wr(m, 0x412c, 0x01); // row0/col9 occupied
  loc_098e(m);
  assert.equal(rd(m, 0x41ea), 1, "row0 OR picks up the set bit");
  assert.equal(rd(m, 0x41fc), 1, "col9 OR picks up the set bit");
  assert.equal(rd(m, 0x4210), 0x22, "down-scan finds col9 first -> E stays 0x22");
  assert.equal(rd(m, 0x4211), 0x50, "up-scan reaches col9 after 9 steps -> D = 0xe0 - 9*0x10");
});

// MUTATION-PATCH loc_098e.js @0x09f4: `regs.d = 0xe0;` (up-scan exhaust reset) -> `regs.d = 0x00;`
//   with the all-zeros map the up-scan exhausts, so that reset value is exactly what (0x4211) receives;
//   the mutant writes (0x4211)=0x00 and the contract's (0x4211)==0xe0 assert catches it.
test("loc_098e: contract catches a wrong up-scan reset constant", () => {
  const m = mk();
  m.push16(0x9999);
  mutant098e(m); // full body, one line changed
  assert.equal(rd(m, 0x4211), 0x00, "mutant produced the wrong bound...");
  assert.throws(() => assert.equal(rd(m, 0x4211), 0xe0), "...which the faithful contract rejects");
});

// loc_098e body verbatim EXCEPT the single mutated line marked MUTANT.
function mutant098e(m) {
  const { regs, mem } = m;
  regs.xor(regs.a); m.step(0x098f, 4);
  regs.de = 0x41e8; m.step(0x0992, 10);
  mem.write8(regs.de, regs.a); m.step(0x0993, 7);
  regs.e = regs.inc8(regs.e); m.step(0x0994, 4);
  mem.write8(regs.de, regs.a); m.step(0x0995, 7);
  regs.e = regs.inc8(regs.e); m.step(0x0996, 4);
  regs.c = 0x06; m.step(0x0998, 7);
  regs.hl = 0x4123; m.step(0x099b, 10);
  for (;;) {
    regs.b = 0x0a; m.step(0x099d, 7);
    regs.xor(regs.a); m.step(0x099e, 4);
    for (;;) {
      regs.or(mem.read8(regs.hl)); m.step(0x099f, 7);
      regs.l = regs.inc8(regs.l); m.step(0x09a0, 4);
      if (regs.djnz() !== 0) { m.step(0x099e, 13); continue; }
      m.step(0x09a2, 8); break;
    }
    mem.write8(regs.de, regs.a); m.step(0x09a3, 7);
    regs.e = regs.inc8(regs.e); m.step(0x09a4, 4);
    regs.a = regs.l; m.step(0x09a5, 4);
    regs.add(0x06); m.step(0x09a7, 7);
    regs.l = regs.a; m.step(0x09a8, 4);
    regs.c = regs.dec8(regs.c); m.step(0x09a9, 4);
    if (regs.fNZ) { m.step(0x099b, 10); continue; }
    m.step(0x09ac, 10); break;
  }
  regs.xor(regs.a); m.step(0x09ad, 4);
  mem.write8(regs.de, regs.a); m.step(0x09ae, 7);
  regs.e = regs.inc8(regs.e); m.step(0x09af, 4);
  mem.write8(regs.de, regs.a); m.step(0x09b0, 7);
  regs.e = regs.inc8(regs.e); m.step(0x09b1, 4);
  mem.write8(regs.de, regs.a); m.step(0x09b2, 7);
  regs.e = regs.inc8(regs.e); m.step(0x09b3, 4);
  regs.hl = 0x4123; m.step(0x09b6, 10);
  regs.c = 0x0a; m.step(0x09b8, 7);
  for (;;) {
    m.push16(regs.de); m.step(0x09b9, 11);
    regs.de = 0x0010; m.step(0x09bc, 10);
    regs.b = 0x06; m.step(0x09be, 7);
    regs.xor(regs.a); m.step(0x09bf, 4);
    for (;;) {
      regs.or(mem.read8(regs.hl)); m.step(0x09c0, 7);
      regs.addHl(regs.de); m.step(0x09c1, 11);
      if (regs.djnz() !== 0) { m.step(0x09bf, 13); continue; }
      m.step(0x09c3, 8); break;
    }
    regs.de = m.pop16(); m.step(0x09c4, 10);
    mem.write8(regs.de, regs.a); m.step(0x09c5, 7);
    regs.e = regs.inc8(regs.e); m.step(0x09c6, 4);
    regs.a = regs.l; m.step(0x09c7, 4);
    regs.sub(0x5f); m.step(0x09c9, 7);
    regs.l = regs.a; m.step(0x09ca, 4);
    regs.c = regs.dec8(regs.c); m.step(0x09cb, 4);
    if (regs.fNZ) { m.step(0x09b8, 10); continue; }
    m.step(0x09ce, 10); break;
  }
  regs.hl = 0x41fc; m.step(0x09d1, 10);
  regs.b = 0x0a; m.step(0x09d3, 7);
  regs.e = 0x22; m.step(0x09d5, 7);
  for (;;) {
    regs.bit(0, mem.read8(regs.hl)); m.step(0x09d7, 12);
    if (regs.fNZ) { m.step(0x09e2, 12); break; }
    m.step(0x09d9, 7);
    regs.l = regs.dec8(regs.l); m.step(0x09da, 4);
    regs.a = regs.e; m.step(0x09db, 4);
    regs.add(0x10); m.step(0x09dd, 7);
    regs.e = regs.a; m.step(0x09de, 4);
    if (regs.djnz() !== 0) { m.step(0x09d5, 13); continue; }
    m.step(0x09e0, 8);
    regs.e = 0x22; m.step(0x09e2, 7); break;
  }
  regs.hl = 0x41f3; m.step(0x09e5, 10);
  regs.b = 0x0a; m.step(0x09e7, 7);
  regs.d = 0xe0; m.step(0x09e9, 7);
  for (;;) {
    regs.bit(0, mem.read8(regs.hl)); m.step(0x09eb, 12);
    if (regs.fNZ) { m.step(0x09f6, 12); break; }
    m.step(0x09ed, 7);
    regs.l = regs.inc8(regs.l); m.step(0x09ee, 4);
    regs.a = regs.d; m.step(0x09ef, 4);
    regs.sub(0x10); m.step(0x09f1, 7);
    regs.d = regs.a; m.step(0x09f2, 4);
    if (regs.djnz() !== 0) { m.step(0x09e9, 13); continue; }
    m.step(0x09f4, 8);
    regs.d = 0x00; m.step(0x09f6, 7); break; // MUTANT: was 0xe0
  }
  mem.write16(0x4210, regs.de); m.step(0x09fa, 20);
  regs.hl = 0x41ea; m.step(0x09fd, 10);
  regs.c = 0x01; m.step(0x09ff, 7);
  regs.b = 0x04; m.step(0x0a01, 7);
  regs.xor(regs.a); m.step(0x0a02, 4);
  for (;;) {
    regs.or(mem.read8(regs.hl)); m.step(0x0a03, 7);
    regs.l = regs.inc8(regs.l); m.step(0x0a04, 4);
    if (regs.djnz() !== 0) { m.step(0x0a02, 13); continue; }
    m.step(0x0a06, 8); break;
  }
  regs.xor(regs.c); m.step(0x0a07, 4);
  mem.write8(0x4221, regs.a); m.step(0x0a0a, 13);
  regs.xor(regs.c); m.step(0x0a0b, 4);
  regs.or(mem.read8(regs.hl)); m.step(0x0a0c, 7);
  regs.l = regs.inc8(regs.l); m.step(0x0a0d, 4);
  regs.or(mem.read8(regs.hl)); m.step(0x0a0e, 7);
  regs.xor(regs.c); m.step(0x0a0f, 4);
  mem.write8(0x4220, regs.a); m.step(0x0a12, 13);
  regs.hl = 0x42d0; m.step(0x0a15, 10);
  regs.de = 0x0020; m.step(0x0a18, 10);
  regs.b = 0x07; m.step(0x0a1a, 7);
  regs.xor(regs.a); m.step(0x0a1b, 4);
  for (;;) {
    regs.or(mem.read8(regs.hl)); m.step(0x0a1c, 7);
    regs.addHl(regs.de); m.step(0x0a1d, 11);
    if (regs.djnz() !== 0) { m.step(0x0a1b, 13); continue; }
    m.step(0x0a1f, 8); break;
  }
  regs.xor(regs.c); m.step(0x0a20, 4);
  mem.write8(0x4226, regs.a); m.step(0x0a23, 13);
  regs.xor(regs.c); m.step(0x0a24, 4);
  regs.hl = 0x42b1; m.step(0x0a27, 10);
  regs.b = 0x08; m.step(0x0a29, 7);
  for (;;) {
    regs.or(mem.read8(regs.hl)); m.step(0x0a2a, 7);
    regs.addHl(regs.de); m.step(0x0a2b, 11);
    if (regs.djnz() !== 0) { m.step(0x0a29, 13); continue; }
    m.step(0x0a2d, 8); break;
  }
  regs.xor(regs.c); m.step(0x0a2e, 4);
  mem.write8(0x4225, regs.a); m.step(0x0a31, 13);
  m.ret();
}
