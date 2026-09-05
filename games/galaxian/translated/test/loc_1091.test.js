// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1091 (ROM 0x1091-0x109a): per-object step — inc (ix+0x03), set state
// (ix+0x02)=8, tail-jump to loc_0f7b. Contract: 52 T, calls [0x0f7b].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1091 } from "../loc_1091.js";

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
const noop = () => {};
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };
const rd = (m, a) => m.mem.workRam[a & 0x3ff];

test("loc_1091: bump (ix+3), state=8, tail-jump loc_0f7b; 52 T", () => {
  const m = mk({ 0x0f7b: noop });
  m.push16(0x9999);
  m.regs.ix = 0x4040;
  wr(m, 0x4043, 0x05); // (ix+0x03)
  wr(m, 0x4042, 0x02); // (ix+0x02)
  loc_1091(m);

  assert.equal(m.cycles, 52, "23 + 19 + 10");
  assert.deepEqual(m.calls, [0x0f7b], "tail-jump delegates to loc_0f7b");
  assert.equal(rd(m, 0x4043), 0x06, "inc (ix+0x03)");
  assert.equal(rd(m, 0x4042), 0x08, "state (ix+0x02) <- 8");
  assert.equal(m.pc, 0x0f7b, "jp target");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1091.js
//   find: regs.incMem8(mem, regs.ix + 0x03);
//   repl: (drop it) -- (ix+0x03) never bumped
//   expect: FAIL (0x4043 stays 0x05)
test("loc_1091: contract catches a dropped inc (ix+0x03)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    m.step(0x1094, 23); // MUTANT: dropped inc (ix+0x03)
    mem.write8(regs.ix + 0x02, 0x08); m.step(0x1098, 19);
    m.step(0x0f7b, 10); return m.call(0x0f7b);
  };
  const m = mk({ 0x0f7b: noop });
  m.push16(0x9999);
  m.regs.ix = 0x4040;
  wr(m, 0x4043, 0x05);
  mutant(m);
  assert.throws(() => assert.equal(rd(m, 0x4043), 0x06));
});
