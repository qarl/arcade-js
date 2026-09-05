// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_123f (ROM 0x123f-0x125d): per-object hit test at IX vs (0x4209); a hit sets
// (0x420b)=1 and falls through to loc_125e. Contract: hit path 145 T, calls [0x125e], (0x420b)=1.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_123f } from "../loc_123f.js";

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
// loc_125e is reached by fall-through (tail); loc_123f owes no ret, so the stub just marks the call.
const tail125e = () => "TAIL";

function run(fn) {
  const m = mk({ 0x125e: tail125e });
  m.regs.ix = 0x4300;
  m.mem.write8(0x4300, 0x01); // (ix+0) active
  m.mem.write16(0x4209, 0x0000); // reference X/Y = 0/0
  m.mem.write8(0x4303, 0x00); // (ix+3) X in band
  m.mem.write8(0x4304, 0x00); // (ix+4) Y in band
  const ret = fn(m);
  return { m, ret };
}

test("loc_123f: in-band hit raises (0x420b) and delegates to loc_125e; 145 T", () => {
  const { m, ret } = run(loc_123f);
  assert.equal(m.cycles, 145, "sum of the hit-path T-states");
  assert.deepEqual(m.calls, [0x125e], "fall-through delegate to loc_125e");
  assert.equal(ret, "TAIL", "the delegate's result propagates");
  assert.equal(m.mem.read8(0x420b), 0x01, "hit flag raised");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_123f.js
//   find: mem.write8(0x420b, regs.a);
//   repl: (drop it -- the hit flag is never raised)
//   expect: FAIL ((0x420b) stays 0; caught by the hit-flag assert)
test("loc_123f: the contract catches a dropped hit-flag write", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.bit(0, mem.read8((regs.ix + 0x00) & 0xffff), ((regs.ix + 0x00) >> 8) & 0xff);
    m.step(0x1243, 20);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x1244, 5);
    regs.hl = mem.read16(0x4209); m.step(0x1247, 16);
    regs.a = mem.read8((regs.ix + 0x03) & 0xffff); m.step(0x124a, 19);
    regs.sub(regs.l); m.step(0x124b, 4);
    regs.add(0x02); m.step(0x124d, 7);
    regs.cp(0x06); m.step(0x124f, 7);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x1250, 5);
    regs.a = mem.read8((regs.ix + 0x04) & 0xffff); m.step(0x1253, 19);
    regs.sub(regs.h); m.step(0x1254, 4);
    regs.add(0x05); m.step(0x1256, 7);
    regs.cp(0x0c); m.step(0x1258, 7);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x1259, 5);
    regs.a = 0x01; m.step(0x125b, 7);
    m.step(0x125e, 13); // MUTANT: dropped `ld (0x420b),a`
    return m.call(0x125e);
  };
  const { m } = run(mutant);
  assert.throws(() => assert.equal(m.mem.read8(0x420b), 0x01));
});
