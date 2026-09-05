// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0764 (ROM 0x0764-0x077a): pack bit0 of 128 flags (0x4100..0x417f) LSB-first into a
// 16-byte bitmap at (de). Contract: all-zero input -> 6829 T, 16 zero bytes, ret; pattern input packs bits.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0764 } from "../loc_0764.js";

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

test("loc_0764: all-zero flags -> 16 zero bytes; 6829 T; ret", () => {
  const m = mk();
  m.push16(0x9999);
  m.regs.de = 0x4180;
  loc_0764(m);
  assert.equal(m.cycles, 6829, "16*(xor + 8*inner) + setup + ret, all bits clear");
  const out = []; for (let i = 0; i < 16; i++) out.push(m.mem.read8(0x4180 + i));
  assert.deepEqual(out, new Array(16).fill(0), "no flags set -> empty bitmap");
  assert.equal(m.regs.de, 0x4190, "DE advanced past 16 output bytes");
  assert.equal(m.regs.b, 0, "outer count exhausted");
  assert.deepEqual(m.calls, [], "no sub-calls");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0764: LSB-first packing within and across output bytes", () => {
  const m = mk();
  m.push16(0x9999);
  m.regs.de = 0x4180;
  m.mem.write8(0x4100, 0x01); // out[0] bit0
  m.mem.write8(0x4102, 0x01); // out[0] bit2
  m.mem.write8(0x4108, 0x01); // out[1] bit0
  m.mem.write8(0x417f, 0x01); // out[15] bit7 (last flag)
  loc_0764(m);
  assert.equal(m.mem.read8(0x4180), 0x05, "flags 0 and 2 -> 0b00000101");
  assert.equal(m.mem.read8(0x4181), 0x01, "flag 8 -> bit0 of second byte");
  assert.equal(m.mem.read8(0x418f), 0x80, "flag 127 -> bit7 of last byte");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0764.js
//   find: regs.or(regs.c);
//   repl: (drop it -- set flags but never OR the mask into A)
//   expect: FAIL (every output byte stays 0x00 regardless of flags; caught by the packing assert)
test("loc_0764: contract catches a dropped `or c` (bits never set)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4100; m.step(0x0767, 10);
    regs.b = 0x10; m.step(0x0769, 7);
    regs.c = 0x01; m.step(0x076b, 7);
    for (;;) {
      regs.xor(regs.a); m.step(0x076c, 4);
      for (;;) {
        regs.bit(0, mem.read8(regs.hl)); m.step(0x076e, 12);
        if (regs.fNZ) { m.step(0x0770, 7); /* MUTANT: dropped or c */ m.step(0x0771, 4); }
        else { m.step(0x0771, 12); }
        regs.hl = (regs.hl + 1) & 0xffff; m.step(0x0772, 6);
        regs.c = regs.rlc(regs.c); m.step(0x0774, 8);
        if (regs.fNC) { m.step(0x076c, 12); continue; }
        m.step(0x0776, 7); break;
      }
      mem.write8(regs.de, regs.a); m.step(0x0777, 7);
      regs.de = (regs.de + 1) & 0xffff; m.step(0x0778, 6);
      if (regs.djnz() !== 0) { m.step(0x076b, 13); continue; }
      m.step(0x077a, 8); break;
    }
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  m.regs.de = 0x4180;
  m.mem.write8(0x4100, 0x01);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4180), 0x01));
});
