// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0f66 (ROM 0x0f66-0x0f7a + inlined loc_0f87/loc_0faa): both (ix+3) and (ix+4) land in
// [0x60,0xA0), so the in-window setup runs (state (ix+2)+=2, timers seeded) and the target compare
// (target 0x50 < pos 0x70) takes the loc_0faa arm -> (ix+6)=1. Contract: 303 T, no calls.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0f66 } from "../loc_0f66.js";

const IX = 0x4100;

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = IX;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function seed(m) {
  m.mem.write8(IX + 0x03, 0x6f); // -> 0x70 after inc, in [0x60,0xA0)
  m.mem.write8(IX + 0x04, 0x70); // in [0x60,0xA0)
  m.mem.write8(IX + 0x02, 0x02); // state
  m.mem.write8(IX + 0x06, 0x00); // dir
  m.mem.write8(0x4202, 0x50);    // target below pos -> loc_0faa arm
}

test("loc_0f66: in-window setup + target-below dir arm, 303 T, no calls", () => {
  const m = mk();
  m.push16(0x9999);
  seed(m);
  loc_0f66(m);
  assert.equal(m.cycles, 303, "sum of exercised-path T-states");
  assert.deepEqual(m.calls, [], "no handoff/call on the in-window path");
  assert.equal(m.mem.read8(IX + 0x02), 0x04, "(ix+2) advanced by 2");
  assert.equal(m.mem.read8(IX + 0x10), 0x03, "(ix+0x10) timer seed");
  assert.equal(m.mem.read8(IX + 0x11), 0x0c, "(ix+0x11) timer seed");
  assert.equal(m.mem.read8(IX + 0x06), 0x01, "(ix+6) dir <- 1 (target below)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0f66.js
//   find: mem.write8((regs.ix + 0x06) & 0xffff, 0x01);   (the loc_0faa arm)
//   repl: mem.write8((regs.ix + 0x06) & 0xffff, 0x00);
//   expect: FAIL — direction flag wrong (0x00 instead of 0x01)
test("loc_0f66: contract catches a wrong (ix+6) direction constant", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.incMem8(mem, (regs.ix + 0x03) & 0xffff); m.step(0x0f69, 23);
    regs.a = mem.read8((regs.ix + 0x03) & 0xffff); m.step(0x0f6c, 19);
    regs.sub(0x60); m.step(0x0f6e, 7);
    regs.cp(0x40); m.step(0x0f70, 7);
    m.step(0x0f72, 7);
    regs.a = mem.read8((regs.ix + 0x04) & 0xffff); m.step(0x0f75, 19);
    regs.sub(0x60); m.step(0x0f77, 7);
    regs.cp(0x40); m.step(0x0f79, 7);
    m.step(0x0f87, 12);
    regs.incMem8(mem, (regs.ix + 0x02) & 0xffff); m.step(0x0f8a, 23);
    regs.incMem8(mem, (regs.ix + 0x02) & 0xffff); m.step(0x0f8d, 23);
    mem.write8((regs.ix + 0x10) & 0xffff, 0x03); m.step(0x0f91, 19);
    mem.write8((regs.ix + 0x11) & 0xffff, 0x0c); m.step(0x0f95, 19);
    mem.write8((regs.ix + 0x05) & 0xffff, 0x00); m.step(0x0f99, 19);
    mem.write8((regs.ix + 0x13) & 0xffff, 0x00); m.step(0x0f9d, 19);
    regs.a = mem.read8(0x4202); m.step(0x0fa0, 13);
    regs.sub(mem.read8((regs.ix + 0x04) & 0xffff)); m.step(0x0fa3, 19);
    m.step(0x0faa, 12);
    mem.write8((regs.ix + 0x06) & 0xffff, 0x00); m.step(0x0fae, 19); // MUTANT: 0x00 not 0x01
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  seed(m);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(IX + 0x06), 0x01));
});
