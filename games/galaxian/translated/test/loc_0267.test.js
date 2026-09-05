// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0267 (ROM 0x0267-0x028d): four per-frame updates, countdown (0x4009); on expiry
// advance (0x400a), clear (0x4058), set (0x4008)=0x1140, bump (0x4241), tail-jp 0x08f2 with DE=0x060f.
// Contract (expiry path): 193 T, calls [0x0363,0x0bbe,0x0cc3,0x0367,0x08f2], (0x4008)=0x1140, DE=0x060f.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0267 } from "../loc_0267.js";

// call-target stub: pop the return address CALL pushed, keeping SP balanced.
const popret = (mm) => { mm.pop16(); };
// jp-target stub: nothing was pushed for a tail-jump.
const noop = () => {};

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
  const m = mk({ 0x0363: popret, 0x0bbe: popret, 0x0cc3: popret, 0x0367: popret, 0x08f2: noop });
  m.mem.write8(0x4009, 0x01); // countdown = 1 => dec -> 0 -> full expiry path
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_0267: expiry path re-inits + tail-jumps 0x08f2; 193 T", () => {
  const m = run(loc_0267);
  assert.equal(m.cycles, 193, "sum of all instr T-states (expiry path)");
  assert.deepEqual(m.calls, [0x0363, 0x0bbe, 0x0cc3, 0x0367, 0x08f2], "four updates then tail-jp 0x08f2");
  assert.equal(m.mem.read16(0x4008), 0x1140, "ld (0x4008),hl <- 0x1140");
  assert.equal(m.mem.read8(0x4058), 0x00, "(0x4058) cleared");
  assert.equal(m.regs.de, 0x060f, "DE=0x060f into the tail-jump");
});

test("loc_0267: nonzero countdown returns early (no tail-jump)", () => {
  const m = mk({ 0x0363: popret, 0x0bbe: popret, 0x0cc3: popret, 0x0367: popret, 0x08f2: noop });
  m.mem.write8(0x4009, 0x05);
  m.push16(0x9999);
  loc_0267(m);
  assert.deepEqual(m.calls, [0x0363, 0x0bbe, 0x0cc3, 0x0367], "no 0x08f2: ret nz taken");
  assert.equal(m.mem.read8(0x4009), 0x04, "countdown decremented, still nonzero");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0267.js
//   find: regs.hl = 0x1140;   repl: regs.hl = 0x1141;
//   expect: FAIL ((0x4008) becomes 0x1141 -- caught by the read16(0x4008) assert)
test("loc_0267: the contract catches a wrong (0x4008) pointer value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    m.push16(0x026a); m.step(0x0363, 17); m.call(0x0363);
    m.push16(0x026d); m.step(0x0bbe, 17); m.call(0x0bbe);
    m.push16(0x0270); m.step(0x0cc3, 17); m.call(0x0cc3);
    m.push16(0x0273); m.step(0x0367, 17); m.call(0x0367);
    regs.hl = 0x4009; m.step(0x0276, 10);
    regs.decMem8(mem, regs.hl); m.step(0x0277, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x0278, 5);
    regs.l = regs.inc8(regs.l); m.step(0x0279, 4);
    regs.incMem8(mem, regs.hl); m.step(0x027a, 11);
    regs.xor(regs.a); m.step(0x027b, 4);
    mem.write8(0x4058, regs.a); m.step(0x027e, 13);
    regs.hl = 0x1141; m.step(0x0281, 10); // MUTANT: 0x1141 instead of 0x1140
    mem.write16(0x4008, regs.hl); m.step(0x0284, 16);
    regs.hl = 0x4241; m.step(0x0287, 10);
    regs.incMem8(mem, regs.hl); m.step(0x0288, 11);
    regs.de = 0x060f; m.step(0x028b, 10);
    m.step(0x08f2, 10); return m.call(0x08f2);
  };
  const m = run(mutant);
  assert.throws(() => assert.equal(m.mem.read16(0x4008), 0x1140));
});
