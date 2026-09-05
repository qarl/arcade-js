// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_03af (ROM 0x03af-0x03bf): copy 3 bytes (HL) -> (DE) up a VRAM column, DE -=0x20/byte,
// then E += 0x62 for the next column; ret. Contract: 175 T, no m.calls, DE ends 0x5195, HL += 3.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_03af } from "../loc_03af.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function seed(m) {
  m.mem.workRam[0x100] = 0xaa; // source bytes at HL=0x4100
  m.mem.workRam[0x101] = 0xbb;
  m.mem.workRam[0x102] = 0xcc;
  m.regs.hl = 0x4100;
  m.regs.de = 0x5193; // VRAM column start
}

test("loc_03af: 3-byte column copy up VRAM, E advanced +0x62; 175 T", () => {
  const m = mk();
  seed(m);
  m.push16(0x9999);
  loc_03af(m);
  assert.equal(m.cycles, 175, "T-state total");
  assert.deepEqual(m.calls, [], "no calls");
  assert.equal(m.mem.read8(0x5193), 0xaa, "byte 0 -> 0x5193");
  assert.equal(m.mem.read8(0x5173), 0xbb, "byte 1 -> 0x5173 (up one row)");
  assert.equal(m.mem.read8(0x5153), 0xcc, "byte 2 -> 0x5153");
  assert.equal(m.regs.de, 0x5195, "DE: E = 0x33 + 0x62 = 0x95, D unchanged");
  assert.equal(m.regs.hl, 0x4103, "HL advanced past the 3 source bytes");
  assert.equal(m.regs.c, 0x00, "C counted down to 0");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH: drop the post-loop `add a,0x62` (E would stay 0x33 -> DE=0x5133), caught by the DE assert.
test("loc_03af: contract catches a dropped column advance", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.c = 0x03; m.step(0x03b1, 7);
    for (;;) {
      regs.a = mem.read8(regs.hl); m.step(0x03b2, 7);
      mem.write8(regs.de, regs.a); m.step(0x03b3, 7);
      regs.hl = (regs.hl + 1) & 0xffff; m.step(0x03b4, 6);
      regs.a = regs.e; m.step(0x03b5, 4);
      regs.sub(0x20); m.step(0x03b7, 7);
      regs.e = regs.a; m.step(0x03b8, 4);
      regs.c = regs.dec8(regs.c); m.step(0x03b9, 4);
      if (regs.fNZ) { m.step(0x03b1, 10); continue; }
      m.step(0x03bc, 10); break;
    }
    m.step(0x03be, 7); // MUTANT: dropped `add a,0x62`
    regs.e = regs.a; m.step(0x03bf, 4);
    m.ret();
  };
  const m = mk();
  seed(m);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.regs.de, 0x5195));
});
