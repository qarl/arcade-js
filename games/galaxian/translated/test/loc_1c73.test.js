// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1c73 (Galaxian/DK input-field decode + state init, ROM 0x1C73-0x1CB4).
// Three IN-field decodes each call 0x1ccf; then unless IN0 bit 6 is set (early `ret nz`) it initialises
// work-RAM state and clears four latch/sound regs via rst 0x10 (loc_0010 memset), falling into loc_1cb5.
// Contract:
//   * fall-through (IN0 bit6 clear): 287 T; calls [0x1ccf,0x1ccf,0x1ccf,0x0010,0x1cb5];
//       (0x4006)=0, (0x401a)=2, (0x4008)=0x3010, (0x400b)=0x5000; delegates to loc_1cb5.
//   * early ret (IN0 bit6 set): 172 T; calls [0x1ccf,0x1ccf,0x1ccf]; no state init; pc = caller return.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1c73 } from "../loc_1c73.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

const CALL_STUBS = { 0x1ccf: "call", 0x0010: "call", 0x1cb5: "tail" };

test("loc_1c73: full path decodes 3 fields, inits state, memsets via rst 0x10, falls into loc_1cb5; 287 T", () => {
  const m = mk(CALL_STUBS);
  m.io.in0 = 0x00; // bit 6 clear -> no early ret
  m.io.in1 = 0xc0; // exercises the rlca/rlca/and 3 field
  m.io.in2 = 0x00;
  const ret = loc_1c73(m);

  assert.equal(m.cycles, 287, "T-state total of the fall-through path");
  assert.deepEqual(m.calls, [0x1ccf, 0x1ccf, 0x1ccf, 0x0010, 0x1cb5],
    "three field decodes, the rst-0x10 memset (loc_0010), then fall-through to loc_1cb5");
  assert.equal(ret, "TAIL", "the fall-through callee result propagates");
  assert.equal(m.mem.read8(0x4006), 0x00, "xor a -> (0x4006)=0");
  assert.equal(m.mem.read8(0x401a), 0x02, "(0x401a)=2");
  assert.equal(m.mem.read16(0x4008), 0x3010, "ld (0x4008),hl = 0x3010");
  assert.equal(m.mem.read16(0x400b), 0x5000, "ld (0x400b),hl = 0x5000");
});

test("loc_1c73: IN0 bit 6 set -> early ret nz, no state init; 172 T", () => {
  const m = mk(CALL_STUBS);
  m.io.in0 = 0x40; // bit 6 set -> ret nz taken
  m.regs.sp = 0x4380;
  m.push16(0x1234); // caller's return address (does not tick)
  m.mem.write8(0x4006, 0xaa); // sentinel: must be left untouched on the early-out
  const ret = loc_1c73(m);

  assert.equal(m.cycles, 172, "T-state total of the ret-nz path");
  assert.deepEqual(m.calls, [0x1ccf, 0x1ccf, 0x1ccf], "only the three field decodes ran");
  assert.equal(m.pc, 0x1234, "ret nz popped the caller's return address");
  assert.equal(ret, undefined, "the early ret returns nothing (m.ret, not a delegated call)");
  assert.equal(m.mem.read8(0x4006), 0xaa, "state init was skipped -- (0x4006) untouched");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1c73.js
//   find: regs.hl = 0x3010;
//   repl: regs.hl = 0x3011;
//   expect: FAIL  (writes 0x3011 -- caught by (0x4008) == 0x3010)
test("loc_1c73: the contract catches a wrong state constant", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x6800); m.step(0x1c76, 13);
    regs.rlca(); m.step(0x1c77, 4);
    regs.rlca(); m.step(0x1c78, 4);
    regs.and(0x03); m.step(0x1c7a, 7);
    m.push16(0x1c7d); m.step(0x1ccf, 17); m.call(0x1ccf);
    regs.a = mem.read8(0x7000); m.step(0x1c80, 13);
    regs.and(0x03); m.step(0x1c82, 7);
    regs.add(0x04); m.step(0x1c84, 7);
    m.push16(0x1c87); m.step(0x1ccf, 17); m.call(0x1ccf);
    regs.a = mem.read8(0x7000); m.step(0x1c8a, 13);
    regs.rrca(); m.step(0x1c8b, 4);
    regs.rrca(); m.step(0x1c8c, 4);
    regs.and(0x01); m.step(0x1c8e, 7);
    regs.add(0x08); m.step(0x1c90, 7);
    m.push16(0x1c93); m.step(0x1ccf, 17); m.call(0x1ccf);
    regs.a = mem.read8(0x6000); m.step(0x1c96, 13);
    regs.and(0x40); m.step(0x1c98, 7);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x1c99, 5);
    regs.xor(regs.a); m.step(0x1c9a, 4);
    mem.write8(0x4006, regs.a); m.step(0x1c9d, 13);
    regs.a = 0x02; m.step(0x1c9f, 7);
    mem.write8(0x401a, regs.a); m.step(0x1ca2, 13);
    regs.hl = 0x3011; m.step(0x1ca5, 10); // MUTANT: wrong state constant
    mem.write16(0x4008, regs.hl); m.step(0x1ca8, 16);
    regs.hl = 0x5000; m.step(0x1cab, 10);
    mem.write16(0x400b, regs.hl); m.step(0x1cae, 16);
    regs.xor(regs.a); m.step(0x1caf, 4);
    regs.hl = 0x6000; m.step(0x1cb2, 10);
    regs.b = 0x04; m.step(0x1cb4, 7);
    m.push16(0x1cb5); m.step(0x0010, 11); m.call(0x0010);
    return m.call(0x1cb5);
  };
  const m = mk(CALL_STUBS);
  m.io.in0 = 0x00;
  mutant(m);
  assert.notEqual(m.mem.read16(0x4008), 0x3010, "mutant wrote the wrong constant -- contract would fail");
});
