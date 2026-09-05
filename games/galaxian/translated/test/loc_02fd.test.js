// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_02fd (ROM 0x02fd-0x0321): resolve via loc_0646, ldir 8 bytes -> 0x4218, clear
// 0x425F, set 0x421D=1, inc (0x400a) + set 0x400b=0x96, set 0x4245=0x0640, ret.
// Contract: 319 T (156 instr + 163 for the 8-byte ldir), calls [0x0646].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_02fd } from "../loc_02fd.js";

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
const PAT = [0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80];
// loc_0646 stub: leave the source pointer in DE (ex de,hl moves it to HL), pop the call's return.
const resolve = (mm) => { mm.regs.de = 0x4180; mm.pop16(); };

function run(fn) {
  const m = mk({ 0x0646: resolve });
  for (let i = 0; i < PAT.length; i++) m.mem.write8(0x4180 + i, PAT[i]); // ldir source
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_02fd: table resolve + ldir + state setup; 319 T", () => {
  const m = run(loc_02fd);
  assert.equal(m.cycles, 319, "156 instr T + 163 for the 8-byte ldir");
  assert.deepEqual(m.calls, [0x0646], "resolve via loc_0646");
  // ldir lands 8 bytes at 0x4218-0x421F; 0x421D (offset 5) is then overwritten by `ld (0x421d),a`=1, so
  // check every byte EXCEPT that overlap.
  for (let i = 0; i < PAT.length; i++) {
    if (i === 5) continue;
    assert.equal(m.mem.read8(0x4218 + i), PAT[i], `ldir byte ${i} -> 0x4218`);
  }
  assert.equal(m.mem.read8(0x425f), 0, "0x425F cleared");
  assert.equal(m.mem.read8(0x421d), 1, "0x421D <- 1 (overwrites the ldir byte at offset 5)");
  assert.equal(m.mem.read8(0x400a), 1, "inc (0x400a) state counter");
  assert.equal(m.mem.read8(0x400b), 0x96, "0x400b timer <- 0x96");
  assert.equal(m.mem.read16(0x4245), 0x0640, "0x4245 pointer <- 0x0640");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_02fd.js
//   find: mem.write8(regs.hl, 0x96);
//   repl: mem.write8(regs.hl, 0x95);
//   expect: FAIL (0x400b becomes 0x95; caught by the 0x400b assert)
test("loc_02fd: contract catches a wrong 0x400b timer value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.de = 0x051b; m.step(0x0300, 10);
    m.push16(0x0303); m.step(0x0646, 17); m.call(0x0646);
    regs.exDeHl(); m.step(0x0304, 4);
    regs.de = 0x4218; m.step(0x0307, 10);
    regs.bc = 0x0008; m.step(0x030a, 10);
    m.ldirAt(0x030a, 0x030c);
    regs.xor(regs.a); m.step(0x030d, 4);
    mem.write8(0x425f, regs.a); m.step(0x0310, 13);
    regs.a = regs.inc8(regs.a); m.step(0x0311, 4);
    mem.write8(0x421d, regs.a); m.step(0x0314, 13);
    regs.hl = 0x400a; m.step(0x0317, 10);
    regs.incMem8(mem, regs.hl); m.step(0x0318, 11);
    regs.l = regs.inc8(regs.l); m.step(0x0319, 4);
    mem.write8(regs.hl, 0x95); m.step(0x031b, 10); // MUTANT: wrong timer
    regs.hl = 0x0640; m.step(0x031e, 10);
    mem.write16(0x4245, regs.hl); m.step(0x0321, 16);
    m.ret();
  };
  assert.throws(() => assert.equal(run(mutant).mem.read8(0x400b), 0x96));
});
