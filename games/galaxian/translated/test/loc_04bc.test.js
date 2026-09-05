// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_04bc (ROM 0x04bc-0x04f1): start/spawn setup -- store HL@0x400d, ldir 0x051b->0x4180,
// optional call c,0x0515, seed 0x400a/0x4005/0x4006/0x41d1, queue three loc_08f2 requests (last via tail-jp).
//   (a) (0x401f) bit0 clear (call c not taken), HL=0x0100. 878 T, calls [0x08f2,0x08f2,0x08f2], state seeded.
//   (b) (0x401f) bit0 set -> call c,0x0515 taken (+7 T). 885 T, calls [0x0515,0x08f2,0x08f2,0x08f2].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_04bc } from "../loc_04bc.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a] of Object.entries(stubs)) routines.set(Number(a), () => {});
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_04bc: bit0 clear (no call c), seeds state + queues three loc_08f2; 878 T", () => {
  const m = mk({ 0x08f2: "noop" });
  m.regs.hl = 0x0100;
  m.mem.write8(0x401f, 0x00);
  loc_04bc(m);
  assert.equal(m.cycles, 878, "full T-total incl. 0x20-byte ldir");
  assert.deepEqual(m.calls, [0x08f2, 0x08f2, 0x08f2], "three loc_08f2 requests");
  assert.equal(m.mem.read8(0x400d), 0x00, "HL low stored at 0x400d");
  assert.equal(m.mem.read8(0x400e), 0x01, "HL high stored at 0x400e");
  assert.equal(m.mem.read8(0x400a), 0x00, "state index = 0");
  assert.equal(m.mem.read8(0x4005), 0x03, "0x4005 = 3");
  assert.equal(m.mem.read8(0x4006), 0x01, "0x4006 = 1");
  assert.equal(m.mem.read8(0x41d1), 0x01, "0x41d1 = 1");
});

test("loc_04bc: (0x401f) bit0 set -> call c,0x0515 taken; 885 T", () => {
  const m = mk({ 0x08f2: "noop", 0x0515: "noop" });
  m.regs.hl = 0x0100;
  m.mem.write8(0x401f, 0x01); // bit0 set -> rrca carry set -> call taken
  loc_04bc(m);
  assert.equal(m.cycles, 885, "878 + call c taken 17 vs not-taken 10 = +7");
  assert.deepEqual(m.calls, [0x0515, 0x08f2, 0x08f2, 0x08f2], "call c,0x0515 taken before the queue");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_04bc.js
//   find: regs.a = 0x03;   (before ld (0x4005),a)
//   repl: (drop it -- A stays 0 from `xor a`)
//   expect: FAIL (0x4005 gets 0 instead of 3; caught by the 0x4005 assert)
test("loc_04bc: the contract catches a dropped `ld a,0x03`", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    mem.write16(0x400d, regs.hl); m.step(0x04bf, 16);
    regs.hl = 0x051b; m.step(0x04c2, 10);
    regs.de = 0x4180; m.step(0x04c5, 10);
    regs.bc = 0x0020; m.step(0x04c8, 10);
    m.ldirAt(0x04c8, 0x04ca);
    regs.a = mem.read8(0x401f); m.step(0x04cd, 13);
    regs.rrca(); m.step(0x04ce, 4);
    m.step(0x04d1, 10); // call c not taken (bit0 clear)
    regs.xor(regs.a); m.step(0x04d2, 4);
    mem.write8(0x400a, regs.a); m.step(0x04d5, 13);
    m.step(0x04d7, 7); // MUTANT: dropped `ld a,0x03`, A stays 0
    mem.write8(0x4005, regs.a); m.step(0x04da, 13);
    return; // stop before the queue (0x4005 already wrong)
  };
  const m = mk({ 0x08f2: "noop" });
  m.regs.hl = 0x0100;
  m.mem.write8(0x401f, 0x00);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4005), 0x03));
});
