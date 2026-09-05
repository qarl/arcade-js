// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_029d (ROM 0x029d-0x02d0): update 0x0363, rst-0x10 fill of 0x1c bytes at pointer
// (0x400b) with 0x10 (pointer += 0x20), countdown (0x4009); on expiry advance (0x400a), clear 0x42b0 and
// 0x4060 blocks, set (0x4008)=0x0440, call 0x0595, tail-jp 0x08f2 with DE=0x0600.
// Contract (expiry path): 256 T, calls [0x0363,0x0010,0x0010,0x0010,0x0595,0x08f2], (0x4008)=0x0440, DE=0x0600.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_029d } from "../loc_029d.js";

const popret = (mm) => { mm.pop16(); };   // call- and rst-target stub
const noop = () => {};                     // jp-target stub

function mk(stubs) {
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

function run(fn) {
  const m = mk({ 0x0363: popret, 0x0010: popret, 0x0595: popret, 0x08f2: noop });
  m.mem.write16(0x400b, 0x5000); // fill pointer
  m.mem.write8(0x4009, 0x01);    // countdown = 1 => full expiry path
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_029d: expiry path re-inits + tail-jumps 0x08f2; 256 T", () => {
  const m = run(loc_029d);
  assert.equal(m.cycles, 256, "sum of all instr T-states (expiry path)");
  assert.deepEqual(m.calls, [0x0363, 0x0010, 0x0010, 0x0010, 0x0595, 0x08f2], "update, 3 rst-0x10, 0x0595, tail 0x08f2");
  assert.equal(m.mem.read16(0x4008), 0x0440, "ld (0x4008),hl <- 0x0440");
  assert.equal(m.regs.de, 0x0600, "DE=0x0600 into the tail-jump");
});

test("loc_029d: nonzero countdown returns early after the fill", () => {
  const m = mk({ 0x0363: popret, 0x0010: popret, 0x0595: popret, 0x08f2: noop });
  m.mem.write16(0x400b, 0x5000);
  m.mem.write8(0x4009, 0x03);
  m.push16(0x9999);
  loc_029d(m);
  assert.deepEqual(m.calls, [0x0363, 0x0010], "only the update + first rst; ret nz taken");
  assert.equal(m.mem.read8(0x4009), 0x02, "countdown decremented, still nonzero");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_029d.js
//   find: regs.hl = 0x0440;   repl: regs.hl = 0x0441;
//   expect: FAIL ((0x4008) becomes 0x0441 -- caught by the read16(0x4008) assert; value is stub-independent)
test("loc_029d: the contract catches a wrong (0x4008) pointer value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    m.push16(0x02a0); m.step(0x0363, 17); m.call(0x0363);
    regs.hl = mem.read16(0x400b); m.step(0x02a3, 16);
    regs.b = 0x1c; m.step(0x02a5, 7);
    regs.a = 0x10; m.step(0x02a7, 7);
    m.push16(0x02a8); m.step(0x0010, 11); m.call(0x0010);
    regs.de = 0x0004; m.step(0x02ab, 10);
    regs.addHl(regs.de); m.step(0x02ac, 11);
    mem.write16(0x400b, regs.hl); m.step(0x02af, 16);
    regs.hl = 0x4009; m.step(0x02b2, 10);
    regs.decMem8(mem, regs.hl); m.step(0x02b3, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x02b4, 5);
    regs.l = regs.inc8(regs.l); m.step(0x02b5, 4);
    regs.incMem8(mem, regs.hl); m.step(0x02b6, 11);
    regs.hl = 0x42b0; m.step(0x02b9, 10);
    regs.xor(regs.a); m.step(0x02ba, 4);
    regs.b = regs.a; m.step(0x02bb, 4);
    m.push16(0x02bc); m.step(0x0010, 11); m.call(0x0010);
    regs.hl = 0x4060; m.step(0x02bf, 10);
    regs.b = 0x40; m.step(0x02c1, 7);
    m.push16(0x02c2); m.step(0x0010, 11); m.call(0x0010);
    regs.hl = 0x0441; m.step(0x02c5, 10); // MUTANT: 0x0441 instead of 0x0440
    mem.write16(0x4008, regs.hl); m.step(0x02c8, 16);
    m.push16(0x02cb); m.step(0x0595, 17); m.call(0x0595);
    regs.de = 0x0600; m.step(0x02ce, 10);
    m.step(0x08f2, 10); return m.call(0x08f2);
  };
  const m = run(mutant);
  assert.throws(() => assert.equal(m.mem.read16(0x4008), 0x0440));
});
