// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_15c3 (ROM 0x15c3-0x15de): guarded one-shot. Full-advance contract: (0x422e) bit0
// set, (0x422f)=1 so `dec (0x422f)` hits 0, clears (0x422e)=0, then (0x4200)/(0x41ef) bit0 set gate the
// final (0x4229)=1. Contract: 139 T, no calls, (0x4229)=1, (0x422e)=0, (0x422f)=0.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_15c3 } from "../loc_15c3.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn) {
  const m = mk();
  m.mem.write8(0x422e, 0x01); // bit0 set -> ret z not taken
  m.mem.write8(0x422f, 0x01); // dec -> 0 -> ret nz not taken
  m.mem.write8(0x4200, 0x01); // bit0 set -> ret nc not taken
  m.mem.write8(0x41ef, 0x01); // bit0 set -> ret nc not taken
  m.push16(0x9999);
  fn(m);
  return m;
}
function checkSpec(m) {
  assert.equal(m.cycles, 139, "T-state total of the full-advance path");
  assert.deepEqual(m.calls, [], "loc_15c3 makes no external calls");
  assert.equal(m.mem.read8(0x4229), 0x01, "(0x4229) <- 1");
  assert.equal(m.mem.read8(0x422e), 0x00, "(0x422e) cleared on the zero tick");
  assert.equal(m.mem.read8(0x422f), 0x00, "(0x422f) counted down to 0");
  assert.equal(m.pc, 0x9999, "ret to caller");
}

test("loc_15c3: on the (0x422f) zero tick clears (0x422e) and sets (0x4229)=1; 139 T", () => {
  checkSpec(run(loc_15c3));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_15c3.js
//   find: regs.decMem8(mem, regs.hl);\n  m.step(0x15cb, 11); // dec (0x422f)
//   repl: regs.incMem8(mem, regs.hl);\n  m.step(0x15cb, 11);
//   expect: FAIL (0x422f 1->2 stays NZ -> `ret nz` returns early; (0x4229) never set; caught by cycles + (0x4229))
test("loc_15c3: the contract catches the countdown running the wrong way (dec -> inc)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x422e; m.step(0x15c6, 10);
    regs.bit(0, mem.read8(regs.hl)); m.step(0x15c8, 12);
    if (regs.fZ) { m.ret(11); return; } m.step(0x15c9, 5);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x15ca, 6);
    regs.incMem8(mem, regs.hl); m.step(0x15cb, 11); // MUTANT dec->inc
    if (regs.fNZ) { m.ret(11); return; } m.step(0x15cc, 5);
    regs.hl = (regs.hl - 1) & 0xffff; m.step(0x15cd, 6);
    mem.write8(regs.hl, 0x00); m.step(0x15cf, 10);
    regs.a = mem.read8(0x4200); m.step(0x15d2, 13); regs.rrca(); m.step(0x15d3, 4);
    if (regs.fNC) { m.ret(11); return; } m.step(0x15d4, 5);
    regs.a = mem.read8(0x41ef); m.step(0x15d7, 13); regs.rrca(); m.step(0x15d8, 4);
    if (regs.fNC) { m.ret(11); return; } m.step(0x15d9, 5);
    regs.a = 0x01; m.step(0x15db, 7); mem.write8(0x4229, regs.a); m.step(0x15de, 13);
    m.ret();
  };
  assert.throws(() => checkSpec(run(mutant)));
});
