// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1637 (ROM 0x1637-0x1685): 0x4222-gated tick with countdown at 0x4223. On expiry it
// clears state, advances the clamped 0x421b selector, calls 0x0646 + 0x08f2, and services 0x421e into
// 0x4177/0x4178. Path: enabled, counter hits 0, selector 2->3, request count 2.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1637 } from "../loc_1637.js";

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
const pop = (mm) => { mm.pop16(); };

function setup(m) {
  m.mem.write8(0x4222, 0x01); // enabled (D0)
  m.mem.write8(0x4223, 0x01); // countdown -> 0 this tick
  m.mem.write8(0x421b, 0x02); m.mem.write8(0x421c, 0x00); // selector 2
  m.mem.write8(0x421e, 0x02); // request count
  m.push16(0x9999);
}

function run() {
  const m = mk({ 0x0646: pop, 0x08f2: pop });
  setup(m);
  loc_1637(m);
  return m;
}

// T = S1 49 + S2 115 + S3 33 + S4 64 + S5 90
const T = 49 + 115 + 33 + 64 + 90;

test("loc_1637: expiry advances selector, services request; 351 T", () => {
  const m = run();
  assert.equal(m.cycles, T, "sum of all instr T-states");
  assert.deepEqual(m.calls, [0x0646, 0x08f2], "call 0x0646 then 0x08f2");
  assert.equal(m.mem.read8(0x4222), 0x00, "0x4222 cleared on the zero tick");
  assert.equal(m.mem.read16(0x420e), 0x0001, "0x420e <- 1");
  assert.equal(m.mem.read16(0x421b), 0x0103, "selector advanced (inc h, l 2->3)");
  assert.equal(m.mem.read8(0x4177), 0x01, "0x4177 <- 1");
  assert.equal(m.mem.read8(0x4178), 0x01, "0x4178 <- 1 (count reached 0)");
  assert.equal(m.mem.read8(0x421e), 0x00, "0x421e drained to 0");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1637.js
//   find: mem.write8(regs.hl, 0x01); m.step(0x1676, 10); // 0x4177 <- 1
//   repl: mem.write8(regs.hl, 0x00); ...
//   expect: FAIL (0x4177 gets 0 instead of 1)
test("loc_1637: contract catches a wrong 0x4177 store", () => {
  const m = mk({ 0x0646: pop, 0x08f2: pop });
  setup(m);
  const ow = m.mem.write8.bind(m.mem);
  m.mem.write8 = (a, v, bo) => ow(a, a === 0x4177 ? 0x00 : v, bo);
  loc_1637(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4177), 0x01));
});
