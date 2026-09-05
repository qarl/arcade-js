// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_145c (ROM 0x145c-0x1471): activate the object struct at IX, clear trigger (hl),
// store C/L, set DE=0x01:L, tail-jump loc_08f2. Contract: 107 T, calls [0x08f2], (ix+0)=1, (ix+6)=C,
// (ix+7)=L, (hl) cleared, D=1, E=L.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_145c } from "../loc_145c.js";

function mk(stubAddrs = []) {
  const routines = new Map();
  for (const a of stubAddrs) routines.set(Number(a), () => "STUB");
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run() {
  const m = mk([0x08f2]);
  m.regs.ix = 0x42d0;
  m.regs.hl = 0x4176; // l = 0x76
  m.regs.c = 0x55;
  m.mem.write8(0x4176, 0xff); // trigger flag, must be cleared
  m.mem.write8(0x42d2, 0xff); // phase, must be cleared
  loc_145c(m);
  return m;
}

test("loc_145c: activates the struct + enqueues the spawn word; 107 T", () => {
  const m = run();
  assert.equal(m.cycles, 107, "10+19+19+19+19+7+4+10");
  assert.deepEqual(m.calls, [0x08f2], "tail-jump into the queue-enqueue routine");
  assert.equal(m.mem.read8(0x4176), 0x00, "(hl) trigger flag cleared");
  assert.equal(m.mem.read8(0x42d0), 0x01, "(ix+0) activated");
  assert.equal(m.mem.read8(0x42d2), 0x00, "(ix+2) phase cleared");
  assert.equal(m.mem.read8(0x42d6), 0x55, "(ix+6) <- C");
  assert.equal(m.mem.read8(0x42d7), 0x76, "(ix+7) <- L");
  assert.equal(m.regs.d, 0x01, "D=1");
  assert.equal(m.regs.e, 0x76, "E=L");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_145c.js
//   find: mem.write8(regs.ix + 0x00, 0x01);
//   repl: mem.write8(regs.ix + 0x00, 0x00);  (struct never activated)
//   expect: FAIL  ((ix+0) stays 0, caught by the activation assert)
test("loc_145c: the contract catches a struct that is never activated", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    mem.write8(regs.hl, 0x00); m.step(0x145e, 10);
    mem.write8(regs.ix + 0x00, 0x00); m.step(0x1462, 19); // MUTANT: not activated
    mem.write8(regs.ix + 0x02, 0x00); m.step(0x1466, 19);
    mem.write8(regs.ix + 0x06, regs.c); m.step(0x1469, 19);
    mem.write8(regs.ix + 0x07, regs.l); m.step(0x146c, 19);
    regs.d = 0x01; m.step(0x146e, 7);
    regs.e = regs.l; m.step(0x146f, 4);
    m.step(0x08f2, 10); return m.call(0x08f2);
  };
  const m = mk([0x08f2]);
  m.regs.ix = 0x42d0; m.regs.hl = 0x4176; m.regs.c = 0x55;
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x42d0), 0x01));
});
