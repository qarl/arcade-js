// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_003c (Galaxian pseudo-random seed step, ROM 0x003C-0x0047):
//   ld a,(0x401e); ld b,a; add a,a; add a,a; add a,b; inc a; ld (0x401e),a; ret
// Contract: (0x401e)' = seed*5 + 1 (8-bit wrap); 56 T (13+4+4+4+4+4+13+10); rets to caller; no m.call.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_003c } from "../loc_003c.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4300; m.push16(0xbeef);
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, s0) {
  const m = mk();
  m.mem.workRam[0x1e] = s0;
  fn(m);
  return { cycles: m.cycles, calls: m.calls, seed: m.mem.workRam[0x1e], a: m.regs.a, pc: m.pc };
}

function checkSpec(res) {
  assert.equal(res.cycles, 56, "T-state total (13+4+4+4+4+4+13+10)");
  assert.deepEqual(res.calls, [], "pure computation, no transfer");
  assert.equal(res.seed, 0x51, "(0x401e) = seed*5+1 = 0x10*5+1 = 0x51");
  assert.equal(res.a, 0x51, "A holds the new seed");
  assert.equal(res.pc, 0xbeef, "ret to caller");
}

test("loc_003c: advances the seed to seed*5+1 at 0x401e; 56 T", () => {
  checkSpec(run(loc_003c, 0x10));
});

test("loc_003c: the seed*5+1 step wraps 8-bit (0x33 -> 0x00)", () => {
  const res = run(loc_003c, 0x33); // 0x33*5 = 0xFF, +1 = 0x100 & 0xff = 0x00
  assert.equal(res.seed, 0x00, "0x33*5+1 wraps to 0x00");
  assert.equal(res.a, 0x00, "A wrapped to 0x00");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_003c.js
//   find: mem.write8(0x401e, regs.a);
//   repl: mem.write8(0x401f, regs.a);
//   expect: FAIL  (stores to the wrong cell; (0x401e) stays 0x10 -- caught by the seed assertion)
//   verified-anchor: count == 1  (the sole (0x401e) store in loc_003c.js)
test("loc_003c: the contract catches a wrong store address", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x401e); m.step(0x003f, 13);
    regs.b = regs.a; m.step(0x0040, 4);
    regs.add(regs.a); m.step(0x0041, 4);
    regs.add(regs.a); m.step(0x0042, 4);
    regs.add(regs.b); m.step(0x0043, 4);
    regs.a = regs.inc8(regs.a); m.step(0x0044, 4);
    mem.write8(0x401f, regs.a); m.step(0x0047, 13); // MUTANT: wrong store cell
    m.ret();
  };
  assert.throws(() => checkSpec(run(mutant, 0x10)));
});
