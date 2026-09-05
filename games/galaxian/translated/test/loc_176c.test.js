// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_176c (ROM 0x176c-0x17a8): one sound/animation channel step for the descriptor in HL.
//   176c 7e / 176d a7 / 176e c8   ld a,(hl); and a; ret z   -- inactive -> return
//   176f eb ... 177f c2 a2 17     stage 0x41c0=2,0x41c1=(0x41d5); dec 0x41d6; nz -> loc_17a2 (store back)
//   1782 2a d3 41 ... 1788 28 1c  timer expired: read command at (0x41d3); cp 0xe0; z -> loc_17a6 (clear)
//   178a..17a1                    else decode: low5 -> table 0x17a9 -> 0x41d5, high3 -> table 0x17c8 -> 0x41d6
//   17a2 32 d6 41 / 17a5 c9       loc_17a2: ld (0x41d6),a; ret
//   17a6 af / 17a7 12 / 17a8 c9   loc_17a6: xor a; ld (de),a; ret   -- deactivate the descriptor
// Contracts: inactive 22 T; timer-live 116 T; terminator 156 T; decode 264 T (rst 0x20 = loc_0020 stubbed).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_176c } from "../loc_176c.js";

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

// rst 0x20 (loc_0020) stub: record [HL, A] (table base, index) and pop the pushed rst frame. Leaves A
// unchanged (the actual byte lookup is loc_0020's job), so 0x41d5/0x41d6 receive the computed INDEX here.
function stubRst(m, args) {
  m.routines.set(0x0020, (mm) => {
    args.push([mm.regs.hl, mm.regs.a]);
    mm.regs.sp = (mm.regs.sp + 2) & 0xffff;
  });
}

test("loc_176c: inactive descriptor -> ret z; 22 T", () => {
  const m = mk();
  m.regs.hl = 0x4300;
  m.mem.write8(0x4300, 0x00); // descriptor inactive
  loc_176c(m);
  assert.equal(m.cycles, 22, "7 + 4 + 11");
  assert.deepEqual(m.calls, [], "no dispatch");
  assert.equal(m.pc, 0x2000, "ret z returned to the caller");
});

function checkTimer(m) {
  assert.equal(m.cycles, 116, "timer-live T total");
  assert.equal(m.mem.read8(0x41c0), 2, "0x41c0 = 2");
  assert.equal(m.mem.read8(0x41c1), 0x77, "0x41c1 = current 0x41d5");
  assert.equal(m.mem.read8(0x41d6), 4, "0x41d6 = 5 decremented to 4");
  assert.equal(m.pc, 0x2000, "ret");
}

test("loc_176c: timer still running -> store decremented duration; 116 T", () => {
  const m = mk();
  m.regs.hl = 0x4300;
  m.mem.write8(0x4300, 0x07); // active
  m.mem.write8(0x41d5, 0x77);
  m.mem.write8(0x41d6, 5); // dec -> 4, nonzero
  loc_176c(m);
  checkTimer(m);
});

test("loc_176c: 0xe0 terminator -> clear the descriptor; 156 T", () => {
  const m = mk();
  m.regs.hl = 0x4300;
  m.mem.write8(0x4300, 0x07); // active; DE (=ptr) target for the clear
  m.mem.write8(0x41d6, 1); // dec -> 0: timer expired
  m.mem.write16(0x41d3, 0x4210); // sequence pointer
  m.mem.write8(0x4210, 0xe0); // terminator command
  loc_176c(m);
  assert.equal(m.cycles, 156, "terminator T total");
  assert.equal(m.mem.read8(0x4300), 0, "descriptor deactivated via (DE)=0");
  assert.equal(m.pc, 0x2000, "ret");
});

function checkDecode(m, args) {
  assert.equal(m.cycles, 264, "decode T total (loc_0020 body excluded — stubbed)");
  assert.deepEqual(m.calls, [0x0020, 0x0020], "two rst 0x20 lookups");
  assert.deepEqual(args, [[0x17a9, 0x13], [0x17c8, 0x02]], "table bases + indices from B=0x53");
  assert.equal(m.mem.read8(0x41c0), 2, "0x41c0 = 2");
  assert.equal(m.mem.read8(0x41c1), 0x77, "0x41c1 = current 0x41d5");
  assert.equal(m.mem.read8(0x41d5), 0x13, "0x41d5 = low-5-bit index (stub leaves A)");
  assert.equal(m.mem.read8(0x41d6), 0x02, "0x41d6 = high-3-bit index");
  assert.equal(m.mem.read16(0x41d3), 0x4211, "sequence pointer advanced by 1");
  assert.equal(m.pc, 0x2000, "ret");
}

test("loc_176c: expired timer decodes the next command; 264 T", () => {
  const m = mk();
  const args = [];
  stubRst(m, args);
  m.regs.hl = 0x4300;
  m.mem.write8(0x4300, 0x07); // active
  m.mem.write8(0x41d5, 0x77);
  m.mem.write8(0x41d6, 1); // dec -> 0
  m.mem.write16(0x41d3, 0x4210);
  m.mem.write8(0x4210, 0x53); // command: low5=0x13, high3=0x02
  loc_176c(m);
  checkDecode(m, args);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_176c.js
//   find: regs.a = 0x02;
//   repl: regs.a = 0x03;
//   expect: FAIL (0x41c0 gets 3 instead of 2)
test("loc_176c: the contract catches a wrong 0x41c0 constant", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(regs.hl); m.step(0x176d, 7);
    regs.and(regs.a); m.step(0x176e, 4);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x176f, 5);
    regs.exDeHl(); m.step(0x1770, 4);
    regs.a = 0x03; m.step(0x1772, 7); // MUTANT
    mem.write8(0x41c0, regs.a); m.step(0x1775, 13);
    regs.a = mem.read8(0x41d5); m.step(0x1778, 13);
    mem.write8(0x41c1, regs.a); m.step(0x177b, 13);
    regs.a = mem.read8(0x41d6); m.step(0x177e, 13);
    regs.a = regs.dec8(regs.a); m.step(0x177f, 4);
    if (regs.fNZ) {
      m.step(0x17a2, 10);
      mem.write8(0x41d6, regs.a); m.step(0x17a5, 13);
      m.ret();
      return;
    }
    m.step(0x1782, 10);
  };
  const m = mk();
  m.regs.hl = 0x4300;
  m.mem.write8(0x4300, 0x07);
  m.mem.write8(0x41d5, 0x77);
  m.mem.write8(0x41d6, 5);
  mutant(m);
  assert.throws(() => checkTimer(m));
});
