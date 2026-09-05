// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1d58 (Galaxian IN0-gated work-RAM seed, ROM 0x1d58-0x1d70):
//   1d58  3a 00 60  ld a,(0x6000)   ; IN0
//   1d5b  e6 40     and 0x40        ; IN0 bit 6
//   1d5d  c0        ret nz          ; bail if bit 6 set
//   1d5e  21 00 50  ld hl,0x5000
//   1d61  22 0b 40  ld (0x400b),hl  ; VRAM ptr
//   1d64  3e 20     ld a,0x20
//   1d66  32 08 40  ld (0x4008),a
//   1d69  af        xor a
//   1d6a  32 1a 40  ld (0x401a),a
//   1d6d  32 05 40  ld (0x4005),a
//   1d70  c9        ret
// Two contracts:
//   (a) IN0 bit 6 clear -> full seed then ret. 111 T (13+7+5+10+16+7+13+4+13+13+10); calls == [];
//       (0x400b/0x400c)=0x00/0x50, (0x4008)=0x20, (0x401a)=0, (0x4005)=0; ret to caller.
//   (b) IN0 bit 6 set -> early ret nz. 31 T (13+7+11); calls == []; no seed writes; ret to caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1d58 } from "../loc_1d58.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.regs.sp = 0x4380; m.push16(0xbeef); // caller return slot in work RAM
  return m;
}
const wr = (m, a) => m.mem.workRam[a & 0x3ff];

function checkFull(m) {
  assert.equal(m.cycles, 111, "full-seed path T-total");
  assert.deepEqual(m.calls, [], "no m.call targets");
  assert.equal(wr(m, 0x400b), 0x00, "(0x400b)=0x00 (lo of 0x5000)");
  assert.equal(wr(m, 0x400c), 0x50, "(0x400c)=0x50 (hi of 0x5000)");
  assert.equal(wr(m, 0x4008), 0x20, "(0x4008)=0x20");
  assert.equal(wr(m, 0x401a), 0x00, "(0x401a)=0");
  assert.equal(wr(m, 0x4005), 0x00, "(0x4005)=0");
  assert.equal(m.pc, 0xbeef, "ret to caller");
}

test("loc_1d58: IN0 bit 6 clear -> full work-RAM seed + ret; 111 T", () => {
  const m = mk();
  m.io.in0 = 0x00; // IN0 bit 6 clear
  loc_1d58(m);
  checkFull(m);
});

test("loc_1d58: IN0 bit 6 set -> early ret nz, no seed; 31 T", () => {
  const m = mk();
  m.io.in0 = 0x40; // IN0 bit 6 set
  m.mem.workRam[0x008] = 0x99; // sentinel: must NOT be overwritten
  loc_1d58(m);
  assert.equal(m.cycles, 31, "13 (ld a) + 7 (and) + 11 (ret nz taken)");
  assert.deepEqual(m.calls, [], "no calls");
  assert.equal(wr(m, 0x4008), 0x99, "seed skipped -- (0x4008) untouched");
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1d58.js
//   find: regs.a = 0x20;
//   repl: regs.a = 0x21;
//   expect: FAIL  ((0x4008)=0x21 not 0x20 -- caught by checkFull)
//   verified-anchor: count == 1  (the sole "regs.a = 0x20;" in loc_1d58.js)
test("loc_1d58: the contract catches a wrong seed constant", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x6000); m.step(0x1d5b, 13);
    regs.and(0x40); m.step(0x1d5d, 7);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x1d5e, 5);
    regs.hl = 0x5000; m.step(0x1d61, 10);
    mem.write16(0x400b, regs.hl); m.step(0x1d64, 16);
    regs.a = 0x21; m.step(0x1d66, 7); // MUTANT: 0x21 not 0x20
    mem.write8(0x4008, regs.a); m.step(0x1d69, 13);
    regs.xor(regs.a); m.step(0x1d6a, 4);
    mem.write8(0x401a, regs.a); m.step(0x1d6d, 13);
    mem.write8(0x4005, regs.a); m.step(0x1d70, 13);
    m.ret();
  };
  const m = mk();
  m.io.in0 = 0x00;
  mutant(m);
  assert.throws(() => checkFull(m));
});
