// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0473 (ROM 0x0473-0x0491, incl. interior 0x048b): drive the two start-lamp latches
// (0x6000/0x6001) from credit count (0x4002), gated on (0x425f) bit5.
//   (a) bit5 clear -> interior 0x048b: both lamps cleared, ret. 68 T (13+7+12+13+13+10), calls [].
//   (b) bit5 set, count 2 -> both lamps on, ret. 105 T, calls [].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0473 } from "../loc_0473.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : () => {});
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4380; m.push16(0xbeef);
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_0473: (0x425f) bit5 clear -> interior 0x048b clears both lamps + ret; 68 T", () => {
  const m = mk();
  m.io.startLamp = [1, 1];
  m.mem.write8(0x425f, 0x00);
  loc_0473(m);
  assert.equal(m.cycles, 68, "13+7+jr taken 12+13+13+10");
  assert.deepEqual(m.calls, [], "no delegation");
  assert.deepEqual(m.io.startLamp, [0, 0], "both start lamps cleared (A=0 from and 0x20)");
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

test("loc_0473: bit5 set, count 2 -> both lamps on + ret; 105 T", () => {
  const m = mk();
  m.io.startLamp = [0, 0];
  m.mem.write8(0x425f, 0x20);
  m.mem.write8(0x4002, 0x02);
  loc_0473(m);
  assert.equal(m.cycles, 105, "full two-lamp path T-total");
  assert.deepEqual(m.calls, [], "no delegation");
  assert.deepEqual(m.io.startLamp, [1, 1], "count 2 -> both lamps lit");
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0473.js
//   find: mem.write8(0x6001, regs.a, 10); // start_lamp1 latch <- 0   (the interior-0x048b second write)
//   repl: (drop the write, keep the step)
//   expect: FAIL (startLamp1 stays 1; caught by the bit5-clear deepEqual [0,0])
test("loc_0473: the contract catches a dropped interior lamp1 clear", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x425f); m.step(0x0476, 13);
    regs.and(0x20); m.step(0x0478, 7);
    if (regs.fZ) {
      m.step(0x048b, 12);
      mem.write8(0x6000, regs.a, 10); m.step(0x048e, 13);
      m.step(0x0491, 13); // MUTANT: dropped `ld (0x6001),a`
      return m.ret();
    }
    return m.ret();
  };
  const m = mk();
  m.io.startLamp = [1, 1];
  m.mem.write8(0x425f, 0x00);
  mutant(m);
  assert.throws(() => assert.deepEqual(m.io.startLamp, [0, 0]));
});
