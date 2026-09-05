// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1688 (ROM 0x1688-0x16a5): 0x422b-gated countdown at 0x422c that clears 0x422b on
// expiry. Path: enabled, no early-fire flags, 0x4226 D0 set (so `ret nc` falls through), counter 1->0.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1688 } from "../loc_1688.js";

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

function setup(m) {
  m.mem.write8(0x422b, 0x01); // enabled
  m.mem.write8(0x4224, 0x00);
  m.mem.write8(0x4221, 0x00);
  m.mem.write8(0x4226, 0x01); // D0 set -> ret nc falls through
  m.mem.write8(0x422c, 0x01); // counter -> 0
  m.push16(0x9999);
}

const T = 145;

test("loc_1688: counter expiry clears 0x422b; 145 T", () => {
  const m = mk();
  setup(m);
  loc_1688(m);
  assert.equal(m.cycles, T, "sum of all instr T-states");
  assert.deepEqual(m.calls, [], "no subroutine calls");
  assert.equal(m.mem.read8(0x422c), 0x00, "0x422c ticked to 0");
  assert.equal(m.mem.read8(0x422b), 0x00, "0x422b cleared on expiry");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1688.js
//   find: mem.write8(regs.hl, 0x00); m.step(0x16a5, 10); // 0x422b <- 0
//   repl: mem.write8(regs.hl, 0x01); ...
//   expect: FAIL (0x422b stays enabled)
test("loc_1688: contract catches a missed 0x422b clear", () => {
  const m = mk();
  setup(m);
  const ow = m.mem.write8.bind(m.mem);
  m.mem.write8 = (a, v, bo) => ow(a, a === 0x422b ? 0x01 : v, bo);
  loc_1688(m);
  assert.throws(() => assert.equal(m.mem.read8(0x422b), 0x00));
});
