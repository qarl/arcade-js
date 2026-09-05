// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1b79 (ROM checksum + power-on init tail, ROM 0x1B79-0x1BCC).
// Entry (from loc_1b70): A=0, HL=0x0000, B=0x28. Test ROM is all-zero, so a page sums to 0.
//
// Two contract scenarios over one page (B=1, HL=0x0000 -> reads ROM[0x00..0xFF] = 0):
//   FAIL: A(entry)=5 -> sum stays 5 -> `and a` NZ -> jp 0x1b34. 5423 T (256*21 inner +33 +14), calls [0x1b34].
//   PASS: A(entry)=0 -> sum 0 -> `and a` Z -> block-fill via rst 0x10 (loc_0010) x5, seed latches, jp 0x2000.
//         5730 T, calls [0x0010 x5, 0x2000]; irq_enable=1, stars_enable=1, flip_x/y=0; work-RAM seeds.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1b79 } from "../loc_1b79.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400; // rst 0x10 pushes land in work RAM
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_1b79 FAIL path: nonzero checksum -> jp 0x1b34; 5423 T", () => {
  const m = mk({ 0x1b34: "tail" });
  m.regs.a = 0x05; m.regs.b = 0x01; m.regs.hl = 0x0000;
  const ret = loc_1b79(m);
  assert.equal(m.cycles, 5423, "T total: 256*21 inner + 33 page-tail + 4 and a + 10 jp");
  assert.deepEqual(m.calls, [0x1b34], "bad ROM -> jp 0x1b34");
  assert.equal(ret, "TAIL", "the jp callee result propagates out");
  assert.equal(m.regs.a, 0x05, "and a leaves the (nonzero) checksum in A");
});

test("loc_1b79 PASS path: zero checksum -> fill via rst 0x10, seed latches, jp 0x2000; 5730 T", () => {
  const m = mk({ 0x0010: "pop", 0x2000: "tail" });
  m.regs.a = 0x00; m.regs.b = 0x01; m.regs.hl = 0x0000;
  const ret = loc_1b79(m);
  assert.equal(m.cycles, 5730, "T total incl. 5 rst + latch/RAM writes + jp 0x2000");
  assert.deepEqual(
    m.calls,
    [0x0010, 0x0010, 0x0010, 0x0010, 0x0010, 0x2000],
    "5 block-fills (rst 0x10 -> loc_0010) then jp 0x2000",
  );
  assert.equal(ret, "TAIL", "the jp 0x2000 callee result propagates out");
  // control latches (0x7000 block): irq_enable and stars_enable end set; flip_x/y cleared.
  assert.equal(m.io.irqEnable, 1, "ld (0x7001),a with A=1 -> irq_enable D0=1 (NMI ON)");
  assert.equal(m.io.starsEnable, 1, "ld (0x7004),a with A=1 -> stars_enable D0=1");
  assert.equal(m.io.flipX, 0, "ld (0x7006),a with A=0 -> flip_x D0=0");
  assert.equal(m.io.flipY, 0, "ld (0x7007),a with A=0 -> flip_y D0=0");
  // work-RAM seeds written directly by this routine.
  assert.equal(m.mem.read8(0x4008), 0x20, "ld (0x4008),a = 0x20");
  assert.equal(m.mem.read8(0x401a), 0x03, "ld (0x401a),a = 0x03");
  assert.equal(m.mem.read8(0x40a0), 0xc0, "ld (0x40a0),hl low byte = 0xc0");
  assert.equal(m.mem.read8(0x40a1), 0xc0, "ld (0x40a0),hl high byte = 0xc0");
  // the DK ROM's 0x7002/0x7003/0x7005 writes are unmapped on Galaxian and are dropped + counted.
  assert.equal(m.mem.unmappedWrites, 3, "0x7002/0x7003/0x7005 drop as unmapped 0x7000-block writes");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1b79.js
//   find: m.step(0x1b34, 10); // jp nz,0x1b34 (taken) -- bad ROM, hang path\n    return m.call(0x1b34);
//   repl: m.step(0x1b04, 10); ... return m.call(0x1b04);
//   expect: FAIL  (FAIL-path calls == [0x1b04] != [0x1b34])
test("loc_1b79: the contract catches a wrong bad-ROM target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      for (;;) {
        regs.add(mem.read8(regs.hl)); m.step(0x1b7a, 7);
        regs.l = regs.inc8(regs.l); m.step(0x1b7b, 4);
        if (regs.fNZ) { m.step(0x1b79, 10); continue; }
        m.step(0x1b7e, 10); break;
      }
      regs.h = regs.inc8(regs.h); m.step(0x1b7f, 4);
      regs.c = regs.a; m.step(0x1b80, 4);
      regs.a = mem.read8(0x7800); m.step(0x1b83, 13);
      regs.a = regs.c; m.step(0x1b84, 4);
      if (m.regs.djnz() !== 0) { m.step(0x1b79, 13); continue; }
      m.step(0x1b86, 8); break;
    }
    regs.and(regs.a); m.step(0x1b87, 4);
    m.step(0x1b04, 10); // MUTANT: wrong bad-ROM target
    return m.call(0x1b04);
  };
  const m = mk({ 0x1b04: "tail" });
  m.regs.a = 0x05; m.regs.b = 0x01; m.regs.hl = 0x0000;
  const ret = mutant(m);
  assert.notDeepEqual(m.calls, [0x1b34], "mutant jumps to 0x1b04, so calls != [0x1b34]");
  assert.equal(ret, "TAIL");
});
