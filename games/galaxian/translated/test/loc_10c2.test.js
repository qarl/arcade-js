// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_10c2 (ROM 0x10c2-0x10d7): per-object step — inc (ix+0x04), dec timer (ix+0x10);
// while nonzero just ret. On expiry call loc_08f2 with DE=0x06:(ix+0x07)+0x4b, advance state (ix+0x02).
// Contracts: expiry -> 138 T, calls [0x08f2]; not-expired -> 57 T, no call.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_10c2 } from "../loc_10c2.js";

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
const pop = (mm) => { mm.pop16(); }; // loc_08f2 return: pop the pushed 0x10d4
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };
const rd = (m, a) => m.mem.workRam[a & 0x3ff];

test("loc_10c2: timer expires -> call loc_08f2 (DE=0x065b), advance state; 138 T", () => {
  const m = mk({ 0x08f2: pop });
  m.push16(0x9999);
  m.regs.ix = 0x4040;
  wr(m, 0x4044, 0x00); // (ix+0x04)
  wr(m, 0x4050, 0x01); // timer (ix+0x10) -> 0 on dec
  wr(m, 0x4047, 0x10); // (ix+0x07)
  wr(m, 0x4042, 0x02); // state (ix+0x02)
  loc_10c2(m);

  assert.equal(m.cycles, 138, "23+23+5+19+7+4+7+17+23+10");
  assert.deepEqual(m.calls, [0x08f2], "one subsystem call on expiry");
  assert.equal(m.regs.e, 0x5b, "E = (ix+0x07)+0x4b = 0x10+0x4b");
  assert.equal(m.regs.d, 0x06, "D = 0x06");
  assert.equal(rd(m, 0x4044), 0x01, "inc (ix+0x04)");
  assert.equal(rd(m, 0x4042), 0x03, "state (ix+0x02) advanced 2->3");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_10c2: timer not yet 0 -> ret nz, no call, state unchanged; 57 T", () => {
  const m = mk({ 0x08f2: pop });
  m.push16(0x9999);
  m.regs.ix = 0x4040;
  wr(m, 0x4044, 0x00);
  wr(m, 0x4050, 0x05); // dec -> 4, nonzero
  wr(m, 0x4042, 0x02);
  loc_10c2(m);

  assert.equal(m.cycles, 57, "23 + 23 + ret nz taken 11");
  assert.deepEqual(m.calls, [], "no call before the timer expires");
  assert.equal(rd(m, 0x4044), 0x01, "inc (ix+0x04) still happens");
  assert.equal(rd(m, 0x4050), 0x04, "timer decremented, not reloaded");
  assert.equal(rd(m, 0x4042), 0x02, "state unchanged");
  assert.equal(m.pc, 0x9999);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_10c2.js
//   find: regs.incMem8(mem, regs.ix + 0x02);  (the post-call state advance)
//   repl: (drop it) -- state never advances on expiry
//   expect: FAIL (0x4042 stays 0x02 instead of 0x03)
test("loc_10c2: contract catches a dropped state advance", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.incMem8(mem, regs.ix + 0x04); m.step(0x10c5, 23);
    regs.decMem8(mem, regs.ix + 0x10); m.step(0x10c8, 23);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x10c9, 5);
    regs.a = mem.read8(regs.ix + 0x07); m.step(0x10cc, 19);
    regs.add(0x4b); m.step(0x10ce, 7);
    regs.e = regs.a; m.step(0x10cf, 4);
    regs.d = 0x06; m.step(0x10d1, 7);
    m.push16(0x10d4); m.step(0x08f2, 17); m.call(0x08f2);
    m.step(0x10d7, 23); // MUTANT: dropped inc (ix+0x02)
    m.ret();
  };
  const m = mk({ 0x08f2: pop });
  m.push16(0x9999);
  m.regs.ix = 0x4040;
  wr(m, 0x4050, 0x01); wr(m, 0x4047, 0x10); wr(m, 0x4042, 0x02);
  mutant(m);
  assert.throws(() => assert.equal(rd(m, 0x4042), 0x03));
});
