// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1bcd (1-of-4 state dispatch on A, ROM 0x1BCD-0x1BE2):
//   push 0x00d8 (shared handler epilogue), then dec a x up-to-3:
//   A==1 -> jp 0x1c3a,  A==2 -> jp 0x1d28,  A!in{1,2,3} -> jp 0x0000,  A==3 -> fall into loc_1be3.
// Contracts:
//   A=1: 35 T (10+11+4+10), calls [0x1c3a], 0x00d8 pushed.
//   A=3: 86 T, calls [0x1be3], HL=0x5800, A reloaded from (0x401e)=0, 0x00d8 pushed.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1bcd } from "../loc_1bcd.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400; // push 0x00d8 lands in work RAM
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_1bcd A=1: dispatch to 0x1c3a; 0x00d8 pushed; 35 T", () => {
  const m = mk({ 0x1c3a: "tail" });
  m.regs.a = 0x01;
  const ret = loc_1bcd(m);
  assert.equal(m.cycles, 35, "T total (10+11+4+10)");
  assert.deepEqual(m.calls, [0x1c3a], "A==1 -> jp 0x1c3a");
  assert.equal(ret, "TAIL", "the jp callee result propagates out");
  assert.equal(m.regs.sp, 0x43fe, "push hl consumed one stack slot (SP-2)");
  assert.equal(m.mem.read16(0x43fe), 0x00d8, "the pushed handler epilogue address is 0x00d8");
});

test("loc_1bcd A=3: fall through into loc_1be3; HL=0x5800; 86 T", () => {
  const m = mk({ 0x1be3: "tail" });
  m.regs.a = 0x03;
  const ret = loc_1bcd(m);
  assert.equal(m.cycles, 86, "T total for the three-dec fall-through");
  assert.deepEqual(m.calls, [0x1be3], "A==3 -> fall through into loc_1be3");
  assert.equal(ret, "TAIL");
  assert.equal(m.regs.hl, 0x5800, "ld hl,0x5800 -- OBJRAM base for the fill");
  assert.equal(m.regs.a, 0x00, "ld a,(0x401e) reloaded (=0 in zeroed work RAM)");
  assert.equal(m.mem.read16(0x43fe), 0x00d8, "0x00d8 pushed before the dispatch");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1bcd.js
//   find: m.step(0x1c3a, 10); // jp z,0x1c3a (taken)\n    return m.call(0x1c3a);
//   repl: m.step(0x1c50, 10); ... return m.call(0x1c50);
//   expect: FAIL  (A=1 calls == [0x1c50] != [0x1c3a])
test("loc_1bcd: the contract catches a wrong dispatch target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x00d8; m.step(0x1bd0, 10);
    m.push16(regs.hl); m.step(0x1bd1, 11);
    regs.a = regs.dec8(regs.a); m.step(0x1bd2, 4);
    if (regs.fZ) { m.step(0x1c50, 10); return m.call(0x1c50); } // MUTANT target
    m.step(0x1bd5, 10);
    throw new Error("unreached in the A=1 scenario");
  };
  const m = mk({ 0x1c50: "tail" });
  m.regs.a = 0x01;
  mutant(m);
  assert.notDeepEqual(m.calls, [0x1c3a], "mutant dispatches to 0x1c50, so calls != [0x1c3a]");
});
